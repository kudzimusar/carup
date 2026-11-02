#!/usr/bin/env node
// CARUP-PAY-04-LR01 — copy the local UAT evidence of ONE candidate into docs/payments/evidence/pay04/, sanitized.
//
//   node scripts/uat/pay04-sanitize-evidence.mjs <candidate-sha>
//
// Copies the HTTP matrix result, the browser journal, the QA seed summary and the element screenshots of that candidate.
// Redacts the operator's home path and refuses to write any file that still contains a secret-shaped value (session
// tokens, simulator secrets, provider keys, JWTs, passwords). Synthetic `.invalid` QA identities are kept: they are the
// evidence of who acted.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = process.argv[2] || '';
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('usage: pay04-sanitize-evidence.mjs <full 40-hex candidate sha>');
const short = sha.slice(0, 8);
const SRC = `${homedir()}/carup-launch-evidence/pay04`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEST = path.join(REPO, 'docs/payments/evidence/pay04');
mkdirSync(path.join(DEST, 'screens'), { recursive: true });

const SECRET_SHAPES = [
  /gsimsec_[A-Za-z0-9]{8,}/, /simsec_[A-Za-z0-9]{8,}/, /\bsk_(test|live)_[A-Za-z0-9]{8,}/, /\bwhsec_[A-Za-z0-9]{8,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /"password"\s*:/i, /"token"\s*:\s*"[^"]{12,}"/i,
  /x-session-token/i, /\bservice_role_key\b/i,
];

function sanitizeText(text) {
  return text.split(homedir()).join('~');
}
function assertClean(name, text) {
  for (const re of SECRET_SHAPES) {
    if (re.test(text)) throw new Error(`refusing to publish ${name}: it matches the secret shape ${re}`);
  }
}
const manifest = [];
function publish(name, text) {
  const clean = sanitizeText(text);
  assertClean(name, clean);
  writeFileSync(path.join(DEST, name), clean);
  manifest.push({ file: name, sha256: createHash('sha256').update(clean).digest('hex') });
}

for (const [src, name] of [
  [`uat/http-matrix-${short}.json`, `http-matrix-${short}.json`],
  [`uat/browser-journal-${short}.json`, `browser-journal-${short}.json`],
  ['qa-seed-summary.json', `qa-seed-summary-${short}.json`],
]) {
  const file = path.join(SRC, src);
  if (existsSync(file)) publish(name, readFileSync(file, 'utf8'));
  else console.warn(`missing (not published): ${src}`);
}
const screens = path.join(SRC, 'screens');
if (existsSync(screens)) {
  for (const f of readdirSync(screens).filter((x) => x.endsWith('.png')).sort()) {
    copyFileSync(path.join(screens, f), path.join(DEST, 'screens', f));
    manifest.push({ file: `screens/${f}`, sha256: createHash('sha256').update(readFileSync(path.join(screens, f))).digest('hex') });
  }
}
publish(`manifest-${short}.json`, JSON.stringify({ candidate: sha, published_at: new Date().toISOString(), files: manifest }, null, 2));
console.log(`published ${manifest.length} files for ${short} -> ${path.relative(REPO, DEST)}`);
