/**
 * Static regression guard for Blocker 3 — My Garage / Escrow / Marketplace
 * red-screen crashes during the Phase 7C validation flow.
 * Run with: npx tsx tests/tab-stability-guard.test.ts  (cwd = mobile/)
 *
 * Root cause was: tabs fetched from a hardcoded localhost and omitted the
 * `ngrok-skip-browser-warning` header, so on a physical device the request hit
 * an HTML warning page → JSON.parse threw → red screen. This guard locks in the
 * fix so it cannot silently regress:
 *   1. each tab resolves its API base via getVerificationApiBaseUrl() (no
 *      hardcoded localhost/127.0.0.1/IP),
 *   2. every fetch sends the ngrok-skip-browser-warning header, and
 *   3. failures are handled (try/catch OR React Query useQuery), so a network
 *      error surfaces as state — never an unhandled throw that crashes the tab.
 * Final on-device stability is confirmed by the owner.
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

const TABS = ['garage', 'escrow', 'marketplace'] as const;

console.log('\n=== MOBILE TAB STABILITY STATIC GUARD (Blocker 3) ===\n');

for (const tab of TABS) {
  const file = path.resolve(process.cwd(), `app/(tabs)/${tab}.tsx`);
  const src = fs.readFileSync(file, 'utf-8');

  test(`${tab}: resolves API base via getVerificationApiBaseUrl()`, () => {
    assert.ok(src.includes('getVerificationApiBaseUrl'), `${tab} uses getVerificationApiBaseUrl()`);
  });

  test(`${tab}: no hardcoded localhost / loopback / raw IP host`, () => {
    assert.ok(!/localhost|127\.0\.0\.1|0\.0\.0\.0|http:\/\/\d{1,3}(\.\d{1,3}){3}/.test(src), `${tab} has no hardcoded host`);
  });

  test(`${tab}: every fetch sends the ngrok-skip-browser-warning header`, () => {
    // \bfetch\( excludes React Query's refetch() (no word boundary inside "refetch").
    const fetchCount = (src.match(/\bfetch\(/g) || []).length;
    const skipCount = (src.match(/ngrok-skip-browser-warning/g) || []).length;
    assert.ok(fetchCount > 0, `${tab} performs at least one fetch`);
    assert.ok(skipCount >= fetchCount, `${tab} sends the ngrok-skip header on all ${fetchCount} fetch call(s) (found ${skipCount})`);
  });

  test(`${tab}: fetch failures are handled (try/catch or React Query)`, () => {
    const hasTryCatch = /try\s*\{/.test(src) && /catch\s*\(/.test(src);
    const usesReactQuery = /useQuery|useMutation/.test(src);
    assert.ok(hasTryCatch || usesReactQuery, `${tab} handles fetch errors (try/catch or useQuery)`);
  });
}

console.log('\nALL TAB STABILITY GUARD TESTS PASSED');
