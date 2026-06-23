/**
 * Governed role-aware bottom tabs (Milestone B).
 *
 * The tab bar is no longer a static list. It is driven by the pure
 * `resolveTabBar` plan (governance → tab visibility), so what renders == what is
 * unit-tested. A tab whose owning feature is hidden / disabled / role-denied /
 * planned / backend-not-visible (i.e. not in `getNativeTabs`) is hidden via
 * `href: null`. `escrow` is drawer-only (Milestone C) and is always hidden here.
 *
 * On every identity change (login / logout / role switch) we refresh the
 * governed feature truth so the tabs reflect the active identity. Safe-area
 * insets pad the bar bottom for the Android nav bar / iPhone home indicator.
 */
import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useFeatureGovernanceStore } from '../../store/featureGovernanceStore';
import { resolveTabBar } from '../../navigation/nativeNavigationManifest';
import { getNativeIcon } from '../../navigation/featureIcons';
import type { NativeNavContext } from '../../navigation/types';

/** Static header titles per screen (screen-specific, not part of the manifest). */
const HEADER_TITLES: Record<string, string> = {
  index: 'CarUp Dashboard',
  garage: 'Garage Portal',
  escrow: 'SafePay Escrows',
  marketplace: 'CarUp Vehicles',
  referral: 'Refer & Earn',
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const effectiveStates = useFeatureGovernanceStore((s) => s.effectiveStates);

  // Refresh governed feature truth whenever the auth identity changes, so the
  // visible tabs always reflect the current user/token. Non-blocking + fail-safe
  // (the governance store guards against stale identities and defaults to the
  // static manifest on failure).
  useEffect(() => {
    void useFeatureGovernanceStore.getState().refresh();
  }, [user?.id, token]);

  const ctx: NativeNavContext = {
    isAuthenticated,
    role: user?.role ?? null,
    environment: 'production',
    effectiveStates,
  };

  // Pure governance → tab plan (visibility + beta), one row per real screen.
  const plan = resolveTabBar(ctx);
  const byName = new Map(plan.map((p) => [p.name, p]));

  /** Per-screen options derived from the governed plan. */
  function optionsFor(name: string) {
    const item = byName.get(name);
    // Defensive: a screen with no plan row (should not happen) stays hidden.
    if (!item) {
      return { href: null as null, title: name, headerTitle: HEADER_TITLES[name] };
    }
    return {
      title: item.title,
      headerTitle: HEADER_TITLES[name] ?? item.title,
      // expo-router hides a tab from the bar when href === null.
      href: item.visible ? undefined : (null as null),
      tabBarIcon: ({ color, size }: { color: string; size: number }) =>
        getNativeIcon(item.iconName, { color, size }),
      // Beta owners get a small beta indicator (only when beta).
      ...(item.beta ? { tabBarBadge: 'β' as const } : {}),
    };
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: '#0f172a', // Navy brand background
        },
        headerTitleStyle: {
          color: '#ffffff',
          fontWeight: 'bold',
        },
        tabBarStyle: {
          backgroundColor: '#0f172a',
          borderTopWidth: 0,
          // Safe-area aware: pad the bar bottom for the Android nav bar /
          // iPhone home indicator instead of a hardcoded inset.
          height: 60 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarActiveTintColor: '#f97316', // Orange active token
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tabs.Screen name="index" options={optionsFor('index')} />
      <Tabs.Screen name="garage" options={optionsFor('garage')} />
      <Tabs.Screen name="escrow" options={optionsFor('escrow')} />
      <Tabs.Screen name="marketplace" options={optionsFor('marketplace')} />
      <Tabs.Screen name="referral" options={optionsFor('referral')} />
    </Tabs>
  );
}
