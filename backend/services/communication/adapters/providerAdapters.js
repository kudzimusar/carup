import { FakeCommunicationAdapter } from './fakeCommunicationAdapter.js';

class ConfigGatedAdapter {
  constructor({ channel, provider, requiredEnv = [], sendDisabledCode = 'provider_not_configured' }) {
    this.channel = channel;
    this.provider = provider;
    this.requiredEnv = requiredEnv;
    this.sendDisabledCode = sendDisabledCode;
  }

  validateConfiguration(env = process.env) {
    const missing = this.requiredEnv.filter((key) => !env[key]);
    return { available: missing.length === 0, channel: this.channel, provider: this.provider, missing };
  }

  async send() {
    const config = this.validateConfiguration();
    if (!config.available) {
      return {
        accepted: false,
        retryable: false,
        errorCode: this.sendDisabledCode,
        errorMessage: `${this.provider} adapter is not configured: ${config.missing.join(', ')}`,
      };
    }
    return {
      accepted: false,
      retryable: true,
      errorCode: 'live_provider_not_enabled_in_ci',
      errorMessage: `${this.provider} live delivery is configuration-gated. Add provider SDK/client wiring for production credentials.`,
    };
  }
}

export function createDefaultAdapterRegistry({ fakeAdapters = {}, env = process.env } = {}) {
  const allowFake = env.NODE_ENV !== 'production' || env.COMMUNICATION_FAKE_ADAPTERS_ENABLED === 'true';
  const registry = new Map();
  const put = (channel, adapter) => registry.set(channel, adapter);

  put('whatsapp', fakeAdapters.whatsapp || (allowFake
    ? new FakeCommunicationAdapter({ channel: 'whatsapp' })
    : new ConfigGatedAdapter({ channel: 'whatsapp', provider: 'meta_cloud_api', requiredEnv: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PHONE_NUMBER_ID'] })));
  put('instagram', fakeAdapters.instagram || new ConfigGatedAdapter({ channel: 'instagram', provider: 'meta_graph', requiredEnv: ['CARUP_META_ACCESS_TOKEN'] }));
  put('facebook', fakeAdapters.facebook || new ConfigGatedAdapter({ channel: 'facebook', provider: 'meta_graph', requiredEnv: ['CARUP_META_ACCESS_TOKEN'] }));
  put('telegram', fakeAdapters.telegram || (allowFake
    ? new FakeCommunicationAdapter({ channel: 'telegram' })
    : new ConfigGatedAdapter({ channel: 'telegram', provider: 'telegram_bot_api', requiredEnv: ['CARUP_TELEGRAM_BOT_TOKEN'] })));
  put('email', fakeAdapters.email || new ConfigGatedAdapter({ channel: 'email', provider: env.EMAIL_PROVIDER || 'smtp_or_brevo', requiredEnv: env.EMAIL_PROVIDER === 'smtp' ? ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] : ['BREVO_API_KEY'] }));
  put('sms', fakeAdapters.sms || new ConfigGatedAdapter({ channel: 'sms', provider: env.SMS_PROVIDER || 'configured_sms_provider', requiredEnv: ['SMS_PROVIDER'] }));
  put('push', fakeAdapters.push || new ConfigGatedAdapter({ channel: 'push', provider: env.PUSH_PROVIDER || 'expo_push', requiredEnv: ['EXPO_ACCESS_TOKEN'] }));
  put('in_app', fakeAdapters.in_app || new FakeCommunicationAdapter({ channel: 'in_app', provider: 'in_app' }));
  put('web_chat', fakeAdapters.web_chat || new FakeCommunicationAdapter({ channel: 'web_chat' }));
  put('mobile_chat', fakeAdapters.mobile_chat || new FakeCommunicationAdapter({ channel: 'mobile_chat' }));

  return {
    get(channel) { return registry.get(channel); },
    set(channel, adapter) { registry.set(channel, adapter); },
    entries() { return Array.from(registry.entries()); },
    health() {
      return Array.from(registry.entries()).map(([channel, adapter]) => ({ channel, ...adapter.validateConfiguration?.() }));
    },
  };
}

