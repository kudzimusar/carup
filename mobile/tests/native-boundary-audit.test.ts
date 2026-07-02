/**
 * Native boundary audit — STRUCTURAL test (Milestone C governance boundary).
 *
 * For EVERY governed `NATIVE_NAV` tab/drawer entry (an entry whose owning
 * feature is a real, non-placeholder manifest feature), this asserts that the
 * corresponding Expo screen file under `mobile/app/` BOTH imports AND uses
 * `NativeFeatureBoundary` with the OWNER that governs the entry. This closes the
 * gap where a tab is hidden by governance but a deep link / typed route / the
 * INITIAL navigation could still render the screen unguarded.
 *
 * Pure + node-safe: it reads source files from disk and inspects the
 * NATIVE_NAV manifest. No Expo / react-native runtime. Run with:
 *   npx tsx tests/native-boundary-audit.test.ts
 *
 * Exemptions: `placement: 'none'` entries are deep-link route boundaries (not a
 * tab/drawer surface) — out of scope here. A public/utility route with NO owning
 * feature would also be exempt; there are none today.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NATIVE_NAV,
  resolveEntryOwner,
} from '../navigation/nativeNavigationManifest';
import { getFeatureById, getStaticLifecycle } from '../navigation/featureManifest';
import type { UserRole } from '@shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');

let PASSED = 0;
let FAILED = 0;
const FAILURES: { name: string; error: unknown }[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    PASSED++;
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    FAILED++;
    FAILURES.push({ name, error });
  }
}

const ALL_ROLES: (UserRole | null)[] = [
  'owner',
  'dealer',
  'mechanic',
  'bank',
  'insurance',
  'government',
  'admin',
  null,
];

/** Lifecycles that mark an entry as a planned/placeholder surface (exempt). */
const PLACEHOLDER_LIFECYCLES = new Set(['planned']);

/**
 * Map a manifest `expoRoute` (e.g. `/(tabs)/index`, `/vehicle/[vin]`) to the
 * Expo screen file under `mobile/app/`. Expo Router resolves `index` to the
 * directory's index file; bracketed `[param]` segments are literal filenames.
 */
function screenFileFor(expoRoute: string): string {
  const rel = expoRoute.replace(/^\//, '');
  return path.join(MOBILE_ROOT, 'app', `${rel}.tsx`);
}

function readScreen(expoRoute: string): string {
  const file = screenFileFor(expoRoute);
  return readFileSync(file, 'utf8');
}

/**
 * Is this entry a GOVERNED tab/drawer surface that requires a route-level
 * boundary? True when it is placed on a tab/drawer AND every owner it can
 * resolve to is a real, non-placeholder manifest feature.
 */
function isGovernedSurface(entry: (typeof NATIVE_NAV)[number]): boolean {
  if (entry.placement !== 'tab' && entry.placement !== 'drawer') return false;
  // Resolve owners across all roles the entry can appear for.
  const owners = entry.resolveFeatureId
    ? ALL_ROLES.map((r) => entry.resolveFeatureId!(r))
    : [resolveEntryOwner(entry, null)];
  for (const ownerId of owners) {
    const feature = getFeatureById(ownerId);
    if (!feature) return false; // unowned ⇒ not a governed surface (exempt)
    if (PLACEHOLDER_LIFECYCLES.has(getStaticLifecycle(feature))) return false;
  }
  return true;
}

console.log('\n=== NATIVE BOUNDARY AUDIT (STRUCTURAL) TEST ===\n');

const governed = NATIVE_NAV.filter(isGovernedSurface);

test('there is at least one governed tab/drawer surface to audit', () => {
  assert.ok(governed.length >= 5, `expected ≥5 governed surfaces, got ${governed.length}`);
});

for (const entry of governed) {
  test(`${entry.id} (${entry.expoRoute}) imports NativeFeatureBoundary`, () => {
    const src = readScreen(entry.expoRoute);
    assert.match(
      src,
      /import\s+\{[^}]*\bNativeFeatureBoundary\b[^}]*\}\s+from\s+['"][^'"]*NativeFeatureBoundary['"]/,
      `${entry.expoRoute} must import NativeFeatureBoundary`,
    );
  });

  test(`${entry.id} (${entry.expoRoute}) wraps its screen in <NativeFeatureBoundary>`, () => {
    const src = readScreen(entry.expoRoute);
    assert.match(
      src,
      /<NativeFeatureBoundary\b/,
      `${entry.expoRoute} must render <NativeFeatureBoundary>`,
    );
  });

  test(`${entry.id} (${entry.expoRoute}) boundary is owned by the governing feature`, () => {
    const src = readScreen(entry.expoRoute);
    // Extract the opening <NativeFeatureBoundary ...> tag (props span lines).
    const open = src.match(/<NativeFeatureBoundary\b[\s\S]*?>/);
    assert.ok(open, `${entry.expoRoute}: could not find the <NativeFeatureBoundary> opening tag`);
    const tag = open![0];
    assert.match(tag, /\bfeatureId=/, `${entry.expoRoute}: boundary must pass a featureId`);

    if (entry.resolveFeatureId) {
      // Role-resolved owner (e.g. the dashboard). The screen resolves the owner
      // at render — `featureId={...}` (an expression, not a static string) — and
      // the role-resolved owner pattern (e.g. `${role}.overview`) must appear.
      const sample = entry.resolveFeatureId('owner'); // e.g. "owner.overview"
      const suffix = sample.includes('.') ? sample.slice(sample.indexOf('.')) : sample; // ".overview"
      assert.match(
        tag,
        /featureId=\{[^}]+\}/,
        `${entry.expoRoute}: a role-resolved owner must pass featureId as an expression`,
      );
      assert.ok(
        src.includes(suffix),
        `${entry.expoRoute}: role-resolved owner pattern "${suffix}" not found in the screen`,
      );
    } else {
      // Static owner: the exact featureId string must be on the boundary tag.
      const ownerId = resolveEntryOwner(entry, null);
      assert.ok(
        new RegExp(`featureId=["']${ownerId.replace(/\./g, '\\.')}["']`).test(tag),
        `${entry.expoRoute}: boundary featureId must be "${ownerId}" (the governing owner)`,
      );
    }
  });
}

// Explicit regression guard for the two screens this work newly wrapped, so a
// future refactor that drops the wrapper fails loudly with a named test.
test('marketplace screen is route-level governed by product.marketplace', () => {
  const src = readScreen('/(tabs)/marketplace');
  assert.match(src, /<NativeFeatureBoundary\b[\s\S]*?featureId="product\.marketplace"[\s\S]*?>/);
});

test('dashboard (index) screen is route-level governed by the role overview owner', () => {
  const src = readScreen('/(tabs)/index');
  assert.match(src, /<NativeFeatureBoundary\b/);
  assert.match(src, /\$\{role\}\.overview/, 'dashboard must resolve `${role}.overview` as its owner');
  // Anonymous (no role) must redirect to auth rather than render.
  assert.match(src, /Redirect\s+href="\/login"/, 'anon dashboard must <Redirect href="/login" />');
});

console.log(`\n${PASSED} passed, ${FAILED} failed.`);
if (FAILED > 0) {
  for (const f of FAILURES) {
    console.error(`\n--- ${f.name} ---`);
    console.error(f.error);
  }
  process.exit(1);
}
console.log('\nALL NATIVE BOUNDARY AUDIT TESTS PASSED');
