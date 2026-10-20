import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../utils/apiBase', () => ({
  apiUrl: (path: string) => `https://staging.example.test${path}`,
  resolveApiBaseUrl: () => 'https://staging.example.test',
}));

import {
  readCanonicalTransactions,
  safePayFailureCopy,
  safePayViewState,
  SafePayReadError,
  shouldRetrySafePayRead,
  type SafePayViewState,
} from '../utils/safePayTransactions';

function response(status: number, body: unknown, { invalidJson = false } = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (invalidJson) throw new SyntaxError('Unexpected token < in JSON');
      return body;
    },
  } as unknown as Response;
}

const row = (id: string, status: string) => ({
  transaction_intent_id: id,
  vin: `VIN-${id}`,
  status,
  listing_amount: 1000,
  listing_currency: 'USD',
  gate_reasons: [],
  payment_state: 'not_started',
  reservation_state: null,
  deposit_eligibility: null,
  created_at: null,
  updated_at: null,
});

function failedCopy(view: SafePayViewState) {
  if (view.state !== 'READ_FAILED') throw new Error(`expected READ_FAILED, got ${view.state}`);
  return safePayFailureCopy(view);
}

async function failureOf(promise: Promise<unknown>): Promise<SafePayReadError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SafePayReadError) return error;
    throw error;
  }
  throw new Error('expected the read to fail');
}

describe('OC-NATIVE-FINAL-02-R1 D1 · SafePay read: one truthful state per server answer', () => {
  it('sends one session-authenticated GET to the canonical list and never an asserted identity', async () => {
    const fetchImpl = vi.fn(async () => response(200, { sessions: [] }));
    await readCanonicalTransactions('session-token', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://staging.example.test/api/escrow');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-session-token']).toBe('session-token');
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('x-user-id');
    expect((init.method || 'GET').toUpperCase()).toBe('GET');
  });

  it('200 with an empty list is a confirmed empty state', async () => {
    const data = await readCanonicalTransactions('t', (async () => response(200, { sessions: [] })) as unknown as typeof fetch);
    expect(data).toEqual([]);
    expect(safePayViewState({ isPending: false, data, error: null })).toEqual({
      state: 'READY_EMPTY', total: 0, inProgress: 0,
    });
  });

  it('200 with rows is a confirmed transaction state with server-derived counts', async () => {
    const rows = [row('a', 'funds_held'), row('b', 'settled'), row('c', 'eligible')];
    const data = await readCanonicalTransactions('t', (async () => response(200, { sessions: rows })) as unknown as typeof fetch);
    const view = safePayViewState({ isPending: false, data, error: null });
    expect(view.state).toBe('READY_WITH_TRANSACTIONS');
    if (view.state !== 'READY_WITH_TRANSACTIONS') throw new Error('unreachable');
    expect(view.total).toBe(3);
    expect(view.inProgress).toBe(2);
    expect(view.transactions.map((t) => t.transaction_intent_id)).toEqual(['a', 'b', 'c']);
  });

  it('401 is an authentication state that asks the person to sign in again', async () => {
    const error = await failureOf(readCanonicalTransactions('t', (async () => response(401, { error: 'Unauthorized' })) as unknown as typeof fetch));
    expect(error.kind).toBe('unauthenticated');
    expect(error.statusCode).toBe(401);
    const view = safePayViewState({ isPending: false, data: undefined, error });
    expect(view).toEqual({ state: 'READ_FAILED', failure: 'unauthenticated', statusCode: 401 });
    expect(failedCopy(view).action).toBe('sign_in');
  });

  it('403 is an authority state, not an outage and not an empty list', async () => {
    const error = await failureOf(readCanonicalTransactions('t', (async () => response(403, { error: 'Forbidden' })) as unknown as typeof fetch));
    expect(error.kind).toBe('forbidden');
    const view = safePayViewState({ isPending: false, data: undefined, error });
    expect(view).toEqual({ state: 'READ_FAILED', failure: 'forbidden', statusCode: 403 });
    expect(failedCopy(view).action).toBe('none');
  });

  it('5xx is an unavailable state that carries no count at all', async () => {
    const error = await failureOf(readCanonicalTransactions('t', (async () => response(503, {})) as unknown as typeof fetch));
    expect(error.kind).toBe('unavailable');
    expect(error.statusCode).toBe(503);
    const view = safePayViewState({ isPending: false, data: undefined, error });
    expect(view).toEqual({ state: 'READ_FAILED', failure: 'unavailable', statusCode: 503 });
    expect(view).not.toHaveProperty('total');
    expect(view).not.toHaveProperty('inProgress');
    const copy = failedCopy(view);
    expect(copy.action).toBe('retry');
    expect(`${copy.title} ${copy.body}`).not.toMatch(/\b0\b/);
  });

  it('a request that never reaches CarUp is a device/network state, distinct from a server answer', async () => {
    const error = await failureOf(readCanonicalTransactions('t', (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch));
    expect(error.kind).toBe('network');
    expect(error.statusCode).toBeNull();
    const view = safePayViewState({ isPending: false, data: undefined, error });
    expect(view).toEqual({ state: 'READ_FAILED', failure: 'network', statusCode: null });
    expect(failedCopy(view).action).toBe('retry');
  });

  it('a 200 whose body is not the canonical list is a failed read, never an empty list', async () => {
    const missing = await failureOf(readCanonicalTransactions('t', (async () => response(200, { rows: [] })) as unknown as typeof fetch));
    expect(missing.kind).toBe('malformed');
    const invalid = await failureOf(readCanonicalTransactions('t', (async () => response(200, null, { invalidJson: true })) as unknown as typeof fetch));
    expect(invalid.kind).toBe('malformed');
    expect(safePayViewState({ isPending: false, data: undefined, error: missing }).state).toBe('READ_FAILED');
  });

  it('a read in flight is a loading state with no count', () => {
    expect(safePayViewState({ isPending: true, data: undefined, error: null })).toEqual({ state: 'LOADING' });
  });

  it('retries only failures a retry can fix', () => {
    const err = (kind: SafePayReadError['kind']) => new SafePayReadError(kind, kind === 'unavailable' ? 503 : null, 'x');
    expect(shouldRetrySafePayRead(0, err('network'))).toBe(true);
    expect(shouldRetrySafePayRead(0, err('unavailable'))).toBe(true);
    expect(shouldRetrySafePayRead(2, err('network'))).toBe(false);
    expect(shouldRetrySafePayRead(0, err('unauthenticated'))).toBe(false);
    expect(shouldRetrySafePayRead(0, err('forbidden'))).toBe(false);
    expect(shouldRetrySafePayRead(0, err('malformed'))).toBe(false);
  });
});

describe('OC-NATIVE-FINAL-02-R1 D1 · the SafePay screen renders only the view state', () => {
  const screen = readFileSync(resolve(__dirname, '../app/(tabs)/escrow.tsx'), 'utf8');

  it('reads through the truthful read and view-state helpers', () => {
    expect(screen).toMatch(/readCanonicalTransactions\(/);
    expect(screen).toMatch(/safePayViewState\(/);
  });

  it('never defaults a missing answer to an empty list or renders an unguarded count', () => {
    expect(screen).not.toMatch(/data:\s*transactions\s*=\s*\[\]/);
    expect(screen).not.toMatch(/\{transactions\.length\}/);
    expect(screen).not.toMatch(/\{activeCount\} in progress/);
  });
});
