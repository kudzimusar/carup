import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const state = fs.readFileSync(path.join(root, 'utils/captureState.ts'), 'utf8');
const system = fs.readFileSync(path.join(root, 'components/capture/CaptureSystem.tsx'), 'utf8');

for (const required of [
  'CAPTURED',
  'UPLOADING',
  'UPLOADED',
  'OCR_READING',
  'OCR_EXTRACTED',
  'USER_CONFIRMED',
  'NEEDS_REVIEW',
  'UNDER_REVIEW',
  'DOMAIN_VERIFIED',
  'RETRY_REQUIRED',
  'REJECTED',
  'NETWORK_FAILED',
]) {
  assert.match(state, new RegExp(required), `missing capture state ${required}`);
}

for (const component of [
  'CaptureShell',
  'DocumentTypePicker',
  'CaptureGuide',
  'CarUpCameraViewfinder',
  'CapturePreview',
  'UploadProgress',
  'ExtractionField',
  'EvidenceStatus',
  'RetryPanel',
  'PermissionPanel',
]) {
  assert.match(system, new RegExp(`export function ${component}\\b`), `missing capture primitive ${component}`);
}

assert.match(system, /<CameraView\b/, 'capture system must render the Expo live camera viewfinder');
assert.match(system, /takePictureAsync\(/, 'capture system must use a real shutter capture');
assert.match(system, /information-circle-outline/, 'capture instructions must not look like completed automated checks');
assert.doesNotMatch(system, /Perfect lighting|Aligned|Sharp|Document detected/i, 'fake quality signals are prohibited');

console.log('capture-system.test: PASS');
