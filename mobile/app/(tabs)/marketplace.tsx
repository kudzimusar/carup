import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { VEHICLE_MAKES } from '@shared/taxonomy/vehicle';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import { MarketplaceFilterSheet } from '../../components/marketplace/MarketplaceFilterSheet';
import { VehicleCard } from '../../components/marketplace/VehicleCard';
import {
  Button,
  EmptyState,
  FilterChip,
  SearchField,
  SectionHeader,
} from '../../components/ui/NativePrimitives';
import { getMarketplaceListings } from '../../utils/marketplaceApi';
import {
  activeMarketplaceFilterCount,
  marketplaceFiltersFromParams,
  marketplaceResultsHref,
  type MarketplaceFilters,
} from '../../utils/marketplaceFilters';
import { useAuthStore } from '../../store/authStore';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function MarketplaceSearchInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[] | undefined>>();
  const initialFilters = useMemo(() => marketplaceFiltersFromParams(params), [params]);
  const [filters, setFilters] = useState<MarketplaceFilters>(initialFilters);
  const [search, setSearch] = useState(initialFilters.q);
  const [filterSheetOpen, setFilterSheetOpen] = useState(params.filters === 'open');
  const authLoading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const canSave = !authLoading && isAuthenticated && user?.role === 'owner';

  const freshQuery = useQuery({
    queryKey: ['marketplace-fresh-native'],
    queryFn: () => getMarketplaceListings({ limit: 4 }),
  });

  const makes = useMemo(() => VEHICLE_MAKES, []);
  const filterCount = activeMarketplaceFilterCount(filters);

  const openResults = (next: MarketplaceFilters = filters) => {
    router.push(marketplaceResultsHref({ ...next, q: search.trim() }) as never);
  };

  const applyFilters = (next: MarketplaceFilters) => {
    const applied = { ...next, q: search.trim() || next.q.trim() };
    setFilters(applied);
    setSearch(applied.q);
    router.push(marketplaceResultsHref(applied) as never);
  };

  const listings = freshQuery.data?.listings || [];

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.background.canvas }}
        contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
        keyboardShouldPersistTaps="handled"
      >
        <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary }}>Buy on CarUp</Text>
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
          Search the real Marketplace, then refine only with filters the canonical backend supports.
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

        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] }}>
          <Button
            label={filterCount > 0 ? `All filters (${filterCount})` : 'All filters'}
            accessibilityLabel={filterCount > 0 ? `All filters, ${filterCount} active` : 'All filters'}
            variant="secondary"
            onPress={() => setFilterSheetOpen(true)}
            icon={<Ionicons name="options-outline" size={19} color={theme.text.primary} />}
            style={{ flex: 1 }}
          />
          <Button
            label="Search"
            onPress={() => openResults()}
            style={{ flex: 1 }}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing[2], paddingTop: spacing[3], paddingBottom: spacing[2] }}
        >
          <FilterChip
            label="All cars"
            selected={!filters.make}
            onPress={() => {
              const next = { ...filters, make: '', model: '' };
              setFilters(next);
              openResults(next);
            }}
          />
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
              selected={filters.make === make}
              onPress={() => {
                const next = { ...filters, make, model: '' };
                setFilters(next);
                openResults(next);
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

      <MarketplaceFilterSheet
        visible={filterSheetOpen}
        value={{ ...filters, q: search }}
        onClose={() => setFilterSheetOpen(false)}
        onApply={applyFilters}
      />
    </>
  );
}

export default function MarketplaceSearchScreen() {
  return (
    <NativeFeatureBoundary route="/marketplace" featureId="product.marketplace" hasNativeScreen>
      <MarketplaceSearchInner />
    </NativeFeatureBoundary>
  );
}
