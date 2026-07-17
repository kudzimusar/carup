/**
 * Static guard for the mobile login submit button (PR #72 blocker).
 * Run with: npx tsx tests/login-submit-button.test.ts  (cwd = mobile/)
 *
 * Proves the radically-simple login layout: the visible marker text and the
 * visible CTA strings are present, the button has a coloured background, real
 * height (minHeight >= 64), no opacity:0, white text, and is not conditionally
 * hidden. These are source-level guards; final visibility is confirmed on device.
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

const loginPath = path.resolve(process.cwd(), 'app/(auth)/login.tsx');
const src = fs.readFileSync(loginPath, 'utf-8');

console.log('\n=== LOGIN SUBMIT BUTTON STATIC TEST ===\n');

const submitIdx = src.indexOf('testID="login-submit"');
const submitBlock = submitIdx > -1 ? src.slice(submitIdx - 200, submitIdx + 700) : '';

test('exact visible marker string is present: VISIBLE LOGIN BUTTON BELOW', () => {
  assert.ok(src.includes('VISIBLE LOGIN BUTTON BELOW'), 'marker text present');
});

test('exact CTA string is present: SIGN IN — VISIBLE CTA', () => {
  assert.ok(src.includes('SIGN IN — VISIBLE CTA'), 'CTA label present');
});

test('submit control declares testID="login-submit"', () => {
  assert.ok(submitIdx > -1, 'login-submit testID present');
});

test('email and password fields are present', () => {
  assert.ok(src.includes('testID="login-email"'), 'email field present');
  assert.ok(src.includes('testID="login-password"'), 'password field present');
});

test('button has a visible coloured background (dark or orange)', () => {
  assert.ok(/backgroundColor:\s*'#(F97316|0F172A)'/.test(submitBlock), 'button has a dark/orange backgroundColor');
});

test('button has a real tappable height (minHeight >= 64)', () => {
  const m = submitBlock.match(/minHeight:\s*(\d+)/) || submitBlock.match(/height:\s*(\d+)/);
  assert.ok(m, 'button declares a (min)height');
  assert.ok(Number(m![1]) >= 64, `button (min)height ${m![1]} is >= 64`);
});

test('button is not invisible (no opacity: 0)', () => {
  assert.ok(!/opacity:\s*0\b/.test(submitBlock), 'button is not opacity:0');
});

test('button text is white (not white-on-white — bg is coloured)', () => {
  assert.ok(/color:\s*'#FFFFFF'/.test(submitBlock), 'button text is white');
});

test('marker appears before the submit button (button is below the marker)', () => {
  const markerIdx = src.indexOf('VISIBLE LOGIN BUTTON BELOW');
  assert.ok(markerIdx > -1 && submitIdx > markerIdx, 'marker precedes the submit button');
});

test('submit button is not conditionally hidden (only `disabled` toggles)', () => {
  const before = src.slice(Math.max(0, submitIdx - 300), submitIdx);
  assert.ok(!/&&\s*\(\s*<(Pressable|TouchableOpacity)[^>]*$/.test(before), 'submit button is not behind a && conditional');
});

test('wrong-password server error remains rendered', () => {
  assert.ok(src.includes('testID="login-server-error"') || src.includes('serverError'), 'server error surface present');
});

console.log('\nALL LOGIN SUBMIT BUTTON TESTS PASSED');
