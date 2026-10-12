import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NATIVE_SHELL_TABS } from '../../navigation/nativeShell';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';
import { useAuthStore } from '../../store/authStore';
import { useFeatureGovernanceStore } from '../../store/featureGovernanceStore';

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
    name: 'index' | 'marketplace' | 'verify' | 'sell' | 'account',
    title: string,
  ) => ({
    title,
    headerShown: false,
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
            backgroundColor: focused ? theme.brand.primary : 'transpa¶»§q«^