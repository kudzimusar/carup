import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, Image } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  getMarketplaceListings,
  type MobileListingSummary,
  type MobilePublicTrust,
} from '../../utils/marketplaceApi';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';

type Vehicle = MobileListingSummary;

const MAKE_FILTERS = ['Toyota', 'Mercedes-Benz', 'Mazda', 'Nissan', 'Honda'];

function titleCase(value: string | null | undefined) {
  if (!value) return null;
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatPrice(price: number | null, currency: string | null) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'Price not recorded';
  if (!currency) return `${price.toLocaleString()} · currency not recorded`;
  if (currency.toUpperCase() === 'USD') return `$${price.toLocaleString()}`;
  return `${currency.toUpperCase()} ${price.toLocaleString()}`;
}

function TrustPreview({ trust }: { trust?: MobilePublicTrust | null }) {
  const score = trust?.score;
  const isEvaluated = trust?.evaluation_state === 'evaluated'
    && typeof score === 'number'
    && Number.isFinite(score);

  if (isEvaluated) {
    return (
      <View className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-[10px] font-bold uppercase tracking-wider text-orange-700">CarUp Trust</Text>
            <View className="mt-1 flex-row items-baseline">
              <Text className="text-sm font-bold text-slate-950">{titleCase(trust?.band) || 'Evaluated'}</Text>
              <Text className="ml-2 text-xs text-slate-500">{score}/100</Text>
            </View>
          </View>
          {trust?.confidence ? (
            <View className="items-end">
              <Text className="text-[9px] uppercase tracking-wider text-slate-400">Confidence</Text>
              <Text className="text-xs font-semibold text-slate-700">{titleCase(trust.confidence)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  const message = trust?.evaluation_state === 'not_evaluated'
    ? 'Not evaluated yet'
    : trust?.evaluation_state === 'stale'
      ? 'Evaluation update pending'
      : trust?.evaluation_state === 'unavailable'
        ? 'Trust temporarily unavailable'
        : 'Trust details on Vehicle Passport';

  return (
    <View className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500">CarUp Trust</Text>
      <Text className="mt-1 text-sm font-semibold text-slate-800">{message}</Text>
      <Text className="mt-0.5 text-[10px] text-slate-500">No legacy score is substituted.</Text>
    </View>
  );
}

function MarketplaceScreenInner() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [selectedMake, setSelectedMake] = useState<string | null>(null);

  // Native discovery follows the same reliability rule as web: the local input feels immediate, but
  // a short debounce commits q to the backend so a valid match outside the first returned page is
  // still discoverable. The server, not this screen, owns public eligibility and Trust ordering.
  useEffect(() => {
    const next = search.trim();
    if (next === committedSearch) return;
    const timer = setTimeout(() => setCommittedSearch(next), 300);
    return () => clearTimeout(timer);
  }, [search, committedSearch]);

  const queryFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    if (selectedMake) filters.make = selectedMake;
    if (committedSearch) filters.q = committedSearch;
    return Object.keys(filters).length ? filters : undefined;
  }, [selectedMake, committedSearch]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['marketplace-listings', selectedMake, committedSearch],
    queryFn: () => getMarketplaceListings(queryFilters),
  });

  const vehicles = data?.listings || [];

  const renderVehicleCard = ({ item }: { item: Vehicle }) => {
    const name = [item.year, item.make, item.model].filter(value => value !== null && value !== undefined && value !== '').join(' ');
    const isReserved = item.reservation_summary?.reserved === true;

    return (
      <View className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <Pressable
          onPress={() => router.push(`/vehicle/${item.vin}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${name || `${item.make} ${item.model}`}`}
          className="active:opacity-95"
        >
          <View className="aspect-[16/10] bg-slate-100">
            {item.primary_image_url ? (
              <Image
                source={{ uri: item.primary_image_url }}
                resizeMode="cover"
                className="h-full w-full"
                accessibilityLabel={`${name || `${item.make} ${item.model}`} listing photo`}
              />
            ) : (
              <View className="h-full w-full items-center justify-center bg-slate-100 px-6">
                <Text className="text-4xl">🚙</Text>
                <Text className="mt-2 text-center text-xs font-medium text-slate-500">
                  {item.primary_image_state === 'not_loaded' ? 'Listing media not loaded' : 'No published listing photo'}
                </Text>
              </View>
            )}
            {isReserved ? (
              <View className="absolute left-3 top-3 rounded-full bg-amber-500 px-2.5 py-1">
                <Text className="text-[10px] font-bold text-white">Reserved</Text>
              </View>
            ) : null}
          </View>

          <View className="p-4">
            <Text className="text-base font-bold leading-5 text-slate-950">{name || `${item.make} ${item.model}`}</Text>
            <Text className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
              {formatPrice(item.price, item.currency)}
            </Text>

            <View className="mt-2 flex-row flex-wrap items-center">
              {typeof item.mileage === 'number' && Number.isFinite(item.mileage) ? (
                <Text className="mr-3 text-xs text-slate-500">{item.mileage.toLocaleString()} km</Text>
              ) : null}
              {item.fuel_type ? <Text className="mr-3 text-xs text-slate-500">{item.fuel_type}</Text> : null}
              {item.transmission ? <Text className="text-xs text-slate-500">{item.transmission}</Text> : null}
            </View>

            <View className="mt-3">
              <TrustPreview trust={item.trust} />
            </View>

            <View className="mt-3 flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-xs font-medium text-slate-700">
                  {item.seller_display_label || 'Seller not disclosed'}
                </Text>
                <Text numberOfLines={1} className="mt-0.5 text-[11px] text-slate-500">
                  {item.location || (item.location_state === 'withheld' ? 'Location withheld' : 'Location not recorded')}
                </Text>
              </View>
              <View className="rounded-xl bg-slate-950 px-4 py-2.5">
                <Text className="text-xs font-semibold text-white">Vehicle & Passport</Text>
              </View>
            </View>
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-slate-50">
      <View className="border-b border-slate-200 bg-white px-5 pb-4 pt-5">
        <Text className="text-2xl font-extrabold tracking-tight text-slate-950">Find your next vehicle</Text>
        <Text className="mt-1 text-sm leading-5 text-slate-500">
          Shop published listings with CarUp Trust and Vehicle Passport context where available.
        </Text>

        <TextInput
          className="mt-4 h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900"
          placeholder="Search make, model, location, or VIN"
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
          <Pressable
            onPress={() => setSelectedMake(null)}
            className={`mr-2 min-h-[44px] justify-center rounded-full border px-4 ${selectedMake === null ? 'border-slate-950 bg-slate-950' : 'border-slate-200 bg-white'}`}
          >
            <Text className={`text-xs font-semibold ${selectedMake === null ? 'text-white' : 'text-slate-600'}`}>All makes</Text>
          </Pressable>
          {MAKE_FILTERS.map(make => (
            <Pressable
              key={make}
              onPress={() => setSelectedMake(make)}
              className={`mr-2 min-h-[44px] justify-center rounded-full border px-4 ${selectedMake === make ? 'border-slate-950 bg-slate-950' : 'border-slate-200 bg-white'}`}
            >
              <Text className={`text-xs font-semibold ${selectedMake === make ? 'text-white' : 'text-slate-600'}`}>{make}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View className="flex-1 px-5 pt-4">
        {!isLoading && !error ? (
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-slate-800">{data?.total ?? vehicles.length} matching vehicles</Text>
            {committedSearch ? <Text className="text-xs text-slate-500">“{committedSearch}”</Text> : null}
          </View>
        ) : null}

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#f97316" />
            <Text className="mt-3 text-sm text-slate-500">Loading published vehicles…</Text>
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center px-6">
            <View className="mb-4 rounded-full bg-red-50 p-4"><Text className="text-3xl">⚠️</Text></View>
            <Text className="mb-2 text-center text-lg font-bold text-slate-800">Unable to load Marketplace</Text>
            <Text className="mb-8 text-center text-sm leading-5 text-slate-500">We could not reach the Marketplace service. Check your connection and try again.</Text>
            <Pressable onPress={() => refetch()} className="min-h-[48px] rounded-xl bg-slate-950 px-8 py-3.5 active:opacity-90">
              <Text className="text-sm font-semibold text-white">Try again</Text>
            </Pressable>
          </View>
        ) : vehicles.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-4xl">🔎</Text>
            <Text className="mt-3 text-center text-lg font-bold text-slate-900">No matching vehicles</Text>
            <Text className="mt-1 text-center text-sm leading-5 text-slate-500">Try another make or broaden your search.</Text>
          </View>
        ) : (
          <View className="flex-1" style={{ minHeight: 2 }}>
            <FlashList
              data={vehicles}
              renderItem={renderVehicleCard}
              showsVerticalScrollIndicator={false}
              onRefresh={refetch}
              refreshing={isLoading}
              contentContainerStyle={{ paddingBottom: 32 }}
            />
          </View>
        )}
      </View>
    </View>
  );
}

export default function MarketplaceScreen() {
  return (
    <NativeFeatureBoundary route="/marketplace" featureId="product.marketplace" hasNativeScreen>
      <MarketplaceScreenInner />
    </NativeFeatureBoundary>
  );
}