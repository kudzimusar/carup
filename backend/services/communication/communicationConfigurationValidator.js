import { createDefaultAdapterRegistry } from './adapters/providerAdapters.js';

export const COMMUNICATION_CONFIG_STATUS = Object.freeze({
  READY: 'READY',
  WARNING: 'WARNING',
  BLOCKED: 'BLOCKED',
});

const PROVIDER_REQUIREMENTS = Object.freeze([
  {
    channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api',
    requiredProviderSecrets: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PHONE_NUMBER_ID'],
    requiredWebhookSecrets: ['CARUP_META_WEBHOOK_VERIFY_TOKEN', 'CARUP_META_APP_SECRET'],
    requiredWebhookUrls: ['COMMUNICATION_WEBHOOK_BASE_URL_OR_CARUP_PUBLIC_API_URL'],
    webhookPath: '/api/communications/webhooks/meta/whatsapp',
  },
  {
    channel: 'facebook',
    provider: 'meta_messenger',
    requiredProviderSecrets: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PAGE_ID'],
    requiredWebhookSecrets: ['CARUP_META_WEBHOOK_VERIFY_TOKEN', 'CARUP_META_APP_SECRET'],
    requiredWebhookUrls: ['COMMUNICATION_WEBHOOK_BASE_URL_OR_CARUP_PUBLIC_API_URL'],
    webhookPath: '/api/communications/webhooks/meta/facebook',
  },
  {
    channel: 'instagram',
    provider: 'meta_instagram_messaging',
    requiredProviderSecrets: ['CARUP_META_ACCESS_TOKEN', 'CARUP_META_PAGE_ID'],
    requiredWebhookSecrets: ['CARUP_META_WEBHOOK_VERIFY_TOKEN', 'CARUP_META_APP_SECRET'],
    requiredWebhookUrls: ['COMMUNICATION_WEBHOOK_BASE_URL_OR_CARUP_PUBLIC_API_URL'],
    webhookPath: '/api/communications/webhooks/meta/instagram',
  },
  {
    channel: 'telegram',
    provider: 'telegram_bot_api',
    requiredProviderSecrets: ['CARUP_TELEGRAM_BOT_TOKEN'],
    requiredWebhookSecrets: ['CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN'],
    requiredWebhookUrls: ['COMMUNICATION_WEBHOOK_BASE_URL_OR_CARUP_PUBLIC_API_URL'],
    webhookPath: '/api/communications/webhooks/telegram/telegram',
  },
  {
    channel: 'email',
    provider: 'sendgrid',
    when: (env) => normalizedEnv(env, 'EMAIL_PROVIDER', 'sendgrid') !== 'cloudflare',
    requiredProviderSecrets: ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'],
    requiredWebhookSecrets: ['SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY'],
    requiredWebhookUrls: ['COMMUNICATION_WEBHOOK_BASE_URL_OR_CARUP_PUBLIC_API_URL'],
    webhookPath: '/api/communications/webhooks/sendgrid/email',
  },
  {
    channel: 'email',
    provider: 'cloudflare_email',
    when: (env) => normalizedEnv(env, 'EMAIL_PROVIDER') === 'cloudflare',
    requiredProviderSecrets: ['CLOUDFLARE_EMAIL_FROM'],
    anyProviderSecretGroups: [
      ['CLOUDFLARE_EMAIL_WORKER_URL', 'CLOUDFLARE_EMAIL_WORKER_SECRET'],
      ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_API_TOKEN'],
    ],
    requiredWebhookSecrets: ['CLOUDFLARE_EMAIL_INBOUND_SECRET'],
    requiredWebhookUrls: ['COMMUNICATION_WEBHOOK_BASE_URL_OR_CARUP_PUBLIC_API_URL'],
    webhookPath: '/api/communications/webhooks/cloudflare/email',
  },
  {
    channel: 'sms',
    provider: 'twilio',
    requiredProviderSecrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    anyProviderSecretGroups: [['TWILIO_MESSAGING_SERVICE_SID'], ['TWILIO_FROM_NUMBER']],
    requiredWebhookSecrets: [],
    requiredWebhookUrls: ['TWILIO_STATUS_CALLBACK_URL'],
    webhookPath: null,
  },
  {
    channel: 'push',
    provider: 'expo_push',
    requiredProviderSecrets: ['EXPO_ACCESS_TOKEN'],
    requiredWebhookSecrets: [],
    requiredWebhookUrls: [],
    webhookPath: null,
  },
]);

