import { normalizeChannel } from '../communicationUtils.js';

/**
 * G0 — canonical recipient resolution.
 *
 * The defect this closes: `queueFromDomainEvent` writes `payload: { event_type, safe_payload }` with no
 * address (`communicationNotificationService.js:200`), the delivery worker reads the address only from
 * `notification.payload`, and the provider adapter then hard-fails `recipient_missing`. Address enrichment
 * from the account profile existed ONLY inside `resolveFallbackRoute` — i.e. after a primary failure.
 *
 * All six email-eligible `NOTIFICATION_POLICIES` entries route through that path, so every policy-driven
 * Email failed its first attempt and succeeded, if at all, by fallback. This is the whole policy-driven
 * surface, not an edge case.
 *
 * Design constraints this satisfies:
 *
 *   - producers keep passing IDENTIFIERS, never duplicated addresses — resolution happens once, here,
 *     called by the worker immediately before dispatch;
 *   - it FAILS CLOSED: an unresolved recipient never reaches a provider;
 *   - an unresolved recipient is reported distinctly from a provider failure, because one is our defect
 *     and the other is theirs, and collapsing them hides the difference;
 *   - a failure result never carries an address, so this can never become an enumeration oracle;
 *   - a success result exposes four fields only — no raw user row may reach template context;
 *   - it reads CarUp's own identity tables, preserving the custom auth architecture.
 */

export const RECIPIENT_RESOLUTION_REASONS = Object.freeze({
  NO_RECIPIENT_REFERENCE: 'no_recipient_reference',
  NO_VERIFIED_ADDRESS: 'no_verified_address',
  CHANNEL_NOT_SUPPORTED: 'channel_not_supported',
  LOOKUP_FAILED: 'lookup_failed',
});

/** Which `users` column carries the address for a channel. `null` = not resolvable from the profile. */
const PROFILE_COLUMN = Object.freeze({
  email: 'email',
  sms: 'phone',
  whatsapp: 'phone',
});

/** The address already carried on the notification payload, if a producer supplied one. */
function explicitAddress(payload, channel) {
  if (!payload) return null;
  if (channel === 'email') return payload.email || payload.address || payload.to || null;
  if (channel === 'sms' || channel === 'whatsapp') {
    return payload.phone_number || payload.phone || payload.address || null;
  }
  if (channel === 'telegram') return payload.telegram_chat_id || payload.external_id || null;
  return payload.address || null;
}

const clean = (value) => {
  const s = String(value ?? '').trim();
  return s.length ? s : null;
};

function ok({ address, identityId = null, userId = null, verified = false }) {
  return { ok: true, address, identityId, userId, verified };
}

/** Failures deliberately carry a reason and NOTHING else — never the address that was being sought. */
function fail(reason) {
  return { ok: false, reason };
}

/**
 * Resolve the address a notification should be delivered to.
 *
 * Precedence, first match wins:
 *   1. an address the producer already put on the payload  (back-compatible; conversation Email does this)
 *   2. a VERIFIED channel identity for this user and channel
 *   3. the CarUp account profile
 *
 * An unverified channel identity is never used: it is an unproven claim about where a person can be
 * reached, and sending to it would let an attacker who registered an address receive another user's mail.
 */
export async function resolveNotificationRecipient({ notification = {}, repository, channel = null } = {}) {
  const resolvedChannel = normalizeChannel(channel || notification.channel) || 'email';

  const explicit = clean(explicitAddress(notification.payload, resolvedChannel));
  if (explicit) {
    return ok({
      address: explicit,
      identityId: notification.recipient_identity_id || null,
      userId: notification.recipient_user_id || null,
      // An address handed over by a producer is trusted as supplied; it carries no verification claim
      // of its own, and saying otherwise would overstate what we know.
      verified: false,
    });
  }

  const userId = clean(notification.recipient_user_id) || clean(notification.recipient_id);
  const identityId = clean(notification.recipient_identity_id);
  if (!userId && !identityId) return fail(RECIPIENT_RESOLUTION_REASONS.NO_RECIPIENT_REFERENCE);

  const profileColumn = PROFILE_COLUMN[resolvedChannel] || null;

  try {
    // 2. a verified channel identity.
    const filters = { channel: resolvedChannel, verified: true };
    if (userId) filters.user_id = userId;
    if (identityId) filters.id = identityId;
    const identities = await repository.list('channel_identities', filters, { limit: 5 });
    const identity = (identities || []).find((row) => clean(row?.normalized_address));
    if (identity) {
      return ok({
        address: clean(identity.normalized_address),
        identityId: identity.id || identityId || null,
        userId: identity.user_id || userId || null,
        verified: true,
      });
    }

    // 3. the account profile.
    if (userId && profileColumn) {
      const user = await repository.findOne('users', { id: userId });
      const address = clean(user?.[profileColumn]);
      // Only the address is taken. The row itself never leaves this function — a raw user object in
      // template context is how credentials and unrelated PII end up rendered into an Email.
      if (address) return ok({ address, identityId: null, userId, verified: false });
    }
  } catch {
    // A lookup fault is transient and must be distinguishable from "this person has no address",
    // so the caller can retry the first and stop on the second.
    return fail(RECIPIENT_RESOLUTION_REASONS.LOOKUP_FAILED);
  }

  if (!profileColumn) return fail(RECIPIENT_RESOLUTION_REASONS.CHANNEL_NOT_SUPPORTED);
  return fail(RECIPIENT_RESOLUTION_REASONS.NO_VERIFIED_ADDRESS);
}

export default resolveNotificationRecipient;
