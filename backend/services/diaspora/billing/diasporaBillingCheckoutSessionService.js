/**
 * Checkout session lifecycle — the durable record abandonment is measured against (ledger #24).
 *
 * Abandonment is the only one of the four required billing signals that leaves NO trace unless it is
 * recorded up front. A completed checkout produces a webhook; a failed payment produces a webhook; an
 * abandoned checkout produces nothing at all, forever. So the row is written when checkout is
 * initiated, closed when the provider says it completed, and swept into `abandoned` when it stayed open
 * past the window.
 *
 * `abandoned` is DERIVED, never reported. No provider tells you a customer changed their mind.
 *
 * Recording is BEST EFFORT on the checkout path: a customer must not be blocked from paying because an
 * observability row could not be written. Every other transition is strict, because by then the money
 * question is already settled and a silent failure would corrupt the metric.
 */
import { resolveClient } from '../diasporaServiceUtils.js';
import { billingCheckoutAbandonmentMinutes } from '../../../constants/diaspora/diasporaBillingConstants.js';
import { checkoutOpened, checkoutCompleted, checkoutAbandoned } from './diasporaBillingObservability.js';

export const CHECKOUT_SESSIONS_TABLE = 'diaspora_billing_checkout_sessions';

export const CHECKOUT_STATES = Object.freeze({
  OPEN: 'open',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
});

const SESSION_COLUMNS = 'id, tenant_id, provider, session_ref, plan_key, state, initiated_by, correlation_id, opened_at, completed_at, abandoned_at, expires_at, detail';

function minutesBetween(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round(((to - from) / 60000) * 10) / 10;
}

/**
 * Record that a checkout was initiated.
 *
 * Best effort: returns null (and emits nothing) rather than throwing, so a metrics table cannot stop a
 * tenant from subscribing.
 */
export async function recordCheckoutOpened({
  tenantId, provider, planKey, sessionRef = null, initiatedBy = null,
  correlationId = null, expiresAt = null, now = null, supabaseClient = null,
} = {}) {
  if (!tenantId || !provider || !planKey) return null;
  const openedAt = now || new Date().toISOString();
  try {
    const supabase = await resolveClient({ supabaseClient });
    const { data, error } = await supabase
      .from(CHECKOUT_SESSIONS_TABLE)
      .insert({
        tenant_id: String(tenantId),
        provider,
        session_ref: sessionRef ? String(sessionRef) : null,
        plan_key: planKey,
        state: CHECKOUT_STATES.OPEN,
        initiated_by: initiatedBy ? String(initiatedBy) : null,
        correlation_id: correlationId,
        opened_at: openedAt,
        expires_at: expiresAt,
        detail: {},
      })
      .select()
      .single();
    if (error) return null;
    checkoutOpened({ correlationId, tenantId, planKey, provider, sessionRef });
    return data;
  } catch {
    return null;
  }
}

/** Find the open session a completion event refers to: by provider ref if we have one, else by tenant. */
async function findOpenSession(supabase, { provider, sessionRef, tenantId }) {
  if (sessionRef) {
    const { data, error } = await supabase
      .from(CHECKOUT_SESSIONS_TABLE)
      .select(SESSION_COLUMNS)
      .eq('provider', provider)
      .eq('session_ref', String(sessionRef))
      .maybeSingle();
    if (error && error.code && error.code !== 'PGRST116') {
      throw new Error(`Failed to read checkout session: ${error.message}`);
    }
    if (data) return data;
  }
  if (!tenantId) return null;
  // Fall back to the tenant's most recent OPEN session. A rail that mints no session handle (ADR-001
  // §3E) leaves us nothing else to match on, and an approximate attribution beats losing the signal.
  const { data, error } = await supabase
    .from(CHECKOUT_SESSIONS_TABLE)
    .select(SESSION_COLUMNS)
    .eq('tenant_id', String(tenantId))
    .eq('state', CHECKOUT_STATES.OPEN)
    .order('opened_at', { ascending: false });
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to read checkout sessions: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  return rows[0] || null;
}

/**
 * Close a session as completed. Idempotent: a replayed completion webhook does not re-emit the signal
 * or move `completed_at`, so the funnel metric cannot be inflated by provider retries.
 */
