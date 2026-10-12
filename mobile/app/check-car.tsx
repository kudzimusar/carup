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
      router.replace(`/vehicle/${vehicle.vin}` as never);
    } catch (cause) {
      if (cause instanceof MarketplaceApiError && cause.statusCode === 404) {
        setError('CarUp has no public Marketplace record for that identifier. This result is not a government registry ¶»§q«^