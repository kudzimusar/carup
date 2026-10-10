#!/usr/bin/env node
/**
 * OC-5R-PC01-H — CLI for the staging definition convergence (lib/pc01StagingDefinitionConvergence.mjs).
 *
 *   STAGING_DATABASE_URL=… node database/scripts/oc5r_pc01_staging_definition_convergence.mjs --dry-run --receipt <file>
 *   STAGING_DATABASE_URL=… node database/scripts/oc5r_pc01_staging_definition_convergence.mjs --apply   --receipt <file>
 *
 * Staging only: the runner's assertStagingTarget refuses any connection that does not positively name the
 * staging project (and any that mentions production). The connection string is never printed or written.
 * One transaction; the receipt is written whether it commits, rolls back, or is refused.
 */
import pg from 'pg';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStagingTarget } from './lib/stagingMigrationRunner.mjs';
import { runConvergence } from './lib/pc01StagingDefinitionConvergence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dryRun = args.includes('--dry-run');
const receiptPath = args.includes('--receipt') ? args[args.indexOf('--receipt') + 1] : null;
if (apply === dryRun || !receiptPath) {
  console.error('usage: --dry-run|--apply --receipt <file>');
  process.exit(2);
}

const url = process.env.STAGING_DATABASE_URL || process.env.SUPABASE_DB_URL;
const target = assertStagingTarget(url);
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'oc5r-pc01-h-convergence' });
try { await client.connect(); } catch (e) { await client.end().catch(() => {}); throw e; }

let code = 0;
let receipt;
try {
  await client.query("set statement_timeout = '120s'");
  receipt = await runConvergence(client, { migrationsDir: path.join(here, '../migrations'), apply });
} catch (error) {
  code = 1;
  receipt = { ...(error.receipt || {}), error: { code: error.code || null, message: error.message } };
} finally {
  await client.end().catch(() => {});
}
receipt = { ...receipt, target: { kind: target.kind, ref: target.ref } };
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
const failed = [...(receipt.pre || []), ...(receipt.post || [])].filter((r) => !r.ok).map((r) => r.name);
console.log(`${receipt.mode}: committed=${receipt.committed} pre=${(receipt.pre || []).filter((r) => r.ok).length}/${(receipt.pre || []).length} post=${(receipt.post || []).filter((r) => r.ok).length}/${(receipt.post || []).length}${failed.length ? ` failed=[${failed.join('; ')}]` : ''}${receipt.error ? ` error=${receipt.error.code}` : ''}`);
process.exit(code);
