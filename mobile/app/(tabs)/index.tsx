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

¶»§q«^