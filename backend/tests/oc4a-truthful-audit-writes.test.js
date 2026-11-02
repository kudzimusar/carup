/**
 * OC-4A 1.3 — truthful audit writes. "An audit write that can fail silently is not an audit."
 *
 * Every swallowed audit/history failure the OC-3 inventory named (plus the ones found tracing them) is
 * classified, given explicit behaviour, and proven here by INJECTING the failure:
 *
 *   SECURITY / AUTHORITY AUDIT (loud — the governed action does not proceed without it)
 *     - auditLogger: a failed AUTHORITATIVE trust_audit_events write is never a success, even when the
 *       legacy organization_audit_logs mirror succeeds (it used to return success: true);
 *     - workbook DB export: no audit, no export (diaspora-workbook-db-export.test.js #14).
 *   BUSINESS HISTORY (loud; transactional where the domain is)
 *     - identity decision audit: the decision is durable first, so the failure is an error log plus
 *       audit_recorded: false on the response (verification-decision-policy.test.js, OC-4A case);
 *     - evidence chain-of-custody events (upload, classification correction, partner import): still
 *       non-blocking by each domain's decision, but an ERROR, never a warning or `catch {}`.
 *   OBSERVABILITY (best effort — but visible in every environment)
 *     - diaspora best-effort audits (trade-graph query audits and the rest): they logged everywhere
 *       EXCEPT production;
 *     - the legacy organization_audit_logs mirror: its { error } was never read;
 *     - the ledger's rolling checkpoint (an integrity WITNESS): non-blocking, but a failed upsert was
 *       logged as "Created rolling integrity checkpoint".
 *   LEGACY-DEAD (retire)
 *     - trustGraphService.calculateVehicleTrustScore + recordTrustScoreHistory: retired;
 *     - TrustEnforcementEngine's trust_score_history writes: runtime-unreachable (pinned), retirement
 *       recorded as Trust-lane debt.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_LEDGER_HASH_VERSION;

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(here, '..');
const read = (rel) => readFileSync(path.join(BACKEND, rel), 'utf8');

const { createEvidenceHistoryDatabase, createLedgerDatabase, seedVehicle, seedEvidence, supabaseOver } = await import('./helpers/pgliteLedgerHarness.js');
const { supabase } = await import('../db/supabase.js');
const { logAuditEvent } = await import('../services/auditLogger.js');
const review = await import('../services/trustGovernance/partsentryReviewService.js');
const { appendBestEffortAudit } = await import('../services/diaspora/diasporaServiceUtils.js');
const { addEvent, verifyChain } = await import('../services/blockchain/blockchainService.js');
const { recordEvidenceUploadProvenance } = await import('../services/evidence/evidenceService.js');

const realFrom = supabase.from;
const opened = [];
after(async () => { supabase.from = realFrom; for (const db of opened) await db.close(); });

/** Capture console output while `fn` runs (and for `settleMs` after, for fire-and-forget writes). */
async function capture(fn, { settleMs = 0 } = {}) {
  const lines = { error: [], warn: [], log: [] };
  const original = { error: console.error, warn: console.warn, log: console.log };
  console.error = (...args) => lines.error.push(args.map(String).join(' '));
  console.warn = (...args) => lines.warn.push(args.map(String).join(' '));
  console.log = (...args) => lines.log.push(args.map(String).join(' '));
  try {
    const result = await fn();
    if (settleMs) await new Promise((resolve) => setTimeout(resolve, settleMs));
    return { result, lines };
  } catch (error) {
    return { error, lines };
  } finally {
    Object.assign(console, original);
  }
}

// ── SECURITY / AUTHORITY: the authoritative audit row ─────────────────────────────────────────────

function fakeClient({ trustInsertError = null, mirrorInsertError = null, membership = { organization_id: 'org-1' } } = {}) {
  const writes = [];
  const chain = (table) => {
    const state = { table, op: 'select', payload: null };
    const builder = {
      select() { return builder; }, eq() { return builder; }, limit() { return builder; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return builder; },
      maybeSingle: async () => ({ data: table === 'organization_users' ? membership : null, error: null }),
      then(resolve, reject) {
        let error = null;
        if (state.op === 'insert' && table === 'trust_audit_events') error = trustInsertError;
        if (state.op === 'insert' && table === 'organization_audit_logs') error = mirrorInsertError;
        if (state.op === 'insert' && !error) writes.push({ table, payload: state.payload });
        return Promise.resolve({ data: null, error }).then(resolve, reject);
      },
    };
    return builder;
  };
  return { writes, from: chain };
}

