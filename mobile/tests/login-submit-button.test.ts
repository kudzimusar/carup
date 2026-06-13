/**
 * Static guard for the mobile login submit button (PR #72 blocker).
 * Run with: npx tsx tests/login-submit-button.test.ts  (cwd = mobile/)
 *
 * Proves the Sign In button exists, is the fixed bottom CTA rendered OUTSIDE
 * the ScrollView (so it is always visible on iPhone, not dependent on scrolling
 * past the footer or hidden under the keyboard), and is not conditionally hidden.
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

test('login screen declares a Sign In submit button', () => {
  assert.ok(src.includes('testID="login-submit"'), 'login-submit testID present');
  assert.ok(src.includes('Sign In'), 'Sign In label present');
});

test('email and password fields are present', () => {
  assert.ok(src.includes('testID="login-email"'), 'email field present');
  assert.ok(src.includes('testID="login-password"'), 'password field present');
});

test('Sign In button is rendered OUTSIDE the ScrollView (fixed, always visible)', () => {
  const scrollClose = src.lastIndexOf('</ScrollView>');
  const submitIdx = src.indexOf('testID="login-submit"');
  assert.ok(scrollClose > -1, 'ScrollView present');
  assert.ok(submitIdx > scrollClose, 'submit button appears after </ScrollView> (fixed bottom CTA)');
});

test('Sign In button is not conditionally hidden (only `disabled` toggles)', () => {
  const idx = src.indexOf('testID="login-submit"');
  const before = src.slice(Math.max(0, idx - 300), idx);
  // The Pressable must not be wrapped in a `{cond && (` boolean-gated render.
  assert.ok(!/&&\s*\(\s*<Pressable[^>]*$/.test(before), 'submit button is not behind a && conditional');
});

test('wrong-password server error remains rendered', () => {
  assert.ok(src.includes('testID="login-server-error"') || src.includes('serverError'), 'server error surface present');
});

console.log('\nALL LOGIN SUBMIT BUTTON TESTS PASSED');
