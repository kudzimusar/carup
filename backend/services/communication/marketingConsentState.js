/**
 * G3 — the CANONICAL CONSENT authority, evaluated at SEND time.
 *
 * This is not a new consent system. `communication_suppressions` remains the authoritative store,
 * `marketingUnsubscribeService.js` remains the sole minter and redeemer of unsubscribe handles, and
 * the one-click flow is untouched. What was missing was a correct READING of that state at the last
 * moment before a provider call.
 *
 * The defect this closes:
 *
 *     const suppression = await this.marketingSuppressionFor(notification).catch(() => null);
 *     if (suppression) { refuse }
 *
 * `.catch(() => null)` is indistinguishable from "not suppressed". So a database timeout, a dropped
 * connection, a missing table, a revoked grant — every way of FAILING TO KNOW whether someone had
 * unsubscribed — was silently converted into permission to mail them. The one failure mode a consent
 * system must not have is the one where losing the record means the answer is yes.
 *
 *     UNKNOWN CONSENT STATE IS NOT PERMISSION.
 *
 * Three outcomes, and unavailable is its own outcome rather than a shade of either other one:
 *
 *   PERMITTED    no active marketing suppression → the send may proceed.
 *   SUPPRESSED   an active suppression → refuse durably; the person said no and that does not expire.
 *   UNAVAILABLE  state could not be established → refuse, and say so distinctly. Collapsing this
 *                into SUPPRESSED would be a lie in the audit trail: it would record that a customer
 *                unsubscribed when what actually happened is that CarUp broke.
 *
 * Scope is marketing only, in both directions. An unsubscribe from marketing must never suppress
 * security, auth or transaction email — that was physically certified during Email 1.0 and must stay
 * true — and equally, a marketing consent lookup that fails must never block a P0 security email,
 * which is why this gate is not consulted for non-marketing classifications at all.
 */

export const MARKETING_CONSENT_STATES = Object.freeze({
  PERMITTED: 'permitted',
  SUPPRESSED: 'suppressed',
  UNAVAILABLE: 'unavailable',
});

/**
 * How an UNAVAILABLE verdict should be disposed of. Both refuse the send; they differ only in
 * whether re-asking could plausibly succeed.
 */
export const MARKETING_CONSENT_DISPOSITIONS = Object.freeze({
  TRANSIENT: 'transient',
  DURABLE: 'durable',
});

/** The canonical error code for a send refused because consent state could not be established. */
export const MARKETING_CONSENT_UNAVAILABLE_CODE = 'marketing_consent_unavailable';

/** Suppression scopes that govern marketing. `all` covers a complaint or a hard bounce. */
const MARKETING_SCOPES = Object.freeze(['marketing', 'all']);

/** Channels whose consent is keyed by an external address in `communication_suppressions`. */
const ADDRESS_KEYED_CHANNELS = new Set(['email', 'sms', 'whatsapp']);

/**
 * Signals that a lookup failure is worth re-asking about.
 *
 * Deliberately a narrow ALLOW-LIST rather than a deny-list of known-permanent faults. An
 * unrecognised failure is treated as durable, because the alternative — retrying anything we do not
 * recognise — spends five attempts and several hours before reaching the same refusal, and hides a
 * real schema or permission fault behind what looks like flakiness.
 *
 * Both dispositions are safe: neither sends. A dead-lettered campaign message is recoverable by an
 * operator requeueing it; an email sent to someone who unsubscribed is not recoverable at all. When
 * the two costs are that asymmetric, the conservative default belongs on the side that never sends
 * and reports loudly.
 */
const TRANSIENT_SIGNALS = [
  'timeout', 'timed out', 'etimedout', 'econnreset', 'econnrefused', 'epipe', 'eai_again',
  'socket hang up', 'network', 'fetch failed', 'connection terminated', 'connection closed',
  'too many connections', 'rate limit', 'rate_limited', 'too many requests',
  'temporarily unavailable', 'service unavailable', 'aborterror', 'abort',
];

