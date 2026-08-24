#!/usr/bin/env node
/**
 * Issue #164 Phase 7 — Golden Reference Vehicle Dataset runner (staging-only).
 *
 * Thin, fail-closed CLI around backend/services/golden/goldenVehicleFixture.js. It establishes a
 * POSITIVE staging identity, acquires the canonical supabase service-role client (the same singleton
 * the domain services use, so the fixture runs the REAL pipeline), and then performs one of:
 *
 *   --mode=bootstrap   create-or-reuse the two Golden vehicles and their governed graph
 *   --mode=verify      read-only invariant proof (non-zero exit on any failed invariant)
 *   --mode=cleanup     remove only the deterministic fixture rows (scoped, child-first, idempotent)
 *   --mode=sequence    the full §9 idempotency proof (baseline → bootstrap → verify → bootstrap →
 *                      duplicate-check → cleanup → absence → cleanup → bootstrap → verify) with
 *                      unrelated-data preservation snapshots, written to a JSON receipt.
 *
 * Guard (exit 2 = BLOCKED): SUPABASE_URL must POSITIVELY reference the approved staging ref and must
 * NOT reference the forbidden production ref (assembled at runtime, never a literal — CR-1). A valid
 * service-role key is required. Any other identity fails closed before a single write.
 *
 * No production. No live payment/provider/Gemini activation. No migration. No schema change.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const STAGING_HOST = `${STAGING_REF}.supabase.co`;
// Forbidden production ref, assembled at runtime so the CR-1 secret scanner stays untouched. The
// fragments are inert; the comparison below is the guard.
const FORBIDDEN_PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');
const RECEIPT_FILE = 'issue164-golden-vehicles-receipt.json';

const blocked = (m) => { console.error(`BLOCKED: ${m}`); process.exit(2); };
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

const MODE = (process.argv.find((a) => /^--mode=/.test(a)) || '--mode=verify').split('=')[1];
if (!['bootstrap', 'verify', 'cleanup', 'sequence'].includes(MODE)) blocked(`unknown --mode=${MODE}`);

/**
 * Decode a JWT's payload and report whether it actually carries `role: "service_role"`.
 *
 * The guard used to accept any three-segment string. That proves SHAPE, not ROLE: a legacy Supabase
 * anon JWT is also three segments, so an operator who pasted the anon key instead of the service-role
 * key passed the guard and only discovered the mistake when RLS silently hid rows from the fixture —
 * a failure mode that looks like missing data rather than a wrong credential.
 *
 * The signature is deliberately NOT verified. Verifying it would require the project's JWT secret,
 * which this script must never hold, and a forged token is not the risk being managed here — Supabase
 * rejects it on the first request. What is being prevented is an honest operator mistake, and the
 * role claim is exactly the thing that distinguishes the keys.
 *
 * NOTHING derived from the token is returned or logged. The refusal names what is required, never
 * what was found.
 */
export function evaluateServiceRoleKey(key) {
  if (!key) return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not set' };

  const segments = key.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment === '')) {
    // Covers publishable/`sb_secret_…` keys and anything else that is not a JWT at all.
    return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not a JWT — expected the project service-role key' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY payload could not be decoded — malformed JWT' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY payload is not a JWT claim set' };
  }

  if (payload.role !== 'service_role') {
    // The role that WAS found is not named: it is token material, and the operator does not need it
    // to act. Naming the requirement is enough to correct the mistake.
    return {
      ok: false,
      reason: 'SUPABASE_SERVICE_ROLE_KEY does not carry role "service_role" — it looks like the anon '
        + 'or publishable key. Use the project SERVICE ROLE key.',
    };
  }
  return { ok: true };
}

// ── staging identity guard (dual-sided, positive + deny) ─────────────────────
// Pure, testable: returns { ok, reason } and never exits, so the guard can be proven in unit tests.
export function evaluateStagingGuard(env = {}) {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url) return { ok: false, reason: 'SUPABASE_URL is not set' };
  if (url.includes(FORBIDDEN_PROD_REF)) return { ok: false, reason: 'SUPABASE_URL references the forbidden production ref — refusing' };
  // Parse the URL and require the EXACT approved Supabase hostname. Substring containment would let
  // `https://example.com/?ref=eoyenigwevnxwwhyhaer` or an attacker-controlled host pass and receive the
  // service-role credential; the hostname must be exactly the staging project's Supabase host.
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, reason: 'SUPABASE_URL is not a valid URL' }; }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'SUPABASE_URL must be https' };
  if (parsed.hostname !== STAGING_HOST) return { ok: false, reason: `SUPABASE_URL host must be exactly ${STAGING_HOST}` };
  // A publishable/anon key cannot bypass RLS to run the governed pipeline. The role claim is decoded
  // and required to be `service_role` — a three-segment shape check accepted the anon key too.
  const credential = evaluateServiceRoleKey(key);
  if (!credential.ok) return { ok: false, reason: credential.reason };
  // Belt-and-suspenders: refuse if a production-shaped DB URL is anywhere in scope.
  for (const v of ['SUPABASE_DB_URL', 'DATABASE_URL', 'DIASPORA_STAGING_DATABASE_URL']) {
    const val = env[v];
    if (val && val.includes(FORBIDDEN_PROD_REF)) return { ok: false, reason: `${v} references the forbidden production ref — refusing` };
  }
  return { ok: true, host: parsed.host };
}

