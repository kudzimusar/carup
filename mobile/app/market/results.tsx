import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import { MarketplaceFilterSheet } from '../../components/marketplace/MarketplaceFilterSheet';
import { VehicleCard } from '../../components/marketplace/VehicleCard';
import {
  Button,
  EmptyState,
  FilterChip,
  SearchField,
} from '../../components/ui/NativePrimitives';
import {
  getMarketplaceListings,
  getSavedMarketplaceListings,
  saveMarketplaceListing,
  unsaveMarketplaceListing,
  type MobileListingSummary,
} from '../../utils/marketplaceApi';
import {
  EMPTY_MARKETPLACE_FILTERS,
  MARKETPLACE_SORTS,
  activeMarketplaceFilterChips,
  activeMarketplaceFilterCount,
  clearMarketplaceFilters,
  marketplaceApiQuery,
  marketplaceFiltersFromParams,
  marketplaceResultsHref,
  removeMarketplaceFilter,
  serializeMarketplaceFilters,
  type MarketplaceFilters,
} from '../../utils/marketplaceFilters';
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function ResultsInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;
  const initialFilters = useMemo(() => marketplaceFiltersFromParams(params), [params]);
  const [filters, setFilters] = useState<MarketplaceFilters>(initialFilters);
  const [search, setSearch] = useState(initialFilters.q);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [saveBusyVin, setSaveBusyVin] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const expanded = width >= 700;
  const columns = expanded ? 2 : 1;

  const authLoading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const canSave = !authLoading && isAuthenticated && user?.role === 'owner';
  const savedMode = params.saved === 'true';

  const serializedFilters = serializeMarketplaceFilters(filters);
  const apiQuery = useMemo(() => marketplaceApiQuery(filters), [serializedFilters]);

  const marketplaceQuery = useQuery({
    queryKey: ['marketplace-results-native', serializedFilters],
    queryFn: () => getMarketplaceListings(apiQuery),
    enabled: !savedMode,
  });

  const savedQuery = useQuery({
    queryKey: ['marketplace-saved-native', user?.id],
    queryFn: getSavedMarketplaceListings,
    enabled: canSave,
  });

  const savedVins = useMemo(
    () => new Set((savedQuery.data?.listings || []).map((item) => item.vin)),
    [savedQuery.data],
  );

  const listings = useMemo(() => {
    if (!savedMode) return marketplaceQuery.data?.listings || [];
    const base = savedQuery.data?.listings || [];
    const query = search.trim().toLowerCase();
    return base.filter((item) => {
      if (filters.make && item.make !== filters.make) return false;
      if (!query) return true;
      return [item.make, item.model, item.year, item.location]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [filters.make, marketplaceQuery.data, savedMode, savedQuery.data, search]);

  const activeQuery = savedMode ? savedQuery : marketplaceQuery;
  const resultCount = savedMode ? listings.length : (marketplaceQuery.data?.total ?? 0);
  const filterCount = activeMarketplaceFilterCount(filters);
  const activeChips = activeMarketplaceFilterChips(filters);
  const sortLabel = MARKETPLACE_SORTS.find((item) => item.value === filters.sort)?.label || 'Newest';

  const commitFilters = (next: MarketplaceFilters) => {
    setFilters(next);
    setSearch(next.q);
    router.replace(marketplaceResultsHref(next) as never);
  };

  const submitSearch = () => {
    if (savedMode) return;
    commitFilters({ ...filters, q: search.trim() });
  };

  const clearAll = () => {
    const cleared = clearMarketplaceFilters();
    setFilters(cleared);
    setSearch('');
    router.replace('/market/results' as never);
  };

  const toggleSave = async (item: MobileListingSummary) => {
    if (!canSave || saveBusyVin) return;
    const wasSaved = savedVins.has(item.vin);
    setSaveBusyVin(item.vin);
    try {
      if (wasSaved) {
        await unsaveMarketplaceListing(item.vin);
      } else {
        await saveMarketplaceListing(item.vin);
      }
      await savedQuery.refetch();
    } finally {
      setSaveBusyVin(null);
    }
  };

  if (savedMode && authLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading saved cars" />
      </View>
    );
  }

  if (savedMode && !canSave) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="bookmark-outline"
          title={isAuthenticated ? 'Saved cars are not available here' : 'Sign in to see saved cars'}
          body={isAuthenticated
            ? 'Saved Marketplace discovery is available from a personal CarUp account.'
            : 'Your saved Marketplace cars are tied to your CarUp account.'}
          actionLabel={isAuthenticated ? 'Back to Buy' : 'Sign in'}
          onAction={() => isAuthenticated
            ? router.replace('/(tabs)/marketplace' as never)
            : router.push('/(auth)/login' as never)}
        />
      </View>
    );
  }

  const renderItem = ({ item, index }: { item: MobileListingSummary; index: number }) => (
    <View
      style={{
        flex: 1,
        marginBottom: spacing[4],
        marginRight: expanded && index % 2 === 0 ? spacing[2] : 0,
        marginLeft: expanded && index % 2 === 1 ? spacing[2] : 0,
      }}
    >
      <VehicleCard
        item={item}
        onPress={() => router.push(`/vehicle/${item.vin}` as never)}
        compact={expanded}
        saved={savedVins.has(item.vin)}
        saveBusy={saveBusyVin === item.vin}
        onToggleSave={canSave ? () => void toggleSave(item) : undefined}
      />
    </View>
  );

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
        <View
          style={{
            paddingHorizontal: spacing[5],
            paddingTop: spacing[4],
            paddingBottom: spacing[3],
            borderBottomWidth: 1,
            borderBottomColor: theme.border.default,
            backgroundColor: theme.background.surface,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
            <Button label="Back" variant="tertiary" onPress={() => router.back()} />
            <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary, flex: 1 }}>
              {savedMode ? 'Saved cars' : 'Buy'}
            </Text>
          </View>

          <View style={{ marginTop: spacing[3] }}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search make, model or keyword"
              accessibilityLabel={savedMode ? 'Search your saved cars' : 'Search Marketplace results'}
              onSubmitEditing={submitSearch}
            />
          </View>

          {!savedMode ? (
            <>
              <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] }}>
                <Button
                  label={filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
                  variant="secondary"
                  accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters'}
                  onPress={() => setFilterSheetOpen(true)}
                  icon={<Ionicons name="options-outline" size={18} color={theme.text.primary} />}
                  style={{ flex: 1 }}
                />
                <Button
                  label={`Sort: ${sortLabel}`}
                  variant="secondary"
                  accessibilityLabel={`Sort Marketplace results, current ${sortLabel}`}
                  onPress={() => setFilterSheetOpen(true)}
                  icon={<Ionicons name="swap-vertical-outline" size={18} color={theme.text.primary} />}
                  style={{ flex: 1 }}
                />
              </View>

              {activeChips.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing[2], paddingTop: spacing[3] }}
                >
                  {activeChips.map((chip) => (
                    <Pressable
                      key={`${chip.key}:${chip.value}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${chip.label} filter`}
                      onPress={() => commitFilters(removeMarketplaceFilter(filters, chip.key, chip.value))}
                      style={{
                        minHeight: 48,
                        borderRadius: radius.chip,
                        borderWidth: 1,
                        borderColor: theme.border.strong,
                        backgroundColor: theme.background.surfaceSunken,
                        paddingHorizontal: spacing[3],
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing[1],
                      }}
                    >
                      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.primary }}>{chip.label}</Text>
                      <Ionicons name="close" size={16} color={theme.text.secondary} />
                    </Pressable>
                  ))}
                  <FilterChip label="Clear all" onPress={clearAll} />
                </ScrollView>
              ) : null}
            </>
          ) : null}
        </View>

        {!activeQuery.isLoading && !activeQuery.isError ? (
          <View style={{ paddingHorizontal: spacing[5], paddingVertical: spacing[3] }}>
            <Text
              accessibilityLabel={`${resultCount} ${savedMode ? 'saved' : 'matching'} vehicles`}
              allowFontScaling
              style={{ ...typeScale.metadata, color: theme.text.secondary }}
            >
              {resultCount} {savedMode ? 'saved' : 'matching'} vehicle{resultCount === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}

        {activeQuery.isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={theme.brand.primary} accessibilityLabel={savedMode ? 'Loading saved cars' : 'Loading vehicle results'} />
          </View>
        ) : activeQuery.isError ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon="cloud-offline-outline"
              title={savedMode ? 'Saved cars are unavailable' : 'Results are unavailable'}
              body="CarUp could not load current Marketplace data. Check your connection and try again."
              actionLabel="Try again"
              onAction={() => void activeQuery.refetch()}
              secondaryLabel="Back to Buy"
              onSecondary={() => router.replace('/(tabs)/marketplace' as never)}
            />
          </View>
        ) : listings.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon={savedMode ? 'bookmark-outline' : 'search-outline'}
              title={savedMode ? 'No saved cars match' : '0 matching vehicles'}
              body={savedMode
                ? 'Save a Marketplace car to keep it here, or change your saved-cars search.'
                : 'No real published listings match this query. CarUp will not substitute unrelated or fabricated inventory.'}
              actionLabel={savedMode ? 'Back to Buy' : 'Clear all'}
              onAction={() => savedMode ? router.replace('/(tabs)/marketplace' as never) : clearAll()}
              secondaryLabel={savedMode ? undefined : 'Refine filters'}
              onSecondary={savedMode ? undefined : () => setFilterSheetOpen(true)}
            />
          </View>
        ) : (
          <FlashList
            key={`columns-${columns}`}
            data={listings}
            numColumns={columns}
            renderItem={renderItem}
            keyExtractor={(item) => item.vin}
            showsVerticalScrollIndicator={false}
            onRefresh={() => void activeQuery.refetch()}
            refreshing={activeQuery.isRefetching}
            contentContainerStyle={{ paddingHorizontal: spacing[5], paddingBottom: spacing[10] }}
          />
        )}
      </View>

      {!savedMode ? (
        <MarketplaceFilterSheet
          visible={filterSheetOpen}
          value={{ ...filters, q: search }}
          onClose={() => setFilterSheetOpen(false)}
          onApply={commitFilters}
        />
      ) : null}
    </>
  );
}

export default function MarketplaceResultsScreen() {
  return (
    <NativeFeatureBoundary route="/marketplace" featureId="product.marketplace" hasNativeScreen>
      <ResultsInner />
    </NativeFeatureBoundary>
  );
}
