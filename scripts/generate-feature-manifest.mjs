#!/usr/bin/env node
/**
 * Generate the framework-neutral feature governance manifest.
 *
 * The authoring source of truth is web/src/config/featureRegistry.ts. This
 * script bundles it with esbuild (type-only imports are stripped, so no React
 * or @shared resolution is needed), calls buildFeatureManifest(), and writes a
 * deterministic JSON artifact that the Express backend consumes. The drift test
 * (web/src/config/featureManifest.drift.test.ts) guarantees the committed JSON
 * stays in sync with the registry.
 *
 * Usage: node scripts/generate-feature-manifest.mjs [--check]
 *   --check : exit non-zero if the committed manifest is stale (CI gate)
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, 'web/src/config/featureRegistry.ts')
const outPath = resolve(root, 'shared/navigation/feature-manifest.json')

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'silent',
  external: ['@shared/*'],
})

const code = result.outputFiles[0].text
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const manifest = mod.buildFeatureManifest()
const serialized = JSON.stringify(manifest, null, 2) + '\n'

const check = process.argv.includes('--check')
if (check) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : ''
  if (current !== serialized) {
    console.error('✖ feature-manifest.json is stale. Run: node scripts/generate-feature-manifest.mjs')
    process.exit(1)
  }
  console.log(`✓ feature-manifest.json is in sync (${manifest.length} features)`)
} else {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, serialized)
  console.log(`✓ Wrote ${manifest.length} features → ${outPath}`)
}
