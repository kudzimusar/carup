import { apiUrl } from './apiBase';

/**
 * OC-NATIVE-FINAL-02-R1 D1 — SafePay transaction read.
 *
 * The screen may only state what CarUp answered. A failed read is never an empty list and never
 * carries a count, and each kind of failure is told apart so a person can act on it: signing in
 * again, an account without access, CarUp being unavailable, or the request never reaching CarUp.
 */

export interface CanonicalTransaction {
  transaction_intent_id: string;
  vin: string;
  status: string;
  listing_amount: number | null;
  listing_currency: string | null;
  gate_reasons: string[];
  payment_state: string;
  reservation_state: string | null;
  deposit_eligibility: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type SafePayReadFailure = 'unauthenticated' | 'forbidden' | 'unavailable' | 'network' | 'malformed';

export class SafePayReadError extends Error {
  kind: SafePayReadFailure;
  statusCode: number | null;

  constructor(kind: SafePayReadFailure, statusCode: number | null, message: string) {
    super(message);
    this.name = 'SafePayReadError';
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

const SETTLED_STATUSES = new Set(['settled', 'refunded', 'cancelled', 'failed', 'released_sandbox', 'refunded_sandbox']);

export async function readCanonicalTransactions(
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<CanonicalTransaction[]> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...(token ? { 'x-session-token': token } : {}),
  };

  let response: Response;
  try {
    response = await fetchImpl(apiUrl('/api/escrow'), { method: 'GET', headers });
  } catch (error) {
    throw new SafePayReadError('network', null, error instanceof Error ? error.message : 'Network request failed');
  }

  if (response.status === 401) throw new SafePayReadError('unauthenticated', 401, 'Session is not accepted');
  if (response.status === 403) throw new SafePayReadError('forbidden', 403, 'Not authorised to view SafePay transactions');
  if (!response.ok) throw new SafePayReadError('unavailable', response.status, `SafePay read returned HTTP ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SafePayReadError('malformed', response.status, 'SafePay read returned an unreadable body');
  }
  const sessions = (body as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(sessions)) throw new SafePayReadError('malformed', response.status, 'SafePay read returned no transaction list');
  return sessions as CanonicalTransaction[];
}

export type SafePayViewState =
  | { state: 'LOADING' }
  | { state: 'READY_EMPTY'; total: 0; inProgress: 0 }
  | { state: 'READY_WITH_TRANSACTIONS'; transactions: CanonicalTransaction[]; total: number; inProgress: number }
  | { state: 'READ_FAILED'; failure: SafePayReadFailure; statusCode: number | null };

export function safePayViewState({
  isPending,
  data,
  error,
}: {
  isPending: boolean;
  data: CanonicalTransaction[] | undefined;
  error: unknown;
}): SafePayViewState {
  if (error) {
    const failure = error instanceof SafePayReadError ? error.kind : 'network';
    const statusCode = error instanceof SafePayReadError ? error.statusCode : null;
    return { state: 'READ_FAILED', failure, statusCode };
  }
  if (isPending || !data) return { state: 'LOADING' };
  if (data.length === 0) return { state: 'READY_EMPTY', total: 0, inProgress: 0 };
  return {
    state: 'READY_WITH_TRANSACTIONS',
    transactions: data,
    total: data.length,
    inProgress: data.filter((item) => !SETTLED_STATUSES.has(item.status)).length,
  };
}

export function shouldRetrySafePayRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!(error instanceof SafePayReadError)) return true;
  return error.kind === 'network' || error.kind === 'unavailable';
}

export function safePayFailureCopy(view: Extract<SafePayViewState, { state: 'READ_FAILED' }>): {
  title: string;
  body: string;
  action: 'retry' | 'sign_in' | 'none';
} {
  switch (view.failure) {
    case 'unauthenticated':
      return {
        title: 'Sign in again to see SafePay',
        body: 'CarUp did not accept this session. Sign in again to see your SafePay transactions.',
        action: 'sign_in',
      };
    case 'forbidden':
      return {
        title: 'SafePay is not available for this account',
        body: 'CarUp did not allow this account to view SafePay transactions.',
        action: 'none',
      };
    case 'network':
      return {
        title: 'CarUp could not be reached',
        body: 'This device could not reach CarUp, so no transactions are shown. Check the connection and try again.',
        action: 'retry',
      };
    case 'malformed':
      return {
        title: 'SafePay transactions could not be read',
        body: 'CarUp answered in a form this app could not read, so no transactions are shown. Try again later.',
        action: 'retry',
      };
    case 'unavailable':
    default:
      return {
        title: 'SafePay transactions are unavailable',
        body: `CarUp could not provide your transactions right now${view.statusCode ? ` (error ${view.statusCode})` : ''}, so none are shown. Try again.`,
        action: 'retry',
      };
  }
}
