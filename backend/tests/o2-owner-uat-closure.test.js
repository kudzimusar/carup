/**
 * O2 Owner-UAT closure — the identity-decision step-up gate (O2-UAT-1 / O2-UAT-2), ported by OC-5C
 * from PR #208 4002dbea with the X3 gate it pins. (#208's UAT-3..6 concern the ownership-transfer
 * error translation and the workbook layout, which arrive with their own slices.)
 *
 * The owner UAT measured it against a positive control before calling it a defect: deciding an
 * identity was reachable on role alone while the less consequential evidence preview was gated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

/* ── 1 · deciding an identity is a SENSITIVE action ────────────────────────
   Measured: a ghost session id returned 404 (the handler ran) while the dealer decision returned
   403 STEP_UP_REQUIRED before any lookup. Viewing the evidence was already gated; deciding was not. */

test('O2-UAT-1: the identity DECISION route requires reviewer capability AND step-up', () => {
  const routes = read('backend/routes/identityVerificationAdminRoutes.js');
  const at = routes.indexOf("verification-sessions/:sessionId/review");
  assert.ok(at > -1, 'the decision route must exist');
  const guards = routes.slice(at, routes.indexOf('asyncHandler', at));
  assert.match(guards, /authorizeRole\(\['admin'\]\)/, 'reviewer capability is required');
  assert.match(guards, /requireAuthenticationAssurance\(ACTION_CLASSES\.SENSITIVE\)/,
    'a sensitive-action step-up is required to DECIDE an identity');
});

test('O2-UAT-2: every consequential admin identity route is step-up gated, not just some', () => {
  const routes = read('backend/routes/identityVerificationAdminRoutes.js');
  // Both the decision and the raw-evidence preview change or expose something consequential.
  for (const marker of ['verification-sessions/:sessionId/review', 'evidence/:side/preview']) {
    const at = routes.indexOf(marker);
    assert.ok(at > -1, `${marker} must exist`);
    const guards = routes.slice(at, routes.indexOf('asyncHandler', at));
    assert.match(guards, /requireAuthenticationAssurance\(ACTION_CLASSES\.SENSITIVE\)/, `${marker} must demand step-up`);
  }
});
