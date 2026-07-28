#!/usr/bin/env node
/**
 * CR-1 preventive secret scan (blocking). Scans TRACKED files for:
 *   1. credential-bearing postgres:// / postgresql:// URIs;
 *   2. the forbidden production project ref in EXECUTABLE paths (deny-guard allowlist excepted);
 *   3. Supabase service-role JWT-like literals;
 *   4. accidental .env / dump / shell-history / credential-file commits;
 *   5. third-party OAuth/provider bearer credentials — Google refresh/access tokens, API keys and
 *      client secrets, Stripe keys, webhook signing secrets, AWS/GitHub/Slack tokens and PEM private
 *      key blocks (Issue #127, Drive lane: the Drive integration handles Google refresh tokens, so
 *      the scanner now recognises the shapes it must never see committed).
 * Prints file:line + class only — never raw secret values. Exit 1 on any violation.
 *
 * NOTE ON ADDING PATTERNS: every pattern below requires a substantial suffix (15+ credential-alphabet
 * characters). That is deliberate — it lets pattern-definition files and negative-assertion tests
 * mention a PREFIX like "ya29." without tripping the scanner, so hardening the scanner never creates
 * pressure to allow-list a test file. Test fixtures that need token-SHAPED values assemble them at
 * runtime instead of committing a literal (see backend/tests/helpers/googleDriveFixtures.js).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROD_REF = ['vhmnajoeicasa', 'igiophh'].join('');
// Reviewed allowlist: deny-guards + negative-assertion tests + this scanner + applied-migration and
// seed COMMENT references + controlled docs. Executable additions require security review.
const PROD_REF_ALLOWLIST = new Set([
  'scripts/cr1-secret-scan.mjs',
  'backend/scripts/diaspora-staging-apply-verify.mjs',   // FORBIDDEN_PROD_REF deny constant
  'backend/scripts/diaspora-staging-apply-19.mjs',      // FORBIDDEN_PROD_REF deny constant
  'backend/scripts/diaspora-staging-apply-20.mjs',      // FORBIDDEN_PROD_REF deny constant
  'backend/scripts/diaspora-staging-apply-gtm.mjs',     // FORBIDDEN_PROD_REF deny constant
  'backend/scripts/uat/referral-uat-guard.mjs',          // PRODUCTION_SUPABASE_REF deny constant
  'backend/scripts/seed-uat-referral-users.mjs',         // safety comments describing the deny guard
  'backend/scripts/uat/README.md',
  'backend/tests/staging/diaspora-staging-test-utils.js',// FORBIDDEN_REFS deny list
  'backend/tests/user-sessions-auth-contract.test.js',   // negative assertions (prod ref must be absent)
  'backend/tests/diaspora-workflow.test.js',             // negative assertions
  'backend/tests/release/diaspora-pr81-pr90-reconciliation-receipt.md',
  'database/migrations/20260712100000_communication_scheduler_production_activation.sql', // applied-migration comment (bytes frozen)
  'database/migrations/supabase_schema.sql',             // historical header comment (bytes frozen)
  'database/seeds/marketplace_v1_staging_qa_accounts.sql', // "DO NOT run on production" warning comment
  'database/seeds/marketplace_v1_staging_qa_seed.sql',     // same
  'scripts/apply-phase7c-staging-migrations.mjs',        // PRODUCTION_REF deny constant + refusal messages
  'scripts/phase7c-staging-preflight.mjs',               // PRODUCTION_REF deny constant
  'scripts/provision-staging-qa-accounts.mjs',           // PRODUCTION_SUPABASE_REF deny constant
  'scripts/run-staging-qa-provision.sh',                 // ABORT-on-production guard
  'scripts/verify-phase7c-staging-schema.mjs',           // PRODUCTION_REF deny constant
  'web/e2e/referral-staging.spec.ts',                    // deny constant in staging e2e guard
]);
const DOCS = (f) => f.startsWith('docs/') || f.endsWith('.md') || f.endsWith('.txt');
const CRED_URI = /postgres(?:ql)?:\/\/[A-Za-z0-9_.-]+:[^@\s'"`]{4,}@[A-Za-z0-9_.-]+/g;
const CRED_URI_EXEMPT = /USER:PASS@|postgres:postgres@127|postgres:postgres@localhost|user:pass(word)?@|:<pw>@|:\*{3,}|YOUR_PASSWORD|\[YOUR-PASSWORD\]|\[ROTATED-SEE-CR1\]|<password>|\$\{|%s/i;
const JWT_LIKE = /eyJhbGciOiJIUzI1NiI[snI][A-Za-z0-9_.-]{60,}/;
const FORBIDDEN_FILES = /(^|\/)\.env(\..+)?$|(^|\/)(\.bash_history|\.zsh_history)$|\.(dump|pgdump|sqldump)$|(^|\/)credentials?\.(json|txt|ya?ml)$/i;
const FORBIDDEN_FILE_EXEMPT = /\.env\.example$|env\.example$|\.env\.template$/i;

// Third-party bearer credentials. Each requires a long credential-alphabet suffix so that naming the
// PREFIX (in a regex definition, a doc, or a negative assertion) is not itself a violation.
const PROVIDER_CREDENTIALS = [
  ['google oauth refresh token', /(?:^|[^A-Za-z0-9_/-])1\/\/[A-Za-z0-9_-]{20,}/],
  ['google oauth access token', /ya29\.[A-Za-z0-9._-]{20,}/],
  ['google api key', /AIza[A-Za-z0-9_-]{30,}/],
  ['google oauth client secret', /GOCSPX-[A-Za-z0-9_-]{15,}/],
  ['stripe secret key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/],
  ['webhook signing secret', /\bwhsec_[A-Za-z0-9]{20,}/],
  ['aws access key id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['github token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
];
// Reviewed exemption, ONE file: the ledger #21 real-Postgres harness whose entire purpose is to feed
// credential-shaped values at the diaspora_credential_references CHECK constraint and prove it
// refuses them. Its literals are not credentials; they are the test corpus. New negative-assertion
// harnesses should assemble their corpus at runtime instead of being added here — see
// database/test/diaspora_drive_vault_reference_check.mjs for the pattern that needs no exemption.
const PROVIDER_CRED_ALLOWLIST = new Set([
]);

const files = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n');
const violations = [];

for (const f of files) {
  if (FORBIDDEN_FILES.test(f) && !FORBIDDEN_FILE_EXEMPT.test(f)) {
    violations.push(`${f}: forbidden credential-class file committed`);
    continue;
  }
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.match(CRED_URI) || []) {
      if (!CRED_URI_EXEMPT.test(m)) violations.push(`${f}:${i + 1}: credential-bearing postgres URI`);
    }
    if (JWT_LIKE.test(line)) violations.push(`${f}:${i + 1}: supabase JWT-like literal`);
    if (line.includes(PROD_REF) && !DOCS(f) && !PROD_REF_ALLOWLIST.has(f)) {
      violations.push(`${f}:${i + 1}: production project ref in executable path (not allowlisted)`);
    }
    // This scanner necessarily contains the patterns themselves; otherwise only the one reviewed
    // negative-assertion harness above is exempt.
    if (f !== 'scripts/cr1-secret-scan.mjs' && !PROVIDER_CRED_ALLOWLIST.has(f)) {
      for (const [label, pattern] of PROVIDER_CREDENTIALS) {
        if (pattern.test(line)) violations.push(`${f}:${i + 1}: ${label}`);
      }
    }
  });
}

if (violations.length) {
  console.error(`CR-1 SECRET SCAN: ${violations.length} violation(s):`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`CR-1 secret scan clean (${files.length} tracked files).`);
