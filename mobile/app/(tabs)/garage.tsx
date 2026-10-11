import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NativeFeatureBoundary } from '../../components/navigation/NativeFeatureBoundary';
import {
  CapturePreview,
  PermissionPanel,
} from '../../components/capture/CaptureSystem';
import {
  Button,
  EmptyState,
  Notice,
  Price,
  SectionHeader,
  StatusPill,
} from '../../components/ui/NativePrimitives';
import { useAuthStore } from '../../store/authStore';
import { useUploadQueueStore } from '../../store/uploadQueueStore';
import { captureOdometerPhotoWithStatus, openCameraSettings, type CameraPermissionState, type CapturedAsset } from '../../utils/camera';
import { getMyServiceHistory, getMyVehicles, type NativeOwnedVehicle } from '../../utils/ownerGarageApi';
import { resolveApiBaseUrl } from '../../utils/apiBase';
import { drainUploadQueue, makeHttpUploader } from '../../utils/uploadQueueDrain';
import {
  ODOMETER_NATIVE_EVIDENCE_TYPE,
  odometerOutcomeMessage,
  requestOdometerReading,
  type OdometerReadingOutcome,
} from '../../utils/odometerCapture';
import { toServiceLogView } from '../../utils/serviceHistoryView';
import { radius, spacing, typeScale, useNativeTheme } from '../../theme/tokens';
import type { OwnerServiceHistoryEntry } from '@shared/types';

function listingState(status?: string | null): { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' } {
  const value = String(status || '').toLowerCase();
  if (value === 'published') return { label: 'Published on Marketplace', tone: 'success' };
  if (value === 'publishable') return { label: 'Ready to publish — not public', tone: 'warning' };
  if (value === 'draft') return { label: 'Draft', tone: 'neutral' };
  if (value === 'pending' || value === 'pending_review') return { label: 'Pending review', tone: 'warning' };
  return { label: status ? status.replace(/[_-]+/g, ' ') : 'Listing state not recorded', tone: 'neutral' };
}

function OwnerVehicleCard({
  vehicle,
  onPassport,
  onOdometer,
  capturing,
}: {
  vehicle: NativeOwnedVehicle;
  onPassport: () => void;
  onOdometer: () => void;
  capturing: boolean;
}) {
  const theme = useNativeTheme();
  const state = listingState(vehicle.status);
  const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  return (
    <View
      style={{
        flex: 1,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surface,
        padding: spacing[4],
        gap: spacing[3],
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3] }}>
        <View style={{ flex: 1 }}>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }} numberOfLines={1}>
            VIN {vehicle.vin}
          </Text>
          <Text allowFontScaling style={{ ...typeScale.headline, color: theme.text.primary, marginTop: spacing[1] }}>
            {title || vehicle.vin}
          </Text>
          {[vehicle.color, vehicle.transmission].filter(Boolean).length ? (
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[1] }}>
              {[vehicle.color, vehicle.transmission].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
        <StatusPill label={state.label} tone={state.tone} />
      </View>

      <View style={{ height: 1, backgroundColor: theme.border.default }} />

      <View style={{ gap: spacing[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Ionicons name="key-outline" size={18} color={theme.text.secondary} />
          <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary }}>Owned vehicle in My Garage</Text>
        </View>
        {typeof vehicle.mileage === 'number' && Number.isFinite(vehicle.mileage) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <Ionicons name="speedometer-outline" size={18} color={theme.text.secondary} />
            <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary }}>{vehicle.mileage.toLocaleString()} km recorded</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Ionicons name="shield-checkmark-outline" size={18} color={theme.text.secondary} />
          <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.secondary }}>Vehicle Passport available</Text>
        </View>
      </View>

      {typeof vehicle.price === 'number' && Number.isFinite(vehicle.price) ? (
        <View>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>Recorded listing price</Text>
          <Price amount={vehicle.price} currency={vehicle.currency || null} compact />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing[2] }}>
        <Button label="Vehicle Passport" variant="secondary" onPress={onPassport} style={{ flex: 1 }} />
        <Button label={capturing ? 'Opening camera' : 'Odometer photo'} onPress={onOdometer} loading={capturing} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function ServiceHistoryCard({ item }: { item: OwnerServiceHistoryEntry }) {
  const theme = useNativeTheme();
  const view = toServiceLogView(item);
  return (
    <View
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surface,
        padding: spacing[4],
        marginBottom: spacing[3],
      }}
    >
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{view.vinLabel}</Text>
      <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary, marginTop: 2 }}>{view.title}</Text>
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: 2 }}>{view.dateLabel}</Text>
      <View style={{ marginTop: spacing[3], gap: spacing[2] }}>
        {view.detail ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] }}>
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{view.detail.label}</Text>
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.secondary, flex: 1, textAlign: 'right' }}>{view.detail.value}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] }}>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>Status</Text>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.secondary }}>{view.statusLabel}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] }}>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>Cost</Text>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.secondary }}>{view.costLabel}</Text>
        </View>
      </View>
    </View>
  );
}

function GarageScreenInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 2 : 1;
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const enqueueUpload = useUploadQueueStore((state) => state.enqueue);
  const hydrateQueue = useUploadQueueStore((state) => state.hydrate);

  const [section, setSection] = useState<'vehicles' | 'history'>('vehicles');
  const [capturingVin, setCapturingVin] = useState<string | null>(null);
  const [pendingCapture, setPendingCapture] = useState<{ vin: string; asset: CapturedAsset } | null>(null);
  const [permission, setPermission] = useState<CameraPermissionState | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ title: string; body: string; tone: 'info' | 'success' | 'warning' | 'danger' } | null>(null);
  const [uploading, setUploading] = useState(false);

  const vehiclesQuery = useQuery({
    queryKey: ['native-my-garage-vehicles', user?.id],
    queryFn: getMyVehicles,
  });
  const historyQuery = useQuery({
    queryKey: ['native-my-garage-history', user?.id],
    queryFn: getMyServiceHistory,
    enabled: section === 'history',
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateQueue();
      if (cancelled || !user?.id) return;
      try {
        const base = resolveApiBaseUrl();
        await drainUploadQueue({
          resolvePayload: async (item) => item.localFileRef || null,
          uploadOne: makeHttpUploader(base, token),
          onUploaded: async (item, evidenceId) => {
            if (item.evidenceType === ODOMETER_NATIVE_EVIDENCE_TYPE) {
              await requestOdometerReading(base, token, item.vin, evidenceId);
            }
          },
        });
      } catch {
        // Existing queued evidence remains durable for a later retry.
      }
    })();
    return () => { cancelled = true; };
  }, [hydrateQueue, token, user?.id]);

  const captureOdometer = useCallback(async (vin: string) => {
    if (capturingVin || uploading) return;
    setCapturingVin(vin);
    setPermission(null);
    setUploadMessage(null);
    const result = await captureOdometerPhotoWithStatus();
    setCapturingVin(null);

    if (result.kind === 'captured') {
      setPendingCapture({ vin, asset: result.asset });
      return;
    }
    if (result.kind === 'permission') {
      setPermission(result.state);
      return;
    }
    if (result.kind === 'error') {
      setUploadMessage({ title: 'Camera unavailable', body: result.message, tone: 'danger' });
    }
  }, [capturingVin, uploading]);

  const useOdometerPhoto = useCallback(async () => {
    if (!pendingCapture || !user?.id) return;
    setUploading(true);
    setUploadMessage(null);

    const queued = enqueueUpload({
      userId: user.id,
      tenantId: user.active_tenant_id || 'default',
      vin: pendingCapture.vin,
      evidenceType: ODOMETER_NATIVE_EVIDENCE_TYPE,
      localFileRef: pendingCapture.asset.dataUri,
      checksum: `${pendingCapture.asset.fileSizeBytes}:${pendingCapture.asset.dataUri.slice(-32)}`,
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
      outcome = { kind: 'queued' };
    }

    const copy = odometerOutcomeMessage(outcome);
    setPendingCapture(null);
    setUploading(false);
    setUploadMessage({
      title: copy.title,
      body: copy.body,
      tone: outcome.kind === 'queued' ? 'warning' : 'info',
    });
  }, [enqueueUpload, pendingCapture, token, user?.active_tenant_id, user?.id]);

  const vehicles = vehiclesQuery.data || [];
  const history = historyQuery.data || [];
  const refreshing = section === 'vehicles' ? vehiclesQuery.isRefetching : historyQuery.isRefetching;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <View style={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[3] }}>
        <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary }}>My Garage</Text>
        <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>
          Your vehicles, Vehicle Passports and service history.
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[4] }}>
          <Button label="My vehicles" variant={section === 'vehicles' ? 'primary' : 'secondary'} onPress={() => setSection('vehicles')} style={{ flex: 1 }} />
          <Button label="Service history" variant={section === 'history' ? 'primary' : 'secondary'} onPress={() => setSection('history')} style={{ flex: 1 }} />
        </View>

        {permission && permission !== 'granted' ? (
          <View style={{ marginTop: spacing[4] }}>
            <PermissionPanel
              title={permission === 'blocked' ? 'Camera access is blocked' : permission === 'unavailable' ? 'Camera is unavailable' : 'Camera access is needed'}
              body={permission === 'blocked'
                ? 'Enable camera access for CarUp in device Settings, then return to My Garage.'
                : permission === 'unavailable'
                  ? 'The camera could not be opened on this device.'
                  : 'Allow camera access so you can photograph the odometer.'}
              onOpenSettings={permission === 'blocked' ? () => void openCameraSettings() : undefined}
              onRetry={permission === 'denied' || permission === 'not_requested'
                ? () => { if (capturingVin) void captureOdometer(capturingVin); }
                : undefined}
            />
          </View>
        ) : null}

        {pendingCapture ? (
          <View style={{ marginTop: spacing[4] }}>
            <CapturePreview
              uri={pendingCapture.asset.uri}
              label={`Odometer photo for ${pendingCapture.vin}`}
              onRetake={() => {
                const vin = pendingCapture.vin;
                setPendingCapture(null);
                void captureOdometer(vin);
              }}
              onUse={() => void useOdometerPhoto()}
              useLabel={uploading ? 'Uploading' : 'Use odometer photo'}
            />
          </View>
        ) : null}

        {uploadMessage ? (
          <View style={{ marginTop: spacing[4] }}>
            <Notice title={uploadMessage.title} body={uploadMessage.body} tone={uploadMessage.tone} />
          </View>
        ) : null}
      </View>

      {section === 'vehicles' ? (
        vehiclesQuery.isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading your vehicles" />
          </View>
        ) : vehiclesQuery.isError ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon="cloud-offline-outline"
              title="My Garage could not refresh"
              body="Check your connection and try again. Your vehicle state will not be replaced with cached assumptions."
              actionLabel="Try again"
              onAction={() => void vehiclesQuery.refetch()}
            />
          </View>
        ) : vehicles.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon="car-outline"
              title="No vehicles in My Garage yet"
              body="Vehicles you own will appear here after CarUp's ownership process associates them with your account."
              actionLabel="Browse Market"
              onAction={() => router.push('/(tabs)/marketplace' as never)}
              secondaryLabel="Verify identity"
              onSecondary={() => router.push('/(auth)/verification/intro' as never)}
            />
          </View>
        ) : (
          <FlatList
            key={`vehicles-${columns}`}
            data={vehicles}
            numColumns={columns}
            keyExtractor={(item) => item.vin}
            renderItem={({ item, index }) => (
              <View
                style={{
                  flex: 1,
                  marginHorizontal: columns === 2 ? spacing[1] : 0,
                  marginBottom: spacing[3],
                  maxWidth: columns === 2 ? '50%' : '100%',
                }}
              >
                <OwnerVehicleCard
                  vehicle={item}
                  capturing={capturingVin === item.vin}
                  onPassport={() => router.push(`/vehicle/${item.vin}` as never)}
                  onOdometer={() => void captureOdometer(item.vin)}
                />
              </View>
            )}
            contentContainerStyle={{ paddingHorizontal: spacing[5], paddingBottom: spacing[10] }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void vehiclesQuery.refetch()} />}
          />
        )
      ) : historyQuery.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading service history" />
        </View>
      ) : historyQuery.isError ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Service history could not refresh"
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={() => void historyQuery.refetch()}
          />
        </View>
      ) : history.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void historyQuery.refetch()} />}
        >
          <EmptyState
            icon="construct-outline"
            title="No service records yet"
            body="Service records associated with your vehicles will appear here when CarUp has them."
          />
        </ScrollView>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ServiceHistoryCard item={item} />}
          ListHeaderComponent={<SectionHeader title="Service history" />}
          contentContainerStyle={{ paddingHorizontal: spacing[5], paddingBottom: spacing[10] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void historyQuery.refetch()} />}
        />
      )}
    </View>
  );
}

export default function GarageScreen() {
  return (
    <NativeFeatureBoundary route="/dashboard/garage" featureId="owner.garage">
      <GarageScreenInner />
    </NativeFeatureBoundary>
  );
}
