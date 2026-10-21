import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeFeatureBoundary } from '../../../components/navigation/NativeFeatureBoundary';
import { Button, Field, Notice, Price, StickyActionBar } from '../../../components/ui/NativePrimitives';
import { useAuthStore } from '../../../store/authStore';
import {
  createMarketplaceInquiry,
  getMarketplaceListingDetail,
  MarketplaceApiError,
  type MobileListingDetail,
} from '../../../utils/marketplaceApi';
import {
  listCommunicationThreads,
  resolveMarketplaceInquiryConversation,
} from '../../../utils/communicationApi';
import { nativeCanonicalObjectHref } from '../../../utils/nativeObjectRouting';
import { withTimeout } from '../../../utils/nativePerformance';
import {
  canSendInquiry,
  createInquirySender,
  INQUIRY_MESSAGE_MAX_LENGTH,
  INQUIRY_MESSAGE_PLACEHOLDER,
  INQUIRY_THREAD_LOOKUP_TIMEOUT_MS,
  inquiryListingId,
  type InquirySender,
  type InquirySendFailure,
} from '../../../utils/inquiryComposer';
import {
  leaveComposer,
  signInHref,
  vehicleInquiryHref,
  vehicleRouteContextFromParams,
  type VehicleRouteContext,
} from '../../../utils/vehicleNavigation';
import { radius, spacing, typeScale, useNativeTheme } from '../../../theme/tokens';

/**
 * CARUP-MVP-STAB-01 F-001 — the buyer writes the message and decides when to send it.
 *
 * Opening this screen writes nothing. Send is the only write, made once per tap through one sender
 * held for the whole screen (so a retry repeats the same request id), and Cancel or Back return to
 * the vehicle. The session lives in the route component, above the access boundary, so signing in
 * from here and coming back keeps what the buyer typed.
 */

type ComposerPhase = 'compose' | 'sending' | 'opening' | 'sent' | 'already_received';

interface ComposerSession {
  text: string;
  setText: (value: string) => void;
  phase: ComposerPhase;
  setPhase: (phase: ComposerPhase) => void;
  failure: InquirySendFailure | null;
  setFailure: (failure: InquirySendFailure | null) => void;
  sender: InquirySender;
}

function useComposerSession(): ComposerSession {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<ComposerPhase>('compose');
  const [failure, setFailure] = useState<InquirySendFailure | null>(null);
  const senderRef = useRef<InquirySender | null>(null);
  if (!senderRef.current) {
    senderRef.current = createInquirySender({
      create: (payload) => createMarketplaceInquiry(payload),
      resolveConversation: (inquiryId, listingId) => resolveMarketplaceInquiryConversation(inquiryId, listingId, {
        listThreads: () => withTimeout(listCommunicationThreads(), INQUIRY_THREAD_LOOKUP_TIMEOUT_MS),
      }),
    });
  }
  return { text, setText, phase, setPhase, failure, setFailure, sender: senderRef.current };
}

function vehicleTitle(vehicle: Pick<MobileListingDetail, 'year' | 'make' | 'model'> | undefined): string {
  if (!vehicle) return '';
  return [vehicle.year, vehicle.make, vehicle.model]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' ');
}

