#!/usr/bin/env node
// CARUP-PAY-05-LR01 — copy the local UAT evidence of ONE candidate into docs/payments/evidence/pay05/, sanitized.
//
//   node scripts/uat/pay05-sanitize-evidence.mjs <candidate-sha>
//
// Publishes: the PAY-05 HTTP matrix and browser journal, the QA seed summary (integration IDs, never keys), the element
// screenshots, the PAY-04 26-case regression and browser replay run against this candidate, the mutation report, the
// independent-review register and the SHA-256 manifest of the saved Paynow sources.
// Redacts the operator's home path. REFUSES to write any file that still contains a secret: the generic shapes (session
// tokens, provider keys, JWTs, passwords) AND, by exact value, every simulated integration key, the runtime's
// credential-vault KEK and the simulator control token (read from the private runtime directory, never printed).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = process.argv[2] || '';
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('usage: pay05-sanitize-evidence.mjs <full 40-hex candidate sha>');
const short = sha.slice(0, 8);
const SRC = `${homedir()}/carup-launch-evidence/pay05`;
const PAY04_SRC = `${homedir()}/carup-launch-evidence/pay04`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEST = path.join(REPO, 'docs/payments/evidence/pay05');
mkdirSync(path.join(DEST, 'screens'), { recursive: true });

const SECRET_SHAPES = [
  /gsimsec_[A-Za-z0-9]{8,}/, /simsec_[A-Za-z0-9]{8,}/, /\bsk_(test|live)_[A-Za-z0-9]{8,}/, /\bwhsec_[A-Za-z0-9]{8,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /"password"\s*:/i, /"token"\s*:\s*"[^"]{12,}"/i,
  /x-session-token/i, /\bservice_role_key\b/i, /"integration_key"\s*:/i, /credential_ciphertext"\s*:\s*"[A-Za-z0-9+/=]{16,}/,
];
// exact secret values of this disposable runtime (never printed; only their presence is checked)
const exactSecrets = [];
const readIf = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim() : '');
const integrations = existsSync(`${SRC}/runtime/simulated-integrations.json`)
  ? JSON.parse(readFileSync(`${SRC}/runtime/simulated-integrations.json`, 'utf8')).integrations : {};
for (const i of Object.values(integrations)) if (i.integration_key) exactSecrets.push(i.integration_key, i.integration_key.toUpperCase());
for (const f of ['runtime/credential-kek', 'runtime/simulator-control-token']) { const v = readIf(`${SRC}/${f}`); if (v) exactSecrets.push(v); }

const sanitizeText = (text) => text.split(homedir()).join('~');
function assertClean(name, text) {
  for (const re of SECRET_SHAPES) if (re.test(text)) throw new Error(`refusing to publish ${name}: it matches the secret shape ${re}`);
  for (const secret of exactSecrets) if (secret && text.includes(secret)) throw new Error(`refusing to publish ${name}: it contains a runtime secret`);
}
const manifest = [];
function publish(name, text) {
  const clean = sanitizeText(text);
  assertClean(name, clean);
  writeFileSync(path.join(DEST, name), clean);
  manifest.push({ file: name, sha256: createHash('sha256').update(clean).digest('hex') });
}
function publishIf(file, name) {
  if (existsSync(file)) publish(name, readFileSync(file, 'utf8'));
  else console.warn(`missing (not published): ${path.relative(homedir(), file)}`);
}

publishIf(`${SRC}/uat/http-matrix-${short}.json`, `http-matrix-${short}.json`);
publishIf(`${SRC}/uat/browser-journal-${short}.json`, `browser-journal-${short}.json`);
publishIf(`${SRC}/qa-seed-summary.json`, `qa-seed-summary-${short}.json`);
publishIf(`${PAY04_SRC}/uat/http-matrix-${short}.json`, `pay04-regression-http-matrix-${short}.json`);
publishIf(`${SRC}/pay04-regression/uat/browser-journal-${short}.json`, `pay04-regression-browser-journal-${short}.json`);
publishIf(`${SRC}/mutation/mutation-report-${short}.json`, `mutation-report-${short}.json`);
publishIf(`${SRC}/review/independent-review-37cb5c5c.md`, 'independent-review-37cb5c5c.md');
publishIf(`${SRC}/paynow-sources.sha256`, 'paynow-sources.sha256');

for (const [dir, prefix] of [[`${SRC}/screens`, ''], [`${SRC}/pay04-regression/screens`, 'pay04-regression-']]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.png')).sort()) {
    copyFileSync(path.join(dir, f), path.join(DEST, 'screens', `${prefix}${f}`));
    manifest.push({ file: `screens/${prefix}${f}`, sha256: createHash('sha256').update(readFileSync(path.join(dir, f))).digest('hex') });
  }
}
publish(`manifest-${short}.json`, JSON.stringify({ candidate: sha, published_at: new Date().toISOString(), files: manifest }, null, 2));
console.log(`published ${manifest.length} files for ${short} -> ${path.relative(REPO, DEST)}`);
