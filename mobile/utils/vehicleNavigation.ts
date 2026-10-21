/**
 * CARUP-MVP-STAB-01 F-003 / F-014 — the one navigation contract for Vehicle Detail.
 *
 * Vehicle Detail is a root-stack screen opened from Buy, Results, Verify, a conversation, Home,
 * My Garage and deep links. Every entry names its source (`from`) so that leaving the vehicle —
 * through the visible Back control or the Android hardware key — returns to the screen the buyer
 * came from when there is history, and to that source's own tab when there is none. Leaving never
 * pushes, so it can never create a navigation loop.
 *
 * Pure and node-safe: no React Native import, so the contract is unit-tested directly.
 */
import { marketplaceReturnFromParam } from './marketplaceNavigation';

export type VehicleEntrySource =
  | 'marketplace'
  | 'results'
  | 'verify'
  | 'inbox'
  | 'home'
  | 'garage'
  | 'deeplink';

export const VEHICLE_ENTRY_SOURCES: readonly VehicleEntrySource[] = [
  'marketplace',
  'results',
  'verify',
  'inbox',
  'home',
  'garage',
  'deeplink',
];

export interface VehicleRouteContext {
  from?: VehicleEntrySource;
  /** The conversation an Inbox entry returns to. */
  threadId?: string | null;
  /** The exact Results view a Results entry returns to. */
  marketReturn?: string | null;
  /** Referral code carried from a shared link (`ref` or `referral`). */
  ref?: string | null;
  /** Campaign code carried from a shared link. */
  campaign?: string | null;
}

type SearchParam = string | string[] | undefined | null;

export interface VehicleRouteParams {
  from?: SearchParam;
  threadId?: SearchParam;
  marketReturn?: SearchParam;
  ref?: SearchParam;
  referral?: SearchParam;
  campaign?: SearchParam;
  [key: string]: SearchParam;
}

/** The minimum of expo-router's router that leaving needs; `never` keeps typed-route hrefs assignable. */
export interface VehicleLeaveRouter {
  canGoBack(): boolean;
  back(): void;
  replace(href: never): void;
}

function first(value: SearchParam): string {
  return Array.isArray(value) ? String(value[0] ?? '').trim() : String(value ?? '').trim();
}

/** Same identifier rule the conversation routes already use (nativeObjectRouting). */
function safeThreadId(value: SearchParam): string | null {
  const id = first(value);
  if (!id || id.length > 200) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(id) ? id : null;
}

/** Referral and campaign codes are short opaque tokens; anything else is dropped, never forwarded. */
export function safeAttributionCode(value: SearchParam): string | null {
  const code = first(value);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(code) ? code : null;
}

function entrySource(value: SearchParam): VehicleEntrySource | null {
  const raw = first(value) as VehicleEntrySource;
  return VEHICLE_ENTRY_SOURCES.includes(raw) ? raw : null;
}

/** Normalise and validate the params a Vehicle (or composer) route received. */
export function vehicleRouteContextFromParams(params: VehicleRouteParams): VehicleRouteContext {
  const marketReturn = marketplaceReturnFromParam(params.marketReturn ?? undefined);
  // A Results return built before `from` existed still identifies a Results entry.
  const from = entrySource(params.from) ?? (marketReturn ? 'results' : null);
  const context: VehicleRouteContext = {};
  if (from) context.from = from;
  if (from === 'inbox') {
    const threadId = safeThreadId(params.threadId);
    if (threadId) context.threadId = threadId;
  }
  if (from === 'results' && marketReturn) context.marketReturn = marketReturn;
  const ref = safeAttributionCode(params.ref) ?? safeAttributionCode(params.referral);
  if (ref) context.ref = ref;
  const campaign = safeAttributionCode(params.campaign);
  if (campaign) context.campaign = campaign;
  return context;
}

