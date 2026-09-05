import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';
import {
  getMarketplaceListingDetail,
  createMarketplaceInquiry,
  resolveMarketplacePrimaryImage,
  type MobileListingDetail,
  type MobilePublicTrust,
} from '../../utils/marketplaceApi';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';

function titleCase(value: string | null | undefined) {
  if (!value) return null;
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function vehicleTitle(vehicle: MobileListingDetail) {
  return [vehicle.year, vehicle.make, vehicle.model]
    .filter(value => value !== null && value !== undefined && value !== '')
    .join(' ');
}

function formatPrice(price: number | null, currency: string | null) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'Price not recorded';
  if (!currency?.trim()) return `${price.toLocaleString()} · currency not recorded`;
  const normalized = currency.trim().toUpperCase();
  if (normalized === 'USD') return `$${price.toLocaleString()}`;
  return `${normalized} ${price.toLocaleString()}`;
}

function formatMileage(mileage: number | null) {
  return typeof mileage === 'number' && Number.isFinite(mileage)
    ? `${mileage.toLocaleString()} km`
    : 'Mileage not recorded';
}

function formatEvaluationDate(value: string | null | undefined) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString() : null;
}

function TrustCard({ trust }: { trust?: MobilePublicTrust | null }) {
  const evaluatedDate = formatEvaluationDate(trust?.evaluated_at);
  const evaluatedScore = trust?.evaluation_state === 'evaluated'
    && typeof trust.score === 'number'
    && Number.isFinite(trust.score)
    ? trust.score
    : null;

  if (evaluatedScore !== null) {
    return (
      <View className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
        <View className="flex-row items-start justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-orange-700">CarUp Trust</Text>
            <Text className="mt-1 text-xl font-extrabold text-slate-950">
              {titleCase(trust?.band) || 'Evaluated'}
            </Text>
            <Text className="mt-1 text-xs leading-5 text-slate-600">
              Canonical evaluation{trust?.confidence ? ` · ${titleCase(trust.confidence)} confidence` : ''}
            </Text>
          </View>
          <View className="h-20 w-20 items-center justify-center rounded-2xl bg-slate-950">
            <Text className="text-2xl font-extrabold text-white">{evaluatedScore}</Text>
            <Text className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-orange-400">of 100</Text>
          </View>
        </View>
        {evaluatedDate ? (
          <Text className="mt-3 text-[10px] text-slate-500">Evaluated {evaluatedDate}</Text>
        ) : null}
      </View>
    );
  }

  const stateLabel = trust?.evaluation_state === 'not_evaluated'
    ? 'Not evaluated yet'
    : trust?.evaluation_state === 'stale'
      ? 'Evaluation update pending'
      : trust?.evaluation_state === 'unavailable'
        ? 'Trust temporarily unavailable'
        : 'Trust not loaded';

  return (
    <View className="rounded-2xl border border-slate-200 bg-white p-5">
      <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500">CarUp Trust</Text>
      <Text className="mt-1 text-lg font-bold text-slate-900">{stateLabel}</Text>
      <Text className="mt-1 text-xs leading-5 text-slate-500">
        No numerical score is shown unless the canonical Trust authority reports a current evaluation.
      </Text>
      {trust?.known_limitations?.length ? (
        <Text className="mt-3 text-[10px] leading-4 text-slate-500">{trust.known_limitations[0]}</Text>
      ) : null}
    </View>
  );
}

