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

// Tabs may satisfy the guard two ways:
//  - inline: the tab itself resolves the base via getVerificationApiBaseUrl()
//    and sends the ngrok header on every fetch (garage, escrow);
//  - delegated: the tab routes ALL data access through a canonical API util
//    (marketplaceApi), which is itself asserted below to resolve the base
//    safely and send the ngrok header. Either way the intent holds: no
//    hardcoded host, ngrok-safe fetches, handled failures.
const TABS = ['garage', 'escrow', 'marketplace'] as const;
const DELEGATED: Record<string, string | undefined> = { marketplace: 'marketplaceApi' };

console.log('\n=== MOBILE TAB STABILITY STATIC GUARD (Blocker 3) ===\n');

for (const tab of TABS) {
  const file = path.resolve(process.cwd(), `app/(tabs)/${tab}.tsx`);
  const src = fs.readFileSync(file, 'utf-8');
  const delegatedUtil = DELEGATED[tab];

  test(`${tab}: resolves API base safely (resolver or canonical util)`, () => {
    // Accepted safe patterns: the original verification resolver, the canonical
    // apiBase resolver (apiUrl from utils/apiBase), or a delegated API util.
    const inline = src.includes('getVerificationApiBaseUrl')
      || (src.includes("from '../../utils/apiBase'") && src.includes('apiUrl('));
    const delegated = !!delegatedUtil && src.includes(delegatedUtil);
    assert.ok(inline || delegated, `${tab} resolves its API base via a canonical resolver or ${delegatedUtil}`);
  });

  test(`${tab}: no hardcoded localhost / loopback / raw IP host`, () => {
    // Match hosts in URL or quoted-string form only, so prose in comments
    // (e.g. "…instead of the legacy localhost /api/vehicles array") is exempt.
    const hardcodedHost = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(\.\d{1,3}){3})|['"`](localhost|127\.0\.0\.1|0\.0\.0\.0)['"`:]/;
    assert.ok(!hardcodedHost.test(src), `${tab} has no hardcoded host`);
  });

  test(`${tab}: every fetch sends the ngrok-skip-browser-warning header`, () => {
    // \bfetch\( excludes React Query's refetch() (no word boundary inside "refetch").
    const fetchCount = (src.match(/\bfetch\(/g) || []).length;
    const skipCount = (src.match(/ngrok-skip-browser-warning/g) || []).length;
    if (delegatedUtil && fetchCount === 0) {
      // All fetching is delegated to the canonical util (asserted separately).
      assert.ok(src.includes(delegatedUtil), `${tab} delegates fetching to ${delegatedUtil}`);
      return;
    }
    assert.ok(fetchCount > 0, `${tab} performs at least one fetch`);
    assert.ok(skipCount >= fetchCount, `${tab} sends the ngrok-skip header on all ${fetchCount} fetch call(s) (found ${skipCount})`);
  });

  test(`${tab}: fetch failures are handled (try/catch or React Query)`, () => {
    const hasTryCatch = /try\s*\{/.test(src) && /catch\s*\(/.test(src);
    const usesReactQuery = /useQuery|useMutation/.test(src);
    assert.ok(hasTryCatch || usesReactQuery, `${tab} handles fetch errors (try/catch or useQuery)`);
  });
}

// The canonical util backing delegated tabs must itself be ngrok-safe and
// free of hardcoded hosts — this closes the loop for the delegated pattern.
{
  const utilFile = path.resolve(process.cwd(), 'utils/marketplaceApi.ts');
  const utilSrc = fs.readFileSync(utilFile, 'utf-8');
  test('marketplaceApi util: sends ngrok-skip-browser-warning', () => {
    assert.ok(utilSrc.includes('ngrok-skip-browser-warning'), 'marketplaceApi sends the ngrok-skip header');
  });
  test('marketplaceApi util: no hardcoded localhost / loopback / raw IP host', () => {
    assert.ok(!/localhost|127\.0\.0\.1|0\.0\.0\.0|http:\/\/\d{1,3}(\.\d{1,3}){3}/.test(utilSrc), 'marketplaceApi has no hardcoded host');
  });
}

console.log('\nALL TAB STABILITY GUARD TESTS PASSED');
