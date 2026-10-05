#!/usr/bin/env node
/**
 * Measure what staging-UAT identity provisioning costs per aggregate certification run.
 *
 * §10 of the remediation directive: "Do not simply say it is lighter. Prove it."
 *
 * So this measures BOTH revisions from git rather than asserting an improvement. It counts, from the
 * source that actually runs, the connections opened, SQL statements issued, identities written and
 * scrypt derivations performed — multiplied by how many times per aggregate run that source runs.
 *
 * Usage:
 *   node scripts/ci/measure-bootstrap-cost.mjs                 # the working tree
 *   node scripts/ci/measure-bootstrap-cost.mjs <before> <after> # compare two git revisions
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SHARD = '.github/workflows/diaspora-deployed-staging-shard.yml';
const ORCHESTRATOR = '.github/workflows/diaspora-deployed-staging-uat.yml';
const BOOTSTRAP = 'scripts/ci/bootstrap-staging-uat-identities.mjs';

/** Read a path from a git revision, or from the working tree when rev is null. Missing → ''. */
function readAt(rev, path) {
  try {
    return rev === null ? readFileSync(path, 'utf8') : execFileSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

/** The inline rotation step, when identity provisioning lived inside each shard. */
function inlineRotationBlock(shard) {
  const start = shard.indexOf('Rotate staging-only UAT identities');
  if (start === -1) return '';
  const rest = shard.slice(start);
  const end = rest.indexOf('- name: Run deployed acceptance');
  return end === -1 ? rest : rest.slice(0, end);
}

function countWork(source) {
  const identities = (source.match(/@carup-staging\.test'/g) || []).length;
  const transactions = (source.match(/query\('BEGIN'\)/g) || []).length;
  return {
    pg_clients: (source.match(/new pg\.Client/g) || []).length,
    identities,
    transactions,
    scrypt: (source.match(/crypto\.scrypt\(/g) || []).length,
    // One UPDATE per identity, plus BEGIN and COMMIT per transaction.
    statements: identities + transactions * 2,
  };
}

export function measure(rev = null) {
  const shard = readAt(rev, SHARD);
  const orchestrator = readAt(rev, ORCHESTRATOR);
  const bootstrapScript = readAt(rev, BOOTSTRAP);

  const shardInvocations = (orchestrator.match(/diaspora-deployed-staging-shard\.yml/g) || []).length;
  const inline = inlineRotationBlock(shard);

  // Which source actually provisions the identities, and how often does it run per aggregate run?
  const hasBootstrapJob = /^\s{2}bootstrap:/m.test(orchestrator) && orchestrator.includes(BOOTSTRAP);
  const provisioning = inline
    ? { where: 'per-shard (inline)', source: inline, runs: shardInvocations }
    : hasBootstrapJob
      ? { where: 'bootstrap job (once)', source: bootstrapScript, runs: 1 }
      : { where: 'none found', source: '', runs: 0 };

  const per = countWork(provisioning.source);
  // The shard's OWN database cost — the dependency that killed all three shards.
  const shardDbClients = (shard.match(/new pg\.Client/g) || []).length;

  return {
    revision: rev ?? 'working tree',
    provisioning_runs_at: provisioning.where,
    shard_invocations_per_aggregate_run: shardInvocations,
    provisioning_runs_per_aggregate_run: provisioning.runs,
    per_provisioning: per,
    totals_per_aggregate_run: {
      pg_connections: per.pg_clients * provisioning.runs,
      identities_rotated: per.identities * provisioning.runs,
      sql_statements: per.statements * provisioning.runs,
      scrypt_derivations: per.scrypt * provisioning.runs,
    },
    shard_database_connections_each: shardDbClients,
    shard_database_connections_per_aggregate_run: shardDbClients * shardInvocations,
  };
}

// `file://${argv[1]}` is NOT equivalent to import.meta.url: the latter is percent-encoded, so any
// path containing a space silently made this false — the script would load, run nothing and exit 0.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const [before, after] = process.argv.slice(2);
  if (!before) {
    console.log(JSON.stringify(measure(null), null, 2));
  } else {
    const b = measure(before);
    const a = measure(after ?? null);
    const delta = {};
    for (const key of Object.keys(b.totals_per_aggregate_run)) {
      const from = b.totals_per_aggregate_run[key];
      const to = a.totals_per_aggregate_run[key];
      delta[key] = { before: from, after: to, reduction: from - to, pct: from ? Math.round(((from - to) / from) * 100) : null };
    }
    delta.shard_database_connections_per_aggregate_run = {
      before: b.shard_database_connections_per_aggregate_run,
      after: a.shard_database_connections_per_aggregate_run,
      reduction: b.shard_database_connections_per_aggregate_run - a.shard_database_connections_per_aggregate_run,
    };
    console.log(JSON.stringify({ before: b, after: a, delta }, null, 2));
  }
}
