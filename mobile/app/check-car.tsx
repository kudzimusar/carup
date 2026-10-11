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
          body="This native checkpoint can open a current public CarUp vehicle record by VIN or chassis identifier. Plate and document lookup are not exposed until a governed native lookup contract is available."
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
          body="Opening a CarUp record does not create ownership, registration or verification authority. The vehicle page only shows evidence and decisions the current domain records support."
          tone="info"
        />
      </View>
    </Screen>
  );
}
