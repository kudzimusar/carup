/**
 * O2 moderator recertification — the deployed P7 authority probes, run against the REAL middleware.
 *
 * `tests/agents/o2-authority-probes.mjs` is the one implementation the deployed P7 spec drives
 * against the exact-head staging pair. A deployed server cannot be mutated, so this suite drives the
 * SAME module against the real `authorizeRole` through a real Express router and the middleware's
 * own `supabaseClient` seam (session → platform role → tenant membership → effective role). A
 * deliberate mutation of `authMiddleware.js` therefore shows whether each probe is load-bearing:
 *
 *   - adopt a claimed `x-stakeholder-role` → the ROLE-forgery probe goes red;
 *   - accept a foreign `x-tenant-id` without a membership row → the TENANT-forgery probe goes red,
 *     while role verification is still intact.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { probeAuthorityForgery, FORGED_TENANT_ID } from '../../tests/agents/o2-authority-probes.mjs';

const TOKEN = 'session-token-applicant';
const APPLICANT = { id: 'u_applicant', role: 'owner', is_verified: true };

/** Just enough of the Supabase query builder for authorizeRole's three reads. */
function fakeSupabase({ sessions, users, tenantUsers }) {
  return {
    from(table) {
      const filters = {};
      const builder = {
        select() { return builder; },
        eq(column, value) { filters[column] = value; return builder; },
        async single() {
          if (table === 'user_sessions') {
            const row = sessions.find((s) => s.token === filters.token);
            return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
          }
          if (table === 'users') {
            const row = users.find((u) => u.id === filters.id);
            return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
          }
          if (table === 'tenant_users') {
            const row = tenantUsers.find((m) => m.tenant_id === filters.tenant_id && m.user_id === filters.user_id);
            return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
      return builder;
    },
  };
}

async function withServer(fn) {
  const db = fakeSupabase({
    sessions: [{ token: TOKEN, user_id: APPLICANT.id, is_valid: true, expires_at: new Date(Date.now() + 3_600_000).toISOString() }],
    users: [APPLICANT],
    tenantUsers: [], // the applicant belongs to no tenant — least of all the forged one
  });
  const ok = (req, res) => res.json({ ok: true, role: req.userContext.role });
  const app = express();
  // Same role lists the mounted routes use.
  app.get('/api/vehicles/me', authorizeRole(['owner', 'dealer', 'admin'], { supabaseClient: db }), ok);
  app.get('/api/admin/identity/verification-sessions', authorizeRole(['admin'], { supabaseClient: db }), ok);
  app.get('/api/admin/dealers', authorizeRole(['admin', 'government', 'reviewer'], { supabaseClient: db }), ok);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const client = {
    get: async (path, headers) => {
      const response = await fetch(`${base}${path}`, { headers });
      return { status: response.status, body: await response.text() };
    },
  };
  try { return await fn(client); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const applicantHeaders = { 'x-session-token': TOKEN, 'x-user-id': APPLICANT.id, 'x-stakeholder-role': APPLICANT.role };

test('the deployed P7 authority probes pass against the real authorizeRole', async () => {
  const receipt = await withServer((client) => probeAuthorityForgery(client, applicantHeaders, 'applicant'));
  assert.equal(receipt.role_forgery.length, 2);
  assert.equal(receipt.tenant_forgery.platform_surfaces.length, 2);
  assert.equal(receipt.tenant_forgery.own_role_surface.status, 403);
});

test('the tenant probe is independent: the positive surface flips 200 → 403 on the tenant header ALONE', async () => {
  await withServer(async (client) => {
    const own = await client.get('/vehicles/me', applicantHeaders);
    const foreign = await client.get('/vehicles/me', { ...applicantHeaders, 'x-tenant-id': FORGED_TENANT_ID });
    assert.equal(own.status, 200);
    assert.equal(foreign.status, 403, 'nothing but the tenant changed, so only tenant verification can have refused');
    assert.equal(applicantHeaders['x-stakeholder-role'], 'owner', 'no forged role is in play');
  });
});

test('ANTI-VACUITY — the probe refuses to certify a dead session', async () => {
  await withServer(async (client) => {
    await assert.rejects(
      probeAuthorityForgery(client, { ...applicantHeaders, 'x-session-token': 'revoked' }, 'dead session'),
      /positive control/,
      'every 403 below would otherwise be a 401-shaped session failure wearing an authority label',
    );
  });
});
