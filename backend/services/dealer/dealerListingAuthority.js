/**
 * O2 (J-3 / K-3) — the governed Dealer↔tenant relationship, resolved server-side.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. `authorizeRole` sets `userContext.tenantId` from `x-tenant-id`
 * once ANY `tenant_users` row links that user to that tenant, and with no `x-stakeholder-role` the
 * effective role is the PLATFORM role. So a platform `dealer` who is a MECHANIC in a Garage
 * arrived at `buildVehicleListingCandidate` as `{ role: 'dealer', tenantId: <that garage> }` and
 * was handed `current_seller_type: 'Dealer'` for an organisation that never authorised them to
 * sell anything. Measured, not theorised: `seller_type=Dealer tenant_id=tenant-garage-1`.
 *
 * K-3 — WHY THIS IS NO LONGER `dealer_profiles.tenant_id` ALONE.
 *
 * The J-round made that binding the SOLE prerequisite. It is server-controlled and correct as far
 * as it goes, but no product path writes it (X5 deliberately excluded `tenant_id` from the editable
 * profile fields, and nothing else sets it), so requiring it disabled EVERY current Dealer. That is
 * not deferred onboarding for future applicants — it is a live behavioural regression from `main`.
 * Measured on staging: 14 platform-dealer users, 5 holding a tenant membership, 4 dealer profiles,
 * and 0 profiles carrying a tenant_id.
 *
 * The governed fact CarUp already had is the ORGANISATION ITSELF. All five real Dealer memberships
 * are `admin` of an `active` tenant whose canonical `type` is a dealership type. Both inputs are
 * genuinely server-controlled: an audit of the candidate tree found ZERO writes to `tenants` or
 * `tenant_users` anywhere in the backend — no route, no RPC, no service. The only INSERTs in the
 * whole repository are seed statements in migration 002. A client cannot create a tenant, cannot
 * set its `type`, and cannot mint itself a membership.
 *
 * So the authority is a COMPOSITION, and every part is required:
 *
 *   1. effective role `dealer`            — a governed platform role, resolved by `authorizeRole`
 *   2. a validated `tenant_users` membership  — re-verified per request, never trusted from a header
 *   3. that membership's role ACTS FOR the business (owner/admin/dealer — never mechanic/member)
 *   4. `tenants.type` is a dealership type    — CarUp's own `{dealer, dealership}` vocabulary
 *   5. `tenants.status` is active             — a wound-up organisation sells nothing
 *
 * Requirement 3 is what keeps a MECHANIC EMPLOYED BY A DEALERSHIP out: the tenant type alone would
 * have let them sell on the dealership's behalf. Requirement 4 is what keeps a garage out. Neither
 * alone is sufficient, which is exactly why both are here.
 *
 * `dealer_profiles` is consulted for WITHDRAWAL only: a suspended profile refuses. It deliberately
 * does NOT grant on its own — see the note at the binding check below for the RLS reason.
 *
 * DELIBERATELY EXCLUDED, and reported rather than decided quietly: tenant type `import` (4 tenants
 * on staging, one of them with a platform-dealer admin). It denotes the diaspora import/logistics
 * business, and it is NOT in CarUp's own dealer-seller vocabulary. Admitting it would be inventing
 * selling authority from a type that means something else. Membership role `manager` is excluded on
 * the same principle — no current Dealer holds it, so nothing is lost by staying tight, and it can
 * be added by an explicit product decision rather than by my assumption.
 *
 * TWO SEPARATE QUESTIONS, STILL NOT CONFLATED:
 *   1. WHO IS THE SELLER — resolved here.
 *   2. MAY THE LISTING BE PUBLISHED — `dealerComplianceService.deriveCanPublish`, untouched.
 *      Identity verification, compliance review, blocking requirements and expiry gate PUBLICATION;
 *      they do not decide whose private draft it is.
 *
 * Dealer ACTIVATION is still not invented here. This grants nothing that `main` did not already
 * grant; it removes the paths `main` granted wrongly.
 */