function ListingRow({ label, value }: { label: string; value: string }) {
  const theme = useNativeTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[4], paddingVertical: spacing[1] }}>
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{label}</Text>
      <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.secondary, flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function VehicleSummary({
  routeVin,
  listing,
  loading,
  notListed,
  failed,
  onRetry,
}: {
  routeVin: string;
  listing: MobileListingDetail | undefined;
  loading: boolean;
  notListed: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const theme = useNativeTheme();
  const title = vehicleTitle(listing);
  const location = listing
    ? listing.location?.trim() || (listing.location_state === 'withheld' ? 'Location withheld' : 'Location not recorded')
    : null;

  return (
    <View
      style={{
        marginTop: spacing[4],
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surface,
        padding: spacing[4],
        gap: spacing[2],
      }}
    >
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>VIN {listing?.vin || routeVin}</Text>
      {title ? (
        <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>{title}</Text>
      ) : null}
      {typeof listing?.price === 'number' && Number.isFinite(listing.price) ? (
        <Price amount={listing.price} currency={listing.currency} compact />
      ) : null}
      {listing ? (
        <View style={{ marginTop: spacing[1] }}>
          <ListingRow label="Seller" value={listing.seller_display_label || 'Seller not disclosed'} />
          {location ? <ListingRow label="Location" value={location} /> : null}
        </View>
      ) : null}
      {loading ? (
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading vehicle details" />
      ) : null}
      {notListed ? (
        <Notice
          title="Not on the Marketplace"
          body="This vehicle is not listed on the CarUp Marketplace right now, so it cannot receive messages."
          tone="warning"
        />
      ) : null}
      {failed && !notListed ? (
        <View style={{ gap: spacing[2] }}>
          <Notice
            title="Vehicle details did not load"
            body="CarUp could not load this vehicle's details. Check your connection. You can still write your message."
            tone="info"
          />
          <Button label="Load details again" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[1] }}>
        <Ionicons name="chatbubbles-outline" size={18} color={theme.text.secondary} />
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary, flex: 1 }}>
          Your message goes to the seller through CarUp.
        </Text>
      </View>
    </View>
  );
}

function SentState({
  phase,
  onOpenInbox,
  onBackToVehicle,
}: {
  phase: 'opening' | 'sent' | 'already_received';
  onOpenInbox: () => void;
  onBackToVehicle: () => void;
}) {
  const theme = useNativeTheme();
  const body =
    phase === 'already_received'
      ? 'An earlier version of this message already reached CarUp. The conversation will appear in your Inbox.'
      : phase === 'opening'
        ? 'Message sent. Opening your conversation…'
        : 'Message sent. CarUp is preparing the conversation — it will appear in your Inbox.';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        marginTop: spacing[5],
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surface,
        padding: spacing[5],
        gap: spacing[4],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] }}>
        <Ionicons name="checkmark-circle" size={26} color={theme.state.success} />
        <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary, flex: 1 }}>{body}</Text>
      </View>
      {phase === 'opening' ? (
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Opening your conversation" />
      ) : (
        <View style={{ gap: spacing[3] }}>
          <Button label="Open Inbox" onPress={onOpenInbox} />
          <Button label="Back to vehicle" variant="secondary" onPress={onBackToVehicle} />
        </View>
      )}
    </View>
  );
}

