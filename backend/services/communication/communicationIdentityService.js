import { buildDedupeKey, normalizeChannel, nowIso } from './communicationUtils.js';

export class CommunicationIdentityService {
  constructor({ repository }) {
    this.repository = repository;
  }

  normalizeAddress(channel, value) {
    const normalized = normalizeChannel(channel);
    if (!value) return null;
    const raw = String(value).trim();
    if (normalized === 'email') return raw.toLowerCase();
    if (normalized === 'sms' || normalized === 'whatsapp') return raw.replace(/[^\d+]/g, '');
    return raw;
  }

  async resolveOrCreateIdentity(input = {}) {
    const channel = normalizeChannel(input.channel);
    if (!channel) throw new Error('Unsupported communication channel.');
    const provider = input.provider || channel;
    const externalId = String(input.external_id || input.externalSenderId || input.sender_id || input.address || '').trim();
    if (!externalId) throw new Error('external_id is required for channel identity.');

    const tenantId = input.tenant_id || null;
    const existing = await this.repository.findOne('channel_identities', {
      tenant_id: tenantId,
      channel,
      provider,
      external_id: externalId,
    });

    if (existing) {
      const patch = {
        last_seen_at: nowIso(),
        display_name: input.display_name || existing.display_name,
        metadata: { ...(existing.metadata || {}), ...(input.metadata || {}) },
      };
      if (input.user_id && (existing.user_id === input.user_id || input.verified === true || input.authenticated === true)) {
        patch.user_id = input.user_id;
        patch.verified = Boolean(existing.verified || input.verified || input.authenticated);
      }
      return this.repository.updateById('channel_identities', existing.id, patch);
    }

    return this.repository.insert('channel_identities', {
      tenant_id: tenantId,
      user_id: input.user_id || null,
      channel,
      provider,
      external_id: externalId,
      normalized_address: this.normalizeAddress(channel, input.address || externalId),
      display_name: input.display_name || null,
      verified: Boolean(input.verified || input.authenticated),
      consent_status: input.consent_status || 'unknown',
      first_seen_at: nowIso(),
      last_seen_at: nowIso(),
      metadata: {
        provenance: input.user_id ? 'authenticated_or_signed_context' : 'provider_inbound',
        identity_key: buildDedupeKey([tenantId || 'platform', channel, provider, externalId]),
        ...(input.metadata || {}),
      },
    });
  }

  async linkIdentityToUser(identityId, userId, proof = {}) {
    const identity = await this.repository.findOne('channel_identities', { id: identityId });
    if (!identity) throw new Error('Channel identity not found.');
    if (!proof.verified && !proof.authenticated && !proof.adminApproved) {
      throw new Error('Unsafe identity merge rejected: verified proof or admin approval is required.');
    }
    return this.repository.updateById('channel_identities', identityId, {
      user_id: userId,
      verified: true,
      metadata: { ...(identity.metadata || {}), link_proof: proof },
    });
  }
}

