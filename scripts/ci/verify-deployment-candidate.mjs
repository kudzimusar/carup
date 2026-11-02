#!/usr/bin/env node
/**
 * OC-5R-PROV-01 E3 — prove that a commit about to be (or already) deployed IS the immutable staging
 * deployment candidate, and refuse by name if it is not.
 *
 *   node scripts/ci/verify-deployment-candidate.mjs \
 *     --manifest docs/one-carup/certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json \
 *     --deployed-sha <40-hex>
 *
 * The candidate is a CODE TREE, not a moving branch head. A deployable commit is the manifest's
 * code_sha itself or a descendant whose difference from it touches ONLY:
 *   · documentation (docs/**) — receipts and reports written after the code was certified; and
 *   · this branch's two governed pairing records (web/preview-frontend-pairing.json,
 *     web/preview-backend-pairing.json) — which can only be written after Vercel has assigned the
 *     branch's backend alias, because that alias is truncated and hashed and is never composed by hand.
 *
 * Every other change (any code, config, migration, workflow, or another branch's pairing) means the
 * commit is NOT the certified candidate. The pairing values are checked too: the frontend alias
 * exactly, the backend alias against the manifest's pattern, and neither may be a production origin.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolvePair } from './resolve-governed-preview-pair.mjs';

export const PAIRING_FILES = Object.freeze(['web/preview-frontend-pairing.json', 'web/preview-backend-pairing.json']);

export const CANDIDATE_REFUSALS = Object.freeze({
  NOT_A_DESCENDANT: 'The deployed commit does not descend from the candidate code SHA.',
  CODE_CHANGED: 'The deployed commit changes files outside docs/** and the governed pairing records.',
  OTHER_BRANCH_PAIRING_CHANGED: 'The deployed commit changes another branch\'s pairing record.',
  FRONTEND_ALIAS_MISMATCH: 'The frontend pairing record is not the manifest\'s frontend alias.',
  BACKEND_ALIAS_SHAPE: 'The backend pairing record does not have the manifest\'s per-branch alias shape.',
  PAIR_REFUSED: 'The governed pair resolver refused the recorded pair.',
});

const gitRunner = (cwd) => (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function readJsonAt(git, sha, path) {
  try { return JSON.parse(git('show', `${sha}:${path}`)); } catch { return null; }
}

/**
 * @param {object} input
 * @param {object} input.manifest   the candidate manifest (see OC5R_STAGING_DEPLOYMENT_CANDIDATE.json)
 * @param {string} input.deployedSha
 * @param {Function} [input.git]    (...args) => stdout, run in the repository
 * @returns {{ ok: boolean, refusals: Array<{refusal: string, reason: string, detail?: any}>, pairing: 'absent'|'present' }}
 */
export function verifyCandidate({ manifest, deployedSha, git = gitRunner(process.cwd()) }) {
  const refusals = [];
  const refuse = (refusal, detail) => refusals.push({ refusal, reason: CANDIDATE_REFUSALS[refusal], ...(detail === undefined ? {} : { detail }) });
  const codeSha = manifest.candidate.code_sha;
  const branch = manifest.candidate.branch;

  let descends = true;
  try { git('merge-base', '--is-ancestor', codeSha, deployedSha); } catch { descends = false; }
  if (!descends) {
    refuse('NOT_A_DESCENDANT', { code_sha: codeSha, deployed_sha: deployedSha });
    return { ok: false, refusals, pairing: 'absent' };
  }

  const changed = git('diff', '--name-only', codeSha, deployedSha).split('\n').filter(Boolean);
  const outside = changed.filter((p) => !p.startsWith('docs/') && !PAIRING_FILES.includes(p));
  if (outside.length) refuse('CODE_CHANGED', outside);

  const pairingChanged = changed.some((p) => PAIRING_FILES.includes(p));
  if (pairingChanged) {
    for (const file of PAIRING_FILES) {
      const before = readJsonAt(git, codeSha, file)?.branches || {};
      const after = readJsonAt(git, deployedSha, file)?.branches || {};
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      const others = [...keys].filter((k) => k !== branch && before[k] !== after[k]);
      if (others.length) refuse('OTHER_BRANCH_PAIRING_CHANGED', { file, branches: others });
    }
    const frontendPairs = readJsonAt(git, deployedSha, PAIRING_FILES[0])?.branches || {};
    const backendPairs = readJsonAt(git, deployedSha, PAIRING_FILES[1])?.branches || {};
    const fe = frontendPairs[branch] || '';
    const be = backendPairs[branch] || '';
    if (fe !== manifest.expected_pairing.frontend.value) refuse('FRONTEND_ALIAS_MISMATCH', { recorded: fe || null });
    if (!new RegExp(manifest.expected_pairing.backend.pattern).test(be)) refuse('BACKEND_ALIAS_SHAPE', { recorded: be || null });
    const pair = resolvePair({ branch, sha: deployedSha, frontendPairs, backendPairs });
    if (!pair.ok) refuse('PAIR_REFUSED', { refusal: pair.refusal });
  }

  return { ok: refusals.length === 0, refusals, pairing: pairingChanged ? 'present' : 'absent' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
  const manifest = JSON.parse(readFileSync(arg('manifest'), 'utf8'));
  const verdict = verifyCandidate({ manifest, deployedSha: arg('deployed-sha') });
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}
