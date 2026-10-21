import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const auth = vi.hoisted(() => ({ token: 'buyer-session' as string | null }));
const csrf = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../store/authStore', () => ({
  useAuthStore: { getState: () => ({ token: auth.token, user: { id: 'buyer-1', role: 'owner' } }) },
}));
vi.mock('../utils/verificationApi', () => ({
  getVerificationApiBaseUrl: () => 'https://staging.example.test',
  fetchCsrfToken: async () => {
    csrf.calls += 1;
    return `csrf-${csrf.calls}`;
  },
}));

import { createMarketplaceInquiry, INQUIRY_SEND_TIMEOUT_MS, MarketplaceApiError } from '../utils/marketplaceApi';
import {
  buildInquiryPayload,
  canSendInquiry,
  createInquiryClientRequestId,
  createInquirySender,
  INQUIRY_MESSAGE_MAX_LENGTH,
  INQUIRY_MESSAGE_PLACEHOLDER,
  inquiryListingId,
  inquirySendFailure,
  normalizeInquiryMessage,
} from '../utils/inquiryComposer';

/**
 * CARUP-MVP-STAB-01 F-001 / F-002 (client) — "Message seller" must never write before the buyer
 * presses Send. Staging proof of the defect: inquiry 85b5921f (2026-10-21T03:52:36Z) was created
 * by one tap with a template message the buyer never wrote. The composer creates one
 * client_request_id per session, sends exactly once per tap, and retries with the same id.
 */

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolvePromise = res;
    rejectPromise = rej;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function apiError(statusCode: number | null, code: string | null = null) {
  return new MarketplaceApiError(`Marketplace API returned HTTP ${statusCode}`, statusCode, code);
}

describe('composer helpers', () => {
  it('creates a client_request_id shaped inq-<base36 time>-<random>, distinct per session', () => {
    const id = createInquiryClientRequestId(1_761_000_000_000, () => 0.5);
    expect(id).toMatch(/^inq-[0-9a-z]+-[0-9a-z]{12}$/);
    expect(id.startsWith(`inq-${(1_761_000_000_000).toString(36)}-`)).toBe(true);
    const many = new Set(Array.from({ length: 200 }, () => createInquiryClientRequestId()));
    expect(many.size).toBe(200);
    expect(createInquiryClientRequestId(0, () => 0.999999999)).toMatch(/^inq-0-[0-9a-z]{12}$/);
  });

  it('sends the buyer’s own words, trimmed only at the ends', () => {
    expect(normalizeInquiryMessage('  Is the service book available?\n\nThanks  \n')).toBe('Is the service book available?\n\nThanks');
    expect(normalizeInquiryMessage('   \n\t ')).toBe('');
    expect(normalizeInquiryMessage(undefined)).toBe('');
  });

  it('allows Send only for a signed-in buyer with real text who is not already sending or done', () => {
    const base = { text: 'Hello', signedIn: true, sending: false, sent: false };
    expect(canSendInquiry(base)).toBe(true);
    expect(canSendInquiry({ ...base, text: '   ' })).toBe(false);
    expect(canSendInquiry({ ...base, signedIn: false })).toBe(false);
    expect(canSendInquiry({ ...base, sending: true })).toBe(false);
    expect(canSendInquiry({ ...base, sent: true })).toBe(false);
    expect(canSendInquiry({ ...base, listingAvailable: false })).toBe(false);
    expect(canSendInquiry({ ...base, text: 'x'.repeat(INQUIRY_MESSAGE_MAX_LENGTH) })).toBe(true);
    expect(canSendInquiry({ ...base, text: 'x'.repeat(INQUIRY_MESSAGE_MAX_LENGTH + 1) })).toBe(false);
  });

  it('prefers the canonical VIN from the listing and falls back to the route VIN', () => {
    expect(inquiryListingId('JTDKB20U793456789', 'jtdkb20u793456789')).toBe('JTDKB20U793456789');
    expect(inquiryListingId(null, 'VIN-ROUTE')).toBe('VIN-ROUTE');
    expect(inquiryListingId('  ', ' VIN-ROUTE ')).toBe('VIN-ROUTE');
  });

  it('builds the exact inquiry body, with attribution only when a link carried it', () => {
    expect(buildInquiryPayload({
      listingId: 'VIN-1',
      message: '  When can I view it?  ',
      clientRequestId: 'inq-abc-123456789012',
      referralCode: 'AGENT_7',
      campaignCode: 'SPRING',
    })).toEqual({
      listing_id: 'VIN-1',
      inquiry_type: 'vehicle_purchase_interest',
      message: 'When can I view it?',
      client_request_id: 'inq-abc-123456789012',
      referral_code: 'AGENT_7',
      campaign_code: 'SPRING',
      metadata: { source_page: 'native_vehicle_detail' },
    });
    expect(buildInquiryPayload({ listingId: 'VIN-1', message: 'Hi', clientRequestId: 'inq-a-b', referralCode: '<bad>', campaignCode: null }))
      .toEqual({
        listing_id: 'VIN-1',
        inquiry_type: 'vehicle_purchase_interest',
        message: 'Hi',
        client_request_id: 'inq-a-b',
        metadata: { source_page: 'native_vehicle_detail' },
      });
  });

  it('explains every failure in plain words and never as the raw API error', () => {
    const cases: Array<[unknown, RegExp]> = [
      [new TypeError('Network request failed'), /connection/i],
      [Object.assign(new Error('request timed out after 20000 ms'), { name: 'NativeTimeoutError' }), /connection/i],
      [apiError(401), /sign in/i],
      [apiError(403), /account/i],
      [apiError(404), /no longer listed/i],
      [apiError(400), /cannot receive messages/i],
      [apiError(429), /wait/i],
      [apiError(500), /try again/i],
      [apiError(503), /try again/i],
    ];
    for (const [error, expected] of cases) {
      const failure = inquirySendFailure(error);
      expect(failure.message, String(error)).toMatch(expected);
      expect(failure.message).not.toMatch(/HTTP|API|\b[45]\d\d\b|governed|canonical|backend/i);
    }
    expect(inquirySendFailure(apiError(401)).needsSignIn).toBe(true);
    expect(inquirySendFailure(apiError(500)).needsSignIn).toBe(false);
  });
});

