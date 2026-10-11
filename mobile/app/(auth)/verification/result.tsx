import React, { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  CaptureShell,
  EvidenceStatus,
  ExtractionField,
  RetryPanel,
} from '../../../components/capture/CaptureSystem';
import { Button, Notice } from '../../../components/ui/NativePrimitives';
import { spacing, typeScale, useNativeTheme } from '../../../theme/tokens';
import type { CaptureStage } from '../../../utils/captureState';
import { useVerificationStore } from '../../../store/verificationStore';
import {
  getVerificationSession,
  mapSessionToVerificationOutcome,
  VerificationApiError,
} from '../../../utils/verificationApi';

function toEvidenceStage(status: string): CaptureStage {
  switch (status) {
    case 'verified':
      return 'DOMAIN_VERIFIED';
    case 'backend_pending':
      return 'NETWORK_FAILED';
    case 'retry_requested':
    case 'incomplete':
      return 'RETRY_REQUIRED';
    case 'rejected':
      return 'REJECTED';
    case 'ocr_failed':
      return 'NEEDS_REVIEW';
    case 'needs_review':
      return 'UNDER_REVIEW';
    default:
      return 'UNDER_REVIEW';
  }
}

function statusTitle(status: string): string {
  switch (status) {
    case 'verified':
      return 'Identity verified';
    case 'backend_pending':
      return 'Upload not finished';
    case 'retry_requested':
    case 'incomplete':
      return 'We need new photos';
    case 'rejected':
      return 'Identity not approved';
    case 'ocr_failed':
      return 'Your submission needs review';
    case 'needs_review':
      return "We're reviewing your submission";
    default:
      return 'Verification status';
  }
}

export default function VerificationResult() {
  const theme = useNativeTheme();
  const ocrResult = useVerificationStore((state) => state.ocrResult);
  const processingError = useVerificationStore((state) => state.processingError);
  const verificationStatus = useVerificationStore((state) => state.verificationStatus);
  const verificationSessionId = useVerificationStore((state) => state.verificationSessionId);
  const isRefreshing = useVerificationStore((state) => state.isRefreshing);
  const setVerificationOutcome = useVerificationStore((state) => state.setVerificationOutcome);
  const setOcrResult = useVerificationStore((state) => state.setOcrResult);
  const setRefreshing = useVerificationStore((state) => state.setRefreshing);
  const clearVerificationStore = useVerificationStore((state) => state.clear);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const evidenceStage = toEvidenceStage(verificationStatus);
  const canRestart =
    verificationStatus === 'retry_requested' ||
    verificationStatus === 'ocr_failed' ||
    verificationStatus === 'incomplete' ||
    verificationStatus === 'backend_pending';

  const extractedFields = useMemo(
    () =>
      [
        { label: 'Full name', value: [ocrResult?.first_name, ocrResult?.last_name].filter(Boolean).join(' ') || null },
        { label: 'ID number', value: ocrResult?.national_id_number || null },
        { label: 'Date of birth', value: ocrResult?.date_of_birth || null },
        { label: 'Issuing country', value: ocrResult?.country || null },
      ].filter((field) => field.value),
    [ocrResult],
  );

  const refresh = useCallback(async () => {
    if (!verificationSessionId) return;
    setRefreshError(null);
    setRefreshing(true);
    try {
      const session = await getVerificationSession(verificationSessionId);
      const outcome = mapSessionToVerificationOutcome(session);
      setVerificationOutcome(
        outcome.status,
        outcome.sessionId,
        outcome.processingError,
        outcome.sessionStatus,
      );
      if (outcome.ocrResult) setOcrResult(outcome.ocrResult);
    } catch (error) {
      setRefreshError(
        error instanceof VerificationApiError
          ? error.message
          : 'We could not refresh this status. Check your connection and try again.',
      );
    } finally {
      setRefreshing(false);
    }
  }, [
    verificationSessionId,
    setRefreshing,
    setVerificationOutcome,
    setOcrResult,
  ]);

  const restart = useCallback(() => {
    clearVerificationStore();
    router.replace('/(auth)/verification/intro');
  }, [clearVerificationStore]);

  const finish = useCallback(() => {
    clearVerificationStore();
    router.replace('/(tabs)');
  }, [clearVerificationStore]);

  return (
    <CaptureShell
      step="Step 9 of 9"
      title={statusTitle(verificationStatus)}
      subtitle="CarUp shows the verification decision separately from document reading and upload status."
      footer={
        <View style={{ gap: spacing[2] }}>
          {verificationSessionId ? (
            <Button
              label={isRefreshing ? 'Refreshing status' : 'Refresh status'}
              onPress={() => void refresh()}
              loading={isRefreshing}
              variant="secondary"
            />
          ) : null}
          {canRestart ? <Button label="Try again" onPress={restart} /> : null}
          <Button
            label="Back to CarUp"
            onPress={finish}
            variant={canRestart ? 'tertiary' : 'primary'}
          />
        </View>
      }
    >
      <EvidenceStatus stage={evidenceStage} />

      {processingError ? (
        <View style={{ marginTop: spacing[4] }}>
          <Notice
            title={verificationStatus === 'backend_pending' ? 'Connection problem' : 'What happened'}
            body={processingError}
            tone={verificationStatus === 'rejected' ? 'danger' : 'warning'}
          />
        </View>
      ) : null}

      {refreshError ? (
        <View style={{ marginTop: spacing[4] }}>
          <Notice title="Could not refresh" body={refreshError} tone="danger" />
        </View>
      ) : null}

      {extractedFields.length > 0 ? (
        <View
          style={{
            marginTop: spacing[5],
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.border.default,
            backgroundColor: theme.background.surface,
            paddingHorizontal: spacing[4],
          }}
        >
          <Text
            allowFontScaling
            style={{
              ...typeScale.headline,
              color: theme.text.primary,
              paddingTop: spacing[4],
              paddingBottom: spacing[2],
            }}
          >
            Details read from your document
          </Text>
          <Text
            allowFontScaling
            style={{
              ...typeScale.body,
              color: theme.text.muted,
              paddingBottom: spacing[2],
            }}
          >
            These details came from the submitted evidence. They are shown for transparency and do not create verification authority by themselves.
          </Text>
          {extractedFields.map((field) => (
            <ExtractionField
              key={field.label}
              label={field.label}
              value={field.value}
              state="read"
            />
          ))}
        </View>
      ) : null}

      {verificationStatus === 'verified' ? (
        <View style={{ marginTop: spacing[4] }}>
          <Notice
            title="Verification decision"
            body="The responsible CarUp identity process accepted your submitted identity evidence."
            tone="success"
          />
        </View>
      ) : null}

      {verificationStatus === 'rejected' ? (
        <View style={{ marginTop: spacing[4] }}>
          <Notice
            title="What you can do"
            body="This submission is closed in the app. If you believe the decision is incorrect, contact CarUp support. A new submission is available only if the review process permits it."
            tone="danger"
          />
        </View>
      ) : null}

      {verificationStatus === 'retry_requested' ? (
        <View style={{ marginTop: spacing[4] }}>
          <RetryPanel
            title="Retake requested"
            body={processingError || 'CarUp needs clearer or corrected evidence before review can continue.'}
            actionLabel="Retake photos"
            onRetry={restart}
          />
        </View>
      ) : null}
    </CaptureShell>
  );
}
