import crypto from 'crypto';
import { FakeCommunicationAdapter } from './fakeCommunicationAdapter.js';

const DEFAULT_TIMEOUT_MS = 10_000;

function envValue(env, key) {
  const value = env?.[key];
  return value === undefined || value === null || value === '' ? null : String(value);
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || null;
}

function missingEnv(requiredEnv, env) {
  return requiredEnv.filter((key) => !envValue(env, key));
}

function jsonHeaders(extra = {}) {
  return { 'content-type': 'application/json', ...extra };
}

function stableRequestId(prefix, input) {
  return `${prefix}_${crypto
    .createHash('sha256')
    .update(String(input.idempotencyKey || input.messageId || input.notificationId || Date.now()))
    .digest('hex')
    .slice(0, 24)}`;
}

function recipientField(input, ...keys) {
  const data = input?.content?.data || {};
  const recipient = input?.recipient || {};
  for (const key of keys) {
    const value = firstPresent(recipient[key], data[key], data.recipient?.[key]);
    if (value) return String(value);
  }
  return null;
}

function textBody(input) {
  return String(input?.content?.body || input?.content?.text || '').trim();
}

function subjectText(input, fallback = 'CarUp notification') {
  return String(input?.content?.subject || fallback).trim();
}

function parseProviderError(status, body) {
  const text = typeof body === 'string' ? body : body?.message || body?.error?.message || body?.errors?.[0]?.message || JSON.stringify(body || {});
  if (status === 429) return { retryable: true, errorCode: 'rate_limited', errorMessage: text || 'Provider rate limit' };
  if (status >= 500) return { retryable: true, errorCode: 'provider_5xx', errorMessage: text || 'Provider temporary failure' };
  if ([401, 403].includes(status)) return { retryable: false, errorCode: 'invalid_credentials', errorMessage: 'Provider authentication failed' };
  if ([400, 404, 422].includes(status)) return { retryable: false, errorCode: 'provider_rejected', errorMessage: text || 'Provider rejected request' };
  return { retryable: false, errorCode: 'provider_error', errorMessage: text || `Provider returned HTTP ${status}` };
}

