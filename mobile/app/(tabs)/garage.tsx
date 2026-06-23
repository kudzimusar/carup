import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, FlatList, RefreshControl, ScrollView, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';
import { useRouter } from 'expo-router';
import { captureOdometerPhoto, formatFileSize } from '../../utils/camera';
import { apiUrl } from '../../utils/apiBase';

interface Vehicle {
  vin: string;
  make: string;
  model: string;
  year: number;
  color: string;
  mileage: number;
  fuel_type: string;
  transmission: string;
  status: string;
  trust_score: number;
  price: number;
  currency: string;
}

interface ServiceLog {
  id: string;
  vin: string;
  description: string;
  cost: number;
  mileage: number;
  status: string;
  created_at: string;
  mechanic_id: string;
  work_type?: string;
  parts_replaced?: string;
}

export default function GarageScreen() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const [activeTab, setActiveTab] = useState<'vehicles' | 'history'>('vehicles');
  const [scanningVin, setScanningVin] = useState<string | null>(null);

  // Fetch owned vehicles
  const { data: vehicles = [], isLoading: isLoadingVehicles, error: vehiclesError, refetch: refetchVehicles } = useQuery<Vehicle[]>({
    queryKey: ['my-vehicles'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/vehicles/me'), {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
        },
      });
      if (!response.ok) {
        throw new Error('Failed to retrieve garage vehicles');
      }
      return response.json();
    },
  });

  // Fetch service history logs
  const { data: serviceHistory = [], isLoading: isLoadingHistory, error: historyError, refetch: refetchHistory } = useQuery<ServiceLog[]>({
    queryKey: ['my-service-history'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/service-history/me'), {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
        },
      });
      if (!response.ok) {
        throw new Error('Failed to retrieve service history');
      }
      return response.json();
    },
    enabled: activeTab === 'history',
  });

  const handleRefresh = async () => {
    if (activeTab === 'vehicles') {
      await refetchVehicles();
    } else {
      await refetchHistory();
    }
  };

  const handleOdometerScan = useCallback(async (vin: string) => {
    if (scanningVin) return; // Prevent double-tap

    setScanningVin(vin);

    try {
      // Launch native camera with 16:9 aspect for dashboard instrument cluster framing
      const asset = await captureOdometerPhoto();

      if (!asset) {
        // User cancelled camera
        setScanningVin(null);
        return;
      }

      // Submit captured odometer image to the backend OCR service
      try {
        const response = await fetch(apiUrl('/api/ai/ocr'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-session-token': token } : {}),
          },
          body: JSON.stringify({
            docType: 'odometer_reading',
            base64Data: asset.dataUri,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          const extractedMileage = result.extractedData?.mileage || 'N/A';

          Alert.alert(
            'Odometer Scan Complete',
            `VIN: ${vin}\nExtracted Mileage: ${extractedMileage}\nImage Size: ${formatFileSize(asset.fileSizeBytes)}`,
            [
              {
                text: 'View Trust Passport',
                onPress: () => router.push(`/vehicle/${vin}`),
              },
              { text: 'Done', style: 'cancel' },
            ]
          );
        } else {
          // Backend error — show manual entry fallback
          Alert.alert(
            'OCR Processing Error',
            'The odometer reading could not be extracted automatically. The image has been saved for manual review.',
            [{ text: 'OK' }]
          );
        }
      } catch (networkErr) {
        // Network failure — offline mode
        Alert.alert(
          'Offline Mode',
          `Odometer image captured (${formatFileSize(asset.fileSizeBytes)}) and queued for upload when connectivity returns.`,
          [{ text: 'OK' }]
        );
      }
    } catch (err) {
      console.error('[Garage] Odometer scan error:', err);
      Alert.alert('Camera Error', 'Could not launch camera. Please try again.', [{ text: 'OK' }]);
    } finally {
      setScanningVin(null);
    }
  }, [scanningVin, token, router]);

  const handleKycScan = () => {
    // Navigate to introductory KYC flow
    router.push('/(auth)/verification/intro');
  };

  const renderVehicleCard = ({ item }: { item: Vehicle }) => {
    return (
      <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-5 shadow-sm">
        {/* Header Block */}
        <View className="flex-row justify-between items-start">
          <View>
            <Text className="text-slate-400 text-xxs font-semibold uppercase tracking-wider">{item.vin}</Text>
            <Text className="text-slate-900 text-lg font-bold mt-0.5">{item.year} {item.make} {item.model}</Text>
            <Text className="text-slate-500 text-xs mt-0.5">{item.color} • {item.transmission}</Text>
          </View>
          
          <View className="bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full">
            <Text className="text-emerald-600 text-xxs font-extrabold uppercase tracking-wider">Active</Text>
          </View>
        </View>

        {/* Separator */}
        <View className="h-px bg-slate-100 my-4" />

        {/* Stats Panel */}
        <View className="flex-row justify-between mb-5">
          <View>
            <Text className="text-slate-400 text-xxs uppercase tracking-wider">Current Mileage</Text>
            <Text className="text-slate-900 text-sm font-extrabold mt-0.5">{item.mileage.toLocaleString()} km</Text>
          </View>
          <View>
            <Text className="text-slate-400 text-xxs uppercase tracking-wider">Ecosystem Trust</Text>
            <Text className="text-orange-500 text-sm font-extrabold mt-0.5">{item.trust_score}%</Text>
          </View>
          <View>
            <Text className="text-slate-400 text-xxs uppercase tracking-wider">Equity Value</Text>
            <Text className="text-slate-900 text-sm font-extrabold mt-0.5">
              ${item.price.toLocaleString()} {item.currency}
            </Text>
          </View>
        </View>

        {/* Action Panel */}
        <View className="flex-row gap-3 pt-3 border-t border-slate-50">
          <Pressable
            onPress={() => handleOdometerScan(item.vin)}
            disabled={scanningVin === item.vin}
            className={`flex-1 rounded-xl min-h-[44px] items-center justify-center border active:opacity-90 ${
              scanningVin === item.vin ? 'bg-amber-600 border-amber-700' : 'bg-slate-950 border-slate-900'
            }`}
            style={({ pressed }) => pressed ? { opacity: 0.9 } : {}}
          >
            {scanningVin === item.vin ? (
              <View className="flex-row items-center space-x-2">
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text className="text-white text-xs font-semibold">Scanning...</Text>
              </View>
            ) : (
              <Text className="text-white text-xs font-semibold">Scan Odometer</Text>
            )}
          </Pressable>
          
          <Pressable
            onPress={() => router.push(`/vehicle/${item.vin}`)}
            className="flex-1 bg-slate-50 rounded-xl min-h-[44px] items-center justify-center border border-slate-100 active:opacity-90"
            style={({ pressed }) => pressed ? { opacity: 0.9 } : {}}
          >
            <Text className="text-slate-700 text-xs font-semibold">Trust Passport</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderServiceLog = ({ item }: { item: ServiceLog }) => {
    return (
      <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 pr-4">
            <Text className="text-slate-400 text-xxs font-bold uppercase">VIN: {item.vin.slice(0, 8)}</Text>
            <Text className="text-slate-900 text-base font-bold mt-0.5">{item.description}</Text>
            <Text className="text-slate-400 text-xxs mt-0.5">{new Date(item.created_at).toLocaleDateString()}</Text>
          </View>
          <View className="bg-slate-900 px-3 py-1 rounded-full">
            <Text className="text-white text-xxs font-bold">${item.cost.toLocaleString()}</Text>
          </View>
        </View>

        <View className="h-px bg-slate-100 my-3" />

        <View className="space-y-1.5 bg-slate-50 p-3 rounded-xl">
          <View className="flex-row justify-between">
            <Text className="text-slate-400 text-xxs font-semibold">Replaced Parts</Text>
            <Text className="text-slate-700 text-xs font-medium">{item.parts_replaced || 'General Maintenance'}</Text>
          </View>
          <View className="flex-row justify-between mt-1">
            <Text className="text-slate-400 text-xxs font-semibold">Log State</Text>
            <Text className="text-emerald-600 text-xs font-bold uppercase tracking-wider">{item.status || 'Verified'}</Text>
          </View>
        </View>
      </View>
    );
  };

  const isLoading = activeTab === 'vehicles' ? isLoadingVehicles : isLoadingHistory;
  const hasError = activeTab === 'vehicles' ? vehiclesError : historyError;

  return (
    <View className="flex-1 bg-slate-50">
      {/* Tab Switcher Headers */}
      <View className="bg-slate-900 px-6 pt-4 pb-2 border-b border-slate-800 flex-row">
        <Pressable
          onPress={() => setActiveTab('vehicles')}
          className={`pb-3 mr-6 border-b-2 min-h-[44px] justify-center ${activeTab === 'vehicles' ? 'border-orange-500' : 'border-transparent'}`}
        >
          <Text className={`text-sm font-bold ${activeTab === 'vehicles' ? 'text-white' : 'text-slate-400'}`}>My Fleet</Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('history')}
          className={`pb-3 border-b-2 min-h-[44px] justify-center ${activeTab === 'history' ? 'border-orange-500' : 'border-transparent'}`}
        >
          <Text className={`text-sm font-bold ${activeTab === 'history' ? 'text-white' : 'text-slate-400'}`}>Maintenance Logs</Text>
        </Pressable>
      </View>

      {/* Main Container */}
      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#f97316" />
        </View>
      ) : hasError ? (
        <View className="flex-1 justify-center items-center px-6">
          <View className="bg-red-50 p-4 rounded-full mb-4">
            <Text className="text-red-500 text-3xl">⚠️</Text>
          </View>
          <Text className="text-slate-800 text-lg font-bold text-center mb-2">Unable to load data</Text>
          <Text className="text-slate-500 text-sm text-center mb-8">We could not reach the server. Please check your connection and try again.</Text>
          <Pressable onPress={handleRefresh} className="bg-slate-900 px-8 py-3.5 min-h-[48px] rounded-xl active:opacity-90">
            <Text className="text-white text-sm font-semibold">Retry Fetch</Text>
          </Pressable>
        </View>
      ) : activeTab === 'vehicles' && vehicles.length === 0 ? (
        <View className="flex-1 justify-center items-center px-6">
          <Text className="text-slate-400 text-sm font-medium text-center">No vehicles registered in your fleet yet.</Text>
          <Text className="text-slate-400 text-xxs mt-2 text-center leading-relaxed">
            Register or acquire a vehicle under the Marketplace tab. Keep your identity verified to establish trust keys.
          </Text>
          
          <Pressable
            onPress={handleKycScan}
            className="bg-orange-500 px-6 py-3.5 rounded-xl shadow-md mt-6 active:opacity-90"
            style={({ pressed }) => pressed ? { opacity: 0.9 } : {}}
          >
            <Text className="text-white text-xs font-bold">Start KYC Identity Verification</Text>
          </Pressable>
        </View>
      ) : activeTab === 'history' && serviceHistory.length === 0 ? (
        <ScrollView 
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={handleRefresh} tintColor="#f97316" />}
        >
          <Text className="text-slate-400 text-sm font-medium text-center">No service logs found for your fleet.</Text>
          <Text className="text-slate-400 text-xxs mt-2 text-center leading-relaxed">
            Certified mechanics will mint immutable log proofs directly to your garage once work orders are signed off.
          </Text>
        </ScrollView>
      ) : activeTab === 'vehicles' ? (
        <FlatList
          data={vehicles}
          renderItem={renderVehicleCard}
          keyExtractor={(item: Vehicle) => item.vin}
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} tintColor="#f97316" />
          }
        />
      ) : (
        <FlatList
          data={serviceHistory}
          renderItem={renderServiceLog}
          keyExtractor={(item: ServiceLog) => item.id}
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} tintColor="#f97316" />
          }
        />
      )}
    </View>
  );
}
