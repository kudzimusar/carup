#!/usr/bin/env node
/**
 * One CarUp — evidence certification guard (OC-5, Phase 0).
 *
 * Enforces docs/one-carup/ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md over the machine-readable
 * manifest docs/one-carup/certification/ONE_CARUP_CERTIFICATION_MANIFEST.json.
 *
 * Five cumulative evidence levels. Each receipt certifies exactly ONE level for ONE capability, and
 * may only claim what its mechanism can prove. The guard rejects impossible promotions — above all:
 *   · a mocked / intercepted provider at LIVE-PROVIDER level or higher;
 *   · a localhost / CI / test environment at DEPLOYED level or higher;
 *   · OWNER-UAT that no human attested;
 *   · DATABASE certification claimed against the real CarUp Supabase projects;
 *   · an authority fact (Trust verified, Identity verified, …) established by mocked evidence;
 *   · a capability-ladder cell marked PASS without a receipt OF THAT LEVEL.
 *
 *   node scripts/ci/evidence-certification-guard.mjs [manifest.json]   → exit 1 on any violation
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_SUPABASE_REF, STAGING_SUPABASE_REF } from '../../backend/scripts/uat/referral-uat-guard.mjs';

export const LEVELS = Object.freeze([
  'SOURCE-CERTIFIED',
  'DATABASE-CERTIFIED',
  'LIVE-PROVIDER-CERTIFIED',
  'DEPLOYED-CERTIFIED',
  'OWNER-UAT-CERTIFIED',
]);
export const LADDER_VALUES = Object.freeze(['PASS', 'PENDING', 'N/A', 'FAIL']);
const RANK = Object.fromEntries(LEVELS.map((level, i) => [level, i]));

/** Environments that can never host a deployment certification or an owner UAT. */
const NON_DEPLOYED_ENVIRONMENTS = new Set(['localhost', 'local', 'ci', 'test', 'sandbox']);
const ENVIRONMENTS = new Set(['localhost', 'local', 'ci', 'test', 'sandbox', 'staging', 'preview', 'production']);
/**
 * The real CarUp Supabase projects: a DATABASE receipt proves disposable-PostgreSQL semantics only.
 * The refs come from the repository's reviewed deny-guard (referral-uat-guard.mjs, on the CR-1
 * allowlist) rather than being written here: CR-1 forbids the production ref as a literal in any
 * executable it has not reviewed, and a second copy would be a second thing to keep in step.
 */
const REAL_CARUP_DATABASES = new RegExp(`${STAGING_SUPABASE_REF}|${PRODUCTION_SUPABASE_REF}`, 'i');
const DATABASE_ENGINES = new Set(['pglite', 'postgres-disposable']);

/** Authority facts a mock can never establish (policy §0.6). */
const AUTHORITY_FACTS = [
  /trust\s+verified/i, /identity\s+verified/i, /document\s+genuine/i, /registry\s+genuine/i,
  /fraud\s+cleared/i, /vehicle\s+genuine/i, /insurance\s+approved/i, /finance\s+approved/i,
  /payment\s+released/i, /listing\s+approved/i, /biometric(s)?\s+(match|verified|passed)/i,
];
/** Provider-quality statements that only a real provider run can support (policy §0.6, OC-5 report rule). */
const PROVIDER_QUALITY = [
  { re: /gemma\s+(is\s+)?certified/i, model: /gemma/i },
  { re: /qwen\s+(is\s+)?certified/i, model: /qwen/i },
  { re: /ocr\s+accuracy\s+(is\s+)?certified/i, model: /qwen|ocr/i },
];

const SHA = /^[0-9a-f]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const isMocked = (receipt) => receipt.mocked_provider === true
  || (Array.isArray(receipt.mocked_components) && receipt.mocked_components.length > 0
    && receipt.mocked_components.some((c) => /provider|transport|model|ai|ocr|intercept/i.test(String(c))));

/**
 * Validate one receipt. Returns an array of violation strings (empty = valid).
 * `gitCheck(sha)` (optional) returns null when the commit is a known ancestor, or a reason.
 */
