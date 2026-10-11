import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const camera = fs.readFileSync(path.join(root, 'utils/camera.ts'), 'utf8');
const system = fs.readFileSync(path.join(root, 'components/capture/CaptureSystem.tsx'), 'utf8');
const front = fs.readFileSync(path.join(root, 'app/(auth)/verification/capture-front.tsx'), 'utf8');
const back = fs.readFileSync(path.join(root, 'app/(auth)/verification/capture-back.tsx'), 'utf8');
const selfie = fs.readFileSync(path.join(root, 'app/(auth)/verification/selfie.tsx'), 'utf8');
const garage = fs.readFileSync(path.join(root, 'app/(tabs)/garage.tsx'), 'utf8');
const verificationApi = fs.readFileSync(path.join(root, 'utils/verificationApi.ts'), 'utf8');
const result = fs.readFileSync(path.join(root, 'app/(auth)/verification/result.tsx'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

assert.equal(pkg.dependencies?.['expo-camera'], '~17.0.10', 'SDK 54 camera dependency must stay on Expo resolver-compatible line');
assert.ok(
  app.expo.plugins.some((entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-camera'),
  'expo-camera config plugin must be present',
);

assert.match(camera, /from 'expo-camera'/, 'camera utilities must use expo-camera');
assert.doesNotMatch(camera, /launchCameraAsync|expo-image-picker/, 'capture must not hand off to the OS camera picker');
for (const state of ['not_requested', 'granted', 'denied', 'blocked', 'unavailable']) {
  assert.match(camera, new RegExp(`['"]${state}['"]`), `permission state missing: ${state}`);
}

assert.match(system, /export function CarUpCameraViewfinder\b/, 'CarUp live viewfinder primitive must exist');
assert.match(system, /<CameraView\b/, 'viewfinder must render a real CameraView');
assert.match(system, /takePictureAsync\(/, 'viewfinder shutter must capture a real camera picture');
assert.match(system, /base64:\s*true/, 'captured picture must be usable by the existing private-evidence transport');
assert.match(system, /exif:\s*false/, 'camera capture must not request EXIF');
assert.match(system, /Turn flash on|Turn flash off/, 'rear-camera flash control must be exposed');
assert.match(system, /Camera access is blocked/, 'permanently blocked permission state must be explicit');
assert.match(system, /Camera access is needed/, 'requestable permission state must be explicit');
assert.match(system, /openCameraSettings/, 'blocked permission must offer Settings');
assert.match(system, /information-circle-outline/, 'capture guidance must use neutral instructional iconography');
assert.doesNotMatch(system, /✓\s*(Aligned|Sharp|Perfect lighting|Document detected)/i);
assert.doesNotMatch(system, /frameAligned|isAligned|isWellLit|isBlurry/i);

for (const [name, source, mode] of [
  ['front', front, 'document'],
  ['back', back, 'document'],
  ['selfie', selfie, 'selfie'],
  ['odometer', garage, 'odometer'],
] as const) {
  assert.match(source, /<CarUpCameraViewfinder/, `${name} must use the shared live viewfinder`);
  assert.match(source, new RegExp(`mode=["']${mode}["']`), `${name} must use ${mode} configuration`);
  assert.match(source, /<CapturePreview/, `${name} must show an actual captured preview`);
}

assert.match(front, /onRetake=\{handleRetake\}/);
assert.match(back, /onRetake=\{handleRetake\}/);
assert.match(selfie, /onRetake=\{handleRetake\}/);
assert.match(garage, /onRetake=\{\(\) =>/);

for (const source of [front, back, selfie]) {
  const captured = source.slice(source.indexOf('onCaptured='), source.indexOf('onClose=', source.indexOf('onCaptured=')));
  assert.doesNotMatch(captured, /setCaptured(Front|Back|Selfie)/, 'camera capture alone must not persist the selected identity photo');
}
assert.match(front, /handleUse[\s\S]*setCapturedFront\(asset\.dataUri\)/, 'front persists only after Use photo');
assert.match(back, /handleUse[\s\S]*setCapturedBack\(asset\.dataUri\)/, 'back persists only after Use photo');
assert.match(selfie, /handleUse[\s\S]*setCapturedSelfie\(asset\.dataUri\)/, 'selfie persists only after Use selfie');

assert.match(camera, /document:[\s\S]*facing:\s*'back'[\s\S]*frame:\s*'document'/);
assert.match(camera, /selfie:[\s\S]*facing:\s*'front'[\s\S]*frame:\s*'face'/);
assert.match(camera, /odometer:[\s\S]*facing:\s*'back'[\s\S]*frame:\s*'odometer'/);

assert.doesNotMatch(verificationApi, /verification-sessions\/\$\{[^}]+\}\/confirm|verification-sessions\/[^'"]*confirm/i,
  'identity API exposes no extracted-field confirmation mutation');
assert.doesNotMatch(result, /USER_CONFIRMED|Details confirmed/,
  'Identity result must not imply that extracted values were user-confirmed when the backend has no confirmation contract');

console.log('camera-viewfinder.test: PASS');
