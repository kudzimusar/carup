import { CHANNELS, normalizeChannel, nowIso } from './communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';

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

function clockMinutes(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function localClockMinutes(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  } catch (_error) {
    // Invalid/unknown timezone must not crash message routing. Fall back to UTC.
  }
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

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
    const allowedPatch = {};
    for (const key of Object.keys(DEFAULT_PREFS)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) allowedPatch[key] = patch[key];
    }
    // Quiet hours, timezone and language are existing governed preference columns even
    // though they are not part of the Boolean/default channel map above.
    for (const key of ['quiet_hours_start', 'quiet_hours_end', 'timezone', 'language', 'consent_source', 'consent_version', 'consented_at', 'withdrawn_at']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) allowedPatch[key] = patch[key];
    }
    const normalizedFallback = Array.isArray(patch.fallback_channels)
      ? patch.fallback_channels.map(normalizeChannel).filter(Boolean)
      : undefined;
    const row = {
      ...(existing || {}),
      ...allowedPatch,
      user_id: userId,
      tenant_id: tenantId,
      fallback_channels: normalizedFallback || existing?.fallback_channels || DEFAULT_PREFS.fallback_channels,
      preferred_channel: normalizeChannel(patch.preferred_channel) || patch.preferred_channel || existing?.preferred_channel || DEFAULT_PREFS.preferred_channel,
      updated_at: nowIso(),
    };
    const saved = existing
      ? await this.repository.updateById('communication_preferences', existing.id, row)
      : await this.repository.insert('communication_preferences', row);

    await logCommunicationAuditEvent(this.repository, {
      tenant_id: tenantId ?? null, event_type: COMMUNICATION_AUDIT_EVENTS.PREFERENCE_CHANGED,
      actor_type: 'customer', actor_id: userId, summary: 'Communication preferences updated',
      metadata: { changed: Object.keys(allowedPatch), preferred_channel: row.preferred_channel },
    });
    const consentChanged = ['consent_status', 'consent_source', 'consent_version', 'consented_at', 'withdrawn_at', 'marketing_enabled', 'transactional_enabled']
      .some((k) => Object.prototype.hasOwnProperty.call(patch, k));
    if (consentChanged) {
      await logCommunicationAuditEvent(this.repository, {
        tenant_id: tenantId ?? null, event_type: COMMUNICATION_AUDIT_EVENTS.CONSENT_CHANGED,
        actor_type: 'customer', actor_id: userId, summary: 'Consent/communication preference changed',
        metadata: {
          consent_status: patch.consent_status ?? null,
          marketing_enabled: patch.marketing_enabled ?? null,
          transactional_enabled: patch.transactional_enabled ?? null,
          consent_version: patch.consent_version ?? null,
        },
      });
    }
    return saved;
  }

  isInQuietHours(prefs = {}, at = new Date()) {
    const start = clockMinutes(prefs.quiet_hours_start);
    const end = clockMinutes(prefs.quiet_hours_end);
    if (start === null || end === null || start === end) return false;
    const current = localClockMinutes(at, prefs.timezone || 'UTC');
    if (start < end) return current >= start && current < end;
    // Overnight window, e.g. 22:00 -> 07:00.
    return current >= start || current < end;
  }

  isChannelAllowed(prefs, channel, { transactional = true, urgent = false, quietHoursBypass = false, at = new Date() } = {}) {
    const normalized = normalizeChannel(channel);
    if (!normalized) return false;
    if (!transactional && !prefs.marketing_enabled) return false;
    if (transactional && prefs.transactional_enabled === false && !urgent) return false;
    const key = `${normalized}_enabled`;
    const enabled = normalized === CHANNELS.IN_APP ? prefs.in_app_enabled !== false : prefs[key] === true;
    if (!enabled) return false;
    // Quiet hours suppress external/push interruption but do not hide the canonical
    // in-app conversation. Urgent/security policies may opt into bypass explicitly.
    if (normalized !== CHANNELS.IN_APP && this.isInQuietHours(prefs, at) && !quietHoursBypass && !urgent) return false;
    return true;
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
      urgent: policy.priority === 'urgent',
      quietHoursBypass: Boolean(policy.quietHoursBypass),
      at: policy.at || new Date(),
    }));
  }
}
