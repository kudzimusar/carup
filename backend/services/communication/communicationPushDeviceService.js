import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';
import { IdentityOwnershipConflictError, RELEASED_CONSENT_STATES } from './communicationIdentityService.js';
import { nowIso } from './communicationUtils.js';

/**
 * OC-EXPO-02 — a native device's Expo push token, registered as a Communications channel identity.
 *
 * `channel_identities` stays the one authority for where a person can be reached. This service adds
 * no table and writes no row itself: registration goes through
 * `CommunicationIdentityService.resolveOrCreateIdentity()`, and delivery resolves the token back out
 * of that row at dispatch time (`recipientResolution.js`).
 *
 * What it guarantees:
 *   - the owner is the authenticated session's account, never anything the client sends;
 *   - only a well-formed Expo push token is accepted;
 *   - registering the same token again for the same account changes nothing but `last_seen_at`;
 *   - a token another account still holds is refused, never moved — in ANY tenant scope, because a
 *     device token belongs to a device, not to an organisation;
 *   - revocation marks the identity `revoked` and keeps the row, so the audit trail survives;
 *   - the token is never echoed, logged or written to the audit trail.
 *
 * A registration is ROUTING evidence: proof that this session's app can receive pushes on this
 * device. It is not Identity or Trust evidence, and nothing here may be read as such.
 */

export const PUSH_CHANNEL = 'push';
export const EXPO_PUSH_PROVIDER = 'expo_push';

const MAX_TOKEN_LENGTH = 256;
const EXPO_PUSH_TOKEN = /^Expo(?:nent)?PushToken\[[^\s[\]]{1,230}\]$/;
const PLATFORMS = new Set(['ios', 'android']);

export function isExpoPushToken(value) {
  return typeof value === 'string' && value.length <= MAX_TOKEN_LENGTH && EXPO_PUSH_TOKEN.test(value);
}

export class PushDeviceRegistrationError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'PushDeviceRegistrationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function boundedText(value, max = 80) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** The only device facts kept: enough to tell two of a person's devices apart, nothing more. */
function deviceMetadata(body = {}) {
  const platform = boundedText(body.platform, 16)?.toLowerCase() || null;
  return {
    platform: PLATFORMS.has(platform) ? platform : null,
    device_name: boundedText(body.device_name),
    app_version: boundedText(body.app_version, 32),
  };
}

/** The identity as the client may see it. The token itself is never part of a response. */
function publicIdentity(identity) {
  return {
    id: identity.id,
    channel: identity.channel,
    provider: identity.provider,
    verified: Boolean(identity.verified),
    consent_status: identity.consent_status,
  };
}

function requireAccount(userContext) {
  const userId = userContext?.id;
  if (!userId) {
    throw new PushDeviceRegistrationError('authentication_required', 'An authenticated session is required to register a device.', 401);
  }
  return userId;
}

function requireToken(body) {
  const token = typeof body?.expo_push_token === 'string' ? body.expo_push_token.trim() : '';
  if (!isExpoPushToken(token)) {
    throw new PushDeviceRegistrationError('invalid_expo_push_token', 'expo_push_token must be an Expo push token (ExponentPushToken[…]).', 400);
  }
  return token;
}

export class CommunicationPushDeviceService {
  constructor({ repository, identityService }) {
    this.repository = repository;
    this.identityService = identityService;
  }

  /** Every identity row for this token, in every tenant scope. */
  async identitiesForToken(token) {
    return this.repository.list('channel_identities', {
      channel: PUSH_CHANNEL,
      provider: EXPO_PUSH_PROVIDER,
      external_id: token,
    }, { limit: 50 });
  }