export async function markCheckoutCompleted({
  tenantId = null, provider, sessionRef = null, correlationId = null, now = null, supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const session = await findOpenSession(supabase, { provider, sessionRef, tenantId });
  if (!session) return null;
  if (session.state !== CHECKOUT_STATES.OPEN) return session; // already terminal — no double count

  const completedAt = now || new Date().toISOString();
  const { data, error } = await supabase
    .from(CHECKOUT_SESSIONS_TABLE)
    .update({
      state: CHECKOUT_STATES.COMPLETED,
      completed_at: completedAt,
      session_ref: session.session_ref || (sessionRef ? String(sessionRef) : null),
    })
    .eq('id', session.id)
    .select()
    .single();
  if (error) throw new Error(`Failed to complete checkout session: ${error.message}`);

  checkoutCompleted({
    correlationId: correlationId || session.correlation_id,
    tenantId: session.tenant_id,
    planKey: session.plan_key,
    provider,
    sessionRef: session.session_ref || sessionRef,
    openMinutes: minutesBetween(session.opened_at, completedAt),
  });
  return data;
}

/**
 * Sweep open sessions past the abandonment window.
 *
 * Bounded by design: a sweep that could touch an unbounded number of rows is a sweep that will one day
 * time out mid-run and leave the metric half-updated.
 */
export async function sweepAbandonedCheckouts({
  now = null, olderThanMinutes = null, limit = 200, correlationId = null, supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const clock = now ? new Date(now) : new Date();
  const window = olderThanMinutes == null ? billingCheckoutAbandonmentMinutes() : Number(olderThanMinutes);
  const cutoff = new Date(clock.getTime() - window * 60000);

  const { data, error } = await supabase
    .from(CHECKOUT_SESSIONS_TABLE)
    .select(SESSION_COLUMNS)
    .eq('state', CHECKOUT_STATES.OPEN)
    .order('opened_at', { ascending: true })
    .limit(Math.min(Number(limit) || 200, 500));
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to read open checkout sessions: ${error.message}`);
  }

  const abandoned = [];
  for (const session of Array.isArray(data) ? data : []) {
    const openedAt = Date.parse(session.opened_at);
    if (!Number.isFinite(openedAt) || openedAt > cutoff.getTime()) continue;

    const abandonedAt = clock.toISOString();
    const { data: updated, error: updateError } = await supabase
      .from(CHECKOUT_SESSIONS_TABLE)
      .update({ state: CHECKOUT_STATES.ABANDONED, abandoned_at: abandonedAt })
      .eq('id', session.id)
      .select()
      .single();
    if (updateError) throw new Error(`Failed to mark checkout abandoned: ${updateError.message}`);

    checkoutAbandoned({
      correlationId: correlationId || session.correlation_id,
      tenantId: session.tenant_id,
      planKey: session.plan_key,
      provider: session.provider,
      sessionRef: session.session_ref,
      openMinutes: minutesBetween(session.opened_at, abandonedAt),
    });
    abandoned.push(updated);
  }
  return { swept: abandoned.length, cutoff: cutoff.toISOString(), sessions: abandoned };
}

/** Operator/analytics read: the funnel for a tenant (or globally), sanitized. */
export async function checkoutFunnelSummary({ tenantId = null, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase.from(CHECKOUT_SESSIONS_TABLE).select('id, tenant_id, state, plan_key, provider');
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to summarize checkout sessions: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data : [];
  const counts = { open: 0, completed: 0, abandoned: 0, expired: 0, cancelled: 0 };
  for (const row of rows) {
    if (counts[row.state] !== undefined) counts[row.state] += 1;
  }
  const decided = counts.completed + counts.abandoned + counts.expired + counts.cancelled;
  return {
    tenantId: tenantId ? String(tenantId) : null,
    total: rows.length,
    counts,
    // Rate over DECIDED sessions only. Including still-open sessions in the denominator would make the
    // abandonment rate look better simply because traffic is recent.
    abandonmentRate: decided > 0 ? Math.round((counts.abandoned / decided) * 1000) / 1000 : null,
  };
}
