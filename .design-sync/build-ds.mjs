#!/usr/bin/env node
// CarUp design-system package build for the Claude Design sync (cfg.buildCmd).
//
// CarUp's design system lives inside the web app, which ships no library dist/. This script
// compiles the curated DS surface (.design-sync/ds-entry.ts) from the REAL source into a small
// generated package the design-sync converter consumes like any published DS:
//
//   .design-sync/.cache/pkg/
//     package.json            name @carup/design-system, module/types/style pointers
//     dist/index.js           ESM, every npm dependency left external (the converter resolves them)
//     dist/types/**.d.ts      tsc declarations of the same entry (the props contracts)
//     dist/styles.css         the app's own Tailwind + token + font pipeline, compiled
//
// No component is reimplemented: the bundle, types and CSS are all compiled from web/src.
// Run from the repo root: node .design-sync/build-ds.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DS = join(ROOT, '.design-sync')
const PKG = join(DS, '.cache', 'pkg')
const DIST = join(PKG, 'dist')
const TYPES = join(DIST, 'types')
const BIN = join(ROOT, 'node_modules', '.bin')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })

if (process.cwd() !== ROOT) process.chdir(ROOT)
rmSync(PKG, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

// 1. Self-hosted fonts (gitignored @font-face CSS consumed by web/src/styles/fonts.css).
run('npm', ['run', '--silent', 'fonts:ensure'])

// 2. ESM bundle of the curated entry. The web app's path aliases are resolved here; every bare
//    npm import stays external so the converter bundles exactly one copy from node_modules.
const { build } = await import(join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'))
const ALIASES = [
  ['@/', join(ROOT, 'web', 'src') + sep],
  ['@shared/', join(ROOT, 'shared') + sep],
]
await build({
  entryPoints: [join(DS, 'ds-entry.ts')],
  outfile: join(DIST, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  packages: 'external',
  logLevel: 'warning',
  plugins: [{
    name: 'carup-aliases',
    setup(b) {
      b.onResolve({ filter: /^@(shared)?\// }, async (args) => {
        const hit = ALIASES.find(([p]) => args.path.startsWith(p))
        if (!hit) return undefined
        const target = hit[1] + args.path.slice(hit[0].length)
        return b.resolve('./' + relative(args.resolveDir, target).split(sep).join('/'), {
          kind: args.kind, resolveDir: args.resolveDir,
        })
      })
    },
  }],
})

// 3. Declarations (the props contracts), then rewrite the app's path aliases to relative
//    specifiers so the .d.ts tree resolves standalone.
run(join(BIN, 'tsc'), ['-p', join(DS, 'tsconfig.ds.json')])
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.d.ts') ? [p] : []
})
let rewritten = 0
for (const file of walk(TYPES)) {
  const src = readFileSync(file, 'utf8')
  const out = src.replace(/(from\s+|import\(\s*)(['"])@(shared)?\/([^'"]+)\2/g, (_m, lead, q, shared, rest) => {
    const target = shared ? join(TYPES, 'shared', rest) : join(TYPES, 'web', 'src', rest)
    let spec = relative(dirname(file), target).split(sep).join('/')
    if (!spec.startsWith('.')) spec = './' + spec
    rewritten++
    return `${lead}${q}${spec}${q}`
  })
  if (out !== src) writeFileSync(file, out)
}

// 4. CSS: the app's own Tailwind config + global stylesheet (fonts, tokens, base layer).
run(join(BIN, 'tailwindcss'), [
  '-c', join(DS, 'tailwind.ds.config.cjs'),
  '-i', join(ROOT, 'web', 'src', 'index.css'),
  '-o', join(DIST, 'styles.css'),
])

// 5. Package manifest the converter reads.
const webPkg = JSON.parse(readFileSync(join(ROOT, 'web', 'package.json'), 'utf8'))
const typesEntry = relative(PKG, join(TYPES, '.design-sync', 'ds-entry.d.ts')).split(sep).join('/')
if (!existsSync(join(PKG, typesEntry))) throw new Error(`types entry missing: ${typesEntry}`)
writeFileSync(join(PKG, 'package.json'), JSON.stringify({
  name: '@carup/design-system',
  version: /^\d+\.\d+\.\d+/.test(webPkg.version ?? '') ? webPkg.version : '0.0.0',
  private: true,
  type: 'module',
  module: 'dist/index.js',
  main: 'dist/index.js',
  types: typesEntry,
  style: 'dist/styles.css',
  sideEffects: ['*.css'],
}, null, 2) + '\n')

const kb = (p) => `${Math.round(statSync(p).size / 1024)} KB`
console.error(`[build-ds] dist/index.js ${kb(join(DIST, 'index.js'))} · dist/styles.css ${kb(join(DIST, 'styles.css'))} · ${walk(TYPES).length} .d.ts (${rewritten} alias specifiers rewritten)`)