  async register({ userContext, body = {} } = {}) {
    const userId = requireAccount(userContext);
    const token = requireToken(body);
    const tenantId = userContext.tenantId || null;

    // The unique key is (tenant scope, channel, provider, external_id), so the identity service
    // only sees the current tenant scope. Ownership is a property of the device, so it is checked
    // across all of them first.
    const existing = await this.identitiesForToken(token);
    if (existing.some((row) => row.user_id && row.user_id !== userId && !RELEASED_CONSENT_STATES.includes(row.consent_status))) {
      throw new PushDeviceRegistrationError('push_token_owned_by_another_account', 'This device is registered to another CarUp account. Sign out of that account on this device first.', 409);
    }
    const sameScope = existing.find((row) => (row.tenant_id || null) === tenantId) || null;
    const created = !sameScope;
    const reassigned = Boolean(sameScope?.user_id && sameScope.user_id !== userId);

    let identity;
    try {
      identity = await this.identityService.resolveOrCreateIdentity({
        channel: PUSH_CHANNEL,
        provider: EXPO_PUSH_PROVIDER,
        external_id: token,
        address: token,
        user_id: userId,
        tenant_id: tenantId,
        verified: true,
        authenticated: true,
        // Re-registering after a revocation re-opens the route; the registration IS the consent.
        consent_status: 'opted_in',
        refuse_owner_transfer: true,
        metadata: {
          ...deviceMetadata(body),
          registration_source: 'authenticated_native_session',
          registered_at: sameScope?.metadata?.registered_at || nowIso(),
          revoked_at: null,
          revoked_reason: null,
        },
      });
    } catch (error) {
      if (error instanceof IdentityOwnershipConflictError) {
        throw new PushDeviceRegistrationError('push_token_owned_by_another_account', 'This device is registered to another CarUp account. Sign out of that account on this device first.', 409);
      }
      throw error;
    }

    if (created || reassigned) {
      await logCommunicationAuditEvent(this.repository, {
        tenant_id: tenantId,
        event_type: COMMUNICATION_AUDIT_EVENTS.IDENTITY_LINKED,
        actor_type: 'customer',
        actor_id: userId,
        channel: PUSH_CHANNEL,
        summary: reassigned ? 'Released push device registered to a new account' : 'Push device registered',
        metadata: { identity_id: identity.id, provider: EXPO_PUSH_PROVIDER, proof: { authenticated: true }, reassigned_from_released_owner: reassigned },
      });
    }
    return { identity: publicIdentity(identity), created };
  }

  /**
   * Stop routing to this device for THIS account. The row is kept and marked `revoked`, so the
   * registration remains provable afterwards. Another account's registration is indistinguishable
   * from no registration at all: both answer 404.
   */
  async revoke({ userContext, body = {}, reason = 'user_request' } = {}) {
    const userId = requireAccount(userContext);
    const token = requireToken(body);
    const owned = (await this.identitiesForToken(token)).filter((row) => row.user_id === userId);
    if (!owned.length) {
      throw new PushDeviceRegistrationError('push_device_not_found', 'No push registration for this device belongs to this account.', 404);
    }
    const revokedAt = nowIso();
    const safeReason = reason === 'logout' ? 'logout' : 'user_request';
    for (const row of owned) {
      if (row.consent_status === 'revoked') continue;
      await this.repository.updateById('channel_identities', row.id, {
        consent_status: 'revoked',
        last_seen_at: revokedAt,
        metadata: { ...(row.metadata || {}), revoked_at: revokedAt, revoked_reason: safeReason },
      });
      await logCommunicationAuditEvent(this.repository, {
        tenant_id: row.tenant_id ?? null,
        event_type: COMMUNICATION_AUDIT_EVENTS.CONSENT_CHANGED,
        actor_type: 'customer',
        actor_id: userId,
        channel: PUSH_CHANNEL,
        summary: 'Push device registration revoked',
        metadata: { identity_id: row.id, provider: EXPO_PUSH_PROVIDER, consent_status: 'revoked', reason: safeReason },
      });
    }
    return { revoked: owned.length };
  }
}

export default CommunicationPushDeviceService;
