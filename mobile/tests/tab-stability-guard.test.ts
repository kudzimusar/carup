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
/** The text of every `fetch( … )` call, balanced from its opening parenthesis. */
function fetchCalls(src: string): string[] {
  const calls: string[] = [];
  const re = /\bfetch\(/g; // \b excludes React Query's refetch()
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') depth -= 1;
    }
    calls.push(src.slice(m.index, i));
  }
  return calls;
}

/** Identifiers bound to an object literal that carries the header: `const headers = { …ngrok-skip-browser-warning… }`. */
function headerCarriers(src: string): Set<string> {
  const carriers = new Set<string>();
  const re = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
    }
    if (src.slice(m.index, i).includes('ngrok-skip-browser-warning')) carriers.add(m[1]);
  }
  return carriers;
}

/** A call sends the header if it carries it inline or passes, as `headers`, an object that carries it. */
function sendsNgrokHeader(call: string, carriers: Set<string>): boolean {
  if (call.includes('ngrok-skip-browser-warning')) return true;
  const named = /\bheaders\s*:\s*([A-Za-z_$][\w$]*)/.exec(call);
  if (named) return carriers.has(named[1]);
  return carriers.has('headers') && /[{,]\s*headers\s*[,}]/.test(call);
}

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
    if (delegatedUtil && fetchCount === 0) {
      // All fetching is delegated to the canonical util (asserted separately).
      assert.ok(src.includes(delegatedUtil), `${tab} delegates fetching to ${delegatedUtil}`);
      return;
    }
    assert.ok(fetchCount > 0, `${tab} performs at least one fetch`);
    // Judged per call, not by counting: a shared headers object (escrow) is one literal serving two calls,
    // and a count would also pass one call with two literals beside another call with none.
    const carriers = headerCarriers(src);
    const missing = fetchCalls(src).filter((call) => !sendsNgrokHeader(call, carriers));
    assert.equal(missing.length, 0, `${tab}: ${missing.length} of ${fetchCount} fetch call(s) send no ngrok-skip header: ${missing.map((c) => c.slice(0, 60)).join(' | ')}`);
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
