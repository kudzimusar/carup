/**
 * CarUp native camera utilities.
 *
 * Camera capture is transport, not authority. These helpers expose truthful
 * permission/cancellation/error states and normalize an actual expo-camera
 * picture into the private-evidence shape used by existing CarUp flows.
 */
import {
  getCameraPermissionsAsync,
  requestCameraPermissionsAsync,
  type CameraCapturedPicture,
} from 'expo-camera';
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

export type CameraCaptureMode = 'document' | 'selfie' | 'odometer';

export interface CameraCaptureConfiguration {
  mode: CameraCaptureMode;
  facing: 'front' | 'back';
  aspectRatio: number;
  quality: number;
  frame: 'document' | 'face' | 'odometer';
  instruction: string;
}

export const CAMERA_CAPTURE_CONFIG: Record<CameraCaptureMode, CameraCaptureConfiguration> = {
  document: {
    mode: 'document',
    facing: 'back',
    aspectRatio: 4 / 3,
    quality: 0.7,
    frame: 'document',
    instruction: 'Keep all four corners inside the frame',
  },
  selfie: {
    mode: 'selfie',
    facing: 'front',
    aspectRatio: 1,
    quality: 0.8,
    frame: 'face',
    instruction: 'Center your face inside the guide',
  },
  odometer: {
    mode: 'odometer',
    facing: 'back',
    aspectRatio: 16 / 9,
    quality: 0.75,
    frame: 'odometer',
    instruction: 'Keep the full odometer display inside the frame',
  },
};

function permissionState(permission: {
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
}): CameraPermissionState {
  if (permission.status === 'granted') return 'granted';
  if (permission.status === 'undetermined') return 'not_requested';
  return permission.canAskAgain ? 'denied' : 'blocked';
}

export async function getCameraPermissionState(): Promise<CameraPermissionState> {
  try {
    return permissionState(await getCameraPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

export async function requestCameraPermissionState(): Promise<CameraPermissionState> {
  try {
    const existing = await getCameraPermissionsAsync();
    if (existing.status === 'granted') return 'granted';
    if (existing.status === 'denied' && !existing.canAskAgain) return 'blocked';
    return permissionState(await requestCameraPermissionsAsync());
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
 * Legacy boolean helper retained for callers that only need permission state.
 * New capture UI should preserve denied/blocked distinction.
 */
export async function requestCameraPermissions(): Promise<boolean> {
  return (await requestCameraPermissionState()) === 'granted';
}

export function capturedPictureToAsset(
  picture: CameraCapturedPicture | undefined,
): CapturedAsset | null {
  if (!picture?.uri || !picture.base64) return null;

  const mimeType = 'image/jpeg';
  const dataUri = `data:${mimeType};base64,${picture.base64}`;
  const fileSizeBytes = Math.ceil((picture.base64.length * 3) / 4);

  return {
    uri: picture.uri,
    base64: picture.base64,
    dataUri,
    width: picture.width,
    height: picture.height,
    mimeType,
    fileSizeBytes,
  };
}

/** Kept for debug/telemetry surfaces; primary customer UI should not foreground bytes. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
