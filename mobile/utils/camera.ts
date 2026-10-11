/**
 * CarUp native camera utilities.
 *
 * Camera capture is transport, not authority. These helpers expose truthful
 * permission/cancellation/error states and strip EXIF before private evidence
 * is sent to governed backend endpoints.
 */
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';

export interface CapturedAsset {
  uri: string;
  base64: string;
  dataUri: string;
  width: number;
  height: number;
  mimeType: string;
  fileSizeBytes: number;
}

export type CameraPermissionState =
  | 'not_requested'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable';

export type CameraCaptureResult =
  | { kind: 'captured'; asset: CapturedAsset }
  | { kind: 'cancelled' }
  | { kind: 'permission'; state: Exclude<CameraPermissionState, 'granted'> }
  | { kind: 'error'; message: string };

function permissionState(permission: ImagePicker.MediaLibraryPermissionResponse | ImagePicker.CameraPermissionResponse): CameraPermissionState {
  if (permission.status === 'granted') return 'granted';
  if (permission.status === 'undetermined') return 'not_requested';
  return permission.canAskAgain ? 'denied' : 'blocked';
}

export async function getCameraPermissionState(): Promise<CameraPermissionState> {
  try {
    return permissionState(await ImagePicker.getCameraPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

export async function requestCameraPermissionState(): Promise<CameraPermissionState> {
  try {
    const existing = await ImagePicker.getCameraPermissionsAsync();
    if (existing.status === 'granted') return 'granted';
    if (existing.status === 'denied' && !existing.canAskAgain) return 'blocked';
    return permissionState(await ImagePicker.requestCameraPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

export async function openCameraSettings(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openURL('app-settings:');
    return;
  }
  await Linking.openSettings();
}

/**
 * Legacy boolean helper retained for existing callers.
 * New capture UI should use requestCameraPermissionState() so denied/blocked
 * states remain distinguishable.
 */
export async function requestCameraPermissions(): Promise<boolean> {
  return (await requestCameraPermissionState()) === 'granted';
}

export async function capturePhotoWithStatus(
  options?: Partial<ImagePicker.ImagePickerOptions>
): Promise<CameraCaptureResult> {
  const permission = await requestCameraPermissionState();
  if (permission !== 'granted') return { kind: 'permission', state: permission };

  try {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      base64: true,
      exif: false,
      ...options,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return { kind: 'cancelled' };
    }

    const asset = result.assets[0];
    if (!asset.base64) {
      return { kind: 'error', message: 'The photo could not be prepared. Please take it again.' };
    }

    const mimeType = asset.mimeType || (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
    const dataUri = `data:${mimeType};base64,${asset.base64}`;
    const fileSizeBytes = Math.ceil((asset.base64.length * 3) / 4);

    return {
      kind: 'captured',
      asset: {
        uri: asset.uri,
        base64: asset.base64,
        dataUri,
        width: asset.width,
        height: asset.height,
        mimeType,
        fileSizeBytes,
      },
    };
  } catch {
    return {
      kind: 'error',
      message: 'The camera is unavailable right now. Please try again.',
    };
  }
}

/**
 * Compatibility wrapper for existing Garage and other callers.
 */
export async function capturePhotoFromCamera(
  options?: Partial<ImagePicker.ImagePickerOptions>
): Promise<CapturedAsset | null> {
  const result = await capturePhotoWithStatus(options);
  return result.kind === 'captured' ? result.asset : null;
}

export function captureDocumentPhotoWithStatus(): Promise<CameraCaptureResult> {
  return capturePhotoWithStatus({
    cameraType: ImagePicker.CameraType.back,
    aspect: [4, 3],
    quality: 0.7,
  });
}

export async function captureDocumentPhoto(): Promise<CapturedAsset | null> {
  const result = await captureDocumentPhotoWithStatus();
  return result.kind === 'captured' ? result.asset : null;
}

export function captureSelfiePhotoWithStatus(): Promise<CameraCaptureResult> {
  return capturePhotoWithStatus({
    cameraType: ImagePicker.CameraType.front,
    aspect: [1, 1],
    quality: 0.8,
  });
}

export async function captureSelfiePhoto(): Promise<CapturedAsset | null> {
  const result = await captureSelfiePhotoWithStatus();
  return result.kind === 'captured' ? result.asset : null;
}

export function captureOdometerPhotoWithStatus(): Promise<CameraCaptureResult> {
  return capturePhotoWithStatus({
    cameraType: ImagePicker.CameraType.back,
    aspect: [16, 9],
    quality: 0.75,
  });
}

export async function captureOdometerPhoto(): Promise<CapturedAsset | null> {
  const result = await captureOdometerPhotoWithStatus();
  return result.kind === 'captured' ? result.asset : null;
}

/** Kept for debug/telemetry surfaces; primary customer UI should not foreground bytes. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
