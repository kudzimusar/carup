import { buildDedupeKey, normalizeChannel, nowIso } from './communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';

export class CommunicationIdentityService {
  constructor({ repository }) {
    this.repository = repository;
  }

  normalizeAddress(channel, value) {
    const normalized = normalizeChannel(channel);
    if (!value) return null;
    const raw = String(value).trim();
    if (normalized === 'email') return raw.toLowerCase();
    if (normalized === 'sms' || normalized === 'whatsapp') {
      // Provider callbacks and user forms commonly disagree on +263 vs 263 vs 00263.
      // Preserve the provider's raw external_id separately, but use one E.164-like
      // comparison key so the same physical identity does not fragment conversations.
      const compact = raw.replace(/[^\d+]/g, '');
      if (!compact) return null;
      if (compact.startsWith('+')) return `+${compact.slice(1).replace(/\D/g, '')}`;
      if (compact.startsWith('00')) return `+${compact.slice(2).replace(/\D/g, '')}`;
      return `+${compact.replace(/\D/g, '')}`;
    }
    return raw;
  }

  identityFilters({ tenantId = null, channel, provider, externalId }) {
    return {
      tenant_id: tenantId,
      channel,
      provider,
      external_id: externalId,
    };
  }

  identityPatch(existing = {}, input = {}) {
    const patch = {
      last_seen_at: nowIso(),
      display_name: input.display_name || existing.display_name,
      metadata: { ...(existing.metadata || {}), ...(input.metadata || {}) },
    };
    const normalizedAddress = this.normalizeAddress(existing.channel || input.channel, input.address || input.external_id || input.externalSenderId || existing.external_id);
    if (normalizedAddress) patch.normalized_address = normalizedAddress;
    const consent = input.consent_status || input.consent?.status || null;
    if (consent && consent !== 'unknown') patch.consent_status = consent;
    if (input.user_id && (existing.user_id === input.user_id || input.verified === true || input.authenticated === true)) {
      patch.user_id = input.user_id;
      patch.verified = Boolean(existing.verified || input.verified || input.authenticated);
    }
    return patch;
  }

  async updateExistingIdentity(existing, input = {}) {
    return this.repository.updateById('channel_identities', existing.id, this.identityPatch(existing, input));
  }

  async findIdentityByUniqueKey({ tenant_id: tenantId = null, channel, provider, external_id: externalId }) {
    const exact = await this.repository.findOne('channel_identities', {
      tenant_id: tenantId,
      channel,
      provider,
      external_id: externalId,
    });
    if (exact) return exact;

    const tenantKey = tenantId || 'platform';
    const normalizedAddress = this.normalizeAddress(channel, externalId);
    const matches = await this.repository.list('channel_identities', {
      channel,
      provider,
    }, { limit: 100 });
    return matches.find((identity) => {
      if ((identity.tenant_id || 'platform') !== tenantKey) return false;
      if (identity.external_id === externalId) return true;
      return Boolean(normalizedAddress && identity.normalized_address === normalizedAddress);
    }) || null;
  }

  async resolveOrCreateIdentity(input = {}) {
    const channel = normalizeChannel(input.channel);
    if (!channel) throw new Error('Unsupported communication channel.');
    const provider = input.provider || channel;
    const externalId = String(input.external_id || input.externalSenderId || input.sender_id || input.address || '').trim();
    if (!externalId) throw new Error('external_id is required for channel identity.');

    const tenantId = input.tenant_id || null;
    const filters = this.identityFilters({ tenantId, channel, provider, externalId });
    const existing = await this.findIdentityByUniqueKey(filters);

    if (existing) {
      return this.updateExistingIdentity(existing, input);
    }

    try {
      return await this.repository.insert('channel_identities', {
        tenant_id: tenantId,
        user_id: input.user_id || null,
        channel,
        provider,
        // Raw provider/user value remains the audit value; normalized_address is
        // the comparison/routing key.
        external_id: externalId,
        normalized_address: this.normalizeAddress(channel, input.address || externalId),
        display_name: input.display_name || null,
        verified: Boolean(input.verified || input.authenticated),
        consent_status: input.consent_status || input.consent?.status || 'unknown',
        first_seen_at: nowIso(),
        last_seen_at: nowIso(),
        metadata: {
          provenance: input.user_id ? 'authenticated_or_signed_context' : 'provider_inbound',
          identity_key: buildDedupeKey([tenantId || 'platform', channel, provider, this.normalizeAddress(channel, externalId) || externalId]),
          raw_external_id_preserved: true,
          ...(input.metadata || {}),
        },
      });
    } catch (error) {
      if (error.code !== '23505') throw error;
      const racedIdentity = await this.findIdentityByUniqueKey(filters);
      if (!racedIdentity) throw error;
      return this.updateExistingIdentity(racedIdentity, input);
    }
  }

  async linkIdentityToUser(identityId, userId, proof = {}) {
    const identity = await this.repository.findOne('channel_identities', { id: identityId });
    if (!identity) throw new Error('Channel identity not found.');
    if (!proof.verified && !proof.authenticated && !proof.adminApproved) {
      throw new Error('Unsafe identity merge rejected: verified proof or admin approval is required.');
    }
    const linked = await this.repository.updateById('channel_identities', identityId, {
      user_id: userId,
      verified: true,
      metadata: { ...(identity.metadata || {}), link_proof: proof },
    });
    await logCommunicationAuditEvent(this.repository, {
      tenant_id: identity.tenant_id ?? null, event_type: COMMUNICATION_AUDIT_EVENTS.IDENTITY_LINKED,
      actor_type: proof.adminApproved ? 'admin' : 'system', channel: identity.channel ?? null,
      summary: `Channel identity linked to user ${String(userId).slice(0, 8)}`,
      metadata: { identity_id: identityId, channel: identity.channel ?? null, proof: { verified: Boolean(proof.verified), authenticated: Boolean(proof.authenticated), admin_approved: Boolean(proof.adminApproved) } },
    });
    return linked;
  }
}