export class HttpCommunicationAdapter {
  constructor({ channel, provider, requiredEnv = [], env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.channel = channel;
    this.provider = provider;
    this.requiredEnv = requiredEnv;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  validateConfiguration(env = this.env) {
    const missing = missingEnv(this.requiredEnv, env);
    return { available: missing.length === 0, channel: this.channel, provider: this.provider, mode: 'real', missing };
  }

  missingConfigurationResult() {
    const config = this.validateConfiguration();
    return {
      accepted: false,
      retryable: false,
      errorCode: 'provider_not_configured',
      errorMessage: `${this.provider} adapter is not configured: ${config.missing.join(', ')}`,
    };
  }

  async requestJson(url, { method = 'POST', headers = {}, body = undefined, basicAuth = null } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const finalHeaders = { ...headers };
    if (basicAuth) finalHeaders.authorization = `Basic ${Buffer.from(basicAuth).toString('base64')}`;
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (_error) {
          parsed = text;
        }
      }
      return { ok: response.ok, status: response.status, body: parsed, headers: response.headers };
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { ok: false, status: 0, networkError: true, errorCode: 'timeout', errorMessage: 'Provider request timed out', retryable: true };
      }
      return { ok: false, status: 0, networkError: true, errorCode: 'network', errorMessage: error?.message || 'Provider network failure', retryable: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  providerFailure(response) {
    if (response.networkError) {
      return {
        accepted: false,
        retryable: response.retryable !== false,
        errorCode: response.errorCode || 'network',
        errorMessage: response.errorMessage || 'Provider network failure',
      };
    }
    return { accepted: false, ...parseProviderError(response.status, response.body) };
  }
}

export class SendGridEmailAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'email', provider: 'sendgrid', requiredEnv: ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'email', 'address', 'to');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Email recipient address is required.' };
    const response = await this.requestJson('https://api.sendgrid.com/v3/mail/send', {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'SENDGRID_API_KEY')}` }),
      body: {
        personalizations: [{ to: [{ email: to }], custom_args: { notification_id: String(input.notificationId || ''), message_id: String(input.messageId || '') } }],
        from: { email: envValue(this.env, 'SENDGRID_FROM_EMAIL'), name: envValue(this.env, 'SENDGRID_FROM_NAME') || 'CarUp' },
        subject: subjectText(input),
        content: [{ type: 'text/plain', value: textBody(input) }],
        tracking_settings: { click_tracking: { enable: false, enable_text: false } },
      },
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.headers?.get?.('x-message-id') || stableRequestId('sendgrid', input),
      providerMessageId: response.headers?.get?.('x-message-id') || null,
      providerStatus: 'accepted',
    };
  }
}

export class TwilioSmsAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'sms', provider: 'twilio', requiredEnv: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], ...options });
  }

  validateConfiguration(env = this.env) {
    const missing = missingEnv(this.requiredEnv, env);
    if (!envValue(env, 'TWILIO_MESSAGING_SERVICE_SID') && !envValue(env, 'TWILIO_FROM_NUMBER')) missing.push('TWILIO_MESSAGING_SERVICE_SID_OR_TWILIO_FROM_NUMBER');
    return { available: missing.length === 0, channel: this.channel, provider: this.provider, mode: 'real', missing };
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'phoneNumber', 'phone_number', 'phone', 'to', 'address');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'SMS recipient phone number is required.' };
    const params = new URLSearchParams({ To: to, Body: textBody(input), StatusCallback: envValue(this.env, 'TWILIO_STATUS_CALLBACK_URL') || '' });
    const messagingServiceSid = envValue(this.env, 'TWILIO_MESSAGING_SERVICE_SID');
    if (messagingServiceSid) params.set('MessagingServiceSid', messagingServiceSid);
    else params.set('From', envValue(this.env, 'TWILIO_FROM_NUMBER'));
    return this.sendUrlEncoded(input, params);
  }

  async sendUrlEncoded(input, params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const accountSid = envValue(this.env, 'TWILIO_ACCOUNT_SID');
    try {
      const response = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${accountSid}:${envValue(this.env, 'TWILIO_AUTH_TOKEN')}`).toString('base64')}`,
        },
        body: params.toString(),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) return this.providerFailure({ status: response.status, body });
      return {
        accepted: true,
        providerRequestId: body?.sid || stableRequestId('twilio', input),
        providerMessageId: body?.sid || null,
        providerStatus: body?.status || 'accepted',
      };
    } catch (error) {
      return {
        accepted: false,
        retryable: error?.name === 'AbortError' || error?.retryable !== false,
        errorCode: error?.name === 'AbortError' ? 'timeout' : 'network',
        errorMessage: error?.message || 'Twilio request failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class MetaWhatsAppAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', requiredEnv: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PHONE_NUMBER_ID'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'phoneNumber', 'phone_number', 'phone', 'to', 'address');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'WhatsApp recipient phone number is required.' };
    const phoneNumberId = envValue(this.env, 'CARUP_META_PHONE_NUMBER_ID');
    const response = await this.requestJson(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`, {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'CARUP_META_ACCESS_TOKEN')}` }),
      body: { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: textBody(input) } },
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.body?.messages?.[0]?.id || stableRequestId('meta_wa', input),
      providerMessageId: response.body?.messages?.[0]?.id || null,
      providerStatus: 'accepted',
    };
  }
}

export class FacebookMessengerAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'facebook', provider: 'meta_messenger', requiredEnv: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PAGE_ID'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const recipientId = recipientField(input, 'externalId', 'external_id', 'facebook_psid', 'page_scoped_id', 'to', 'address');
    if (!recipientId) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Facebook Messenger recipient PSID is required.' };
    const response = await this.requestJson('https://graph.facebook.com/v20.0/me/messages', {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'CARUP_META_ACCESS_TOKEN')}` }),
      body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: textBody(input) } },
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.body?.message_id || stableRequestId('meta_fb', input),
      providerMessageId: response.body?.message_id || null,
      providerStatus: 'accepted',
    };
  }
}

