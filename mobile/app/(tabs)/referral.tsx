import { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Share, ActivityIndicator, Image } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAuthStore } from '../../store/authStore';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import {
  getReferralSummary,
  validateReferralCode,
  createReferralChannelShareKit,
  explainReferralBenefit,
  createReferralDispute,
  type ReferralWalletTransactionLite,
} from '../../services/referralApi';

/**
 * Owner "Refer & Earn" mobile surface.
 * Minimal native Universal Referral Widget.
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
  
  // Wallet
  const [pending, setPending] = useState<number | undefined>(undefined);
  const [approved, setApproved] = useState<number | undefined>(undefined);
  const [settled, setSettled] = useState<number | undefined>(undefined);
  
  // Summary specific
  const [permanentCode, setPermanentCode] = useState<string | null>(null);
  const [referredUserCount, setReferredUserCount] = useState<number>(0);
  const [conversionCount, setConversionCount] = useState<number>(0);
  const [campaigns, setCampaigns] = useState<any[]>([]);

  const [codeToValidate, setCodeToValidate] = useState('');
  const [validateMsg, setValidateMsg] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const [explainFor, setExplainFor] = useState<string | null>(null);
  const [explainText, setExplainText] = useState<string | null>(null);

  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeMsg, setDisputeMsg] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setError('Sign in to see your referral benefits.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getReferralSummary();
      const s = res.summary;
      const w = s?.wallet_totals;
      
      setPending(w?.pending_balance);
      setApproved((w?.approved_balance ?? 0) + (w?.payable_balance ?? 0));
      setSettled(w?.paid_or_applied_balance);
      
      setPermanentCode(s?.permanent_code?.code || null);
      setReferredUserCount(s?.referred_user_count || 0);
      setConversionCount(s?.conversion_count || 0);
      setCampaigns(s?.active_campaigns || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your referral summary.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const onValidate = useCallback(async () => {
    if (!codeToValidate.trim()) {
      setValidateMsg('Enter a referral code first.');
      return;
    }
    try {
      const res = await validateReferralCode({ code: codeToValidate.trim(), channel: 'mobile' });
      setValidateMsg(res.valid ? 'This referral code is valid.' : res.reason ? String(res.reason) : 'This code is not valid.');
    } catch (err) {
      setValidateMsg(err instanceof Error ? err.message : 'Validation failed.');
    }
  }, [codeToValidate]);

  const onShare = useCallback(async (codeToShare: string | null) => {
    if (!codeToShare) {
      setShareMsg('No code to share.');
      return;
    }
    setShareMsg(null);
    try {
      const res = await createReferralChannelShareKit('mobile', { code: codeToShare, user_id: user?.id });
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
  }, [user?.id]);

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

  const publicLink = permanentCode ? `https://carup.com/r/${permanentCode}` : '';

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 24 }}>
      <Text className="text-slate-900 text-2xl font-bold mb-1">Refer &amp; Earn</Text>
      <Text className="text-slate-400 text-xs mb-5">Share your code, track benefits and conversions</Text>

      {loading ? (
        <ActivityIndicator color="#f97316" />
      ) : error ? (
        <Text className="text-red-600 text-sm">{error}</Text>
      ) : (
        <>
          {/* Universal Referral Widget */}
          <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm items-center">
            <Text className="text-slate-900 font-semibold mb-3">Your Referral Code</Text>
            
            {permanentCode ? (
              <>
                <View className="bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 mb-4">
                  <Text className="text-2xl font-black text-slate-900 tracking-widest">{permanentCode}</Text>
                </View>
                
                <View style={{ marginBottom: 16 }} accessibilityLabel={`QR Code for referral link ${publicLink}`}>
                  <QRCode
                    value={publicLink}
                    size={150}
                    color="black"
                    backgroundColor="white"
                  />
                </View>

                <Pressable onPress={() => onShare(permanentCode)} className="bg-orange-500 rounded-xl py-3 px-8 w-full items-center">
                  <Text className="text-white text-sm font-bold">Share Code</Text>
                </Pressable>
                {shareMsg && <Text className="text-slate-600 text-xs mt-2 text-center">{shareMsg}</Text>}
              </>
            ) : (
              <Text className="text-slate-500 text-sm italic">You don't have a referral code yet.</Text>
            )}
          </View>

          {/* Stats Summary */}
          <View className="flex-row gap-4 mb-4">
            <View className="flex-1 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm items-center">
              <Text className="text-slate-400 text-[10px] uppercase font-semibold mb-1">Friends Joined</Text>
              <Text className="text-slate-900 text-xl font-bold">{referredUserCount}</Text>
            </View>
            <View className="flex-1 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm items-center">
              <Text className="text-slate-400 text-[10px] uppercase font-semibold mb-1">Conversions</Text>
              <Text className="text-orange-500 text-xl font-bold">{conversionCount}</Text>
            </View>
          </View>

          {/* Wallet */}
          <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm">
            <Text className="text-slate-900 font-semibold mb-3">Benefit Wallet</Text>
            <View className="flex-row justify-between mb-2">
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
          </View>

          {/* Active Campaigns */}
          {campaigns && campaigns.length > 0 && (
            <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm">
              <Text className="text-slate-900 font-semibold mb-3">Active Campaigns</Text>
              {campaigns.map((camp, idx) => (
                <View key={idx} className="bg-slate-50 rounded-xl p-3 mb-2 border border-slate-100">
                  <Text className="text-slate-900 font-semibold text-sm">{camp.name || 'Referral Campaign'}</Text>
                  <Text className="text-slate-500 text-xs mt-1">{camp.description || 'Invite friends and earn rewards'}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Validate external code */}
      <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm mt-4">
        <Text className="text-slate-900 font-semibold mb-3">Check a Code</Text>
        <TextInput
          placeholder="Enter a code to validate"
          placeholderTextColor="#94a3b8"
          value={codeToValidate}
          onChangeText={setCodeToValidate}
          autoCapitalize="characters"
          className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 mb-3"
        />
        <Pressable onPress={onValidate} className="bg-slate-900 rounded-xl py-2.5 items-center">
          <Text className="text-white text-sm font-semibold">Validate</Text>
        </Pressable>
        {validateMsg && <Text className="text-slate-600 text-xs mt-2">{validateMsg}</Text>}
      </View>

      {/* Dispute composer */}
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
 * Owner-protected route boundary.
 */
export default function ReferralScreen() {
  return (
    <NativeFeatureBoundary route="/dashboard/referrals" featureId="owner.referrals">
      <ReferralScreenInner />
    </NativeFeatureBoundary>
  );
}
