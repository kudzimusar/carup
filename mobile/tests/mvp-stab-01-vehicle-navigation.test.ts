import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  leaveComposer,
  leaveVehicle,
  signInHref,
  signInReturnPathFromParam,
  VEHICLE_ENTRY_SOURCES,
  vehicleHref,
  vehicleInquiryHref,
  vehicleLeaveFallback,
  vehicleRouteContextFromParams,
  type VehicleRouteContext,
} from '../utils/vehicleNavigation';
import { marketplaceResultsReturnHref, marketplaceVehicleHref } from '../utils/marketplaceNavigation';
import { EMPTY_MARKETPLACE_FILTERS } from '../utils/marketplaceFilters';

/**
 * CARUP-MVP-STAB-01 F-003 / F-014 — one Android Back contract for Vehicle Detail.
 *
 * Vehicle Detail is a root-stack screen reached from seven places. Back (the visible control and the
 * Android hardware key) must return to the screen the buyer came from when there is history, and to
 * that source's tab when there is none (Verify used to replace the stack, and a cold deep link had
 * nothing beneath the vehicle, so the hardware key closed the app).
 */

function fakeRouter(canGoBack: boolean) {
  const calls: string[] = [];
  return {
    calls,
    router: {
      canGoBack: () => canGoBack,
      back: vi.fn(() => {
        calls.push('back');
      }),
      replace: vi.fn((href: never) => {
        calls.push(`replace:${String(href)}`);
      }),
      push: vi.fn((href: never) => {
        calls.push(`push:${String(href)}`);
      }),
    },
  };
}

const RESULTS = marketplaceResultsReturnHref({ ...EMPTY_MARKETPLACE_FILTERS, q: 'hilux', make: 'Toyota', tags: [] });

describe('vehicleHref — one entry contract for every source', () => {
  it('names the source and encodes the VIN', () => {
    expect(vehicleHref('VIN/123', { from: 'marketplace' })).toBe('/vehicle/VIN%2F123?from=marketplace');
    expect(vehicleHref('VIN-1', { from: 'verify' })).toBe('/vehicle/VIN-1?from=verify');
    expect(vehicleHref('VIN-1', { from: 'home' })).toBe('/vehicle/VIN-1?from=home');
    expect(vehicleHref('VIN-1', { from: 'garage' })).toBe('/vehicle/VIN-1?from=garage');
    expect(vehicleHref('VIN-1')).toBe('/vehicle/VIN-1');
  });

  it('carries a conversation only for an Inbox entry and a results return only for a Results entry', () => {
    expect(vehicleHref('VIN-1', { from: 'inbox', threadId: 'thread-9' })).toBe('/vehicle/VIN-1?from=inbox&threadId=thread-9');
    expect(vehicleHref('VIN-1', { from: 'home', threadId: 'thread-9' })).toBe('/vehicle/VIN-1?from=home');
    expect(vehicleHref('VIN-1', { from: 'inbox', threadId: '../secret' })).toBe('/vehicle/VIN-1?from=inbox');
    expect(vehicleHref('VIN-1', { from: 'results', marketReturn: RESULTS }))
      .toBe(`/vehicle/VIN-1?from=results&marketReturn=${encodeURIComponent(RESULTS)}`);
    expect(vehicleHref('VIN-1', { from: 'marketplace', marketReturn: RESULTS })).toBe('/vehicle/VIN-1?from=marketplace');
    expect(vehicleHref('VIN-1', { from: 'results', marketReturn: '/(tabs)/account' })).toBe('/vehicle/VIN-1?from=results');
  });

  it('carries only well-formed referral and campaign codes', () => {
    expect(vehicleHref('VIN-1', { from: 'deeplink', ref: 'AGENT_7', campaign: 'spring-2026' }))
      .toBe('/vehicle/VIN-1?from=deeplink&ref=AGENT_7&campaign=spring-2026');
    expect(vehicleHref('VIN-1', { from: 'deeplink', ref: '<script>', campaign: 'x'.repeat(65) })).toBe('/vehicle/VIN-1?from=deeplink');
  });

  it('round-trips through the route params the Vehicle screen receives', () => {
    const contexts: VehicleRouteContext[] = [
      { from: 'marketplace' },
      { from: 'results', marketReturn: RESULTS },
      { from: 'verify' },
      { from: 'inbox', threadId: 'thread-1' },
      { from: 'inbox' },
      { from: 'home', ref: 'AGENT_7' },
      { from: 'garage' },
      { from: 'deeplink', ref: 'AGENT_7', campaign: 'SPRING' },
    ];
    for (const context of contexts) {
      const href = vehicleHref('VIN-RT', context);
      const params = Object.fromEntries(new URL(href, 'https://carup.invalid').searchParams.entries());
      expect(vehicleRouteContextFromParams(params), href).toEqual(context);
    }
  });

  it('rejects unknown sources and unsafe values from a typed or deep-linked URL', () => {
    expect(vehicleRouteContextFromParams({ from: 'evil', threadId: 'thread-1' })).toEqual({});
    expect(vehicleRouteContextFromParams({ from: ['inbox', 'home'], threadId: ['thread-2'] })).toEqual({ from: 'inbox', threadId: 'thread-2' });
    expect(vehicleRouteContextFromParams({ from: 'results', marketReturn: 'https://evil.example/market/results' })).toEqual({ from: 'results' });
    expect(vehicleRouteContextFromParams({ referral: 'AGENT_9' })).toEqual({ ref: 'AGENT_9' });
    // A Results return built before the source existed still means Results.
    expect(vehicleRouteContextFromParams({ marketReturn: RESULTS })).toEqual({ from: 'results', marketReturn: RESULTS });
  });

  it('is the same contract the Results screen already uses', () => {
    expect(marketplaceVehicleHref('VIN/123', RESULTS)).toBe(vehicleHref('VIN/123', { from: 'results', marketReturn: RESULTS }));
  });

  it('builds the composer route on the same vehicle with the same context', () => {
    expect(vehicleInquiryHref('VIN/1', { from: 'inbox', threadId: 'thread-1', ref: 'AGENT_7' }))
      .toBe('/vehicle/VIN%2F1/inquire?from=inbox&threadId=thread-1&ref=AGENT_7');
    expect(vehicleInquiryHref('VIN-1')).toBe('/vehicle/VIN-1/inquire');
  });
});

