import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, Notice, SectionHeader, StatusPill } from '../../components/ui/NativePrimitives';
import { getMyVehicles } from '../../utils/ownerGarageApi';
import { useAuthStore } from '../../store/authStore';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';

export default function SellStartScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);

  const vehiclesQuery = useQuery({
    queryKey: ['sell-start-owned-vehicles', user?.id],
    queryFn: getMyVehicles,
    enabled: !loading && isAuthenticated && user?.role === 'owner',
  });

  if (!loading && !isAuthenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="pricetag-outline"
          title="Start selling"
          body="Sign in before CarUp can connect a listing to your identity and seller authority."
          actionLabel="Sign in"
          onAction={() => router.push('/(auth)/login' as never)}
          secondaryLabel="Back"
          onSecondary={() => router.back()}
        />
      </View>
    );
  }

  if (!loading && user?.role !== 'owner') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="pricetag-outline"
          title="Selling is not available in this workspace"
          body="CarUp only exposes seller actions that your current identity and workspace can use."
          actionLabel="Back to Account"
          onAction={() => router.replace('/(tabs)/account' as never)}
        />
      </View>
    );
  }

  const continueNew = () => {
    const value = identifier.trim().toUpperCase();
    if (!value) {
      setError('Enter the VIN or chassis identifier for the vehicle.');
      return;
    }
    if (!/^[A-Z0-9-]{12,17}$/.test(value)) {
      setError('Use 12 to 17 letters, numbers or hyphens.');
      return;
    }
    setError(null);
    router.push({ pathname: '/sell/details' as never, params: { vin: value } } as never);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
      keyboardShouldPersistTaps="handled"
    >
      <Button label="Back" variant="tertiary" onPress={() => router.back()} />
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[4] }}>
        Sell your car with confidence
      </Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[2] }}>
        Start with the vehicle identity. CarUp will save a draft before anything can be published.
      </Text>

      <View style={{ marginTop: spacing[6], gap: spacing[3] }}>
        <Field
          label="VIN or chassis identifier"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="characters"
          autoCorrect={false}
          error={error}
          helper="This identifies the vehicle; it does not prove ownership by itself."
        />
        <Button label="Continue" onPress={continueNew} icon={<Ionicons name="arrow-forward" size={20} color={theme.brand.onPrimary} />} />
      </View>

      <View style={{ marginTop: spacing[6] }}>
        <Notice
          title="Before publication"
          body="Seller authority, required vehicle facts and any required evidence remain governed by the existing CarUp process. Starting a draft does not publish the vehicle."
          tone="info"
        />
      </View>

      {(vehiclesQuery.data || []).length > 0 ? (
        <View style={{ marginTop: spacing[7] }}>
          <SectionHeader title="Continue with one of your vehicles" />
          <View style={{ gap: spacing[3] }}>
            {(vehiclesQuery.data || []).map((vehicle) => (
              <Pressable
                key={vehicle.vin}
                accessibilityRole="button"
                accessibilityLabel={`Continue selling ${vehicle.make} ${vehicle.model}`}
                onPress={() => router.push({ pathname: '/sell/details' as never, params: { vin: vehicle.vin, resume: 'true' } } as never)}
                style={({ pressed }) => ({
                  borderRadius: radius.card,
                  borderWidth: 1,
                  borderColor: theme.border.default,
                  backgroundColor: theme.background.surface,
                  padding: spacing[4],
                  opacity: pressed ? 0.78 : 1,
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] }}>
                  <View style={{ flex: 1 }}>
                    <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>
                      {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
                    </Text>
                    <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 3 }}>
                      {vehicle.vin}
                    </Text>
                  </View>
                  {vehicle.status ? <StatusPill label={vehicle.status.replace(/[_-]+/g, ' ')} /> : null}
                  <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
