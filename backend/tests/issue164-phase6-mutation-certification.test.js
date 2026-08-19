import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');

function source(relative) {
  return fs.readFileSync(path.resolve(BACKEND, relative), 'utf8');
}

async function importMutant(relative, mutate, label) {
  const originalPath = path.resolve(BACKEND, relative);
  const original = fs.readFileSync(originalPath, 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, `${label}: mutation did not match source anchor`);
  const dir = path.dirname(originalPath);
  const temp = path.join(
    dir,
    `.issue164-phase6-${label}-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`,
  );
  fs.writeFileSync(temp, mutated, 'utf8');
  try {
    return await import(`${pathToFileURL(temp).href}?mutation=${Date.now()}-${Math.random()}`);
  } finally {
    fs.unlinkSync(temp);
  }
}

function kill(label, safePredicate, mutantValue) {
  assert.equal(
    safePredicate(mutantValue),
    false,
    `${label}: mutant survived — the authority invariant did not detect the deliberate regression`,
  );
}

test('Phase 6 mutation M1 — owner_id fallback cannot become seller authority', async () => {
  const mutant = await importMutant(
    'services/transaction/marketplaceTransactionAuthority.js',
    (s) => s.replace(
      'return recordedText(vehicle.current_seller_id);',
      'return recordedText(vehicle.current_seller_id) || recordedText(vehicle.owner_id);',
    ),
    'm1-owner-seller-fallback',
  );
  const resolved = mutant.resolveMarketplaceSellerId({
    current_seller_id: null,
    owner_id: 'historical-owner-must-not-be-seller',
  });
  kill('M1', (value) => value === null, resolved);
});

test('Phase 6 mutation M2 — unknown seller posture cannot pass escrow gates', async () => {
  const mutant = await importMutant(
    'services/escrow/escrowTrustService.js',
    (s) => s.replace(
      "if (ctx.seller_suspended !== false) {",
      "if (ctx.seller_suspended === true) {",
    ),
    'm2-seller-unknown-pass',
  );
  const verdict = mutant.evaluateEscrowGates({
    identity_status: 'complete',
    publication_status: 'published',
    fraud_block: false,
    seller_suspended: null,
    participant_authorized: true,
    required_documents_present: true,
    listing_snapshot_changed: false,
  });
  kill('M2', (value) => value.allowed === false && value.reasons.includes('seller_status_unknown'), verdict);
});

test('Phase 6 mutation M3 — provider cannot gain CarUp release-approval authority', async () => {
  const mutant = await importMutant(
    'services/escrow/escrowTrustService.js',
    (s) => s.replace(
      "const PRIVILEGED_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'reviewer']);",
      "const PRIVILEGED_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'reviewer', 'provider']);",
    ),
    'm3-provider-release-approval',
  );
  const allowed = mutant.canActorTransition(
    { buyer_id: 'buyer', seller_id: 'seller', status: 'inspection_pending' },
    'release_approved',
    { id: 'provider-1', role: 'provider' },
  );
  kill('M3', (value) => value === false, allowed);
});

test('Phase 6 mutation M4 — payment-linked clock expiry cannot manufacture availability', async () => {
  const mutant = await importMutant(
    'services/reservation/reservationProjectionService.js',
    (s) => s
      .replace('if (tx.payment_intent_id) {', 'if (false) {')
      .replace(
        "!['eligible', 'cancelled', 'failed'].includes(String(tx.status || '').toLowerCase())",
        "!['eligible', 'initiated', 'cancelled', 'failed'].includes(String(tx.status || '').toLowerCase())",
      ),
    'm4-payment-linked-expiry-free',
  );
  const projected = mutant.projectReservationRows([{
    id: 'reservation-1',
    vin: 'VIN-M4',
    transaction_intent_id: 'tx-m4',
    status: 'active',
    reserved_at: '2026-08-19T07:00:00.000Z',
    expires_at: '2026-08-19T08:00:00.000Z',
    _transaction: {
      status: 'initiated',
      payment_intent_id: 'provider-intent-live-until-reconciled',
      payment_state: 'authorized',
    },
  }], { now: new Date('2026-08-19T09:00:00.000Z') });
  const publicStatus = mutant.projectListingStatusWithReservation('Reserved', projected);
  kill(
    'M4',
    ({ projection, status }) => projection.state === 'inconsistent' && status === null,
    { projection: projected, status: publicStatus },
  );
});

