/**
 * People & Compliance reviewer read model — O2/P3.
 *
 * ONE person-centered aggregate that lets an authorized reviewer understand a person's or
 * business's complete verification/compliance state without opening five consoles. It is a READ
 * MODEL, not a new source of truth: every section is assembled from the owning canonical
 * service/table, every responsibility is DERIVED through the domain-owned projections (never
 * stored), and every mutation goes back through the owning domain service — there is no combined
 * "verify everything" write path, and no "verified seller" boolean anywhere in the DTO: email
 * verification, identity verification, Seller Authority, vehicle ownership and dealer compliance
 * are SEPARATE facts with separate owners, presented separately.
 *
 * PRIVACY (O2 privacy matrix):
 *  - identity ARTIFACTS (document images, selfies) never appear — not even links; the owning
 *    identity service's scoped preview route is the only access path;
 *  - no OCR raw values, no extraction payloads, no identity-binding detail — statuses only;
 *  - internal reviewer notes stay in the identity domain's reviewer surface; this aggregate
 *    carries decisions and reason CODES, not free text about the applicant;
 *  - audit entries expose decision facts (event, actor role, reason, timestamps) — never
 *    ip_address / user_agent / tokens, and never reviewer user ids;
 *  - allowed_actions are SERVER-derived from the Operations capability policy (G2).
 */
import { legacyStatusToPhase, toResponsibilityProjection as identityResponsibility } from '../identity/caseWorkflow.js';
import { toResponsibilityProjection as authorityResponsibility } from '../seller/sellerAuthorityService.js';
import { toResponsibilityProjection as dealerResponsibility, deriveExpiryState, isRequirementBlocking } from '../dealer/dealerComplianceService.js';
import { toResponsibilityProjection as transferResponsibility } from '../passport/passportOwnershipTransferService.js';
import { allowedPeopleOperationsActions } from './operationsAuthorizationService.js';

const SESSION_LIMIT = 10;
const AUTHORITY_LIMIT = 25;
const TRANSFER_LIMIT = 25;
const AUDIT_EVENT_LIMIT = 40;

function rows(result) {
  return Array.isArray(result?.data) ? result.data : [];
}

