/**
 * Agent 8 mobile communication contract checks.
 * Run with: npx tsx tests/communication-api.test.ts
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    throw error;
  }
}

const apiFile = readFileSync(resolve('utils/communicationApi.ts'), 'utf8');
const tabFile = readFileSync(resolve('app/(tabs)/_layout.tsx'), 'utf8');
const screenFile = readFileSync(resolve('app/(tabs)/communications.tsx'), 'utf8');

console.log('\n=== AGENT 8 MOBILE COMMUNICATION API TEST ===\n');

test('mobile communication client uses the canonical backend routes', () => {
  for (const marker of [
    '/api/communications/notifications',
    '/api/communications/threads',
    '/api/communications/preferences',
    '/api/communications/share',
  ]) {
    assert.ok(apiFile.includes(marker), `${marker} should be used`);
  }
});

test('mobile communication client follows CSRF/auth contract', () => {
  assert.ok(apiFile.includes('fetchCsrfToken'));
  assert.ok(apiFile.includes('x-session-token'));
  assert.ok(apiFile.includes('x-stakeholder-role'));
  assert.ok(apiFile.includes('EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK'));
});

test('mobile tab exposes notification, support, share, and preference workflows', () => {
  assert.ok(tabFile.includes('name="communications"'));
  for (const marker of ['listCommunicationNotifications', 'sendCommunicationMessage', 'createCommunicationShare', 'updateCommunicationPreferences']) {
    assert.ok(screenFile.includes(marker), `${marker} should be wired`);
  }
});

console.log('\nALL AGENT 8 MOBILE COMMUNICATION TESTS PASSED');

