/**
 * OC-4F (RC1 residual scan) — no credential is committed to the source tree.
 *
 * RC1's scan found three Postgres connection strings for the production and staging hosts in two
 * documentation files. Each carries a `[ROTATED-…]` marker where the password goes — left by the
 * secret clean-up — and no credential. (The scan first misread the marker as a password; the
 * placeholder rule below is written so that a marker passes and a real value left inside the same
 * brackets does not.) Git history is a separate matter: an earlier leak there, and its rotation,
 * are owner items in the RC1 runbook, not something a tree scan can prove.
 *
 * This guard walks every tracked-looking text file and fails on anything shaped like a live
 * credential. It never prints a matched value — only the file, the line and the kind — so a failure
 * cannot itself become the leak.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.expo', 'coverage', 'test-results', 'playwright-report', '.vercel', '.turbo']);
const TEXT_EXT = /\.(md|mdx|txt|js|mjs|cjs|ts|tsx|jsx|json|sql|ya?ml|toml|env|example|sh|html|css|csv)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * A value that merely names where a secret goes is not a secret: a mask (*** / xxx), a $VAR /
 * ${VAR} / {{var}} reference, or text that says "put the password here" — optionally wrapped in
 * <angle> or [square] brackets, the Supabase dashboard's own `[YOUR-PASSWORD]` convention.
 *
 * Two shapes are deliberately NOT exempt, because the credential this guard was written for has
 * them both: a bare UPPER_CASE_TOKEN (upper case, digits, underscore), and a real value left INSIDE
 * the dashboard's brackets after `YOUR-PASSWORD` was replaced. An earlier draft exempted each in
 * turn and passed on the very tree it was meant to fail on.
 */
const PLACEHOLDER_WORD = /(password|passwd|pass\b|pwd|secret|redacted|rotated|masked|changeme|example|placeholder|your)/i;

function isPlaceholder(value) {
  const v = String(value);
  if (/^(\*+|x+)$/i.test(v)) return true;
  if (/^(\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\{\{[^}]*\}\})$/.test(v)) return true;
  const inner = v.replace(/^[<[]([\s\S]*)[>\]]$/, '$1');
  return PLACEHOLDER_WORD.test(inner) || /^(\*+|x+|\.{3}|…)$/i.test(inner);
}

/**
 * Test fixtures and the local CI database use short throwaway passwords ('p', 'pw', 'postgres'
 * against localhost / fixture hosts). A generated database credential is long — the one RC1 found is
 * 17 characters — so a connection-string password is treated as a credential from 12 characters up.
 */
const MIN_URL_PASSWORD = 12;

const KINDS = [
  { kind: 'postgres connection string with an inline password', re: /postgres(?:ql)?:\/\/[A-Za-z0-9_.-]+:([^@\s'"`]+)@/g, valueGroup: 1, minLength: MIN_URL_PASSWORD },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'OpenAI-style secret key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { kind: 'Groq API key', re: /\bgsk_[A-Za-z0-9]{30,}\b/g },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { kind: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { kind: 'signed HS256 JWT (e.g. a Supabase service key)', re: /\beyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/g },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && (TEXT_EXT.test(entry.name) || entry.name.startsWith('.env'))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function findings() {
  const hits = [];
  for (const file of walk(repoRoot)) {
    const rel = path.relative(repoRoot, file);
    if (rel === 'package-lock.json' || rel.endsWith('/package-lock.json')) continue;
    // Local, untracked environment files are the developer's own and are .gitignored.
    if (/(^|\/)\.env(\.|$)/.test(rel) && !rel.endsWith('.example')) continue;
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { kind, re, valueGroup, minLength = 0 } of KINDS) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          const value = valueGroup ? m[valueGroup] : m[0];
          if (valueGroup && isPlaceholder(value)) continue;
          if (value.length < minLength) continue;
          hits.push(`${rel}:${i + 1} — ${kind}`);
        }
      }
    });
  }
  return hits;
}

test('no credential-shaped value is committed anywhere in the source tree', () => {
  const hits = findings();
  assert.deepEqual(hits, [], `credential-shaped values found (values withheld):\n  ${hits.join('\n  ')}`);
});

test('the guard is not vacuous: it recognises each kind it claims to', () => {
  const samples = [
    'postgresql://postgres:' + 'Zq8#r2Lp!x9Wv4Tn7@db.example.supabase.co:5432/postgres',
    'AIza' + 'A'.repeat(35),
    'sk-' + 'a1'.repeat(20),
    'gsk_' + 'b2'.repeat(16),
    'ghp_' + 'c3'.repeat(16),
    'xoxb-' + '1234567890-abcdef',
    '-----BEGIN ' + 'PRIVATE KEY-----',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ' + 'd'.repeat(48) + '.' + 'e'.repeat(30),
  ];
  for (const [i, sample] of samples.entries()) {
    const { kind, re, valueGroup } = KINDS[i];
    re.lastIndex = 0;
    const m = re.exec(sample);
    assert.ok(m, `${kind} must be recognised`);
    if (valueGroup) assert.equal(isPlaceholder(m[valueGroup]), false, `${kind}: a real-looking value is not a placeholder`);
    if (KINDS[i].minLength) assert.ok(m[valueGroup].length >= KINDS[i].minLength, `${kind}: the sample is long enough to count`);
  }
  for (const placeholder of ['<PASSWORD>', '[YOUR-PASSWORD]', '${DB_PASSWORD}', '$DB_PASSWORD', 'YOUR_PASSWORD', '******', '<redacted — rotated>', '[...]']) {
    assert.equal(isPlaceholder(placeholder), true, `${placeholder} names a secret, it is not one`);
  }
  // The shape of the credential RC1 actually found: upper case, digits and underscores. It must
  // never be mistaken for an environment-variable name.
  for (const realShaped of ['K7Q2_ZR9M4X8_TP3W', '[K7Q2ZR9M4X8TP3W]', '<K7Q2ZR9M4X8TP3W>', 'Zq8#r2Lp!x9Wv4Tn7', 'abc123DEF456']) {
    assert.equal(isPlaceholder(realShaped), false, `a real-looking value (${realShaped.length} chars) is not a placeholder`);
  }
});