describe('createInquirySender — exactly one write per Send', () => {
  const resolved = async () => ({ state: 'resolved' as const, thread: { id: 'thread-1' } });

  it('a double tap fires exactly one request, and nothing after a success', async () => {
    const pending = deferred<{ inquiry: { id: string } }>();
    const create = vi.fn(() => pending.promise);
    const sender = createInquirySender({ create, resolveConversation: resolved, newClientRequestId: () => 'inq-session-1' });

    const first = sender.send({ listingId: 'VIN-1', message: 'Is it available?' });
    expect(sender.inFlight).toBe(true);
    expect(await sender.send({ listingId: 'VIN-1', message: 'Is it available?' })).toEqual({ kind: 'ignored', reason: 'in_flight' });
    expect(create).toHaveBeenCalledTimes(1);

    pending.resolve({ inquiry: { id: 'inquiry-1' } });
    expect(await first).toEqual({
      kind: 'sent',
      inquiryId: 'inquiry-1',
      replay: false,
      conversation: { state: 'resolved', threadId: 'thread-1' },
    });
    expect(await sender.send({ listingId: 'VIN-1', message: 'Is it available?' })).toEqual({ kind: 'ignored', reason: 'already_sent' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retries a failed send with the SAME client_request_id and the same words', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ inquiry: { id: 'inquiry-2' } });
    const ids = ['inq-session-2', 'inq-should-not-be-used'];
    const sender = createInquirySender({ create, resolveConversation: resolved, newClientRequestId: () => ids.shift()! });

    expect((await sender.send({ listingId: 'VIN-1', message: 'Still for sale?' })).kind).toBe('failed');
    expect(sender.inFlight).toBe(false);
    expect((await sender.send({ listingId: 'VIN-1', message: 'Still for sale?' })).kind).toBe('failed');
    expect((await sender.send({ listingId: 'VIN-1', message: 'Still for sale?' })).kind).toBe('sent');

    expect(create).toHaveBeenCalledTimes(3);
    const bodies = create.mock.calls.map(([payload]) => payload);
    expect(new Set(bodies.map((payload) => payload.client_request_id))).toEqual(new Set(['inq-session-2']));
    expect(new Set(bodies.map((payload) => payload.message))).toEqual(new Set(['Still for sale?']));
  });

  it('reports acceptance before the conversation lookup, exactly once', async () => {
    const events: string[] = [];
    const sender = createInquirySender({
      create: async () => {
        events.push('create');
        return { inquiry: { id: 'inquiry-8' } };
      },
      resolveConversation: async () => {
        events.push('lookup');
        return { state: 'pending' as const };
      },
      newClientRequestId: () => 'inq-session-8',
    });
    await sender.send({ listingId: 'VIN-1', message: 'Hi', onCreated: () => events.push('accepted') });
    await sender.send({ listingId: 'VIN-1', message: 'Hi', onCreated: () => events.push('accepted-again') });
    expect(events).toEqual(['create', 'accepted', 'lookup']);
    const failing = createInquirySender({ create: async () => { throw apiError(500); }, resolveConversation: resolved });
    const accepted = vi.fn();
    await failing.send({ listingId: 'VIN-1', message: 'Hi', onCreated: accepted });
    expect(accepted).not.toHaveBeenCalled();
  });

  it('treats a 200 replay like a first create', async () => {
    const sender = createInquirySender({
      create: async () => ({ inquiry: { id: 'inquiry-3' }, idempotent_replay: true }),
      resolveConversation: resolved,
      newClientRequestId: () => 'inq-session-3',
    });
    expect(await sender.send({ listingId: 'VIN-1', message: 'Hi' })).toMatchObject({ kind: 'sent', inquiryId: 'inquiry-3', replay: true });
  });

  it('a conversation still being prepared is a sent message, not a failure — and is never re-sent', async () => {
    const create = vi.fn(async () => ({ inquiry: { id: 'inquiry-4' } }));
    for (const resolveConversation of [
      async () => ({ state: 'pending' as const }),
      async () => {
        throw new Error('Communication API returned HTTP 500');
      },
    ]) {
      create.mockClear();
      const sender = createInquirySender({ create, resolveConversation, newClientRequestId: () => 'inq-session-4' });
      expect(await sender.send({ listingId: 'VIN-1', message: 'Hi' })).toEqual({
        kind: 'sent',
        inquiryId: 'inquiry-4',
        replay: false,
        conversation: { state: 'pending' },
      });
      expect(await sender.send({ listingId: 'VIN-1', message: 'Hi' })).toEqual({ kind: 'ignored', reason: 'already_sent' });
      expect(create).toHaveBeenCalledTimes(1);
    }
  });

  it('a 2xx without an inquiry id is sent; CarUp is still preparing the conversation', async () => {
    const resolveConversation = vi.fn(resolved);
    const sender = createInquirySender({ create: async () => ({}), resolveConversation, newClientRequestId: () => 'inq-session-5' });
    expect(await sender.send({ listingId: 'VIN-1', message: 'Hi' })).toEqual({
      kind: 'sent',
      inquiryId: null,
      replay: false,
      conversation: { state: 'pending' },
    });
    expect(resolveConversation).not.toHaveBeenCalled();
  });

  it('an idempotency mismatch means an earlier version already reached CarUp: stop, never create another', async () => {
    const create = vi.fn(async () => {
      throw apiError(409, 'INQUIRY_IDEMPOTENCY_MISMATCH');
    });
    const sender = createInquirySender({ create, resolveConversation: resolved, newClientRequestId: () => 'inq-session-6' });
    expect(await sender.send({ listingId: 'VIN-1', message: 'Edited words' })).toEqual({ kind: 'already_received' });
    expect(await sender.send({ listingId: 'VIN-1', message: 'Edited words' })).toEqual({ kind: 'ignored', reason: 'already_sent' });
    expect(create).toHaveBeenCalledTimes(1);
    // Any other 409 is an ordinary, retryable failure.
    const other = createInquirySender({ create: async () => { throw apiError(409, 'CONFLICT'); }, resolveConversation: resolved });
    expect((await other.send({ listingId: 'VIN-1', message: 'Hi' })).kind).toBe('failed');
  });

  it('never replays one account’s request id for another account', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(apiError(401))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce({ inquiry: { id: 'inquiry-7' } });
    const ids = ['inq-first', 'inq-second'];
    const sender = createInquirySender({ create, resolveConversation: resolved, newClientRequestId: () => ids.shift()! });
    await sender.send({ listingId: 'VIN-1', message: 'Hi', actorId: 'buyer-1' });
    await sender.send({ listingId: 'VIN-1', message: 'Hi', actorId: 'buyer-2' });
    await sender.send({ listingId: 'VIN-1', message: 'Hi', actorId: 'buyer-2' });
    expect(create.mock.calls.map(([payload]) => payload.client_request_id)).toEqual(['inq-first', 'inq-second', 'inq-second']);
  });

  it('does nothing for an empty message', async () => {
    const create = vi.fn();
    const sender = createInquirySender({ create, resolveConversation: resolved });
    expect(await sender.send({ listingId: 'VIN-1', message: '  ' })).toEqual({ kind: 'ignored', reason: 'empty' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('createMarketplaceInquiry — the API client', () => {
  type Call = { url: string; init?: RequestInit };
  let calls: Call[];

  function json(status: number, body: unknown): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  }

  beforeEach(() => {
    calls = [];
    auth.token = 'buyer-session';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const payload = buildInquiryPayload({
    listingId: 'VIN-API-1',
    message: 'Can I book a viewing?',
    clientRequestId: 'inq-api-000000000001',
    referralCode: 'AGENT_7',
  });

  it('POSTs the client_request_id, source page and the buyer’s words, as mobile', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return json(201, { inquiry: { id: 'inquiry-api-1', status: 'new', referral_attributed: true } });
    }));
    const result = await createMarketplaceInquiry(payload);
    expect(result.inquiry.id).toBe('inquiry-api-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://staging.example.test/api/marketplace/inquiries');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      listing_id: 'VIN-API-1',
      inquiry_type: 'vehicle_purchase_interest',
      message: 'Can I book a viewing?',
      client_request_id: 'inq-api-000000000001',
      referral_code: 'AGENT_7',
      metadata: { source_page: 'native_vehicle_detail' },
      source_channel: 'mobile',
    });
    expect((calls[0].init?.headers as Record<string, string>)['x-csrf-token']).toMatch(/^csrf-/);
  });

  it('treats a 200 idempotent replay as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { inquiry: { id: 'inquiry-api-1', status: 'new', referral_attributed: false }, idempotent_replay: true })));
    await expect(createMarketplaceInquiry(payload)).resolves.toMatchObject({ inquiry: { id: 'inquiry-api-1' }, idempotent_replay: true });
  });

  it('keeps the machine code of a refusal so a mismatch is never retried as new content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, {
      success: false,
      error: { code: 'INQUIRY_IDEMPOTENCY_MISMATCH', message: 'client_request_id was already used with different content' },
    })));
    const failure = await createMarketplaceInquiry(payload).catch((error) => error);
    expect(failure).toBeInstanceOf(MarketplaceApiError);
    expect(failure).toMatchObject({ statusCode: 409, code: 'INQUIRY_IDEMPOTENCY_MISMATCH' });
  });

  it('re-POSTs after a CSRF refresh with the identical body, so the server can de-duplicate it', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      attempt += 1;
      return attempt === 1 ? json(403, { error: 'CSRF token invalid' }) : json(201, { inquiry: { id: 'inquiry-api-2' } });
    }));
    await expect(createMarketplaceInquiry(payload)).resolves.toMatchObject({ inquiry: { id: 'inquiry-api-2' } });
    expect(calls).toHaveLength(2);
    expect(calls[1].init?.body).toBe(calls[0].init?.body);
    expect(JSON.parse(String(calls[1].init?.body)).client_request_id).toBe('inq-api-000000000001');
  });

  it('gives up on a hung send instead of leaving the buyer on “Sending” forever', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }));
    const outcome = createMarketplaceInquiry(payload).then(() => 'resolved', (error) => error);
    await vi.advanceTimersByTimeAsync(INQUIRY_SEND_TIMEOUT_MS + 10);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('NativeTimeoutError');
    expect(signal?.aborted).toBe(true);
    expect(inquirySendFailure(error).message).toMatch(/connection/i);
  });
});

