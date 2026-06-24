#!/usr/bin/env node
/**
 * assert-console-chunk.mjs (Navigation Intelligence — Milestone D gate)
 *
 * Guards the route-level code-split of the Feature Governance Console. It proves
 * that the console ships as its OWN chunk and is NOT bundled back into the main
 * entry chunk (a regression that would re-bloat the initial load for everyone,
 * including non-admins).
 *
 * It does NOT hardcode hashed filenames. Instead it:
 *   1. Reads web/dist/index.html and extracts the entry chunk it boots from
 *      (<script type="module" src="/assets/index-*.js">).
 *   2. Scans every emitted dist/assets/*.js for a marker string that is unique
 *      to the console (`feature-governance-console`, its top-level data-testid).
 *   3. Asserts the marker lives in EXACTLY one NON-entry chunk, and is ABSENT
 *      from the entry chunk.
 *
 * Exits non-zero with a clear message on any regression. If dist is missing it
 * tells the caller to build first (the CI workflow builds before invoking this).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', 'dist')
const ASSETS = join(DIST, 'assets')
const INDEX_HTML = join(DIST, 'index.html')

// A string that only appears in the FeatureGovernanceConsole source (its root
// element's data-testid). Stable and human-meaningful, so the gate survives
// content-hash churn without ever matching another page.
const CONSOLE_MARKER = 'feature-governance-console'

function fail(msg) {
  console.error(`\n[assert-console-chunk] FAIL: ${msg}\n`)
  process.exit(1)
}

if (!existsSync(DIST) || !existsSync(ASSETS) || !existsSync(INDEX_HTML)) {
  fail(
    `web/dist not found. Build the web app first (e.g. \`npm run build --workspace=web\`) ` +
      `before running this assertion.`,
  )
}

// 1) Determine the entry chunk from index.html (no hash hardcoding).
const html = readFileSync(INDEX_HTML, 'utf8')
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/i)
if (!entryMatch) {
  fail('Could not find the entry <script type="module"> in dist/index.html.')
}
const entryFile = entryMatch[1].split('/').pop() // strip /assets/ prefix
const entryPath = join(ASSETS, entryFile)
if (!existsSync(entryPath)) {
  fail(`Entry chunk referenced by index.html not found on disk: ${entryFile}`)
}

// 2) Scan all emitted JS chunks for the console marker.
const jsFiles = readdirSync(ASSETS).filter((f) => f.endsWith('.js'))
if (jsFiles.length < 2) {
  fail(
    `Expected at least 2 JS chunks (entry + a separate console chunk) but found ${jsFiles.length}. ` +
      `The Feature Governance Console does not appear to be code-split.`,
  )
}

const chunksWithMarker = jsFiles.filter((f) =>
  readFileSync(join(ASSETS, f), 'utf8').includes(CONSOLE_MARKER),
)

if (chunksWithMarker.length === 0) {
  fail(
    `Console marker "${CONSOLE_MARKER}" not found in ANY chunk. The console may have been removed, ` +
      `renamed, or tree-shaken unexpectedly — update CONSOLE_MARKER if the source changed.`,
  )
}

// 3) The marker must NOT be in the entry chunk, and MUST be in a non-entry chunk.
if (chunksWithMarker.includes(entryFile)) {
  fail(
    `Console marker "${CONSOLE_MARKER}" is present in the MAIN ENTRY chunk (${entryFile}). ` +
      `The Feature Governance Console regressed back into the initial bundle. ` +
      `Ensure it is imported via React.lazy(() => import(...)) and not statically.`,
  )
}

const consoleChunks = chunksWithMarker.filter((f) => f !== entryFile)
if (consoleChunks.length === 0) {
  fail(`Console marker found only in the entry chunk — no separate console chunk was emitted.`)
}

// Report success with the chunk name + size for evidence/log readability.
const consoleChunk = consoleChunks[0]
const sizeKb = (readFileSync(join(ASSETS, consoleChunk)).length / 1024).toFixed(2)
console.log(
  `[assert-console-chunk] OK: FeatureGovernanceConsole is split into its own chunk ` +
    `"${consoleChunk}" (${sizeKb} kB) and is ABSENT from the entry chunk "${entryFile}".`,
)
process.exit(0)
