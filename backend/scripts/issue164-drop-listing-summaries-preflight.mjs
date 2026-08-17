#!/usr/bin/env node
/**
 * Issue #164 — preflight for dropping public.vehicle_listing_summaries.
 *
 * READ-ONLY. This script never drops anything and never writes. It answers one question against a
 * positively-identified database: would the drop migration be permitted here, or would it refuse?
 *
 * The product-owner decision is fail-closed: if a preflight finds rows or dependencies, STOP —
 * do not delete them. This script is how you find out BEFORE applying, so a refusal is discovered
 * deliberately rather than as a failed migration in the middle of a deploy.
 *
 * Usage:
 *   DIASPORA_STAGING_DATABASE_URL=... node backend/scripts/issue164-drop-listing-summaries-preflight.mjs
 *
 * Exit codes:
 *   0  GO      — 0 rows, no dependents; the migration would drop the table.
 *   1  NO-GO   — the migration would REFUSE. Reconcile; do not force.
 *   2  BLOCKED — the guard could not positively identify the target database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Positive identification, matching backend/scripts/owner-experience-staging-uat-fixture.mjs:
// the ref must be present, not merely "not production". An unrecognised database is BLOCKED.
const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');
const TABLE = 'public.vehicle_listing_summaries';

const blocked = (message) => { console.error(`BLOCKED: ${message}`); process.exit(2); };

function tlsConfig() {
  const supplied = process.env.DIASPORA_STAGING_CA_CERT;
  if (supplied?.includes('BEGIN CERTIFICATE')) return { rejectUnauthorized: true, ca: supplied };
  const path = fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url));
  const ca = readFileSync(path, 'utf8');
  if (!ca.includes('BEGIN CERTIFICATE')) blocked('bundled Supabase CA is not a PEM certificate');
  return { rejectUnauthorized: true, ca };
}

async function main() {
  const raw = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!raw) blocked('DIASPORA_STAGING_DATABASE_URL is not set');
  if (raw.includes(FORBIDDEN_PROD_REF)) blocked('database URL references the forbidden production project');
  if (!raw.includes(STAGING_REF)) blocked(`database URL does not positively identify staging ${STAGING_REF}`);

  const connectionString = raw.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
  const client = new pg.Client({ connectionString, ssl: tlsConfig(), statement_timeout: 30000 });
  await client.connect();

  try {
    const present = (await client.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [TABLE])).rows[0].present;
    if (!present) {
      console.log(JSON.stringify({ verdict: 'GO', reason: 'table_absent', detail: 'nothing to drop; migration is a no-op' }, null, 2));
      return 0;
    }

    // Counted, not estimated — reltuples is a planner statistic and reads 0 on an unanalysed table.
    const rows = Number((await client.query(`SELECT count(*)::bigint AS n FROM ${TABLE}`)).rows[0].n);

    const views = (await client.query(
      `SELECT DISTINCT dep.relname FROM pg_depend d
         JOIN pg_rewrite r ON r.oid = d.objid
         JOIN pg_class dep ON dep.oid = r.ev_class
        WHERE d.refobjid = $1::regclass AND d.refclassid = 'pg_class'::regclass AND dep.oid <> $1::regclass`,
      [TABLE])).rows.map(r => r.relname);

    const inboundFks = (await client.query(
      `SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint WHERE confrelid = $1::regclass`,
      [TABLE])).rows.map(r => `${r.tbl}.${r.conname}`);

    const routines = (await client.query(
      `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')
          AND p.prosrc ILIKE '%vehicle_listing_summaries%'`)).rows.map(r => r.sig);

    const blockers = [];
    if (rows !== 0) blockers.push(`${rows} row(s) present`);
    if (views.length) blockers.push(`dependent view(s): ${views.join(', ')}`);
    if (inboundFks.length) blockers.push(`inbound foreign key(s): ${inboundFks.join(', ')}`);
    if (routines.length) blockers.push(`routine(s) referencing it: ${routines.join(', ')}`);

    const verdict = blockers.length ? 'NO-GO' : 'GO';
    console.log(JSON.stringify({
      verdict,
      target: STAGING_REF,
      table: TABLE,
      rows,
      dependent_views: views,
      inbound_foreign_keys: inboundFks,
      referencing_routines: routines,
      blockers,
      note: blockers.length
        ? 'The migration would REFUSE here. The decision is to stop, not to delete. Reconcile these first.'
        : 'The migration would drop the table without CASCADE.',
    }, null, 2));

    return blockers.length ? 1 : 0;
  } finally {
    await client.end();
  }
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(`BLOCKED: ${error.message}`);
  process.exit(2);
});