function InquiryComposer({
  vin,
  context,
  session,
  onLeave,
}: {
  vin: string | undefined;
  context: VehicleRouteContext;
  session: ComposerSession;
  onLeave: () => void;
}) {
  const theme = useNativeTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authLoading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const signedIn = !authLoading && isAuthenticated && Boolean(token);

  const detailQuery = useQuery<MobileListingDetail>({
    queryKey: ['marketplace-detail', vin],
    queryFn: () => getMarketplaceListingDetail(String(vin)),
    enabled: Boolean(vin),
    retry: (count, error) => !(error instanceof MarketplaceApiError && error.statusCode === 404) && count < 2,
  });
  const notListed = detailQuery.error instanceof MarketplaceApiError && detailQuery.error.statusCode === 404;
  const routeVin = String(vin || '');
  const listingId = inquiryListingId(detailQuery.data?.vin, routeVin);
  const composerHref = vehicleInquiryHref(routeVin, context);

  const { text, setText, phase, setPhase, failure, setFailure, sender } = session;
  const sending = phase === 'sending';
  const done = phase === 'opening' || phase === 'sent' || phase === 'already_received';
  const sendEnabled = canSendInquiry({
    text,
    signedIn,
    sending,
    sent: done || sender.sent,
    listingAvailable: !notListed,
  });
  const needsSignIn = !authLoading && (!signedIn || Boolean(failure?.needsSignIn));

  const signIn = () => router.push(signInHref({ returnTo: composerHref }) as never);
  const openInbox = () => router.dismissTo('/(tabs)/inbox' as never);

  const sendMessage = async () => {
    if (!sendEnabled) return;
    setFailure(null);
    setPhase('sending');
    const outcome = await sender.send({
      listingId,
      message: text,
      referralCode: context.ref,
      campaignCode: context.campaign,
      actorId: userId,
      onCreated: () => setPhase('opening'),
    });
    if (outcome.kind === 'ignored') {
      if (outcome.reason === 'empty') setPhase('compose');
      return;
    }
    if (outcome.kind === 'failed') {
      setFailure(outcome.failure);
      setPhase('compose');
      return;
    }
    if (outcome.kind === 'already_received') {
      setPhase('already_received');
      return;
    }
    if (outcome.conversation.state === 'resolved') {
      setPhase('opening');
      router.replace(nativeCanonicalObjectHref({
        type: 'conversation',
        id: outcome.conversation.threadId,
      }) as never);
      return;
    }
    setPhase('sent');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: spacing[5],
          paddingTop: Math.max(insets.top + spacing[2], spacing[5]),
          paddingBottom: spacing[8],
        }}
      >
        <View style={{ alignSelf: 'flex-start' }}>
          <Button label="Back" variant="tertiary" onPress={onLeave} disabled={sending} />
        </View>
        <Text allowFontScaling accessibilityRole="header" style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[2] }}>
          Message the seller
        </Text>

        <VehicleSummary
          routeVin={routeVin}
          listing={detailQuery.data}
          loading={detailQuery.isLoading}
          notListed={notListed}
          failed={detailQuery.isError}
          onRetry={() => void detailQuery.refetch()}
        />

        {done ? (
          <SentState
            phase={phase === 'already_received' ? 'already_received' : phase === 'opening' ? 'opening' : 'sent'}
            onOpenInbox={openInbox}
            onBackToVehicle={onLeave}
          />
        ) : (
          <View style={{ marginTop: spacing[5], gap: spacing[4] }}>
            {failure ? (
              <Notice
                title={failure.kind === 'connection' ? 'Not confirmed yet' : 'Message not sent'}
                body={failure.message}
                tone="danger"
              />
            ) : null}
            {!authLoading && !signedIn ? (
              <Notice
                title="Sign in to send"
                body="You can write your message now. Sign in to send it — nothing is sent until you press Send."
                tone="info"
              />
            ) : null}
            <Field
              label="Your message"
              value={text}
              onChangeText={setText}
              multiline
              editable={!sending}
              placeholder={INQUIRY_MESSAGE_PLACEHOLDER}
              maxLength={INQUIRY_MESSAGE_MAX_LENGTH}
              helper="Nothing is sent until you press Send."
              style={{ minHeight: 140, textAlignVertical: 'top' }}
            />
          </View>
        )}
      </ScrollView>

      {done ? null : (
        <StickyActionBar>
          <View style={{ gap: spacing[2] }}>
            {needsSignIn ? (
              <Button label="Sign in to send" onPress={signIn} />
            ) : (
              <Button
                label="Send"
                onPress={() => void sendMessage()}
                accessibilityLabel={sending ? 'Sending your message' : 'Send message to the seller'}
                loading={sending}
                disabled={!sendEnabled}
              />
            )}
            <Button label="Cancel" variant="tertiary" onPress={onLeave} disabled={sending} />
          </View>
        </StickyActionBar>
      )}
    </KeyboardAvoidingView>
  );
}

export default function VehicleInquiryScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    vin?: string;
    from?: string;
    threadId?: string;
    marketReturn?: string;
    ref?: string;
    referral?: string;
    campaign?: string;
  }>();
  const { vin } = params;
  const context = vehicleRouteContextFromParams(params);
  // Held above the boundary: an identity change while signing in re-mounts the boundary's
  // children, and the draft and its request id must survive that.
  const session = useComposerSession();

  const leave = () => {
    const state = navigation.getState();
    const previousRouteName = typeof state?.index === 'number' ? state.routes[state.index - 1]?.name : undefined;
    leaveComposer(router, { vin: String(vin || ''), previousRouteName, context });
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const phaseRef = useRef(session.phase);
  phaseRef.current = session.phase;

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        // A send in flight finishes first (it is bounded); Back then leaves without writing.
        if (phaseRef.current !== 'sending') leaveRef.current();
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  return (
    <NativeFeatureBoundary route="/vehicle/[vin]/inquire" featureId="product.marketplace" hasNativeScreen>
      <InquiryComposer vin={vin} context={context} session={session} onLeave={leave} />
    </NativeFeatureBoundary>
  );
}
