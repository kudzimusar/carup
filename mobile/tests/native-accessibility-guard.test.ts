import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const primitives = fs.readFileSync(path.join(root, 'components/ui/NativePrimitives.tsx'), 'utf8');
const capture = fs.readFileSync(path.join(root, 'components/capture/CaptureSystem.tsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'app/(tabs)/_layout.tsx'), 'utf8');

assert.doesNotMatch(primitives, /allowFontScaling=\{false\}|maxFontSizeMultiplier=\{1\}/, 'shared primitives must not disable font scaling');
assert.doesNotMatch(capture, /allowFontScaling=\{false\}|maxFontSizeMultiplier=\{1\}/, 'capture flow must not disable font scaling');

assert.match(primitives, /accessibilityRole=["']button["']/, 'button primitives need button semantics');
assert.match(primitives, /accessibilityLabel=/, 'interactive primitives need accessible labels');
assert.match(primitives, /accessibilityState=\{\{ selected:/, 'selected filter state must be exposed');
assert.match(primitives, /accessibilityLiveRegion=["']polite["']/, 'field errors should be announcable');
assert.match(primitives, /minimum:\s*48/, 'shared touch-target token must remain 48dp');
assert.match(shell, /minHeight:\s*48/, 'bottom shell items must remain at least 48dp');

assert.match(capture, /accessibilityLabel=["']Go back["']/, 'capture back action must be labelled');
assert.match(capture, /accessibilityLabel=["']Go back from camera["']/, 'live camera back action must be labelled');
assert.match(capture, /accessibilityLabel=\{taking \? 'Capturing photo' : 'Take photo'\}/, 'camera shutter must expose an accessible label');
assert.match(capture, /Turn flash on|Turn flash off/, 'rear-camera flash control must be labelled');
assert.match(capture, /accessibilityLiveRegion=["']polite["']/, 'capture progress changes must be announcable');
assert.match(capture, /Retake/, 'capture flow must expose an explicit retake action');
assert.match(capture, /Use photo/, 'capture flow must expose an explicit use-photo action');

const coreFiles = [
  'app/(tabs)/index.tsx',
  'app/(tabs)/marketplace.tsx',
  'app/market/results.tsx',
  'app/vehicle/[vin].tsx',
  'app/sell/index.tsx',
  'app/sell/details.tsx',
  'app/(tabs)/garage.tsx',
  'app/(tabs)/inbox.tsx',
  'app/inbox/[threadId].tsx',
  'app/(tabs)/account.tsx',
];
const core = coreFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

assert.doesNotMatch(core, /allowFontScaling=\{false\}|maxFontSizeMultiplier=\{1\}/, 'core screens must allow large text');
assert.doesNotMatch(core, /minHeight:\s*(?:3\d|4[0-7])\b/, 'core interactive minimum heights must not fall below 48dp');
assert.doesNotMatch(core, /min-h-\[(?:3\d|4[0-7])px\]/, 'core interactive utility targets must not fall below 48dp');

console.log('native-accessibility-guard.test: PASS');
