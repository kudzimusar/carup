/**
 * OC-3B — AI authority invariants, SCOPED to the files actually scanned.
 *
 * AI in CarUp observes; governed humans and domain services decide. These tests make that
 * structural for one explicit set of source files — the AI SCOPE below — and claim nothing about
 * any file outside it. Every scan:
 *   - asserts it read a non-zero number of files and found writes at all (anti-vacuity), and
 *   - runs the SAME detector over non-AI modules / a fixture and asserts it FINDS the sink there
 *     (positive control), so an invariant cannot pass because the detector is blind.
 *
 * Detector limits (stated, not hidden): it recognises Supabase query-builder writes
 * (`.from(<literal | module const | identifier>).insert|update|upsert|delete(...)`), raw SQL
 * `INSERT INTO / UPDATE / DELETE FROM`, and `.rpc(` calls, in the file text. A write performed by a
 * module the scope IMPORTS is outside this scan (the imported module is not in scope unless listed).
 * Behavioural HTTP proofs of the same invariants live in:
 *   oc3b-ledger-integrity-containment.test.js, oc3b-ai-provider-failure-contract.test.js,
 *   oc3b-truthful-ai-simulation.test.js, evidence-ai-fraud.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, '..');
const read = (rel) => readFileSync(resolve(BACKEND, rel), 'utf8');

function walkJs(relDir) {
  const out = [];
  const abs = resolve(BACKEND, relDir);
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...walkJs(relative(BACKEND, p)));
    else if (name.endsWith('.js')) out.push(relative(BACKEND, p));
  }
  return out;
}

// ── THE AI SCOPE ──────────────────────────────────────────────────────────────────────────────
// Whole files, plus ONE function fragment (evidenceService.runAiAnalysis — the rest of that module
// is the governed evidence service, which legitimately writes verification_status).
const AI_SCOPE_FILES = [
  ...walkJs('services/ai'),
  'services/marketplace/marketplaceAiAssistantService.js',
  'services/communication/communicationAiProviderFactory.js',
  'services/communication/communicationAiRuntimeService.js',
  'services/communication/communicationAiService.js',
  'services/document-intelligence/documentIntelligenceService.js',
  'services/identity/documentClassifier.js',
].sort();

function runAiAnalysisFragment() {
  const src = read('services/evidence/evidenceService.js');
  const start = src.indexOf('export async function runAiAnalysis(');
  assert.ok(start > 0, 'runAiAnalysis located');
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next > 0 ? next : undefined);
}

const AI_SCOPE = [
  ...AI_SCOPE_FILES.map((rel) => ({ name: rel, src: read(rel) })),
  { name: 'services/evidence/evidenceService.js#runAiAnalysis', src: runAiAnalysisFragment() },
];

// ── detector ──────────────────────────────────────────────────────────────────────────────────
function moduleStringConstants(src) {
  const map = new Map();
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([a-z_][a-z0-9_]*)['"`]/g)) map.set(m[1], m[2]);
  return map;
}

/** Every table write the file text performs: { table, op, payload } (payload = statement text after the op). */
export function tableWrites(src) {
  const consts = moduleStringConstants(src);
  const out = [];
  const re = /\.from\(\s*(?:(['"`])([a-z_][a-z0-9_]*)\1|([A-Za-z_$][\w$]*))\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const table = m[2] || consts.get(m[3]) || `DYNAMIC:${m[3]}`;
    let seg = src.slice(re.lastIndex, re.lastIndex + 2000);
    const nextFrom = seg.search(/\.from\(/);
    if (nextFrom >= 0) seg = seg.slice(0, nextFrom);
    const semi = seg.indexOf(';');
    if (semi >= 0) seg = seg.slice(0, semi);
    const op = seg.match(/\.(insert|update|upsert|delete)\(/);
    if (op) out.push({ table, op: op[1], payload: seg.slice(op.index) });
  }
  for (const s of src.matchAll(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:public\.)?([a-z_][a-z0-9_]*)/g)) {
    out.push({ table: s[2], op: 'sql', payload: '' });
  }
  return out;
}

/** Source with comments removed, so a test reads CODE — comments here document the old defects by name. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const rpcCalls = (src) => [...src.matchAll(/\.rpc\(\s*['"`]([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);

// DI's one dynamic write (`supabase.from(table).insert(row)`) resolves through the structured-table
// declarations in documentSchemas.js (read here, not modified).
const DI_STRUCTURED_TABLES = [...read('services/document-intelligence/documentSchemas.js').matchAll(/table:\s*'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]);

const SCOPE_WRITES = AI_SCOPE.flatMap(({ name, src }) => tableWrites(src).flatMap((w) => (
  w.table === 'DYNAMIC:table' && name.endsWith('documentIntelligenceService.js')
    ? DI_STRUCTURED_TABLES.map((table) => ({ ...w, table, file: name }))
    : [{ ...w, file: name }]
)));

// Authority sinks no AI module may write.
const FORBIDDEN_TABLES = [
  /^vehicles$/, /^vehicle_ownership/, /^cvr_ownership_records$/, /^zimra_declarations$/,
  /^verification_sessions$/, /^users$/, /^kyc_profiles$/, /^identity_/, /^trust_/, /^vehicle_trust/,
  /^canonical_trust/, /^trust_fact/, /^partsentry_/, /^marketplace_listings$/, /^listing_/,
  /^seller_/, /^administrative_overrides$/,
];
// vehicle_evidence columns that ARE the governed review decision.
const FORBIDDEN_EVIDENCE_COLUMNS = /\b(verification_status|trust_score_impact|trust_impact|visibility_level|reviewed_by|reviewed_at|verified_by|verified_at)\b/;

// The complete set of tables the AI scope writes today. A new AI write must be added here
// deliberately, in review — not appear silently.
const AI_WRITE_ALLOWLIST = new Set([
  'ai_inference_logs', 'ai_fraud_scans', 'ai_analysis_jobs', 'ai_observations',
  'ocr_documents', ...DI_STRUCTURED_TABLES, 'verification_assessments', 'vehicle_evidence',
]);

// ── anti-vacuity + positive controls ──────────────────────────────────────────────────────────

test('OC-3B invariants [scope]: the AI scope is non-empty and the detector finds its writes', () => {
  assert.ok(AI_SCOPE_FILES.length >= 15, `scanned ${AI_SCOPE_FILES.length} whole files`);
  for (const must of ['services/ai/aiServiceBus.js', 'services/ai/analysisJobService.js', 'services/ai/GeminiClient.js', 'services/ai/aiVisionProvider.js']) {
    assert.ok(AI_SCOPE_FILES.includes(must), `${must} is in scope`);
  }
  const tables = new Set(SCOPE_WRITES.map((w) => w.table));
  for (const t of ['ai_fraud_scans', 'ai_analysis_jobs', 'ocr_documents', 'vehicle_evidence']) {
    assert.ok(tables.has(t), `anti-vacuity: the detector sees the scope's own write to ${t}`);
  }
  assert.ok(DI_STRUCTURED_TABLES.length >= 3, 'DI structured tables resolved');
});

test('OC-3B invariants [positive control]: the same detector FINDS every sink class in non-AI modules / a fixture', () => {
  const found = (rel, table, payloadPattern) => tableWrites(read(rel)).some((w) => w.table === table && (!payloadPattern || payloadPattern.test(w.payload)));
  assert.ok(found('routes/vehiclesRoutes.js', 'vehicle_evidence', /verification_status/), 'evidence review decision write detected');
  assert.ok(found('routes/vehiclesRoutes.js', 'vehicles'), 'vehicles write detected');
  assert.ok(found('server.js', 'vehicle_ownership_history'), 'ownership write detected');
  assert.ok(found('services/identity/verificationSessionService.js', 'verification_sessions'), 'verification session write detected');
  assert.ok(found('server.js', 'users'), 'users write detected');
  // No backend module writes the registry tables today, so the detector is proven on a fixture.
  const fixture = `
    const T = 'zimra_declarations';
    await supabase.from('cvr_ownership_records').insert({ vin });
    await supabase.from(T).upsert(row);
    await db.query("UPDATE vehicles SET trust_score = 99");
    await supabase.rpc('approve_listing', {});`;
  const fx = tableWrites(fixture).map((w) => w.table);
  for (const t of ['cvr_ownership_records', 'zimra_declarations', 'vehicles']) assert.ok(fx.includes(t), `fixture ${t}`);
  assert.deepEqual(rpcCalls(fixture), ['approve_listing']);
  // A forbidden match on the fixture proves the forbidden list itself is live.
  assert.ok(fx.some((t) => FORBIDDEN_TABLES.some((re) => re.test(t))));
});

// ── the invariants ────────────────────────────────────────────────────────────────────────────

test('OC-3B invariants [AI scope only]: no AI-scope file writes vehicles, ownership, registry, identity, trust, PartSentry or listing tables', () => {
  const violations = SCOPE_WRITES.filter((w) => FORBIDDEN_TABLES.some((re) => re.test(w.table)));
  assert.deepEqual(violations.map((w) => `${w.file}: ${w.op} ${w.table}`), []);
});

test('OC-3B invariants [AI scope only]: every AI-scope write targets a reviewed allow-listed table (no unresolved dynamic writes)', () => {
  const unknown = SCOPE_WRITES.filter((w) => !AI_WRITE_ALLOWLIST.has(w.table));
  assert.deepEqual(unknown.map((w) => `${w.file}: ${w.op} ${w.table}`), []);
});

test('OC-3B invariants [AI scope only]: AI writes to vehicle_evidence touch metadata only — never the review decision columns', () => {
  const evidenceWrites = SCOPE_WRITES.filter((w) => w.table === 'vehicle_evidence');
  assert.ok(evidenceWrites.length >= 1, 'anti-vacuity: runAiAnalysis evidence writes scanned');
  for (const w of evidenceWrites) {
    assert.doesNotMatch(w.payload, FORBIDDEN_EVIDENCE_COLUMNS, `${w.file}: ${w.payload.slice(0, 120)}`);
    assert.match(w.payload, /metadata/, `${w.file}: the AI write is to metadata`);
  }
});

test('OC-3B invariants [AI scope only]: no AI-scope file calls a database RPC', () => {
  const calls = AI_SCOPE.flatMap(({ name, src }) => rpcCalls(src).map((rpc) => `${name}: ${rpc}`));
  assert.deepEqual(calls, []);
});

test('OC-3B invariants [aiServiceBus, GeminiClient, evidenceService#runAiAnalysis]: no failure path defaults to a favorable verdict', () => {
  const bus = code(read('services/ai/aiServiceBus.js'));
  assert.doesNotMatch(bus, /riskRating\s*\|\|\s*'Low'/, 'no "Low" by absence');
  assert.doesNotMatch(bus, /:\s*'Low'\s*;/, 'no "Low" fallback in a ternary');
  assert.doesNotMatch(bus, /recommendedPremium|premium\s*:/i, 'no premium figure produced or passed on');
  const client = code(read('services/ai/GeminiClient.js'));
  assert.doesNotMatch(client, /return JSON\.stringify\(\{\s*error:\s*true/, 'no success-shaped failure envelope');
  assert.match(client, /class AiProviderError extends Error/);
  const fragment = runAiAnalysisFragment();
  const failure = fragment.slice(fragment.indexOf('catch (err)'));
  assert.ok(failure.length > 50, 'anti-vacuity: the failure path was located');
  assert.doesNotMatch(failure, /'approve'|'ai_passed'|public_safe_summary:\s*'/, 'the failure result recommends nothing favorable');
});

/**
 * OC-3B-R: a scripted AI scenario (`metadata.mock_ai_scenario`) exists only in the test-fixture
 * runtime — NODE_ENV=test AND ALLOW_OCR_MOCK=true (config/testFixtureGuard.js). The cases that
 * drive one opt in explicitly, so they still exercise it when the offline gate runs this suite
 * with ALLOW_OCR_MOCK=false; the opt-in is restored when the case ends.
 */
function useFixtureRuntime(t) {
  const saved = process.env.ALLOW_OCR_MOCK;
  process.env.ALLOW_OCR_MOCK = 'true';
  t.after(() => { if (saved === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = saved; });
}

test('OC-3B invariants [evidenceService#runAiAnalysis, behavioural]: a provider failure is stored with no risk figure and an inspection recommendation', async (t) => {
  useFixtureRuntime(t); // the failure is forced with the 'provider_error' fixture
  const { supabase } = await import('../db/supabase.js');
  const { runAiAnalysis } = await import('../services/evidence/evidenceService.js');
  const row = { id: 'ev-fail', vin: 'VIN1', checksum: null, metadata: {} };
  const updates = [];
  const realFrom = supabase.from;
  supabase.from = () => {
    let payload = null;
    const q = {
      select() { return q; }, eq() { return q; }, neq() { return q; }, limit() { return q; },
      update(p) { payload = p; return q; },
      single() { return Promise.resolve({ data: row, error: null }); },
      then(res, rej) { if (payload) { updates.push(payload); Object.assign(row, payload); } return Promise.resolve({ data: [], error: null }).then(res, rej); },
    };
    return q;
  };
  try {
    await runAiAnalysis('ev-fail', Buffer.from('x'), 'image/png', 'damage_photo', { mock_ai_scenario: 'provider_error' });
  } finally {
    supabase.from = realFrom;
  }
  const stored = updates.at(-1).metadata.ai_analysis;
  assert.equal(stored.ai_status, 'ai_provider_unavailable');
  assert.equal(stored.recommended_action, 'inspect');
  assert.equal(stored.risk_score, null, 'a failed analysis states no risk figure (it used to store 0.1 — "low risk")');
  assert.equal(stored.public_safe_summary ?? null, null);
  for (const u of updates) assert.deepEqual(Object.keys(u), ['metadata'], 'only metadata is written');
});

test('OC-3B invariants [aiVisionProvider, analysisProvider]: a simulator cannot carry a real provider label', () => {
  for (const rel of ['services/ai/aiVisionProvider.js', 'services/ai/analysisProvider.js']) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /provider:\s*'(gemini|cloudflare|openai|anthropic|qwen)'/i, `${rel}: no hard-coded real provider label`);
    assert.doesNotMatch(src, /id:\s*'gemini'/, `${rel}: no provider id claiming Gemini`);
  }
  assert.match(read('services/ai/aiVisionProvider.js'), /provider:\s*'simulated'/, 'positive: the simulator names itself');
});

test('OC-3B invariants [server.js + routes/*.js]: verifyChain output leaves only through the integrity projection or the passport redaction', () => {
  const files = ['server.js', ...walkJs('routes')];
  const sites = files.flatMap((rel) => {
    const src = read(rel);
    return [...src.matchAll(/await verifyChain\(/g)].map((m) => {
      const named = [...src.slice(0, m.index).matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
      return { rel, ctx: src.slice(m.index, m.index + 200), enclosingNamedFunction: named.at(-1)?.[1] || null };
    });
  });
  assert.ok(sites.length >= 2, `anti-vacuity: ${sites.length} verifyChain call sites found`);
  for (const site of sites) {
    const isLedgerRoute = /toLedgerIntegrityReport\(vin, report\)/.test(site.ctx);
    // The passport builder's own body redacts chain[] for unauthorised callers (asserted below).
    const isPassport = site.enclosingNamedFunction === 'buildVehiclePassport' && !/res\.json/.test(site.ctx);
    assert.ok(isLedgerRoute || isPassport, `${site.rel}: unreviewed verifyChain exit: ${site.ctx.slice(0, 80)}`);
  }
  const server = read('server.js');
  assert.match(server, /verify-ledger', authorizeSessionRole\(\), requireVehicleObjectAuthority\(\)/, 'the ledger route is session + object-authority gated');
  assert.match(server, /chainVerification: isAuthorized\s*\?\s*chainVerification\s*:\s*\{ verified: chainVerification\.verified, count: chainVerification\.count, chain: \[\] \}/,
    'the passport keeps withholding chain[] from unauthorised callers');
});
