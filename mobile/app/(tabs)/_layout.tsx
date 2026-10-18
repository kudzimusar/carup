import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NATIVE_SHELL_TABS } from '../../navigation/nativeShell';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';
import { useAuthStore } from '../../store/authStore';
import { useFeatureGovernanceStore } from '../../store/featureGovernanceStore';
import { NativeSharedHeader } from '../../components/navigation/NativeSharedHeader';

const tabByName = new Map(NATIVE_SHELL_TABS.map((tab) => [tab.name, tab]));

export default function TabLayout() {
  const theme = useNativeTheme();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((state) => state.user?.id);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    void useFeatureGovernanceStore.getState().refresh();
  }, [userId, token]);

  const stableOptions = (
    name: 'index' | 'marketplace' | 'verify' | 'sell' | 'trade',
    title: string,
  ) => ({
    title,
    tabBarAccessibilityLabel: title,
    tabBarButtonTestID: `primary-tab-${name}`,
    tabBarIcon: ({
      color,
      focused,
    }: {
      color: string;
      size: number;
      focused: boolean;
    }) => {
      const tab = tabByName.get(name);
      return (
        <View
          style={{
            width: 42,
            height: 30,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: focused ? theme.brand.primary : 'transparent',
          }}
        >
          <Ionicons
            name={(focused ? tab?.activeIcon : tab?.icon) ?? 'ellipse-outline'}
            color={focused ? theme.brand.onPrimary : color}
            size={20}
          />
        </View>
      );
    },
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        header: () => <NativeSharedHeader />,
        tabBarActiveTintColor: theme.brand.primary,
        tabBarInactiveTintColor: '#C8D5E2',
        tabBarLabelStyle: {
          ...typeScale.navLabel,
        },
        tabBarItemStyle: {
          minHeight: 48,
          paddingTop: spacing[1],
        },
        tabBarStyle: {
          height: 64 + insets.bottom,
          backgroundColor: theme.brand.heroDeep,
          borderTopColor: '#173A56',
          borderTopWidth: 1,
          paddingTop: spacing[1],
          paddingBottom: Math.max(insets.bottom, spacing[2]),
        },
      }}
    >
      <Tabs.Screen name="index" options={stableOptions('index', 'Home')} />
      <Tabs.Screen name="marketplace" options={stableOptions('marketplace', 'Buy')} />
      <Tabs.Screen name="verify" options={stableOptions('verify', 'Verify')} />
      <Tabs.Screen name="sell" options={stableOptions('sell', 'Sell')} />
      <Tabs.Screen name="trade" options={stableOptions('trade', 'Trade')} />

      <Tabs.Screen name="account" options={{ href: null }} />

      <Tabs.Screen name="inbox" options={{ href: null }} />
      <Tabs.Screen name="garage" options={{ href: null }} />
      <Tabs.Screen name="escrow" options={{ href: null }} />
      <Tabs.Screen name="referral" options={{ href: null }} />
      <Tabs.Screen name="communications" options={{ href: null }} />
      <Tabs.Screen name="more" options={{ href: null }} />
    </Tabs>
  );
}
