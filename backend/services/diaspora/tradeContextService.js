/**
 * Trade OS identity/context projection (owner UAT #3/#7).
 *
 * The Trade OS workspace must present the user's REAL commercial context — organisation, business
 * type, corridor relationship, membership role — never the platform security role ("Car Owner" is a
 * users.role authorization label, not a trade identity). This is a read-only projection over the
 * existing authorities (users, user_registration_profiles, tenants + the middleware-verified tenant
 * membership); it duplicates nothing and grants nothing. Unknown facts stay null — the UI renders
 * truthful absence, never a guess.
 */
import { requireUserContext, TENANT_ADMIN_ROLES } from './diasporaAuthorization.js';
import { resolveClient } from './diasporaServiceUtils.js';

export async function getTradeContext(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);

  const [userRes, profileRes, tenantRes] = await Promise.all([
    client.from('users').select('id, name').eq('id', context.id).single(),
    client.from('user_registration_profiles').select('account_kind, market_relationship, business_type, organization_name, country_of_residence, city').eq('user_id', context.id).maybeSingle(),
    context.tenantId
      ? client.from('tenants').select('id, name').eq('id', context.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profile = profileRes?.data || null;
  const tenant = tenantRes?.data || null;
  const tenantRole = String(context.tenantRole || '').toLowerCase() || null;

  return {
    user: { id: context.id, name: userRes?.data?.name || null },
    // Organisation context exists ONLY through the middleware-verified tenant membership.
    organisation: tenant ? { id: tenant.id, name: tenant.name || null } : null,
    tenant_role: tenantRole,
    is_organisation_admin: Boolean(tenantRole && TENANT_ADMIN_ROLES.has(tenantRole)),
    account_kind: profile?.account_kind || null,
    business_type: profile?.business_type || null,
    organization_name: profile?.organization_name || null,
    market_relationship: profile?.market_relationship || null,
    country_of_residence: profile?.country_of_residence || null,
    city: profile?.city || null,
  };
}
