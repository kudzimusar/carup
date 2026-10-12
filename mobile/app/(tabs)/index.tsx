import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { VehicleCard } from '../../components/marketplace/VehicleCard';
import {
  EmptyState,
  FilterChip,
  SearchField,
  SectionHeader,
  StatusPill,
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

function QuickAction({
  title,
  subtitle,
  icon,
  onPress,
  disabled,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useNativeTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 132,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surface,
        padding: spacing[4],
        opacity: disabled ? 0.55 : pressed ? 0.78 : 1,
      })}
    >
      <View
        style={{
          width: touchTarget.minimum,
          height: touchTarget.minimum,
          borderRadius: radius.control,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.background.surfaceSunken,
        }}
      >
        <Ionicons name={icon} size={23} color={theme.text.primary} />
      </View>
      <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary, marginTop: spacing[3] }}>
        {title}
      </Text>
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 3 }}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
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
    router.push((query ? `/market/results?q=${encodeURIComponent(query)}` : '/market/results') as never);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[10] }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touchTarget.minimum }}>
        <View>
          <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>CarUp</Text>
          {isAuthenticated && user?.name ? (
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }}>
              {user.name}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Inbox"
          onPress={() => router.push('/(tabs)/inbox' as never)}
          style={{
            width: touchTarget.minimum,
            height: touchTarget.minimum,
            borderRadius: 24,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.background.surface,
            borderWidth: 1,
            borderColor: theme.border.default,
          }}
        >
          <Ionicons name="notifications-outline" size={22} color={theme.text.primary} />
          {unreadCount > 0 ? (
            <View style={{ position: 'absolute', top: 5, right: 5 }}>
              <StatusPill label={unreadCount > 99 ? '99+' : String(unreadCount)} tone="info" />
            </View>
          ) : null}
        </Pressable>
      </View>

      <Text allowFontScaling style={{ ...typeScale.display, color: theme.text.primary, marginTop: spacing[6] }}>
        Find your next car
      </Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[2] }}>
        Search current CarUp Marketplace listings.
      </Text>

      <View style={{ marginTop: spacing[5] }}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search make, model or keyword"
          accessibilityLabel="Search the CarUp Marketplace"
          onSubmitEditing={submitSearch}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing[2], paddingTop: spacing[3], paddingBottom: spacing[1] }}
      >
        {['Toyota', 'Nissan', 'Honda'].map((make) => (
          <FilterChip
            key={make}
            label={make}
            onPress={() => router.push(`/market/results?make=${encodeURIComponent(make)}` as never)}
          />
        ))}
      </ScrollView>

      <View style={{ marginTop: spacing[6] }}>
        <SectionHeader title="Fresh on CarUp" actionLabel="See all" onAction={() => router.push('/market/results' as never)} />
      </View>

      {marketplaceQuery.isLoading ? (
        <View style={{ paddingVertical: spacing[8], alignItems: 'center' }}>
          <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading Marketplace vehicles" />
        </View>
      ) : marketplaceQuery.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Marketplace could not refresh"
          body="Check your connection and try again. CarUp will not show invented vehicle data."
          actionLabel="Try again"
          onAction={() => void marketplaceQuery.refetch()}
        />
      ) : listings.length === 0 ? (
        <EmptyState
          icon="car-outline"
          title="No published vehicles right now"
          body="There are no current Marketplace listings to show. If you're selling, you can start a listing."
          actionLabel="Start selling"
          onAction={() => router.push('/sell' as never)}
          secondaryLabel="Search Marketplace"
          onSecondary={() => router.push('/(tabs)/marketplace' as never)}
        />
      ) : (
        <View style={{ gap: spacing[4] }}>
          {listings.slice(0, 3).map((item) => (
            <VehicleCard
              key={item.vin}
              item={item}
              onPress={() => router.push(`/vehicle/${item.vin}` as never)}
            />
          ))}
        </View>
      )}

      {isOwner && firstOwnedVehicle ? (
        <View style={{ marginTop: spacing[7] }}>
          <SectionHeader title="Your Garage" actionLabel="Open" onAction={() => router.push('/(tabs)/garage' as never)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${firstOwnedVehicle.make} ${firstOwnedVehicle.model} in My Garage`}
            onPress={() => router.push('/(tabs)/garage' as never)}
            style={({ pressed }) => ({
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: theme.border.default,
              backgroundColor: theme.background.surface,
              padding: spacing[4],
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>
              {[firstOwnedVehicle.year, firstOwnedVehicle.make, firstOwnedVehicle.model].filter(Boolean).join(' ')}
            </Text>
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[2] }}>
              VIN {firstOwnedVehicle.vin}
            </Text>
            {typeof firstOwnedVehicle.mileage === 'number' ? (
              <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary, marginTop: spacing[2] }}>
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
            onPress={() => router.push(`/vehicle/${sellerListingQuery.data!.vin}` as never)}
          />
          {newSellerInquiryCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open Inbox. ${newSellerInquiryCount} new seller inquir${newSellerInquiryCount === 1 ? 'y' : 'ies'}`}
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
                {newSellerInquiryCount} new seller inquir{newSellerInquiryCount === 1 ? 'y' : 'ies'}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: spacing[7] }}>
        <SectionHeader title="What would you like to do?" />
        <View style={{ flexDirection: 'row', gap: spacing[3] }}>
          <QuickAction
            title="Sell a car"
            subtitle="Start with your vehicle"
            icon="pricetag-outline"
            onPress={() => router.push('/sell' as never)}
          />
          <QuickAction
            title="Check a car"
            subtitle="Use a vehicle identifier"
            icon="shield-checkmark-outline"
            onPress={() => router.push('/check-car' as never)}
          />
        </View>
        <View style={{ marginTop: spacing[3] }}>
          <QuickAction
            title="Find a garage"
            subtitle="Browse service providers"
            icon="construct-outline"
            onPress={() => router.push('/find-garage' as never)}
          />
        </View>
      </View>
    </ScrollView>
  );
}
