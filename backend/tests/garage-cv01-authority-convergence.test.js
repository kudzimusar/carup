import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (url) => readFileSync(url, 'utf8');

test('CV01 keeps tenant authority centralized and does not restore legacy Garage context authority', () => {
  assert.equal(
    existsSync(new URL('../services/garageOnboarding/garageContextService.js', import.meta.url)),
    false,
    'legacy garageContextService must not return; active organization authority is centralized',
  );
  assert.equal(
    existsSync(new URL('../../web/src/components/garage/GarageContextSwitcher.tsx', import.meta.url)),
    false,
    'legacy GarageContextSwitcher must not return as an authority selector',
  );

  const auth = read(new URL('../middleware/authMiddleware.js', import.meta.url));
  const activeTenant = read(new URL('../services/auth/activeTenantContext.js', import.meta.url));

  assert.match(auth, /resolveSessionByToken/);
  assert.match(auth, /resolveVerifiedActiveTenant/);
  assert.match(auth, /active_organization_id/);
  assert.match(auth, /TENANT_CONTEXT_MISMATCH/);
  assert.match(activeTenant, /user_sessions\.active_organization_id/);
  assert.match(activeTenant, /never picks a tenant/i);
});

test('CV01 preserves typed active-Garage authorization on invitation and membership surfaces', () => {
  const invitations = read(new URL('../routes/garageInvitationRoutes.js', import.meta.url));
  const memberships = read(new URL('../routes/garageMembershipRoutes.js', import.meta.url));

  for (const source of [invitations, memberships]) {
    assert.match(source, /requireActiveTenant/);
    assert.match(source, /GARAGE_TENANT_TYPE/);
    assert.match(source, /GARAGE_ADMIN_ROLES/);
  }
});

test('CV01 preserves server-derived atomic Garage activation', () => {
  const migration = read(new URL('../../database/migrations/20261004190100_gmo4_garage_business_activation.sql', import.meta.url));

  assert.match(migration, /activate_garage_application/i);
  assert.match(migration, /FOR UPDATE/i);
  assert.match(migration, /INSERT INTO public\.tenant_users \(tenant_id, user_id, role\)/i);
  assert.match(migration, /VALUES \(v_tenant_id, v_app\.applicant_user_id, 'admin'\)/i);
  assert.match(migration, /GARAGE_APPLICATION_ALREADY_ACTIVATED/);
  assert.doesNotMatch(migration, /p_tenant_id/i);
  assert.doesNotMatch(migration, /p_founder/i);
  assert.doesNotMatch(migration, /p_role/i);
});

test('CV01 preserves atomic, verified-email-bound invitation acceptance', () => {
  const migration = read(new URL('../../database/migrations/20261004190200_gmo6_garage_invitations.sql', import.meta.url));

  assert.match(migration, /accept_garage_invitation/i);
  assert.match(migration, /FOR UPDATE/i);
  assert.match(migration, /email_verified_at/i);
  assert.match(migration, /GARAGE_INVITATION_EMAIL_UNVERIFIED/);
  assert.match(migration, /GARAGE_INVITATION_WRONG_RECIPIENT/);
  assert.match(migration, /GARAGE_INVITATION_NOT_AN_ACTIVE_GARAGE/);
  assert.match(migration, /INSERT INTO public\.tenant_users/i);
});

test('CV01 preserves serialized last-admin protection and historical membership semantics', () => {
  const migration = read(new URL('../../database/migrations/20261004190300_gmo7_garage_membership_guard.sql', import.meta.url));
  const service = read(new URL('../services/garageOnboarding/garageMembershipService.js', import.meta.url));

  assert.match(migration, /FOR UPDATE/i);
  assert.match(migration, /GARAGE_MEMBERSHIP_LAST_ADMIN/);
  assert.match(migration, /remove_garage_member/i);
  assert.match(migration, /change_garage_member_role/i);
  assert.match(service, /HISTORICAL truth/i);
  assert.match(service, /work_order_assignments\.mechanic_user_id/i);
});

test('CV01 preserves branch-to-tenant and work-order assignment integrity', () => {
  const cases = read(new URL('../../database/migrations/20261004180100_service_network_s2_service_cases.sql', import.meta.url));
  const work = read(new URL('../../database/migrations/20261004180300_service_network_s4_work_order_assignment.sql', import.meta.url));

  assert.match(cases, /FOREIGN KEY \(branch_id, garage_tenant_id\)/i);
  assert.match(cases, /REFERENCES garage_branches\(id, tenant_id\)/i);
  assert.match(work, /FOREIGN KEY \(branch_id, tenant_id\)/i);
  assert.match(work, /REFERENCES garage_branches\(id, tenant_id\)/i);
  assert.match(work, /uq_work_order_assignments_live/i);
  assert.match(work, /REFERENCES mechanic_work_orders\(id\) ON DELETE RESTRICT/i);
});

test('CV01 preserves AUTH-05 dedicated session authority and Corporate separation', () => {
  const auth05 = read(new URL('../../database/migrations/20261016010000_ca_k3_auth_05_session_identity_authority.sql', import.meta.url));
  const atomic = read(new URL('../../database/migrations/20261016163834_ca_k3_auth_05_r4_atomic_owner_registration.sql', import.meta.url));
  const sessionAuthority = read(new URL('../services/auth/sessionAuthority.js', import.meta.url));

  assert.match(auth05, /carup_session_authority/);
  assert.match(auth05, /service_role alone must not mint/i);
  assert.match(sessionAuthority, /CA-K3-AUTH-05/);
  assert.match(atomic, /registration/i);

  const tenantRoles = read(new URL('../services/auth/tenantRoleCatalogue.js', import.meta.url));
  assert.match(tenantRoles, /mechanic/);
  assert.match(tenantRoles, /dealer/);
});