describe('leaveVehicle — Back returns to the source, never loops', () => {
  const expectations: Array<[VehicleRouteContext, string]> = [
    [{ from: 'marketplace' }, '/(tabs)/marketplace'],
    [{ from: 'results', marketReturn: RESULTS }, RESULTS],
    [{ from: 'results' }, '/(tabs)/marketplace'],
    [{ from: 'verify' }, '/(tabs)/verify'],
    [{ from: 'inbox', threadId: 'thread-9' }, '/inbox/thread-9'],
    [{ from: 'inbox' }, '/(tabs)/inbox'],
    [{ from: 'home' }, '/(tabs)'],
    [{ from: 'garage' }, '/(tabs)'],
    [{ from: 'deeplink' }, '/(tabs)'],
    [{}, '/(tabs)'],
  ];

  it.each(expectations)('with history %j goes back exactly once', (context) => {
    const { router, calls } = fakeRouter(true);
    leaveVehicle(router, context);
    expect(calls).toEqual(['back']);
  });

  it.each(expectations)('without history %j replaces to %s', (context, fallback) => {
    const { router, calls } = fakeRouter(false);
    leaveVehicle(router, context);
    expect(calls).toEqual([`replace:${fallback}`]);
    expect(vehicleLeaveFallback(context)).toBe(fallback);
  });

  it('covers every declared source', () => {
    expect([...VEHICLE_ENTRY_SOURCES].sort()).toEqual(['deeplink', 'garage', 'home', 'inbox', 'marketplace', 'results', 'verify']);
    for (const from of VEHICLE_ENTRY_SOURCES) {
      const { router, calls } = fakeRouter(false);
      leaveVehicle(router, { from });
      expect(calls).toHaveLength(1);
      expect(calls[0].startsWith('replace:')).toBe(true);
      // Never back onto a vehicle route: leaving must not create a loop.
      expect(calls[0]).not.toMatch(/replace:\/vehicle\//);
    }
  });

  it('re-validates raw values even when a caller skips the parser', () => {
    const { router, calls } = fakeRouter(false);
    leaveVehicle(router, { from: 'inbox', threadId: '../../account' });
    leaveVehicle(router, { from: 'results', marketReturn: '//evil.example/market/results' });
    expect(calls).toEqual(['replace:/(tabs)/inbox', 'replace:/(tabs)/marketplace']);
  });
});

describe('leaveComposer — Cancel and Back return to the vehicle without a write', () => {
  it('goes back when the vehicle is directly beneath', () => {
    const { router, calls } = fakeRouter(true);
    leaveComposer(router, { vin: 'VIN-1', previousRouteName: 'vehicle/[vin]', context: { from: 'home' } });
    expect(calls).toEqual(['back']);
  });

  it('opens the vehicle in place when the composer was opened without it', () => {
    for (const previousRouteName of [undefined, '(tabs)', '(auth)']) {
      const { router, calls } = fakeRouter(previousRouteName !== undefined);
      leaveComposer(router, { vin: 'VIN/1', previousRouteName, context: { from: 'inbox', threadId: 'thread-1' } });
      expect(calls).toEqual(['replace:/vehicle/VIN%2F1?from=inbox&threadId=thread-1']);
    }
  });
});

describe('sign-in return path', () => {
  it('builds the sign-in route with an encoded return and a reason', () => {
    expect(signInHref({ returnTo: '/vehicle/A1/inquire?ref=X' })).toBe('/(auth)/login?returnTo=%2Fvehicle%2FA1%2Finquire%3Fref%3DX');
    expect(signInHref({ reason: 'session_ended' })).toBe('/(auth)/login?reason=session_ended');
    expect(signInHref()).toBe('/(auth)/login');
    expect(signInHref({ returnTo: 'https://evil.example' })).toBe('/(auth)/login');
  });

  it('accepts only app-internal paths', () => {
    expect(signInReturnPathFromParam('/vehicle/A1/inquire?ref=X&campaign=Y')).toBe('/vehicle/A1/inquire?ref=X&campaign=Y');
    expect(signInReturnPathFromParam(['/inbox/thread-1', '/(tabs)'])).toBe('/inbox/thread-1');
    expect(signInReturnPathFromParam('/(tabs)')).toBe('/(tabs)');
    for (const hostile of [
      undefined,
      '',
      'vehicle/A1',
      'https://evil.example/vehicle/A1',
      '//evil.example/vehicle/A1',
      '/\\evil.example',
      'javascript:alert(1)',
      'carup://vehicle/A1',
      '/vehicle/A1\n/inquire',
      '/vehicle/A1#top',
      '/(auth)/login',
      '/(auth)/register?returnTo=%2F',
      '/login',
      `/${'a'.repeat(600)}`,
    ]) {
      expect(signInReturnPathFromParam(hostile), String(hostile)).toBeNull();
    }
  });
});

describe('source integration — every entry passes its context and Back is wired', () => {
  const read = (file: string) => readFileSync(resolve(file), 'utf8');
  const vehicle = read('app/vehicle/[vin].tsx');

  it('Vehicle Detail registers the Android hardware Back key on focus and handles it', () => {
    const effect = vehicle.slice(vehicle.indexOf('useFocusEffect('));
    expect(vehicle).toMatch(/import \{[^}]*\bBackHandler\b[^}]*\} from 'react-native'/);
    expect(vehicle).toMatch(/import \{[^}]*\buseFocusEffect\b[^}]*\} from 'expo-router'/);
    expect(effect).toMatch(/BackHandler\.addEventListener\('hardwareBackPress'/);
    expect(effect.slice(0, effect.indexOf('subscription.remove()'))).toMatch(/return true;/);
    expect(effect).toMatch(/subscription\.remove\(\)/);
  });

  it('the visible Back controls use the same contract', () => {
    expect(vehicle).toContain('leaveVehicle(router, routeContext)');
    expect(vehicle).toMatch(/label="Back" variant="tertiary" onPress=\{leave\}/);
    expect(vehicle).not.toContain("router.replace((marketplaceReturn || '/(tabs)/marketplace')");
    expect(vehicle).not.toContain("router.replace('/(tabs)/marketplace'");
    expect(vehicle).not.toContain('router.back()');
    expect(vehicle).not.toContain('Back to Market');
  });

  it('Verify opens the vehicle on top of itself instead of replacing the stack', () => {
    const verify = read('app/check-car.tsx');
    expect(verify).toContain("router.push(vehicleHref(vehicle.vin, { from: 'verify' }) as never)");
    expect(verify).not.toMatch(/router\.replace\(\(?['"`]\/vehicle\//);
  });

  it('a conversation opens its vehicle with the conversation to return to', () => {
    const thread = read('app/inbox/[threadId].tsx');
    expect(thread).toContain("vehicleHref(productRoute.id, { from: 'inbox', threadId: String(threadId) })");
    expect(thread).toContain('router.push(');
  });

  it('Buy, Home, Garage and Inbox updates name their source', () => {
    expect(read('app/(tabs)/marketplace.tsx')).toContain("vehicleHref(item.vin, { from: 'marketplace' })");
    const home = read('app/(tabs)/index.tsx');
    expect(home).toContain("vehicleHref(item.vin, { from: 'home' })");
    expect(home).toContain("vehicleHref(sellerListingQuery.data!.vin, { from: 'home' })");
    expect(read('app/(tabs)/garage.tsx')).toContain("vehicleHref(item.vin, { from: 'garage' })");
    expect(read('app/(tabs)/inbox.tsx')).toContain("vehicleHref(target.id, { from: 'inbox' })");
    for (const file of ['app/(tabs)/marketplace.tsx', 'app/(tabs)/index.tsx', 'app/(tabs)/garage.tsx', 'app/check-car.tsx']) {
      expect(read(file), file).not.toMatch(/['"`]\/vehicle\/['"`]?\s*\+|`\/vehicle\/\$\{item\.vin\}`/);
    }
  });

  it('a cold deep link keeps the tabs beneath the vehicle (anchor key verified in the installed router)', () => {
    const root = read('app/_layout.tsx');
    expect(root).toMatch(/export const unstable_settings = \{\s*anchor: '\(tabs\)',?\s*\};/);
    const routerCore = readFileSync(resolve(__dirname, '../../node_modules/expo-router/build/getRoutesCore.js'), 'utf8');
    expect(routerCore).toContain('loaded.unstable_settings.anchor');
  });
});
