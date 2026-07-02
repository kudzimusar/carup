#!/usr/bin/env node
/**
 * Generate the framework-neutral navigation governance artifacts.
 *
 * Two deterministic JSON artifacts are emitted, both bundled with esbuild
 * (type-only imports are stripped, so no React or @shared resolution is needed):
 *
 *  1. shared/navigation/feature-manifest.json — the governance manifest, built
 *     from web/src/config/featureRegistry.ts via buildFeatureManifest(). The
 *     drift test (web/src/config/featureManifest.drift.test.ts) guarantees the
 *     committed JSON stays in sync with the registry.
 *
 *  2. shared/navigation/navigation-nodes.json — the backend-authoritative
 *     allowlist of navigation NODE ids (e.g. 'buy.shop-all', 'sell.your-car'),
 *     derived from web/src/config/navigationManifest.ts NAVIGATION_MANIFEST. The
 *     navigation analytics service consumes this so an inbound `node_id` that is
 *     not a real nav node (an email / VIN / phone / arbitrary string) is replaced
 *     with null and never persisted — closing the P2 privacy leak.
 *
 * Usage: node scripts/generate-feature-manifest.mjs [--check]
 *   --check : exit non-zero if EITHER committed artifact is stale (CI drift gate)
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

/** Bundle a TS entry to an ESM module and import it without a browser runtime. */
async function importTsModule(entryPath) {
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
    external: ['@shared/*'],
  })
  const code = result.outputFiles[0].text
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}

/** Write (or --check) a serialized artifact; returns true on success. */
function emit(outPath, serialized, label, summary) {
  if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : ''
    if (current !== serialized) {
      console.error(`✖ ${label} is stale. Run: node scripts/generate-feature-manifest.mjs`)
      return false
    }
    console.log(`✓ ${label} is in sync (${summary})`)
    return true
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, serialized)
  console.log(`✓ Wrote ${summary} → ${outPath}`)
  return true
}

// ── 1. Feature governance manifest (from featureRegistry.ts) ─────────────────
const featureMod = await importTsModule(resolve(root, 'web/src/config/featureRegistry.ts'))
const manifest = featureMod.buildFeatureManifest()
const manifestSerialized = JSON.stringify(manifest, null, 2) + '\n'
const featureOut = resolve(root, 'shared/navigation/feature-manifest.json')

// ── 2. Navigation node-id allowlist (from navigationManifest.ts) ─────────────
const navMod = await importTsModule(resolve(root, 'web/src/config/navigationManifest.ts'))
// Deterministic, de-duplicated, sorted array of every NAVIGATION_MANIFEST node id.
const navNodeIds = [...new Set(navMod.NAVIGATION_MANIFEST.map((n) => n.id))].sort((a, b) => a.localeCompare(b))
const navNodesSerialized = JSON.stringify(navNodeIds, null, 2) + '\n'
const navNodesOut = resolve(root, 'shared/navigation/navigation-nodes.json')

const okFeature = emit(featureOut, manifestSerialized, 'feature-manifest.json', `${manifest.length} features`)
const okNavNodes = emit(navNodesOut, navNodesSerialized, 'navigation-nodes.json', `${navNodeIds.length} nav nodes`)

if (check && (!okFeature || !okNavNodes)) process.exit(1)
