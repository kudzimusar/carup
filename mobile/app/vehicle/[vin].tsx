import React, { useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import { VehicleImage } from '../../components/media/NativeMedia';
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
import { createCommunicationShare } from '../../utils/communicationApi';
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

function TrustEvidence({ trust }: { trust?: MobilePublicTrust | null }) {
  const theme = useNativeTheme();
  const evaluated =
    trust?.evaluation_state === 'evaluated' &&
    typeof trust.score === 'number' &&
    Number.isFinite(trust.score);
  const basis = trust?.evidence_basis;
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
        {trust?.known_limitations?.[0] ? (
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[3] }}>
            {trust.known_limitations[0]}
          </Text>
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

      {basis ? (
        <View style={{ gap: spacing[2] }}>
          {typeof basis.governed_facts_substantiated === 'number' ? (
            <TrustSignal
              label={`${basis.governed_facts_substantiated} evidence-backed fact${basis.governed_facts_substantiated === 1 ? '' : 's'}`}
              detail={typeof basis.governed_facts_total === 'number' ? `out of ${basis.governed_facts_total} facts considered` : undefined}
              tone="success"
            />
          ) : null}
          {typeof basis.connected_sources === 'number' ? (
            <TrustSignal
              label={`${basis.connected_sources} connected evidence source${basis.connected_sources === 1 ? '' : 's'}`}
              detail="CarUp uses the evidence it can currently connect to this vehicle."
            />
          ) : null}
          {typeof basis.governed_facts_adverse === 'number' && basis.governed_facts_adverse > 0 ? (
            <TrustSignal
              label={`${basis.governed_facts_adverse} item${basis.governed_facts_adverse === 1 ? '' : 's'} need attention`}
              detail="Open the evidence sections below for the available context."
              tone="warning"
            />
          ) : null}
        </View>
      ) : null}

      <Notice
        title="What CarUp is claiming"
        body="This Trust evaluation describes evidence CarUp currently holds. It is not a government registry, title deed or guarantee of future condition."
        tone="info"
      />

      {trust?.known_limitations?.length ? (
        <View style={{ gap: spacing[1] }}>
          <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.primary }}>Known limits</Text>
          {trust.known_limitations.slice(0, 3).map((limitation) => (
            <Text key={limitation} allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
              • {limitation}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
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
  const { vin } = useLocalSearchParams<{ vin?: string }>();
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
      await createMarketplaceInquiry({
        listing_id: String(vin),
        inquiry_type: 'vehicle_purchase_interest',
        message: 'I am interested in this vehicle.',
      });
      Alert.alert(
        'Message sent through CarUp',
        'Keep the conversation and any transaction steps inside CarUp.',
        [
          { text: 'Stay here', style: 'cancel' },
          { text: 'Open Inbox', onPress: () => router.push('/(tabs)/inbox' as never) },
        ],
      );
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
  const evidenceSignals = [
    ...(trustSummary?.public_badge_copy || []),
    ...(trustSummary?.trust_badges || []),
  ].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[3] }}>
          <Button label="Back to Market" variant="tertiary" onPress={() => router.back()} />
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
            <FactRow label="Evidence status" value={titleCase(trustSummary?.evidence_status) || 'Not loaded'} />
            <FactRow label="Service / parts evidence" value={titleCase(trustSummary?.partsentry_public_status) || 'Not loaded'} />
          </View>

          {trustSummary?.safe_public_copy ? (
            <View style={{ marginTop: spacing[5] }}>
              <Notice title="Safety note" body={trustSummary.safe_public_copy} tone="info" />
            </View>
          ) : null}

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
