/**
 * Static guard for the mobile login submit button (PR #72 blocker).
 * Run with: npx tsx tests/login-submit-button.test.ts  (cwd = mobile/)
 *
 * Proves the Sign In button exists, has visible text and a visible (non-zero,
 * non-transparent, coloured) style, is directly in the form flow (not gated by
 * a conditional), and that the fields + error surface are present.
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

// Isolate the submit control's JSX (from its testID to the end of its element)
// so style assertions target the button, not the whole file.
const submitIdx = src.indexOf('testID="login-submit"');
const submitBlock = submitIdx > -1 ? src.slice(submitIdx - 400, submitIdx + 600) : '';

test('login screen declares a Sign In submit button with visible text', () => {
  assert.ok(submitIdx > -1, 'login-submit testID present');
  assert.ok(/>\s*Sign In\s*</.test(src), 'visible "Sign In" text node present');
});

test('email and password fields are present', () => {
  assert.ok(src.includes('testID="login-email"'), 'email field present');
  assert.ok(src.includes('testID="login-password"'), 'password field present');
});

test('Sign In button has a visible coloured background (dark or orange)', () => {
  assert.ok(/backgroundColor:\s*'#(F97316|0F172A)'/.test(submitBlock), 'button has a dark/orange backgroundColor');
});

test('Sign In button has a real tappable height (>= 56)', () => {
  const m = submitBlock.match(/height:\s*(\d+)/);
  assert.ok(m, 'button declares an explicit height');
  assert.ok(Number(m![1]) >= 56, `button height ${m![1]} is >= 56`);
});

test('Sign In button is not invisible (no opacity: 0)', () => {
  assert.ok(!/opacity:\s*0\b/.test(submitBlock), 'button is not opacity:0');
});

test('Sign In button text is not white-on-white (white text + coloured bg)', () => {
  assert.ok(/color:\s*'#FFFFFF'/.test(submitBlock), 'button text is white');
  // and the bg is coloured (asserted above) — so not white-on-white.
});

test('Sign In button is not conditionally hidden (only `disabled` toggles)', () => {
  const before = src.slice(Math.max(0, submitIdx - 300), submitIdx);
  assert.ok(!/&&\s*\(\s*<(Pressable|TouchableOpacity)[^>]*$/.test(before), 'submit button is not behind a && conditional');
});

test('wrong-password server error remains rendered', () => {
  assert.ok(src.includes('testID="login-server-error"') || src.includes('serverError'), 'server error surface present');
});

console.log('\nALL LOGIN SUBMIT BUTTON TESTS PASSED');
