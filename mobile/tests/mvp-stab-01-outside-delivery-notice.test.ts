import { describe, expect, it, vi } from 'vitest';
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
  ChannelReadinessError,
  channelReadinessView,
  outsideDeliveryNotice,
  readChannelReadiness,
  type ChannelReadinessView,
} from '../utils/channelReadiness';

/**
 * CARUP-MVP-STAB-01 F-040 (Native) — the Inbox and a conversation said "WhatsApp or email can carry
 * messages" while CarUp's outbound kill switch was active. The line now follows the same /api/health
 * reading the preference switches use: a channel is named only when it can deliver right now.
 */
const PROVIDER: Record<string, string> = { whatsapp: 'meta_whatsapp_cloud_api', email: 'resend' };
function health(providers: Array<{ channel: string; status: string; available: boolean }>, outbound: Record<string, string>) {
  return {
    status: 'UP',
    communications: {
      status: 'READY', scheduler: { status: 'READY' }, fakeAdapters: { enabled: false, status: 'READY' },
      providers: providers.map((p) => ({ provider: PROVIDER[p.channel], ...p })),
      outbound: { internal_channels: 'enabled', control: 'COMMUNICATION_OUTBOUND_DISABLED', ...outbound },
    },
  };
}
const ALL_READY = [
  { channel: 'whatsapp', status: 'READY', available: true },
  { channel: 'email', status: 'READY', available: true },
];
async function view(body: unknown): Promise<ChannelReadinessView> {
  const capability = await readChannelReadiness({
    url: 'https://api.example.test/api/health',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }) as never,
  });
  return channelReadinessView({ data: capability, error: null, isPending: false });
}

describe('outside-delivery notice (CARUP-MVP-STAB-01 F-040)', () => {
  it('kill switch active (staging today): says CarUp is not sending outside the app, names no channel', async () => {
    const v = await view(health(ALL_READY, { kill_switch: 'active', external_sends: 'disabled' }));
    const line = outsideDeliveryNotice(v);
    expect(line).toBe("CarUp isn't sending messages outside the app right now, so replies arrive here.");
    expect(line).not.toMatch(/WhatsApp|email/);
  });

  it('names only the channels that can deliver right now', async () => {
    expect(outsideDeliveryNotice(await view(health(ALL_READY, { kill_switch: 'inactive', external_sends: 'enabled' }))))
      .toBe('CarUp may also deliver a message by WhatsApp or email; the conversation is always kept here.');
    expect(outsideDeliveryNotice(await view(health([ALL_READY[1], { channel: 'whatsapp', status: 'BLOCKED', available: false }], { kill_switch: 'inactive', external_sends: 'enabled' }))))
      .toBe('CarUp may also deliver a message by email; the conversation is always kept here.');
  });

  it('while checking, or after a failed reading, it claims nothing either way', () => {
    expect(outsideDeliveryNotice(channelReadinessView({ data: undefined, error: null, isPending: true }))).toBeNull();
    expect(outsideDeliveryNotice(channelReadinessView({ data: undefined, error: new ChannelReadinessError('x'), isPending: false }))).toBeNull();
  });

  it('the Inbox and the conversation screen use the reading, and the static claim is gone', () => {
    const inbox = readFileSync(resolve(__dirname, '../app/(tabs)/inbox.tsx'), 'utf8');
    const thread = readFileSync(resolve(__dirname, '../app/inbox/[threadId].tsx'), 'utf8');
    for (const source of [inbox, thread]) {
      expect(source).toContain('outsideDeliveryNotice(readiness)');
      expect(source).toContain('useChannelReadiness()');
      expect(source).not.toMatch(/WhatsApp or email can carry messages|Messages may also be delivered by WhatsApp or email/);
    }
  });
});