test('OC-4A 1.3 auditLogger — a failed AUTHORITATIVE write is never a success, even when the legacy mirror lands; and it is an error log', async () => {
  const client = fakeClient({ trustInsertError: { message: 'trust_audit_events failed', code: '42501' } });
  const { result, lines } = await capture(() => logAuditEvent(client, { event_type: 'PARTSENTRY_SUSPICION_FLAGGED', actorId: 'admin-1', actorRole: 'admin' }));
  assert.equal(result.success, false, 'required-audit callers read success as "the trail holds this event"');
  assert.equal(result.mirrored, true);
  assert.ok(client.writes.some((w) => w.table === 'organization_audit_logs'), 'the mirror was still attempted, so the event is not lost outright');
  assert.ok(lines.error.some((line) => line.includes('authoritative trust_audit_events write failed') && line.includes('PARTSENTRY_SUSPICION_FLAGGED')));
});

test('OC-4A 1.3 auditLogger — a failing legacy mirror (OBSERVABILITY) is reported, no longer swallowed by .catch(() => {})', async () => {
  const client = fakeClient({ mirrorInsertError: { message: 'organization_audit_logs_user_id_fkey' } });
  const { result, lines } = await capture(() => logAuditEvent(client, { event_type: 'OC4A_MIRROR_PROBE', actorId: 'admin-mirror', actorRole: 'admin' }), { settleMs: 20 });
  assert.equal(result.success, true, 'the authoritative row was written; the mirror does not decide success');
  assert.ok(lines.warn.some((line) => line.includes('legacy organization_audit_logs mirror write failed') && line.includes('mirror_insert_failed')), lines.warn.join('\n'));
});

test('OC-4A 1.3 — on PostgreSQL, a governed PartSentry change with no authoritative audit row is REFUSED, although the mirror row was written', async () => {
  const db = await createEvidenceHistoryDatabase();
  opened.push(db);
  const client = supabaseOver(db);
  await db.query(`INSERT INTO users (id, name, email, role, join_date) VALUES
    ('mech-1', 'Mechanic', 'mech@example.invalid', 'mechanic', '2026-01-01'), ('admin-1', 'Reviewer', 'admin@example.invalid', 'admin', '2026-01-01')`);
  await db.query(`INSERT INTO organizations (id, name, type, created_at) VALUES ('org-1', 'Platform', 'government', '2026-01-01')`);
  await db.query(`INSERT INTO organization_roles (id, organization_id, name, level) VALUES ('role-1', 'org-1', 'admin', 1)`);
  await db.query(`INSERT INTO organization_users (id, organization_id, user_id, role_id, joined_at) VALUES ('ou-1', 'org-1', 'admin-1', 'role-1', '2026-01-01')`);
  await seedVehicle(db, 'OC4AAUDITVIN00001');
  const { rows: [log] } = await db.query(`INSERT INTO partsentry_logs (vin, mechanic_id, part_name, action_type, mileage, signature, timestamp)
    VALUES ('OC4AAUDITVIN00001', 'mech-1', 'Brake pads', 'Replaced', 43000, 'SIG', '2026-10-01T00:00:00Z') RETURNING id`);
  await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
  await db.exec('REVOKE INSERT ON trust_audit_events FROM service_role'); // the authoritative sink fails; the mirror does not

  await db.exec('SET ROLE service_role');
  let refused;
  try {
    refused = await capture(() => review.flagPartSentrySuspicion(client, { id: 'admin-1', role: 'admin' }, log.id, { suspicion_status: 'watch', reason: 'Odometer pattern' }));
  } finally {
    await db.exec('RESET ROLE');
  }
  assert.ok(refused.error, 'the governed change must not proceed');
  assert.match(refused.error.message, /Audit logging failed for PARTSENTRY_SUSPICION_FLAGGED/);
  const { rows: [after] } = await db.query('SELECT suspicion_status, public_card_eligible FROM partsentry_logs WHERE id = $1', [log.id]);
  assert.deepEqual(after, { suspicion_status: 'none', public_card_eligible: false }, 'the log was not changed');
  const { rows: mirrored } = await db.query(`SELECT action FROM organization_audit_logs WHERE action = 'PARTSENTRY_SUSPICION_FLAGGED'`);
  assert.equal(mirrored.length, 1, 'positive control: the mirror DID land — before OC-4A this counted as success and the change went through');
  const { rows: trail } = await db.query('SELECT count(*)::int AS n FROM trust_audit_events');
  assert.equal(trail[0].n, 0);
});

