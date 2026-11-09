#!/usr/bin/env node
/**
 * Refuse to start a certification run against a database that cannot serve it.
 *
 * ── The incident this comes from ───────────────────────────────────────────
 * The repaired gate ran its full workload for the first time, and the staging instance's CPU
 * allowance was exhausted. What made it expensive to diagnose is that the instance still LOOKED
 * healthy by every ordinary measure: connections 14/60, zero idle-in-transaction, zero long-running
 * queries, 99.74% buffer cache hit, and `select 1` answering instantly.
 *
 * It was throttled by CPU QUOTA, so short queries ran at full speed and long ones were stalled:
 *
 *     1,000,000 rows →    379 ms      (379 ms per million)
 *     3,000,000 rows →  9,837 ms    (3,279 ms per million)
 *     3,000,000 rows → 16,087 ms    (5,362 ms per million)
 *
 * On an unthrottled instance the per-million cost is constant. Here it degraded 8–14×.
 *
 * The consequence was total: PostgREST could not finish its schema-cache query inside the
 * `authenticator` role's 8s statement_timeout, so it retried every ~60s forever (SQLSTATE 57014),
 * every REST call failed, and 148 tests failed for a reason none of them named.
 *
 * ── Why a RATIO, not a time limit ──────────────────────────────────────────
 * An absolute millisecond threshold has to be re-tuned for every runner and instance class, so it
 * gets loosened until it means nothing. The ratio is self-calibrating: it compares the instance
 * against ITSELF, moments apart, and only quota throttling makes the same work per row cost more.
 *
 * ── What it must never become ──────────────────────────────────────────────
 * This is a REFUSAL, not a retry and not a warning. Raising the timeout so a throttled query can
 * grind for longer is the opposite of a fix: it consumes more of the exact resource that is scarce.
 */
import pg from 'pg';
import { pathToFileURL } from 'node:url';

/** Per-million cost may not degrade by more than this. Measured 14.1 during the incident, 1.0 healthy. */
export const MAX_THROTTLE_RATIO = 3.0;
/**
 * PostgREST's own budget. If work of this size cannot finish inside the authenticator role's
 * statement_timeout, PostgREST cannot rebuild its schema cache and every REST call will fail.
 */
export const POSTGREST_STATEMENT_TIMEOUT_MS = 8000;

export class CapacityRefusal extends Error {
  constructor(reason, detail, measurements) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
    this.measurements = measurements;
  }
}

/** Pure CPU: generate_series touches no table, no index and no disk, so this measures compute alone. */
async function timeCpu(client, millions) {
  const { rows } = await client.query(
    `select (select count(*) from generate_series(1, $1::bigint)) as n,
            extract(milliseconds from clock_timestamp() - statement_timestamp())::int as ms`,
    [millions * 1_000_000],
  );
  return { millions, ms: rows[0].ms, per_million: rows[0].ms / millions };
}

export function classify({ short, long, timezone_ms, timezone_failed }) {
  const ratio = long.per_million / short.per_million;
  const measurements = {
    short_ms: short.ms,
    long_ms: long.ms,
    short_per_million_ms: Math.round(short.per_million),
    long_per_million_ms: Math.round(long.per_million),
    throttle_ratio: Number(ratio.toFixed(2)),
    timezone_ms,
    postgrest_budget_ms: POSTGREST_STATEMENT_TIMEOUT_MS,
  };

  // The direct check, not a proxy: this is literally one of the two queries PostgREST was failing on.
  if (timezone_failed) {
    throw new CapacityRefusal(
      'postgrest-cannot-start',
      `pg_timezone_names did not complete within PostgREST's ${POSTGREST_STATEMENT_TIMEOUT_MS}ms budget — ` +
      'PostgREST cannot rebuild its schema cache, so every REST call will fail',
      measurements,
    );
  }
  if (ratio > MAX_THROTTLE_RATIO) {
    throw new CapacityRefusal(
      'cpu-quota-throttled',
      `the same work costs ${ratio.toFixed(1)}× more per row at 3M than at 1M (limit ${MAX_THROTTLE_RATIO}×) — ` +
      'the instance is throttled and a certification run would exhaust it further',
      measurements,
    );
  }
  if (long.ms > POSTGREST_STATEMENT_TIMEOUT_MS) {
    throw new CapacityRefusal(
      'below-postgrest-budget',
      `${long.ms}ms of pure CPU work exceeds PostgREST's own ${POSTGREST_STATEMENT_TIMEOUT_MS}ms statement budget`,
      measurements,
    );
  }
  return measurements;
}

export async function measureCapacity(client) {
  // Short first, then long. The short probe establishes this instance's own baseline, so the
  // comparison is against itself rather than against a number someone guessed a year ago.
  const short = await timeCpu(client, 1);
  const long = await timeCpu(client, 3);

  let timezone_ms = null;
  let timezone_failed = false;
  try {
    await client.query(`set local statement_timeout = ${POSTGREST_STATEMENT_TIMEOUT_MS}`);
    const { rows } = await client.query(
      'select count(*) as n, extract(milliseconds from clock_timestamp() - statement_timestamp())::int as ms from pg_timezone_names',
    );
    timezone_ms = rows[0].ms;
  } catch (error) {
    // 57014 is query_canceled — the statement timeout fired, which is the failure mode itself.
    timezone_failed = true;
    if (error.code !== '57014') timezone_failed = true;
  } finally {
    await client.query('set local statement_timeout = default').catch(() => {});
  }

  return classify({ short, long, timezone_ms, timezone_failed });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const raw = process.env.DIASPORA_STAGING_DATABASE_URL || '';
  if (!raw) {
    console.error('::error::staging capacity guard refused — missing-database-url');
    process.exit(1);
  }
  const connectionString = raw.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  // Release on EVERY path, including a failed connect.
  try { await client.connect(); } catch (error) { await client.end().catch(() => {}); throw error; }
  try {
    const measurements = await measureCapacity(client);
    console.log(`staging capacity: healthy — ${JSON.stringify(measurements)}`);
  } catch (error) {
    console.error(`::error::staging capacity guard refused — ${error.reason || 'error'}: ${error.message}`);
    if (error.measurements) console.error(JSON.stringify(error.measurements, null, 2));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