export const DEALER_SUBJECT_REASONS = {
  NOT_A_DEALER_ROLE: 'not_a_dealer_role',
  NO_TENANT_CONTEXT: 'no_tenant_context',
  NO_TENANT_MEMBERSHIP: 'no_tenant_membership',
  MEMBERSHIP_NOT_BUSINESS_AUTHORITY: 'membership_not_business_authority',
  TENANT_NOT_A_DEALERSHIP: 'tenant_not_a_dealership',
  TENANT_NOT_ACTIVE: 'tenant_not_active',
  DEALER_AUTHORITY_WITHDRAWN: 'dealer_authority_withdrawn',
};

/**
 * Tenant types that denote a vehicle-selling business. This is CarUp's OWN vocabulary, mirroring
 * `DEALER_SELLER_TYPES` in `marketplaceTransactionAuthority.js` and the dealer entries in
 * `ALLOWED_SELLER_TYPES`; it is not a new taxonomy.
 */
export const DEALERSHIP_TENANT_TYPES = new Set(['dealer', 'dealership']);

/**
 * Membership roles that ACT FOR the organisation rather than merely belong to it. `tenant_users`
 * roles are generic organisational membership — the schema comments them as 'admin'/'manager'/
 * 'member', and staging carries 10 `mechanic` rows against 9 `admin`. Employment is not agency.
 */
export const BUSINESS_AUTHORITY_MEMBERSHIP_ROLES = new Set(['owner', 'admin', 'dealer']);

const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
const refuse = (reason) => ({ granted: false, tenantId: null, dealerProfileId: null, reason });

/**
 * Resolve whether this actor may list vehicles AS this tenant.
 *
 * Fail-closed at every exit, including an unreadable table: an authority question that cannot be
 * answered is answered "no". The result is a plain value so the listing candidate stays pure and
 * synchronous — and so a caller that forgets to resolve gets no subject rather than an open default.
 *
 * @param {*} db  Supabase-like client.
 * @param {{ role?: string|null, userId?: string|null, tenantId?: string|null }} actor
 * @returns {Promise<{granted:boolean, tenantId:string|null, dealerProfileId:string|null, reason:string|null}>}
 */
export async function resolveDealerListingSubject(db, { role, userId, tenantId } = {}) {
  if (norm(role) !== 'dealer') return refuse(DEALER_SUBJECT_REASONS.NOT_A_DEALER_ROLE);
  if (!userId || !tenantId) return refuse(DEALER_SUBJECT_REASONS.NO_TENANT_CONTEXT);
  if (!db || typeof db.from !== 'function') return refuse(DEALER_SUBJECT_REASONS.NO_TENANT_MEMBERSHIP);

  const read = async (table, columns, filters) => {
    try {
      let q = db.from(table).select(columns);
      for (const [column, value] of Object.entries(filters)) q = q.eq(column, value);
      const { data, error } = await q.maybeSingle();
      return error ? { failed: true, row: null } : { failed: false, row: data || null };
    } catch {
      return { failed: true, row: null };
    }
  };

  // A dealer profile SUSPENSION withdraws authority by every path, so it is checked first and its
  // absence is not a refusal — most dealers have no profile at all.
  const profile = await read('dealer_profiles', 'id, tenant_id, suspension_state', { user_id: userId });
  if (profile.failed) return refuse(DEALER_SUBJECT_REASONS.DEALER_AUTHORITY_WITHDRAWN);
  if (profile.row && norm(profile.row.suspension_state) === 'suspended') {
    return refuse(DEALER_SUBJECT_REASONS.DEALER_AUTHORITY_WITHDRAWN);
  }

  // The membership is validated here as well as in `authorizeRole`: this function is also called
  // from the workbook and the catalogue, and must not depend on a caller having done that first.
  const membership = await read('tenant_users', 'role', { tenant_id: tenantId, user_id: userId });
  if (membership.failed || !membership.row) return refuse(DEALER_SUBJECT_REASONS.NO_TENANT_MEMBERSHIP);

  const tenant = await read('tenants', 'id, type, status', { id: tenantId });
  if (tenant.failed || !tenant.row) return refuse(DEALER_SUBJECT_REASONS.NO_TENANT_MEMBERSHIP);
  if (norm(tenant.row.status) !== 'active') return refuse(DEALER_SUBJECT_REASONS.TENANT_NOT_ACTIVE);

  const grant = () => ({
    granted: true, tenantId, dealerProfileId: profile.row?.id ?? null, reason: null,
  });

  // L — THE PROFILE BINDING WITHDRAWS AUTHORITY; IT NEVER GRANTS IT ON ITS OWN.
  //
  // The K-round treated `dealer_profiles.tenant_id === tenantId` as sufficient by itself. Measured
  // on staging, `dealer_profiles` carries RLS policies granting `authenticated` INSERT and UPDATE
  // on their OWN row, and those policies' WITH CHECK constrains `user_id` — not `tenant_id`. So a
  // self-service write could have set that column to any dealership and bypassed the tenant-type
  // and membership-role tests entirely.
  //
  // It cannot fire today (CarUp uses custom auth: `auth.users` is empty, so `auth.uid()` is NULL
  // and those policies never match; and all four profiles have `tenant_id` NULL). But an authority
  // must not depend on a policy predicate remaining incomplete somewhere else, so the governed
  // organisation facts below are now required in EVERY case. The suspension check above still
  // withdraws authority, which is the direction a profile may safely decide on its own.

  if (!DEALERSHIP_TENANT_TYPES.has(norm(tenant.row.type))) {
    return refuse(DEALER_SUBJECT_REASONS.TENANT_NOT_A_DEALERSHIP);
  }
  if (!BUSINESS_AUTHORITY_MEMBERSHIP_ROLES.has(norm(membership.row.role))) {
    return refuse(DEALER_SUBJECT_REASONS.MEMBERSHIP_NOT_BUSINESS_AUTHORITY);
  }
  return grant();
}

