/**
 * O2 (J-3) — the governed Dealer↔tenant binding, resolved server-side.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. `authorizeRole` sets `userContext.tenantId` from the
 * `x-tenant-id` header once ANY `tenant_users` row links that user to that tenant, and with no
 * `x-stakeholder-role` the effective role is the PLATFORM role. So a platform `dealer` who is a
 * MECHANIC in a Garage — or a plain member of any organisation at all — arrived at
 * `buildVehicleListingCandidate` as `{ role: 'dealer', tenantId: <that garage> }` and was handed
 * `current_seller_type: 'Dealer'` for an organisation that never authorised them to sell anything.
 * Measured, not theorised: `seller_type=Dealer tenant_id=tenant-garage-1`.
 *
 * Membership says a person belongs to an organisation. It does not say they may trade on its
 * behalf. Those are different facts and CarUp already stores them in different places.
 *
 * THE AUTHORITY IS `dealer_profiles`, AND IT ALREADY EXISTS. That table carries both `user_id` and
 * `tenant_id`, is indexed on the tenant (`idx_dealer_profiles_tenant`), is queried by tenant
 * (`listProfiles({ tenantId })`), and its own service states the contract outright: tenant binding
 * "is derived server-side from a governed organization relationship or stays null until one
 * exists" — which is why X5 deliberately excluded `tenant_id` from the client-editable profile
 * fields. Nothing is invented here; this reads the binding CarUp already defined.
 *
 * TWO SEPARATE QUESTIONS, DELIBERATELY NOT CONFLATED:
 *   1. WHO IS THE SELLER — resolved here. Does a governed dealership relationship exist between
 *      this actor and this tenant, and has that authority been withdrawn?
 *   2. MAY THE LISTING BE PUBLISHED — `dealerComplianceService.deriveCanPublish`, untouched by
 *      this module. Identity verification, compliance review, blocking requirements and expiry
 *      gate PUBLICATION; they do not decide whose private draft it is. Requiring full publication
 *      compliance to create a draft would be a different (and stricter) contract than CarUp's.
 *
 * Withdrawal IS a subject question, so `suspension_state = 'suspended'` refuses a subject here: a
 * suspended dealership's authority to act as the seller has been revoked, not merely limited.
 * `restriction_state` stays a publication matter, where `deriveCanPublish` already handles it.
 *
 * HONEST CURRENT BOUNDARY: no product path writes `dealer_profiles.tenant_id` today — X5 excluded
 * it and nothing else sets it. So on current data this resolver grants NO dealer a listing
 * subject. That is the correct fail-closed answer and it matches O2's already-documented boundary
 * that no governed path converts an approved applicant into an active Dealer. Dealer activation is
 * NOT invented here; it remains a Product Owner decision.
 */

export const DEALER_SUBJECT_REASONS = {
  NOT_A_DEALER_ROLE: 'not_a_dealer_role',
  NO_TENANT_CONTEXT: 'no_tenant_context',
  NO_GOVERNED_DEALER_BINDING: 'no_governed_dealer_binding',
  DEALER_AUTHORITY_WITHDRAWN: 'dealer_authority_withdrawn',
};

const refuse = (reason) => ({ granted: false, tenantId: null, dealerProfileId: null, reason });

/**
 * Resolve whether this actor may list vehicles AS this tenant.
 *
 * Fail-closed at every exit, including an unreadable `dealer_profiles`: an authority question that
 * cannot be answered is answered "no". The result is a plain value so the listing candidate itself
 * stays pure and synchronous — and so a caller that forgets to resolve gets no subject rather than
 * an open default.
 *
 * @param {*} db  Supabase-like client.
 * @param {{ role?: string|null, userId?: string|null, tenantId?: string|null }} actor
 * @returns {Promise<{granted:boolean, tenantId:string|null, dealerProfileId:string|null, reason:string|null}>}
 */
export async function resolveDealerListingSubject(db, { role, userId, tenantId } = {}) {
  const normalizedRole = String(role ?? '').trim().toLowerCase();
  if (normalizedRole !== 'dealer') return refuse(DEALER_SUBJECT_REASONS.NOT_A_DEALER_ROLE);
  if (!userId || !tenantId) return refuse(DEALER_SUBJECT_REASONS.NO_TENANT_CONTEXT);
  if (!db || typeof db.from !== 'function') return refuse(DEALER_SUBJECT_REASONS.NO_GOVERNED_DEALER_BINDING);

  let profile = null;
  try {
    // BOTH dimensions are filtered here. Scoping by only one would ask a different — and much
    // weaker — question than "is this actor the dealer for THIS tenant".
    const { data, error } = await db
      .from('dealer_profiles')
      .select('id, tenant_id, suspension_state')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) return refuse(DEALER_SUBJECT_REASONS.NO_GOVERNED_DEALER_BINDING);
    profile = data;
  } catch {
    return refuse(DEALER_SUBJECT_REASONS.NO_GOVERNED_DEALER_BINDING);
  }

  if (!profile || profile.tenant_id !== tenantId) {
    return refuse(DEALER_SUBJECT_REASONS.NO_GOVERNED_DEALER_BINDING);
  }
  if (profile.suspension_state === 'suspended') {
    return refuse(DEALER_SUBJECT_REASONS.DEALER_AUTHORITY_WITHDRAWN);
  }
  return { granted: true, tenantId, dealerProfileId: profile.id ?? null, reason: null };
}

export default { resolveDealerListingSubject, DEALER_SUBJECT_REASONS };
