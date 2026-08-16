import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeSlaState, SLA_STATES } from '../services/communication/communicationSla.js';

test('historical SLA breach keeps exact minutes but uses human-scale label', () => {
  const now = Date.parse('2026-08-11T12:00:00.000Z');
  const dueAt = '2026-07-01T10:00:00.000Z';
  const state = computeSlaState({
    status: 'open',
    first_response_due_at: dueAt,
    first_response_at: null,
  }, now);

  assert.equal(state.state, SLA_STATES.BREACHED);
  assert.ok(state.minutes > 50_000, 'exact historical minute evidence remains available');
  assert.match(state.label, /^First response overdue \d+d(?: \d+h)?$/);
  assert.doesNotMatch(state.label, /\d{5,}m/);
});

test('legacy referral provider webhook URLs are intercepted by canonical Communications before referral router', () => {
  const source = readFileSync(new URL('../routes/promotionsRoutes.js', import.meta.url), 'utf8');
  const alias = source.indexOf("router.post(`/api/referrals/channels/${channel}/webhook`");
  const referralMount = source.indexOf("router.use('/api/referrals', referralRouter)");
  assert.ok(alias >= 0, 'legacy webhook compatibility alias must exist');
  assert.ok(referralMount > alias, 'canonical webhook alias must be registered before feature-specific referral router');
  assert.match(source, /services\.webhookService\.handleWebhook/);
  assert.match(source, /canonical_communications_path:\s*true/);
});

test('public Marketplace intelligence reads use optional auth but retain allowlisted projection', () => {
  const source = readFileSync(new URL('../routes/intelligenceRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /router\.get\('\/api\/vehicles\/:vin\/temporal-findings', optionalAuth\(\)/);
  assert.match(source, /router\.get\('\/api\/vehicles\/:vin\/disclosure-conflicts', optionalAuth\(\)/);
  assert.match(source, /reviewer_state === 'confirmed' && f\.public_summary/);
  assert.match(source, /reviewer_state === 'confirmed' && c\.public_summary/);
});
