import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, FilterChip, Notice } from '../../components/ui/NativePrimitives';
import { getMyVehicles } from '../../utils/ownerGarageApi';
import { createSellerDraft, updateSellerDraft } from '../../utils/sellerApi';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';

type Currency = 'USD' | 'ZiG';

export default function SellDetailsScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ vin?: string; resume?: string }>();
  const vin = String(params.vin || '').trim().toUpperCase();
  const resume = params.resume === 'true';

  const vehiclesQuery = useQuery({
    queryKey: ['sell-details-owned-vehicles'],
    queryFn: getMyVehicles,
    enabled: resume,
  });
  const ownedVehicle = useMemo(
    () => (vehiclesQuery.data || []).find((vehicle) => vehicle.vin === vin) || null,
    [vehiclesQuery.data, vin],
  );

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [mileage, setMileage] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<Currency | null>(null);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ownedVehicle) return;
    setMake(ownedVehicle.make || '');
    setModel(ownedVehicle.model || '');
    setYear(ownedVehicle.year ? String(ownedVehicle.year) : '');
    setMileage(typeof ownedVehicle.mileage === 'number' ? String(ownedVehicle.mileage) : '');
    setPrice(typeof ownedVehicle.price === 'number' ? String(ownedVehicle.price) : '');
    if (ownedVehicle.currency === 'USD' || ownedVehicle.currency === 'ZiG') {
      setCurrency(ownedVehicle.currency);
    }
  }, [ownedVehicle]);

  const save = async () => {
    const numericPrice = Number(price);
    const numericMileage = Number(mileage);
    const numericYear = year.trim() ? Number(year) : null;

    if (!vin) return setError('Vehicle identifier is missing.');
    if (!price.trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      return setError('Enter a price greater than zero.');
    }
    if (!currency) return setError('Choose the currency you are actually quoting.');

    if (!resume) {
      if (!make.trim() || !model.trim()) return setError('Make and model are required.');
      if (!mileage.trim() || !Number.isFinite(numericMileage) || numericMileage < 0) {
        return setError('Enter the current odometer reading.');
      }
      if (numericYear !== null && (!Number.isInteger(numericYear) || numericYear < 1900 || numericYear > new Date().getFullYear() + 1)) {
        return setError('Enter a valid vehicle year.');
      }
    }

    setSaving(true);
    setError(null);
    try {
      if (resume) {
        await updateSellerDraft(vin, {
          price: numericPrice,
          currency,
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          location_visibility: 'withheld',
          public_seller_display_enabled: false,
        });
      } else {
        await createSellerDraft({
          vin,
          make: make.trim(),
          model: model.trim(),
          year: numericYear,
          mileage: numericMileage,
          price: numericPrice,
          currency,
          location: location.trim() || undefined,
          description: description.trim() || undefined,
        });
      }
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'CarUp could not save this draft.');
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center', padding: spacing[5] }}>
        <Notice
          title="Draft saved"
          body="Your seller draft is saved. It is not published. Seller authority and publication requirements still apply."
          tone="success"
        />
        <View style={{ marginTop: spacing[5], gap: spacing[2] }}>
          <Button label="Open My Garage" onPress={() => router.replace('/(tabs)/garage' as never)} />
          <Button label="Back to Account" variant="secondary" onPress={() => router.replace('/(tabs)/account' as never)} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ padding: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
      keyboardShouldPersistTaps="handled"
    >
      <Button label="Back" variant="tertiary" onPress={() => router.back()} />
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[4] }}>
        {resume ? 'Continue your listing' : 'Vehicle details'}
      </Text>
      <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[2] }}>
        {vin}
      </Text>

      <View style={{ marginTop: spacing[6], gap: spacing[4] }}>
        {!resume ? (
          <>
            <Field label="Make" value={make} onChangeText={setMake} autoCapitalize="words" />
            <Field label="Model" value={model} onChangeText={setModel} autoCapitalize="words" />
            <Field label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" />
            <Field
              label="Current odometer"
              value={mileage}
              onChangeText={setMileage}
              keyboardType="number-pad"
              helper="Enter the reading shown by the vehicle. CarUp does not assume 0 km when it is unknown."
            />
          </>
        ) : (
          <Notice
            title="Existing vehicle"
            body="CarUp is editing the listing draft attached to this vehicle. Vehicle identity is not recreated."
            tone="info"
          />
        )}

        <Field label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          <FilterChip label="USD" selected={currency === 'USD'} onPress={() => setCurrency('USD')} />
          <FilterChip label="ZiG" selected={currency === 'ZiG'} onPress={() => setCurrency('ZiG')} />
        </View>
        <Field label="Location (optional)" value={location} onChangeText={setLocation} autoCapitalize="words" />
        <Field
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          multiline
          style={{ minHeight: 112, textAlignVertical: 'top' }}
        />

        {error ? <Notice title="Check this listing" body={error} tone="danger" /> : null}

        <Button label="Save draft" onPress={() => void save()} loading={saving} />
        <Notice
          title="Nothing is published yet"
          body="Saving records your draft. Publication is a separate step after CarUp checks the required facts, evidence and your eligibility to sell."
          tone="info"
        />
      </View>
    </ScrollView>
  );
}
