import React, { useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import { VehicleImage } from '../../components/media/NativeMedia';
import { presentTrustForCustomer } from '@shared/trust/customerTrustPresentation';
import {
  Button,
  EmptyState,
  Notice,
  Price,
  SectionHeader,
  StatusPill,
  StickyActionBar,
  TrustSignal,
} from '../../components/ui/NativePrimitives';
import { useAuthStore } from '../../store/authStore';
import {
  createMarketplaceInquiry,
  getMarketplaceListingDetail,
  getOwnerVehiclePassport,
  MarketplaceApiError,
  resolveMarketplacePrimaryImage,
  type MobileListingDetail,
  type MobilePublicTrust,
} from '../../utils/marketplaceApi';
import {
  createCommunicationShare,
  resolveMarketplaceInquiryConversation,
} from '../../utils/communicationApi';
import { nativeCanonicalObjectHref } from '../../utils/nativeObjectRouting';
import { marketplaceReturnFromParam } from '../../utils/marketplaceNavigation';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function titleCase(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function vehicleTitle(vehicle: Pick<MobileListingDetail, 'year' | 'make' | 'model'>): string {
  return [vehicle.year, vehicle.make, vehicle.model]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' ');
}

function formatDate(value: string | null | undefined): string | null {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString() : null;
}

// CARUP-MVP-STAB-01 F-010 / F-011 / F-013: the Trust record is worded only through the shared customer
// presenter, so this card says what web says: confidence, evidence support and connected official sources
// beside the score, and limitations as customer sentences. Nothing here is a success state.
function TrustEvidence({ trust }: { trust?: MobilePublicTrust | null }) {
  const theme = useNativeTheme();
  const presented = presentTrustForCustomer(trust);
  const evaluated = presented.evaluated && Number.isFinite(trust?.score);
  const adverse = trust?.evidence_basis?.governed_facts_adverse;
  const evaluatedAt = formatDate(trust?.evaluated_at);

  if (!evaluated) {
    const title =
      trust?.evaluation_state === 'stale'
        ? 'Trust evaluation update pending'
        : trust?.evaluation_state === 'unavailable'
          ? 'Trust information is temporarily unavailable'
          : trust?.evaluation_state === 'not_evaluated'
            ? 'Not evaluated yet'
            : 'Trust information not loaded';
    return (
      <View
        style={{
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: theme.border.default,
          backgroundColor: theme.background.surface,
          padding: spacing[5],
        }}
      >
        <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>{title}</Text>
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[2] }}>
          CarUp does not substitute an old or guessed score when current evidence is unavailable.
        </Text>
        {presented.limitations.length ? (
          <View style={{ marginTop: spacing[3] }}>
            <TrustLimitations limitations={presented.limitations} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surface,
        padding: spacing[5],
        gap: spacing[4],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[4] }}>
        <View style={{ flex: 1 }}>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>CarUp Trust</Text>
          <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary, marginTop: spacing[1] }}>
            {titleCase(trust?.band) || 'Evaluated'}
          </Text>
          {evaluatedAt ? (
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[1] }}>
              Evaluated {evaluatedAt}
            </Text>
          ) : null}
        </View>
        <View
          accessibilityLabel={`CarUp Trust score ${trust!.score} out of 100`}
          style={{
            minWidth: 82,
            minHeight: 82,
            borderRadius: radius.card,
            backgroundColor: theme.background.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing[2],
          }}
        >
          <Text allowFontScaling style={{ ...typeScale.priceLarge, color: theme.text.primary }}>{trust!.score}</Text>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>of 100</Text>
        </View>
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: theme.border.default, paddingTop: spacing[1] }}>
        {presented.rows.map((row) => (
          <View key={row.key} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
            <FactRow label={row.label} value={row.value} />
          </View>
        ))}
      </View>

      {typeof adverse === 'number' && adverse > 0 ? (
        <TrustSignal
          label={`${adverse} ${adverse === 1 ? 'item needs' : 'items need'} attention`}
          detail="Open the evidence sections below for the available context."
          tone="warning"
        />
      ) : null}

      <Notice
        title="What CarUp is claiming"
        body="This Trust evaluation describes evidence CarUp currently holds. It is not a government registry, title deed or guarantee of future condition."
        tone="info"
      />

      {presented.limitations.length ? <TrustLimitations limitations={presented.limitations} /> : null}
    </View>
  );
}

