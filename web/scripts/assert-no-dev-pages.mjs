#!/usr/bin/env node
/**
 * assert-no-dev-pages.mjs (RX07-CERT-02 F4 gate)
 *
 * Proves a PRODUCTION build contains no developer-only page code. A route hidden at runtime is not
 * enough: if the bundler still emits the module, it is a publicly fetchable file.
 *
 * Every page under web/src/pages/dev/ is a developer-only module. For each one this checks the built
 * output (default web/dist, or the directory given as the first argument) for:
 *   1. an emitted chunk named after the module (`<Name>-*.js`, `<Name>-*.css`);
 *   2. the module's own data-testid markers in ANY emitted text file;
 *   3. its route path (`/dev/...`) in any emitted file, including index.html;
 *   4. any import/preload reference to such a chunk (covered by 1 + 3: no file, no name).
 *
 * Exit 0 = clean; exit 1 lists every hit. Read-only.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DIST = process.argv[2] || join(here, '..', 'dist')
const DEV_DIR = join(here, '..', 'src', 'pages', 'dev')
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`[assert-no-dev-pages] FAIL: no build at ${DIST} (index.html missing). Build first.`)
  process.exit(1)
}

const devModules = readdirSync(DEV_DIR).filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f))
const needles = []
for (const file of devModules) {
  const name = basename(file, extname(file))
  const src = readFileSync(join(DEV_DIR, file), 'utf8')
  needles.push({ module: name, kind: 'chunk-name', test: (f) => basename(f).startsWith(`${name}-`) })
  for (const m of new Set([...src.matchAll(/data-testid="([^"]+)"/g)].map((x) => x[1]))) {
    needles.push({ module: name, kind: `marker "${m}"`, text: `"${m}"` })
  }
}
const appSrc = readFileSync(join(here, '..', 'src', 'App.tsx'), 'utf8')
for (const m of new Set([...appSrc.matchAll(/path="(\/dev\/[^"]+)"/g)].map((x) => x[1]))) {
  needles.push({ module: 'route', kind: `route "${m}"`, text: m })
}

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
const files = walk(DIST)
const TEXT = /\.(js|mjs|css|html|json|map|txt|svg|webmanifest)$/
const hits = []
for (const f of files) {
  const rel = f.slice(DIST.length + 1)
  let text = null
  for (const n of needles) {
    if (n.test && n.test(f)) hits.push(`${rel}: emitted ${n.module} chunk`)
    if (n.text && TEXT.test(f)) {
      text ??= readFileSync(f, 'utf8')
      if (text.includes(n.text)) hits.push(`${rel}: contains ${n.kind} (${n.module})`)
    }
  }
}

if (hits.length) {
  console.error(`[assert-no-dev-pages] FAIL: developer-only page code found in ${DIST}:\n  - ${hits.join('\n  - ')}`)
  process.exit(1)
}
console.log(`[assert-no-dev-pages] OK: ${devModules.length} developer-only module(s) (${devModules.join(', ')}), ${needles.length} checks, ${files.length} emitted files — none present.`)
