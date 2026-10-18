import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CarUpWordmark } from '../components/brand/CarUpBrand';
import { Button, Field, Notice } from '../components/ui/NativePrimitives';
import { getMarketplaceListingDetail, MarketplaceApiError } from '../utils/marketplaceApi';
import { radius, spacing, touchTarget, typeScale, useNativeTheme } from '../theme/tokens';

export function CheckCarExperience({ showBack = true }: { showBack?: boolean }) {
  const router = useRouter();
  const theme = useNativeTheme();
  const insets = useSafeAreaInsets();
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
      router.replace(('/vehicle/' + vehicle.vin) as never);
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
            width: 180,
            height: 180,
            borderRadius: 90,
            right: -72,
            top: 52,
            borderWidth: 1,
            borderColor: 'rgba(249,115,22,0.24)',
          }}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CarUpWordmark tone="light" compact />
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              android_ripple={{ color: theme.brand.heroRaised, borderless: true }}
              style={{
                width: touchTarget.minimum,
                height: touchTarget.minimum,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: '#355A78',
                backgroundColor: 'rgba(255,255,255,0.07)',
                overflow: 'hidden',
              }}
            >
              <Ionicons name="close" size={23} color={theme.brand.onHero} />
            </Pressable>
          ) : (
            <View
              style={{
                width: touchTarget.minimum,
                height: touchTarget.minimum,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(249,115,22,0.12)',
              }}
            >
              <Ionicons name="shield-checkmark" size={24} color={theme.brand.primary} />
            </View>
          )}
        </View>

        <Text allowFontScaling style={{ ...typeScale.heroEyebrow, color: theme.brand.primary, marginTop: spacing[7] }}>
          CHECK / VERIFY
        </Text>
        <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.brand.onHero, marginTop: spacing[2], maxWidth: 330 }}>
          Know what CarUp actually has.
        </Text>
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.brand.onHeroMuted, marginTop: spacing[3], maxWidth: 345 }}>
          Enter a VIN or chassis identifier to open the current CarUp vehicle record and its available evidence.
        </Text>
      </View>

      <View style={{ paddingHorizontal: spacing[5], paddingTop: spacing[5] }}>
        <View
          style={{
            borderRadius: radius.card,
            backgroundColor: theme.background.surface,
            borderWidth: 1,
            borderColor: theme.border.default,
            padding: spacing[5],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[5] }}>
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
            <View style={{ flex: 1 }}>
              <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary }}>Check a vehicle record</Text>
              <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }}>
                Marketplace search and vehicle checking stay separate.
              </Text>
            </View>
          </View>

          <Field
            label="VIN or chassis identifier"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="characters"
            autoCorrect={false}
            error={error}
            helper="Use the identifier exactly as it appears on the vehicle or source document."
          />

          <Button
            label="Check CarUp record"
            onPress={() => void check()}
            loading={checking}
            icon={<Ionicons name="shield-checkmark" size={19} color={theme.brand.onPrimary} />}
            style={{
              marginTop: spacing[5],
              minHeight: 54,
              backgroundColor: theme.brand.primary,
              borderColor: theme.brand.primary,
            }}
          />
        </View>

        <View
          style={{
            marginTop: spacing[5],
            borderRadius: radius.card,
            backgroundColor: theme.brand.hero,
            padding: spacing[5],
            borderWidth: 1,
            borderColor: theme.border.brandDark,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
            <Ionicons name="information-circle" size={23} color={theme.brand.primary} />
            <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.brand.onHero }}>What this check means</Text>
          </View>
          <Text allowFontScaling style={{ ...typeScale.body, color: theme.brand.onHeroMuted, marginTop: spacing[3] }}>
            Opening a CarUp record does not prove ownership or government registration. The vehicle page shows only the evidence and status CarUp currently has for that vehicle.
          </Text>
        </View>

        <View style={{ marginTop: spacing[4] }}>
          <Notice
            title="Evidence-led by design"
            body="Plate and document scanning appear only when the app has a real governed capture path. CarUp does not imply a registry check that did not happen."
            tone="info"
          />
        </View>

        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={{ minHeight: touchTarget.minimum, alignItems: 'center', justifyContent: 'center', marginTop: spacing[3] }}
          >
            <Text allowFontScaling style={{ ...typeScale.button, color: theme.text.secondary }}>Back</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

export default function CheckCarScreen() {
  return <CheckCarExperience />;
}
