import {
  canonicalObjectRouteFromCommunicationNotification,
  nativeCanonicalObjectHref,
  type NativeCanonicalObjectRoute,
} from './nativeObjectRouting';

export type CanonicalPushNavigationResult =
  | { state: 'routed'; target: NativeCanonicalObjectRoute }
  | { state: 'auth_required' }
  | { state: 'safe_fallback'; target: NativeCanonicalObjectRoute | null };

export interface CanonicalPushNavigationDeps {
  isAuthenticated: () => boolean;
  authorizeConversation: (threadId: string) => Promise<boolean>;
  authorizeVehicle: (listingId: string) => Promise<boolean>;
  navigate: (href: string) => void;
  navigateToLogin: () => void;
  navigateToInbox: () => void;
  navigateToMarketplace: () => void;
}

/**
 * A push payload is navigation intent only. Before a protected conversation is
 * opened, the current session re-reads canonical backend authority.
 */
export async function routeCanonicalPushPayload(
  data: unknown,
  deps: CanonicalPushNavigationDeps,
): Promise<CanonicalPushNavigationResult> {
  const target = canonicalObjectRouteFromCommunicationNotification({ payload: data });

  if (!deps.isAuthenticated()) {
    deps.navigateToLogin();
    return { state: 'auth_required' };
  }

  if (!target) {
    deps.navigateToInbox();
    return { state: 'safe_fallback', target: null };
  }

  if (target.type === 'conversation') {
    const allowed = await deps.authorizeConversation(target.id).catch(() => false);
    if (!allowed) {
      deps.navigateToInbox();
      return { state: 'safe_fallback', target };
    }
    deps.navigate(nativeCanonicalObjectHref(target));
    return { state: 'routed', target };
  }

  const available = await deps.authorizeVehicle(target.id).catch(() => false);
  if (!available) {
    deps.navigateToMarketplace();
    return { state: 'safe_fallback', target };
  }
  deps.navigate(nativeCanonicalObjectHref(target));
  return { state: 'routed', target };
}
