#!/usr/bin/env node
/**
 * CR-1 preventive secret scan (blocking). Scans TRACKED files for:
 *   1. credential-bearing postgres:// / postgresql:// URIs;
 *   2. the forbidden production project ref in EXECUTABLE paths (deny-guard allowlist excepted);
 *   3. Supabase service-role JWT-like literals;
 *   4. accidental .env / dump / shell-history / credential-file commits.
 * Prints file:line + class only — never raw secret values. Exit 1 on any violation.
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
  });
}

if (violations.length) {
  console.error(`CR-1 SECRET SCAN: ${violations.length} violation(s):`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`CR-1 secret scan clean (${files.length} tracked files).`);
