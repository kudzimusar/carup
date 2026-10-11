import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const customerFiles = [
  'app/(auth)/verification/intro.tsx',
  'app/(auth)/verification/document-select.tsx',
  'app/(auth)/verification/capture-front.tsx',
  'app/(auth)/verification/capture-back.tsx',
  'app/(auth)/verification/selfie.tsx',
  'app/(auth)/verification/liveness.tsx',
  'app/(auth)/verification/review.tsx',
  'app/(auth)/verification/processing.tsx',
  'app/(auth)/verification/result.tsx',
];

const source = customerFiles
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');

for (const phrase of [
  'Backend OCR Verified',
  'OCR confidence',
  'encrypted tunnel',
  'ZIMBABWE RESUMABLE NETWORK BUFFER',
  'multi-tenant',
  'provider gateway',
  'AI gateway',
  'Secure KYC Register Record',
]) {
  assert.equal(
    source.toLowerCase().includes(phrase.toLowerCase()),
    false,
    `customer capture UI contains prohibited technical phrase: ${phrase}`,
  );
}

for (const fakeMeasuredSignal of [
  'Perfect lighting',
  'Document detected',
  'frameAligned',
  'isAligned',
  'isWellLit',
  'isBlurry',
]) {
  assert.equal(
    source.includes(fakeMeasuredSignal),
    false,
    `capture UI contains an unsupported measured-quality signal: ${fakeMeasuredSignal}`,
  );
}

assert.match(
  fs.readFileSync(path.join(root, 'app/(auth)/verification/liveness.tsx'), 'utf8'),
  /real biometric liveness provider is not active|did not perform biometric liveness/i,
  'development liveness route must remain explicitly non-authoritative',
);

console.log('native-customer-language-guard.test: PASS');
