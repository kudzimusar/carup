/**
 * Governed role-aware bottom tabs + native navigation hub (Milestones B + C).
 *
 * The tab bar is driven by the pure `resolveTabBar` plan (governance → tab
 * visibility), so what renders == what is unit-tested. A tab whose owning
 * feature is hidden / disabled / role-denied / planned / backend-not-visible
 * (i.e. not in `getNativeTabs`) is hidden via `href: null`. `escrow` is
 * drawer-only and is always hidden here.
 *
 * Milestone C adds a 5th "More" tab — the predictable native navigation hub. Its
 * `tabBarButton` does NOT navigate: for an authenticated user it opens the
 * governed `NativeDrawer` (drawer `visible` state is lifted into THIS layout);
 * for an anonymous user it routes to sign-in instead of an empty menu. With the
 * current role counts (owner: index/marketplace/garage/referral + More = 5;
 * others: index/marketplace + More = 3) the ≤5-tab ceiling always holds.
 *
 * On every identity change (login / logout / role switch) we refresh the
 * governed feature truth so the tabs reflect the active identity.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useFeatureGovernanceStore } from '../../store/featureGovernanceStore';
import { resolveTabBar } from '../../navigation/nativeNavigationManifest';
import { resolveMoreTab } from '../../navigation/nativeDrawerSections';
import { getNativeIcon } from '../../navigation/featureIcons';
import { NativeDrawer } from '../../components/navigation/NativeDrawer';
import type { NativeNavContext } from '../../navigation/types';

/** Static header titles per screen (screen-specific, not part of the manifest). */
const HEADER_TITLES: Record<string, string> = {
  index: 'CarUp Dashboard',
  garage: 'Garage Portal',
  escrow: 'SafePay Escrows',
  marketplace: 'CarUp Vehicles',
  referral: 'Refer & Earn',
  communications: 'Communications',
  more: 'More',
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const effectiveStates = useFeatureGovernanceStore((s) => s.effectiveStates);

  // Drawer open/close state is OWNED by the layout (the More tab toggles it).
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Refresh governed feature truth whenever the auth identity changes, so the
  // visible tabs always reflect the current user/token. Non-blocking + fail-safe
  // (the governance store guards against stale identities and defaults to the
  // static manifest on failure).
  useEffect(() => {
    void useFeatureGovernanceStore.getState().refresh();
  }, [user?.id, token]);

  // Close the drawer automatically on identity change (login/logout/role switch).
  useEffect(() => {
    setDrawerOpen(false);
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
  const moreTab = resolveMoreTab(ctx);

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

  /** Press handler for the More tab: open drawer (authed) or go to sign-in. */
  function onMorePress() {
    if (moreTab.action === 'drawer') {
      setDrawerOpen(true);
    } else {
      router.push('/login' as never);
    }
  }

  return (
    <>
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
            // Subtle navy hairline divider instead of a hard 0/1px platform line.
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: '#1e293b',
            // Safe-area aware: pad the bar bottom for the Android nav bar /
            // iPhone home indicator instead of a hardcoded inset.
            height: 60 + insets.bottom,
            paddingTop: 6,
            paddingBottom: Math.max(insets.bottom, 8),
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarActiveTintColor: '#f97316', // Orange active token
          tabBarInactiveTintColor: '#94a3b8',
        }}
      >
        <Tabs.Screen name="index" options={optionsFor('index')} />
        <Tabs.Screen name="garage" options={optionsFor('garage')} />
        <Tabs.Screen name="escrow" options={optionsFor('escrow')} />
        <Tabs.Screen name="marketplace" options={optionsFor('marketplace')} />
        <Tabs.Screen name="referral" options={optionsFor('referral')} />
        <Tabs.Screen name="communications" options={optionsFor('communications')} />
        <Tabs.Screen
          name="more"
          options={{
            title: moreTab.title,
            headerTitle: HEADER_TITLES.more,
            tabBarIcon: ({ color, size }: { color: string; size: number }) =>
              getNativeIcon(moreTab.iconName, { color, size }),
            // Custom button: intercept press → open drawer / sign-in. Never
            // navigates to the `more` route (which only redirects home).
            tabBarButton: (props) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={moreTab.action === 'drawer' ? 'Open menu' : 'Sign in'}
                accessibilityState={{ expanded: drawerOpen }}
                onPress={onMorePress}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44 }}
              >
                <View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center' }}>
                  {props.children}
                </View>
              </Pressable>
            ),
          }}
        />
      </Tabs>

      {/* Governed native navigation hub — opened by the More tab. */}
      <NativeDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
