import crypto from 'crypto';

export const CHANNELS = Object.freeze({
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
  EMAIL: 'email',
  SMS: 'sms',
  INSTAGRAM: 'instagram',
  FACEBOOK: 'facebook',
  WEB_CHAT: 'web_chat',
  MOBILE_CHAT: 'mobile_chat',
  IN_APP: 'in_app',
  PUSH: 'push',
});

export const THREAD_STATUSES = Object.freeze({
  OPEN: 'open',
  AWAITING_AI: 'awaiting_ai',
  AWAITING_HUMAN: 'awaiting_human',
  ASSIGNED: 'assigned',
  AWAITING_USER: 'awaiting_user',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
  SPAM: 'spam',
});

export const COMMUNICATION_EVENTS = Object.freeze({
  THREAD_CREATED: 'communication.thread.created',
  THREAD_ASSIGNED: 'communication.thread.assigned',
  THREAD_ESCALATED: 'communication.thread.escalated',
  THREAD_RESOLVED: 'communication.thread.resolved',
  THREAD_REOPENED: 'communication.thread.reopened',
  MESSAGE_RECEIVED: 'communication.message.received',
  MESSAGE_QUEUED: 'communication.message.queued',
  MESSAGE_SENT: 'communication.message.sent',
  MESSAGE_DELIVERED: 'communication.message.delivered',
  MESSAGE_FAILED: 'communication.message.failed',
  NOTIFICATION_QUEUED: 'communication.notification.queued',
  NOTIFICATION_DEAD_LETTERED: 'communication.notification.dead_lettered',
  WEBHOOK_RECEIVED: 'communication.webhook.received',
  WEBHOOK_DUPLICATE: 'communication.webhook.duplicate',
  FEEDBACK_RECEIVED: 'communication.feedback.received',
  REFERRAL_ATTRIBUTION_ATTACHED: 'communication.referral_attribution_attached',
  SHARE_LINK_CREATED: 'communication.share_link_created',
});

const CHANNEL_ALIASES = Object.freeze({
  wa: CHANNELS.WHATSAPP,
  whatsapp: CHANNELS.WHATSAPP,
  telegram: CHANNELS.TELEGRAM,
  tg: CHANNELS.TELEGRAM,
  email: CHANNELS.EMAIL,
  mail: CHANNELS.EMAIL,
  sms: CHANNELS.SMS,
  instagram: CHANNELS.INSTAGRAM,
  ig: CHANNELS.INSTAGRAM,
  facebook: CHANNELS.FACEBOOK,
  fb: CHANNELS.FACEBOOK,
  web: CHANNELS.WEB_CHAT,
  webchat: CHANNELS.WEB_CHAT,
  web_chat: CHANNELS.WEB_CHAT,
  mobile: CHANNELS.MOBILE_CHAT,
  mobilechat: CHANNELS.MOBILE_CHAT,
  mobile_chat: CHANNELS.MOBILE_CHAT,
  inapp: CHANNELS.IN_APP,
  in_app: CHANNELS.IN_APP,
  push: CHANNELS.PUSH,
});

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeChannel(channel) {
  const key = String(channel || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return CHANNEL_ALIASES[key] || null;
}

export function stableHash(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

function stableStringify(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

export function buildDedupeKey(parts) {
  return parts.filter((part) => part !== undefined && part !== null && part !== '').map(String).join(':');
}

export function redactPayload(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactPayload);
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (['authorization', 'token', 'secret', 'password', 'api_key', 'apikey', 'signature', 'card', 'cvv', 'pan'].some((needle) => lowered.includes(needle))) {
      out[key] = '[REDACTED]';
    } else if (typeof entry === 'object') {
      out[key] = redactPayload(entry);
    } else if (typeof entry === 'string' && entry.length > 500) {
      out[key] = `${entry.slice(0, 500)}...[TRUNCATED]`;
    } else {
      out[key] = entry;
    }
  }
  return out;
}

export function classifyError(result = {}) {
  if (result.accepted) return 'success';
  const code = String(result.errorCode || '').toLowerCase();
  if (result.retryable || ['timeout', 'network', 'rate_limited', 'provider_5xx', 'temporary_unavailable'].includes(code)) {
    return 'retryable';
  }
  return 'permanent';
}

export function calculateBackoffMs(attemptNumber, env = process.env) {
  const base = Number(env.COMMUNICATION_RETRY_BASE_MS || 60_000);
  const schedule = [0, base, base * 5, base * 30, base * 120];
  const selected = schedule[Math.max(0, Math.min(attemptNumber, schedule.length - 1))] || base * 120;
  const jitter = Math.floor(selected * 0.1);
  return selected + jitter;
}

export function addMinutes(minutes) {
  return new Date(Date.now() + Number(minutes || 0) * 60_000).toISOString();
}

export function computeSlaDue(priority, env = process.env) {
  const map = {
    urgent: env.COMMUNICATION_SLA_URGENT_MINUTES || 15,
    high: env.COMMUNICATION_SLA_HIGH_MINUTES || 60,
    normal: env.COMMUNICATION_SLA_NORMAL_MINUTES || 480,
    low: env.COMMUNICATION_SLA_LOW_MINUTES || 1440,
  };
  return addMinutes(map[priority] || map.normal);
}

export function isHumanHandoffRequired(text = '', context = {}) {
  const lowered = String(text || '').toLowerCase();
  const needles = [
    'human',
    'agent',
    'manager',
    'complaint',
    'fraud',
    'scam',
    'refund',
    'escrow release',
    'release escrow',
    'finance approved',
    'payment',
    'legal',
    'lawyer',
    'emergency',
    'unsafe',
  ];
  if (context.forceHuman) return true;
  return needles.some((needle) => lowered.includes(needle));
}

export function publicThreadProjection(thread) {
  if (!thread) return null;
  const { metadata, ...rest } = thread;
  return {
    ...rest,
    metadata: {
      intent: metadata?.intent,
      referral_code: metadata?.referral_code,
      public_reference: metadata?.public_reference,
    },
  };
}