export class InstagramMessagingAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'instagram', provider: 'meta_instagram_messaging', requiredEnv: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PAGE_ID'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const recipientId = recipientField(input, 'externalId', 'external_id', 'instagram_scoped_id', 'to', 'address');
    if (!recipientId) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Instagram recipient scoped ID is required.' };
    const pageId = envValue(this.env, 'CARUP_META_PAGE_ID');
    const response = await this.requestJson(`https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/messages`, {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'CARUP_META_ACCESS_TOKEN')}` }),
      body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: textBody(input) } },
    });
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.body?.message_id || stableRequestId('meta_ig', input),
      providerMessageId: response.body?.message_id || null,
      providerStatus: 'accepted',
    };
  }
}

export class TelegramBotAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'telegram', provider: 'telegram_bot_api', requiredEnv: ['CARUP_TELEGRAM_BOT_TOKEN'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const chatId = recipientField(input, 'telegramChatId', 'telegram_chat_id', 'chat_id', 'externalId', 'external_id', 'to', 'address');
    if (!chatId) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Telegram chat ID is required.' };
    const token = envValue(this.env, 'CARUP_TELEGRAM_BOT_TOKEN');
    const response = await this.requestJson(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      headers: jsonHeaders(),
      body: { chat_id: chatId, text: textBody(input), disable_web_page_preview: true },
    });
    if (!response.ok || response.body?.ok === false) return this.providerFailure({ status: response.status || 400, body: response.body });
    return {
      accepted: true,
      providerRequestId: response.body?.result?.message_id ? String(response.body.result.message_id) : stableRequestId('telegram', input),
      providerMessageId: response.body?.result?.message_id ? String(response.body.result.message_id) : null,
      providerStatus: 'sent',
    };
  }
}

export class ExpoPushAdapter extends HttpCommunicationAdapter {
  constructor(options = {}) {
    super({ channel: 'push', provider: 'expo_push', requiredEnv: ['EXPO_ACCESS_TOKEN'], ...options });
  }

  async send(input = {}) {
    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const to = recipientField(input, 'expoPushToken', 'expo_push_token', 'pushToken', 'push_token', 'to', 'address');
    if (!to) return { accepted: false, retryable: false, errorCode: 'recipient_missing', errorMessage: 'Expo push token is required.' };
    const response = await this.requestJson('https://exp.host/--/api/v2/push/send', {
      headers: jsonHeaders({ authorization: `Bearer ${envValue(this.env, 'EXPO_ACCESS_TOKEN')}` }),
      body: [{ to, title: subjectText(input), body: textBody(input), data: input.content?.data || {} }],
    });
    if (!response.ok) return this.providerFailure(response);
    const ticket = Array.isArray(response.body?.data) ? response.body.data[0] : response.body?.data;
    if (ticket?.status === 'error') {
      const code = String(ticket.details?.error || ticket.message || 'expo_rejected').toLowerCase();
      return { accepted: false, retryable: ['messageratelimited', 'unknown'].includes(code), errorCode: code, errorMessage: ticket.message || 'Expo rejected push notification' };
    }
    return {
      accepted: true,
      providerRequestId: ticket?.id || stableRequestId('expo', input),
      providerMessageId: ticket?.id || null,
      providerStatus: ticket?.status || 'accepted',
    };
  }
}

export function createDefaultAdapterRegistry({ fakeAdapters = {}, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const allowFake = env.NODE_ENV !== 'production' || env.COMMUNICATION_FAKE_ADAPTERS_ENABLED === 'true';
  const realOptions = { env, fetchImpl };
  const registry = new Map();
  const put = (channel, adapter) => registry.set(channel, adapter);
  const configured = (channel, realAdapter) => fakeAdapters[channel] || (allowFake
    ? new FakeCommunicationAdapter({ channel })
    : realAdapter);

  put('whatsapp', configured('whatsapp', new MetaWhatsAppAdapter(realOptions)));
  put('telegram', configured('telegram', new TelegramBotAdapter(realOptions)));
  put('email', configured('email', new SendGridEmailAdapter(realOptions)));
  put('sms', configured('sms', new TwilioSmsAdapter(realOptions)));
  put('instagram', configured('instagram', new InstagramMessagingAdapter(realOptions)));
  put('facebook', configured('facebook', new FacebookMessengerAdapter(realOptions)));
  put('push', configured('push', new ExpoPushAdapter(realOptions)));
  put('in_app', fakeAdapters.in_app || new FakeCommunicationAdapter({ channel: 'in_app', provider: 'in_app' }));
  put('web_chat', fakeAdapters.web_chat || new FakeCommunicationAdapter({ channel: 'web_chat' }));
  put('mobile_chat', fakeAdapters.mobile_chat || new FakeCommunicationAdapter({ channel: 'mobile_chat' }));

  return {
    get(channel) { return registry.get(channel); },
    set(channel, adapter) { registry.set(channel, adapter); },
    entries() { return Array.from(registry.entries()); },
    health() {
      return Array.from(registry.entries()).map(([channel, adapter]) => ({ channel, ...adapter.validateConfiguration?.(env) }));
    },
  };
}