function contextQuery(context: VehicleRouteContext): string {
  const normalized = vehicleRouteContextFromParams({
    from: context.from,
    threadId: context.threadId,
    marketReturn: context.marketReturn,
    ref: context.ref,
    campaign: context.campaign,
  });
  const pairs: string[] = [];
  if (normalized.from) pairs.push(`from=${encodeURIComponent(normalized.from)}`);
  if (normalized.marketReturn) pairs.push(`marketReturn=${encodeURIComponent(normalized.marketReturn)}`);
  if (normalized.threadId) pairs.push(`threadId=${encodeURIComponent(normalized.threadId)}`);
  if (normalized.ref) pairs.push(`ref=${encodeURIComponent(normalized.ref)}`);
  if (normalized.campaign) pairs.push(`campaign=${encodeURIComponent(normalized.campaign)}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

/** The Vehicle Detail href for an entry from `context.from`. */
export function vehicleHref(vin: string, context: VehicleRouteContext = {}): string {
  return `/vehicle/${encodeURIComponent(vin)}${contextQuery(context)}`;
}

/** The message composer for the same vehicle, carrying the same context (and attribution). */
export function vehicleInquiryHref(vin: string, context: VehicleRouteContext = {}): string {
  return `/vehicle/${encodeURIComponent(vin)}/inquire${contextQuery(context)}`;
}

/** Where leaving a vehicle lands when there is no history to go back to. */
export function vehicleLeaveFallback(context: VehicleRouteContext): string {
  const normalized = vehicleRouteContextFromParams({
    from: context.from,
    threadId: context.threadId,
    marketReturn: context.marketReturn,
  });
  switch (normalized.from) {
    case 'marketplace':
      return '/(tabs)/marketplace';
    case 'results':
      return normalized.marketReturn || '/(tabs)/marketplace';
    case 'verify':
      return '/(tabs)/verify';
    case 'inbox':
      return normalized.threadId ? `/inbox/${encodeURIComponent(normalized.threadId)}` : '/(tabs)/inbox';
    default:
      return '/(tabs)';
  }
}

/**
 * Leave Vehicle Detail: back to the previous screen when there is one, otherwise replace the
 * vehicle with its source's fallback. Never pushes — leaving cannot stack a loop.
 */
export function leaveVehicle(router: VehicleLeaveRouter, context: VehicleRouteContext): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(vehicleLeaveFallback(context) as never);
}

/** The root-stack route name expo-router gives `app/vehicle/[vin].tsx`. */
export const VEHICLE_DETAIL_ROUTE_NAME = 'vehicle/[vin]';

/**
 * Leave the message composer without writing anything: back to the vehicle when it is directly
 * beneath, otherwise open that vehicle in the composer's place.
 */
export function leaveComposer(
  router: VehicleLeaveRouter,
  options: { vin: string; previousRouteName?: string | null; context: VehicleRouteContext },
): void {
  if (options.previousRouteName === VEHICLE_DETAIL_ROUTE_NAME && router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(vehicleHref(options.vin, options.context) as never);
}

export const SIGN_IN_ROUTE = '/(auth)/login';
export type SignInReason = 'session_ended';

/**
 * Sign-in may return only to an app-internal path: one leading slash, no scheme or host, no
 * backslash or control character, no fragment, and never back into the sign-in screens themselves.
 */
export function signInReturnPathFromParam(value: SearchParam): string | null {
  const raw = first(value);
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;
  try {
    const parsed = new URL(raw, 'https://carup.invalid');
    if (parsed.origin !== 'https://carup.invalid' || parsed.hash) return null;
    const path = parsed.pathname;
    if (path.startsWith('/(auth)') || path === '/login' || path === '/register') return null;
    return `${path}${parsed.search}`;
  } catch {
    return null;
  }
}

export function signInHref(options: { returnTo?: string | null; reason?: SignInReason } = {}): string {
  const pairs: string[] = [];
  const returnTo = signInReturnPathFromParam(options.returnTo ?? undefined);
  if (returnTo) pairs.push(`returnTo=${encodeURIComponent(returnTo)}`);
  if (options.reason === 'session_ended') pairs.push('reason=session_ended');
  return `${SIGN_IN_ROUTE}${pairs.length ? `?${pairs.join('&')}` : ''}`;
}
