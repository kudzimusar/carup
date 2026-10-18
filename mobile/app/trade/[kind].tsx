import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Button, EmptyState, StatusPill } from '../../components/ui/NativePrimitives';
import {
  getTradeRecordList,
  isTradeRecordKind,
  TradeApiError,
  tradeRecordKindLabel,
  type TradeRecordKind,
} from '../../utils/tradeApi';
import { communicationQueryScope } from '../../utils/communicationQueries';
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function recordHref(kind: TradeRecordKind, id: string, importOrderId: string | null): string {
  const base = `/trade/${kind}/${encodeURIComponent(id)}`;
  return importOrderId
    ? `${base}?importOrderId=${encodeURIComponent(importOrderId)}`
    : base;
}

export default function TradeRecordListScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string | string[] }>();
  const rawKind = first(params.kind);
  const kind = isTradeRecordKind(rawKind) ? rawKind : null;
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const scope = communicationQueryScope(user);

  const query = useQuery({
    queryKey: ['native-trade-records', scope.userId, scope.tenantId, scope.role, kind],
    queryFn: () => getTradeRecordList(kind as TradeRecordKind),
    enabled: Boolean(!loading && isAuthenticated && kind),
    retry: false,
  });

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading Trade records" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="cube-outline"
          title="Sign in to view Trade records"
          body="Trade records are participant-scoped. CarUp will not show placeholder records while you are signed out."
          actionLabel="Sign in"
          onAction={() => router.push('/(auth)/login' as never)}
          secondaryLabel="Back to Trade"
          onSecondary={() => router.replace('/(tabs)/trade' as never)}
        />
      </View>
    );
  }

  if (!kind) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="alert-circle-outline"
          title="Trade view unavailable"
          body="This Native route does not map to a certified Trade record type."
          actionLabel="Back to Trade"
          onAction={() => router.replace('/(tabs)/trade' as never)}
        />
      </View>
    );
  }

  const denied = query.error instanceof TradeApiError && [401, 403].includes(query.error.statusCode || 0);
  const unavailable = query.error instanceof TradeApiError && query.error.statusCode === 404;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[10] }}
    >
      <Button label="Back to Trade" variant="tertiary" onPress={() => router.replace('/(tabs)/trade' as never)} />
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[4] }}>
        {tradeRecordKindLabel(kind)}
      </Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1], marginBottom: spacing[4] }}>
        Only records returned by your current authenticated Trade authority are shown.
      </Text>

      {query.isLoading ? (
        <View style={{ paddingVertical: spacing[10], alignItems: 'center' }}>
          <ActivityIndicator color={theme.brand.primary} accessibilityLabel={`Loading ${tradeRecordKindLabel(kind)}`} />
        </View>
      ) : query.isError ? (
        <EmptyState
          icon={denied ? 'lock-closed-outline' : 'cloud-offline-outline'}
          title={denied ? 'Trade access denied' : unavailable ? 'Trade capability unavailable' : 'Trade records unavailable'}
          body={denied
            ? 'The current account or workspace is not authorized to read these records.'
            : unavailable
              ? 'The current backend does not expose this read capability for your authority.'
              : 'CarUp could not read the current Trade records. No synthetic records are being substituted.'}
          actionLabel="Try again"
          onAction={() => void query.refetch()}
          secondaryLabel="Back to Trade"
          onSecondary={() => router.replace('/(tabs)/trade' as never)}
        />
      ) : (query.data || []).length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="No records returned"
          body="The current Trade service returned no authorized records. CarUp will not create example or placeholder records."
          actionLabel="Refresh"
          onAction={() => void query.refetch()}
          secondaryLabel="Back to Trade"
          onSecondary={() => router.replace('/(tabs)/trade' as never)}
        />
      ) : (
        <View style={{ gap: spacing[3] }}>
          {(query.data || []).map((record) => (
            <Pressable
              key={record.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${record.title}`}
              onPress={() => router.push(recordHref(kind, record.id, record.importOrderId) as never)}
              style={({ pressed }) => ({
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: theme.border.default,
                backgroundColor: theme.background.surface,
                padding: spacing[4],
                flexDirection: 'row',
                gap: spacing[3],
                alignItems: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>
                  {record.title}
                </Text>
                {record.subtitle ? (
                  <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[1] }}>
                    {record.subtitle}
                  </Text>
                ) : null}
                {record.status ? (
                  <View style={{ marginTop: spacing[2], alignSelf: 'flex-start' }}>
                    <StatusPill label={record.status.replace(/[_-]+/g, ' ')} tone="neutral" />
                  </View>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