// ── OBSERVABILITY: visible in every environment ────────────────────────────────────────────────────

test('OC-4A 1.3 — a failed best-effort diaspora audit is logged IN PRODUCTION too (it used to be logged everywhere but production)', async () => {
  const failing = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'audit sink down', code: '08006' } }) }) }) }) };
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let outcome;
  try {
    outcome = await capture(() => appendBestEffortAudit(failing, { action: 'TRADE_GRAPH_PATH_QUERIED', resourceType: 'trade_graph_query', metadata: { steps: 2 } }));
  } finally {
    process.env.NODE_ENV = previous;
  }
  assert.equal(outcome.result, null, 'still best effort: the read is not failed');
  assert.ok(outcome.lines.warn.some((line) => line.includes('best-effort diaspora audit write failed') && line.includes('TRADE_GRAPH_PATH_QUERIED') && line.includes('trade_graph_query')), outcome.lines.warn.join('\n'));
  assert.ok(!outcome.lines.warn.join('\n').includes('"steps"'), 'metadata (row data) is not logged');
});

test('OC-4A 1.3 ledger checkpoint (INTEGRITY WITNESS) — a failed upsert is an error log, never "Created", and the committed event still verifies', async () => {
  const db = await createLedgerDatabase();
  opened.push(db);
  supabase.from = (table) => supabaseOver(db).from(table);
  const VIN = 'OC4ACHECKPOINT001';
  await seedVehicle(db, VIN);
  await db.exec(`CREATE FUNCTION oc4a_refuse_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'checkpoint sink down'; END $$;
                 CREATE TRIGGER oc4a_refuse_checkpoint BEFORE INSERT OR UPDATE ON rolling_integrity_checkpoints FOR EACH ROW EXECUTE FUNCTION oc4a_refuse_checkpoint();`);
  for (let i = 1; i <= 9; i += 1) await addEvent(VIN, 'SERVICE_LOG', { n: i }, 'SYSTEM_SIGNATURE', { signerId: 'system' });
  const tenth = await capture(() => addEvent(VIN, 'SERVICE_LOG', { n: 10 }, 'SYSTEM_SIGNATURE', { signerId: 'system' }));
  assert.equal(tenth.error, undefined, 'the event is committed; the witness is non-blocking');
  assert.ok(tenth.result.id);
  assert.ok(tenth.lines.error.some((line) => line.includes('rolling integrity checkpoint was NOT written') && line.includes(VIN)), tenth.lines.error.join('\n'));
  assert.ok(!tenth.lines.log.some((line) => line.includes('Created rolling integrity checkpoint')), 'success is claimed only when it happened');
  const { rows: [checkpoints] } = await db.query('SELECT count(*)::int AS n FROM rolling_integrity_checkpoints');
  assert.equal(checkpoints.n, 0);
  const verdict = await verifyChain(VIN);
  assert.equal(verdict.verified, true);
  assert.equal(verdict.count, 10);

  // Positive control: with the sink working, the witness is written and reported.
  await db.exec('DROP TRIGGER oc4a_refuse_checkpoint ON rolling_integrity_checkpoints');
  for (let i = 11; i <= 19; i += 1) await addEvent(VIN, 'SERVICE_LOG', { n: i }, 'SYSTEM_SIGNATURE', { signerId: 'system' });
  const twentieth = await capture(() => addEvent(VIN, 'SERVICE_LOG', { n: 20 }, 'SYSTEM_SIGNATURE', { signerId: 'system' }));
  assert.ok(twentieth.lines.log.some((line) => line.includes('Created rolling integrity checkpoint')));
  supabase.from = realFrom;
});

