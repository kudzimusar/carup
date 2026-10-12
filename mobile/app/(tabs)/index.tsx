import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VehicleCard } from '../../components/marketplace/VehicleCard';
import { BrandSearchField, BrandSecondaryAction, CarUpWordmark } from '../../components/brand/CarUpBrand';
import {
  Button,
  EmptyState,
  FilterChip,
  SectionHeader,
} from '../../components/ui/NativePrimitives';
import {
  getMarketplaceListingDetail,
  getMarketplaceListings,
  getSellerMarketplaceInquiries,
} from '../../utils/marketplaceApi';
import { getMyVehicles } from '../../utils/ownerGarageApi';
import { listCommunicationThreads } from '../../utils/communicationApi';
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../../theme/tokens';

export default function HomeScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const authLoading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const isOwner = !authLoading && isAuthenticated && user?.role === 'owner';

  const marketplaceQuery = useQuery({
    queryKey: ['native-home-marketplace'],
    queryFn: () => getMarketplaceListings({ limit: 4 }),
  });

  const vehiclesQuery = useQuery({
    queryKey: ['native-home-owner-vehicles', user?.id],
    queryFn: getMyVehicles,
    enabled: isOwner,
  });

  const firstOwnedVehicle = vehiclesQuery.data?.[0] ?? null;
  const publishedOwnedVehicle =
    (vehiclesQuery.data || []).find((vehicle) =>
      String(vehicle.publication_status || vehicle.status || '').toLowerCase() === 'published',
    ) || null;

  const sellerListingQuery = useQuery({
    queryKey: ['native-home-owner-public-listing', publishedOwnedVehicle?.vin],
    queryFn: () => getMarketplaceListingDetail(publishedOwnedVehicle!.vin),
    enabled: Boolean(isOwner && publishedOwnedVehicle?.vin),
    retry: false,
  });

  const threadsQuery = useQuery({
    queryKey: ['native-home-owner-threads', user?.id],
    queryFn: () => listCommunicationThreads(),
    enabled: isOwner,
  });

  const sellerInquiriesQuery = useQuery({
    queryKey: ['native-home-seller-inquiries', user?.id],
    queryFn: getSellerMarketplaceInquiries,
    enabled: Boolean(isOwner && publishedOwnedVehicle),
  });

  const unreadCount = useMemo(
    () =>
      (threadsQuery.data?.threads || []).reduce(
        (sum: number, thread: any) => sum + Number(thread?.unread_count || 0),
        0,
      ),
    [threadsQuery.data],
  );

  const listings = marketplaceQuery.data?.listings || [];
  const newSellerInquiryCount = (sellerInquiriesQuery.data?.inquiries || []).filter(
    (inquiry) => String(inquiry.status || '').toLowerCase() === 'new',
  ).length;

  const submitSearch = () => {
    const query = search.trim();
    router.push((query ? '/market/results?q=' + encodeURIComponent(query) : '/market/results') as never);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingBottom: spacing[10] }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={{
          backgroundColor: theme.brand.hero,
          paddingTop: Math.max(insets.top + spacing[3], spacing[7]),
          paddingHorizontal: spacing[5],
          paddingBottom: spacing[7],
          borderBottomLeftRadius: radius.hero,
          borderBottomRightRadius: radius.hero,
          overflow: 'hidden',
        }}
      >
        <View
          accessible={false}
          style={{
            position: 'absolute',
            width: 210,
            height: 210,
            borderRadius: 105,
            right: -90,
            top: -45,
            backgroundColor: 'rgba(249,115,22,0.10)',
          }}
        />
        <View
          accessible={false}
          style={{
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: 60,
            right: 26,
            top: 104,
            borderWidth: 1,
            borderColor: 'rgba(249,115,22,0.22)',
          }}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CarUpWordmark tone="light" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? 'Open Inbox, ' + unreadCount + ' unread' : 'Open Inbox'}
            onPress={() => router.push('/(tabs)/inbox' as never)}
            style={({ pressed }) => ({
              width: touchTarget.minimum,
              height: touchTarget.minimum,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.brand.heroRaised : 'rgba(255,255,255,0.08)',
              borderWidth: 1,
              borderColor: '#355A78',
            })}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.brand.onHero} />
            {unreadCount > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  minWidth: 19,
                  height: 19,
                  paddingHorizontal: 4,
                  borderRadius: 10,
                  top: -2,
                  right: -2,
                  backgroundColor: theme.brand.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: theme.brand.hero,
                }}
              >
                <Text style={{ fontSize: 10, lineHeight: 12, fontWeight: '900', color: theme.brand.onPrimary }}>
                  {unreadCount > 99 ? '99+' : String(unreadCount)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <Text allowFontScaling style={{ ...typeScale.heroEyebrow, color: theme.brand.primary, marginTop: spacing[8] }}>
          ONE CARUP · ONE VEHICLE THREAD
        </Text>
        <Text allowFontScaling style={{ ...typeScale.heroDisplay, color: theme.brand.onHero, marginTop: spacing[2], maxWidth: 330 }}>
          Buy. Sell. Verify.
        </Text>
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.brand.onHeroMuted, marginTop: spacing[3], maxWidth: 340 }}>
          Keep discovery, evidence, selling and ownership connected around the same vehicle.
        </Text>

        <View style={{ marginTop: spacing[6] }}>
          <BrandSearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search make, model or keyword"
            accessibilityLabel="Search the CarUp Marketplace"
            onSubmitEditing={submitSearch}
          />
        </View>

        <Button
          label="Browse cars"
          onPress={submitSearch}
          icon={<Ionicons name="arrow-forward" size={19} color={theme.brand.onPrimary} />}
          style={{ marginTop: spacing[3], minHeight: 54 }}
        />

        <View style={{ flexDirection: 'row', gap: spacing[3], marginTop: spacing[3] }}>
          <BrandSecondaryAction label="Sell" icon="pricetag-outline" onPress={() => router.push('/sell' as never)} />
          <BrandSecondaryAction label="Verify" icon="shield-checkmark-outline" onPress={() => router.push('/(tabs)/verify' as never)} />
        </View>
      </View>

      <View style={{ paddingHorizontal: spacing[5], paddingTop: spacing[5] }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing[2], paddingBottom: spacing[1] }}
        >
          {['Toyota', 'Nissan', 'Honda'].map((make) => (
            <FilterChip
              key={make}
              label={make}
              onPress={() => router.push(('/market/results?make=' + encodeURIComponent(make)) as never)}
            />
          ))}
        </ScrollView>

        <View style={{ marginTop: spacing[5] }}>
          <SectionHeader title="Fresh on CarUp" actionLabel="See all" onAction={() => router.push('/market/results' as never)} />
        </View>

        {marketplaceQuery.isLoading ? (
          <View
            style={{
              minHeight: 190,
              borderRadius: radius.card,
              backgroundColor: theme.background.surface,
              borderWidth: 1,
              borderColor: theme.border.default,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading Marketplace vehicles" />
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[3] }}>
              Loading current Marketplace vehicles…
            </Text>
          </View>
        ) : marketplaceQuery.isError ? (
          <View
            style={{
              borderRadius: radius.card,
              backgroundColor: theme.background.surface,
              borderWidth: 1,
              borderColor: theme.border.default,
              overflow: 'hidden',
            }}
          >
            <View style={{ height: 4, backgroundColor: theme.brand.primary }} />
            <EmptyState
              icon="cloud-offline-outline"
              title="Marketplace could not refresh"
              body="Check your connection and try again. CarUp will not show invented vehicle data."
              actionLabel="Try again"
              onAction={() => void marketplaceQuery.refetch()}
            />
          </View>
        ) : listings.length === 0 ? (
          <View
            style={{
              borderRadius: radius.card,
              backgroundColor: theme.brand.hero,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.border.brandDark,
            }}
          >
            <View style={{ height: 4, backgroundColor: theme.brand.primary }} />
            <View style={{ padding: spacing[5] }}>
              <Text allowFontScaling style={{ ...typeScale.title, color: theme.brand.onHero }}>
                Marketplace is quiet right now.
              </Text>
              <Text allowFontScaling style={{ ...typeScale.body, color: theme.brand.onHeroMuted, marginTop: spacing[2] }}>
                There are no current published vehicles to show. CarUp keeps this state honest instead of filling the feed with demo cars.
              </Text>
              <Button label="Start selling" onPress={() => router.push('/sell' as never)} style={{ marginTop: spacing[5] }} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Marketplace search"
                onPress={() => router.push('/(tabs)/marketplace' as never)}
                style={{ minHeight: touchTarget.minimum, justifyContent: 'center', alignItems: 'center', marginTop: spacing[2] }}
              >
                <Text allowFontScaling style={{ ...typeScale.button, color: theme.brand.onHero }}>Search Marketplace</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ gap: spacing[4] }}>
            {listings.slice(0, 3).map((item) => (
              <VehicleCard
                key={item.vin}
                item={item}
                onPress={() => router.push(('/vehicle/' + item.vin) as never)}
              />
            ))}
          </View>
        )}

        {isOwner && firstOwnedVehicle ? (
          <View style={{ marginTop: spacing[7] }}>
            <SectionHeader title="Your Garage" actionLabel="Open" onAction={() => router.push('/(tabs)/garage' as never)} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'Open ' + firstOwnedVehicle.make + ' ' + firstOwnedVehicle.model + ' in My Garage'}
              onPress={() => router.push('/(tabs)/garage' as never)}
              style={({ pressed }) => ({
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: theme.border.default,
                backgroundColor: theme.background.surface,
                padding: spacing[5],
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] }}>
                <View style={{ flex: 1 }}>
                  <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>
                    {[firstOwnedVehicle.year, firstOwnedVehicle.make, firstOwnedVehicle.model].filter(Boolean).join(' ')}
                  </Text>
                  <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[2] }}>
                    VIN {firstOwnedVehicle.vin}
                  </Text>
                </View>
                <View
                  style={{
                    width: touchTarget.minimum,
                    height: touchTarget.minimum,
                    borderRadius: 16,
                    backgroundColor: theme.brand.primarySubtle,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="car-sport-outline" size={24} color={theme.brand.onPrimary} />
                </View>
              </View>
              {typeof firstOwnedVehicle.mileage === 'number' ? (
                <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary, marginTop: spacing[3] }}>
                  {firstOwnedVehicle.mileage.toLocaleString()} km
                </Text>
              ) : null}
            </Pressable>
          </View>
        ) : null}

        {isOwner && sellerListingQuery.isSuccess && sellerListingQuery.data ? (
          <View style={{ marginTop: spacing[6] }}>
            <SectionHeader title="Your listing" />
            <VehicleCard
              item={sellerListingQuery.data}
              onPress={() => router.push(('/vehicle/' + sellerListingQuery.data!.vin) as never)}
            />
            {newSellerInquiryCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={'Open Inbox. ' + newSellerInquiryCount + ' new seller inquiries'}
                onPress={() => router.push('/(tabs)/inbox' as never)}
                style={({ pressed }) => ({
                  minHeight: touchTarget.minimum,
                  marginTop: spacing[3],
                  borderRadius: radius.control,
                  borderWidth: 1,
                  borderColor: theme.border.default,
                  backgroundColor: theme.background.surface,
                  paddingHorizontal: spacing[4],
                  paddingVertical: spacing[3],
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>
                  {newSellerInquiryCount} new seller {newSellerInquiryCount === 1 ? 'inquiry' : 'inquiries'}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={theme.brand.primary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find a garage"
          onPress={() => router.push('/find-garage' as never)}
          style={({ pressed }) => ({
            marginTop: spacing[7],
            minHeight: 76,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: theme.border.default,
            backgroundColor: theme.background.surface,
            paddingHorizontal: spacing[4],
            paddingVertical: spacing[3],
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[3],
            opacity: pressed ? 0.78 : 1,
          })}
        >
          <View
            style={{
              width: touchTarget.minimum,
              height: touchTarget.minimum,
              borderRadius: 16,
              backgroundColor: theme.brand.primarySubtle,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="construct-outline" size={23} color={theme.brand.onPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>Find a garage</Text>
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }}>
              Browse service providers available through CarUp.
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color={theme.brand.primary} />
        </Pressable>
      </View>
    </ScrollView>
  );
}
