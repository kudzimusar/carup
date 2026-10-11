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

function CaptureBack() {
  const { docType, doubleSided } = useLocalSearchParams<{ docType: string; doubleSided: string }>();
  const setCapturedBack = useVerificationStore((state) => state.setCapturedBack);
  const [asset, setAsset] = useState<CapturedAsset | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const handleRetake = useCallback(() => {
    setCapturedBack(null);
    setAsset(null);
    setCaptureError(null);
  }, [setCapturedBack]);

  const handleUse = useCallback(() => {
    if (!asset) return;
    setCapturedBack(asset.dataUri);
    router.push({
      pathname: '/(auth)/verification/selfie',
      params: { docType, doubleSided },
    });
  }, [asset, docType, doubleSided, setCapturedBack]);

  return (
    <CaptureShell
      step="Step 4 of 9 · Back"
      title="Back of your document"
      subtitle="Take the reverse-side photo inside CarUp, then check it before continuing."
      onBack={() => router.back()}
    >
      {asset ? (
        <CapturePreview
          uri={asset.uri}
          label="Back of identity document"
          onRetake={handleRetake}
          onUse={handleUse}
        />
      ) : (
        <>
          {captureError ? <Notice title="Photo not captured" body={captureError} tone="danger" /> : null}
          <CarUpCameraViewfinder
            mode="document"
            title="Back of document"
            instruction="Keep the whole reverse side inside the frame"
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

export default function GuardedCaptureBack(): React.ReactElement {
  return (
    <VerificationEntryGuard>
      <CaptureBack />
    </VerificationEntryGuard>
  );
}