export function validateReceipt(receipt, { gitCheck = null } = {}) {
  const v = [];
  const id = receipt?.id || '(no id)';
  const say = (msg) => v.push(`${id}: ${msg}`);
  if (!receipt || typeof receipt !== 'object') return ['(receipt): not an object'];

  for (const field of ['id', 'phase', 'capability', 'proof_mechanism']) {
    if (!nonEmpty(receipt[field])) say(`${field} is required`);
  }
  if (!SHA.test(String(receipt.sha || ''))) say('sha must be the exact 40-hex commit the evidence was produced on');
  if (!LEVELS.includes(receipt.level)) say(`level must be one of ${LEVELS.join(', ')}`);
  if (!ENVIRONMENTS.has(receipt.environment)) say(`environment must be one of ${[...ENVIRONMENTS].join(', ')}`);
  if (!Array.isArray(receipt.mocked_components)) say('mocked_components must be declared (an empty array when nothing was mocked)');
  if (typeof receipt.mocked_provider !== 'boolean') say('mocked_provider must be declared true or false');
  if (!('provider' in receipt)) say('provider must be declared (null when no external provider is involved)');
  if (!('database' in receipt)) say('database must be declared (null when no database semantics are claimed)');
  if (!Array.isArray(receipt.remaining)) say('remaining (the higher levels still required) must be declared');
  if (!nonEmpty(receipt.recorded_at) || !ISO.test(receipt.recorded_at)) say('recorded_at must be an ISO-8601 timestamp');

  const rank = RANK[receipt.level];
  if (Array.isArray(receipt.remaining)) {
    for (const higher of receipt.remaining) {
      if (!LEVELS.includes(higher)) say(`remaining lists an unknown level "${higher}"`);
      else if (rank !== undefined && RANK[higher] <= rank) say(`remaining lists ${higher}, which is not above ${receipt.level}`);
    }
  }

  // ── Impossible promotions ────────────────────────────────────────────────────────────────
  if (rank !== undefined && rank >= RANK['LIVE-PROVIDER-CERTIFIED'] && isMocked(receipt)) {
    say(`a mocked or intercepted provider can never establish ${receipt.level}`);
  }
  if (rank !== undefined && rank >= RANK['DEPLOYED-CERTIFIED'] && NON_DEPLOYED_ENVIRONMENTS.has(receipt.environment)) {
    say(`environment "${receipt.environment}" can never establish ${receipt.level}`);
  }

  // ── Level-specific requirements ──────────────────────────────────────────────────────────
  const ev = receipt.evidence || {};
  if (receipt.level === 'DATABASE-CERTIFIED') {
    const db = receipt.database || {};
    if (!DATABASE_ENGINES.has(db.engine)) say('DATABASE-CERTIFIED requires database.engine pglite or postgres-disposable');
    if (!Array.isArray(db.migrations) || db.migrations.length === 0) say('DATABASE-CERTIFIED requires the repository migrations it ran');
    if (REAL_CARUP_DATABASES.test(JSON.stringify(db))) say('DATABASE-CERTIFIED proves disposable-PostgreSQL semantics, never the real CarUp Supabase projects');
  }
  if (receipt.level === 'LIVE-PROVIDER-CERTIFIED') {
    const p = receipt.provider || {};
    if (!nonEmpty(p.name) || !nonEmpty(p.model)) say('LIVE-PROVIDER-CERTIFIED requires provider.name and provider.model');
    if (p.mocked === true) say('LIVE-PROVIDER-CERTIFIED requires a real provider call (provider.mocked is true)');
    if (receipt.environment === 'production') say('no live-provider certification may run against production');
    for (const field of ['request_class', 'execution_evidence', 'result', 'executed_at']) {
      if (!nonEmpty(ev[field])) say(`LIVE-PROVIDER-CERTIFIED requires evidence.${field}`);
    }
    if (nonEmpty(ev.executed_at) && !ISO.test(ev.executed_at)) say('evidence.executed_at must be ISO-8601');
  }
  if (receipt.level === 'DEPLOYED-CERTIFIED') {
    for (const field of ['deployed_sha', 'frontend_deployment', 'backend_deployment', 'runtime_configuration', 'database_target', 'route_behavior']) {
      if (!nonEmpty(ev[field])) say(`DEPLOYED-CERTIFIED requires evidence.${field}`);
    }
    if (nonEmpty(ev.deployed_sha) && ev.deployed_sha !== receipt.sha) say('evidence.deployed_sha must equal the receipt sha (the exact candidate running)');
  }
  if (receipt.level === 'OWNER-UAT-CERTIFIED') {
    const owner = ev.owner_attestation || {};
    if (owner.actor_type !== 'human') say('OWNER-UAT-CERTIFIED requires a human owner attestation (automation cannot manufacture it)');
    for (const field of ['name', 'role', 'attested_at', 'record']) {
      if (!nonEmpty(owner[field])) say(`OWNER-UAT-CERTIFIED requires evidence.owner_attestation.${field}`);
    }
  }

  // ── Claims a mechanism cannot support ────────────────────────────────────────────────────
  const claims = Array.isArray(receipt.claims) ? receipt.claims.map(String) : [];
  if (isMocked(receipt) || (rank !== undefined && rank < RANK['LIVE-PROVIDER-CERTIFIED'])) {
    for (const claim of claims) {
      if (AUTHORITY_FACTS.some((re) => re.test(claim))) say(`claim "${claim}" is an authority fact that this evidence cannot establish`);
    }
  }
  for (const claim of claims) {
    for (const { re, model } of PROVIDER_QUALITY) {
      if (!re.test(claim)) continue;
      const real = receipt.level === 'LIVE-PROVIDER-CERTIFIED' && !isMocked(receipt) && model.test(String(receipt.provider?.model || ''));
      if (!real) say(`claim "${claim}" requires a real LIVE-PROVIDER run of that model`);
    }
  }

  if (gitCheck && SHA.test(String(receipt.sha || ''))) {
    const problem = gitCheck(receipt.sha);
    if (problem) say(problem);
  }
  return v;
}

