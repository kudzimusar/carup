import React from 'react';
import { View, Text, Pressable, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';
import { apiUrl, resolveApiBaseUrl } from '../../utils/apiBase';
import { csrfFetch } from '../../utils/csrfFetch';
import {
  readCanonicalTransactions,
  safePayFailureCopy,
  safePayViewState,
  shouldRetrySafePayRead,
  type CanonicalTransaction,
} from '../../utils/safePayTransactions';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    eligible: 'Eligible',
    initiated: 'Payment started',
    funds_held: 'Funds held',
    inspection_pending: 'Inspection pending',
    release_approved: 'Release approved',
    settled: 'Settled',
    disputed: 'Disputed',
    refunded: 'Refunded',
    cancelled: 'Cancelled',
    failed: 'Not eligible',
    funded_sandbox: 'Sandbox funds held',
    released_sandbox: 'Sandbox settled',
    refunded_sandbox: 'Sandbox refunded',
  };
  return labels[status] || status.replace(/_/g, ' ');
}

function statusTone(status: string) {
  if (['settled', 'released_sandbox'].includes(status)) return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (['funds_held', 'funded_sandbox', 'inspection_pending', 'release_approved'].includes(status)) return 'text-blue-700 bg-blue-50 border-blue-100';
  if (['cancelled', 'refunded', 'refunded_sandbox'].includes(status)) return 'text-slate-600 bg-slate-50 border-slate-200';
  if (['disputed', 'failed'].includes(status)) return 'text-rose-700 bg-rose-50 border-rose-100';
  return 'text-amber-700 bg-amber-50 border-amber-100';
}

