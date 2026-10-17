/**
 * The governed tenant-role catalogue (OC-5A, RC1 residual finding B).
 *
 * Two namespaces share spellings. `users.role` is the PLATFORM role: what CarUp itself has decided a
 * person is. `tenant_users.role` is a role INSIDE ONE ORGANISATION: what that organisation's own
 * records say the person does there. Until OC-5A, `resolveEffectiveRole` let a caller adopt ANY
 * tenant role except 'admin' as their effective role, by naming it in `x-stakeholder-role` alongside
 * that tenant's `x-tenant-id`. A tenant row reading 'government', 'reviewer' or 'finance' — however it
 * came to exist — therefore made its holder a government reviewer on every route that lists one,
 * escrow release included. The server reasoned "a tenant row says government, so the caller is
 * government". It must never reason that way.
 *
 * The rule is now an allow-list, never a deny-list:
 *
 *   TENANT_MEMBERSHIP_ROLES  the only values a membership may hold (enforced for new rows by the
 *                            `tenant_users_role_catalogue` CHECK — the constraint #209 GMO-5 designed,
 *                            under the same name).
 *   LENDABLE_TENANT_ROLES    the only roles a verified membership may LEND as the effective role:
 *                            the two operating domain roles, 'mechanic' and 'dealer'. Lending is
 *                            necessary, never sufficient — the domain authority still decides object
 *                            authority (a lent 'dealer' still needs governed Dealer authority over the
 *                            vehicle, a lent 'mechanic' still needs a governed service relationship).
 *   PROTECTED_PLATFORM_ROLES roles no tenant row can ever lend. The test suite proves this set and the
 *                            lendable set are disjoint, so adding a protected role to the lendable set
 *                            fails by name rather than silently re-opening the escalation.
 *
 * A tenant 'admin' administers ONE organisation. It is never a CarUp administrator, and it is never
 * lendable. Tenant-scoped checks (an organisation's own admin managing that organisation's records)
 * stay where they are; they are scoped to the tenant they were verified for and grant nothing beyond it.
 */

const normalize = (role) => (role == null ? '' : String(role).trim().toLowerCase());

/** Values a `tenant_users.role` may hold. 'member' is the column's own DEFAULT. */
export const TENANT_MEMBERSHIP_ROLES = Object.freeze(['admin', 'mechanic', 'dealer', 'member']);

/** The only roles a verified tenant membership may lend as the caller's effective role. */
export const LENDABLE_TENANT_ROLES = Object.freeze(['mechanic', 'dealer']);

/**
 * Roles that carry platform, regulatory or financial authority. No tenant row lends any of them.
 * The list is documentation and test surface; the guard itself is the lendable allow-list above,
 * which refuses every value not named there — including ones nobody has thought of yet.
 */
export const PROTECTED_PLATFORM_ROLES = Object.freeze([
  // CarUp administration
  'admin', 'platform_admin', 'super_admin', 'administrator', 'tenant_admin',
  // government and review authority
  'government', 'government_reviewer', 'reviewer',
  // finance and insurance authority
  'finance', 'bank', 'lender', 'insurance', 'insurer',
  // compliance authority
  'compliance', 'compliance_officer', 'compliance_reviewer', 'auditor',
]);

/**
 * Pre-catalogue values some TENANT-SCOPED checks still honour inside their own organisation (Diaspora's
 * tenant admin: 'administrator', 'tenant_admin'; Dealer business authority: 'owner'), plus 002's
 * documented example 'manager'. No new row can be written with one (the catalogue CHECK), none is
 * lendable, and none reaches beyond the tenant it was verified for. They stay honoured until the role
 * counts on staging and production are read — removing them blind could strip a real dealership
 * proprietor of authority. A test pins every tenant-scoped role set to catalogue ∪ these aliases, so a
 * new free-form value cannot creep in.
 */
export const LEGACY_TENANT_ROLE_ALIASES = Object.freeze(['administrator', 'tenant_admin', 'owner', 'manager']);

const LENDABLE = new Set(LENDABLE_TENANT_ROLES);
const MEMBERSHIP = new Set(TENANT_MEMBERSHIP_ROLES);

/** Whether a verified membership in this role may lend it as the effective role. */
export function isLendableTenantRole(role) {
  return LENDABLE.has(normalize(role));
}

/** Whether a value belongs to the governed membership catalogue. */
export function isCatalogueTenantRole(role) {
  return MEMBERSHIP.has(normalize(role));
}

export default {
  TENANT_MEMBERSHIP_ROLES,
  LENDABLE_TENANT_ROLES,
  PROTECTED_PLATFORM_ROLES,
  LEGACY_TENANT_ROLE_ALIASES,
  isLendableTenantRole,
  isCatalogueTenantRole,
};
