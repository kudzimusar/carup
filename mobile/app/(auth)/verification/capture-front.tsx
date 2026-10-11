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

function CaptureFront() {
  const { docType, doubleSided } = useLocalSearchParams<{ docType: string; doubleSided: string }>();
  const setCapturedFront = useVerificationStore((state) => state.setCapturedFront);
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
    if (result.kind === 'error') {
      setCaptureError(result.message);
    }
  }, [capturing]);

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
      subtitle="Place the whole document in view. You will check the actual photo before anything is submitted."
      onBack={() => {
        setCapturedFront(null);
        router.back();
      }}
    >
      {permission && permission !== 'granted' ? (
        <PermissionPanel
          title={permission === 'blocked' ? 'Camera access is blocked' : permission === 'unavailable' ? 'Camera is unavailable' : 'Camera access is needed'}
          body={permission === 'blocked'
            ? 'Enable camera access for CarUp in your device Settings, then return here.'
            : permission === 'unavailable'
              ? 'This device could not open a camera permission request. You can go back and try again later.'
              : 'Allow camera access when your device asks so you can photograph your document.'}
          onRetry={permission === 'denied' || permission === 'not_requested' ? handleCapture : undefined}
          onOpenSettings={permission === 'blocked' ? () => void openCameraSettings() : undefined}
        />
      ) : asset ? (
        <CapturePreview
          uri={asset.uri}
          label="Front of identity document"
          onRetake={handleRetake}
          onUse={handleUse}
        />
      ) : (
        <>
          {captureError ? <Notice title="Photo not captured" body={captureError} tone="danger" /> : null}
          <CaptureGuide
            title="Front of document"
            instructions={['Keep all four corners visible', 'Avoid glare across the document', 'Hold the phone still so the text is readable']}
            actionLabel="Open camera"
            onCapture={handleCapture}
            busy={capturing}
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
