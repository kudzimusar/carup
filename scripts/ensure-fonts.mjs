/**
 * RX-02A S1-1 — self-hosted font packaging (deterministic sourcing).
 *
 * Approved typography ships from the pinned @fontsource devDependencies in
 * web/package.json (@fontsource/inter@5.2.5, @fontsource/jetbrains-mono@5.2.5
 * — latin subsets, woff2), installed via the repo lockfile.
 *
 * Sourcing is FAIL-CLOSED: by default each woff2 must resolve from the local
 * node_modules copy (root-hoisted or web-local in the npm-workspaces layout).
 * No network access is required for a normal build. An explicit, controlled
 * CDN fallback exists for emergencies only and must be opted into with
 * RX02A_FONT_CDN=1; it downloads the exact pinned release URL into
 * web/.font-cache and is still verified by SHA-256 + byte length, so a
 * corrupted or tampered file fails the build loudly either way.
 *
 * Emits the gitignored @font-face CSS files consumed by
 * web/src/styles/fonts.css. Runs automatically before vite dev/build via
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

function resolveLocal(entry) {
  const candidates = [
    join(ROOT, 'node_modules', pkgName(entry.source), entry.sourceFile),
    join(WEB_DIR, 'node_modules', pkgName(entry.source), entry.sourceFile),
  ];
  const file = candidates.find((c) => existsSync(c));
  return file ? readFileSync(file) : null;
}

async function resolveViaCdn(entry) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${pkgName(entry.source).replace('/', '-')}-${entry.sourceFile.split('/').pop()}`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile);
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`font fetch failed for ${entry.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(cacheFile, buf);
  return buf;
}

async function resolveSource(entry) {
  const local = resolveLocal(entry);
  if (local) return local;
  if (process.env.RX02A_FONT_CDN === '1') return resolveViaCdn(entry);
  throw new Error(
    `font source not found in node_modules: ${pkgName(entry.source)}/${entry.sourceFile} — ` +
    `run "npm install" (pinned devDependencies: ${entry.source}). ` +
    `CDN fallback is opt-in only: RX02A_FONT_CDN=1 (still SHA-256 verified).`
  );
}

/** Verify raw woff2 bytes against the manifest entry. Throws on any mismatch. */
export function verifyFaceBytes(slug, entry, buf) {
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== entry.woff2Sha256 || buf.length !== entry.woff2Bytes) {
    throw new Error(
      `font hash mismatch for "${slug}" from ${entry.source}: ` +
      `expected sha256 ${entry.woff2Sha256} (${entry.woff2Bytes} bytes), ` +
      `got ${sha} (${buf.length} bytes) — source drift or corruption, do not ship`
    );
  }
  return { bytes: buf.length, sha256: sha };
}

export async function buildFace(slug, entry) {
  const buf = await resolveSource(entry);
  verifyFaceBytes(slug, entry, buf);
  const b64 = buf.toString('base64');
  const css =
    `@font-face {\n` +
    `  font-family: "${entry.family}";\n` +
    `  font-style: normal;\n` +
    `  font-weight: ${entry.weight};\n` +
    `  font-display: swap;\n` +
    `  src: url(data:font/woff2;base64,${b64}) format("woff2");\n` +
    `}\n`;
  return { slug, css, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
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
  const source = process.env.RX02A_FONT_CDN === '1' ? 'node_modules/CDN-cache' : 'node_modules (offline)';
  for (const r of results) {
    console.log(`verified ${r.slug} (${r.bytes} bytes, sha256 ${r.sha256.slice(0, 12)}…)`);
  }
  console.log(`font packaging OK — ${results.length} faces from ${source}, all hashes match the manifest`);
}
