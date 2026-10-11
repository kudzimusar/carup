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
  captureDocumentPhotoWithStatus,
  openCameraSettings,
  type CameraPermissionState,
  type CapturedAsset,
} from '../../../utils/camera';
import { useVerificationStore } from '../../../store/verificationStore';

function CaptureBack() {
  const { docType, doubleSided } = useLocalSearchParams<{ docType: string; doubleSided: string }>();
  const setCapturedBack = useVerificationStore((state) => state.setCapturedBack);
  const [asset, setAsset] = useState<CapturedAsset | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [permission, setPermission] = useState<CameraPermissionState | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const handleCapture = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    setCaptureError(null);
    setPermission(null);
    const result = await captureDocumentPhotoWithStatus();
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
      subtitle="Capture the required reverse side, then check the actual photo before continuing."
      onBack={() => router.back()}
    >
      {permission && permission !== 'granted' ? (
        <PermissionPanel
          title={permission === 'blocked' ? 'Camera access is blocked' : permission === 'unavailable' ? 'Camera is unavailable' : 'Camera access is needed'}
          body={permission === 'blocked'
            ? 'Enable camera access for CarUp in your device Settings, then return here.'
            : permission === 'unavailable'
              ? 'This device could not open the camera. Go back and try again later.'
              : 'Allow camera access when your device asks so you can photograph the document.'}
          onRetry={permission === 'denied' || permission === 'not_requested' ? handleCapture : undefined}
          onOpenSettings={permission === 'blocked' ? () => void openCameraSettings() : undefined}
        />
      ) : asset ? (
        <CapturePreview
          uri={asset.uri}
          label="Back of identity document"
          onRetake={handleRetake}
          onUse={handleUse}
        />
      ) : (
        <>
          {captureError ? <Notice title="Photo not captured" body={captureError} tone="danger" /> : null}
          <CaptureGuide
            title="Back of document"
            instructions={['Keep the whole reverse side visible', 'Avoid reflections over numbers or barcodes', 'Hold the phone still so details are readable']}
            actionLabel="Open camera"
            onCapture={handleCapture}
            busy={capturing}
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