const SCHEDULER_SECRET_GROUPS = Object.freeze([
  ['COMMUNICATION_WORKER_SECRET'],
  ['CRON_SECRET'],
]);

function cleanValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function hasNonEmptyConfigValue(env = {}, key) {
  const value = cleanValue(env[key]);
  return Boolean(value && value !== "''" && value !== '""');
}

function normalizedEnv(env = {}, key, fallback = '') {
  return hasNonEmptyConfigValue(env, key) ? cleanValue(env[key]).toLowerCase() : fallback;
}

function missingKeys(env, keys = []) {
  return keys.filter((key) => !hasNonEmptyConfigValue(env, key));
}

function hasAnyGroup(env, groups = []) {
  return groups.some((group) => missingKeys(env, group).length === 0);
}

function missingAnyGroupLabels(env, groups = []) {
  if (!groups.length || hasAnyGroup(env, groups)) return [];
  return [groups.map((group) => group.join('+')).join(' OR ')];
}

function webhookBaseUrl(env = {}) {
  const base = cleanValue(env.COMMUNICATION_WEBHOOK_BASE_URL || env.CARUP_PUBLIC_API_URL || env.STAGING_API_BASE_URL);
  return base.replace(/\/+$/, '');
}

function missingWebhookUrl(env, key) {
  if (key === 'COMMUNICATION_WEBHOOK_BASE_URL_OR_CARUP_PUBLIC_API_URL') {
    return webhookBaseUrl(env) ? [] : [key];
  }
  return missingKeys(env, [key]);
}

function concreteWebhookUrl(env, path) {
  const base = webhookBaseUrl(env);
  return base && path ? `${base}${path}` : null;
}

function issue({ severity = COMMUNICATION_CONFIG_STATUS.BLOCKED, scope, code, message, keys = [] }) {
  return { severity, scope, code, message, keys };
}

function statusFromIssues(issues) {
  if (issues.some((entry) => entry.severity === COMMUNICATION_CONFIG_STATUS.BLOCKED)) return COMMUNICATION_CONFIG_STATUS.BLOCKED;
  if (issues.some((entry) => entry.severity === COMMUNICATION_CONFIG_STATUS.WARNING)) return COMMUNICATION_CONFIG_STATUS.WARNING;
  return COMMUNICATION_CONFIG_STATUS.READY;
}

function adapterHealth(adapter, env) {
  if (!adapter) return null;
  if (typeof adapter.validateConfiguration === 'function') return adapter.validateConfiguration(env);
  return { available: false, provider: adapter.provider || 'unknown', channel: adapter.channel || 'unknown', mode: 'unknown' };
}

function isFakeAdapter(adapter, health) {
  return health?.mode === 'fake' || adapter?.constructor?.name === 'FakeCommunicationAdapter' || adapter?.provider === 'fake';
}

