import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { VEHICLE_MAKES } from '@shared/taxonomy/vehicle';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
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
import { useAuthStore } from '../../store/authStore';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function ResultsInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; make?: string; saved?: string }>();
  const [search, setSearch] = useState(typeof params.q === 'string' ? params.q : '');
  const [committedSearch, setCommittedSearch] = useState(typeof params.q === 'string' ? params.q : '');
  const [selectedMake, setSelectedMake] = useState<string | null>(
    typeof params.make === 'string' && params.make ? params.make : null,
  );
  const [saveBusyVin, setSaveBusyVin] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const expanded = width >= 700;
  const columns = expanded ? 2 : 1;

  const authLoading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const canSave = !authLoading && isAuthenticated && user?.role === 'owner';
  const savedMode = params.saved === 'true';

  const filters = useMemo(() => {
    const next: Record<string, string> = {};
    if (committedSearch.trim()) next.q = committedSearch.trim();
    if (selectedMake) next.make = selectedMake;
    return Object.keys(next).length ? next : undefined;
  }, [committedSearch, selectedMake]);

  const marketplaceQuery = useQuery({
    queryKey: ['marketplace-results-native', committedSearch, selectedMake],
    queryFn: () => getMarketplaceListings(filters),
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
    const base = savedMode ? (savedQuery.data?.listings || []) : (marketplaceQuery.data?.listings || []);
    if (!savedMode) return base;
    const query = committedSearch.trim().toLowerCase();
    return base.filter((item) => {
      if (selectedMake && item.make !== selectedMake) return false;
      if (!query) return true;
      return [item.make, item.model, item.year, item.location]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [committedSearch, marketplaceQuery.data, savedMode, savedQuery.data, selectedMake]);

  const submitSearch = () => setCommittedSearch(search.trim());

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

  const activeQuery = savedMode ? savedQuery : marketplaceQuery;
  const resultCount = savedMode ? listings.length : (marketplaceQuery.data?.total ?? listings.length);

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
          actionLabel={isAuthenticated ? 'Back to Market' : 'Sign in'}
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
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <View
        style={{
          paddingHorizontal: spacing[5],
          paddingTop: spacing[5],
          paddingBottom: spacing[3],
          borderBottomWidth: 1,
          borderBottomColor: theme.border.default,
          backgroundColor: theme.background.surface,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
          <Button label="Back" variant="tertiary" onPress={() => router.back()} />
          <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary, flex: 1 }}>
            {savedMode ? 'Saved cars' : 'Marketplace'}
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

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing[2], paddingTop: spacing[3] }}
        >
          <FilterChip label="All makes" selected={selectedMake === null} onPress={() => setSelectedMake(null)} />
          {canSave && !savedMode ? (
            <FilterChip label="Saved" onPress={() => router.push('/market/results?saved=true' as never)} />
          ) : null}
          {VEHICLE_MAKES.map((make) => (
            <FilterChip
              key={make}
              label={make}
              selected={selectedMake === make}
              onPress={() => setSelectedMake(make)}
            />
          ))}
        </ScrollView>
      </View>

      {!activeQuery.isLoading && !activeQuery.isError ? (
        <View style={{ paddingHorizontal: spacing[5], paddingVertical: spacing[3] }}>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.secondary }}>
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
            secondaryLabel="Back to search"
            onSecondary={() => router.back()}
          />
        </View>
      ) : listings.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={savedMode ? 'bookmark-outline' : 'search-outline'}
            title={savedMode ? 'No saved cars match' : 'No cars match this search'}
            body={savedMode
              ? 'Save a Marketplace car to keep it here, or clear your current filters.'
              : 'Try another make or keyword. CarUp will not substitute unrelated or demo listings.'}
            actionLabel="Clear filters"
            onAction={() => {
              setSearch('');
              setCommittedSearch('');
              setSelectedMake(null);
            }}
            secondaryLabel={savedMode ? 'Browse Market' : 'Start a listing'}
            onSecondary={() => savedMode
              ? router.replace('/(tabs)/marketplace' as never)
              : router.push('/sell' as never)}
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
  );
}

export default function MarketplaceResultsScreen() {
  return (
    <NativeFeatureBoundary route="/marketplace" featureId="product.marketplace" hasNativeScreen>
      <ResultsInner />
    </NativeFeatureBoundary>
  );
}
