import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { NativeFeatureBoundary } from '../../../components/navigation/NativeFeatureBoundary';
import {
  Button,
  EmptyState,
  Notice,
  Price,
  SectionHeader,
  StatusPill,
} from '../../../components/ui/NativePrimitives';
import { useAuthStore } from '../../../store/authStore';
import { getMarketplaceListingDetail } from '../../../utils/marketplaceApi';
import {
  evaluateBuyerDepositEligibility,
  getBuyerTransactionsForVin,
  getCanonicalOwnershipProof,
  initiateBuyerTransaction,
  OWNERSHIP_TRANSFER_DISCOVERY_DEPENDENCY,
  prepareBuyerPaymentIntent,
  reserveBuyerVehicle,
  resolveExistingVehicleConversation,
  resolveCanonicalBuyerTransaction,
  type BuyerDepositEligibility,
  type BuyerPaymentIntentResult,
} from '../../../utils/buyerJourneyApi';
import { nativeCanonicalObjectHref } from '../../../utils/nativeObjectRouting';
import { radius, spacing, typeScale, useNativeTheme } from '../../../theme/tokens';
import { depositEligibilitySummary } from '@shared/transaction/depositEligibilityCopy';

function titleCase(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  return normalized
    ? normalized.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Unavailable';
}

function formatDate(value: string | null | undefined): string | null {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : null;
}

