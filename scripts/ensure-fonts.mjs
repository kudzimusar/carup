/**
 * RX-02A S1-1 — self-hosted font packaging.
 *
 * Approved typography ships from pinned @fontsource releases
 * (@fontsource/inter@5.2.5, @fontsource/jetbrains-mono@5.2.5 — latin
 * subsets, woff2). This script resolves each woff2 (preferring the
 * npm-installed copy under node_modules, falling back to a pinned CDN
 * download cached under web/.font-cache), verifies it against the
 * SHA-256 + byte length recorded in scripts/font-manifest.json, and emits
 * the @font-face CSS files consumed by web/src/styles/fonts.css.
 *
 * Hash verification makes the transport irrelevant: a corrupted or
 * tampered file fails the build loudly instead of shipping.
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
const CACHE_DIR = join(WEB_DIR, '.font-cache');
const MANIFEST_PATH = join(ROOT, 'scripts', 'font-manifest.json');

export function loadManifest(manifestPath = MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [slug, entry] of Object.entries(manifest)) {
    for (const key of ['family', 'weight', 'woff2Sha256', 'woff2Bytes', 'source', 'sourceFile', 'url']) {
      if (!(key in entry)) throw new Error(`font manifest entry "${slug}" is missing "${key}"`);
    }
  }
  return manifest;
}

function pkgName(source) {
  return source.slice(0, source.lastIndexOf('@'));
}

async function resolveSource(entry) {
  const candidates = [
    join(ROOT, 'node_modules', pkgName(entry.source), entry.sourceFile),
    join(WEB_DIR, 'node_modules', pkgName(entry.source), entry.sourceFile),
  ];
  const local = candidates.find((c) => existsSync(c));
  if (local) return readFileSync(local);
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${pkgName(entry.source).replace('/', '-')}-${entry.sourceFile.split('/').pop()}`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile);
  const res = await fetch(entry.url);
  if (!res.ok) {
    throw new Error(
      `font fetch failed for ${entry.url}: HTTP ${res.status} — ` +
      `install "@fontsource" deps or restore network access`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(cacheFile, buf);
  return buf;
}

export async function buildFace(slug, entry) {
  const buf = await resolveSource(entry);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== entry.woff2Sha256 || buf.length !== entry.woff2Bytes) {
    throw new Error(
      `font hash mismatch for "${slug}" from ${entry.source}: ` +
      `expected sha256 ${entry.woff2Sha256} (${entry.woff2Bytes} bytes), ` +
      `got ${sha} (${buf.length} bytes) — source drift or corruption, do not ship`
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

export async function ensureAll(manifest = loadManifest(), outDir = OUT_DIR) {
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const [slug, entry] of Object.entries(manifest)) {
    const face = await buildFace(slug, entry);
    writeFileSync(join(outDir, `${slug}.css`), face.css);
    results.push(face);
  }
  return results;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const results = await ensureAll();
  for (const r of results) {
    console.log(`verified ${r.slug} (${r.bytes} bytes, sha256 ${r.sha256.slice(0, 12)}…)`);
  }
  console.log(`font packaging OK — ${results.length} faces, all hashes match the manifest`);
}
