import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EMPTY_MARKETPLACE_FILTERS,
  type MarketplaceFilters,
} from '../utils/marketplaceFilters';
import {
  marketplaceResultsReturnHref,
  marketplaceReturnFromParam,
  marketplaceVehicleHref,
} from '../utils/marketplaceNavigation';
import {
  leaveVehicle,
  vehicleLeaveFallback,
  vehicleRouteContextFromParams,
} from '../utils/vehicleNavigation';
import {
  communicationParticipantContext,
  communicationThreadContext,
} from '../utils/communicationPresentation';
import {
  communicationQueryKeys,
  communicationQueryScope,
} from '../utils/communicationQueries';

const auth = vi.hoisted(() => ({
  user: {
    id: 'owner-a',
    role: 'owner',
    active_tenant_id: 'tenant-a',
  },
}));

vi.mock('../store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ token: 'test-session', user: auth.user }),
  },
}));

vi.mock('../utils/verificationApi', () => ({
  getVerificationApiBaseUrl: () => 'https://staging.example.test',
}));

import {
  getTradeRecordDetail,
  getTradeRecordList,
  TradeApiError,
} from '../utils/tradeApi';

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fullFilters: MarketplaceFilters = {
  ...EMPTY_MARKETPLACE_FILTERS,
  q: 'hilux',
  make: 'Toyota',
  model: 'Hilux',
  location: 'Harare',
  tags: ['passport_verified'],
  sort: 'price-low',
};

describe('Marketplace deterministic Back control', () => {
  it('carries the exact results state into Vehicle and validates only the Results route on return', () => {
    const results = marketplaceResultsReturnHref(fullFilters);
    expect(results).toContain('/market/results?');
    expect(results).toContain('q=hilux');
    expect(results).toContain('make=Toyota');
    expect(results).toContain('model=Hilux');
    expect(results).toContain('location=Harare');

    const vehicle = marketplaceVehicleHref('VIN/123', results);
    // CARUP-MVP-STAB-01 F-003: the Results entry also names its source, so the return is parsed as
    // real query params (exact keys) instead of splitting the string after `marketReturn=`.
    const parsed = new URL(vehicle, 'https://carup.invalid');
    expect(parsed.pathname).toBe('/vehicle/VIN%2F123');
    expect([...parsed.searchParams.keys()]).toEqual(['from', 'marketReturn']);
    expect(parsed.searchParams.get('from')).toBe('results');
    expect(marketplaceReturnFromParam(parsed.searchParams.get('marketReturn') ?? undefined)).toBe(results);
    // With no history, Back lands on exactly these results.
    expect(vehicleLeaveFallback(vehicleRouteContextFromParams(Object.fromEntries(parsed.searchParams)))).toBe(results);

    expect(marketplaceReturnFromParam('/(tabs)/account')).toBeNull();
    expect(marketplaceReturnFromParam('https://evil.example/market/results')).toBeNull();
  });

  it('preserves saved-results search state without adding duplicate navigation entries', () => {
    const saved = marketplaceResultsReturnHref(fullFilters, {
      savedMode: true,
      savedSearch: 'diesel hilux',
    });
    expect(saved.startsWith('/market/results?saved=true&')).toBe(true);
    expect(saved).toContain('q=diesel+hilux');
    expect(marketplaceReturnFromParam(saved)).toBe(saved);

    const resultsSource = readFileSync(resolve('app/market/results.tsx'), 'utf8');
    const vehicleSource = readFileSync(resolve('app/vehicle/[vin].tsx'), 'utf8');
    const navigationSource = readFileSync(resolve('utils/vehicleNavigation.ts'), 'utf8');
    expect(resultsSource).toContain("router.replace('/(tabs)/marketplace'");
    expect(resultsSource).toContain('marketplaceVehicleHref(item.vin, vehicleReturnHref)');
    // CARUP-MVP-STAB-01 F-003 / F-014: Vehicle Detail leaves through the one navigation contract, which
    // still validates the return with marketplaceReturnFromParam…
    expect(vehicleSource).toContain('vehicleRouteContextFromParams(params)');
    expect(vehicleSource).toContain('leaveVehicle(router, routeContext)');
    expect(navigationSource).toContain('marketplaceReturnFromParam(params.marketReturn');
    // …and never adds a navigation entry: back() when there is history, replace() to the exact saved
    // results when there is none, push() never.
    for (const canGoBack of [true, false]) {
      const calls: string[] = [];
      leaveVehicle({
        canGoBack: () => canGoBack,
        back: () => calls.push('back'),
        replace: (href: never) => calls.push(`replace:${String(href)}`),
      }, vehicleRouteContextFromParams({ from: 'results', marketReturn: saved }));
      expect(calls).toEqual(canGoBack ? ['back'] : [`replace:${saved}`]);
    }
  });
});