function EscrowDashboardScreenInner() {
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const queryClient = useQueryClient();
  const headers = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...(token ? { 'x-session-token': token } : {}),
  };

  // OC-NATIVE-FINAL-02-R1 D1: one truthful state per server answer. A failed read carries no count.
  const transactionsQuery = useQuery<CanonicalTransaction[]>({
    queryKey: ['canonical-transactions'],
    queryFn: () => readCanonicalTransactions(token),
    retry: shouldRetrySafePayRead,
  });
  const { isFetching, refetch } = transactionsQuery;
  const view = safePayViewState({
    isPending: transactionsQuery.isPending,
    data: transactionsQuery.data,
    error: transactionsQuery.error,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'cancel' | 'dispute' }) => {
      // PC01-J-R1: a participant action is a mutating route, so it carries a session-bound CSRF token.
      const response = await csrfFetch(resolveApiBaseUrl(), token, apiUrl(`/api/escrow/${encodeURIComponent(id)}/${action}`), {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Transaction action failed');
      }
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['canonical-transactions'] }),
  });

  const renderCard = ({ item }: { item: CanonicalTransaction }) => {
    // The mobile client never decides a money/inspection/settlement state. The only participant
    // mutations exposed here are named requests the server independently authorizes.
    const canCancel = item.status === 'eligible' && item.payment_state === 'not_started';
    const canDispute = ['funds_held', 'inspection_pending', 'release_approved', 'funded_sandbox'].includes(item.status);

    return (
      <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm">
        <View className="flex-row justify-between items-start gap-3">
          <View className="flex-1">
            <Text className="text-slate-400 text-xxs tracking-wider font-semibold uppercase">
              Tx {item.transaction_intent_id.slice(0, 8)}
            </Text>
            <Text className="text-slate-900 text-base font-bold mt-1">VIN {item.vin}</Text>
          </View>
          <View className={`px-2.5 py-1 rounded-full border ${statusTone(item.status)}`}>
            <Text className="text-xxs font-extrabold uppercase tracking-wider">{statusLabel(item.status)}</Text>
          </View>
        </View>

        <View className="bg-slate-50 rounded-xl p-3.5 mt-4">
          <View className="flex-row justify-between mb-2">
            <Text className="text-slate-500 text-xs">Listing amount</Text>
            <Text className="text-slate-800 text-xs font-bold">
              {item.listing_amount == null ? 'Not recorded' : `${item.listing_amount.toLocaleString()} ${item.listing_currency || ''}`}
            </Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-slate-500 text-xs">Deposit eligibility</Text>
            <Text className="text-slate-800 text-xs font-bold">{item.deposit_eligibility || 'Not evaluated'}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-slate-500 text-xs">Provider payment state</Text>
            <Text className="text-slate-800 text-xs font-bold">{item.payment_state || 'Not started'}</Text>
          </View>
        </View>

        {item.gate_reasons.length > 0 && (
          <Text className="text-amber-700 text-xs mt-3">
            Transaction checks: {item.gate_reasons.join(', ')}
          </Text>
        )}

        {(canCancel || canDispute) && (
          <View className="flex-row justify-end mt-4 pt-4 border-t border-slate-100">
            {canCancel && (
              <Pressable
                onPress={() => actionMutation.mutate({ id: item.transaction_intent_id, action: 'cancel' })}
                disabled={actionMutation.isPending}
                className="border border-slate-300 px-4 py-2.5 rounded-xl min-h-[44px] justify-center"
              >
                <Text className="text-slate-700 text-xs font-bold">Cancel transaction</Text>
              </Pressable>
            )}
            {canDispute && (
              <Pressable
                onPress={() => actionMutation.mutate({ id: item.transaction_intent_id, action: 'dispute' })}
                disabled={actionMutation.isPending}
                className="border border-rose-200 bg-rose-50 px-4 py-2.5 rounded-xl min-h-[44px] justify-center"
              >
                <Text className="text-rose-700 text-xs font-bold">Raise dispute</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    );
  };

  // Counts exist only when CarUp answered. Loading and failed reads show no number at all.
  const confirmed = view.state === 'READY_EMPTY' || view.state === 'READY_WITH_TRANSACTIONS';
  const headerTotal = confirmed ? String(view.total) : '—';
  const headerProgress = confirmed ? `${view.inProgress} in progress` : view.state === 'LOADING' ? 'Loading' : 'Not available';

  return (
    <View className="flex-1 bg-slate-50">
      <View className="bg-slate-900 px-6 py-6 border-b border-slate-800">
        <Text className="text-slate-400 text-xxs uppercase tracking-widest font-semibold">SafePay transactions</Text>
        <View className="flex-row items-end justify-between mt-1">
          <Text className="text-white text-3xl font-extrabold">{headerTotal}</Text>
          <Text className="text-orange-400 text-xs font-bold">{headerProgress}</Text>
        </View>
        <Text className="text-slate-400 text-xs mt-2">
          Money, inspection and settlement states shown here come from CarUp and its payment provider, not this device.
        </Text>
      </View>

      {view.state === 'LOADING' ? (
        <View className="flex-1 justify-center items-center"><ActivityIndicator size="large" color="#f97316" accessibilityLabel="Loading SafePay transactions" /></View>
      ) : view.state === 'READ_FAILED' ? (
        (() => {
          const copy = safePayFailureCopy(view);
          return (
            <View className="flex-1 justify-center items-center px-6">
              <Text className="text-slate-800 text-lg font-bold text-center mb-2">{copy.title}</Text>
              <Text className="text-slate-500 text-sm text-center mb-6">{copy.body}</Text>
              {copy.action === 'retry' ? (
                <Pressable onPress={() => refetch()} accessibilityRole="button" className="bg-slate-900 px-8 py-3.5 min-h-[48px] rounded-xl">
                  <Text className="text-white text-sm font-semibold">Try again</Text>
                </Pressable>
              ) : copy.action === 'sign_in' ? (
                <Pressable onPress={() => router.push('/(auth)/login' as never)} accessibilityRole="button" className="bg-slate-900 px-8 py-3.5 min-h-[48px] rounded-xl">
                  <Text className="text-white text-sm font-semibold">Sign in</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })()
      ) : view.state === 'READY_EMPTY' ? (
        <View className="flex-1 justify-center items-center px-6">
          <Text className="text-slate-500 text-sm font-medium text-center">No CarUp transactions yet.</Text>
          <Text className="text-slate-400 text-xs mt-2 text-center">A transaction appears here once a purchase inquiry is accepted into SafePay.</Text>
        </View>
      ) : (
        <FlatList
          data={view.transactions}
          renderItem={renderCard}
          keyExtractor={(item) => item.transaction_intent_id}
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor="#f97316" />}
        />
      )}
    </View>
  );
}

export default function EscrowDashboardScreen() {
  return (
    <NativeFeatureBoundary route="/dashboard/listings" featureId="owner.listings">
      <EscrowDashboardScreenInner />
    </NativeFeatureBoundary>
  );
}
