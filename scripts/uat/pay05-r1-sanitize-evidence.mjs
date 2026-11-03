#!/usr/bin/env node
// CARUP-PAY-05-R1 — copy the local evidence of ONE candidate into docs/payments/evidence/pay05-r1/, sanitized. PAY-05's own
// folder and its 85-file manifest are never written to.
//
//   node scripts/uat/pay05-r1-sanitize-evidence.mjs <candidate-sha> [<rehearsal-sha> ...]
//
// Publishes: the PAY-05 and PAY-04 HTTP matrices and browser journals, the R1 browser and keyboard journal, the element
// screenshots, the mutation report, the database certification summaries, and red-to-green summaries that name regression tests
// and their outcome only. It never publishes the restricted reproductions, their outputs or the private certification.
// Redacts the operator's home path. REFUSES any file that still holds a secret: generic shapes AND, by exact value, every
// simulated integration key, the runtime's credential KEK, the simulator control token and every QA password.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = process.argv[2] || '';
const rehearsals = process.argv.slice(3);
for (const x of [sha, ...rehearsals]) if (!/^[0-9a-f]{40}$/.test(x)) throw new Error('usage: pay05-r1-sanitize-evidence.mjs <full 40-hex candidate sha> [<full 40-hex rehearsal sha> ...]');
const short = sha.slice(0, 8);
const R1 = `${homedir()}/carup-launch-evidence/pay05-r1`;
const E5 = `${homedir()}/carup-launch-evidence/pay05`;
const RUN = `${R1}/repro-${short}`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEST = path.join(REPO, 'docs/payments/evidence/pay05-r1');
mkdirSync(path.join(DEST, 'screens'), { recursive: true });

const SECRET_SHAPES = [
  /gsimsec_[A-Za-z0-9]{8,}/, /simsec_[A-Za-z0-9]{8,}/, /\bsk_(test|live)_[A-Za-z0-9]{8,}/, /\bwhsec_[A-Za-z0-9]{8,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /"password"\s*:/i, /"token"\s*:\s*"[^"]{12,}"/i,
  /x-session-token["']?\s*[:=]/i, /\bservice_role_key\b/i, /"integration_key"\s*:/i, /credential_ciphertext"\s*:\s*"[A-Za-z0-9+/=]{16,}/,
  /postgres(?:ql)?:\/\/[^:/\s@]+:(?!postgres@)[^@/\s]+@/,
];
const exactSecrets = new Set();
const readIf = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim() : '');
const integrations = existsSync(`${E5}/runtime/simulated-integrations.json`) ? JSON.parse(readFileSync(`${E5}/runtime/simulated-integrations.json`, 'utf8')).integrations : {};
for (const i of Object.values(integrations)) if (i.integration_key) { exactSecrets.add(i.integration_key); exactSecrets.add(i.integration_key.toUpperCase()); }
for (const f of ['runtime/credential-kek', 'runtime/simulator-control-token']) { const v = readIf(`${E5}/${f}`); if (v) exactSecrets.add(v); }
for (const f of [`${E5}/uat-accounts.json`, `${homedir()}/carup-launch-evidence/pay04/uat-accounts.json`]) {
  if (!existsSync(f)) continue;
  for (const v of Object.values(JSON.parse(readFileSync(f, 'utf8')))) if (v && typeof v === 'object' && v.password) exactSecrets.add(v.password);
}

const sanitizeText = (text) => text.split(homedir()).join('~').replace(/\x1b\[[0-9;]*m/g, '').replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n');
function assertClean(name, text) {
  for (const re of SECRET_SHAPES) if (re.test(text)) throw new Error(`refusing to publish ${name}: it matches the secret shape ${re}`);
  for (const secret of exactSecrets) if (secret && text.includes(secret)) throw new Error(`refusing to publish ${name}: it contains a runtime secret`);
}
const manifest = [];
function publish(name, text) {
  const clean = sanitizeText(text);
  assertClean(name, clean);
  mkdirSync(path.dirname(path.join(DEST, name)), { recursive: true });
  writeFileSync(path.join(DEST, name), clean);
  manifest.push({ file: name, sha256: createHash('sha256').update(clean).digest('hex') });
}
const missing = [];
function publishIf(file, name) {
  if (existsSync(file) && statSync(file).isFile()) publish(name, readFileSync(file, 'utf8'));
  else missing.push(path.relative(homedir(), file));
}
const shots = (dir, prefix) => {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.png')).sort()) {
    copyFileSync(path.join(dir, f), path.join(DEST, 'screens', `${prefix}${f}`));
    manifest.push({ file: `screens/${prefix}${f}`, sha256: createHash('sha256').update(readFileSync(path.join(dir, f))).digest('hex') });
  }
};

publishIf(`${RUN}/http-matrix-${short}.json`, `http-matrix-${short}.json`);
publishIf(`${RUN}/pay04-http-matrix-${short}.json`, `pay04-http-matrix-${short}.json`);
publishIf(`${RUN}/repro.log`, `physical-run-${short}.txt`);
publishIf(`${RUN}/pay05-browser.log`, `pay05-browser-${short}.txt`);
publishIf(`${RUN}/pay04-browser.log`, `pay04-browser-${short}.txt`);
publishIf(`${RUN}/r1-browser.log`, `r1-browser-${short}.txt`);
publishIf(`${RUN}/spec-pay05/uat/browser-journal-${short}.json`, `pay05-browser-journal-${short}.json`);
publishIf(`${RUN}/spec-pay05/uat/r1-browser-journal-${short}.json`, `r1-browser-journal-${short}.json`);
publishIf(`${RUN}/spec-pay04/uat/browser-journal-${short}.json`, `pay04-browser-journal-${short}.json`);
shots(`${RUN}/spec-pay05/screens-r1`, 'r1-');
shots(`${RUN}/spec-pay05/screens`, 'pay05-');
for (const f of readdirSync(`${R1}/mutation`).filter((x) => /^report-[0-9a-f]{8}(-[a-z0-9-]+)?\.json$/.test(x)).sort()) publishIf(`${R1}/mutation/${f}`, `mutation-${f}`);
for (const f of ['cert-payments-first.summary.txt', 'cert-garage-first.summary.txt', 'realpg-suites.summary.txt', 'web-full.summary.txt', 'ci-backend.summary.txt', 'red-to-green.md', 'invariants.summary.txt', 'wsi-dry-run.json']) {
  publishIf(`${R1}/publish/${f}`, f);
}
for (const r of rehearsals.map((x) => x.slice(0, 8))) {
  publishIf(`${R1}/repro-${r}/http-matrix-${r}.json`, `rehearsal-http-matrix-${r}.json`);
  publishIf(`${R1}/repro-${r}/repro.log`, `rehearsal-physical-run-${r}.txt`);
  publishIf(`${R1}/repro-${r}/REHEARSAL-FINDINGS.md`, `rehearsal-findings-${r}.md`);
}
publish(`manifest-${short}.json`, `${JSON.stringify({ candidate: sha, rehearsals, published_at: new Date().toISOString(), files: manifest }, null, 2)}\n`);
console.log(`published ${manifest.length} files for ${short} -> ${path.relative(REPO, DEST)}`);
if (missing.length) { console.warn(`missing (not published):\n  ${missing.join('\n  ')}`); }
