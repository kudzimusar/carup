import type { CapturedAsset } from './camera';

const PLACEHOLDER_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const PLACEHOLDER_URI = 'data:image/png;base64,' + PLACEHOLDER_BASE64;

const PLACEHOLDER_ASSET: CapturedAsset = {
  uri: PLACEHOLDER_URI,
  base64: PLACEHOLDER_BASE64,
  dataUri: PLACEHOLDER_URI,
  width: 1,
  height: 1,
  mimeType: 'image/png',
  fileSizeBytes: Math.ceil((PLACEHOLDER_BASE64.length * 3) / 4),
};

/**
 * Simulate a camera capture for dev-only testing.
 * Returns a tiny placeholder image after a short delay to mimic camera behavior.
 */
export async function simulateCapture(): Promise<CapturedAsset | null> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return PLACEHOLDER_ASSET;
}
