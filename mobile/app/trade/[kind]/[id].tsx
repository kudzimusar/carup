import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Notice, StatusPill } from '../../../components/ui/NativePrimitives';
import {
  getTradeRecordDetail,
  isTradeRecordKind,
  TradeApiError,
  tradeRecordKindLabel,
  type TradeRecordKind,
} from '../../../utils/tradeApi';
import { communicationQueryScope } from '../../../utils/communicationQueries';
import { useAuthStore } from '../../../store/authStore';
import { radius, spacing, typeScale, useNativeTheme } from '../../../theme/tokens';

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export default function TradeRecordDetailScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    kind?: string | string[];
    id?: string | string[];
    importOrderId?: string | string[];
  }>();
  const rawKind = first(params.kind);
  const kind = isTradeRecordKind(rawKind) ? rawKind : null;
  const id = first(params.id).trim();
  const importOrderId = first(params.importOrderId).trim() || null;
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const scope = communicationQueryScope(user);

  const query = useQuery({
    queryKey: ['native-trade-record-detail', scope.userId, scope.tenantId, scope.role, kind, id, importOrderId],
    queryFn: () => getTradeRecordDetail(kind as TradeRecordKind, id, { importOrderId }),
    enabled: Boolean(!loading && isAuthenticated && kind && id),
    retry: false,
  });

  const backToRecords = () => {
    if (kind) router.replace(`/trade/${kind}` as never);
    else router.replace('/(tabs)/trade' as never);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading Trade record" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="cube-outline"
          title="Sign in to view this Trade record"
          body="Trade records are visible only to the people involved. Sign in to see this one."
          actionLabel="Sign in"
          onAction={() => router.push('/(auth)/login' as never)}
          secondaryLabel="Back to Trade"
          onSecondary={() => router.replace('/(tabs)/trade' as never)}
        />
      </View>
    );
  }

  if (!kind || !id) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="alert-circle-outline"
          title="Trade record unavailable"
          body="This link does not point to a trade record the app can show."
          actionLabel="Back to Trade"
          onAction={() => router.replace('/(tabs)/trade' as never)}
        />
      </View>
    );
  }

  const tradeError = query.error instanceof TradeApiError ? query.error : null;
  const denied = Boolean(tradeError && [401, 403].includes(tradeError.statusCode || 0));
  const dependency = tradeError?.statusCode === 424;
  const missing = tradeError?.statusCode === 404;

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel={`Loading ${tradeRecordKindLabel(kind)} detail`} />
      </View>
    );
  }

  if (query.isError || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon={denied ? 'lock-closed-outline' : dependency ? 'link-outline' : 'document-text-outline'}
          title={denied
            ? 'Trade access denied'
            : dependency
              ? 'Open this from its import order'
              : missing
                ? 'Trade record not found'
                : 'Trade record unavailable'}
          body={denied
            ? 'This account or workspace cannot see this record.'
            : dependency
              ? 'This reservation can only be opened from the import order it belongs to.'
              : missing
                ? 'CarUp could not find this record among the ones you can see.'
                : 'CarUp could not load this record, so nothing is shown in its place. Try again.'}
          actionLabel="Try again"
          onAction={() => void query.refetch()}
          secondaryLabel="Back to records"
          onSecondary={backToRecords}
        />
      </View>
    );
  }

  const record = query.data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[10] }}
    >
      <Button label="Back to records" variant="tertiary" onPress={backToRecords} />
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[4] }}>
        {tradeRecordKindLabel(kind)}
      </Text>
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[1] }}>
        {record.title}
      </Text>
      {record.status ? (
        <View style={{ marginTop: spacing[3], alignSelf: 'flex-start' }}>
          <StatusPill label={record.status.replace(/[_-]+/g, ' ')} tone="neutral" />
        </View>
      ) : null}

      <View
        style={{
          marginTop: spacing[5],
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: theme.border.default,
          backgroundColor: theme.background.surface,
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
        }}
      >
        {record.fields.length > 0 ? record.fields.map((field) => (
          <View
            key={`${field.label}:${field.value}`}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: spacing[4],
              paddingVertical: spacing[2],
            }}
          >
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
              {field.label}
            </Text>
            <Text
              allowFontScaling
              style={{ ...typeScale.label, color: theme.text.secondary, flex: 1, textAlign: 'right' }}
            >
              {field.value}
            </Text>
          </View>
        )) : (
          <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, paddingVertical: spacing[3] }}>
            There are no more details for this record.
          </Text>
        )}
      </View>

      {kind === 'containerSpace' ? (
        <View style={{ marginTop: spacing[4] }}>
          <Notice
            title="View only"
            body="You can view this reservation here. Changes to a reservation are not available in the app."
            tone="info"
          />
        </View>
      ) : null}
    </ScrollView>
  );
}
