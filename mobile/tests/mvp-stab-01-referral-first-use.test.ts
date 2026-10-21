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

import { isReferralWalletNotStarted, loadReferralWallet, ReferralApiError } from '../utils/referralApi';

/**
 * CARUP-MVP-STAB-01 F-025 (Native) — a person with no referral wallet row yet is in the normal
 * first-use state (wallets are created only by later reward transactions). Native shows the friendly
 * first-use copy for that answer, and every genuine failure stays an error.
 */

function backendError(status: number, code: string, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, error: { code, message, timestamp: '2026-10-21T07:00:00.000Z', requestId: 'req-1' } }),
  };
}

function stubFetch(response: unknown) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function failure(): Promise<unknown> {
  try {
    await loadReferralWallet('owner-a');
  } catch (error) {
    return error;
  }
  throw new Error('expected the wallet read to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CARUP-MVP-STAB-01 F-025 · a wallet that does not exist yet is first use, not an error', () => {
  it("the backend's 404 RESOURCE_NOT_FOUND 'Referral wallet not found.' is not_started", async () => {
    const fetchMock = stubFetch(backendError(404, 'RESOURCE_NOT_FOUND', 'Referral wallet not found.'));
    await expect(loadReferralWallet('owner-a')).resolves.toEqual({ state: 'not_started' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://staging.example.test/api/referrals/wallets/owner-a',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-session-token': 'test-session' }) }),
    );
  });

  it('a wallet that exists is ready, with exactly what CarUp returned', async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        wallet: { pending_balance: 5, approved_balance: 10, payable_balance: 0, paid_or_applied_balance: 0, currency: 'USD' },
        transactions: [{ id: 'tx-1', status: 'pending', amount: 5 }],
      }),
    });
    await expect(loadReferralWallet('owner-a')).resolves.toEqual({
      state: 'ready',
      wallet: { pending_balance: 5, approved_balance: 10, payable_balance: 0, paid_or_applied_balance: 0, currency: 'USD' },
      transactions: [{ id: 'tx-1', status: 'pending', amount: 5 }],
    });
  });

  it('a server failure stays an error', async () => {
    stubFetch(backendError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected internal server error occurred'));
    const error = await failure();
    expect(error).toBeInstanceOf(ReferralApiError);
    expect((error as ReferralApiError).statusCode).toBe(500);
    expect(isReferralWalletNotStarted(error)).toBe(false);
  });

  it('a 404 for a missing route is a genuine failure, not first use', async () => {
    stubFetch(backendError(404, 'RESOURCE_NOT_FOUND', 'Route not found'));
    const error = await failure();
    expect(error).toBeInstanceOf(ReferralApiError);
    expect((error as ReferralApiError).code).toBe('RESOURCE_NOT_FOUND');
    expect(isReferralWalletNotStarted(error)).toBe(false);
  });

  it('a 404 that is not CarUp’s wallet answer (no code, not JSON) is a genuine failure', async () => {
    stubFetch({ ok: false, status: 404, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    const error = await failure();
    expect(error).toBeInstanceOf(ReferralApiError);
    expect((error as ReferralApiError).code).toBeNull();
    expect(isReferralWalletNotStarted(error)).toBe(false);
  });

  it('refusals and network failures stay errors', async () => {
    stubFetch(backendError(403, 'INSUFFICIENT_PERMISSIONS', 'Insufficient permissions'));
    expect(isReferralWalletNotStarted(await failure())).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));
    const network = await failure();
    expect(network).toBeInstanceOf(TypeError);
    expect(isReferralWalletNotStarted(network)).toBe(false);
  });

  it('only the exact wallet answer qualifies', () => {
    expect(isReferralWalletNotStarted(new ReferralApiError('Referral wallet not found.', 404, 'RESOURCE_NOT_FOUND'))).toBe(true);
    expect(isReferralWalletNotStarted(new ReferralApiError('Referral wallet not found.', 500, 'RESOURCE_NOT_FOUND'))).toBe(false);
    expect(isReferralWalletNotStarted(new ReferralApiError('Referral wallet not found.', 404, 'NOT_FOUND'))).toBe(false);
    expect(isReferralWalletNotStarted(new Error('Referral wallet not found.'))).toBe(false);
  });
});

describe('CARUP-MVP-STAB-01 F-025 · the Refer & Earn screen renders first use plainly', () => {
  const screen = readFileSync(resolve(__dirname, '../app/(tabs)/referral.tsx'), 'utf8');

  it('reads the wallet through the first-use-aware helper', () => {
    expect(screen).toMatch(/loadReferralWallet\(user\.id\)/);
    expect(screen).not.toMatch(/getReferralWallet\(/);
    expect(screen).toMatch(/\.state === 'not_started'/);
  });

  it('a wallet that has not started shows the friendly first-use copy, never the error text or invented balances', () => {
    expect(screen).toContain(
      "const NO_REFERRAL_BENEFITS_YET = 'No referral benefits yet. Share your code to start earning — benefits stay pending until approved.';",
    );
    const from = screen.indexOf(') : walletNotStarted ? (');
    const to = screen.indexOf(') : (', from + 1);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const branch = screen.slice(from, to);
    expect(branch).toContain('{NO_REFERRAL_BENEFITS_YET}');
    expect(branch).not.toMatch(/error|text-red|money\(/);
  });
});