/**
 * L-2 — THE ONE PRIMITIVE FOR DEALER AUTHORITY OVER AN EXISTING TENANT-SCOPED VEHICLE.
 *
 * K-3 fixed listing CREATION, and left every EXISTING-vehicle seller mutation authorizing on raw
 * tenant equality — `vehicle.tenant_id === userContext.tenantId` — which `authorizeRole` satisfies
 * for anyone who merely belongs to the organisation. Measured on the real routes: a platform
 * `dealer` who is only a MECHANIC in a dealership, on a vehicle they neither own nor sell, was
 * refused CREATION (`membership_not_business_authority`) and yet could publish (200), unpublish
 * (200), reprice to 99999 (200) and mark it Sold (200).
 *
 * This is deliberately ONE function rather than a copy of the K-3 matrix at each route: a second
 * copy is a second thing to forget. It consumes exactly the same governed facts as
 * `resolveDealerListingSubject`, so creation and lifecycle cannot drift apart.
 *
 * SCOPE — this answers ONLY "may this actor exercise DEALER SELLER/COMMERCE authority for this
 * vehicle's tenant?". It is not a general tenant-access gate and must not become one. Service
 * Network mechanics keep their own governed assignment path, PartSentry keeps its own capability,
 * and lender/insurer object access keeps `resolveVehicleObjectAuthority`. A mechanic servicing a
 * vehicle is not a Dealer seller, and this closure must not cost them their service authority.
 *
 * Callers should consult it ONLY after the owner and current-seller clauses have failed. That is
 * not just an optimisation: it keeps the seller's own hot path at zero added queries, which the
 * publish/price routes documented as load-bearing after a Golden lifecycle run came within a
 * minute of its per-test timeout.
 *
 * @returns {Promise<boolean>} true only for a governed dealership relationship over THIS vehicle.
 */
export async function hasGovernedDealerVehicleAuthority(db, userContext, vehicle) {
  const tenantId = userContext?.tenantId ?? null;
  const vehicleTenant = vehicle?.tenant_id ?? null;
  // Raw tenant equality is NECESSARY but never SUFFICIENT.
  if (!tenantId || !vehicleTenant || String(vehicleTenant) !== String(tenantId)) return false;
  const subject = await resolveDealerListingSubject(db, {
    role: userContext.role ?? userContext.effectiveRole,
    userId: userContext.id ?? userContext.userId,
    tenantId,
  });
  return subject.granted === true;
}

export default {
  resolveDealerListingSubject,
  hasGovernedDealerVehicleAuthority,
  DEALER_SUBJECT_REASONS,
  DEALERSHIP_TENANT_TYPES,
  BUSINESS_AUTHORITY_MEMBERSHIP_ROLES,
};
