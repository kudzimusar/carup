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

export type TradeRecordKind =
  | 'importOrders'
  | 'tradeProfile'
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

export interface TradeRecordSummary {
  id: string;
  kind: TradeRecordKind;
  title: string;
  subtitle: string | null;
  status: string | null;
  importOrderId: string | null;
}

export interface TradeRecordField {
  label: string;
  value: string;
}

export interface TradeRecordDetail {
  id: string;
  kind: TradeRecordKind;
  title: string;
  status: string | null;
  importOrderId: string | null;
  fields: TradeRecordField[];
}

interface ImportOrder {
  id?: string | null;
  order_type?: string | null;
  origin_country?: string | null;
  origin_city?: string | null;
  destination_country?: string | null;
  destination_city?: string | null;
  requested_make?: string | null;
  requested_model?: string | null;
  requested_year_min?: number | null;
  requested_year_max?: number | null;
  budget_amount?: number | string | null;
  budget_currency?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function arrayData(body: any): any[] {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body)) return body;
  return [];
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function human(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  return normalized.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// OC-NATIVE-FINAL-02-R1 P2-A — Trade detail printed raw ISO timestamps and internal record ids.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A readable date ("1 Oct 2026"). A calendar date stays that date in every time zone. */
function readableDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (calendar) return `${Number(calendar[3])} ${MONTHS[Number(calendar[2]) - 1] ?? calendar[2]} ${calendar[1]}`;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** A container number people can read; an internal record id is not shown. */
function containerNumber(value: unknown): string | null {
  const raw = text(value);
  return raw && !UUID.test(raw) ? raw : null;
}

function routePlace(country: unknown, city: unknown): string | null {
  return [text(city), text(country)].filter(Boolean).join(', ') || null;
}

function routeSummary(record: any): string | null {
  const from = routePlace(record?.origin_country, record?.origin_city) || text(record?.origin_port);
  const to = routePlace(record?.destination_country, record?.destination_city) || text(record?.destination_port);
  return from && to ? `${from} → ${to}` : from || to || null;
}

function recordStatus(kind: TradeRecordKind, record: any): string | null {
  if (kind === 'tradeProfile') return text(record?.verification_status);
  if (kind === 'containerSpace') return text(record?.reservation_status);
  if (kind === 'documents') return text(record?.verification_status);
  return text(record?.status);
}

function recordTitle(kind: TradeRecordKind, record: any): string {
  if (kind === 'importOrders') {
    const vehicle = [text(record?.requested_make), text(record?.requested_model)].filter(Boolean).join(' ');
    return vehicle || human(record?.order_type) || 'Import order';
  }
  if (kind === 'tradeProfile') {
    return text(record?.display_name) || human(record?.role_type) || human(record?.profile_type) || 'Trade profile';
  }
  if (kind === 'containerSpace') {
    const cargo = human(record?.cargo_type);
    return cargo ? `${cargo} reservation` : 'Container reservation';
  }
  if (kind === 'shipments') return text(record?.carrier_name) || 'Shipment';
  return text(record?.file_name) || human(record?.document_type) || 'Trade document';
}

function recordSubtitle(kind: TradeRecordKind, record: any): string | null {
  if (kind === 'importOrders') return routeSummary(record);
  if (kind === 'tradeProfile') {
    return [text(record?.city), text(record?.country)].filter(Boolean).join(', ') || null;
  }
  if (kind === 'containerSpace') {
    const container = containerNumber(record?.container_id);
    const volume = text(record?.estimated_volume);
    if (container && volume) return `Container ${container} · ${volume} m³`;
    if (container) return `Container ${container}`;
    return volume ? `${volume} m³` : null;
  }
  if (kind === 'shipments') {
    return text(record?.tracking_number) || routeSummary(record);
  }
  return human(record?.document_type);
}

function toSummary(kind: TradeRecordKind, record: any): TradeRecordSummary | null {
  const id = text(record?.id);
  if (!id) return null;
  return {
    id,
    kind,
    title: recordTitle(kind, record),
    subtitle: recordSubtitle(kind, record),
    status: recordStatus(kind, record),
    importOrderId: text(record?.import_order_id),
  };
}

function addField(fields: TradeRecordField[], label: string, value: unknown, transform: (value: unknown) => string | null = text) {
  const rendered = transform(value);
  if (rendered) fields.push({ label, value: rendered });
}

function toDetail(kind: TradeRecordKind, record: any): TradeRecordDetail {
  const summary = toSummary(kind, record);
  if (!summary) throw new TradeApiError('Trade record did not include an id.', 502);
  const fields: TradeRecordField[] = [];

  if (kind === 'importOrders') {
    addField(fields, 'Order type', record?.order_type, human);
    addField(fields, 'Origin', routePlace(record?.origin_country, record?.origin_city));
    addField(fields, 'Destination', routePlace(record?.destination_country, record?.destination_city));
    addField(fields, 'Requested make', record?.requested_make);
    addField(fields, 'Requested model', record?.requested_model);
    addField(fields, 'Year from', record?.requested_year_min);
    addField(fields, 'Year to', record?.requested_year_max);
    const budget = text(record?.budget_amount);
    const currency = text(record?.budget_currency);
    if (budget) fields.push({ label: 'Budget', value: currency ? `${currency} ${budget}` : budget });
    addField(fields, 'Created', record?.created_at, readableDate);
    addField(fields, 'Updated', record?.updated_at, readableDate);
  } else if (kind === 'tradeProfile') {
    addField(fields, 'Role', record?.role_type || record?.profile_type, human);
    addField(fields, 'Country', record?.country);
    addField(fields, 'City', record?.city);
    addField(fields, 'Verification', record?.verification_status, human);
    addField(fields, 'Trust score', record?.trust_score);
    addField(fields, 'Completed shipments', record?.completed_shipments_count);
    addField(fields, 'Disputes', record?.dispute_count);
    addField(fields, 'Rating', record?.rating_average);
  } else if (kind === 'containerSpace') {
    addField(fields, 'Container', record?.container_id, containerNumber);
    addField(fields, 'Cargo type', record?.cargo_type, human);
    addField(fields, 'Estimated volume', record?.estimated_volume, (value) => {
      const rendered = text(value);
      return rendered ? `${rendered} m³` : null;
    });
    addField(fields, 'Reservation status', record?.reservation_status, human);
    addField(fields, 'Created', record?.created_at, readableDate);
  } else if (kind === 'shipments') {
    addField(fields, 'Container', record?.container_id, containerNumber);
    addField(fields, 'Carrier', record?.carrier_name);
    addField(fields, 'Tracking number', record?.tracking_number);
    addField(fields, 'Origin port', record?.origin_port);
    addField(fields, 'Destination port', record?.destination_port);
    addField(fields, 'Departure', record?.departure_date, readableDate);
    addField(fields, 'Estimated arrival', record?.estimated_arrival_date, readableDate);
    addField(fields, 'Actual arrival', record?.actual_arrival_date, readableDate);
    addField(fields, 'Status', record?.status, human);
  } else {
    addField(fields, 'Document type', record?.document_type, human);
    addField(fields, 'File name', record?.file_name);
    addField(fields, 'Verification', record?.verification_status, human);
    addField(fields, 'Reviewed', record?.reviewed_at, readableDate);
    addField(fields, 'Created', record?.created_at, readableDate);
  }

  return { ...summary, fields };
}

function available(
  key: TradeCapabilityKey,
  label: string,
  endpoint: string,
  note: string,
  count: number | null = null,
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

async function readImportOrders(): Promise<any[]> {
  const body = await readTradeJson<any>('/api/diaspora/import-orders?limit=20');
  return arrayData(body);
}

async function readOwnTradeProfiles(): Promise<any[]> {
  const body = await readTradeJson<any>('/api/diaspora/trade-profiles/me');
  return arrayData(body);
}

async function readOrderScopedCollection(
  endpoint: 'reservations' | 'shipments' | 'documents',
  orderIds: string[],
): Promise<any[]> {
  if (orderIds.length === 0) return [];
  const pages = await Promise.all(
    orderIds.map(async (importOrderId) => {
      if (endpoint === 'documents') {
        const body = await readTradeJson<any>(`/api/diaspora/import-orders/${encodeURIComponent(importOrderId)}/documents`);
        return arrayData(body);
      }
      const query = new URLSearchParams({ importOrderId, limit: '20' });
      const body = await readTradeJson<any>(`/api/diaspora/${endpoint}?${query.toString()}`);
      return arrayData(body);
    }),
  );
  return pages.flat();
}

function capabilityFromResult(
  key: TradeCapabilityKey,
  label: string,
  endpoint: string,
  result: PromiseSettledResult<any>,
  note: string,
): TradeCapabilityState {
  if (result.status === 'fulfilled') {
    const value = result.value;
    const count = Array.isArray(value) ? value.length : arrayData(value).length;
    return available(key, label, endpoint, note, count);
  }
  const error = result.reason;
  if (error instanceof TradeApiError && [401, 403, 404].includes(error.statusCode || 0)) {
    return unavailable(
      key,
      label,
      endpoint,
      error.statusCode === 404
        ? 'This is not available yet.'
        : 'Your account cannot see this.',
    );
  }
  throw error;
}

export async function getTradeGatewaySnapshot(): Promise<TradeGatewaySnapshot> {
  const importOrders = await readImportOrders();
  const orderIds = importOrders
    .map((order) => String(order?.id || '').trim())
    .filter(Boolean);

  const [profileResult, containersResult, reservationsResult, shipmentsResult, documentsResult] = await Promise.allSettled([
    readOwnTradeProfiles(),
    readTradeJson<any>('/api/diaspora/containers?limit=20').then(arrayData),
    readOrderScopedCollection('reservations', orderIds),
    readOrderScopedCollection('shipments', orderIds),
    readOrderScopedCollection('documents', orderIds),
  ]);

  return {
    capabilities: [
      available(
        'importOrders',
        'My Import Orders',
        '/api/diaspora/import-orders?limit=20',
        'Your import orders.',
        importOrders.length,
      ),
      capabilityFromResult(
        'tradeProfile',
        'Trade Profile',
        '/api/diaspora/trade-profiles/me',
        profileResult,
        'Your trade profile.',
      ),
      capabilityFromResult(
        'containers',
        'Containers',
        '/api/diaspora/containers?limit=20',
        containersResult,
        'Containers listed on CarUp.',
      ),
      capabilityFromResult(
        'containerSpace',
        'Container Space',
        '/api/diaspora/reservations?importOrderId=<authorized-order>',
        reservationsResult,
        orderIds.length
          ? 'Container space booked for your import orders.'
          : 'No import orders yet, so there is no container space to show.',
      ),
      capabilityFromResult(
        'shipments',
        'Shipments',
        '/api/diaspora/shipments?importOrderId=<authorized-order>',
        shipmentsResult,
        orderIds.length
          ? 'Shipments for your import orders.'
          : 'No import orders yet, so there are no shipments to show.',
      ),
      capabilityFromResult(
        'documents',
        'Trade Documents',
        '/api/diaspora/import-orders/<authorized-order>/documents',
        documentsResult,
        orderIds.length
          ? 'Documents for your import orders.'
          : 'No import orders yet, so there are no trade documents to show.',
      ),
    ],
  };
}

export function isTradeRecordKind(value: unknown): value is TradeRecordKind {
  return ['importOrders', 'tradeProfile', 'containerSpace', 'shipments', 'documents'].includes(String(value));
}

export function tradeRecordKindLabel(kind: TradeRecordKind): string {
  return {
    importOrders: 'Import orders',
    tradeProfile: 'Trade profiles',
    containerSpace: 'Container space',
    shipments: 'Shipments',
    documents: 'Trade documents',
  }[kind];
}

export async function getTradeRecordList(kind: TradeRecordKind): Promise<TradeRecordSummary[]> {
  let records: any[] = [];
  if (kind === 'importOrders') {
    records = await readImportOrders();
  } else if (kind === 'tradeProfile') {
    records = await readOwnTradeProfiles();
  } else {
    const orders = await readImportOrders();
    const orderIds = orders.map((order) => text(order?.id)).filter((id): id is string => Boolean(id));
    records = await readOrderScopedCollection(
      kind === 'containerSpace' ? 'reservations' : kind === 'shipments' ? 'shipments' : 'documents',
      orderIds,
    );
  }
  return records.map((record) => toSummary(kind, record)).filter((record): record is TradeRecordSummary => Boolean(record));
}

export async function getTradeRecordDetail(
  kind: TradeRecordKind,
  id: string,
  options: { importOrderId?: string | null } = {},
): Promise<TradeRecordDetail> {
  let record: any;
  if (kind === 'importOrders') {
    record = await readTradeJson<any>(`/api/diaspora/import-orders/${encodeURIComponent(id)}`);
  } else if (kind === 'tradeProfile') {
    record = await readTradeJson<any>(`/api/diaspora/trade-profiles/${encodeURIComponent(id)}`);
  } else if (kind === 'shipments') {
    record = await readTradeJson<any>(`/api/diaspora/shipments/${encodeURIComponent(id)}`);
  } else if (kind === 'documents') {
    record = await readTradeJson<any>(`/api/diaspora/documents/${encodeURIComponent(id)}`);
  } else {
    const importOrderId = text(options.importOrderId);
    if (!importOrderId) {
      throw new TradeApiError(
        'Container reservation detail requires its authorized import-order context because the backend has no reservation-by-id read route.',
        424,
      );
    }
    const body = await readTradeJson<any>(
      `/api/diaspora/reservations?importOrderId=${encodeURIComponent(importOrderId)}&limit=20`,
    );
    record = arrayData(body).find((item) => text(item?.id) === id);
    if (!record) throw new TradeApiError('Container reservation was not found in the authorized import order.', 404);
  }
  return toDetail(kind, record);
}

export const TRADE_READ_AUTHORITIES = [
  { key: 'importOrders' as const, endpoint: '/api/diaspora/import-orders?limit=20' },
  { key: 'tradeProfile' as const, endpoint: '/api/diaspora/trade-profiles/me' },
  { key: 'containers' as const, endpoint: '/api/diaspora/containers?limit=20' },
  { key: 'containerSpace' as const, endpoint: '/api/diaspora/reservations?importOrderId=<authorized-order>' },
  { key: 'shipments' as const, endpoint: '/api/diaspora/shipments?importOrderId=<authorized-order>' },
  { key: 'documents' as const, endpoint: '/api/diaspora/import-orders/<authorized-order>/documents' },
] as const;
