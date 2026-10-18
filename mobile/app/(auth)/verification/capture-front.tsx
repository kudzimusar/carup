import React, { useCallback, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import VerificationEntryGuard from '../../../components/verification/VerificationEntryGuard';
import {
  CarUpCameraViewfinder,
  CapturePreview,
  CaptureShell,
} from '../../../components/capture/CaptureSystem';
import { Notice } from '../../../components/ui/NativePrimitives';
import type { CapturedAsset } from '../../../utils/camera';
import { useVerificationStore } from '../../../store/verificationStore';

function CaptureFront() {
  const { docType, doubleSided } = useLocalSearchParams<{ docType: string; doubleSided: string }>();
  const setCapturedFront = useVerificationStore((state) => state.setCapturedFront);
  const [asset, setAsset] = useState<CapturedAsset | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const handleRetake = useCallback(() => {
    setCapturedFront(null);
    setAsset(null);
    setCaptureError(null);
  }, [setCapturedFront]);

  const handleUse = useCallback(() => {
    if (!asset) return;
    setCapturedFront(asset.dataUri);
    const target = doubleSided === 'true'
      ? '/(auth)/verification/capture-back'
      : '/(auth)/verification/selfie';
    router.push({
      pathname: target as '/(auth)/verification/capture-back' | '/(auth)/verification/selfie',
      params: { docType, doubleSided },
    });
  }, [asset, docType, doubleSided, setCapturedFront]);

  return (
    <CaptureShell
      step="Step 3 of 9 · Front"
      title="Front of your document"
      subtitle="Take the photo inside CarUp, then check the actual image before anything is submitted."
      onBack={() => {
        setCapturedFront(null);
        router.back();
      }}
    >
      {asset ? (
        <CapturePreview
          uri={asset.uri}
          label="Front of identity document"
          onRetake={handleRetake}
          onUse={handleUse}
        />
      ) : (
        <>
          {captureError ? <Notice title="Photo not captured" body={captureError} tone="danger" /> : null}
          <CarUpCameraViewfinder
            mode="document"
            title="Front of document"
            instruction="Keep all four corners inside the frame"
            onCaptured={(next) => {
              setCaptureError(null);
              setAsset(next);
            }}
            onClose={() => router.back()}
            onError={setCaptureError}
          />
        </>
      )}
    </CaptureShell>
  );
}

export default function GuardedCaptureFront(): React.ReactElement {
  return (
    <VerificationEntryGuard>
      <CaptureFront />
    </VerificationEntryGuard>
  );
}
