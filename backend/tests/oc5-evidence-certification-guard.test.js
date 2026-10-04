/**
 * OC-5 Phase 0 — the evidence certification ladder rejects impossible promotions.
 *
 * Positive and negative cases for every rule in docs/one-carup/ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md,
 * then the repository's own manifest through the same CLI CI runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { validateReceipt, validateManifest, scanDocumentsForUnsupportedClaims, LEVELS } = await import('../../scripts/ci/evidence-certification-guard.mjs');

const SHA = 'a'.repeat(40);
const base = (overrides = {}) => ({
  id: 'r1', phase: 'OC-5A', capability: 'partsentry.service_authority', sha: SHA,
  level: 'SOURCE-CERTIFIED', environment: 'local', proof_mechanism: 'node:test through the shipped app',
  provider: null, database: null, mocked_provider: false, mocked_components: [],
  claims: [], evidence: {}, remaining: ['DATABASE-CERTIFIED', 'DEPLOYED-CERTIFIED', 'OWNER-UAT-CERTIFIED'],
  recorded_at: '2026-10-04T12:00:00Z', ...overrides,
});
const live = (overrides = {}) => base({
  capability: 'ai.general.gemma_gateway', level: 'LIVE-PROVIDER-CERTIFIED', environment: 'staging',
  provider: { name: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', mocked: false },
  evidence: { request_class: 'advisory fraud scan (fake VIN)', execution_evidence: 'cf-ray abc; 412 ms; 96 tokens', result: 'advisory:true', executed_at: '2026-10-04T12:00:00Z' },
  remaining: ['DEPLOYED-CERTIFIED', 'OWNER-UAT-CERTIFIED'], ...overrides,
});
const deployed = (overrides = {}) => base({
  level: 'DEPLOYED-CERTIFIED', environment: 'staging', remaining: ['OWNER-UAT-CERTIFIED'],
  evidence: { deployed_sha: SHA, frontend_deployment: 'dpl_web', backend_deployment: 'dpl_api', runtime_configuration: 'health: ocr cloudflare/qwen, mock false', database_target: 'carup-staging', route_behavior: 'verify-ledger 401 anonymous' },
  ...overrides,
});
const reject = (receipt, pattern) => {
  const v = validateReceipt(receipt);
  assert.ok(v.some((m) => pattern.test(m)), `expected a violation matching ${pattern}; got ${JSON.stringify(v)}`);
};
const accept = (receipt) => assert.deepEqual(validateReceipt(receipt), []);

test('levels are exactly the five, in order', () => {
  assert.deepEqual([...LEVELS], ['SOURCE-CERTIFIED', 'DATABASE-CERTIFIED', 'LIVE-PROVIDER-CERTIFIED', 'DEPLOYED-CERTIFIED', 'OWNER-UAT-CERTIFIED']);
});

test('SOURCE with an intercepted provider is valid — mocks are allowed for source proof', () => {
  accept(base({ mocked_provider: true, mocked_components: ['Cloudflare Workers AI transport (intercepted at fetch)'], provider: { name: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', mocked: true } }));
});

test('IMPOSSIBLE: a mocked provider at LIVE-PROVIDER level or higher', () => {
  reject(live({ mocked_provider: true }), /mocked or intercepted provider can never establish LIVE-PROVIDER/);
  reject(live({ provider: { name: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', mocked: true } }), /requires a real provider call/);
  reject(deployed({ mocked_components: ['provider transport intercepted'] }), /can never establish DEPLOYED/);
  accept(live());
});

test('IMPOSSIBLE: a localhost / CI / test environment at DEPLOYED or OWNER-UAT', () => {
  for (const environment of ['localhost', 'local', 'ci', 'test', 'sandbox']) {
    reject(deployed({ environment }), new RegExp(`environment "${environment}" can never establish DEPLOYED`));
  }
  reject(base({ level: 'OWNER-UAT-CERTIFIED', environment: 'ci', remaining: [], evidence: { owner_attestation: { actor_type: 'human', name: 'O', role: 'owner', attested_at: '2026-10-04T12:00:00Z', record: 'x' } } }), /can never establish OWNER-UAT/);
  accept(deployed());
});

test('LIVE-PROVIDER needs its full non-secret receipt, and never production', () => {
  for (const field of ['request_class', 'execution_evidence', 'result', 'executed_at']) {
    const { [field]: _omit, ...rest } = live().evidence;
    reject(live({ evidence: rest }), new RegExp(`requires evidence\\.${field}`));
  }
  reject(live({ provider: null }), /requires provider\.name and provider\.model/);
  reject(live({ environment: 'production' }), /no live-provider certification may run against production/);
});

test('DEPLOYED needs pairing, configuration, database and routes — at the receipt SHA', () => {
  for (const field of ['deployed_sha', 'frontend_deployment', 'backend_deployment', 'runtime_configuration', 'database_target', 'route_behavior']) {
    const { [field]: _omit, ...rest } = deployed().evidence;
    reject(deployed({ evidence: rest }), new RegExp(`requires evidence\\.${field}`));
  }
  reject(deployed({ evidence: { ...deployed().evidence, deployed_sha: 'b'.repeat(40) } }), /deployed_sha must equal the receipt sha/);
});

test('OWNER-UAT cannot be manufactured by automation', () => {
  const uat = (attestation) => base({ level: 'OWNER-UAT-CERTIFIED', environment: 'staging', remaining: [], evidence: { owner_attestation: attestation } });
  reject(uat({ actor_type: 'automation', name: 'ci-bot', role: 'owner', attested_at: '2026-10-04T12:00:00Z', record: 'run 1' }), /requires a human owner attestation/);
  reject(uat({ actor_type: 'human', role: 'owner', attested_at: '2026-10-04T12:00:00Z', record: 'x' }), /owner_attestation\.name/);
  accept(uat({ actor_type: 'human', name: 'Product Owner', role: 'owner', attested_at: '2026-10-04T12:00:00Z', record: 'signed UAT record #12' }));
});

test('DATABASE means disposable PostgreSQL running repository migrations — never real CarUp Supabase', () => {
  const db = (database) => base({ level: 'DATABASE-CERTIFIED', remaining: ['DEPLOYED-CERTIFIED', 'OWNER-UAT-CERTIFIED'], database });
  accept(db({ engine: 'pglite', migrations: ['20261004160000_x.sql'] }));
  reject(db({ engine: 'supabase', migrations: ['x.sql'] }), /engine pglite or postgres-disposable/);
  reject(db({ engine: 'pglite', migrations: [] }), /requires the repository migrations/);
  reject(db({ engine: 'pglite', migrations: ['x.sql'], note: 'checked against eoyenigwevnxwwhyhaer' }), /never the real CarUp Supabase/);
});

test('authority facts are never established by mocked or below-live evidence', () => {
  for (const claim of ['Trust verified', 'Identity verified', 'document genuine', 'registry genuine', 'fraud cleared', 'vehicle genuine', 'insurance approved', 'finance approved', 'payment released', 'listing approved', 'biometric match']) {
    reject(base({ claims: [claim] }), /authority fact that this evidence cannot establish/);
  }
  accept(base({ claims: ['an unverified actor is refused with 403 and no row is written'] }));
});

test('provider-quality claims need a real run of that exact model', () => {
  reject(base({ claims: ['Gemma certified'] }), /requires a real LIVE-PROVIDER run of that model/);
  reject(live({ claims: ['Qwen certified'] }), /requires a real LIVE-PROVIDER run of that model/, 'a Gemma run cannot certify Qwen');
  accept(live({ claims: ['Gemma certified for the advisory fraud-scan request class'] }));
});

test('remaining lists only HIGHER levels, and the SHA is exact', () => {
  reject(base({ level: 'DATABASE-CERTIFIED', database: { engine: 'pglite', migrations: ['x.sql'] }, remaining: ['SOURCE-CERTIFIED'] }), /not above DATABASE-CERTIFIED/);
  reject(base({ sha: 'abc1234' }), /exact 40-hex commit/);
  reject(base({ mocked_components: undefined }), /mocked_components must be declared/);
});

test('git provenance: the SHA must be an ancestor of HEAD', () => {
  const v = validateReceipt(base(), { gitCheck: () => 'sha aaaaaaaaaaaa is not an ancestor of HEAD — evidence must come from this lineage' });
  assert.ok(v.some((m) => /not an ancestor of HEAD/.test(m)));
});

test('the ladder: PASS needs a valid receipt of THAT level — evidence from another level never fills it', () => {
  const row = (cells) => ({ 'SOURCE-CERTIFIED': 'PENDING', 'DATABASE-CERTIFIED': 'PENDING', 'LIVE-PROVIDER-CERTIFIED': 'N/A', 'DEPLOYED-CERTIFIED': 'PENDING', 'OWNER-UAT-CERTIFIED': 'PENDING', ...cells });
  const manifest = (receipts, cells) => ({ schema: 'carup.evidence_certification.v1', programme: 'One CarUp', levels: [...LEVELS], receipts, capabilities: { 'partsentry.service_authority': row(cells) } });
  assert.deepEqual(validateManifest(manifest([base()], { 'SOURCE-CERTIFIED': 'PASS' })), []);
  const borrowed = validateManifest(manifest([base()], { 'SOURCE-CERTIFIED': 'PASS', 'DATABASE-CERTIFIED': 'PASS' }));
  assert.ok(borrowed.some((m) => /DATABASE-CERTIFIED is PASS but no valid receipt of THAT level/.test(m)), JSON.stringify(borrowed));
  const invalidBacking = validateManifest(manifest([base({ claims: ['Identity verified'] })], { 'SOURCE-CERTIFIED': 'PASS' }));
  assert.ok(invalidBacking.some((m) => /SOURCE-CERTIFIED is PASS but no valid receipt/.test(m)), 'an invalid receipt backs nothing');
  const orphan = validateManifest({ ...manifest([base({ capability: 'not.on.ladder' })], {}) });
  assert.ok(orphan.some((m) => /missing from the ladder/.test(m)));
});

test('documents may not state provider quality without a live receipt; a negated line is not a claim', () => {
  const empty = { receipts: [] };
  assert.equal(scanDocumentsForUnsupportedClaims([{ file: 'OC5_X.md', text: 'Qwen OCR accuracy certified.' }], empty).length, 1);
  assert.equal(scanDocumentsForUnsupportedClaims([{ file: 'OC5_X.md', text: 'The report must never say Gemma certified.' }], empty).length, 0);
  assert.equal(scanDocumentsForUnsupportedClaims([{ file: 'OC5_X.md', text: 'Gemma certified for fraud scans.' }], { receipts: [live()] }).length, 0);
});

test('the repository manifest passes the same CLI CI runs', () => {
  const out = execFileSync(process.execPath, ['scripts/ci/evidence-certification-guard.mjs'], { cwd: repoRoot, encoding: 'utf8' });
  assert.match(out, /no impossible promotion/);
});