export async function buildPersonComplianceReview(client, { userId, userContext }) {
  const id = String(userId || '').trim();
  if (!id) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const { data: person, error: pErr } = await client
    .from('users')
    .select('id, name, email, role, is_verified, join_date, created_at')
    .eq('id', id)
    .maybeSingle();
  if (pErr) {
    const err = new Error(`Person read failed: ${pErr.message}`);
    err.status = 500;
    throw err;
  }
  if (!person) {
    const err = new Error('Person not found');
    err.status = 404;
    throw err;
  }

  const [tenantRows, sessionRows, authorityRows, ownedRows, prevTransfers, incomingTransfers, dealerProfileRow] = await Promise.all([
    client.from('tenant_users').select('tenant_id, role, joined_at').eq('user_id', id),
    client
      .from('verification_sessions')
      .select('id, status, workflow_phase, final_disposition, primary_reason_code, review_decision, retry_reason, created_at, submitted_at, reviewed_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(SESSION_LIMIT),
    client
      .from('vehicle_seller_authority')
      .select('vin, claim_type, status, basis, reason, policy_version, decided_by_role, decided_at, created_at')
      .eq('seller_user_id', id)
      .order('created_at', { ascending: false })
      .limit(AUTHORITY_LIMIT),
    client.from('vehicles').select('vin, publication_status, make, model, year').eq('owner_id', id),
    client
      .from('vehicle_ownership_transfers')
      .select('id, vin, state, registry_authority, completed_at, created_at')
      .eq('previous_owner_id', id)
      .order('created_at', { ascending: false })
      .limit(TRANSFER_LIMIT),
    client
      .from('vehicle_ownership_transfers')
      .select('id, vin, state, registry_authority, completed_at, created_at')
      .eq('incoming_owner_id', id)
      .order('created_at', { ascending: false })
      .limit(TRANSFER_LIMIT),
    client.from('dealer_profiles').select('*').eq('user_id', id).maybeSingle(),
  ]);

  // ── Identity (identity service owns the truth; statuses only, artifacts never) ─────────
  const sessions = rows(sessionRows).map((session) => {
    const phase = session.workflow_phase || legacyStatusToPhase(session.status);
    return {
      id: session.id,
      status: session.status ?? null,
      workflow_phase: phase,
      final_disposition: session.final_disposition ?? null,
      primary_reason_code: session.primary_reason_code ?? null,
      review_decision: session.review_decision ?? null,
      retry_reason: session.retry_reason ?? null,
      created_at: session.created_at ?? null,
      submitted_at: session.submitted_at ?? null,
      reviewed_at: session.reviewed_at ?? null,
      who_must_act: identityResponsibility(phase),
    };
  });
  const latestSession = sessions[0] ?? null;

  // ── Seller Authority (per vehicle — the grain is vehicle × seller and stays that way) ──
  const authority = rows(authorityRows).map((row) => ({
    vin: row.vin,
    claim_type: row.claim_type,
    status: row.status,
    basis: row.basis ?? null,
    reason: row.reason ?? null,
    policy_version: row.policy_version,
    decided_by_role: row.decided_by_role ?? null,
    decided_at: row.decided_at ?? null,
    who_must_act: authorityResponsibility(row.status),
  }));

  // ── Ownership (canonical via the governed transfer lifecycle) ──────────────────────────
  const transfers = [
    ...rows(prevTransfers).map((t) => ({ ...t, relationship: 'previous_owner' })),
    ...rows(incomingTransfers).map((t) => ({ ...t, relationship: 'incoming_owner' })),
  ]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((t) => ({
      id: t.id,
      vin: t.vin,
      state: t.state,
      relationship: t.relationship,
      registry_authority: t.registry_authority ?? null,
      completed_at: t.completed_at ?? null,
      created_at: t.created_at ?? null,
      who_must_act: transferResponsibility(t.state),
    }));

  // ── Dealer compliance (domain statuses VERBATIM; the projection sits beside them) ──────
  const dealerProfile = dealerProfileRow?.data ?? null;
  let dealer = { is_dealer: false };
  if (dealerProfile) {
    const requirements = rows(await client
      .from('dealer_compliance_requirements')
      .select('requirement_key, status, is_blocking, updated_at')
      .eq('dealer_id', dealerProfile.id));
    dealer = {
      is_dealer: true,
      profile: {
        id: dealerProfile.id,
        suspension_state: dealerProfile.suspension_state ?? null,
        restriction_state: dealerProfile.restriction_state ?? null,
        compliance_review_state: dealerProfile.compliance_review_state ?? null,
        identity_status: dealerProfile.identity_status ?? null,
        expiry_date: dealerProfile.expiry_date ?? null,
        expiry_state: deriveExpiryState(dealerProfile),
      },
      requirements: requirements.map((r) => ({
        requirement_key: r.requirement_key,
        status: r.status,
        is_blocking: Boolean(r.is_blocking),
        still_blocking: isRequirementBlocking(r),
        updated_at: r.updated_at ?? null,
      })),
      who_must_act: dealerResponsibility({ profile: dealerProfile, blockingRequirements: requirements }),
    };
  }

  // ── Audit (decision facts only — no ip/user_agent, no reviewer user ids) ───────────────
  const authorityAudit = await client
    .from('trust_audit_events')
    .select('id, event_type, actor_role, reason, created_at, target_id')
    .eq('target_type', 'vehicle_seller_authority')
    .order('created_at', { ascending: false })
    .limit(AUDIT_EVENT_LIMIT);
  const audit = rows(authorityAudit)
    .filter((event) => String(event.target_id || '').endsWith(`:${id}`))
    .map((event) => ({
      id: event.id,
      event_type: event.event_type,
      actor_role: event.actor_role ?? null,
      reason: event.reason ?? null,
      created_at: event.created_at ?? null,
    }));

  return {
    person: {
      id: person.id,
      name: person.name ?? null,
      email: person.email ?? null,
      role: person.role ?? null,
      // The account-email flag — deliberately labelled for what it is, and NOT identity.
      email_verified: Boolean(person.is_verified),
      joined_at: person.join_date ?? person.created_at ?? null,
      tenant_memberships: rows(tenantRows).map((t) => ({ tenant_id: t.tenant_id, role: t.role })),
    },
    identity: {
      evaluated: sessions.length > 0,
      latest: latestSession,
      sessions,
      who_must_act: latestSession ? latestSession.who_must_act : 'none',
    },
    seller_authority: {
      total: authority.length,
      records: authority,
    },
    ownership: {
      vehicles_owned: rows(ownedRows).map((v) => ({
        vin: v.vin,
        publication_status: v.publication_status ?? null,
        label: [v.year, v.make, v.model].filter(Boolean).join(' ') || null,
      })),
      transfers,
    },
    dealer_compliance: dealer,
    audit,
    allowed_actions: allowedPeopleOperationsActions(userContext),
  };
}

export default { buildPersonComplianceReview };
