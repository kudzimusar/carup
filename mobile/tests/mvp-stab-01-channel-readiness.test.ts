import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../store/authStore', () => ({
  useAuthStore: { getState: () => ({ token: 'test-session', user: { id: 'owner-a', role: 'owner' } }) },
}));
vi.mock('../utils/verificationApi', () => ({
  getVerificationApiBaseUrl: () => 'https://staging.example.test',
  fetchCsrfToken: async () => 'csrf-test',
}));

import {
  CHANNEL_HEALTH_TIMEOUT_MS,
  ChannelReadinessError,
  channelReadinessView,
  channelSwitchPresentation,
  preferenceChannelAvailability,
  readChannelReadiness,
  type ChannelReadinessView,
} from '../utils/channelReadiness';
import {
  canChangeChannelPreference,
  channelPreferenceChangeAllowed,
  type PreferenceViewState,
} from '../utils/communicationPreferences';

/**
 * CARUP-MVP-STAB-01 F-018 (Native) — a delivery preference switch looks operational only when CarUp's
 * current health reading says that channel can deliver. A saved preference is never provider readiness.
 */

const EXTERNAL_KEYS = ['push_enabled', 'email_enabled', 'whatsapp_enabled', 'telegram_enabled', 'sms_enabled'];

function health(overrides: Record<string, unknown> = {}) {
  return {
    status: 'UP',
    communications: {
      status: 'READY',
      scheduler: { status: 'READY' },
      fakeAdapters: { enabled: false, status: 'READY' },
      providers: [
        { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
        { channel: 'telegram', provider: 'telegram_bot_api', status: 'READY', available: true },
        { channel: 'email', provider: 'resend', status: 'READY', available: true },
        { channel: 'sms', provider: 'twilio', status: 'READY', available: true },
        { channel: 'push', provider: 'expo_push', status: 'READY', available: true },
      ],
      marketingEmail: { channel: 'email_marketing', provider: 'brevo', status: 'READY', available: true },
      outbound: { kill_switch: 'inactive', external_sends: 'enabled', internal_channels: 'enabled', control: 'COMMUNICATION_OUTBOUND_DISABLED' },
      ...overrides,
    },
  };
}

// Staging today: the outbound kill switch is active. Some providers are configured, some are not.
const STAGING_PAUSED = health({
  providers: [
    { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
    { channel: 'telegram', provider: 'telegram_bot_api', status: 'BLOCKED', available: false },
    { channel: 'email', provider: 'resend', status: 'READY', available: true },
    { channel: 'sms', provider: 'twilio', status: 'BLOCKED', available: false },
    { channel: 'push', provider: 'expo_push', status: 'READY', available: true },
  ],
  outbound: { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled', control: 'COMMUNICATION_OUTBOUND_DISABLED' },
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function viewFromHealth(body: unknown): Promise<ChannelReadinessView> {
  const capability = await readChannelReadiness({ url: 'https://api.example.test/api/health', fetchImpl: async () => jsonResponse(200, body) as never });
  return channelReadinessView({ data: capability, error: null, isPending: false });
}

async function failedRead(fetchImpl: (...args: never[]) => Promise<unknown>, timeoutMs?: number): Promise<ChannelReadinessError> {
  try {
    await readChannelReadiness({ url: 'https://api.example.test/api/health', fetchImpl: fetchImpl as never, timeoutMs });
  } catch (error) {
    if (error instanceof ChannelReadinessError) return error;
    throw error;
  }
  throw new Error('expected the health read to fail');
}

const UNKNOWN_VIEW: ChannelReadinessView = channelReadinessView({ data: undefined, error: new ChannelReadinessError('x'), isPending: false });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CARUP-MVP-STAB-01 F-018 · channel availability comes from CarUp health, never from a saved preference', () => {
  it('kill switch active: no external channel is available; in-app stays available', async () => {
    const view = await viewFromHealth(STAGING_PAUSED);
    for (const key of EXTERNAL_KEYS) {
      expect(preferenceChannelAvailability(view, key), key).not.toBe('available');
      expect(['temporarily_unavailable', 'setup_pending'], key).toContain(preferenceChannelAvailability(view, key));
      expect(channelSwitchPresentation(view, key).available, key).toBe(false);
    }
    expect(preferenceChannelAvailability(view, 'whatsapp_enabled')).toBe('temporarily_unavailable');
    expect(preferenceChannelAvailability(view, 'telegram_enabled')).toBe('setup_pending');
    expect(preferenceChannelAvailability(view, 'in_app_enabled')).toBe('available');
    expect(channelSwitchPresentation(view, 'in_app_enabled').available).toBe(true);
  });

  it('a paused or unconnected channel says so in plain words', async () => {
    const view = await viewFromHealth(STAGING_PAUSED);
    expect(channelSwitchPresentation(view, 'whatsapp_enabled')).toEqual({
      availability: 'temporarily_unavailable',
      available: false,
      statusLabel: 'Temporarily unavailable',
      explanation: "CarUp isn't sending outside the app right now. Your messages stay in your CarUp Inbox.",
    });
    expect(channelSwitchPresentation(view, 'sms_enabled')).toEqual({
      availability: 'setup_pending',
      available: false,
      statusLabel: 'Setup pending',
      explanation: 'Not set up for CarUp yet.',
    });
  });

  it('READY provider, scheduler READY, real adapters and external sends enabled: available', async () => {
    const view = await viewFromHealth(health());
    for (const key of [...EXTERNAL_KEYS, 'in_app_enabled']) {
      expect(preferenceChannelAvailability(view, key), key).toBe('available');
      expect(channelSwitchPresentation(view, key).available, key).toBe(true);
    }
  });

  it.each([
    ['scheduler not ready', { scheduler: { status: 'BLOCKED' } }],
    ['fake adapters on', { fakeAdapters: { enabled: true } }],
    ['provider not the certified one', { providers: [{ channel: 'whatsapp', provider: 'fake', status: 'READY', available: true }] }],
  ])('fails closed when %s', async (_name, overrides) => {
    const view = await viewFromHealth(health(overrides));
    expect(preferenceChannelAvailability(view, 'whatsapp_enabled')).not.toBe('available');
    expect(channelSwitchPresentation(view, 'whatsapp_enabled').available).toBe(false);
  });

  it('an unreadable health answer is a failed check, and every switch reads "Could not check"', async () => {
    expect((await failedRead(async () => jsonResponse(200, { status: 'UP' }))).name).toBe('ChannelReadinessError');
    await failedRead(async () => jsonResponse(503, { status: 'DOWN' }));
    await failedRead(async () => { throw new TypeError('Network request failed'); });
    await failedRead(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
    for (const key of [...EXTERNAL_KEYS, 'in_app_enabled']) {
      expect(preferenceChannelAvailability(UNKNOWN_VIEW, key), key).toBe('unknown');
      expect(channelSwitchPresentation(UNKNOWN_VIEW, key), key).toEqual({
        availability: 'unknown',
        available: false,
        statusLabel: 'Could not check',
        explanation: 'Could not check this channel right now.',
      });
    }
  });

  it('a check that does not answer in time is abandoned and treated as a failed check', async () => {
    const neverAnswers = (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    const started = Date.now();
    await failedRead(neverAnswers as never, 20);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(CHANNEL_HEALTH_TIMEOUT_MS).toBe(8000);
  });

  it('while the check runs, no channel is treated as available and every switch says it is checking', () => {
    const checking = channelReadinessView({ data: undefined, error: null, isPending: true });
    for (const key of [...EXTERNAL_KEYS, 'in_app_enabled']) {
      expect(channelSwitchPresentation(checking, key)).toEqual({ availability: 'checking', available: false, statusLabel: 'Checking…', explanation: null });
    }
  });

  it('a failed re-check never keeps showing an older "available" reading', async () => {
    const earlier = await readChannelReadiness({ url: 'https://api.example.test/api/health', fetchImpl: async () => jsonResponse(200, health()) as never });
    const view = channelReadinessView({ data: earlier, error: new ChannelReadinessError('re-check failed'), isPending: false });
    expect(preferenceChannelAvailability(view, 'email_enabled')).toBe('unknown');
  });

  it('reads /api/health on the configured CarUp origin, without any session or identity header', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test/');
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, health()));
    await readChannelReadiness({ fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/health');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['ngrok-skip-browser-warning']).toBe('true');
    for (const name of Object.keys(headers)) expect(name.toLowerCase()).not.toMatch(/session|user-id|tenant|stakeholder|authorization|csrf/);
    expect(init?.signal).toBeDefined();
  });

  it('a missing API origin is a failed check, and nothing is requested', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', '');
    const fetchImpl = vi.fn(async () => jsonResponse(200, health()));
    await expect(readChannelReadiness({ fetchImpl: fetchImpl as never })).rejects.toBeInstanceOf(ChannelReadinessError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a preference key CarUp does not deliver on is never offered', () => {
    expect(preferenceChannelAvailability(UNKNOWN_VIEW, 'line_enabled')).toBe('not_offered');
    expect(preferenceChannelAvailability(UNKNOWN_VIEW, 'constructor')).toBe('not_offered');
  });
});

describe('CARUP-MVP-STAB-01 F-018 · withdrawing consent is never blocked; turning a channel on needs a channel that works', () => {
  const ready: PreferenceViewState = { state: 'READY', preferences: { whatsapp_enabled: true } };
  const NOT_AVAILABLE = ['temporarily_unavailable', 'setup_pending', 'not_offered', 'checking', 'unknown'] as const;

  it('on → off is always allowed; off → on only while the channel is available', () => {
    expect(channelPreferenceChangeAllowed('available', true)).toBe(true);
    expect(channelPreferenceChangeAllowed('available', false)).toBe(true);
    for (const availability of NOT_AVAILABLE) {
      expect(channelPreferenceChangeAllowed(availability, false), `${availability}: on → off`).toBe(true);
      expect(channelPreferenceChangeAllowed(availability, true), `${availability}: off → on`).toBe(false);
    }
  });

  it('a switch that is ON stays operable whatever the availability, so it can be turned off; an OFF one waits for the channel', () => {
    for (const availability of NOT_AVAILABLE) {
      expect(canChangeChannelPreference(ready, availability, true), `${availability}: ON switch`).toBe(true);
      expect(canChangeChannelPreference(ready, availability, false), `${availability}: OFF switch`).toBe(false);
    }
    expect(canChangeChannelPreference(ready, 'available', true)).toBe(true);
    expect(canChangeChannelPreference(ready, 'available', false)).toBe(true);
  });

  it('nothing is changeable before the current preferences were read (D2), in either direction', () => {
    const unread: PreferenceViewState[] = [{ state: 'LOADING' }, { state: 'READ_FAILED', failure: 'network', statusCode: null }];
    for (const view of unread) {
      for (const current of [true, false]) {
        expect(canChangeChannelPreference(view, 'available', current), `${view.state} ${current}`).toBe(false);
        expect(canChangeChannelPreference(view, 'temporarily_unavailable', current), `${view.state} ${current}`).toBe(false);
      }
    }
  });

  it('staging with the kill switch active: WhatsApp ON can be turned off, WhatsApp OFF cannot be turned on', async () => {
    const view = await viewFromHealth(STAGING_PAUSED);
    const whatsapp = preferenceChannelAvailability(view, 'whatsapp_enabled');
    expect(whatsapp).toBe('temporarily_unavailable');
    expect(canChangeChannelPreference(ready, whatsapp, true)).toBe(true);
    expect(channelPreferenceChangeAllowed(whatsapp, false)).toBe(true);
    expect(canChangeChannelPreference(ready, whatsapp, false)).toBe(false);
    expect(channelPreferenceChangeAllowed(whatsapp, true)).toBe(false);
  });
});

describe('CARUP-MVP-STAB-01 F-018 · Account and Communications render availability on every switch', () => {
  const account = readFileSync(resolve(__dirname, '../app/(tabs)/account.tsx'), 'utf8');
  const messages = readFileSync(resolve(__dirname, '../app/(tabs)/communications.tsx'), 'utf8');

  function section(source: string, start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    expect(from, `marker not found: ${start}`).toBeGreaterThan(-1);
    expect(to, `marker not found after ${start}: ${end}`).toBeGreaterThan(from);
    return source.slice(from, to);
  }

  it.each([
    ['Account', account, '{CHANNELS.map(', '{preferenceError ? ('],
    ['Communications', messages, 'PREFERENCE_CHANNELS.map(', '{preferenceStatus ? '],
  ])('%s: an ON switch can always be turned off, an OFF one turns on only for an available channel, and the label shows either way', (_name, source, start, end) => {
    expect(source).toMatch(/useChannelReadiness\(/);
    const rows = section(source, start, end);
    expect(rows).toMatch(/const delivery = channelSwitchPresentation\(\s*readiness,\s*[\w.]+\s*\);/);
    expect(rows).toMatch(/const current = Boolean\(preferenceView\.preferences\[[\w.]+\]\);/);
    expect(rows).toMatch(/const changeable = canChangeChannelPreference\(\s*preferenceView,\s*delivery\.availability,\s*current\s*\);/);
    expect(rows).toMatch(/const disabled = Boolean\(saving\w+\) \|\| !changeable;/);
    expect(rows).toMatch(/\sdisabled=\{disabled\}/);
    expect(rows).toMatch(/\svalue=\{current\}/);
    expect(rows).toMatch(/accessibilityState=\{\{ disabled \}\}/);
    expect(rows).toMatch(/accessibilityHint=/);
    // The availability label and its reason depend on the channel only, never on whether the switch is ON.
    const label = section(rows, '{delivery.available ? ', '<Switch');
    expect(label).toMatch(/\.statusLabel\b/);
    expect(label).toMatch(/\.explanation\b/);
    expect(label).not.toMatch(/\bcurrent\b/);
  });

  it('Account no longer promises delivery "when this channel is available"', () => {
    expect(account).not.toContain('Delivery when this channel is available');
  });

  it('the save is guarded in code too: turning on an unavailable channel is refused, turning off never is', () => {
    expect(account).toMatch(/if \(savingChannel \|\| !channelPreferenceChangeAllowed\(preferenceChannelAvailability\(readiness, key\), value\)\) return;/);
    expect(messages).toMatch(/if \(savingKey \|\| !channelPreferenceChangeAllowed\(preferenceChannelAvailability\(readiness, key\), value\)\) return;/);
  });
});