/** Validate a whole manifest: every receipt, then the capability ladder against the receipts. */
export function validateManifest(manifest, options = {}) {
  const v = [];
  if (!manifest || manifest.schema !== 'carup.evidence_certification.v1') {
    return ['manifest: schema must be "carup.evidence_certification.v1"'];
  }
  const receipts = Array.isArray(manifest.receipts) ? manifest.receipts : [];
  const ids = new Set();
  for (const r of receipts) {
    if (ids.has(r?.id)) v.push(`${r.id}: duplicate receipt id`);
    ids.add(r?.id);
    v.push(...validateReceipt(r, options));
  }
  const valid = receipts.filter((r) => validateReceipt(r, options).length === 0);
  const ladder = manifest.capabilities || {};
  for (const [capability, row] of Object.entries(ladder)) {
    for (const level of LEVELS) {
      const cell = row?.[level];
      if (!LADDER_VALUES.includes(cell)) {
        v.push(`ladder ${capability}: ${level} must be one of ${LADDER_VALUES.join(', ')}`);
        continue;
      }
      if (cell === 'PASS' && !valid.some((r) => r.capability === capability && r.level === level)) {
        v.push(`ladder ${capability}: ${level} is PASS but no valid receipt of THAT level exists for it`);
      }
    }
  }
  for (const r of valid) {
    if (!ladder[r.capability]) v.push(`${r.id}: capability "${r.capability}" is missing from the ladder`);
  }
  return v;
}

/** Statements in programme documents that only a real provider run may make. */
export function scanDocumentsForUnsupportedClaims(docs, manifest) {
  const v = [];
  const liveModels = (manifest?.receipts || [])
    .filter((r) => r.level === 'LIVE-PROVIDER-CERTIFIED' && validateReceipt(r).length === 0)
    .map((r) => String(r.provider?.model || ''));
  for (const { file, text } of docs) {
    text.split('\n').forEach((line, i) => {
      // A line that explicitly NEGATES the claim (the policy's own prohibitions) is not a claim.
      if (/\b(never|not|no|must not|cannot|unless|until|without)\b/i.test(line)) return;
      for (const { re, model } of PROVIDER_QUALITY) {
        if (re.test(line) && !liveModels.some((m) => model.test(m))) {
          v.push(`${file}:${i + 1}: "${line.trim().slice(0, 80)}" claims provider quality with no LIVE-PROVIDER receipt`);
        }
      }
    });
  }
  return v;
}

function gitAncestorCheck(repoRoot) {
  return (sha) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repoRoot, stdio: 'ignore' });
    } catch {
      return `sha ${sha.slice(0, 12)} is not a commit in this repository`;
    }
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: repoRoot, stdio: 'ignore' });
    } catch {
      return `sha ${sha.slice(0, 12)} is not an ancestor of HEAD — evidence must come from this lineage`;
    }
    return null;
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const manifestPath = process.argv[2] || path.join(repoRoot, 'docs/one-carup/certification/ONE_CARUP_CERTIFICATION_MANIFEST.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const violations = validateManifest(manifest, { gitCheck: gitAncestorCheck(repoRoot) });
  const docsDir = path.join(repoRoot, 'docs/one-carup');
  const docs = existsSync(docsDir)
    ? readdirSync(docsDir).filter((f) => /^(OC5|ONE_CARUP_.*RC2).*\.md$/.test(f))
      .map((f) => ({ file: `docs/one-carup/${f}`, text: readFileSync(path.join(docsDir, f), 'utf8') }))
    : [];
  violations.push(...scanDocumentsForUnsupportedClaims(docs, manifest));
  const receipts = manifest.receipts?.length || 0;
  if (violations.length) {
    process.stderr.write(`evidence certification: ${violations.length} violation(s) across ${receipts} receipt(s)\n  ${violations.join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`evidence certification: ${receipts} receipt(s), ${Object.keys(manifest.capabilities || {}).length} capability row(s) — no impossible promotion\n`);
}
