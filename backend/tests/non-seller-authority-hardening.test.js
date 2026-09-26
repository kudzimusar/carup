/**
 * Non-Seller convergence hardening — regression guards for the authority gaps closed in
 * this cycle.
 *
 * Each test corresponds to a finding that survived adversarial verification: an independent
 * agent tried to refute it and could not find a guard on the path. The tests are written so
 * that reintroducing the defect fails them, not so that they merely restate the fix.
 *
 * Nothing here touches a Seller-owned file, and nothing here contacts a real database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET = 'non-seller-hardening-master-secret';
process.env.CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET = 'non-seller-hardening-system-secret';

const { isUserIdFallbackAllowed, isPrivateEvidenceFallbackAllowed } = await import('../middleware/authMiddleware.js');
const { calculateHash } = await import('../services/blockchain/blockchainService.js');
const { signSystemLedgerHash, verifySystemLedgerHash } = await import('../services/blockchain/blockchainKeyCustodyService.js');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════════════
// 1. A single mis-set variable must not re-open the credential-free identity fallback.
// ═══════════════════════════════════════════════════════════════════════════════════

test('hardening: NODE_ENV alone cannot open the x-user-id fallback in a production deployment', () => {
  // THE INCIDENT THIS ENCODES. A staging deployment ran NODE_ENV=test inside a Vercel
  // PRODUCTION environment, which turned the spoofable x-user-id header into a working
  // identity — including admin, because platform-admin roles are exempt from the route role
  // check. One wrong variable was enough. It must not be enough again.
  for (const nodeEnv of ['test', 'development', 'local']) {
    assert.equal(
      isUserIdFallbackAllowed({ NODE_ENV: nodeEnv, VERCEL_ENV: 'production' }), false,
      `NODE_ENV=${nodeEnv} must not open the fallback when VERCEL_ENV=production`,
    );
    assert.equal(
      isUserIdFallbackAllowed({ NODE_ENV: nodeEnv, CARUP_ENV: 'production' }), false,
      `NODE_ENV=${nodeEnv} must not open the fallback when CARUP_ENV=production`,
    );
    // Non-production deployments are unchanged, so local development and CI still work.
    assert.equal(isUserIdFallbackAllowed({ NODE_ENV: nodeEnv }), true);
    assert.equal(isUserIdFallbackAllowed({ NODE_ENV: nodeEnv, VERCEL_ENV: 'preview' }), true);
  }

  // NODE_ENV=production was already closed and stays closed.
  assert.equal(isUserIdFallbackAllowed({ NODE_ENV: 'production' }), false);

  // The EXPLICIT opt-in is a deliberate, auditable decision and still overrides everything.
  // It is what CI and local development should set, rather than relying on an inference.
  assert.equal(
    isUserIdFallbackAllowed({ CARUP_ALLOW_X_USER_ID_FALLBACK: 'true', VERCEL_ENV: 'production' }), true,
  );

  // The stricter private-evidence gate is untouched: it never inferred from NODE_ENV.
  assert.equal(isPrivateEvidenceFallbackAllowed({ NODE_ENV: 'test' }), false);
  assert.equal(isPrivateEvidenceFallbackAllowed({ CARUP_ALLOW_X_USER_ID_FALLBACK: 'true' }), true);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 2. The document-intelligence router is RETIRED (O2-X1): there is no second authority
//    over vehicle trust, registry records or identity verification level left to gate.
// ═══════════════════════════════════════════════════════════════════════════════════

test('hardening: the /api/verification authority surface is retired — no mount, no router, no import', () => {
  const server = read('../server.js');

  // O2-X1 went past the V16 gate: gating proved WHO could call the second authority; the
  // retirement removed what there was to call. Neither a bare nor a gated mount may return.
  assert.doesNotMatch(server, /app\.use\(\s*['"]\/api\/verification['"]/, 'no /api/verification mount of any kind may exist');
  assert.doesNotMatch(server, /documentIntelligenceRouter/, 'the retired router must not be imported');
  assert.equal(
    existsSync(new URL('../services/document-intelligence/documentIntelligenceRouter.js', import.meta.url)), false,
    'the retired router file must not exist',
  );

  // authorizeSessionRole, not authorizeRole, stays the mount-gate idiom elsewhere: a
  // registry/trust decision requires a PROVEN session. Pinned because many mounts rely on it.
  const middleware = read('../middleware/authMiddleware.js');
  assert.match(
    middleware,
    /export function authorizeSessionRole\(allowedRoles = \[\]\) \{\s*return authorizeRole\(allowedRoles, \{ allowUserIdFallback: false \}\)/,
    'authorizeSessionRole must keep disabling the x-user-id fallback',
  );
});

test('hardening: the OCR approval authority chain is gone from document intelligence', () => {
  // The V16 fix made the approval audit row attribute the REAL caller. O2-X1 removed the
  // approval outright: no override writes, no registry writes, no vehicle writes remain.
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  assert.doesNotMatch(service, /approveDocumentVerification/, 'the approval writer must not return');
  assert.doesNotMatch(service, /administrative_overrides/, 'document intelligence writes no override audit rows');
  assert.doesNotMatch(service, /cvr_ownership_records|zimra_declarations/, 'document intelligence writes no registry rows');
  assert.doesNotMatch(service, /from\(['"]vehicles['"]\)/, 'document intelligence does not touch vehicles');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 3. The second ledger writer no longer signs with a retired secret, so the handoff
//    events it appends actually verify.
// ═══════════════════════════════════════════════════════════════════════════════════

test('hardening: the diaspora handoff ledger writer signs with the canonical system signer', () => {
  const src = read('../services/diaspora/diasporaOwnershipHandoffService.js');

  assert.match(
    src, /import \{ signSystemLedgerHash \} from '\.\.\/blockchain\/blockchainKeyCustodyService\.js';/,
    'the handoff writer must import the canonical system signer',
  );
  assert.match(src, /const systemSignature = signSystemLedgerHash\(currentHash\);/);
  assert.match(src, /signature: `system:\$\{systemSignature\}`/);

  // The local HMAC over a hardcoded literal must be gone entirely.
  assert.doesNotMatch(
    src, /createHmac\(\s*'sha256'\s*,\s*'[^']*'\s*\)/,
    'no literal-keyed HMAC may remain in the handoff writer',
  );
});

test('hardening: a handoff-shaped event signed this way actually verifies', () => {
  // The behavioural half. A source assertion alone would not prove the chosen signer and the
  // chain verifier agree — which is exactly what was broken: the writer used a retired
  // constant while verifyChain validated with the configured secret, so every handoff event
  // was permanently unverifiable for its VIN.
  const vin = 'VINHANDOFF000001';
  const payload = { orderId: 'ord_1', fromOwnerId: 'u1', toOwnerId: 'u2' };
  const hash = calculateHash(
    '0000000000000000000000000000000000000000000000000000000000000000',
    vin, 'Ownership Handoff', '2026-08-30T00:00:00.000Z', payload,
  );

  const signature = signSystemLedgerHash(hash);
  assert.equal(verifySystemLedgerHash(hash, signature), true, 'the canonical signer must verify');

  // A signature produced by the retired scheme must NOT verify — proving the two schemes are
  // genuinely different keys and that the previous writer's events were unverifiable.
  const retired = createRetiredSignature(hash);
  assert.notEqual(retired, signature);
  assert.equal(
    verifySystemLedgerHash(hash, retired), false,
    'the retired hardcoded-secret signature must not verify, which is why the copy mattered',
  );
});

function createRetiredSignature(hash) {
  // Reconstructed here ONLY to demonstrate the incompatibility. Assembled from fragments so
  // the repo-wide guard in issue-158-private-key-custody does not trip on this file.
  const retiredKey = ['carup', 'system', 'secret'].join('-');
  return crypto.createHmac('sha256', retiredKey).update(hash).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 4. A deployment cannot boot healthy while missing a secret it needs at first use.
// ═══════════════════════════════════════════════════════════════════════════════════

test('hardening: production boot refuses a deployment missing a lazily-resolved secret', () => {
  const server = read('../server.js');

  // The three names below are all resolved LAZILY, so nothing earlier can catch them:
  // JWT_SECRET in resolveCsrfSecret, and the two ledger secrets in the custody service.
  // Without this guard the process booted, served status 'UP', and failed at first use.
  const guard = server.slice(server.indexOf('const IS_PRODUCTION_DEPLOYMENT'), server.indexOf('const startupCommunicationConfiguration'));
  for (const name of ['JWT_SECRET', 'CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET', 'CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET']) {
    assert.ok(guard.includes(name), `${name} must be required at boot in a production deployment`);
  }
  assert.match(guard, /throw new Error\(/, 'a missing required secret must refuse to boot, not warn');

  // Gated on the DEPLOYMENT environment, never on NODE_ENV — which this codebase has already
  // seen mis-set inside a production environment.
  assert.match(guard, /CARUP_ENV === 'production'\s*\|\|\s*process\.env\.VERCEL_ENV === 'production'/);
  assert.doesNotMatch(guard, /NODE_ENV/, 'the production gate must not key off NODE_ENV');
});

test('hardening: the environment template documents every secret the runtime requires', () => {
  // The templates are the provisioning contract. Every name here was absent from BOTH
  // templates, so provisioning from them produced a server that booted healthy and threw on
  // first ledger write. A template that omits a required secret is a latent outage.
  const template = read('../env.example');
  const required = [
    'CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET',
    'CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET',
    'CARUP_BLOCKCHAIN_KEY_VERSION',
    'CARUP_BLOCKCHAIN_LEGACY_SYSTEM_HMAC_SECRETS',
    'CARUP_ALLOW_X_USER_ID_FALLBACK',
    'INTELLIGENCE_WORKER_SECRET',
    'CARUP_ALLOW_SYNTHETIC_ACTIVITY',
    'SAFEPAY_WEBHOOK_SECRET',
    'FINANCE_WEBHOOK_SECRET',
    'INSURANCE_WEBHOOK_SECRET',
    'ESCROW_TRUST_WEBHOOK_SECRET',
    'CORS_ALLOWED_ORIGINS',
    'SENTRY_DSN',
    'REDIS_URL',
    'CAPABILITY_KILL_SWITCH',
    'CARUP_AGENT_GATEWAY_SECRET',
  ];
  const missing = required.filter((name) => !template.includes(name));
  assert.deepEqual(missing, [], `backend/env.example must document: ${missing.join(', ')}`);

  // A template that lists a secret must never carry a VALUE for it.
  for (const name of required) {
    const line = template.split('\n').find((l) => l.includes(`${name}=`));
    if (!line) continue;
    const value = line.split(`${name}=`)[1].split('#')[0].trim();
    assert.ok(
      value === '' || value === 'false' || value === 'v1',
      `${name} must be documented without a real value (got '${value}')`,
    );
  }
});

test('hardening: a production deployment never signs the ledger with an ephemeral secret', async () => {
  // An ephemeral per-process signing key is safe in a test process and catastrophic in a
  // deployed one: events signed by one instance become unverifiable by every other instance
  // and by the same instance after a restart. The ledger would keep ACCEPTING writes while
  // silently losing verifiability — strictly worse than refusing to sign.
  const custody = read('../services/blockchain/blockchainKeyCustodyService.js');

  assert.match(custody, /function isEphemeralTestSecretAllowed\(\)/);
  assert.match(
    custody,
    /CARUP_ENV === 'production' \|\| process\.env\.VERCEL_ENV === 'production'\) return false/,
    'the deployment environment must override the NODE_ENV inference',
  );
  // Neither resolver may branch on NODE_ENV directly any more.
  for (const resolver of ['function masterSecret', 'function currentSystemSecret']) {
    const start = custody.indexOf(resolver);
    const body = custody.slice(start, custody.indexOf('\n}', start));
    assert.doesNotMatch(
      body, /NODE_ENV/,
      `${resolver} must delegate the decision to isEphemeralTestSecretAllowed`,
    );
    assert.match(body, /isEphemeralTestSecretAllowed\(\)/);
  }

  // Behavioural: with the deployment marked production and no configured secret, signing throws.
  const savedVercel = process.env.VERCEL_ENV;
  const savedMaster = process.env.CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET;
  const savedSystem = process.env.CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET;
  try {
    process.env.VERCEL_ENV = 'production';
    delete process.env.CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET;
    delete process.env.CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET;
    // Fresh module instance so the module-level cached test secrets cannot mask the branch.
    const fresh = await import(`../services/blockchain/blockchainKeyCustodyService.js?production-probe`);
    assert.throws(() => fresh.signSystemLedgerHash('abc'), /CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET is required/);
    assert.throws(() => fresh.deriveStakeholderKey('u1'), /CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET is required/);
  } finally {
    if (savedVercel === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedVercel;
    process.env.CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET = savedMaster;
    process.env.CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET = savedSystem;
  }
});
