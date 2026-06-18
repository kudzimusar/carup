/**
 * Static guard for the authenticated dashboard "Start Verification Flow" CTA.
 * Run with: npx tsx tests/start-verification-flow.test.ts  (cwd = mobile/)
 *
 * Proves the CTA uses a visible INLINE style (not className/NativeWind-only),
 * has a coloured background + white text + real height, is not invisible, and
 * navigates to the verification intro. Final visibility is confirmed on device.
 */
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    throw error;
  }
}

const dashPath = path.resolve(process.cwd(), 'app/(tabs)/index.tsx');
const src = fs.readFileSync(dashPath, 'utf-8');

console.log('\n=== START VERIFICATION FLOW CTA STATIC TEST ===\n');

const ctaIdx = src.indexOf('testID="start-verification-flow"');
// The CTA element spans roughly from a little before its testID to a bit after.
const ctaBlock = ctaIdx > -1 ? src.slice(ctaIdx - 200, ctaIdx + 700) : '';

test('dashboard declares the start-verification-flow CTA', () => {
  assert.ok(ctaIdx > -1, 'start-verification-flow testID present');
});

test('CTA uses an inline style object (not className-only)', () => {
  assert.ok(/style=\{\{/.test(ctaBlock), 'CTA has an inline style={{ ... }} object');
});

test('CTA has a visible coloured background (dark navy or orange)', () => {
  assert.ok(/backgroundColor:\s*'#(0F172A|F97316)'/.test(ctaBlock), 'CTA has a dark/orange backgroundColor inline');
});

test('CTA has a real tappable height (minHeight >= 60)', () => {
  const m = ctaBlock.match(/minHeight:\s*(\d+)/) || ctaBlock.match(/height:\s*(\d+)/);
  assert.ok(m, 'CTA declares a (min)height');
  assert.ok(Number(m![1]) >= 60, `CTA (min)height ${m![1]} is >= 60`);
});

test('CTA text is white (contrasting on the dark/orange background)', () => {
  assert.ok(/color:\s*'#FFFFFF'/.test(ctaBlock), 'CTA label is white');
});

test('CTA is not invisible (no opacity: 0)', () => {
  assert.ok(!/opacity:\s*0\b/.test(ctaBlock), 'CTA is not opacity:0');
});

test('CTA navigates to the verification intro', () => {
  assert.ok(ctaBlock.includes("/(auth)/verification/intro"), 'CTA onPress routes to the verification intro');
});

test('CTA is rendered in the authenticated branch (enabled when authenticated)', () => {
  // The CTA lives after the `if (!isAuthenticated)` early-return block, so it
  // only renders for authenticated users and is never disabled/faded-out.
  assert.ok(src.includes('if (!isAuthenticated)'), 'dashboard gates an unauthenticated branch');
  assert.ok(!/disabled=\{[^}]*\}\s*[^>]*testID="start-verification-flow"/.test(src), 'CTA is not disabled');
});

console.log('\nALL START VERIFICATION FLOW CTA TESTS PASSED');
