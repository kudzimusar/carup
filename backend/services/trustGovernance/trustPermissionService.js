const SOURCE_TRUST_FACTS = new Set([
  'vehicle_condition_category',
  'passport_verified',
  'plate_verified',
  'zimra_verified',
  'cid_clear',
  'safe_pay_ready',
  'inspection_ready',
  'dealer_verified',
  'public_card_eligible',
  'partsentry_checked',
  'verified_parts'
]);

const GOVERNMENT_APPROVAL_FACTS = new Set(['plate_verified', 'zimra_verified', 'cid_clear']);
const FINANCE_FACTS = new Set(['safe_pay_ready']);
const SUMMARY_FACTS = new Set(['vehicle_listing_summaries_refresh', 'marketplace_tags']);

function normalizeActor(actor = {}) {
  return {
    id: actor.id || actor.userId || actor.actor_user_id || null,
    role: actor.effectiveRole || actor.role || actor.actor_role || null,
    tenantId: actor.tenantId || actor.actor_tenant_id || null
  };
}

function deny(reason) {
  return { allowed: false, reason };
}

function allow(reason = 'Allowed by trust governance policy') {
  return { allowed: true, reason };
}

export function canSetTrustFact(actorInput, fact, action, context = {}) {
  const actor = normalizeActor(actorInput);
  const normalizedAction = String(action || '').toLowerCase();

  if (!actor.role) {
    return deny('Missing actor role');
  }

  if (!fact) {
    return deny('Missing trust fact');
  }

  if (actor.role === 'system') {
    if (normalizedAction === 'refresh' && SUMMARY_FACTS.has(fact)) {
      return allow('System may refresh derived marketplace summaries');
    }
    return deny('System may not create source trust facts');
  }

  if (actor.role === 'admin') {
    if ((normalizedAction === 'approve' || normalizedAction === 'revoke') && !context.reason) {
      return deny('Admin approvals and revocations require a reason');
    }
    return allow('Admin may approve or revoke governed trust facts with audit reason');
  }

  if (actor.role === 'owner' && ['approve', 'revoke', 'verify'].includes(normalizedAction)) {
    return deny('Owner cannot approve, revoke, or verify trust facts');
  }

  if (actor.role === 'dealer' && fact === 'dealer_verified') {
    return deny('Dealer cannot self-certify dealer_verified');
  }

  if (actor.role === 'mechanic' && fact === 'verified_parts') {
    const submittedByActor = context.submittedBy && actor.id && context.submittedBy === actor.id;
    if (submittedByActor || context.ownRecord === true) {
      return deny('Mechanic cannot verify their own part records by default');
    }
  }

  if (actor.role === 'government' && normalizedAction === 'approve' && GOVERNMENT_APPROVAL_FACTS.has(fact)) {
    return allow('Government may approve registry-backed vehicle trust facts');
  }

  if ((actor.role === 'finance' || actor.role === 'bank') && fact && FINANCE_FACTS.has(fact)) {
    if (normalizedAction === 'set' || normalizedAction === 'approve') {
      return allow('Finance or bank actor may set SafePay readiness through a governed workflow');
    }
  }

  if (normalizedAction === 'submit' && SOURCE_TRUST_FACTS.has(fact)) {
    return allow('Actor may submit a trust fact request for review');
  }

  return deny(`Role '${actor.role}' is not allowed to ${action || 'set'} '${fact}'`);
}

export default {
  canSetTrustFact
};
