import { getVerificationApiBaseUrl } from './verificationApi';

export class TradeApiError extends Error {
  statusCode: number | null;
  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'TradeApiError';
    this.statusCode = statusCode;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { useAuthStore } = await import('../store/authStore');
  const { token, user } = useAuthStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  if (token) headers['x-session-token'] = token;
  if (user?.role) headers['x-stakeholder-role'] = user.role;
  if (user?.active_tenant_id) headers['x-tenant-id'] = user.active_tenant_id;
  if (!token && user?.id && process.env.EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK === 'true') headers['x-user-id'] = user.id;
  return headers;
}

async function readTradeJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getVerificationApiBaseUrl()}${path}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) {
    let message = `Trade API returned HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || body?.error || message;
    } catch {
      // Keep the HTTP status message.
    }
    throw new TradeApiError(message, response.status);
  }
  return response.json();
}

export type TradeCapabilityKey =
  | 'importOrders'
  | 'tradeProfile'
  | 'containers'
  | 'containerSpace'
  | 'shipments'
  | 'documents';

export interface TradeCapabilityState {
  key: TradeCapabilityKey;
  label: string;
  endpoint: string;
  state: 'available' | 'unavailable';
  count: number | null;
  note: string;
}

export interface TradeGatewaySnapshot {
  capabilities: TradeCapabilityState[];
}

const CAPABILITIES: Array<{ key: TradeCapabilityKey; label: string; endpoint: string; note: string }> = [
  { key: 'importOrders', label: 'My Import Orders', endpoint: '/api/diaspora/import-orders?limit=20', note: 'Your governed import-order book.' },
  { key: 'tradeProfile', label: 'Trade Profile', endpoint: '/api/diaspora/trade-profiles/me', note: 'Your own governed Trade profile records.' },
  { key: 'containers', label: 'Containers', endpoint: '/api/diaspora/containers?limit=20', note: 'Governed container shipment records available to this account.' },
  { key: 'containerSpace', label: 'Container Space', endpoint: '/api/diaspora/reservations?limit=20', note: 'Cargo/container-space reservations authorized for this account.' },
  { key: 'shipments', label: 'Shipments', endpoint: '/api/diaspora/shipments?limit=20', note: 'Authorized Trade shipment records and timelines.' },
  { key: 'documents', label: 'Trade Documents', endpoint: '/api/diaspora/documents?limit=20', note: 'Governed Trade documents available to this account.' },
];

function arrayCount(body: any): number | null {
  if (Array.isArray(body?.data)) return body.data.length;
  if (Array.isArray(body)) return body.length;
  return null;
}

export async function getTradeGatewaySnapshot(): Promise<TradeGatewaySnapshot> {
  const settled = await Promise.all(
    CAPABILITIES.map(async (capability): Promise<TradeCapabilityState> => {
      try {
        const body = await readTradeJson<any>(capability.endpoint);
        return {
          ...capability,
          state: 'available',
          count: arrayCount(body),
        };
      } catch (error) {
        if (error instanceof TradeApiError && [401, 403, 404].includes(error.statusCode || 0)) {
          return {
            ...capability,
            state: 'unavailable',
            count: null,
            note: error.statusCode === 404
              ? 'This governed Trade capability is not enabled in the current runtime.'
              : 'This capability is not available to the current signed-in authority.',
          };
        }
        throw error;
      }
    }),
  );
  return { capabilities: settled };
}

export const TRADE_READ_AUTHORITIES = CAPABILITIES.map(({ key, endpoint }) => ({ key, endpoint }));
