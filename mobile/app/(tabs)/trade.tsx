import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Notice, StatusPill } from '../../components/ui/NativePrimitives';
import { getTradeGatewaySnapshot, TRADE_READ_AUTHORITIES } from '../../utils/tradeApi';
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

const CAPABILITY_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  importOrders: 'document-text-outline',
  tradeProfile: 'person-card-outline',
  containers: 'cube-outline',
  containerSpace: 'grid-outline',
  shipments: 'boat-outline',
  documents: 'folder-open-outline',
};

const CAPABILITY_COPY: Record<string, string> = {
  importOrders: 'My Import Orders',
  tradeProfile: 'Trade Profile',
  containers: 'Containers',
  containerSpace: 'Container Space',
  shipments: 'Shipments',
  documents: 'Trade Documents',
};

export default function TradeScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  const tradeQuery = useQuery({
    queryKey: ['native-trade-gateway', user?.id, user?.active_tenant_id, user?.role],
    queryFn: getTradeGatewaySnapshot,
    enabled: !loading && isAuthenticated,
    retry: false,
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingBottom: spacing[10] }}
    >
      <View
        style={{
          backgroundColor: theme.brand.hero,
          paddingHorizontal: spacing[5],
          paddingTop: spacing[6],
          paddingBottom: spacing[7],
          borderBottomLeftRadius: radius.hero,
          borderBottomRightRadius: radius.hero,
        }}
      >
        <Text allowFontScaling style={{ ...typeScale.heroEyebrow, color: theme.brand.primary }}>
          DIASPORA TRADE · GOVERNED JOURNEYS
        </Text>
        <Text allowFontScaling style={{ ...typeScale.heroDisplay, color: theme.brand.onHero, marginTop: spacing[2] }}>
          Trade
        </Text>
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.brand.onHeroMuted, marginTop: spacing[3], maxWidth: 360 }}>
          Import orders, container space, shipments and documents stay connected to CarUp's governed Trade OS.
        </Text>
      </View>

      <View style={{ paddingHorizontal: spacing[5], paddingTop: spacing[5] }}>
        {loading ? (
          <View style={{ paddingVertical: spacing[10], alignItems: 'center' }}>
            <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading Trade access" />
          </View>
        ) : !isAuthenticated ? (
          <>
            <Notice
              title="Sign in for your Trade authority"
              body="Trade records are participant-scoped. CarUp will not show example orders, containers, shipments, documents or counts while you are signed out."
              tone="info"
            />
            <Button label="Sign in" onPress={() => router.push('/(auth)/login' as never)} style={{ marginTop: spacing[4] }} />
          </>
        ) : tradeQuery.isLoading ? (
          <View style={{ paddingVertical: spacing[10], alignItems: 'center' }}>
            <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading governed Trade capabilities" />
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[3] }}>
              Checking your current Trade authority…
            </Text>
          </View>
        ) : tradeQuery.isError ? (
          <Notice
            title="Trade gateway could not refresh"
            body="CarUp could not read the governed Trade services. No unavailable capability is being presented as active."
            tone="danger"
          />
        ) : null}

        <View style={{ marginTop: spacing[5] }}>
          <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary }}>Trade gateway</Text>
          <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
            Availability below comes from the current authenticated Trade APIs. A missing permission or disabled service stays unavailable.
          </Text>
        </View>

        <View style={{ gap: spacing[3], marginTop: spacing[4] }}>
          {(isAuthenticated && tradeQuery.data
            ? tradeQuery.data.capabilities
            : TRADE_READ_AUTHORITIES.map(({ key, endpoint }) => ({
                key,
                endpoint,
                label: CAPABILITY_COPY[key],
                state: 'unavailable' as const,
                count: null,
                note: 'Sign in to let CarUp check this governed capability for your account.',
              }))
          ).map((capability) => (
            <View
              key={capability.key}
              accessibilityLabel={`${capability.label}, ${capability.state}`}
              style={{
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: capability.state === 'available' ? theme.brand.primary : theme.border.default,
                backgroundColor: theme.background.surface,
                padding: spacing[4],
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.control,
                    backgroundColor: capability.state === 'available' ? theme.brand.primarySubtle : theme.background.surfaceSunken,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={CAPABILITY_ICONS[capability.key] || 'trail-sign-outline'}
                    size={23}
                    color={capability.state === 'available' ? theme.brand.primary : theme.text.secondary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] }}>
                    <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary, flex: 1 }}>
                      {capability.label}
                    </Text>
                    <StatusPill
                      label={capability.state === 'available' ? 'Available' : 'Unavailable'}
                      tone={capability.state === 'available' ? 'success' : 'neutral'}
                    />
                  </View>
                  <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[2] }}>
                    {capability.note}
                  </Text>
                  {capability.state === 'available' && typeof capability.count === 'number' ? (
                    <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.secondary, marginTop: spacing[2] }}>
                      {capability.count} current record{capability.count === 1 ? '' : 's'} returned by this governed read.
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={{ marginTop: spacing[5] }}>
          <Notice
            title="Start Import"
            body="The canonical Trade service supports governed import-order creation. This R5-R4 gateway does not fabricate a native creation form or submit an import until that bounded native workflow is certified."
            tone="info"
          />
        </View>

        <View style={{ marginTop: spacing[4] }}>
          <Button
            label="Refresh Trade access"
            variant="secondary"
            onPress={() => void tradeQuery.refetch()}
            disabled={!isAuthenticated || tradeQuery.isFetching}
          />
        </View>
      </View>
    </ScrollView>
  );
}
