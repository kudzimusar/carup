import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  Notice,
  SectionHeader,
  StatusPill,
} from '../components/ui/NativePrimitives';
import { getMarketplaceServices } from '../utils/marketplaceApi';
import { radius, spacing, typeScale, useNativeTheme } from '../theme/tokens';

export default function FindGarageScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const query = useQuery({
    queryKey: ['native-service-directory'],
    queryFn: () => getMarketplaceServices(),
  });

  const listings = query.data?.listings || [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
    >
      <Button label="Back" variant="tertiary" onPress={() => router.back()} />
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[4] }}>
        Find a garage
      </Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[2] }}>
        Browse service providers currently published in CarUp.
      </Text>

      {query.isLoading ? (
        <View style={{ paddingVertical: spacing[10], alignItems: 'center' }}>
          <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading garages" />
        </View>
      ) : query.isError ? (
        <View style={{ marginTop: spacing[6] }}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Garage directory is unavailable"
            body="CarUp could not load the current service directory. Check your connection and try again."
            actionLabel="Try again"
            onAction={() => void query.refetch()}
          />
        </View>
      ) : listings.length === 0 ? (
        <View style={{ marginTop: spacing[6] }}>
          <EmptyState
            icon="construct-outline"
            title="No garages are published yet"
            body="There are no current service-provider listings to show. CarUp will not substitute demo garages."
          />
        </View>
      ) : (
        <View style={{ marginTop: spacing[6] }}>
          <SectionHeader title="Service providers" />
          <View style={{ gap: spacing[3] }}>
            {listings.map((listing, index) => {
              const name = typeof listing.name === 'string' && listing.name.trim()
                ? listing.name.trim()
                : 'Service provider';
              const location = typeof listing.location === 'string' && listing.location.trim()
                ? listing.location.trim()
                : null;
              const categories = Array.isArray(listing.service_categories)
                ? listing.service_categories.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
                : [];

              return (
                <View
                  key={String(listing.slug || `${name}-${index}`)}
                  style={{
                    borderRadius: radius.card,
                    borderWidth: 1,
                    borderColor: theme.border.default,
                    backgroundColor: theme.background.surface,
                    padding: spacing[4],
                  }}
                >
                  <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>{name}</Text>
                  {location ? (
                    <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
                      {location}
                    </Text>
                  ) : null}
                  {categories.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] }}>
                      {categories.slice(0, 4).map((category) => (
                        <StatusPill key={category} label={category.replace(/[_-]+/g, ' ')} />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          <View style={{ marginTop: spacing[5] }}>
            <Notice
              title="Provider details"
              body="This directory shows the service information CarUp currently publishes. Booking and professional workspace tools remain separate experiences."
              tone="info"
            />
          </View>
        </View>
      )}
    </ScrollView>
  );
}