function TransactionFact({ label, value }: { label: string; value: string }) {
  const theme = useNativeTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[4], paddingVertical: spacing[2] }}>
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{label}</Text>
      <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.secondary, flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function BuyerTransactionScreenInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const { vin } = useLocalSearchParams<{ vin?: string }>();
  const canonicalVin = String(vin || '').trim();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const [acting, setActing] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<BuyerDepositEligibility | null>(null);
  const [paymentPreparation, setPaymentPreparation] = useState<BuyerPaymentIntentResult | null>(null);
  const [selectedTransactionIntentId, setSelectedTransactionIntentId] = useState<string | null>(null);

  const queryScope = [
    user?.id || 'anonymous',
    user?.active_tenant_id || 'none',
    user?.role || 'none',
  ];

  const detailQuery = useQuery({
    queryKey: ['native-buyer-transaction-listing', canonicalVin, ...queryScope],
    queryFn: () => getMarketplaceListingDetail(canonicalVin),
    enabled: Boolean(canonicalVin),
  });

  const transactionsQuery = useQuery({
    queryKey: ['native-buyer-transactions', canonicalVin, ...queryScope],
    queryFn: () => getBuyerTransactionsForVin(canonicalVin),
    enabled: Boolean(canonicalVin && token),
  });

  const ownershipQuery = useQuery({
    queryKey: ['native-buyer-ownership-proof', canonicalVin, ...queryScope],
    queryFn: () => getCanonicalOwnershipProof(canonicalVin, String(user?.id || '')),
    enabled: Boolean(canonicalVin && token && user?.id),
  });

  const transactionResolution = useMemo(
    () => resolveCanonicalBuyerTransaction(
      canonicalVin,
      transactionsQuery.data || [],
      selectedTransactionIntentId,
    ),
    [canonicalVin, transactionsQuery.data, selectedTransactionIntentId],
  );
  const transaction = transactionResolution.state === 'resolved'
    ? transactionResolution.transaction
    : null;

  const runAction = async (label: string, action: () => Promise<void>) => {
    setActing(label);
    try {
      await action();
    } catch (error) {
      Alert.alert(
        'CarUp could not complete this action',
        error instanceof Error ? error.message : 'CarUp did not accept this request.',
      );
    } finally {
      setActing(null);
    }
  };

  const reserve = () => runAction('reserve', async () => {
    const result = await reserveBuyerVehicle(canonicalVin);
    if (result.vin !== canonicalVin) throw new Error('Reservation authority returned a different VIN.');
    if (!result.transactionIntentId) throw new Error('CarUp did not return a purchase reference for this request.');
    setSelectedTransactionIntentId(result.transactionIntentId);
    setEligibility(null);
    setPaymentPreparation(null);
    await Promise.all([transactionsQuery.refetch(), detailQuery.refetch()]);
  });

  const initiate = () => {
    if (!transaction) return;
    return runAction('initiate', async () => {
      const updated = await initiateBuyerTransaction(transaction.transaction_intent_id);
      if (updated.vin !== canonicalVin) throw new Error('Transaction authority returned a different VIN.');
      setEligibility(null);
      await transactionsQuery.refetch();
    });
  };

  const checkDeposit = () => {
    if (!transaction) return;
    return runAction('eligibility', async () => {
      const result = await evaluateBuyerDepositEligibility(transaction.transaction_intent_id);
      if (result.transactionIntentId !== transaction.transaction_intent_id) {
        throw new Error('Deposit authority returned a different transaction intent.');
      }
      setEligibility(result);
      await transactionsQuery.refetch();
    });
  };

  const preparePayment = () => {
    if (!transaction) return;
    Alert.alert(
      'Prepare SafePay deposit?',
      'This asks the payment provider to prepare a SafePay deposit. CarUp will not show funds as held or settled until the provider confirms it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Prepare',
          onPress: () => void runAction('payment-intent', async () => {
            const result = await prepareBuyerPaymentIntent(transaction.transaction_intent_id);
            if (result.transactionIntentId !== transaction.transaction_intent_id) {
              throw new Error('Payment authority returned a different transaction intent.');
            }
            setPaymentPreparation(result);
            await transactionsQuery.refetch();
          }),
        },
      ],
    );
  };

  const openConversation = () => runAction('conversation', async () => {
    const resolution = await resolveExistingVehicleConversation(canonicalVin);
    if (resolution.state === 'resolved' && resolution.thread?.id) {
      router.push(nativeCanonicalObjectHref({
        type: 'conversation',
        id: String(resolution.thread.id),
      }) as never);
      return;
    }
    if (resolution.state === 'ambiguous') {
      throw new Error('More than one Marketplace inquiry conversation exists for this VIN, and the transaction projection does not expose inquiry_id. No thread was guessed.');
    }
    throw new Error('There is no CarUp conversation with the seller for this vehicle yet.');
  });

  if (!canonicalVin) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState title="Purchase journey unavailable" body="This screen needs the vehicle’s VIN." />
      </View>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading purchase journey" />
      </View>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          title="Purchase journey unavailable"
          body="CarUp could not load the Marketplace listing for this vehicle."
          actionLabel="Try again"
          onAction={() => void detailQuery.refetch()}
          secondaryLabel="Back to vehicle"
          onSecondary={() => router.back()}
        />
      </View>
    );
  }

  const listing = detailQuery.data;
  if (listing.vin !== canonicalVin) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center', padding: spacing[5] }}>
        <Notice
          title="Vehicle identity mismatch"
          body="The Marketplace listing does not match the requested VIN. The purchase journey is stopped rather than joining two vehicle records."
          tone="danger"
        />
      </View>
    );
  }

  const readiness = listing.transaction_intent?.payment_readiness_status || 'not_ready';
  const reservationState = listing.reservation_summary?.state || transaction?.reservation_state || 'unavailable';
  const transactionStatus = transaction?.status || null;
  const paymentState = transaction?.payment_state || paymentPreparation?.paymentState || null;
  const ownership = ownershipQuery.data;
  const ownershipOwned = ownership?.state === 'owned';
  const transactionUpdated = formatDate(transaction?.updated_at);
  const canInitiate = transactionStatus === 'eligible';
  const canCheckDeposit = Boolean(transaction && ['eligible', 'initiated'].includes(String(transactionStatus)));
  const depositEligible =
    eligibility?.eligibility === 'eligible'
    || transaction?.deposit_eligibility === 'eligible';

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <ScrollView contentContainerStyle={{ padding: spacing[5], paddingBottom: spacing[10], gap: spacing[5] }}>
        <Button label="Back to vehicle" variant="tertiary" onPress={() => router.back()} />

        <View>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>Buyer journey · VIN {canonicalVin}</Text>
          <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[1] }}>
            {[listing.year, listing.make, listing.model].filter(Boolean).join(' ') || canonicalVin}
          </Text>
          <View style={{ marginTop: spacing[2] }}>
            <Price amount={listing.price} currency={listing.currency} />
          </View>
        </View>

        {!token ? (
          <Notice
            title="Sign in to continue"
            body="Reservation, SafePay and transaction records are participant-authorized. Browsing the Vehicle and public Passport does not grant transaction access."
            tone="warning"
          />
        ) : null}

        <View>
          <SectionHeader title="Transaction readiness" />
          <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}>
            <TransactionFact label="VIN" value={canonicalVin} />
            <TransactionFact label="Public readiness" value={titleCase(readiness)} />
            <TransactionFact label="Reservation" value={titleCase(reservationState)} />
            <TransactionFact label="Transaction" value={titleCase(transactionStatus)} />
            <TransactionFact label="SafePay / provider state" value={titleCase(paymentState)} />
            {transactionUpdated ? <TransactionFact label="Updated" value={transactionUpdated} /> : null}
          </View>
        </View>

        {transaction ? (
          <Notice
            title="Your purchase in CarUp"
            body={`Purchase reference ${transaction.transaction_intent_id} for VIN ${transaction.vin}. This app shows CarUp's record of the purchase and never keeps a separate one.`}
            tone="info"
          />
        ) : transactionResolution.state === 'ambiguous' ? (
          <Notice
            title="CarUp needs to know which purchase this is"
            body={`CarUp has ${transactionResolution.count} purchase records for this vehicle, and the app will not guess which one is yours. Start again from the reservation so CarUp can name the exact purchase.`}
            tone="warning"
          />
        ) : token && !transactionsQuery.isLoading ? (
          <Notice
            title="No participant transaction yet"
            body="A current clear purchase inquiry with this seller is required before CarUp can reserve the vehicle. If you have not contacted the seller, return to the Vehicle and use Message seller first."
            tone="info"
          />
        ) : null}

        {token ? (
          <View style={{ gap: spacing[3] }}>
            {!transaction ? (
              <Button
                label="Reserve vehicle"
                onPress={() => void reserve()}
                loading={acting === 'reserve'}
                disabled={transactionsQuery.isLoading}
              />
            ) : null}

            {canInitiate ? (
              <Button
                label="Initiate transaction"
                onPress={() => void initiate()}
                loading={acting === 'initiate'}
              />
            ) : null}

            {canCheckDeposit ? (
              <Button
                label="Check SafePay deposit eligibility"
                variant="secondary"
                onPress={() => void checkDeposit()}
                loading={acting === 'eligibility'}
              />
            ) : null}

            {eligibility ? (
              <Notice
                title={eligibility.eligibility === 'eligible' ? 'Deposit eligible' : 'Deposit not eligible'}
                body={eligibility.eligibility === 'eligible'
                  ? `CarUp allows a deposit of ${eligibility.currency || ''} ${eligibility.amount ?? ''}. No money is held yet — this is only an eligibility check.`.trim()
                  : depositEligibilitySummary(eligibility.reasons)}
                tone={eligibility.eligibility === 'eligible' ? 'success' : 'warning'}
              />
            ) : null}

            {depositEligible ? (
              <Button
                label="Prepare SafePay deposit"
                onPress={preparePayment}
                loading={acting === 'payment-intent'}
              />
            ) : null}

            {paymentPreparation ? (
              <Notice
                title="Payment intent prepared"
                body={`Provider state: ${titleCase(paymentPreparation.paymentState)}. This is not a claim that funds are held, inspection is approved, settlement is complete or ownership has transferred.`}
                tone="info"
              />
            ) : null}

            <Button
              label="Open existing CarUp conversation"
              variant="secondary"
              onPress={() => void openConversation()}
              loading={acting === 'conversation'}
            />
          </View>
        ) : (
          <Button label="Sign in" onPress={() => router.push('/(auth)/login' as never)} />
        )}

        <View>
          <SectionHeader title="SafePay authority" />
          <Notice
            title="Only what the payment provider confirms"
            body="This app can ask for the steps you authorise, but it never decides funds held, inspection approval, release approval, settlement or refund. CarUp and the payment provider decide those."
            tone="info"
          />
        </View>

        <View>
          <SectionHeader title="Ownership" />
          {ownershipQuery.isLoading ? (
            <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Checking ownership" />
          ) : ownershipOwned ? (
            <View style={{ gap: spacing[3] }}>
              <Notice
                title="Ownership recorded"
                body={`CarUp records this account as the owner of VIN ${canonicalVin}. The app keeps no ownership record of its own.`}
                tone="success"
              />
              <Button label="Open My Garage" onPress={() => router.push('/(tabs)/garage' as never)} />
            </View>
          ) : ownership?.state === 'not_owned' ? (
            <Notice
              title="Ownership not complete"
              body="CarUp does not treat reservation, payment preparation or transaction settlement as legal ownership. This vehicle becomes an owned Garage vehicle only after CarUp records this account as its owner."
              tone="warning"
            />
          ) : (
            <Notice
              title="Ownership proof unavailable"
              body={ownership?.state === 'unavailable'
                ? ownership.reason
                : 'Sign in with the account that owns this vehicle to see its ownership.'}
              tone="warning"
            />
          )}
        </View>

        {!ownershipOwned ? (
          <Notice
            title="Ownership-transfer dependency"
            body={OWNERSHIP_TRANSFER_DISCOVERY_DEPENDENCY}
            tone="warning"
          />
        ) : null}

        <View>
          <SectionHeader title="Vehicle continuity" />
          <StatusPill label={`VIN ${canonicalVin}`} tone="success" />
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[2] }}>
            Marketplace, Passport, reservation, transaction and post-completion Garage checks all use this same VIN.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

export default function BuyerTransactionScreen() {
  return (
    <NativeFeatureBoundary route="/vehicle/[vin]/transaction" featureId="product.marketplace" hasNativeScreen>
      <BuyerTransactionScreenInner />
    </NativeFeatureBoundary>
  );
}