/** Customer-worded limitations: the first three, and every one of them one accessible tap away. */
function TrustLimitations({ limitations }: { limitations: string[] }) {
  const theme = useNativeTheme();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? limitations : limitations.slice(0, 3);
  return (
    <View style={{ gap: spacing[1] }}>
      <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.primary }}>Known limitations</Text>
      {shown.map((limitation) => (
        <Text key={limitation} allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
          • {limitation}
        </Text>
      ))}
      {limitations.length > 3 ? (
        <Button
          label={expanded ? 'Show fewer' : `Show all ${limitations.length}`}
          accessibilityLabel={expanded ? 'Show fewer known limitations' : `Show all ${limitations.length} known limitations`}
          variant="tertiary"
          onPress={() => setExpanded((value) => !value)}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}
        />
      ) : null}
    </View>
  );
}

/** CARUP-MVP-STAB-01 F-013: the listing's evidence status in plain words; "Verified" only when CarUp says so. */
const EVIDENCE_STATUS_LABEL: Record<string, string> = {
  none: 'None',
  partial: 'Partial',
  available: 'Available',
  verified: 'Verified',
  review_required: 'Under review',
  unavailable: 'Could not be checked',
};

function evidenceStatusLabel(status: string | null | undefined): string {
  const key = String(status ?? '').trim().toLowerCase();
  if (!key) return 'Not loaded';
  return Object.prototype.hasOwnProperty.call(EVIDENCE_STATUS_LABEL, key) ? EVIDENCE_STATUS_LABEL[key] : 'Not available';
}