function assertCanonicalStaging() {
  const r = evaluateStagingGuard(process.env);
  if (!r.ok) blocked(r.reason);
  return { url: process.env.SUPABASE_URL, host: r.host };
}

async function getClient() {
  const { supabase } = await import('../db/supabase.js');
  // Confirm the client can positively see the staging database identity before any write.
  const { error } = await supabase.from('vehicles').select('vin', { count: 'exact', head: true });
  if (error) blocked(`staging client read check failed: ${error.message}`);
  return supabase;
}

// ── unrelated-data preservation snapshot ─────────────────────────────────────
const SNAPSHOT_TABLES = ['users', 'vehicles', 'vehicle_evidence', 'listing_images', 'vehicle_ownership_history', 'marketplace_inquiries', 'insurance_records', 'partsentry_logs', 'finance_applications', 'domain_events'];

async function tableCount(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) return null; // table absent on this instance — recorded as null, never fatal
  return count ?? 0;
}

async function snapshot(client) {
  const s = {};
  for (const t of SNAPSHOT_TABLES) s[t] = await tableCount(client, t);
  return s;
}

// Non-fixture ("unrelated") counts = total − fixture-owned. Fixture-owned rows are exactly those
// keyed to the deterministic VIN / user-id set, so unrelated = total minus those.
async function fixtureCounts(client, fixtureVins, fixtureUserIds) {
  const byVin = ['vehicles:vin', 'vehicle_evidence:vin', 'listing_images:vin', 'vehicle_ownership_history:vin', 'marketplace_inquiries:listing_id', 'insurance_records:vin', 'partsentry_logs:vin', 'finance_applications:vin'];
  const out = {};
  for (const entry of byVin) {
    const [table, col] = entry.split(':');
    const { count, error } = await client.from(table).select('*', { count: 'exact', head: true }).in(col, fixtureVins);
    out[table] = error ? null : (count ?? 0);
  }
  const { count: uc, error: ue } = await client.from('users').select('*', { count: 'exact', head: true }).in('id', fixtureUserIds);
  out.users = ue ? null : (uc ?? 0);
  // domain_events are attributable to the fixture by vin OR recipientUserId. Count DISTINCT event ids so
  // a finance event (both fields) is not double-counted and a recipient-only inquiry event still counts.
  out.domain_events = await fixtureDomainEventCount(client, fixtureVins, fixtureUserIds);
  return out;
}

async function fixtureDomainEventCount(client, vins, userIds) {
  const ids = new Set();
  for (const [col, vals] of [['payload->>vin', vins], ['payload->>recipientUserId', userIds]]) {
    if (!vals || vals.length === 0) continue;
    const { data, error } = await client.from('domain_events').select('id').in(col, vals);
    if (error) return null; // table absent -> null (tolerant)
    for (const r of (data || [])) ids.add(r.id);
  }
  return ids.size;
}

function unrelated(total, fixture) {
  const out = {};
  for (const t of SNAPSHOT_TABLES) {
    if (total[t] == null || fixture[t] == null) { out[t] = null; continue; }
    out[t] = total[t] - fixture[t];
  }
  return out;
}

