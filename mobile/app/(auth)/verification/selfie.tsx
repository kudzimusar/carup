import React, { useCallback, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import VerificationEntryGuard from '../../../components/verification/VerificationEntryGuard';
import {
  CaptureGuide,
  CapturePreview,
  CaptureShell,
  PermissionPanel,
} from '../../../components/capture/CaptureSystem';
import { Notice } from '../../../components/ui/NativePrimitives';
import {
  captureSelfiePhotoWithStatus,
  openCameraSettings,
  type CameraPermissionState,
  type CapturedAsset,
} from '../../../utils/camera';
import { useVerificationStore } from '../../../store/verificationStore';

function SelfieCapture() {
  const params = useLocalSearchParams<{ docType: string; doubleSided: string }>();
  const setCapturedSelfie = useVerificationStore((state) => state.setCapturedSelfie);
  const [asset, setAsset] = useState<CapturedAsset | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [permission, setPermission] = useState<CameraPermissionState | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const handleCapture = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    setCaptureError(null);
    setPermission(null);
    const result = await captureSelfiePhotoWithStatus();
    setCapturing(false);

    if (result.kind === 'captured') {
      setAsset(result.asset);
      return;
    }
    if (result.kind === 'permission') {
      setPermission(result.state);
      return;
    }
    if (result.kind === 'error') setCaptureError(result.message);
  }, [capturing]);

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
      subtitle="Use a neutral expression and make sure your face is fully visible. You will review the actual photo first."
      onBack={() => router.back()}
    >
      {permission && permission !== 'granted' ? (
        <PermissionPanel
          title={permission === 'blocked' ? 'Camera access is blocked' : permission === 'unavailable' ? 'Camera is unavailable' : 'Camera access is needed'}
          body={permission === 'blocked'
            ? 'Enable camera access for CarUp in your device Settings, then return here.'
            : permission === 'unavailable'
              ? 'This device could not open the camera. Go back and try again later.'
              : 'Allow camera access when your device asks so you can take the selfie.'}
          onRetry={permission === 'denied' || permission === 'not_requested' ? handleCapture : undefined}
          onOpenSettings={permission === 'blocked' ? () => void openCameraSettings() : undefined}
        />
      ) : asset ? (
        <CapturePreview
          uri={asset.uri}
          label="Selfie"
          onRetake={handleRetake}
          onUse={handleUse}
          useLabel="Use selfie"
        />
      ) : (
        <>
          {captureError ? <Notice title="Selfie not captured" body={captureError} tone="danger" /> : null}
          <CaptureGuide
            title="Your selfie"
            instructions={['Face the camera directly', 'Use even light where possible', 'Remove anything that covers your face']}
            actionLabel="Open front camera"
            onCapture={handleCapture}
            busy={capturing}
            icon="person-circle-outline"
          />
          <Notice
            title="Liveness status"
            body="The current development liveness step is simulated and does not itself verify your identity."
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