test('Phase 6 mutation M5 — sandbox collection cannot be relabelled regulated escrow', async () => {
  const mutant = await importMutant(
    'services/diaspora/safetrade/safeTradePaymentCapabilities.js',
    (s) => s.replace('regulated_escrow: false,', 'regulated_escrow: true,'),
    'm5-sandbox-regulated-escrow',
  );
  const capability = mutant.getPaymentProviderCapabilities('sandbox').capabilities.regulated_escrow;
  kill('M5', (value) => value === false, capability);
});

test('Phase 6 mutation M6 — provider kill switch cannot be ignored by automated routing', async () => {
  const mutant = await importMutant(
    'services/diaspora/safetrade/safeTradePaymentCapabilities.js',
    (s) => s.replace(
      'if (snapshot.kill_switch_enabled !== false) {',
      'if (false) {',
    ),
    'm6-ignore-kill-switch',
  );
  const decision = mutant.evaluatePaymentControlPlane('contipay', {
    provider_key: 'contipay',
    capability_type: 'escrow',
    kill_switch_enabled: true,
    activation_mode: 'pilot_live',
    health_state: 'healthy',
  });
  kill('M6', (value) => value.allowed === false && value.reason === 'provider_kill_switch', decision);
});

test('Phase 6 mutation M7 — browser duration/customer identity authority is detected at route boundary', () => {
  const escrowRoutes = source('routes/escrowTrustRoutes.js');
  const reserveStart = escrowRoutes.indexOf("router.post('/api/vehicles/:vin/reserve'");
  const reserveEnd = escrowRoutes.indexOf("router.post('/api/vehicles/:vin/escrow'", reserveStart);
  const reserveBlock = escrowRoutes.slice(reserveStart, reserveEnd);
  const reserveMutant = reserveBlock.replace(
    'const result = await reserveVehicle(req.params.vin, actorFrom(req).id);',
    'const duration = req.body?.duration;\n    const result = await reserveVehicle(req.params.vin, actorFrom(req).id, duration);',
  );
  assert.notEqual(reserveMutant, reserveBlock, 'M7a mutation did not match');
  const safeReserve = (block) => !/req\.body/.test(block) && !/\bduration\b/.test(block.replace(/\/\*[\s\S]*?\*\//g, ''));
  assert.equal(safeReserve(reserveBlock), true);
  kill('M7a', safeReserve, reserveMutant);

  const financeRoutes = source('routes/financeRoutes.js');
  const financeStart = financeRoutes.indexOf("router.post('/api/finance/pre-approve'");
  const financeEnd = financeRoutes.indexOf("router.get('/api/finance/applications'", financeStart);
  const financeBlock = financeRoutes.slice(financeStart, financeEnd);
  const financeMutant = financeBlock.replace(
    "const applicantId = req.userContext?.id || req.userContext?.userId;",
    "const applicantId = req.body?.customerId;",
  );
  assert.notEqual(financeMutant, financeBlock, 'M7b mutation did not match');
  const safeApplicant = (block) => /req\.userContext\?\.id/.test(block) && !/req\.body\?\.customerId/.test(block);
  assert.equal(safeApplicant(financeBlock), true);
  kill('M7b', safeApplicant, financeMutant);
});

test('Phase 6 mutation M8 — intermediate authenticated transaction grant is detected', () => {
  const migration = source('../database/migrations/20260819100000_issue164_phase6_transaction_terms.sql');
  const noDirectGrant = (sql) => !/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*escrow_trust_sessions[^;]*authenticated/is.test(sql);
  assert.equal(noDirectGrant(migration), true);
  const mutant = migration.replace(
    'REVOKE ALL ON TABLE public.escrow_trust_sessions FROM anon, authenticated;',
    'GRANT SELECT ON TABLE public.escrow_trust_sessions TO authenticated;\nREVOKE ALL ON TABLE public.escrow_trust_sessions FROM anon;',
  );
  assert.notEqual(mutant, migration, 'M8 mutation did not match');
  kill('M8', noDirectGrant, mutant);
});
