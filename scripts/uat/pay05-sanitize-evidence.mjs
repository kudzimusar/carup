#!/usr/bin/env node
// CARUP-PAY-05-LR01 — copy the local UAT evidence of ONE candidate (and of the rehearsals that changed it) into
// docs/payments/evidence/pay05/, sanitized.
//
//   node scripts/uat/pay05-sanitize-evidence.mjs <candidate-sha> [<rehearsal-sha> ...]
//
// Publishes for the candidate: the PAY-05 HTTP matrix (+ the row counts behind its invariant case) and browser journal,
// the QA seed summary (integration IDs, never keys), the element screenshots, the PAY-04 26-case regression and browser
// replay run against it. For each rehearsal, under its own name: the same runs, the logs of checks that failed against
// it, and the screenshots listed in screens-<sha>/PUBLISH. Always: every mutation report, the independent-review
// register, the SHA-256 manifest of the saved Paynow sources, the upgrade over the archived PAY-04 physical-UAT rows and
// the workflow-isolation dry runs.
// Redacts the operator's home path. REFUSES to write any file that still contains a secret: the generic shapes (session
// tokens, provider keys, JWTs, passwords) AND, by exact value, every simulated integration key, the runtime's
// credential-vault KEK and the simulator control token (read from the private runtime directory, never printed).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = process.argv[2] || '';
const rehearsals = process.argv.slice(3);
for (const x of [sha, ...rehearsals]) {
  if (!/^[0-9a-f]{40}$/.test(x)) throw new Error('usage: pay05-sanitize-evidence.mjs <full 40-hex candidate sha> [<full 40-hex rehearsal sha> ...]');
}
const short = sha.slice(0, 8);
const SRC = `${homedir()}/carup-launch-evidence/pay05`;
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

// the home path is redacted; trailing spaces (Playwright pads its report lines) are dropped so the diff-hygiene gate passes
const sanitizeText = (text) => text.split(homedir()).join('~').replace(/[ \t]+$/gm, '');
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
publishIf(`${SRC}/uat/http-matrix-${short}-denominators.json`, `http-matrix-${short}-denominators.json`);
publishIf(`${SRC}/uat/browser-journal-${short}.json`, `browser-journal-${short}.json`);
publishIf(`${SRC}/qa-seed-summary.json`, `qa-seed-summary-${short}.json`);
// the PAY-04 matrix writes into PAY-04's folder; its PAY-05-candidate run is MOVED into PAY-05's (PAY-04's accepted
// evidence is never added to or changed)
publishIf(`${SRC}/pay04-regression/uat/http-matrix-${short}.json`, `pay04-regression-http-matrix-${short}.json`);
// an earlier PAY-04 run against the same candidate, kept with its finding (e.g. -run1-single-gateway-invariant)
for (const f of readdirSync(`${SRC}/pay04-regression/uat`).filter((x) => x.startsWith(`http-matrix-${short}-run`) && x.endsWith('.json')).sort()) {
  publishIf(`${SRC}/pay04-regression/uat/${f}`, `pay04-regression-${f}`);
}
publishIf(`${SRC}/pay04-regression/uat/browser-journal-${short}.json`, `pay04-regression-browser-journal-${short}.json`);
// every mutation report, survivors and all (each names the commit it ran at)
for (const f of readdirSync(`${SRC}/mutation`).filter((x) => /^mutation-report-[0-9a-f]{8}(-[a-z0-9-]+)?\.json$/.test(x)).sort()) {
  publishIf(`${SRC}/mutation/${f}`, f);
}
publishIf(`${SRC}/review/independent-review-37cb5c5c.md`, 'independent-review-37cb5c5c.md');
publishIf(`${SRC}/paynow-sources.sha256`, 'paynow-sources.sha256');
publishIf(`${SRC}/uat/upgrade-with-real-rows.json`, 'upgrade-with-real-rows.json');
// the workflow-isolation dry runs (static; one per head they were run at — the PR opens only after one is clean)
for (const f of readdirSync(`${SRC}/uat`).filter((x) => /^workflow-isolation-dry-run-pay05-[0-9a-f]{8}\.json$/.test(x)).sort()) {
  publishIf(`${SRC}/uat/${f}`, f);
}

for (const r of rehearsals.map((x) => x.slice(0, 8))) {
  publishIf(`${SRC}/uat/http-matrix-${r}.json`, `rehearsal-http-matrix-${r}.json`);
  publishIf(`${SRC}/uat/http-matrix-${r}-denominators.json`, `rehearsal-http-matrix-${r}-denominators.json`);
  publishIf(`${SRC}/uat/browser-journal-${r}.json`, `rehearsal-browser-journal-${r}.json`);
  const uat = readdirSync(`${SRC}/uat`);
  // logs are published as .txt (the repository ignores *.log)
  const txt = (f) => f.replace(/\.log$/, '.txt');
  for (const f of uat.filter((x) => x.startsWith('clipping-check-red-') && x.includes(r)).sort()) publishIf(`${SRC}/uat/${f}`, `rehearsal-${txt(f)}`);
  const p4 = readdirSync(`${SRC}/pay04-regression/uat`).filter((x) => x.includes(r)).sort();
  for (const f of p4) publishIf(`${SRC}/pay04-regression/uat/${f}`, `rehearsal-pay04-regression-${txt(f)}`);
  // the screenshots that showed what the rehearsal found (the rest of its screenshots stay private)
  const list = `${SRC}/screens-${r}/PUBLISH`;
  const shots = existsSync(list) ? readFileSync(list, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean) : [];
  for (const f of shots) {
    const from = `${SRC}/screens-${r}/${f}`;
    if (!existsSync(from)) { console.warn(`missing (not published): ${path.relative(homedir(), from)}`); continue; }
    copyFileSync(from, path.join(DEST, 'screens', `rehearsal-${r}-${f}`));
    manifest.push({ file: `screens/rehearsal-${r}-${f}`, sha256: createHash('sha256').update(readFileSync(from)).digest('hex') });
  }
}
for (const [dir, prefix] of [[`${SRC}/screens`, ''], [`${SRC}/pay04-regression/screens`, 'pay04-regression-']]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.png')).sort()) {
    copyFileSync(path.join(dir, f), path.join(DEST, 'screens', `${prefix}${f}`));
    manifest.push({ file: `screens/${prefix}${f}`, sha256: createHash('sha256').update(readFileSync(path.join(dir, f))).digest('hex') });
  }
}
publish(`manifest-${short}.json`, JSON.stringify({ candidate: sha, rehearsals, published_at: new Date().toISOString(), files: manifest }, null, 2));
console.log(`published ${manifest.length} files for ${short} -> ${path.relative(REPO, DEST)}`);