describe('Inbox canonical context and unread convergence', () => {
  it('renders only canonical thread and participant fields without invented context', () => {
    const context = communicationThreadContext({
      marketplace_listing_id: 'VIN-001',
      business_workflow: 'marketplace_inquiry',
      participant_role: 'buyer',
      primary_channel: 'whatsapp',
    });
    expect(context).toEqual([
      { label: 'Listing', value: 'VIN-001' },
      { label: 'Journey', value: 'Marketplace Inquiry' },
      { label: 'Your role', value: 'Buyer' },
      { label: 'Channel', value: 'WhatsApp' },
    ]);

    expect(communicationThreadContext({
      metadata: { vehicle_title: 'Invented metadata must not render' },
    })).toEqual([]);

    expect(communicationParticipantContext([
      { is_self: true, display_name: 'Owner', stakeholder_role: 'buyer' },
      { is_self: false, display_name: 'Dealer One', stakeholder_role: 'seller' },
      { is_self: false, stakeholder_role: 'support_agent' },
    ])).toEqual([
      { label: 'Seller', value: 'Dealer One' },
      { label: 'Support Agent', value: 'Support Agent' },
    ]);
  });

  it('scopes the shared unread cache by account, tenant and role', () => {
    const a = communicationQueryScope({ id: 'a', active_tenant_id: 't1', role: 'owner' });
    const b = communicationQueryScope({ id: 'b', active_tenant_id: 't1', role: 'owner' });
    const tenant2 = communicationQueryScope({ id: 'a', active_tenant_id: 't2', role: 'owner' });

    expect(communicationQueryKeys.threads(a)).not.toEqual(communicationQueryKeys.threads(b));
    expect(communicationQueryKeys.threads(a)).not.toEqual(communicationQueryKeys.threads(tenant2));
    expect(communicationQueryKeys.threads(a).slice(0, 2)).toEqual(['native-communications', 'threads']);

    const inbox = readFileSync(resolve('app/(tabs)/inbox.tsx'), 'utf8');
    const thread = readFileSync(resolve('app/inbox/[threadId].tsx'), 'utf8');
    const header = readFileSync(resolve('components/navigation/NativeSharedHeader.tsx'), 'utf8');
    const root = readFileSync(resolve('app/_layout.tsx'), 'utf8');

    expect(inbox).toContain('communicationQueryKeys.threads(scope)');
    expect(inbox).toContain('<RefreshControl');
    expect(thread).toContain('markCommunicationThreadRead');
    expect(thread).toContain('invalidateQueries({ queryKey: threadListKey })');
    expect(thread).toContain('refetchQueries({ queryKey: threadListKey })');
    expect(header).toContain('communicationQueryKeys.threads(communicationScope)');
    expect(root).toContain('invalidateQueries({ queryKey: communicationQueryKeys.root })');
    expect(root).toContain("refetchQueries({ queryKey: communicationQueryKeys.root, type: 'active' })");
  });
});

describe('Trade authorized list to detail', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.user = { id: 'owner-a', role: 'owner', active_tenant_id: 'tenant-a' };
  });

  it('uses real order-scoped reads and canonical detail endpoints without synthetic records', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('/api/diaspora/import-orders?limit=20')) {
        return response(200, { data: [{ id: 'order-1', requested_make: 'Toyota', requested_model: 'Hilux', status: 'DRAFT' }] });
      }
      if (href.includes('/api/diaspora/shipments?importOrderId=order-1')) {
        return response(200, { data: [{ id: 'ship-1', import_order_id: 'order-1', carrier_name: 'Carrier A', status: 'IN_TRANSIT' }] });
      }
      if (href.endsWith('/api/diaspora/shipments/ship-1')) {
        return response(200, {
          id: 'ship-1',
          import_order_id: 'order-1',
          carrier_name: 'Carrier A',
          tracking_number: 'TRACK-1',
          status: 'IN_TRANSIT',
        });
      }
      return response(404, { error: 'not found' });
    }));

    const list = await getTradeRecordList('shipments');
    expect(list).toEqual([{
      id: 'ship-1',
      kind: 'shipments',
      title: 'Carrier A',
      subtitle: null,
      status: 'IN_TRANSIT',
      importOrderId: 'order-1',
    }]);

    const detail = await getTradeRecordDetail('shipments', 'ship-1');
    expect(detail.id).toBe('ship-1');
    expect(detail.fields).toContainEqual({ label: 'Tracking number', value: 'TRACK-1' });
    expect(calls.some((href) => href.endsWith('/api/diaspora/shipments/ship-1'))).toBe(true);
  });

  it('uses the canonical import-order documents collection and returns a truthful empty state', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('/api/diaspora/import-orders?limit=20')) {
        return response(200, { data: [{ id: 'order-2' }] });
      }
      if (href.endsWith('/api/diaspora/import-orders/order-2/documents')) {
        return response(200, { data: [] });
      }
      return response(404, {});
    }));

    expect(await getTradeRecordList('documents')).toEqual([]);
    expect(calls.some((href) => href.endsWith('/api/diaspora/import-orders/order-2/documents'))).toBe(true);
    expect(calls.some((href) => href.includes('/api/diaspora/documents?importOrderId='))).toBe(false);
  });

  it('re-resolves reservation detail only inside its authorized order collection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes('/api/diaspora/reservations?importOrderId=order-3')) {
        return response(200, {
          data: [{
            id: 'reservation-1',
            import_order_id: 'order-3',
            container_id: 'container-7',
            cargo_type: 'vehicle',
            estimated_volume: 12,
            reservation_status: 'PENDING',
          }],
        });
      }
      return response(404, {});
    }));

    const detail = await getTradeRecordDetail('containerSpace', 'reservation-1', { importOrderId: 'order-3' });
    expect(detail.id).toBe('reservation-1');
    expect(detail.fields).toContainEqual({ label: 'Container', value: 'container-7' });

    await expect(getTradeRecordDetail('containerSpace', 'reservation-1'))
      .rejects.toMatchObject({ statusCode: 424 });
  });

  it('preserves backend access denial and never converts it into an empty or fabricated record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(403, { error: 'Forbidden' })));
    await expect(getTradeRecordList('tradeProfile'))
      .rejects.toBeInstanceOf(TradeApiError);
    await expect(getTradeRecordList('tradeProfile'))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
