import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { CaptureShell, RetryPanel, UploadProgress } from '../../../components/capture/CaptureSystem';
import { Button, Notice } from '../../../components/ui/NativePrimitives';
import { spacing } from '../../../theme/tokens';
import type { CaptureStage } from '../../../utils/captureState';
import { useVerificationStore } from '../../../store/verificationStore';
import {
  runVerificationSessionFlow,
  VerificationApiConfigurationError,
  VerificationApiError,
} from '../../../utils/verificationApi';

function isConnectivityError(error: unknown): boolean {
  return (
    error instanceof VerificationApiConfigurationError ||
    (error instanceof Error &&
      (error.name === 'TypeError' ||
        error.message.includes('Network request failed') ||
        error.message.toLowerCase().includes('fetch')))
  );
}

export default function VerificationProcessing() {
  const params = useLocalSearchParams<{ docType: string; doubleSided: string }>();
  const capturedFront = useVerificationStore((state) => state.capturedFront);
  const capturedBack = useVerificationStore((state) => state.capturedBack);
  const capturedSelfie = useVerificationStore((state) => state.capturedSelfie);
  const hasRequiredImages = useVerificationStore((state) => state.hasRequiredImages);
  const setOcrResult = useVerificationStore((state) => state.setOcrResult);
  const setProcessingError = useVerificationStore((state) => state.setProcessingError);
  const setVerificationOutcome = useVerificationStore((state) => state.setVerificationOutcome);

  const [stage, setStage] = useState<CaptureStage>('UPLOADING');
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attemptRef = useRef(0);

  const run = useCallback(async () => {
    const doubleSided = params.doubleSided === 'true';
    if (!hasRequiredImages(doubleSided) || !capturedFront || !capturedSelfie) {
      const message = 'One or more required photos are missing. Go back and capture them again.';
      setValidationError(message);
      setVerificationOutcome('incomplete', null, message, null);
      setProcessingError(message);
      return;
    }

    setNetworkError(null);
    setValidationError(null);
    setBusy(true);
    setStage('UPLOADING');
    const attempt = ++attemptRef.current;

    try {
      const outcome = await runVerificationSessionFlow(
        {
          docType: params.docType || 'national_id',
          doubleSided,
          capturedFront,
          capturedBack,
          capturedSelfie,
        },
        (nextStage) => {
          if (attemptRef.current !== attempt) return;
          setStage(nextStage);
        },
      );

      if (attemptRef.current !== attempt) return;

      setVerificationOutcome(
        outcome.status,
        outcome.sessionId,
        outcome.processingError,
        outcome.sessionStatus,
      );
      setProcessingError(outcome.processingError);
      if (outcome.ocrResult) setOcrResult(outcome.ocrResult);

      const finalStage: CaptureStage =
        outcome.status === 'verified'
          ? 'DOMAIN_VERIFIED'
          : outcome.status === 'retry_requested'
            ? 'RETRY_REQUIRED'
            : outcome.status === 'rejected'
              ? 'REJECTED'
              : outcome.status === 'needs_review' || outcome.status === 'ocr_failed'
                ? 'NEEDS_REVIEW'
                : 'UNDER_REVIEW';
      setStage(finalStage);
      router.replace('/(auth)/verification/result');
    } catch (error) {
      if (attemptRef.current !== attempt) return;
      if (isConnectivityError(error)) {
        const message = 'We could not finish uploading. Check your connection and try again.';
        setStage('NETWORK_FAILED');
        setNetworkError(message);
        setProcessingError(message);
        setVerificationOutcome('backend_pending', null, message, null);
      } else {
        const message =
          error instanceof VerificationApiError
            ? error.message
            : 'CarUp could not finish reading this submission. It may need review.';
        setStage('NEEDS_REVIEW');
        setProcessingError(message);
        setVerificationOutcome('ocr_failed', null, message, null);
        router.replace('/(auth)/verification/result');
      }
    } finally {
      if (attemptRef.current === attempt) setBusy(false);
    }
  }, [
    params.docType,
    params.doubleSided,
    capturedFront,
    capturedBack,
    capturedSelfie,
    hasRequiredImages,
    setOcrResult,
    setProcessingError,
    setVerificationOutcome,
  ]);

  useEffect(() => {
    void run();
  }, [run]);

  if (validationError) {
    return (
      <CaptureShell step="Step 8 of 9" title="Photos needed" subtitle="CarUp cannot submit incomplete evidence.">
        <RetryPanel
          title="Capture incomplete"
          body={validationError}
          actionLabel="Return to document capture"
          onRetry={() => router.replace('/(auth)/verification/document-select')}
        />
      </CaptureShell>
    );
  }

  return (
    <CaptureShell
      step="Step 8 of 9"
      title={stage === 'NETWORK_FAILED' ? 'Upload interrupted' : 'Submitting your evidence'}
      subtitle="CarUp separates photo upload, document reading and the final verification decision."
      footer={
        stage === 'NETWORK_FAILED' ? (
          <View style={{ gap: spacing[2] }}>
            <Button label="Try upload again" onPress={() => void run()} loading={busy} />
            <Button label="Back to review" onPress={() => router.back()} variant="secondary" />
          </View>
        ) : undefined
      }
    >
      {networkError ? (
        <RetryPanel title="Connection problem" body={networkError} actionLabel="Try again" onRetry={() => void run()} />
      ) : (
        <>
          <UploadProgress stage={stage} progress={null} />
          <View style={{ marginTop: spacing[4] }}>
            <Notice
              title="What this means"
              body="Reading details from a document helps prepare the submission. Only the responsible CarUp identity process can mark the identity verified."
              tone="info"
            />
          </View>
        </>
      )}
    </CaptureShell>
  );
}
