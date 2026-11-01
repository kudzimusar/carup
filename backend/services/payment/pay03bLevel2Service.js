/**
 * CARUP-PAY-03B-LR01 — Level 2 (Owner-authorized Stripe SANDBOX rehearsal) controls.
 *
 * The only provider mutation here is advancing the Owner-authorized test clock, which makes Stripe generate the
 * single authorized renewal invoice. It is refused unless the runtime is the Stripe sandbox adapter (never the
 * simulator), the recorded Owner decision file authorizes the exact scope, the configured clock is the
 * authorized clock, and no advance has been made before (the scope allows exactly one). It is audited before the
 * provider call and fails closed if that audit cannot be written.
 */
import fs from 'node:fs';
import { supabase } from '../../db/supabase.js';
import { Pay03bError, pay03bAuditSucceeded, recordPay03bAudit, requireAdminActor } from './pay03bContract.js';
import { Pay03bStripeSandboxProvider } from './pay03bProviderAdapters.js';

const AUTHORIZED = 'Authorize exact scope (Recommended)';

function readJson(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return null; }
}

export function requirePay03bLevel2(env = process.env) {
  if (env.CARUP_PAY03B_PROVIDER_MODE === 'local_simulator') throw new Pay03bError('PAY03B_LEVEL2_NOT_IN_SIMULATOR', 409);
  const decision = env.CARUP_PAY03B_LEVEL2_AUTHORIZATION_FILE ? readJson(env.CARUP_PAY03B_LEVEL2_AUTHORIZATION_FILE) : null;
  if (decision?.decisions?.level2_stripe_sandbox_rehearsal !== AUTHORIZED || decision?.limits?.test_clock_advances !== 1) {
    throw new Pay03bError('PAY03B_LEVEL2_NOT_AUTHORIZED', 403);
  }
  const clockId = env.CARUP_PAY03B_STRIPE_TEST_CLOCK_ID;
  if (!/^clock_[A-Za-z0-9]+$/.test(String(clockId || '')) || !env.CARUP_PAY03B_LEVEL2_LEDGER_FILE) {
    throw new Pay03bError('PAY03B_LEVEL2_NOT_PROVISIONED', 409);
  }
  return { decision, clockId, ledgerFile: env.CARUP_PAY03B_LEVEL2_LEDGER_FILE };
}

export async function advancePay03bLevel2TestClock({
  db = supabase, env = process.env, stripe = null, adminActorId, adminActorRole = 'admin', subscriptionId, requestContext = null,
}) {
  const admin = requireAdminActor(adminActorId);
  const { clockId, ledgerFile } = requirePay03bLevel2(env);
  const ledger = readJson(ledgerFile) || { advances: [] };
  if ((ledger.advances || []).length >= 1) throw new Pay03bError('PAY03B_LEVEL2_ADVANCE_LIMIT_REACHED', 409);
  const { data: rows, error } = await db.from('pay03b_business_subscriptions').select('*').eq('id', subscriptionId);
  if (error) throw new Pay03bError('PAY03B_READ_UNAVAILABLE', 503);
  const [row] = rows || [];
  if (!row || row.gateway !== 'stripe_carup_japan_sandbox' || !row.provider_subscription_id || !row.current_period_end) {
    throw new Pay03bError('PAY03B_LEVEL2_SUBSCRIPTION_NOT_READY', 409);
  }
  const provider = new Pay03bStripeSandboxProvider({ env, stripe });
  await provider.verifyAccount();
  const api = await provider.api();
  const clock = await api.testHelpers.testClocks.retrieve(clockId);
  if (clock?.id !== clockId || clock.livemode !== false || clock.status !== 'ready') {
    throw new Pay03bError('PAY03B_LEVEL2_CLOCK_NOT_READY', 409);
  }
  // Two hours past the paid period's end: Stripe creates, finalizes and attempts exactly one renewal invoice.
  const target = Math.floor(Date.parse(row.current_period_end) / 1000) + 2 * 3600;
  if (target <= clock.frozen_time) throw new Pay03bError('PAY03B_LEVEL2_CLOCK_ALREADY_PAST_PERIOD', 409);
  const subject = { subscriptionId, providerSubscriptionId: row.provider_subscription_id, clockId,
    fromFrozenTime: clock.frozen_time, toFrozenTime: target };
  const requested = await recordPay03bAudit(db, { eventType: 'PAY03B_LEVEL2_TEST_CLOCK_ADVANCE_REQUESTED', actorId: admin,
    actorRole: adminActorRole, tenantId: row.owner_tenant_id, sourceRoute: '/api/pay03b/admin/stripe-sandbox/test-clock/advance',
    requestContext, reason: 'Owner-authorized Level 2 rehearsal: the single authorized renewal.', subject });
  if (!pay03bAuditSucceeded(requested)) throw new Pay03bError('PAY03B_LEVEL2_AUDIT_UNAVAILABLE', 503);
  // Record the attempt BEFORE calling the provider: a crash can never permit a second advance.
  fs.writeFileSync(ledgerFile, JSON.stringify({ ...ledger, advances: [...(ledger.advances || []),
    { at: new Date().toISOString(), by: admin, ...subject }] }, null, 2), { mode: 0o600 });
  let advanced;
  try {
    advanced = await api.testHelpers.testClocks.advance(clockId, { frozen_time: target });
  } catch {
    throw new Pay03bError('PAY03B_LEVEL2_CLOCK_PROVIDER_UNAVAILABLE', 502);
  }
  return { clockId, status: advanced?.status || null, frozenTime: target, providerSubscriptionId: row.provider_subscription_id,
    note: 'Renewal events arrive through the signed webhook; the canonical state changes only from fresh provider reads.' };
}
