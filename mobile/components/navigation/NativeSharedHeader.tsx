import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CarUpWordmark } from '../brand/CarUpBrand';
import { listCommunicationThreads } from '../../utils/communicationApi';
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../../theme/tokens';

function HeaderControl({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  const theme = useNativeTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{ color: theme.brand.heroRaised, borderless: true }}
      style={{
        width: touchTarget.minimum,
        height: touchTarget.minimum,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: '#355A78',
        overflow: 'visible',
      }}
    >
      <Ionicons name={icon} size={22} color={theme.brand.onHero} />
      {typeof badge === 'number' && badge > 0 ? (
        <View
          style={{
            position: 'absolute',
            minWidth: 19,
            height: 19,
            paddingHorizontal: 4,
            borderRadius: 10,
            top: -4,
            right: -4,
            backgroundColor: theme.brand.primary,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: theme.brand.heroDeep,
          }}
        >
          <Text allowFontScaling={false} style={{ ...typeScale.metadata, fontSize: 9, lineHeight: 11, fontWeight: '900', color: theme.brand.onPrimary }}>
            {badge > 99 ? '99+' : String(badge)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function NativeSharedHeader() {
  const theme = useNativeTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const loading = useAuthStore((state) => state.loading);
  const canReadInbox = !loading && isAuthenticated && user?.role === 'owner';

  const threadsQuery = useQuery({
    queryKey: ['native-shared-header-threads', user?.id],
    queryFn: () => listCommunicationThreads(),
    enabled: canReadInbox,
    staleTime: 30_000,
  });

  const unreadCount = useMemo(
    () => (threadsQuery.data?.threads || []).reduce(
      (sum: number, thread: any) => sum + Math.max(0, Number(thread?.unread_count || 0)),
      0,
    ),
    [threadsQuery.data],
  );

  return (
    <View
      style={{
        backgroundColor: theme.brand.heroDeep,
        paddingTop: Math.max(insets.top, spacing[2]),
        paddingHorizontal: spacing[5],
        paddingBottom: spacing[2],
        minHeight: Math.max(insets.top, 0) + 58,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: '#173A56',
      }}
    >
      <CarUpWordmark tone="light" />
      <View
        accessibilityRole="toolbar"
        accessibilityLabel="Notifications and Profile"
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}
      >
        <HeaderControl
          icon="notifications-outline"
          label={unreadCount > 0 ? `Notifications, ${unreadCount} unread conversations` : 'Notifications'}
          badge={unreadCount > 0 ? unreadCount : undefined}
          onPress={() => router.push('/(tabs)/inbox' as never)}
        />
        <HeaderControl
          icon="person-outline"
          label="Profile"
          onPress={() => router.push('/(tabs)/account' as never)}
        />
      </View>
    </View>
  );
}
