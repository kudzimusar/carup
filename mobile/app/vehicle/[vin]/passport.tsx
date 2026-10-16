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
          The underlying artifact is private for this audience.
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
        <EmptyState title="Vehicle Passport unavailable" body="A canonical VIN is required to open a Vehicle Passport." />
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
          body="CarUp did not return an authoritative Passport for this VIN. No substitute Passport or evidence record has been created."
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
            title="Passport identity mismatch"
            body="CarUp returned a Passport that does not match the requested VIN. This view is stopped rather than joining records."
            tone="danger"
          />
        ) : (
          <Notice
            title="Same vehicle identity"
            body="Marketplace, Passport and the rest of this buyer journey remain anchored to the same canonical VIN."
            tone="success"
          />
        )}

        <View>
          <SectionHeader title="Identity" />
          <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}>
            <PassportFact label="VIN" value={passportVin || 'Unavailable'} />
            <PassportFact
              label="Plate"
              value={text(passport.identity?.plateNumber) || (identityRedacted ? 'Withheld for this audience' : 'Not recorded')}
            />
            <PassportFact
              label="Chassis"
              value={text(passport.identity?.chassisNumber) || (identityRedacted ? 'Withheld for this audience' : 'Not recorded')}
            />
            <PassportFact
              label="Engine"
              value={text(passport.identity?.engineNumber) || (identityRedacted ? 'Withheld for this audience' : 'Not recorded')}
            />
          </View>
        </View>

        <View>
          <SectionHeader title="Canonical Trust" />
          <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.background.surface, padding: spacing[4], gap: spacing[2] }}>
            <PassportFact label="Evaluation" value={titleCase(evaluationState) || 'Not evaluated'} />
            <PassportFact label="Band" value={trustBand || 'Not available'} />
            <PassportFact label="Score" value={trustScore === null ? 'Not available' : `${trustScore} / 100`} />
          </View>
          {evaluationState !== 'evaluated' ? (
            <View style={{ marginTop: spacing[3] }}>
              <Notice
                title="No invented Trust state"
                body="This screen does not calculate a replacement score. Missing, stale or unavailable canonical Trust remains missing, stale or unavailable."
                tone="info"
              />
            </View>
          ) : null}
        </View>

        <View>
          <SectionHeader title="Passport evidence" />
          {evidence.length === 0 ? (
            <Notice
              title="No evidence returned"
              body="The canonical Passport returned no evidence rows for this audience. CarUp does not insert demo documents or infer that missing evidence is verified."
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
          <SectionHeader title="Lifecycle continuity" />
          <Notice
            title={passport.lifecycle ? 'Lifecycle projection available' : 'Lifecycle projection unavailable'}
            body={passport.lifecycle
              ? 'Lifecycle information shown by CarUp remains part of this same Vehicle Passport. Native does not create a separate history.'
              : 'No lifecycle projection was returned. This is shown as unavailable rather than replaced with a Native-only history.'}
            tone={passport.lifecycle ? 'info' : 'warning'}
          />
        </View>

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