describe('source integration — Message seller writes nothing; Send is explicit', () => {
  const read = (file: string) => readFileSync(resolve(file), 'utf8');
  const vehicle = read('app/vehicle/[vin].tsx');
  const composer = read('app/vehicle/[vin]/inquire.tsx');

  it('Vehicle Detail has no inquiry write at all; Message seller only opens the composer', () => {
    expect(vehicle).not.toContain('createMarketplaceInquiry');
    const start = vehicle.indexOf('const messageSeller = ');
    expect(start).toBeGreaterThan(-1);
    const body = vehicle.slice(start, vehicle.indexOf('};', start));
    expect(body).toContain('router.push(vehicleInquiryHref(');
    expect(body).not.toMatch(/await|fetch|create|Alert/);
    expect(vehicle).toMatch(/<Button label="Message seller" onPress=\{messageSeller\} \/>/);
  });

  it('the old one-tap template message is gone from the app', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|jsx?)$/.test(name)) files.push(path);
      }
    };
    walk(resolve('app'));
    walk(resolve('utils'));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/I am interested in this vehicle/i);
    }
  });

  it('the composer reads the same listing record the vehicle screen shows', () => {
    expect(composer).toContain("queryKey: ['marketplace-detail', vin]");
    expect(composer).toContain('getMarketplaceListingDetail(String(vin))');
    expect(vehicle).toContain("queryKey: ['marketplace-detail', vin]");
  });

  it('the composer starts empty and writes only on Send, through one sender held in a ref', () => {
    expect(composer).toMatch(/useState\(''\)/);
    expect(composer).toContain('placeholder={INQUIRY_MESSAGE_PLACEHOLDER}');
    expect(INQUIRY_MESSAGE_PLACEHOLDER).toBe('Write your message to the seller');
    expect(composer).toMatch(/useRef<InquirySender \| null>\(null\)/);
    expect(composer).toContain('createInquirySender(');
    expect(composer).not.toContain('createMarketplaceInquiry(buildInquiryPayload');
    // The only write is reached from the Send button.
    expect(composer.match(/\.send\(\{/g)).toHaveLength(1);
    expect(composer).toMatch(/label="Send"[\s\S]{0,200}onPress=\{\(\) => void sendMessage\(\)\}/);
    expect(composer).toMatch(/label="Cancel"/);
  });

  it('states where the message goes, offers sign-in that returns here, and tells the truth after Send', () => {
    for (const copy of [
      'Your message goes to the seller through CarUp.',
      'Sign in to send',
      'Message sent. CarUp is preparing the conversation — it will appear in your Inbox.',
      'Open Inbox',
      'Back to vehicle',
    ]) {
      expect(composer, copy).toContain(copy);
    }
    expect(composer).toContain('signInHref({ returnTo: composerHref })');
    expect(composer).toContain('resolveMarketplaceInquiryConversation');
    expect(composer).toContain("type: 'conversation'");
  });

  it('opens Inbox only from the sent state, never in place of a resolved conversation', () => {
    const sentState = composer.slice(composer.indexOf('function SentState('), composer.indexOf('function SentState(') + 2500);
    expect(composer.indexOf('function SentState(')).toBeGreaterThan(-1);
    expect(sentState).toContain('Open Inbox');
    expect(composer.split('Open Inbox')).toHaveLength(2);
    expect(composer).not.toContain("text: 'Open Inbox'");
  });
});

describe('the composer speaks plainly', () => {
  const INTERNAL = /\b(canonical|canonicaliz\w*|governed|authoritative|authority|projection|runtime|synthetic|payload|transport|backend|capability|capabilities|idempoten\w*|client_request_id)\b/i;

  function visibleProse(source: string): string[] {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
    const literals = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
      .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' '));
    const jsxText = [...code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((match) => match[1]);
    return [...literals, ...jsxText]
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter((value) => /[A-Za-z]{2,}\s+[A-Za-z]/.test(value) && !value.startsWith('/') && !value.includes('../'));
  }

  it.each(['app/vehicle/[vin]/inquire.tsx', 'utils/inquiryComposer.ts'])('%s shows no implementation language', (file) => {
    const prose = visibleProse(readFileSync(resolve(file), 'utf8'));
    expect(prose.length, 'anti-vacuity').toBeGreaterThan(5);
    expect(prose.filter((value) => INTERNAL.test(value) || /\bNative\b/.test(value))).toEqual([]);
  });
});
