import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contract tests for the remediation workflow.
 *
 * This lane can make a production write, so its governance controls are pinned
 * here rather than left to review-by-eye: dispatch-only, protected production
 * environment, main-only, owner-only as both actor and triggering_actor, the
 * exact authorization phrase, and a hard candidate-SHA pin asserted after
 * checkout.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const wf = fs.readFileSync(
  path.join(here, '..', '..', '.github', 'workflows', 'disable-misrouted-production-comms-cron.yml'), 'utf8');

/**
 * Every control must be asserted against what GitHub Actions actually executes,
 * never against the header prose. The header explains the controls in words —
 * `environment: production`, the actor gates, the authorization phrase — so a
 * check that scanned the raw file would pass on the explanation alone even if
 * the control itself had been deleted. `directives` strips the YAML comments.
 */
const directives = wf.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const comments = wf.split('\n').filter((line) => /^\s*#/.test(line)).join('\n');

// The reviewed remediation candidate: commit A of this PR, which carries the
// runner and its contract tests. The workflow definition itself lives on main
// and is trusted; the code it executes is this separately reviewed commit.
const CANDIDATE = '758c0157f9359e62bccc532876673ddd58e1c447';

test('the workflow is dispatch-only, production-scoped, owner-gated and SHA-pinned', () => {
  assert.match(directives, /on:\s*\n\s*workflow_dispatch:/, 'workflow_dispatch only');
  assert.ok(!/^\s*push:/m.test(directives) && !/^\s*pull_request:/m.test(directives),
    'must not trigger on push or pull_request');
  assert.ok(!/^\s*schedule:/m.test(directives), 'must never run on a schedule');
  assert.match(directives, /^\s*environment: production$/m, 'must run in the protected production environment');
  assert.match(directives, /github\.ref == 'refs\/heads\/main'/);
  assert.match(directives, /github\.actor == 'kudzimusar'/);
  assert.match(directives, /github\.triggering_actor == 'kudzimusar'/);

  // Both pins must be full 40-char SHAs — a branch or tag would let the executed
  // code change after review.
  const candidate = directives.match(/CANDIDATE_SHA:\s*([0-9a-f]{40})\b/);
  const checkoutRef = directives.match(/ref:\s*([0-9a-f]{40})\b/);
  assert.ok(candidate, 'CANDIDATE_SHA must be pinned to a 40-char SHA');
  assert.ok(checkoutRef, 'the checkout ref must be pinned to a 40-char SHA');
  assert.equal(candidate[1], checkoutRef[1], 'both pins must reference the same reviewed candidate');
  assert.equal(candidate[1], CANDIDATE, 'the pins must reference the reviewed remediation candidate');

  // The runner re-checks the pin at execution time, so a drifted checkout aborts
  // before it can reach the database.
  assert.match(directives, /git rev-parse HEAD/);
  assert.match(directives, /!= "\$CANDIDATE_SHA"/, 'the job must assert HEAD equals the pinned candidate');
  assert.match(directives, /persist-credentials: false/);
});

test('the workflow refuses without the exact authorization phrase', () => {
  assert.ok(directives.includes("expected='DISABLE MISROUTED PRODUCTION COMMUNICATIONS SCHEDULER'"),
    'the job must compare the input against the exact phrase');
  assert.match(directives, /if \[ "\$AUTHORIZATION_PHRASE" != "\$expected" \]/, 'a mismatch must be rejected');
  assert.match(directives, /AUTHORIZATION_PHRASE: \$\{\{ inputs\.authorization \}\}/,
    'the same phrase must reach the runner, which checks it again');
});

test('the workflow uses protected environment secrets and never echoes them', () => {
  for (const s of ['PRODUCTION_DATABASE_URL', 'PRODUCTION_PROJECT_REF', 'PRODUCTION_CA_CERT']) {
    assert.ok(directives.includes(`secrets.${s}`), `${s} must come from protected environment secrets`);
  }
  assert.ok(!/echo .*\$\{\{\s*secrets\./.test(directives), 'must never echo a secret value');
  assert.ok(!/\$\{\{\s*secrets\.[A-Z_]+\s*\}\}/.test(directives.replace(/^\s*[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/gm, '')),
    'secrets may only be bound to step env vars, never interpolated into a shell command');
});

test('the workflow runs only the remediation script — no migration or apply path', () => {
  assert.match(directives, /production-disable-misrouted-comms-cron\.mjs/);
  assert.ok(!/production-apply-publication-gate\.mjs/.test(directives),
    'must not invoke the seven-migration publication-gate runner');
  assert.ok(!/MODE:\s*apply/.test(directives), 'must not carry an apply mode');

  // Exactly one `node` invocation: the remediation runner and nothing else.
  const nodeRuns = (directives.match(/run:\s*node\s+\S+/g) || []);
  assert.equal(nodeRuns.length, 1, 'exactly one script invocation is permitted');
  assert.match(nodeRuns[0], /production-disable-misrouted-comms-cron\.mjs$/);

  // The lane disables the misrouted job; it never repoints it at production,
  // which would activate production Communications over an undrained backlog.
  assert.ok(!/carup-backend\.vercel\.app/.test(directives),
    'the workflow must not reference the production backend host');
  assert.match(comments, /does NOT repoint/, 'the lane must document why it does not repoint');
});
