/**
 * O2/P5+P6 — Communications events and the adversarial surface of People & Compliance.
 *
 * Pinned rules: decision events are EMIT-ONLY bridges into the communication engine (best-effort,
 * never able to fail the decision); the People route composes the same refusal stack as the
 * certified Vehicle Operations route (role gate with no x-user-id fallback + proven-session
 * capability check); and the governed-decision law "the actor may not decide on their own
 * submission" holds on identity review exactly as it does on evidence classification and Seller
 * Authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// P5 — decision → Communications bridge
// ---------------------------------------------------------------------------

test('identity decisions emit identity.verification.decided, and Communications listens for it', () => {
  const recorder = src('../services/identity/decisionRecorder.js');
  assert.match(recorder, /emitDomainEvent\(null, 'identity\.verification\.decided'/);
  const listeners = src('../services/communication/communicationEventListeners.js');
  assert.match(listeners, /'identity\.verification\.decided'/, 'Communications owns delivery of the identity decision');
});

test('dealer compliance decisions emit dealer.compliance.decided, best-effort, AFTER the durable ledger row', () => {
  const dealer = src('../services/dealer/dealerComplianceService.js');
  const emitAt = dealer.indexOf("emitDomainEvent(null, 'dealer.compliance.decided'");
  assert.ok(emitAt > -1, 'the dealer decision must announce itself to the communication engine');
  const ledgerAt = dealer.indexOf('.from(DECISIONS).insert(ledgerRow)');
  assert.ok(ledgerAt > -1 && ledgerAt < emitAt, 'the immutable ledger row precedes the announcement');
  assert.match(dealer.slice(emitAt, emitAt + 500), /\.catch\(/, 'an outbox failure must never fail the decision');
  // Communications owns delivery — the dealer service must not message anyone directly.
  assert.doesNotMatch(dealer, /sendEmail|sendWhatsApp|queueNotification|notificationService/i);
});

// ---------------------------------------------------------------------------
// P6 — route composition (the certified refusal stack, reused verbatim)
// ---------------------------------------------------------------------------

test('the People route composes role gate (no x-user-id fallback) + proven-session capability check', () => {
  const routes = src('../routes/peopleOperationsRoutes.js');
  assert.match(routes, /authorizeRole\(\['admin', 'government'\], \{ allowUserIdFallback: false \}\)/);
  assert.match(routes, /requireOperationsCapability\(OPERATIONS_CAPABILITIES\.PERSON_READ_PRIVATE\)/);
  // Read model only: no POST/PATCH/PUT/DELETE — every decision goes through the owning domain route.
  assert.doesNotMatch(routes, /router\.(post|patch|put|delete)\(/);
});

test('the People route is mounted on the server', () => {
  const server = src('../server.js');
  assert.match(server, /import peopleOperationsRouter from '\.\/routes\/peopleOperationsRoutes\.js'/);
  assert.match(server, /app\.use\(peopleOperationsRouter\);/);
});

// ---------------------------------------------------------------------------
// P6 — the self-review law holds on identity, as it does everywhere else
// ---------------------------------------------------------------------------

test('a reviewer cannot decide their own identity verification session', async () => {
  const { reviewVerificationSession } = await import('../services/identity/verificationSessionService.js');
  const SELF = 'u_admin_applicant';
  const client = {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle: () => Promise.resolve({
          data: table === 'verification_sessions'
            ? { id: 'vs-self', user_id: SELF, status: 'pending_review', workflow_phase: 'reviewer_action_required' }
            : null,
          error: null,
        }),
        single: () => chain.maybeSingle(),
        then(resolve, reject) { return chain.maybeSingle().then(resolve, reject); },
      };
      return chain;
    },
  };
  await assert.rejects(
    reviewVerificationSession(client, { id: SELF, role: 'admin' }, 'vs-self', { action: 'approve' }),
    /cannot decide their own identity verification/,
  );
});

test('the self-review guard sits in the OWNING identity service, before any decision is recorded', () => {
  const service = src('../services/identity/verificationSessionService.js');
  const guardAt = service.indexOf('cannot decide their own identity verification session');
  const recordAt = service.indexOf('VerificationDecisionRecorder.recordDecision');
  assert.ok(guardAt > -1, 'the guard exists');
  assert.ok(recordAt > guardAt, 'the refusal precedes the decision recorder — nothing is written first');
});
