import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { NativeFeatureBoundary } from '../../../components/navigation/NativeFeatureBoundary';
import {
  Button,
  EmptyState,
  Notice,
  SectionHeader,
  StatusPill,
} from '../../../components/ui/NativePrimitives';
import { useAuthStore } from '../../../store/authStore';
import {
  getBuyerVehiclePassport,
  type VehiclePassportEvidence,
} from '../../../utils/buyerJourneyApi';
import { radius, spacing, typeScale, useNativeTheme } from '../../../theme/tokens';

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function titleCase(value: unknown): string | null {
  const normalized = text(value);
  return normalized
    ? normalized.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : null;
}

function formatDate(value: unknown): string | null {
  const parsed = Date.parse(text(value) || '');
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : null;
}

function PassportFact({ label, value }: { label: string; value: string }) {
  const theme = useNativeTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[4], paddingVertical: spacing[2] }}>
      <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{label}</Text>
      <Text allowFontScaling style={{ ...typeScale.label, color: theme.text.secondary, flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function EvidenceCard({ evidence }: { evidence: VehiclePassportEvidence }) {
  const theme = useNativeTheme();
  const verified = String(evidence.verification_status || '').toLowerCase() === 'verified';
  const evidenceDate = formatDate(evidence.verified_at || evidence.event_date || evidence.captured_at);

  return (
    <View
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: theme.border.default,
        backgroundColor: theme.background.surface,
        padding: spacing[4],
        gap: spacing[2],
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3] }}>
        <View style={{ flex: 1 }}>
          <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary }}>
            {titleCase(evidence.evidence_type) || 'Evidence record'}
          </Text>
          {evidence.source_name ? (
            <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted, marginTop: spacing[1] }}>
              Source: {evidence.source_name}
            </Text>
          ) : null}
        </View>
        <StatusPill
          label={titleCase(evidence.verification_status) || 'Status unavailable'}
          tone={verified ? 'success' : 'neutral'}
        />
      </View>
      {evidenceDate ? (
        <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>{evidenceDate}</Text>
      ) : null}
      {evidence.file_availability === 'withheld_private' ? (
        <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>
          This document is recorded, but its file is not shared here.
        </Text>
      ) : null}
    </View>
  );
}

