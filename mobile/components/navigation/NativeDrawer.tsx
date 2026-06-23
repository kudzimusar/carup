/**
 * Governed native drawer panel (Milestone C).
 *
 * A CONTROLLED, custom slide-in drawer — deliberately NOT @react-navigation/drawer
 * (which conflicts with the expo-router Tabs setup and adds dependencies). It is
 * a react-native `Modal` + the built-in `Animated` API for the slide/overlay, so
 * it ships with ZERO new dependencies. See
 * docs/navigation-intelligence/NATIVE_NAVIGATION_IMPLEMENTATION.md for rationale.
 *
 * What it renders is decided by the PURE `resolveDrawerSections(ctx)` helper, so
 * the panel cannot leak a web-only route or duplicate a visible tab — the same
 * governed truth the tabs consume drives it. Navigation closes the drawer first,
 * then `router.push`es. Role switch / Sign out call the auth store then refresh
 * governance. Android hardware back closes the drawer before leaving the screen.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useFeatureGovernanceStore } from '../../store/featureGovernanceStore';
import { getNativeIcon } from '../../navigation/featureIcons';
import {
  resolveDrawerSections,
  type DrawerItem,
  type DrawerLinkItem,
  type DrawerActionItem,
} from '../../navigation/nativeDrawerSections';
import type { NativeNavContext } from '../../navigation/types';

interface NativeDrawerProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Map a manifest Expo route (e.g. `/(tabs)/index`, `/(tabs)/escrow`) to:
 *  - `href`: the value passed to `router.push` (group-stripped path), and
 *  - `pathname`: the value `usePathname()` reports, for the active highlight.
 * Only real, shipped native routes are ever produced here.
 */
function routeToHref(expoRoute: string): string {
  // Strip the `(tabs)` (or any `(group)`) route-group segment.
  const cleaned = expoRoute.replace(/\/\([^)]+\)/g, '');
  // `/index` is the tabs root ⇒ expo-router pathname `/`.
  if (cleaned === '/index' || cleaned === '') return '/';
  return cleaned;
}

const BRAND_NAVY = '#0f172a';

export function NativeDrawer({ visible, onClose }: NativeDrawerProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, Math.round(width * 0.82));

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role ?? null);
  const userName = useAuthStore((s) => s.user?.name ?? null);
  const logout = useAuthStore((s) => s.logout);
  const switchRole = useAuthStore((s) => s.switchRole);
  const effectiveStates = useFeatureGovernanceStore((s) => s.effectiveStates);

  const ctx: NativeNavContext = {
    isAuthenticated,
    role,
    environment: 'production',
    effectiveStates,
  };
  const sections = resolveDrawerSections(ctx);

  // Slide + dim animation driven by `visible`.
  const slide = useRef(new Animated.Value(0)).current; // 0 closed → 1 open
  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  // Android hardware back closes the drawer FIRST (before leaving the screen).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true; // consumed
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth, 0],
  });
  const overlayOpacity = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  /** Navigate to a real native route — close first, then push. */
  const goTo = useCallback(
    (expoRoute: string) => {
      onClose();
      const href = routeToHref(expoRoute);
      // Defer the push so the close animation can start cleanly.
      requestAnimationFrame(() => router.push(href as never));
    },
    [onClose, router],
  );

  /** Run an account action (sign in/out, role switch), then refresh governance. */
  const runAction = useCallback(
    async (id: DrawerActionItem['id']) => {
      switch (id) {
        case 'account.signin':
          onClose();
          requestAnimationFrame(() => router.push('/login' as never));
          return;
        case 'account.signout':
          onClose();
          await logout();
          await useFeatureGovernanceStore.getState().refresh();
          requestAnimationFrame(() => router.replace('/' as never));
          return;
        case 'account.switch-owner':
          onClose();
          await switchRole('owner');
          await useFeatureGovernanceStore.getState().refresh();
          return;
        case 'account.role':
          // Read-only label — no-op.
          return;
      }
    },
    [logout, switchRole, onClose, router],
  );

  function renderLink(item: DrawerLinkItem): React.ReactElement {
    const selected = pathname === routeToHref(item.expoRoute);
    return (
      <Pressable
        key={item.id}
        onPress={() => goTo(item.expoRoute)}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        accessibilityState={{ selected }}
        style={({ pressed }) => [
          styles.item,
          selected && styles.itemSelected,
          pressed && styles.itemPressed,
        ]}
      >
        <View style={styles.itemIcon}>
          {getNativeIcon(item.iconName, {
            size: 20,
            color: selected ? '#f97316' : '#cbd5e1',
          })}
        </View>
        <Text style={[styles.itemLabel, selected && styles.itemLabelSelected]}>
          {item.label}
        </Text>
      </Pressable>
    );
  }

  function renderAction(item: DrawerActionItem): React.ReactElement {
    if (item.readOnly) {
      return (
        <View key={item.id} style={styles.item} accessibilityRole="text">
          <View style={styles.itemIcon}>
            {getNativeIcon(item.iconName, { size: 20, color: '#64748b' })}
          </View>
          <Text style={styles.itemLabelMuted}>{item.label}</Text>
        </View>
      );
    }
    return (
      <Pressable
        key={item.id}
        onPress={() => void runAction(item.id)}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
      >
        <View style={styles.itemIcon}>
          {getNativeIcon(item.iconName, {
            size: 20,
            color: item.destructive ? '#f87171' : '#cbd5e1',
          })}
        </View>
        <Text style={[styles.itemLabel, item.destructive && styles.itemLabelDestructive]}>
          {item.label}
        </Text>
      </Pressable>
    );
  }

  function renderItem(item: DrawerItem): React.ReactElement {
    return item.kind === 'link' ? renderLink(item) : renderAction(item);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* Dim overlay — tap to close. */}
        <Animated.View
          style={[styles.overlayFill, { opacity: overlayOpacity }]}
          pointerEvents="none"
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={onClose}
        />

        {/* Slide-in panel. */}
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateX }],
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Text style={styles.brand}>CarUp</Text>
            {userName ? <Text style={styles.subtitle}>{userName}</Text> : null}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {sections.map((section) => (
              <View key={section.id} style={styles.section}>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  {section.title}
                </Text>
                {section.items.map(renderItem)}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  overlayFill: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000' },
  panel: {
    backgroundColor: BRAND_NAVY,
    paddingHorizontal: 16,
    height: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 16,
  },
  header: {
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e293b',
    marginBottom: 8,
  },
  brand: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  section: { marginTop: 16 },
  sectionTitle: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    // Min 44px touch target for accessibility.
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  itemSelected: { backgroundColor: '#1e293b' },
  itemPressed: { backgroundColor: '#162032' },
  itemIcon: { width: 28, alignItems: 'center', marginRight: 10 },
  itemLabel: { color: '#e2e8f0', fontSize: 15, fontWeight: '500' },
  itemLabelSelected: { color: '#f97316', fontWeight: '700' },
  itemLabelMuted: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
  itemLabelDestructive: { color: '#f87171', fontWeight: '600' },
});

export default NativeDrawer;
