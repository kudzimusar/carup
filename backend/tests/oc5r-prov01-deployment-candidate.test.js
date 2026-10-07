/**
 * OC-5R-PROV-01 E3 — the immutable staging deployment candidate verifier.
 *
 * A deployable commit is the candidate code SHA or a descendant that changes only docs/** and this
 * branch's two governed pairing records — with the recorded aliases checked. Each rule is broken in
 * a throwaway git repository and the named refusal is asserted. No network, no deployment.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { verifyCandidate } = await import('../../scripts/ci/verify-deployment-candidate.mjs');

const BRANCH = 'fix/oc5r-real-runtime-source-closure';
const FE = 'https://carup-staging-git-fix-oc5r-real-runtime-source-closure-11-11.vercel.app';
const BE_PATTERN = '^https://carup-backend-staging-git-fix-oc5r-real-runtime-so[a-z0-9-]*-11-11\\.vercel\\.app$';
const BE = 'https://carup-backend-staging-git-fix-oc5r-real-runtime-so-abc123-11-11.vercel.app';

const dir = mkdtempSync(path.join(tmpdir(), 'oc5r-candidate-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const write = (rel, body) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), body); };
const pairing = (branches) => `${JSON.stringify({ branches }, null, 2)}\n`;
const commit = (message) => { git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD'); };

git('init', '-q');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'test');
write('backend/app.js', 'export default 1;\n');
write('docs/one-carup/report.md', '# report\n');
write('web/preview-frontend-pairing.json', pairing({ other: 'https://carup-staging-git-other-11-11.vercel.app' }));
write('web/preview-backend-pairing.json', pairing({ other: 'https://carup-backend-staging-git-other-11-11.vercel.app' }));
const CODE = commit('candidate code');

const manifest = {
  candidate: { code_sha: CODE, branch: BRANCH },
  expected_pairing: { frontend: { value: FE }, backend: { pattern: BE_PATTERN } },
};
const branchFrom = (name) => { git('checkout', '-q', CODE); git('checkout', '-q', '-b', name); };
const reasons = (v) => v.refusals.map((r) => r.refusal).sort();

test('E3: the candidate code SHA itself is deployable (no pairing yet)', () => {
  const v = verifyCandidate({ manifest, deployedSha: CODE, git });
  assert.deepEqual([v.ok, v.pairing, v.refusals], [true, 'absent', []]);
});

test('E3: a docs-only descendant is the same candidate', () => {
  branchFrom('docs-only');
  write('docs/one-carup/receipt.md', 'receipt\n');
  const sha = commit('docs');
  assert.equal(verifyCandidate({ manifest, deployedSha: sha, git }).ok, true);
});

test('E3: a descendant that records exactly this branch\'s governed pair is the same candidate', () => {
  branchFrom('paired');
  write('web/preview-frontend-pairing.json', pairing({ other: 'https://carup-staging-git-other-11-11.vercel.app', [BRANCH]: FE }));
  write('web/preview-backend-pairing.json', pairing({ other: 'https://carup-backend-staging-git-other-11-11.vercel.app', [BRANCH]: BE }));
  const v = verifyCandidate({ manifest, deployedSha: commit('pair'), git });
  assert.deepEqual([v.ok, v.pairing, v.refusals], [true, 'present', []]);
});

test('E3: any code change makes it a different candidate', () => {
  branchFrom('code-changed');
  write('backend/app.js', 'export default 2;\n');
  assert.deepEqual(reasons(verifyCandidate({ manifest, deployedSha: commit('code'), git })), ['CODE_CHANGED']);
});

test('E3: a hand-written or production pairing is refused by name', () => {
  branchFrom('bad-pair');
  write('web/preview-frontend-pairing.json', pairing({ other: 'https://carup-staging-git-other-11-11.vercel.app', [BRANCH]: 'https://carup-staging.vercel.app' }));
  write('web/preview-backend-pairing.json', pairing({ other: 'https://carup-backend-staging-git-other-11-11.vercel.app', [BRANCH]: 'https://carup-backend-staging.vercel.app' }));
  assert.deepEqual(reasons(verifyCandidate({ manifest, deployedSha: commit('bad pair'), git })),
    ['BACKEND_ALIAS_SHAPE', 'FRONTEND_ALIAS_MISMATCH', 'PAIR_REFUSED']);
});

test('E3: touching another branch\'s pairing record is refused', () => {
  branchFrom('other-branch');
  write('web/preview-frontend-pairing.json', pairing({ other: 'https://carup-staging-git-moved-11-11.vercel.app', [BRANCH]: FE }));
  write('web/preview-backend-pairing.json', pairing({ other: 'https://carup-backend-staging-git-other-11-11.vercel.app', [BRANCH]: BE }));
  assert.deepEqual(reasons(verifyCandidate({ manifest, deployedSha: commit('other'), git })), ['OTHER_BRANCH_PAIRING_CHANGED']);
});

test('E3: a commit that does not descend from the candidate is refused', () => {
  git('checkout', '-q', '--orphan', 'unrelated');
  write('backend/app.js', 'export default 3;\n');
  assert.deepEqual(reasons(verifyCandidate({ manifest, deployedSha: commit('unrelated'), git })), ['NOT_A_DESCENDANT']);
});

test('E3: the committed candidate manifest is well-formed and governed', () => {
  const file = new URL('../../docs/one-carup/certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json', import.meta.url);
  if (!existsSync(file)) return; // written in the Stage E commit; the shape rules below bind it from then on
  const m = JSON.parse(readFileSync(file, 'utf8'));
  assert.match(m.candidate.code_sha, /^[0-9a-f]{40}$/);
  assert.equal(m.candidate.branch, BRANCH);
  // Exactly the canonical staging project — which by construction is never the production one
  // (CR-1 forbids writing the production ref here, even to refuse it).
  assert.equal(m.database.project_ref, 'eoyenigwevnxwwhyhaer');
  assert.equal(m.expected_pairing.frontend.value, FE);
  const be = new RegExp(m.expected_pairing.backend.pattern);
  assert.equal(be.test(BE), true);
  assert.equal(be.test('https://carup-backend-staging.vercel.app'), false, 'the stable alias is not a candidate');
  assert.equal(m.deployment.performed, false, 'the package prepares a deployment; it never records one as done');
});