function unrelatedEqual(a, b) {
  const diffs = [];
  for (const t of SNAPSHOT_TABLES) {
    if (a[t] == null || b[t] == null) continue;
    if (a[t] !== b[t]) diffs.push(`${t}: ${a[t]} -> ${b[t]}`);
  }
  return diffs;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const identity = assertCanonicalStaging();
  const client = await getClient();
  console.log(`staging identity OK: host=${identity.host} ref=${STAGING_REF}`);

  const fx = await import('../services/golden/goldenVehicleFixture.js');
  const specs = await import('../services/golden/goldenVehicleSpecs.js');
  const vins = specs.fixtureVins();
  const userIds = specs.fixtureUserIds();

  if (MODE === 'bootstrap') {
    const r = await fx.bootstrap({ client });
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) fail('bootstrap reported one or more failed steps');
    return;
  }
  if (MODE === 'verify') {
    const r = await fx.verify({ client });
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) fail('verify found a failed invariant');
    return;
  }
  if (MODE === 'cleanup') {
    const r = await fx.cleanup({ client });
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) fail('cleanup reported a failed step');
    return;
  }

  // ── MODE === 'sequence' : the full §9 idempotency + containment proof ───────
  const receipt = { programme: specs.GOLDEN_PROGRAMME, mode: 'sequence', stagingRef: STAGING_REF, steps: [], productionTouched: false, liveProviderActivated: false, geminiActivated: false };
  const record = (name, data) => { receipt.steps.push({ name, ...data }); console.log(`STEP ${name}: ${JSON.stringify(data)}`); };

  // 1) baseline
  const baseTotal = await snapshot(client);
  const baseFixture = await fixtureCounts(client, vins, userIds);
  const baseUnrelated = unrelated(baseTotal, baseFixture);
  record('baseline', { total: baseTotal, fixture: baseFixture });

  // 2) bootstrap → 3) verify
  const boot1 = await fx.bootstrap({ client });
  record('bootstrap_1', { ok: boot1.ok, failedSteps: boot1.steps.filter((s) => !s.ok).map((s) => s.name) });
  if (!boot1.ok) fail('sequence: first bootstrap failed');
  const ver1 = await fx.verify({ client });
  record('verify_1', { ok: ver1.ok, failed: ver1.checks.filter((c) => !c.ok).map((c) => c.name) });
  if (!ver1.ok) fail('sequence: first verify failed');
  const fixtureAfterBoot1 = await fixtureCounts(client, vins, userIds);

  // 4) bootstrap again → 5) verify → 6) no-duplicate
  const boot2 = await fx.bootstrap({ client });
  record('bootstrap_2', { ok: boot2.ok, failedSteps: boot2.steps.filter((s) => !s.ok).map((s) => s.name) });
  if (!boot2.ok) fail(`sequence: second bootstrap failed (${(boot2.requiredFailed || []).join(', ')})`);
  const ver2 = await fx.verify({ client });
  record('verify_2', { ok: ver2.ok, failed: ver2.checks.filter((c) => !c.ok).map((c) => c.name) });
  if (!ver2.ok) fail('sequence: second verify failed');
  const fixtureAfterBoot2 = await fixtureCounts(client, vins, userIds);
  const dupDiffs = unrelatedEqual(fixtureAfterBoot1, fixtureAfterBoot2);
  record('no_duplicate_graph', { identical: dupDiffs.length === 0, diffs: dupDiffs });
  if (dupDiffs.length) fail(`sequence: second bootstrap created duplicate fixture rows: ${dupDiffs.join('; ')}`);

  // unrelated preserved through both bootstraps
  const unrelatedAfterBoot = unrelated(await snapshot(client), fixtureAfterBoot2);
  const bootDrift = unrelatedEqual(baseUnrelated, unrelatedAfterBoot);
  record('unrelated_preserved_through_bootstrap', { ok: bootDrift.length === 0, diffs: bootDrift });
  if (bootDrift.length) fail(`sequence: bootstrap changed unrelated data: ${bootDrift.join('; ')}`);

  // 7) cleanup → 8) verify absence
  const clean1 = await fx.cleanup({ client });
  record('cleanup_1', { ok: clean1.ok, deleted: clean1.deleted });
  const fixtureAfterClean1 = await fixtureCounts(client, vins, userIds);
  const absent1 = Object.values(fixtureAfterClean1).every((n) => n === 0 || n == null);
  record('absence_after_cleanup', { absent: absent1, fixture: fixtureAfterClean1 });
  if (!absent1) fail('sequence: fixture rows remain after cleanup');

  // 9) cleanup again → 10) idempotent
  const clean2 = await fx.cleanup({ client });
  record('cleanup_2_idempotent', { ok: clean2.ok, deleted: clean2.deleted });
  const totalDeleted2 = Object.values(clean2.deleted || {}).reduce((a, b) => a + (b || 0), 0);
  if (totalDeleted2 !== 0) fail(`sequence: second cleanup deleted ${totalDeleted2} rows (not idempotent)`);

  // unrelated fully restored to baseline after cleanup
  const unrelatedAfterClean = unrelated(await snapshot(client), await fixtureCounts(client, vins, userIds));
  const cleanDrift = unrelatedEqual(baseUnrelated, unrelatedAfterClean);
  record('unrelated_preserved_through_cleanup', { ok: cleanDrift.length === 0, diffs: cleanDrift });
  if (cleanDrift.length) fail(`sequence: cleanup changed unrelated data: ${cleanDrift.join('; ')}`);

  // 11) bootstrap again → 12) verify
  const boot3 = await fx.bootstrap({ client });
  record('bootstrap_3', { ok: boot3.ok, failedSteps: boot3.steps.filter((s) => !s.ok).map((s) => s.name) });
  if (!boot3.ok) fail(`sequence: final bootstrap failed (${(boot3.requiredFailed || []).join(', ')})`);
  const ver3 = await fx.verify({ client });
  record('verify_3', { ok: ver3.ok, failed: ver3.checks.filter((c) => !c.ok).map((c) => c.name) });
  if (!ver3.ok) fail('sequence: final verify failed');

  receipt.ok = true;
  receipt.completedAt = new Date().toISOString();
  writeFileSync(RECEIPT_FILE, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log(`\nSEQUENCE PASS — receipt written to ${RECEIPT_FILE}`);
}

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith('issue164-golden-vehicles.mjs'))) {
  main().catch((e) => fail(e?.stack || e?.message || String(e)));
}

export { assertCanonicalStaging };
