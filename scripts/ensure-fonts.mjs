/**
 * RX-02A S1-1 — self-hosted font packaging.
 *
 * Approved typography ships from pinned @fontsource packages
 * (@fontsource/inter@5.2.5, @fontsource/jetbrains-mono@5.2.5 — latin
 * subsets, woff2). This script reads the woff2 files from node_modules,
 * verifies each one against SHA-256 + byte length recorded in
 * scripts/font-manifest.json (npm already enforces package integrity via
 * the lockfile; the manifest hash is an independent second check), and
 * emits the @font-face CSS files consumed by web/src/styles/fonts.css.
 *
 * Output is gitignored; run automatically before vite dev/build via
 * predev/prebuild in web/package.json, or `npm run fonts:ensure`.
 * Zero requests to fonts.googleapis.com / fonts.gstatic.com at runtime.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = join(ROOT, 'web');
const OUT_DIR = join(WEB_DIR, 'src', 'styles', 'fonts');
const MANIFEST_PATH = join(ROOT, 'scripts', 'font-manifest.json');

export function loadManifest(manifestPath = MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [slug, entry] of Object.entries(manifest)) {
    for (const key of ['family', 'weight', 'woff2Sha256', 'woff2Bytes', 'source', 'sourceFile']) {
      if (!(key in entry)) throw new Error(`font manifest entry "${slug}" is missing "${key}"`);
    }
  }
  return manifest;
}

function resolveSource(entry) {
  const pkgName = entry.source.slice(0, entry.source.lastIndexOf('@'));
  // npm workspaces may hoist packages to the repo-root node_modules
  const candidates = [
    join(ROOT, 'node_modules', pkgName, entry.sourceFile),
    join(WEB_DIR, 'node_modules', pkgName, entry.sourceFile),
  ];
  const file = candidates.find((c) => existsSync(c));
  if (!file) {
    throw new Error(
      `font source not found: ${entry.source}/${entry.sourceFile} — run "npm install" ` +
      `(@fontsource packages are devDependencies pinned by the lockfile)`
    );
  }
  return file;
}

export function buildFace(slug, entry) {
  const buf = readFileSync(resolveSource(entry));
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== entry.woff2Sha256 || buf.length !== entry.woff2Bytes) {
    throw new Error(
      `font hash mismatch for "${slug}" from ${entry.source}: ` +
      `expected sha256 ${entry.woff2Sha256} (${entry.woff2Bytes} bytes), ` +
      `got ${sha} (${buf.length} bytes) — lockfile/manifest drift, do not ship`
    );
  }
  const b64 = buf.toString('base64');
  const css =
    `@font-face {\n` +
    `  font-family: "${entry.family}";\n` +
    `  font-style: normal;\n` +
    `  font-weight: ${entry.weight};\n` +
    `  font-display: swap;\n` +
    `  src: url(data:font/woff2;base64,${b64}) format("woff2");\n` +
    `}\n`;
  return { slug, css, bytes: buf.length, sha256: sha };
}

export function ensureAll(manifest = loadManifest(), outDir = OUT_DIR) {
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const [slug, entry] of Object.entries(manifest)) {
    const face = buildFace(slug, entry);
    writeFileSync(join(outDir, `${slug}.css`), face.css);
    results.push(face);
  }
  return results;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const results = ensureAll();
  for (const r of results) {
    console.log(`verified ${r.slug} (${r.bytes} bytes, sha256 ${r.sha256.slice(0, 12)}…)`);
  }
  console.log(`font packaging OK — ${results.length} faces, all hashes match the manifest`);
}
