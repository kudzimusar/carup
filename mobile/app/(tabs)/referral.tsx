import { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Share, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import {
  getReferralWallet,
  validateReferralCode,
  createReferralChannelShareKit,
  explainReferralBenefit,
  createReferralDispute,
  type ReferralWalletTransactionLite,
} from '../../utils/referralApi';

/**
 * Owner "Refer & Earn" mobile surface (Phase B). Owner-scoped:
 * wallet benefit status (pending vs approved), code validation, native share kit,
 * benefit explanation, and dispute filing. Uses utils/referralApi only (existing
 * endpoints). No admin features, no backend changes.
 */

const STATUS_COLORS: Record<string, string> = {
  paid_or_applied: 'bg-green-500/10 text-green-600',
  approved: 'bg-green-500/10 text-green-600',
  payable: 'bg-emerald-500/10 text-emerald-600',
  eligible: 'bg-blue-500/10 text-blue-600',
  pending: 'bg-amber-500/10 text-amber-600',
  created: 'bg-slate-500/10 text-slate-600',
  held: 'bg-orange-500/10 text-orange-600',
  rejected: 'bg-red-500/10 text-red-600',
};

function statusColor(status?: string): string {
  return STATUS_COLORS[status || ''] || 'bg-slate-500/10 text-slate-600';
}

function money(amount?: number, currency?: string | null): string {
  if (typeof amount !== 'number') return '—';
  return `${currency ? `${currency} ` : '$'}${amount.toLocaleString()}`;
}

function ReferralScreenInner() {
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | undefined>(undefined);
  const [approved, setApproved] = useState<number | undefined>(undefined);
  const [settled, setSettled] = useState<number | undefined>(undefined);
  const [transactions, setTransactions] = useState<ReferralWalletTransactionLite[]>([]);

  const [code, setCode] = useState('');
  const [validateMsg, setValidateMsg] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const [explainFor, setExplainFor] = useState<string | null>(null);
  const [explainText, setExplainText] = useState<string | null>(null);

  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeMsg, setDisputeMsg] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setError('Sign in to see your referral benefits.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getReferralWallet(user.id);
      const w = res.wallet;
      setPending(w?.pending_balance);
      setApproved((w?.approved_balance ?? 0) + (w?.payable_balance ?? 0));
      setSettled(w?.paid_or_applied_balance);
      setTransactions(res.transactions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your referral wallet.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  const onValidate = useCallback(async () => {
    if (!code.trim()) {
      setValidateMsg('Enter a referral code first.');
      return;
    }
    try {
      const res = await validateReferralCode({ code: code.trim(), channel: 'mobile' });
      setValidateMsg(res.valid ? 'This referral code is valid.' : res.reason ? String(res.reason) : 'This code is not valid.');
    } catch (err) {
      setValidateMsg(err instanceof Error ? err.message : 'Validation failed.');
    }
  }, [code]);

  const onShare = useCallback(async () => {
    if (!code.trim()) {
      setShareMsg('Enter your referral code to share.');
      return;
    }
    setShareMsg(null);
    try {
      const res = await createReferralChannelShareKit('mobile', { code: code.trim(), user_id: user?.id });
      const copy = res.copy as { link?: unknown } | undefined;
      const link =
        typeof copy?.link === 'string'
          ? copy.link
          : typeof res.share_url === 'string'
          ? res.share_url
          : typeof res.deep_link === 'string'
          ? res.deep_link
          : null;
      if (link) {
        await Share.share({ message: `Join me on CarUp: ${link}` });
      } else {
        setShareMsg('Share kit generated.');
      }
    } catch (err) {
      setShareMsg(err instanceof Error ? err.message : 'Could not generate a share kit.');
    }
  }, [code, user?.id]);

  const onExplain = useCallback(async (txId: string) => {
    setExplainFor(txId);
    setExplainText('Loading…');
    try {
      const res = await explainReferralBenefit(txId);
      setExplainText(
        typeof res.explanation === 'string' ? res.explanation : 'This benefit is still being processed.'
      );
    } catch (err) {
      setExplainText(err instanceof Error ? err.message : 'Could not load the explanation.');
    }
  }, []);

  const onDispute = useCallback(async () => {
    if (!disputeFor || !disputeReason.trim()) {
      setDisputeMsg('Describe the issue first.');
      return;
    }
    try {
      await createReferralDispute({ wallet_transaction_id: disputeFor, reason: disputeReason.trim() });
      setDisputeMsg('Dispute filed. A reviewer will look into it.');
      setDisputeReason('');
      setDisputeFor(null);
    } catch (err) {
      setDisputeMsg(err instanceof Error ? err.message : 'Could not file the dispute.');
    }
  }, [disputeFor, disputeReason]);

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 24 }}>
      <Text className="text-slate-900 text-2xl font-bold mb-1">Refer &amp; Earn</Text>
      <Text className="text-slate-400 text-xs mb-5">Your referral benefits, sharing, and disputes</Text>

      {/* Wallet */}
      <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm">
        <Text className="text-slate-900 font-semibold mb-3">Benefit Wallet</Text>
        {loading ? (
          <ActivityIndicator color="#f97316" />
        ) : error ? (
          <Text className="text-red-600 text-sm">{error}</Text>
        ) : (
          <>
            <View className="flex-row justify-between mb-4">
              <View className="flex-1">
                <Text className="text-slate-400 text-[10px] uppercase">Approved</Text>
                <Text className="text-green-600 text-lg font-bold">{money(approved)}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-slate-400 text-[10px] uppercase">Pending</Text>
                <Text className="text-amber-600 text-lg font-bold">{money(pending)}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-slate-400 text-[10px] uppercase">Settled</Text>
                <Text className="text-slate-900 text-lg font-bold">{money(settled)}</Text>
              </View>
            </View>

            {transactions.length === 0 ? (
              <Text className="text-slate-400 text-sm">
                No referral benefits yet. Share your code to start earning — benefits stay pending until approved.
              </Text>
            ) : (
              transactions.map((tx) => (
                <View key={tx.id} className="border border-slate-100 rounded-xl p-3 mb-2">
                  <View className="flex-row justify-between items-center">
                    <View className="flex-1 mr-2">
                      <Text className="text-slate-900 text-sm font-medium" numberOfLines={1}>
                        {tx.reason || 'Referral benefit'}
                      </Text>
                      <Text className="text-slate-400 text-[10px]">
                        {tx.created_at ? new Date(tx.created_at).toLocaleDateString() : ''}
                      </Text>
                    </View>
                    <Text className="text-slate-900 text-sm font-semibold mr-2">{money(tx.amount, tx.currency)}</Text>
                    <View className={`px-2 py-0.5 rounded-full ${statusColor(tx.status)}`}>
                      <Text className="text-[10px] font-bold">{tx.status || 'unknown'}</Text>
                    </View>
                  </View>
                  <View className="flex-row mt-2 gap-3">
                    <Pressable onPress={() => onExplain(tx.id)}>
                      <Text className="text-orange-500 text-xs font-medium">Why?</Text>
                    </Pressable>
                    <Pressable onPress={() => { setDisputeFor(tx.id); setDisputeMsg(null); }}>
                      <Text className="text-slate-500 text-xs font-medium">Dispute</Text>
                    </Pressable>
                  </View>
                  {explainFor === tx.id && (
                    <Text className="text-slate-600 text-xs bg-slate-50 rounded p-2 mt-2">{explainText}</Text>
                  )}
                </View>
              ))
            )}
          </>
        )}
      </View>

      {/* Validate + Share */}
      <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm">
        <Text className="text-slate-900 font-semibold mb-3">Validate &amp; Share a Code</Text>
        <TextInput
          placeholder="Enter a referral code"
          placeholderTextColor="#94a3b8"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 mb-3"
        />
        <View className="flex-row gap-2">
          <Pressable onPress={onValidate} className="flex-1 bg-slate-900 rounded-xl py-2.5 items-center">
            <Text className="text-white text-sm font-semibold">Validate</Text>
          </Pressable>
          <Pressable onPress={onShare} className="flex-1 bg-orange-500 rounded-xl py-2.5 items-center">
            <Text className="text-white text-sm font-semibold">Share</Text>
          </Pressable>
        </View>
        {validateMsg && <Text className="text-slate-600 text-xs mt-2">{validateMsg}</Text>}
        {shareMsg && <Text className="text-slate-600 text-xs mt-2">{shareMsg}</Text>}
      </View>

      {/* Dispute composer (appears when a transaction is selected) */}
      {disputeFor && (
        <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm">
          <Text className="text-slate-900 font-semibold mb-2">Dispute this benefit</Text>
          <TextInput
            placeholder="Describe the issue"
            placeholderTextColor="#94a3b8"
            value={disputeReason}
            onChangeText={setDisputeReason}
            multiline
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 mb-3 min-h-[72px]"
          />
          <View className="flex-row gap-2">
            <Pressable onPress={onDispute} className="flex-1 bg-orange-500 rounded-xl py-2.5 items-center">
              <Text className="text-white text-sm font-semibold">File Dispute</Text>
            </Pressable>
            <Pressable onPress={() => { setDisputeFor(null); setDisputeReason(''); }} className="flex-1 bg-slate-100 rounded-xl py-2.5 items-center">
              <Text className="text-slate-700 text-sm font-semibold">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
      {disputeMsg && <Text className="text-slate-600 text-xs mb-4">{disputeMsg}</Text>}
    </ScrollView>
  );
}

/**
 * Owner-protected route boundary (Milestone C). Refer & Earn is governed by
 * owner.referrals (owner-only, requiresAuth). A deep link / direct nav is gated
 * by the SAME governed decision that hides the tab for non-owners.
 */
export default function ReferralScreen() {
  return (
    <NativeFeatureBoundary route="/dashboard/referrals" featureId="owner.referrals">
      <ReferralScreenInner />
    </NativeFeatureBoundary>
  );
}
