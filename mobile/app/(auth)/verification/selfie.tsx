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

function SelfieCapture() {
  const params = useLocalSearchParams<{ docType: string; doubleSided: string }>();
  const setCapturedSelfie = useVerificationStore((state) => state.setCapturedSelfie);
  const [asset, setAsset] = useState<CapturedAsset | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const handleRetake = useCallback(() => {
    setCapturedSelfie(null);
    setAsset(null);
    setCaptureError(null);
  }, [setCapturedSelfie]);

  const handleUse = useCallback(() => {
    if (!asset) return;
    setCapturedSelfie(asset.dataUri);
    router.push({
      pathname: '/(auth)/verification/liveness',
      params,
    });
  }, [asset, params, setCapturedSelfie]);

  return (
    <CaptureShell
      step="Step 5 of 9 · Selfie"
      title="Take a clear selfie"
      subtitle="Use the CarUp front camera and review the actual photo before continuing."
      onBack={() => router.back()}
    >
      {asset ? (
        <CapturePreview
          uri={asset.uri}
          label="Selfie"
          onRetake={handleRetake}
          onUse={handleUse}
          useLabel="Use selfie"
          checkBody="Make sure your face is fully visible and the photo is clear enough for review."
        />
      ) : (
        <>
          {captureError ? <Notice title="Selfie not captured" body={captureError} tone="danger" /> : null}
          <CarUpCameraViewfinder
            mode="selfie"
            title="Selfie"
            instruction="Center your face inside the guide"
            onCaptured={(next) => {
              setCaptureError(null);
              setAsset(next);
            }}
            onClose={() => router.back()}
            onError={setCaptureError}
          />
          <Notice
            title="Liveness status"
            body="This viewfinder does not perform face or liveness detection. The current development liveness step remains separate and non-authoritative."
            tone="warning"
          />
        </>
      )}
    </CaptureShell>
  );
}

export default function GuardedSelfieCapture(): React.ReactElement {
  return (
    <VerificationEntryGuard>
      <SelfieCapture />
    </VerificationEntryGuard>
  );
}