function FactRow({ label, value }: { label: string; value: string }) {
  const theme = useNativeTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[4], paddingVertical: spacing[2] }}>
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{label}</Text>
      <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.secondary, flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function OwnerPassportFallback({ vin, passport }: { vin: string; passport: Awaited<ReturnType<typeof getOwnerVehiclePassport>> }) {
  const theme = useNativeTheme();
  const router = useRouter();
  const vehicle = passport.vehicle ?? {};
  const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vin;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <ScrollView contentContainerStyle={{ padding: spacing[5], paddingBottom: spacing[10] }}>
        <Button label="Back" variant="tertiary" onPress={() => router.back()} />
        <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[4] }}>Your vehicle · VIN {vin}</Text>
        <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[1] }}>{title}</Text>

        <View style={{ marginTop: spacing[5] }}>
          <Notice
            title="Not on the public Marketplace"
            body="This vehicle belongs in your private My Garage view. Buyers cannot see it until you complete a separate publication step."
            tone="warning"
          />
        </View>

        <View style={{ marginTop: spacing[6] }}>
          <SectionHeader title="Vehicle Passport" />
          <TrustEvidence trust={passport.trustReport ?? null} />
        </View>

        {typeof vehicle.mileage === 'number' ? (
          <View style={{ marginTop: spacing[5], borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, padding: spacing[4] }}>
            <FactRow label="Recorded mileage" value={`${vehicle.mileage.toLocaleString()} km`} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function VehicleDetailScreenInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const { vin, marketReturn } = useLocalSearchParams<{ vin?: string; marketReturn?: string | string[] }>();
  const marketplaceReturn = marketplaceReturnFromParam(marketReturn);
  const backToMarketplace = () => {
    router.replace((marketplaceReturn || '/(tabs)/marketplace') as never);
  };
  const token = useAuthStore((state) => state.token);
  const [messaging, setMessaging] = useState(false);
  const [sharing, setSharing] = useState(false);

  const detailQuery = useQuery<MobileListingDetail>({
    queryKey: ['marketplace-detail', vin],
    queryFn: () => getMarketplaceListingDetail(String(vin)),
    enabled: Boolean(vin),
    retry: (count, error) => !(error instanceof MarketplaceApiError && error.statusCode === 404) && count < 2,
  });

  const notPublic = detailQuery.error instanceof MarketplaceApiError && detailQuery.error.statusCode === 404;
  const ownerPassportQuery = useQuery({
    queryKey: ['owner-passport', vin],
    queryFn: () => getOwnerVehiclePassport(String(vin)),
    enabled: Boolean(vin && token && notPublic),
  });

  const openResolvedInquiryConversation = async (inquiryId: string, listingId: string): Promise<boolean> => {
    try {
      const resolution = await resolveMarketplaceInquiryConversation(inquiryId, listingId);
      if (resolution.state === 'resolved' && resolution.thread?.id) {
        router.push(nativeCanonicalObjectHref({
          type: 'conversation',
          id: String(resolution.thread.id),
        }) as never);
        return true;
      }

      Alert.alert(
        'Conversation is being prepared',
        'Your inquiry is saved. CarUp has not finished canonicalizing the conversation yet, so no substitute Inbox or second thread will be opened.',
        [
          { text: 'Stay here', style: 'cancel' },
          {
            text: 'Try exact conversation',
            onPress: () => void openResolvedInquiryConversation(inquiryId, listingId),
          },
        ],
      );
      return false;
    } catch (error) {
      Alert.alert(
        'Conversation unavailable',
        error instanceof Error ? error.message : 'CarUp could not resolve the canonical conversation.',
      );
      return false;
    }
  };

  const messageSeller = async () => {
    if (!token) {
      Alert.alert(
        'Sign in to message the seller',
        'You can browse without an account. Messaging starts a CarUp conversation so the seller can reply safely.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Sign in', onPress: () => router.push('/(auth)/login' as never) },
        ],
      );
      return;
    }

    setMessaging(true);
    try {
      const { inquiry } = await createMarketplaceInquiry({
        listing_id: String(vin),
        inquiry_type: 'vehicle_purchase_interest',
        message: 'I am interested in this vehicle.',
      });
      await openResolvedInquiryConversation(inquiry.id, String(vin));
    } catch (error) {
      Alert.alert('Message not sent', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setMessaging(false);
    }
  };

  const shareToWhatsApp = async () => {
    setSharing(true);
    try {
      const result = await createCommunicationShare({
        channel: 'whatsapp',
        listing_id: String(vin),
      });
      const url = result.share_url || result.listing_url;
      if (!url || typeof url !== 'string') throw new Error('CarUp did not return a share link.');
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Could not open WhatsApp share', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSharing(false);
    }
  };

  if (detailQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading vehicle details" />
      </View>
    );
  }

  if (notPublic && token && ownerPassportQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading your Vehicle Passport" />
      </View>
    );
  }

  if (notPublic && token && ownerPassportQuery.data) {
    return <OwnerPassportFallback vin={String(vin)} passport={ownerPassportQuery.data} />;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="car-outline"
          title="Vehicle details unavailable"
          body="CarUp could not load a current Marketplace record for this vehicle."
          actionLabel="Try again"
          onAction={() => void detailQuery.refetch()}
          secondaryLabel="Back to Market"
          onSecondary={() => router.replace('/(tabs)/marketplace' as never)}
        />
      </View>
    );
  }

  const vehicle = detailQuery.data;
  const title = vehicleTitle(vehicle) || [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const location =
    vehicle.location?.trim() ||
    (vehicle.location_state === 'withheld' ? 'Location withheld' : 'Location not recorded');
  const image = resolveMarketplacePrimaryImage(vehicle);
  const trustSummary = vehicle.trust_summary;
  // CARUP-MVP-STAB-01 F-013: only CarUp's public badge wording is shown; internal badge codes never are.
  const evidenceSignals = (trustSummary?.public_badge_copy || [])
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[3] }}>
          <Button label="Back to Market" variant="tertiary" onPress={backToMarketplace} />
        </View>

        <View style={{ position: 'relative', backgroundColor: theme.background.surfaceSunken }}>
          <VehicleImage uri={image} label={`${title || 'Vehicle'} listing photo`} />
          {vehicle.reservation_summary?.reserved === true ? (
            <View style={{ position: 'absolute', top: spacing[3], left: spacing[3] }}>
              <StatusPill label="Reserved" tone="warning" />
            </View>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[10] }}>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>VIN {vehicle.vin}</Text>
          <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[1] }}>{title}</Text>
          <View style={{ marginTop: spacing[2] }}>
            <Price amount={vehicle.price} currency={vehicle.currency} />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[4] }}>
            {typeof vehicle.mileage === 'number' ? <StatusPill label={`${vehicle.mileage.toLocaleString()} km`} /> : null}
            {vehicle.fuel_type ? <StatusPill label={vehicle.fuel_type} /> : null}
            {vehicle.transmission ? <StatusPill label={vehicle.transmission} /> : null}
          </View>

          <View style={{ marginTop: spacing[6] }}>
            <SectionHeader title="Listing" />
            <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}>
              <FactRow label="Seller" value={vehicle.seller_display_label || 'Seller not disclosed'} />
              <FactRow label="Location" value={location} />
              <FactRow label="Reservation" value={titleCase(vehicle.reservation_summary?.state) || 'Not recorded'} />
            </View>
          </View>

          <View style={{ marginTop: spacing[6] }}>
            <SectionHeader title="Vehicle Passport & Trust" />
            <TrustEvidence trust={vehicle.trust} />
          </View>

          {evidenceSignals.length ? (
            <View style={{ marginTop: spacing[5], borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, padding: spacing[4], gap: spacing[3] }}>
              <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>Evidence available</Text>
              {evidenceSignals.slice(0, 6).map((signal) => (
                <TrustSignal key={signal} label={signal} />
              ))}
            </View>
          ) : null}

          <View style={{ marginTop: spacing[5], borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}>
            <FactRow label="Evidence status" value={evidenceStatusLabel(trustSummary?.evidence_status)} />
            <FactRow label="Service / parts evidence" value={titleCase(trustSummary?.partsentry_public_status) || 'Not loaded'} />
          </View>

          {trustSummary?.safe_public_copy ? (
            <View style={{ marginTop: spacing[5] }}>
              <Notice title="Safety note" body={trustSummary.safe_public_copy} tone="info" />
            </View>
          ) : null}

          <View style={{ marginTop: spacing[6], gap: spacing[3] }}>
            <SectionHeader title="Buyer journey" />
            <Button
              label="Open Vehicle Passport"
              variant="secondary"
              onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.vin)}/passport` as never)}
            />
            <Button
              label="Reservation & SafePay"
              onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.vin)}/transaction` as never)}
            />
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
              Both continue with VIN {vehicle.vin}. Transaction, payment and ownership status come from CarUp backend authority, not this screen.
            </Text>
          </View>

          {vehicle.safety_warnings?.length ? (
            <View style={{ marginTop: spacing[4], gap: spacing[2] }}>
              {vehicle.safety_warnings.map((warning) => (
                <Notice key={warning} title="Needs attention" body={warning} tone="warning" />
              ))}
            </View>
          ) : null}

          <View style={{ marginTop: spacing[6] }}>
            <Button
              label="Share listing on WhatsApp"
              variant="provider"
              providerColor="#128C7E"
              onPress={() => void shareToWhatsApp()}
              loading={sharing}
              icon={<Ionicons name="logo-whatsapp" size={21} color="#FFFFFF" />}
            />
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[2], textAlign: 'center' }}>
              Sharing sends the listing link. WhatsApp is not the CarUp conversation record.
            </Text>
          </View>
        </View>
      </ScrollView>

      <StickyActionBar>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[4] }}>
          <View style={{ flex: 1 }}>
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>Listing price</Text>
            <Price amount={vehicle.price} currency={vehicle.currency} compact />
          </View>
          <Button label="Message seller" onPress={() => void messageSeller()} loading={messaging} />
        </View>
      </StickyActionBar>
    </View>
  );
}

export default function VehicleDetailScreen() {
  return (
    <NativeFeatureBoundary route="/vehicle/[vin]" featureId="product.marketplace" hasNativeScreen>
      <VehicleDetailScreenInner />
    </NativeFeatureBoundary>
  );
}
