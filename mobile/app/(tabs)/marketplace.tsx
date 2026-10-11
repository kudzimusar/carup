import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { VEHICLE_MAKES } from '@shared/taxonomy/vehicle';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import { VehicleCard } from '../../components/marketplace/VehicleCard';
import {
  EmptyState,
  FilterChip,
  SearchField,
  SectionHeader,
} from '../../components/ui/NativePrimitives';
import { getMarketplaceListings } from '../../utils/marketplaceApi';
import { useAuthStore } from '../../store/authStore';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function MarketplaceSearchInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selectedMake, setSelectedMake] = useState<string | null>(null);
  const authLoading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const canSave = !authLoading && isAuthenticated && user?.role === 'owner';

  const freshQuery = useQuery({
    queryKey: ['marketplace-fresh-native'],
    queryFn: () => getMarketplaceListings({ limit: 4 }),
  });

  const makes = useMemo(() => VEHICLE_MAKES, []);

  const openResults = (overrideMake?: string | null) => {
    const make = overrideMake === undefined ? selectedMake : overrideMake;
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (make) params.set('make', make);
    const suffix = params.toString();
    router.push((`/market/results${suffix ? `?${suffix}` : ''}`) as never);
  };

  const listings = freshQuery.data?.listings || [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
      keyboardShouldPersistTaps="handled"
    >
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary }}>Find a car</Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
        Search published CarUp listings by make, model or keyword.
      </Text>

      <View style={{ marginTop: spacing[5] }}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search make, model or keyword"
          accessibilityLabel="Search the CarUp Marketplace"
          onSubmitEditing={() => openResults()}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing[2], paddingTop: spacing[3], paddingBottom: spacing[2] }}
      >
        <FilterChip label="All cars" selected={selectedMake === null} onPress={() => { setSelectedMake(null); openResults(null); }} />
        {canSave ? (
          <FilterChip
            label="Saved"
            onPress={() => router.push('/market/results?saved=true' as never)}
          />
        ) : null}
        {makes.map((make) => (
          <FilterChip
            key={make}
            label={make}
            selected={selectedMake === make}
            onPress={() => {
              setSelectedMake(make);
              openResults(make);
            }}
          />
        ))}
      </ScrollView>

      <View style={{ marginTop: spacing[5] }}>
        <SectionHeader title="Fresh on CarUp" actionLabel="See all" onAction={() => openResults()} />
      </View>

      {freshQuery.isLoading ? (
        <View style={{ paddingVertical: spacing[10], alignItems: 'center' }}>
          <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading Marketplace vehicles" />
        </View>
      ) : freshQuery.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Marketplace is unavailable"
          body="CarUp could not load current published listings. Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void freshQuery.refetch()}
        />
      ) : listings.length === 0 ? (
        <EmptyState
          icon="car-outline"
          title="No published vehicles right now"
          body="There are no current Marketplace listings to show. CarUp will not fill this space with demo cars."
          actionLabel="Start selling"
          onAction={() => router.push('/sell' as never)}
        />
      ) : (
        <View style={{ gap: spacing[4] }}>
          {listings.slice(0, 4).map((item) => (
            <VehicleCard
              key={item.vin}
              item={item}
              onPress={() => router.push(`/vehicle/${item.vin}` as never)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

export default function MarketplaceSearchScreen() {
  return (
    <NativeFeatureBoundary route="/marketplace" featureId="product.marketplace" hasNativeScreen>
      <MarketplaceSearchInner />
    </NativeFeatureBoundary>
  );
}