// ── BUSINESS HISTORY: chain of custody ─────────────────────────────────────────────────────────────

test('OC-4A 1.3 — a chain-of-custody event that cannot be written is an ERROR (the upload still succeeds, by the evidence domain\'s decision)', async () => {
  const db = await createLedgerDatabase();
  opened.push(db);
  const VIN = 'OC4APROVENANCE001';
  await seedVehicle(db, VIN);
  const evidenceId = await seedEvidence(db, VIN);
  await db.exec(`CREATE FUNCTION oc4a_refuse_provenance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'provenance sink down'; END $$;
                 CREATE TRIGGER oc4a_refuse_provenance BEFORE INSERT ON evidence_provenance_events FOR EACH ROW EXECUTE FUNCTION oc4a_refuse_provenance();`);
  const outcome = await capture(() => recordEvidenceUploadProvenance(supabaseOver(db), {
    evidence: { id: evidenceId, vin: VIN, evidence_class: 'inspection' }, req: { userContext: { id: 'user-1', role: 'owner' } },
  }));
  assert.equal(outcome.error, undefined, 'non-blocking: the upload is not failed by its custody event');
  assert.ok(outcome.lines.error.some((line) => line.includes('chain-of-custody event NOT recorded for an evidence upload') && line.includes(evidenceId)), outcome.lines.error.join('\n'));
  assert.equal(outcome.lines.warn.length, 0, 'an error, not a warning');
});

// ── the classification, pinned against the source ─────────────────────────────────────────────────

function runtimeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'tests', 'scripts'].includes(name) || name.startsWith('__mutant__')) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) out.push(path.relative(BACKEND, full));
    }
  };
  walk(BACKEND);
  return out;
}

test('OC-4A 1.3 pin — no audit or history writer in this classification fails silently any more', () => {
  const ingestion = read('services/ingestion/ingestionService.js');
  assert.doesNotMatch(ingestion, /catch \{\s*\/\* provenance is recorded best-effort/, 'the partner-import custody failure is no longer `catch {}`');
  assert.match(ingestion, /chain-of-custody event NOT recorded for a partner import/);
  assert.match(read('services/evidence/evidenceClassificationCorrectionService.js'), /chain-of-custody event NOT recorded for a classification correction/);
  assert.doesNotMatch(read('services/diaspora/diasporaServiceUtils.js'), /NODE_ENV !== 'production'/, 'best effort is visible in production');
  const exportService = read('services/diaspora/workbook/diasporaWorkbookDbExportService.js');
  assert.match(exportService, /throw new DatabaseError\(`Workbook export was not released/);
  assert.match(exportService, /supabaseClient: client,/, 'the export audit goes through the client the export read with');
  assert.match(read('services/blockchain/blockchainService.js'), /const \{ error: checkpointError \} = await db\.from\('rolling_integrity_checkpoints'\)\.upsert/);
  assert.match(read('services/identity/decisionRecorder.js'), /audit_recorded: auditRecorded/);
  assert.doesNotMatch(read('services/auditLogger.js'), /return \{ success: true, warning: error\.message/);
});

test('OC-4A 1.3 pin — LEGACY-DEAD: the trust-history writers cannot run in production', () => {
  const trustGraph = read('services/trustGraph/trustGraphService.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(trustGraph, /calculateVehicleTrustScore|recordTrustScoreHistory|trust_score_history/, 'retired');
  // TrustEnforcementEngine still holds two trust_score_history writes, but nothing at runtime imports it.
  const importers = runtimeFiles().filter((rel) => rel !== 'services/trust-service/trustEnforcementEngine.js'
    && /from ['"][./]+(?:services\/)?trust-service\/trustEnforcementEngine\.js['"]/.test(read(rel)));
  assert.deepEqual(importers, [], 'reviving TrustEnforcementEngine at runtime must revisit its unchecked trust_score_history writes');
  const writers = runtimeFiles().filter((rel) => read(rel).includes("from('trust_score_history')"));
  assert.deepEqual(writers, ['services/trust-service/trustEnforcementEngine.js']);
});
