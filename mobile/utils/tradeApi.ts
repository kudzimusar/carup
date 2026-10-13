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

interface ImportOrder {
  id?: string | null;
}

function arrayData(body: any): any[] {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body)) return body;
  return [];
}

function available(
  key: TradeCapabilityKey,
  label: string,
  endpoint: string,
  count: number | null,
  note: string,
): TradeCapabilityState {
  return { key, label, endpoint, state: 'available', count, note };
}

function unavailable(
  key: TradeCapabilityKey,
  label: string,
  endpoint: string,
  note: string,
): TradeCapabilityState {
  return { key, label, endpoint, state: 'unavailable', count: null, note };
}

async function readOrderScopedCollection(
  endpoint: 'reservations' | 'shipments' | 'documents',
  orderIds: string[],
): Promise<any[]> {
  if (orderIds.length === 0) return [];
  const pages = await Promise.all(
    orderIds.map(async (importOrderId) => {
      const query = new URLSearchParams({ importOrderId, limit: '20' });
      const body = await readTradeJson<any>(`/api/diaspora/${endpoint}?${query.toString()}`);
      return arrayData(body);
    }),
  );
  return pages.flat();
}

export async function getTradeGatewaySnapshot(): Promise<TradeGatewaySnapshot> {
  const importOrdersBody = await readTradeJson<any>('/api/diaspora/import-orders?limit=20');
  const importOrders = arrayData(importOrdersBody) as ImportOrder[];
  const orderIds = importOrders
    .map((order) => String(order?.id || '').trim())
    .filter(Boolean);

  const [profileResult, containersResult, reservationsResult, shipmentsResult, documentsResult] = await Promise.allSettled([
    readTradeJson<any>('/api/diaspora/trade-profiles/me'),
    // This authenticated route is the shared Trade container catalogue. It is not presented as
    // "your containers"; participant-specific space/reservation truth is read per import order below.
    readTradeJson<any>('/api/diaspora/containers?limit=20'),
    readOrderScopedCollection('reservations', orderIds),
    readOrderScopedCollection('shipments', orderIds),
    readOrderScopedCollection('documents', orderIds),
  ]);

  const capabilityFromResult = (
    key: TradeCapabilityKey,
    label: string,
    endpoint: string,
    result: PromiseSettledResult<any>,
    note: string,
  ): TradeCapabilityState => {
    if (result.status === 'fulfilled') {
      const count = Array.isArray(result.value) ? result.value.length : arrayData(result.value).length;
      return available(key, label, endpoint, count, note);
    }
    const error = result.reason;
    if (error instanceof TradeApiError && [401, 403, 404].includes(error.statusCode || 0)) {
      return unavailable(
        key,
        label,
        endpoint,
        error.statusCode === 404
          ? 'This governed Trade capability is not enabled in the current runtime.'
          : 'This capability is not available to the current signed-in authority.',
      );
    }
    throw error;
  };

  return {
    capabilities: [
      available(
        'importOrders',
        'My Import Orders',
        '/api/diaspora/import-orders?limit=20',
        importOrders.length,
        'Your governed import-order book.',
      ),
      capabilityFromResult(
        'tradeProfile',
        'Trade Profile',
        '/api/diaspora/trade-profiles/me',
        profileResult,
        'Your own governed Trade profile records.',
      ),
      capabilityFromResult(
        'containers',
        'Containers',
        '/api/diaspora/containers?limit=20',
        containersResult,
        'Authenticated Trade container catalogue.',
      ),
      capabilityFromResult(
        'containerSpace',
        'Container Space',
        '/api/diaspora/reservations?importOrderId=<authorized-order>',
        reservationsResult,
        orderIds.length
          ? 'Cargo/container-space reservations read only through your authorized import orders.'
          : 'No import orders yet, so there is no participant-scoped container reservation to show.',
      ),
      capabilityFromResult(
        'shipments',
        'Shipments',
        '/api/diaspora/shipments?importOrderId=<authorized-order>',
        shipmentsResult,
        orderIds.length
          ? 'Shipment records read only through your authorized import orders.'
          : 'No import orders yet, so there is no participant-scoped shipment to show.',
      ),
      capabilityFromResult(
        'documents',
        'Trade Documents',
        '/api/diaspora/documents?importOrderId=<authorized-order>',
        documentsResult,
        orderIds.length
          ? 'Trade documents read only through your authorized import orders.'
          : 'No import orders yet, so there is no participant-scoped Trade document to show.',
      ),
    ],
  };
}

export const TRADE_READ_AUTHORITIES = [
  { key: 'importOrders' as const, endpoint: '/api/diaspora/import-orders?limit=20' },
  { key: 'tradeProfile' as const, endpoint: '/api/diaspora/trade-profiles/me' },
  { key: 'containers' as const, endpoint: '/api/diaspora/containers?limit=20' },
  { key: 'containerSpace' as const, endpoint: '/api/diaspora/reservations?importOrderId=<authorized-order>' },
  { key: 'shipments' as const, endpoint: '/api/diaspora/shipments?importOrderId=<authorized-order>' },
  { key: 'documents' as const, endpoint: '/api/diaspora/documents?importOrderId=<authorized-order>' },
] as const;
