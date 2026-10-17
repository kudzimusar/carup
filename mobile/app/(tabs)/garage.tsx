import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, FlatList, RefreshControl, ScrollView, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';
import { useRouter } from 'expo-router';
import { captureOdometerPhoto } from '../../utils/camera';
import { apiUrl, resolveApiBaseUrl } from '../../utils/apiBase';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import { useUploadQueueStore } from '../../store/uploadQueueStore';
import { drainUploadQueue, makeHttpUploader } from '../../utils/uploadQueueDrain';
import type { OwnerServiceHistoryEntry } from '@shared/types';
import { toServiceLogView } from '../../utils/serviceHistoryView';
import {
  ODOMETER_NATIVE_EVIDENCE_TYPE,
  odometerOutcomeMessage,
  requestOdometerReading,
  type OdometerReadingOutcome,
} from '../../utils/odometerCapture';

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

// OC-5D (P6): GET /api/service-history/me, held to shared/contracts/owner-service-history.v1.contract.json.
type ServiceLog = OwnerServiceHistoryEntry;

function GarageScreenInner() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const enqueueUpload = useUploadQueueStore((state) => state.enqueue);
  const hydrateQueue = useUploadQueueStore((state) => state.hydrate);
  const [activeTab, setActiveTab] = useState<'vehicles' | 'history'>('vehicles');
  const [scanningVin, setScanningVin] = useState<string | null>(null);

  // Restore any durable offline queue on mount, then attempt to drain it (best-effort). A queued
  // odometer capture that uploads now also gets its governed OCR read (OC-4C).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateQueue();
      if (cancelled || !user?.id) return;
      try {
        const base = resolveApiBaseUrl();
        await drainUploadQueue({
          resolvePayload: async (item) => item.localFileRef || null,
          uploadOne: makeHttpUploader(base, token),
          onUploaded: async (item, evidenceId) => {
            if (item.evidenceType === ODOMETER_NATIVE_EVIDENCE_TYPE) await requestOdometerReading(base, token, item.vin, evidenceId);
          },
        });
      } catch { /* offline / unconfigured — items remain queued for the next attempt */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrateQueue]);

  // Fetch owned vehicles
  const { data: vehicles = [], isLoading: isLoadingVehicles, error: vehiclesError, refetch: refetchVehicles } = useQuery<Vehicle[]>({
    queryKey: ['my-vehicles'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/vehicles/me'), {
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
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
          'ngrok-skip-browser-warning': 'true',
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

  // OC-4C: capture → durable queue FIRST → idempotent evidence upload → governed vehicle-evidence OCR
  // (Document Intelligence → Qwen) → a candidate reading pending review. It used to POST the photo to the
  // retired /api/ai/ocr (a 410) and then tell the owner the image had been "saved for manual review",
  // which it had not. The reading never changes the vehicle's mileage; the app never calls a model.
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

      if (!user?.id) {
        Alert.alert('Sign in required', 'Sign in to save an odometer photo to your vehicle.', [{ text: 'OK' }]);
        return;
      }

      // Capture-first: the photo is queued durably BEFORE any network call, so it survives a failed
      // request, an app restart or no signal at all. The queue dedupes the same capture.
      const queued = enqueueUpload({
        userId: user.id,
        tenantId: (user as { tenantId?: string }).tenantId || 'default',
        vin,
        evidenceType: ODOMETER_NATIVE_EVIDENCE_TYPE,
        localFileRef: asset.dataUri,
        checksum: `${asset.fileSizeBytes}:${(asset.dataUri || '').slice(-32)}`,
      });

      let outcome: OdometerReadingOutcome = { kind: 'queued' };
      try {
        const base = resolveApiBaseUrl();
        await drainUploadQueue({
          resolvePayload: async (item) => item.localFileRef || null,
          uploadOne: makeHttpUploader(base, token),
          onUploaded: async (item, evidenceId) => {
            if (item.evidenceType !== ODOMETER_NATIVE_EVIDENCE_TYPE) return;
            const read = await requestOdometerReading(base, token, item.vin, evidenceId);
            if (item.localId === queued.localId) outcome = read;
          },
        });
      } catch {
        // Offline or unconfigured: the capture stays queued and uploads on the next drain.
      }

      const message = odometerOutcomeMessage(outcome);
      Alert.alert(message.title, `VIN: ${vin}\n${message.body}`, [
        { text: 'View Trust Passport', onPress: () => router.push(`/vehicle/${vin}`) },
        { text: 'Done', style: 'cancel' },
      ]);
    } catch (err) {
      console.error('[Garage] Odometer scan error:', err);
      Alert.alert('Camera Error', 'Could not launch camera. Please try again.', [{ text: 'OK' }]);
    } finally {
      setScanningVin(null);
    }
  }, [scanningVin, token, router, user, enqueueUpload]);

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
    // Everything shown comes from the contract through one null-safe view (F1: `item.cost` never existed).
    const view = toServiceLogView(item);
    return (
      <View className="bg-white border border-slate-100 rounded-2xl p-5 mb-4 shadow-sm">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 pr-4">
            <Text className="text-slate-400 text-xxs font-bold uppercase">{view.vinLabel}</Text>
            <Text className="text-slate-900 text-base font-bold mt-0.5">{view.title}</Text>
            <Text className="text-slate-400 text-xxs mt-0.5">{view.dateLabel}</Text>
          </View>
          <View className={view.costRecorded ? 'bg-slate-900 px-3 py-1 rounded-full' : 'bg-slate-100 px-3 py-1 rounded-full'}>
            <Text className={view.costRecorded ? 'text-white text-xxs font-bold' : 'text-slate-500 text-xxs font-semibold'}>{view.costLabel}</Text>
          </View>
        </View>

        <View className="h-px bg-slate-100 my-3" />

        <View className="space-y-1.5 bg-slate-50 p-3 rounded-xl">
          {view.detail ? (
            <View className="flex-row justify-between">
              <Text className="text-slate-400 text-xxs font-semibold">{view.detail.label}</Text>
              <Text className="text-slate-700 text-xs font-medium">{view.detail.value}</Text>
            </View>
          ) : null}
          <View className="flex-row justify-between mt-1">
            <Text className="text-slate-400 text-xxs font-semibold">Status</Text>
            <Text className="text-slate-700 text-xs font-bold uppercase tracking-wider">{view.statusLabel}</Text>
          </View>
          {view.authorizationLabel ? (
            <View className="flex-row justify-between mt-1">
              <Text className="text-slate-400 text-xxs font-semibold">Authorization</Text>
              <Text className="text-slate-700 text-xs font-medium">{view.authorizationLabel}</Text>
            </View>
          ) : null}
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

/**
 * Owner-protected route boundary (Milestone C). A deep link / direct nav to the
 * Garage screen is gated by the SAME governed decision that hides the tab for
 * non-owners (owner.garage: owner-only, requiresAuth). Anonymous → sign-in,
 * wrong-role → own dashboard, disabled/planned/hidden → safe state screen.
 */
export default function GarageScreen() {
  return (
    <NativeFeatureBoundary route="/dashboard/garage" featureId="owner.garage">
      <GarageScreenInner />
    </NativeFeatureBoundary>
  );
}