function PassportScreenInner() {
  const theme = useNativeTheme();
  const router = useRouter();
  const { vin } = useLocalSearchParams<{ vin?: string }>();
  const user = useAuthStore((state) => state.user);
  const canonicalVin = String(vin || '').trim();

  const passportQuery = useQuery({
    queryKey: [
      'native-buyer-passport',
      canonicalVin,
      user?.id || 'anonymous',
      user?.active_tenant_id || 'none',
      user?.role || 'none',
    ],
    queryFn: () => getBuyerVehiclePassport(canonicalVin),
    enabled: Boolean(canonicalVin),
  });

  if (!canonicalVin) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState title="Vehicle Passport unavailable" body="This link does not include a VIN, so there is no Passport to open." />
      </View>
    );
  }

  if (passportQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.brand.primary} accessibilityLabel="Loading Vehicle Passport" />
      </View>
    );
  }

  if (passportQuery.isError || !passportQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="document-text-outline"
          title="Vehicle Passport could not be read"
          body="CarUp could not load the Passport for this vehicle, so nothing is shown in its place. Try again."
          actionLabel="Try again"
          onAction={() => void passportQuery.refetch()}
          secondaryLabel="Back to vehicle"
          onSecondary={() => router.replace(`/vehicle/${encodeURIComponent(canonicalVin)}` as never)}
        />
      </View>
    );
  }

  const passport = passportQuery.data;
  const passportVin = text(passport.identity?.vin || passport.vehicle?.vin);
  const sameVin = passportVin === canonicalVin;
  const trust = passport.trustReport || {};
  const evaluationState = text(trust.evaluation_state);
  const trustBand = titleCase(trust.band);
  const trustScore = typeof trust.score === 'number' && Number.isFinite(trust.score) ? trust.score : null;
  const evidence = Array.isArray(passport.evidenceVault) ? passport.evidenceVault : [];
  const identityRedacted = passport.identity?.identifiersRedacted === true;
  const vehicleTitle = [
    passport.vehicle?.year,
    passport.vehicle?.make,
    passport.vehicle?.model,
  ].filter(Boolean).join(' ') || canonicalVin;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.canvas }}>
      <ScrollView contentContainerStyle={{ padding: spacing[5], paddingBottom: spacing[10], gap: spacing[5] }}>
        <Button label="Back to vehicle" variant="tertiary" onPress={() => router.back()} />

        <View>
          <Text allowFontScaling style={{ ...typeScale.metadata, color: theme.text.muted }}>Vehicle Passport · VIN {canonicalVin}</Text>
          <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary, marginTop: spacing[1] }}>
            {vehicleTitle}
          </Text>
        </View>

        {!sameVin ? (
          <Notice
            title="This Passport does not match the vehicle"
            body="CarUp returned a Passport for a different VIN, so it is not shown here."
            tone="danger"
          />
        ) : (
          <Notice
            title="Same vehicle"
            body="This Passport belongs to the same VIN as the listing you opened."
            tone="success"
          />
        )}

        {/* OC-NATIVE-FINAL-02-R1 P2-A: a Passport for a different VIN was still rendered below the
            mismatch notice. Nothing from it is shown now, and purchase stays unavailable. */}
        {sameVin ? (
        <>
        <View>
          <SectionHeader title="Identity" />
          <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}>
            <PassportFact label="VIN" value={passportVin || 'Unavailable'} />
            <PassportFact
              label="Plate"
              value={text(passport.identity?.plateNumber) || (identityRedacted ? 'Not shown here' : 'Not recorded')}
            />
            <PassportFact
              label="Chassis"
              value={text(passport.identity?.chassisNumber) || (identityRedacted ? 'Not shown here' : 'Not recorded')}
            />
            <PassportFact
              label="Engine"
              value={text(passport.identity?.engineNumber) || (identityRedacted ? 'Not shown here' : 'Not recorded')}
            />
          </View>
        </View>

        <View>
          <SectionHeader title="Trust assessment" />
          <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, padding: spacing[4], gap: spacing[2] }}>
            <PassportFact label="Evaluation" value={titleCase(evaluationState) || 'Not evaluated'} />
            <PassportFact label="Band" value={trustBand || 'Not available'} />
            <PassportFact label="Score" value={trustScore === null ? 'Not available' : `${trustScore} / 100`} />
          </View>
          {evaluationState !== 'evaluated' ? (
            <View style={{ marginTop: spacing[3] }}>
              <Notice
                title="Trust assessment not complete"
                body="This vehicle does not have a current trust assessment. The app never estimates a score of its own."
                tone="info"
              />
            </View>
          ) : null}
        </View>

        <View>
          <SectionHeader title="Passport evidence" />
          {evidence.length === 0 ? (
            <Notice
              title="No evidence to show"
              body="CarUp has no evidence it can show you for this vehicle yet. Missing evidence is never treated as verified."
              tone="warning"
            />
          ) : (
            <View style={{ gap: spacing[3] }}>
              {evidence.map((item, index) => (
                <EvidenceCard key={text(item.id) || `evidence-${index}`} evidence={item} />
              ))}
            </View>
          )}
        </View>

        <View>
          <SectionHeader title="Vehicle history" />
          <Notice
            title={passport.lifecycle ? 'Vehicle history recorded' : 'Vehicle history not available'}
            body={passport.lifecycle
              ? 'This vehicle’s history is kept in its CarUp Vehicle Passport.'
              : 'CarUp could not show a history for this vehicle yet, and the app does not create one of its own.'}
            tone={passport.lifecycle ? 'info' : 'warning'}
          />
        </View>
        </>
        ) : null}

        <Button
          label="Continue to purchase"
          onPress={() => router.push(`/vehicle/${encodeURIComponent(canonicalVin)}/transaction` as never)}
          disabled={!sameVin}
        />
      </ScrollView>
    </View>
  );
}

export default function PassportScreen() {
  return (
    <NativeFeatureBoundary route="/vehicle/[vin]/passport" featureId="product.marketplace" hasNativeScreen>
      <PassportScreenInner />
    </NativeFeatureBoundary>
  );
}
