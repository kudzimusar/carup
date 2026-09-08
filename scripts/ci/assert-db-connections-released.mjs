#!/usr/bin/env node
/**
 * Every staging database client must be released on EVERY path — including a failed connect.
 *
 * This exists because of a real incident. Fourteen call sites across seven workflows wrote:
 *
 *     const client = new pg.Client(...)
 *     await client.connect()          // <-- OUTSIDE the try
 *     try { ... } finally { await client.end() }
 *
 * so a connection that FAILED to establish abandoned the client without ever calling `end()`. When
 * the shared staging pooler saturated, three certification shards died with `ECHECKOUTTIMEOUT` — and
 * the error path leaked the very resource that was exhausted.
 *
 * The rule: an unguarded `await client.connect()` on its own line is forbidden. Connect inside a
 * try that ends the client, or use a helper that does.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.github/workflows';
const problems = [];

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.yml'))) {
  const path = join(DIR, file);
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const m = /^await\s+([A-Za-z_$][\w$]*)\.connect\(\)\s*;?$/.exec(trimmed);
    if (!m) return;
    const client = m[1];

    // Guarded on the same line: `try { await client.connect(); } catch { ...end()... }`.
    if (/try\s*\{[^}]*connect\(\)/.test(line)) return;

    // Or connected INSIDE a try whose handler releases this client — which is what a retry loop
    // legitimately looks like. Look back for the opening `try {` and forward for a release.
    const openedTry = lines.slice(Math.max(0, i - 3), i).some((l) => /\btry\s*\{\s*$/.test(l.trim()));
    const releases = lines.slice(i + 1, i + 10)
      .some((l) => new RegExp(`\\b${client}\\.end\\(`).test(l));
    if (openedTry && releases) return;

    problems.push({ file: path, line: i + 1, text: trimmed });
  });
}

if (problems.length) {
  console.error('UNRELEASED DATABASE CLIENT — connect() is not guarded, so a failed connection leaks it:\n');
  for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.text}`);
  console.error(`\n${problems.length} unguarded connect() call(s).`);
  console.error('Wrap it: try { await client.connect(); } catch (e) { await client.end().catch(() => {}); throw e; }');
  process.exit(1);
}

console.log(`database client release: ${readdirSync(DIR).filter((f) => f.endsWith('.yml')).length} workflows checked, no unguarded connect()`);
