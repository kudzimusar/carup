import { CHANNELS, normalizeChannel, nowIso } from './communicationUtils.js';

const DEFAULT_PREFS = Object.freeze({
  transactional_enabled: true,
  marketing_enabled: false,
  whatsapp_enabled: false,
  telegram_enabled: false,
  email_enabled: true,
  sms_enabled: false,
  push_enabled: true,
  in_app_enabled: true,
  preferred_channel: 'in_app',
  fallback_channels: ['in_app', 'email', 'push'],
});

export class CommunicationPreferenceService {
  constructor({ repository }) {
    this.repository = repository;
  }

  async getPreferences(userId, tenantId = null) {
    if (!userId) return { ...DEFAULT_PREFS, user_id: null, tenant_id: tenantId };
    const existing = await this.repository.findOne('communication_preferences', { user_id: userId, tenant_id: tenantId });
    return { ...DEFAULT_PREFS, ...(existing || {}), fallback_channels: existing?.fallback_channels || DEFAULT_PREFS.fallback_channels, user_id: userId, tenant_id: tenantId };
  }

  async updatePreferences(userId, patch = {}, tenantId = null) {
    const existing = await this.repository.findOne('communication_preferences', { user_id: userId, tenant_id: tenantId });
    const normalizedFallback = Array.isArray(patch.fallback_channels)
      ? patch.fallback_channels.map(normalizeChannel).filter(Boolean)
      : undefined;
    const row = {
      ...(existing || {}),
      user_id: userId,
      tenant_id: tenantId,
      ...patch,
      fallback_channels: normalizedFallback || existing?.fallback_channels || DEFAULT_PREFS.fallback_channels,
      preferred_channel: normalizeChannel(patch.preferred_channel) || patch.preferred_channel || existing?.preferred_channel || DEFAULT_PREFS.preferred_channel,
      updated_at: nowIso(),
    };
    if (existing) return this.repository.updateById('communication_preferences', existing.id, row);
    return this.repository.insert('communication_preferences', row);
  }

  isChannelAllowed(prefs, channel, { transactional = true, urgent = false } = {}) {
    const normalized = normalizeChannel(channel);
    if (!normalized) return false;
    if (!transactional && !prefs.marketing_enabled) return false;
    if (transactional && prefs.transactional_enabled === false && !urgent) return false;
    const key = `${normalized}_enabled`;
    if (normalized === CHANNELS.IN_APP) return prefs.in_app_enabled !== false;
    return prefs[key] === true;
  }

  selectChannels(prefs, policy = {}) {
    const candidates = [
      prefs.preferred_channel,
      ...(policy.channels || []),
      ...(prefs.fallback_channels || []),
      ...(policy.fallbackChannels || []),
      CHANNELS.IN_APP,
    ].map(normalizeChannel).filter(Boolean);
    return [...new Set(candidates)].filter((channel) => this.isChannelAllowed(prefs, channel, {
      transactional: policy.transactional !== false,
      urgent: policy.priority === 'urgent' || policy.quietHoursBypass,
    }));
  }
}