export function validateCommunicationConfiguration({ env = process.env, adapterRegistry = null } = {}) {
  const registry = adapterRegistry || createDefaultAdapterRegistry({ env });
  const providerResults = [];
  const issues = [];

  const fakeAdaptersEnabled = env.COMMUNICATION_FAKE_ADAPTERS_ENABLED === 'true';
  if (fakeAdaptersEnabled) {
    issues.push(issue({
      severity: COMMUNICATION_CONFIG_STATUS.BLOCKED,
      scope: 'adapters',
      code: 'fake_adapters_enabled',
      message: 'COMMUNICATION_FAKE_ADAPTERS_ENABLED=true; production readiness requires fake adapters to be disabled.',
      keys: ['COMMUNICATION_FAKE_ADAPTERS_ENABLED'],
    }));
  }

  if (!hasAnyGroup(env, SCHEDULER_SECRET_GROUPS)) {
    issues.push(issue({
      scope: 'scheduler',
      code: 'scheduler_secret_missing',
      message: 'Communication scheduler/worker secret is missing. Set COMMUNICATION_WORKER_SECRET or CRON_SECRET.',
      keys: ['COMMUNICATION_WORKER_SECRET', 'CRON_SECRET'],
    }));
  }

  for (const requirement of PROVIDER_REQUIREMENTS) {
    if (requirement.when && !requirement.when(env)) continue;
    const adapter = registry.get?.(requirement.channel);
    const health = adapterHealth(adapter, env);
    const providerIssues = [];
    const providerSecretMissing = [
      ...missingKeys(env, requirement.requiredProviderSecrets),
      ...missingAnyGroupLabels(env, requirement.anyProviderSecretGroups),
    ];
    const webhookSecretMissing = missingKeys(env, requirement.requiredWebhookSecrets);
    const webhookUrlMissing = requirement.requiredWebhookUrls.flatMap((key) => missingWebhookUrl(env, key));

    if (providerSecretMissing.length) {
      providerIssues.push(issue({
        scope: requirement.channel,
        code: 'provider_secret_missing',
        message: `${requirement.channel} provider credentials are missing or empty: ${providerSecretMissing.join(', ')}.`,
        keys: providerSecretMissing,
      }));
    }

    if (webhookSecretMissing.length) {
      providerIssues.push(issue({
        scope: requirement.channel,
        code: 'webhook_secret_missing',
        message: `${requirement.channel} webhook secrets are missing or empty: ${webhookSecretMissing.join(', ')}.`,
        keys: webhookSecretMissing,
      }));
    }

    if (webhookUrlMissing.length) {
      providerIssues.push(issue({
        scope: requirement.channel,
        code: 'webhook_url_missing',
        message: `${requirement.channel} webhook URL configuration is missing: ${webhookUrlMissing.join(', ')}.`,
        keys: webhookUrlMissing,
      }));
    }

    if (!adapter) {
      providerIssues.push(issue({
        scope: requirement.channel,
        code: 'adapter_missing',
        message: `${requirement.channel} adapter is not registered.`,
      }));
    } else if (isFakeAdapter(adapter, health)) {
      providerIssues.push(issue({
        scope: requirement.channel,
        code: 'fake_adapter_active',
        message: `${requirement.channel} is using a fake adapter and cannot be claimed available.`,
      }));
    } else if (health?.provider && health.provider !== requirement.provider) {
      providerIssues.push(issue({
        severity: COMMUNICATION_CONFIG_STATUS.WARNING,
        scope: requirement.channel,
        code: 'adapter_provider_mismatch',
        message: `${requirement.channel} adapter provider is ${health.provider}; expected ${requirement.provider}.`,
      }));
    }

    const providerStatus = statusFromIssues(providerIssues);
    issues.push(...providerIssues);
    providerResults.push({
      channel: requirement.channel,
      provider: requirement.provider,
      status: providerStatus,
      available: providerStatus === COMMUNICATION_CONFIG_STATUS.READY,
      adapterMode: health?.mode || null,
      adapterProvider: health?.provider || null,
      webhookUrl: concreteWebhookUrl(env, requirement.webhookPath),
      explanations: providerIssues.map((entry) => entry.message),
      missing: {
        providerSecrets: providerSecretMissing,
        webhookSecrets: webhookSecretMissing,
        webhookUrls: webhookUrlMissing,
      },
    });
  }

  if (env.COMMUNICATION_ENGINE_ENABLED !== 'true') {
    issues.push(issue({
      severity: COMMUNICATION_CONFIG_STATUS.WARNING,
      scope: 'engine',
      code: 'engine_not_explicitly_enabled',
      message: 'COMMUNICATION_ENGINE_ENABLED is not true; communication event fanout may remain disabled.',
      keys: ['COMMUNICATION_ENGINE_ENABLED'],
    }));
  }

  const status = statusFromIssues(issues);
  return {
    status,
    ready: status === COMMUNICATION_CONFIG_STATUS.READY,
    generatedAt: new Date().toISOString(),
    explanations: issues.length
      ? issues.map((entry) => entry.message)
      : ['Communication configuration is ready.'],
    issues,
    scheduler: {
      status: hasAnyGroup(env, SCHEDULER_SECRET_GROUPS) ? COMMUNICATION_CONFIG_STATUS.READY : COMMUNICATION_CONFIG_STATUS.BLOCKED,
      requiredAnyOf: SCHEDULER_SECRET_GROUPS.map((group) => group.join('+')),
    },
    fakeAdapters: {
      enabled: fakeAdaptersEnabled,
      status: fakeAdaptersEnabled ? COMMUNICATION_CONFIG_STATUS.BLOCKED : COMMUNICATION_CONFIG_STATUS.READY,
    },
    providers: providerResults,
  };
}

export function createCommunicationConfigurationValidator({ env = process.env, adapterRegistry = null } = {}) {
  return {
    validate(overrides = {}) {
      return validateCommunicationConfiguration({
        env: overrides.env || env,
        adapterRegistry: overrides.adapterRegistry || adapterRegistry,
      });
    },
  };
}
