/**
 * OC-5A — a real PostgreSQL (PGlite) world for PartSentry service authority and the atomic ledger
 * intent, built ONLY from the repository's own migrations:
 *
 *   createEvidenceHistoryDatabase()      the ledger chain (users, vehicles, partsentry_logs,
 *                                        blockchain_events, public_keys, the Issue #158 custody chain),
 *                                        tenants / tenant_users / user_sessions, trust_audit_events
 *   @mechanic_parts, @mechanic_work_orders  verbatim CREATE TABLE blocks of 009_phase4_schema.sql (the
 *                                        file as a whole rebuilds unrelated domains)
 *   20260808150000                       the work-order shape convergence
 *   @dealer_profiles                     the verbatim CREATE TABLE block of 20260626150000 (governed Dealer
 *                                        authority reads it; the file as a whole needs the governance
 *                                        decision-ledger functions of an unrelated lane)
 *   20261004160000 / 160100 / 160200     the OC-5A migrations under test
 *
 * The Issue #158 custody rollout starts PREPARED, exactly as the migration leaves it: stakeholder
 * signing is then refused — the real "ledger unavailable" state of RC1 finding D. `finalizeCustody`
 * performs the protected finalization the issue-158 suites perform.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createEvidenceHistoryDatabase, supabaseOver, MIGRATIONS_DIR, migrationUpSql } from './pgliteLedgerHarness.js';

export const OC5A_MIGRATIONS = Object.freeze([
  '20261004160000_oc5a_tenant_users_role_catalogue.sql',
  '20261004160100_oc5a_work_order_owner_authorization.sql',
  '20261004160200_oc5a_partsentry_attested_record_and_ledger_intents.sql',
]);

function verbatimBlock(file, startMarker, endMarker) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`oc5a world: block "${startMarker}" not found in ${file}`);
  return sql.slice(start, end + endMarker.length);
}

export async function createOc5aDatabase({ oc5a = true } = {}) {
  const db = await createEvidenceHistoryDatabase();
  const steps = [
    ['@mechanic_parts', () => verbatimBlock('009_phase4_schema.sql', 'CREATE TABLE IF NOT EXISTS mechanic_parts (', ');')],
    ['@mechanic_work_orders', () => verbatimBlock('009_phase4_schema.sql', 'CREATE TABLE IF NOT EXISTS mechanic_work_orders (', ');')],
    ['20260808150000_mechanic_work_orders_convergence.sql', () => migrationUpSql('20260808150000_mechanic_work_orders_convergence.sql')],
    ['@dealer_profiles', () => verbatimBlock('20260626150000_dealer_compliance.sql', 'CREATE TABLE IF NOT EXISTS dealer_profiles (', ');')],
    ...(oc5a ? OC5A_MIGRATIONS.map((file) => [file, () => migrationUpSql(file)]) : []),
  ];
  for (const [name, sql] of steps) {
    try {
      await db.exec(sql());
    } catch (error) {
      throw new Error(`oc5a world: ${name} did not apply: ${error.message}`);
    }
  }
  return db;
}

/** The protected Issue #158 finalization, at the runtime's own custody generation. */
export async function finalizeCustody(db, generation) {
  await db.query('SELECT public.blockchain_authorize_custody_generation($1::text)', [generation]);
  await db.exec(`UPDATE public.blockchain_custody_rollout
                    SET state = 'FINALIZED', old_writers_drained = TRUE, finalized_at = clock_timestamp()
                  WHERE singleton = TRUE`);
}

/** Point the shared supabase singleton (from AND rpc) at this database. Returns restore(). */
export function installOver(supabase, db) {
  const client = supabaseOver(db);
  const saved = { from: supabase.from, rpc: supabase.rpc };
  supabase.from = (table) => client.from(table);
  supabase.rpc = (name, args) => client.rpc(name, args);
  return { client, restore: () => { supabase.from = saved.from; supabase.rpc = saved.rpc; } };
}

export default { OC5A_MIGRATIONS, createOc5aDatabase, finalizeCustody, installOver };
