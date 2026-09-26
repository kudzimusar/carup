/**
 * O2 authority-forgery probes — ONE implementation, run in two places:
 *
 *   - tests/agents/44-o2-p7-staging.spec.ts drives it against the deployed exact-head pair;
 *   - backend/tests/o2-authority-forgery-probes.test.js drives the SAME code against the real
 *     `authorizeRole` middleware, which is where a deliberate mutation can prove each probe is
 *     load-bearing (a deployed server cannot be mutated).
 *
 * The contract is behavioural, never the prose of whichever guard answered first:
 *
 *   ROLE FORGERY   — the actor's real session plus `x-stakeholder-role: admin` must be refused on
 *                    every platform review surface with a 403 authority refusal (not 401/404, not a
 *                    CSRF/transport failure, not STEP_UP_REQUIRED).
 *
 *   TENANT FORGERY — tested on its OWN, with the actor's genuine role header and nothing forged but
 *                    `x-tenant-id`. Anchored on a surface the actor's own role IS allowed to read:
 *                    200 without the header, 403 with only the foreign tenant added. The single
 *                    changed input is the tenant, so only tenant verification can have refused —
 *                    no copy is needed to prove which guard fired, and disabling tenant verification
 *                    turns this probe red while role verification is still intact.
 */
import assert from 'node:assert/strict';

export const PLATFORM_REVIEW_SURFACES = ['/admin/identity/verification-sessions', '/admin/dealers'];
export const OWN_ROLE_SURFACE = '/vehicles/me';
export const FORGED_TENANT_ID = 'forged-platform-tenant';

function parseError(body) {
  try {
    const parsed = JSON.parse(body);
    return { code: parsed?.code ?? null, error: typeof parsed?.error === 'string' ? parsed.error : null };
  } catch {
    return { code: null, error: null };
  }
}

/** A refusal CarUp's authority layer issued — as opposed to a missing route, a dead session or CSRF. */
function assertAuthorityRefusal(label, response) {
  const { code, error } = parseError(response.body);
  assert.equal(response.status, 403, `${label}: expected a 403 authority refusal, got ${response.status} ${response.body.slice(0, 300)}`);
  assert.ok(error, `${label}: a 403 without a JSON error is not an identifiable authority refusal: ${response.body.slice(0, 300)}`);
  assert.doesNotMatch(error, /csrf/i, `${label}: refused by CSRF, which proves nothing about authority`);
  assert.notEqual(code, 'STEP_UP_REQUIRED', `${label}: a non-admin must be refused on authority, before step-up is considered`);
  assert.match(error, /^Forbidden\b/, `${label}: not an authorization refusal: ${error}`);
  return { status: response.status, code, error };
}

/**
 * @param {{ get: (path: string, headers: Record<string,string>) => Promise<{status:number, body:string}> }} client
 * @param {Record<string,string>} sessionHeaders  the actor's REAL session headers, including their own
 *                                                 x-stakeholder-role (never a forged one)
 * @param {string} label
 */
export async function probeAuthorityForgery(client, sessionHeaders, label) {
  const receipt = { label, role_forgery: [], tenant_forgery: {} };

  // Positive control: the session is live and the own-role surface is readable. Without this, every
  // refusal below could be a dead session wearing a 403.
  const control = await client.get(OWN_ROLE_SURFACE, sessionHeaders);
  assert.equal(control.status, 200, `${label}: positive control ${OWN_ROLE_SURFACE} must be 200, got ${control.status} ${control.body.slice(0, 300)}`);

  // ROLE FORGERY — independent experiment.
  const claimedAdmin = { ...sessionHeaders, 'x-stakeholder-role': 'admin' };
  for (const path of PLATFORM_REVIEW_SURFACES) {
    receipt.role_forgery.push({ path, ...assertAuthorityRefusal(`${label} claiming admin on ${path}`, await client.get(path, claimedAdmin)) });
  }

  // TENANT FORGERY — independent experiment: the genuine role header, only the tenant forged.
  const foreignTenant = { ...sessionHeaders, 'x-tenant-id': FORGED_TENANT_ID };
  assert.notEqual(foreignTenant['x-stakeholder-role'], 'admin', `${label}: tenant probe must not carry a forged role`);
  receipt.tenant_forgery.own_role_surface = assertAuthorityRefusal(
    `${label} with only a foreign tenant on ${OWN_ROLE_SURFACE} (200 without it)`,
    await client.get(OWN_ROLE_SURFACE, foreignTenant),
  );
  receipt.tenant_forgery.platform_surfaces = [];
  for (const path of PLATFORM_REVIEW_SURFACES) {
    receipt.tenant_forgery.platform_surfaces.push({ path, ...assertAuthorityRefusal(`${label} with a foreign tenant on ${path}`, await client.get(path, foreignTenant)) });
  }
  return receipt;
}
