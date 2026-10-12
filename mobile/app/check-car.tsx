import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, EmptyState, Field, Notice } from '../components/ui/NativePrimitives';
import { Screen } from '../components/ui/NativePrimitives';
import { getMarketplaceListingDetail, MarketplaceApiError } from '../utils/marketplaceApi';
import { spacing } from '../theme/tokens';

export default function CheckCarScreen() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    const value = identifier.trim().toUpperCase();
    if (!value) {
      setError('Enter a VIN or chassis identifier.');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const vehicle = await getMarketplaceListingDetail(value);
      router.replace(`/vehicle/${vehicle.vin}` as never);
    } catch (cause) {
      if (cause instanceof MarketplaceApiError && cause.statusCode === 404) {
        setError('CarUp has no public Marketplace record for that identifier. This result is not a government registry check.');
      } else {
        setError('CarUp could not check the current public vehicle record. Check your connection and try again.');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: spacing[6], gap: spacing[5] }}>
        <EmptyState
          icon="shield-checkmark-outline"
          title="Check a car"
          body="Enter a VIN or chassis identifier to open the vehicle information CarUp can currently show. Plate and document scanning will appear here only when those checks are available in the app."
        />
        <Field
          label="VIN or chassis identifier"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="characters"
          autoCorrect={false}
          error={error}
          helper="Vehicle verification is separate from Marketplace keyword search."
        />
        <Button label="Check CarUp record" onPress={() => void check()} loading={checking} />
        <Button label="Back" variant="tertiary" onPress={() => router.back()} />
        <Notice
          title="What this check means"
          body="Opening a CarUp record does not prove ownership or government registration. The vehicle page shows only the evidence and status CarUp currently has for that vehicle."
          tone="info"
        />
      </View>
    </Screen>
  );
}
