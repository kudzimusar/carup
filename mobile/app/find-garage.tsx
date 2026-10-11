import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, Notice } from '../components/ui/NativePrimitives';
import { Screen } from '../components/ui/NativePrimitives';
import { getMarketplaceServices } from '../utils/marketplaceApi';
import { spacing } from '../theme/tokens';

export default function FindGarageScreen() {
  const router = useRouter();
  const query = useQuery({
    queryKey: ['native-service-directory'],
    queryFn: () => getMarketplaceServices(),
  });

  return (
    <Screen>
      <View style={{ paddingTop: spacing[6] }}>
        {query.isLoading ? (
          <Notice title="Loading garages" body="Checking the current CarUp service directory." tone="info" />
        ) : query.isError ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Garage directory is unavailable"
            body="CarUp could not load the current governed service directory."
            actionLabel="Try again"
            onAction={() => void query.refetch()}
            secondaryLabel="Back"
            onSecondary={() => router.back()}
          />
        ) : (query.data?.listings || []).length === 0 ? (
          <EmptyState
            icon="construct-outline"
            title="No garages are published yet"
            body="The governed service directory is live, but there are no current provider listings to show. CarUp will not substitute demo garages."
            actionLabel="Back to CarUp"
            onAction={() => router.back()}
          />
        ) : (
          <EmptyState
            icon="construct-outline"
            title="Garage directory"
            body={`${query.data?.total ?? 0} governed service provider listing${(query.data?.total ?? 0) === 1 ? '' : 's'} are available. Detailed native provider cards remain a later Service Network surface.`}
            actionLabel="Back to CarUp"
            onAction={() => router.back()}
          />
        )}
      </View>
    </Screen>
  );
}
