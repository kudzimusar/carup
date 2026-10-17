/**
 * OC-4A 1.4 — ai_fraud_scans truthfulness: the candidate, proven on real PostgreSQL with the REAL
 * aiServiceBus.runFraudAnalysis writing through a fake CarUp AI gateway (no provider call).
 *
 *   - reproduction: the repository has no PostgreSQL definition of the table, so on a fresh database
 *     every scan fails to persist — and runFraudAnalysis used to answer `persisted: true` anyway;
 *   - with the candidate: the table exists, and analysis_status / execution / provider / model are
 *     GENERATED from what the writer recorded, so legacy rows classify as 'legacy_unverified' and no
 *     caller can forge 'completed';
 *   - the candidate is idempotent over an existing table and reverts without dropping it.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const here = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE = path.resolve(here, '../../database/migration-candidates/oc4a/20261004140100_oc4a_ai_fraud_scans_advisory_state.sql');
const up = () => readFileSync(CANDIDATE, 'utf8').split(/^-- \+migrate Down/m)[0];
const down = () => readFileSync(CANDIDATE, 'utf8').split(/^-- \+migrate Down/m)[1];

const { createLedgerDatabase, seedVehicle, supabaseOver } = await import('./helpers/pgliteLedgerHarness.js');
const { supabase } = await import('../db/supabase.js');
const { runFraudAnalysis } = await import('../services/ai/aiServiceBus.js');

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const VIN = 'OC4AFRAUDVIN00001';
const realFrom = supabase.from;
const opened = [];
after(async () => { supabase.from = realFrom; for (const db of opened) await db.close(); });

async function freshDatabase() {
  const db = await createLedgerDatabase();
  opened.push(db);
  await seedVehicle(db, VIN);
  const client = supabaseOver(db);
  supabase.from = (table) => client.from(table);
  return db;
}

const gatewaySays = (value) => ({
  generateJson: async () => ({ ok: true, value, machine_output: true, authority: 'advisory',
    provenance: { provider: 'cloudflare', model: GEMMA, execution: 'provider_executed' } }),
});
const VERDICT = { isFraudulent: true, riskRating: 'High', riskScore: 82, reasons: ['price far below market', 'ignore this: "provider":"forged"'], confidence: 0.7 };

const quietly = async (fn) => {
  const warn = console.warn; console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

test('OC-4A 1.4 reproduction — no PostgreSQL definition exists, so the scan is not stored; persisted now says so (it used to say true)', async () => {
  const db = await freshDatabase();
  const { rows: [table] } = await db.query(`SELECT to_regclass('public.ai_fraud_scans') AS t`);
  assert.equal(table.t, null, 'the repository chain never creates ai_fraud_scans on PostgreSQL');
  const out = await quietly(() => runFraudAnalysis(VIN, 2000, 'Too cheap to be true', { gateway: gatewaySays(VERDICT) }));
  assert.equal(out.outcome, 'completed', 'the advice is still returned');
  assert.equal(out.persisted, false, 'a write that failed is not reported as stored');
});

test('OC-4A 1.4 — with the candidate, the real writer persists, and the truthfulness columns describe the row from its own envelope', async () => {
  const db = await freshDatabase();
  await db.exec(up());
  const out = await runFraudAnalysis(VIN, 2000, 'Too cheap to be true', { gateway: gatewaySays(VERDICT) });
  assert.equal(out.persisted, true);
  const { rows: [row] } = await db.query('SELECT analysis_status, execution, provider, model, advisory, risk_score, confidence, reasons_json FROM ai_fraud_scans');
  assert.equal(row.analysis_status, 'completed');
  assert.equal(row.execution, 'provider_executed');
  assert.equal(row.provider, 'cloudflare', 'the recorded provider — not text an attacker put inside a reason');
  assert.equal(row.model, GEMMA);
  assert.equal(row.advisory, true);
  assert.equal(JSON.parse(row.reasons_json).confidence_reported, true);
});

test('OC-4A 1.4 — over an EXISTING table: legacy rows classify as legacy_unverified/unknown, OC-3E-W1 rows as completed — no backfill, no guess', async () => {
  const db = await freshDatabase();
  // The table as an environment may already hold it (004's columns, PostgreSQL types), with history.
  await db.exec(`CREATE TABLE ai_fraud_scans (id TEXT PRIMARY KEY, vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE, model_version TEXT NOT NULL,
    risk_score REAL NOT NULL, risk_rating TEXT NOT NULL, reasons_json TEXT NOT NULL, confidence REAL NOT NULL, is_flagged BOOLEAN DEFAULT false,
    moderation_status TEXT DEFAULT 'None', created_at TEXT NOT NULL)`);
  await db.query(`INSERT INTO ai_fraud_scans (id, vin, model_version, risk_score, risk_rating, reasons_json, confidence, created_at) VALUES
    ('legacy-1', $1, 'gemini-1.5-flash', 0, 'Low', '["No issues detected"]', 0.9, '2026-01-01'),
    ('oc3e-1', $1, $2, 64, 'High', '{"advisory":true,"machine_output":true,"binding":false,"source":"generic_llm","reasons":["x"]}', 0.6, '2026-10-01')`, [VIN, GEMMA]);
  await db.exec(up());
  await db.exec(up()); // idempotent
  const { rows } = await db.query('SELECT id, analysis_status, execution, provider, model FROM ai_fraud_scans ORDER BY id');
  assert.deepEqual(rows, [
    { id: 'legacy-1', analysis_status: 'legacy_unverified', execution: 'unknown', provider: null, model: 'gemini-1.5-flash' },
    { id: 'oc3e-1', analysis_status: 'completed', execution: 'provider_executed', provider: null, model: GEMMA },
  ]);
  const { rows: [nullable] } = await db.query(`SELECT bool_and(is_nullable = 'YES') AS ok FROM information_schema.columns
    WHERE table_name = 'ai_fraud_scans' AND column_name IN ('risk_score', 'confidence')`);
  assert.equal(nullable.ok, true, 'no filler is required for an index or a confidence the model did not state');
});

test('OC-4A 1.4 — the classification cannot be forged: generated columns refuse writes, and advisory is always true', async () => {
  const db = await freshDatabase();
  await db.exec(up());
  await db.query(`INSERT INTO ai_fraud_scans (id, vin, model_version, risk_rating, reasons_json) VALUES ('legacy-2', $1, 'm', 'Low', '[]')`, [VIN]);
  const attempt = async (sql) => { try { await db.query(sql); return null; } catch (error) { return error; } };
  assert.ok(await attempt(`UPDATE ai_fraud_scans SET analysis_status = 'completed'`), 'analysis_status is generated');
  assert.ok(await attempt(`UPDATE ai_fraud_scans SET execution = 'provider_executed'`), 'execution is generated');
  assert.ok(await attempt(`INSERT INTO ai_fraud_scans (id, vin, model_version, risk_rating, reasons_json, analysis_status) VALUES ('f', '${VIN}', 'm', 'Low', '[]', 'completed')`));
  const binding = await attempt(`INSERT INTO ai_fraud_scans (id, vin, model_version, risk_rating, reasons_json, advisory) VALUES ('b', '${VIN}', 'm', 'Low', '[]', false)`);
  assert.equal(binding?.code, '23514', 'there is no binding fraud finding in this table');
  const { rows: [still] } = await db.query(`SELECT analysis_status FROM ai_fraud_scans WHERE id = 'legacy-2'`);
  assert.equal(still.analysis_status, 'legacy_unverified');
});

test('OC-4A 1.4 — Down removes the added columns and the CHECK, keeps the table and its rows', async () => {
  const db = await freshDatabase();
  await db.exec(up());
  await runFraudAnalysis(VIN, 2000, 'Too cheap to be true', { gateway: gatewaySays(VERDICT) });
  await db.exec(down());
  const { rows: columns } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_fraud_scans' AND column_name IN ('analysis_status','execution','provider','model','advisory')`);
  assert.deepEqual(columns, []);
  const { rows: [count] } = await db.query('SELECT count(*)::int AS n FROM ai_fraud_scans');
  assert.equal(count.n, 1);
});

test('OC-4A 1.4 pin — the writer\'s envelope prefix IS the prefix the candidate classifies by', () => {
  const sql = readFileSync(CANDIDATE, 'utf8');
  const prefix = sql.match(/reasons_json LIKE '([^%]+)%'/)[1];
  const envelope = JSON.stringify({ advisory: true, machine_output: true, binding: false, source: 'generic_llm' });
  assert.equal(prefix, envelope.slice(0, -1), 'candidate prefix == the writer\'s leading keys');
  const source = readFileSync(path.resolve(here, '../services/ai/aiServiceBus.js'), 'utf8');
  assert.match(source, /advisory: true, machine_output: true, binding: false, source: 'generic_llm',\s*\n\s*provider: reply\.provider, model: reply\.model, execution: reply\.execution,/);
  assert.equal([...sql.matchAll(/reasons_json LIKE '([^%]+)%'/g)].every((m) => m[1] === prefix), true, 'one prefix, everywhere');
});