/** Postgres/PostgREST codes that are transient rather than structural. */
const TRANSIENT_CODES = new Set([
  '08000', '08003', '08006', '08001', '08004', // connection exceptions
  '53300', '53400', // too many connections / configuration limit exceeded
  '57P01', '57P02', '57P03', // admin shutdown / crash shutdown / cannot connect now
  '40001', '40P01', // serialization failure / deadlock
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ABORT_ERR',
]);

/**
 * Classify a consent lookup failure. Exported so the disposition is testable and mutation-provable
 * on its own, rather than only observable through the worker.
 */
export function classifyConsentLookupFailure(error) {
  const code = String(error?.code || '').toUpperCase();
  if (TRANSIENT_CODES.has(code)) return MARKETING_CONSENT_DISPOSITIONS.TRANSIENT;
  const haystack = `${error?.name || ''} ${error?.message || ''} ${error?.cause?.message || ''}`.toLowerCase();
  const transient = TRANSIENT_SIGNALS.some((signal) => haystack.includes(signal));
  return transient ? MARKETING_CONSENT_DISPOSITIONS.TRANSIENT : MARKETING_CONSENT_DISPOSITIONS.DURABLE;
}

function permitted(reasonNotEvaluated = null) {
  return { state: MARKETING_CONSENT_STATES.PERMITTED, ...(reasonNotEvaluated ? { notEvaluated: reasonNotEvaluated } : {}) };
}

function unavailable(disposition, detail) {
  return { state: MARKETING_CONSENT_STATES.UNAVAILABLE, disposition, detail };
}

/**
 * Evaluate canonical marketing consent for a notification about to be dispatched.
 *
 * `address` is supplied by the caller rather than re-derived here, because G0 has already resolved
 * the canonical recipient and the address consent is evaluated against MUST be the address the
 * message will actually be delivered to. Deriving it twice is how the two drift apart and consent is
 * checked for one person while mail goes to another.
 */
export async function evaluateMarketingConsent({
  notification = {}, repository = null, channel = null, address = null,
} = {}) {
  const classification = String(notification?.payload?.classification || '').toLowerCase();
  if (classification !== 'marketing') return permitted('not_marketing');

  const resolvedChannel = String(channel || notification.channel || '').toLowerCase();
  if (!ADDRESS_KEYED_CHANNELS.has(resolvedChannel)) {
    // Suppression is keyed by (channel, address). A channel with no external address — in_app, push
    // — is not governed by this store, and pretending otherwise would either block everything or
    // rubber-stamp everything. It is out of scope, stated rather than assumed.
    return permitted('channel_not_address_keyed');
  }

  const resolved = String(address ?? '').trim().toLowerCase();
  if (!resolved) {
    // Unreachable through the worker, because G0 refuses an unresolved recipient first. If it is
    // ever reached, consent CANNOT be established — there is no key to look it up by — so it is
    // unavailable, never permitted.
    return unavailable(MARKETING_CONSENT_DISPOSITIONS.DURABLE, 'no_address_to_evaluate_consent_against');
  }
  if (!repository || typeof repository.list !== 'function') {
    return unavailable(MARKETING_CONSENT_DISPOSITIONS.DURABLE, 'no_consent_repository');
  }

  let rows;
  try {
    rows = await repository.list('communication_suppressions', { channel: resolvedChannel, address: resolved });
  } catch (error) {
    // NOT `.catch(() => null)`. The failure is reported as itself.
    return unavailable(classifyConsentLookupFailure(error), 'suppression_lookup_failed');
  }
  if (!Array.isArray(rows)) {
    // A reader that cannot say what it read has not established state either.
    return unavailable(MARKETING_CONSENT_DISPOSITIONS.DURABLE, 'suppression_lookup_returned_non_list');
  }

  const active = rows.find((row) => row && !row.released_at && MARKETING_SCOPES.includes(row.scope));
  if (active) return { state: MARKETING_CONSENT_STATES.SUPPRESSED, reason: active.reason || 'unsubscribe' };
  return permitted();
}

export default evaluateMarketingConsent;
