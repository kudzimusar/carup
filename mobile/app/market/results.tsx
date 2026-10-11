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
import { getMarketplaceListings, type MobileListingSummary } from '../../utils/marketplaceApi';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';

function ResultsInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; make?: string }>();
  const [search, setSearch] = useState(typeof params.q === 'string' ? params.q : '');
  const [committedSearch, setCommittedSearch] = useState(typeof params.q === 'string' ? params.q : '');
  const [selectedMake, setSelectedMake] = useState<string | null>(
    typeof params.make === 'string' && params.make ? params.make : null,
  );
  const { width } = useWindowDimensions();
  const expanded = width >= 700;
  const columns = expanded ? 2 : 1;

  const filters = useMemo(() => {
    const next: Record<string, string> = {};
    if (committedSearch.trim()) next.q = committedSearch.trim();
    if (selectedMake) next.make = selectedMake;
    return Object.keys(next).length ? next : undefined;
  }, [committedSearch, selectedMake]);

  const query = useQuery({
    queryKey: ['marketplace-results-native', committedSearch, selectedMake],
    queryFn: () => getMarketplaceListings(filters),
  });

  const listings = query.data?.listings || [];

  const submitSearch = () => setCommittedSearch(search.trim());

  const renderItem = ({ item, index }: { item: MobileListingSummary; index: number }) => (
    <View
      style={{
        flex: 1,
        marginBottom: spacing[4],
        marginRight: expanded && index % 2 === 0 ? spacing[2] : 0,
        marginLeft: expanded && index % 2 === 1 ? spacing[2] : 0,
      }}
    >
      <VehicleCard item={item} onPress={() => router.push(`/vehicle/${item.vin}` as never)} compact={expanded} />
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
          <Text allowFontScaling style={{ ...typeScale.title, color: theme.text.primary, flex: 1 }}>Marketplace</Text>
        </View>
        <View style={{ marginTop: spacing[3] }}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search make, model or keyword"
            accessibilityLabel="Search Marketplace results"
            onSubmitEditing={submitSearch}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing[2], paddingTop: spacing[3] }}
        >
          <FilterChip label="All makes" selected={selectedMake === null} onPress={() => setSelectedMake(null)} />
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

      {!query.isLoading && !query.isError ? (
        <View style={{ paddingHorizontal: spacing[5], paddingVertical: spacing[3] }}>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.secondary }}>
            {query.data?.total ?? listings.length} matching vehicle{(query.data?.total ?? listings.length) === 1 ? '' : 's'}
          </Text>
        </View>
      ) : null}

      {query.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading vehicle results" />
        </View>
      ) : query.isError ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Results are unavailable"
            body="CarUp could not load current Marketplace results. Check your connection and try again."
            actionLabel="Try again"
            onAction={() => void query.refetch()}
            secondaryLabel="Back to search"
            onSecondary={() => router.back()}
          />
        </View>
      ) : listings.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="search-outline"
            title="No cars match this search"
            body="Try another make or keyword. CarUp will not substitute unrelated or demo listings."
            actionLabel="Clear filters"
            onAction={() => {
              setSearch('');
              setCommittedSearch('');
              setSelectedMake(null);
            }}
            secondaryLabel="Start a listing"
            onSecondary={() => router.push('/sell' as never)}
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
          onRefresh={() => void query.refetch()}
          refreshing={query.isRefetching}
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
