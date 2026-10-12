import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NATIVE_SHELL_TABS } from '../../navigation/nativeShell';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';
import { useAuthStore } from '../../store/authStore';
import { useFeatureGovernanceStore } from '../../store/featureGovernanceStore';

const iconByName = new Map(NATIVE_SHELL_TABS.map((tab) => [tab.name, tab.icon]));

export default function TabLayout() {
  const theme = useNativeTheme();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((state) => state.user?.id);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    void useFeatureGovernanceStore.getState().refresh();
  }, [userId, token]);

  const stableOptions = (name: 'index' | 'marketplace' | 'inbox' | 'account', title: string) => ({
    title,
    headerShown: false,
    tabBarIcon: ({ color, size }: { color: string; size: number }) => (
      <Ionicons name={iconByName.get(name) ?? 'ellipse-outline'} color={color} size={size} />
    ),
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.text.primary,
        tabBarInactiveTintColor: theme.text.muted,
        tabBarLabelStyle: {
          ...typeScale.metadata,
          fontWeight: '600',
        },
        tabBarItemStyle: {
          minHeight: 48,
          paddingTop: spacing[1],
        },
        tabBarStyle: {
          backgroundColor: theme.background.surface,
          borderTopColor: theme.border.default,
          borderTopWidth: 1,
          paddingTop: spacing[1],
          paddingBottom: Math.max(insets.bottom, spacing[2]),
        },
      }}
    >
      <Tabs.Screen name="index" options={stableOptions('index', 'Home')} />
      <Tabs.Screen name="marketplace" options={stableOptions('marketplace', 'Market')} />
      <Tabs.Screen name="inbox" options={stableOptions('inbox', 'Inbox')} />
      <Tabs.Screen name="account" options={stableOptions('account', 'Account')} />

      <Tabs.Screen name="garage" options={{ href: null }} />
      <Tabs.Screen name="escrow" options={{ href: null }} />
      <Tabs.Screen name="referral" options={{ href: null }} />
      <Tabs.Screen name="communications" options={{ href: null }} />
      <Tabs.Screen name="more" options={{ href: null }} />
    </Tabs>
  );
}