function VehicleDetailScreenInner() {
  const router = useRouter();
  const { vin } = useLocalSearchParams();
  const token = useAuthStore((state) => state.token);
  const { data: marketplaceDetail, isLoading, error, refetch } = useQuery<MobileListingDetail>({
    queryKey: ['marketplace-detail', vin],
    queryFn: () => getMarketplaceListingDetail(String(vin)),
    enabled: !!vin,
  });

  const [inquiring, setInquiring] = useState(false);
  const handleInquire = async () => {
    if (!token) {
      Alert.alert('Sign in to inquire', 'Please sign in so the seller can respond safely. Never pay outside CarUp.');
      return;
    }
    setInquiring(true);
    try {
      await createMarketplaceInquiry({ listing_id: String(vin), inquiry_type: 'vehicle_purchase_interest' });
      Alert.alert('Inquiry sent', 'Your inquiry is now in CarUp. Keep the conversation and any payment steps inside CarUp.');
    } catch (e) {
      Alert.alert('Could not send inquiry', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setInquiring(false);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (error || !marketplaceDetail) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 px-6">
        <Text className="mb-2 text-center text-lg font-bold text-slate-900">Vehicle details unavailable</Text>
        <Text className="mb-6 text-center text-sm leading-5 text-slate-500">
          CarUp could not load the canonical Marketplace record for this vehicle.
        </Text>
        <View className="flex-row gap-3">
          <Pressable onPress={() => refetch()} className="rounded-xl bg-orange-500 px-5 py-3">
            <Text className="text-xs font-semibold text-white">Try Again</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} className="rounded-xl border border-slate-300 bg-white px-5 py-3">
            <Text className="text-xs font-semibold text-slate-700">Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const vehicle = marketplaceDetail;
  const trustSummary = marketplaceDetail.trust_summary;
  const title = vehicleTitle(vehicle) || `${vehicle.make} ${vehicle.model}`;
  // The backend has already elected the canonical primary. Re-electing items[0] here can
  // contradict the seller's is_primary choice and bypass primary_image_state on inconsistent payloads.
  const heroUrl = resolveMarketplacePrimaryImage(vehicle);
  const reservation = vehicle.reservation_summary;
  const isReserved = reservation?.reserved === true;
  const locationLabel = vehicle.location?.trim()
    || (vehicle.location_state === 'withheld' ? 'Location withheld' : 'Location not recorded');

  return (
    <View className="flex-1 bg-slate-50">
      <View className="flex-row items-center justify-between bg-slate-950 px-5 pb-4 pt-12">
        <Pressable onPress={() => router.back()} className="min-h-[44px] justify-center pr-4" accessibilityRole="button">
          <Text className="text-sm font-semibold text-white">← Marketplace</Text>
        </Pressable>
        <Text className="text-sm font-bold text-white">Vehicle & Passport</Text>
        <View className="w-20" />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <View className="bg-slate-100">
          {heroUrl ? (
            <Image source={{ uri: heroUrl }} resizeMode="cover" className="aspect-[16/10] w-full" accessibilityLabel={`${title} listing photo`} />
          ) : (
            <View className="aspect-[16/10] items-center justify-center px-6">
              <Text className="text-5xl">🚙</Text>
              <Text className="mt-3 text-center text-xs font-medium text-slate-500">
                {vehicle.primary_image_state === 'not_loaded' ? 'Listing media not loaded' : 'No published listing photo'}
              </Text>
            </View>
          )}
          {isReserved ? (
            <View className="absolute left-4 top-4 rounded-full bg-amber-500 px-3 py-1.5">
              <Text className="text-[10px] font-bold text-white">Reserved</Text>
            </View>
          ) : null}
        </View>

        <View className="px-5 py-6">
          <Text className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">VIN {vehicle.vin}</Text>
          <Text className="mt-1 text-3xl font-extrabold leading-9 text-slate-950">{title}</Text>
          <Text className="mt-2 text-2xl font-extrabold text-slate-950">{formatPrice(vehicle.price, vehicle.currency)}</Text>

          <View className="mt-3 flex-row flex-wrap gap-2">
            <View className="rounded-full bg-white px-3 py-1.5"><Text className="text-xs text-slate-600">{formatMileage(vehicle.mileage)}</Text></View>
            {vehicle.fuel_type ? <View className="rounded-full bg-white px-3 py-1.5"><Text className="text-xs text-slate-600">{vehicle.fuel_type}</Text></View> : null}
            {vehicle.transmission ? <View className="rounded-full bg-white px-3 py-1.5"><Text className="text-xs text-slate-600">{vehicle.transmission}</Text></View> : null}
          </View>

          <View className="mt-6">
            <TrustCard trust={vehicle.trust} />
          </View>

          <View className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
            <Text className="text-sm font-bold text-slate-900">Listing facts</Text>
            <View className="mt-4 gap-3">
              <View className="flex-row items-start justify-between gap-4">
                <Text className="text-xs text-slate-500">Seller</Text>
                <Text className="max-w-[65%] text-right text-xs font-semibold text-slate-800">{vehicle.seller_display_label || 'Seller not disclosed'}</Text>
              </View>
              <View className="flex-row items-start justify-between gap-4">
                <Text className="text-xs text-slate-500">Location</Text>
                <Text className="max-w-[65%] text-right text-xs font-semibold text-slate-800">{locationLabel}</Text>
              </View>
              <View className="flex-row items-start justify-between gap-4">
                <Text className="text-xs text-slate-500">Reservation</Text>
                <Text className="max-w-[65%] text-right text-xs font-semibold text-slate-800">{titleCase(reservation?.state) || 'Unavailable'}</Text>
              </View>
              <View className="flex-row items-start justify-between gap-4">
                <Text className="text-xs text-slate-500">Evidence</Text>
                <Text className="max-w-[65%] text-right text-xs font-semibold text-slate-800">{titleCase(trustSummary?.evidence_status) || 'Not loaded'}</Text>
              </View>
              <View className="flex-row items-start justify-between gap-4">
                <Text className="text-xs text-slate-500">PartSentry</Text>
                <Text className="max-w-[65%] text-right text-xs font-semibold text-slate-800">{titleCase(trustSummary?.partsentry_public_status) || 'Not loaded'}</Text>
              </View>
            </View>
          </View>

          {trustSummary?.safe_public_copy ? (
            <View className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
              <Text className="text-sm font-bold text-slate-900">CarUp public safety note</Text>
              <Text className="mt-2 text-xs leading-5 text-slate-600">{trustSummary.safe_public_copy}</Text>
            </View>
          ) : null}

          {vehicle.safety_warnings?.length ? (
            <View className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <Text className="text-sm font-bold text-amber-900">Safety information</Text>
              {vehicle.safety_warnings.map(warning => (
                <Text key={warning} className="mt-2 text-xs leading-5 text-amber-800">• {warning}</Text>
              ))}
            </View>
          ) : null}

          <View className="h-8" />
        </View>
      </ScrollView>

      <View className="flex-row items-center justify-between gap-4 border-t border-slate-200 bg-white px-5 pb-8 pt-4">
        <View className="min-w-0 flex-1">
          <Text className="text-[10px] uppercase tracking-wider text-slate-400">Listing price</Text>
          <Text numberOfLines={1} className="mt-0.5 text-lg font-extrabold text-slate-950">{formatPrice(vehicle.price, vehicle.currency)}</Text>
        </View>
        <Pressable
          onPress={handleInquire}
          disabled={inquiring}
          className="min-h-[48px] justify-center rounded-xl bg-orange-500 px-6 active:opacity-90"
          accessibilityRole="button"
        >
          <Text className="text-sm font-bold text-white">{inquiring ? 'Sending…' : 'Ask Seller'}</Text>
        </Pressable>
      </View>
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
