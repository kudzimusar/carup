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
  'verified_parts',
  'verification_status',
  'part_verification_status',
  'suspicion_status'
]);

const GOVERNMENT_APPROVAL_FACTS = new Set(['plate_verified', 'zimra_verified', 'cid_clear']);
const PHASE_2A_FACTS = new Set(['vehicle_condition_category', 'passport_verified', 'inspection_ready']);
const PHASE_2A_GOVERNMENT_FACTS = new Set(['passport_verified', 'inspection_ready']);
const PARTSENTRY_PUBLIC_CARD_FACTS = new Set([
  'public_card_eligible',
  'partsentry_checked',
  'verified_parts',
  'verification_status',
  'part_verification_status',
  'suspicion_status',
]);
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
  const isPhase2A = PHASE_2A_FACTS.has(fact);

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

  if (PARTSENTRY_PUBLIC_CARD_FACTS.has(fact)) {
    if (actor.role === 'admin') {
      if (['approve', 'reject', 'revoke', 'verify'].includes(normalizedAction) && !context.reason) {
        return deny('Admin PartSentry review decisions require a reason');
      }
      return allow('Admin may submit and review PartSentry public-card facts in Phase 2B.1');
    }

    if (actor.role === 'mechanic') {
      if (normalizedAction === 'submit') {
        if (!context.ownRecord) {
          return deny('Mechanic can submit PartSentry review requests only for their own logs');
        }
        return allow('Mechanic may submit their own PartSentry log for admin review');
      }
      return deny('Mechanic cannot approve, reject, revoke, or verify PartSentry public-card facts');
    }

    if (actor.role === 'owner') {
      if (normalizedAction === 'submit') {
        if (!context.ownsVehicle) {
          return deny('Owner can submit PartSentry review requests only for owned vehicles');
        }
        return allow('Owner may submit scoped PartSentry logs for admin review');
      }
      return deny('Owner cannot approve, reject, revoke, or verify PartSentry public-card facts');
    }

    if (actor.role === 'dealer') {
      if (normalizedAction === 'submit') {
        if (!context.inTenantScope) {
          return deny('Dealer can submit PartSentry review requests only for tenant vehicles');
        }
        return allow('Dealer may submit scoped PartSentry logs for admin review');
      }
      return deny('Dealer cannot approve tenant PartSentry facts in Phase 2B.1');
    }

    if (actor.role === 'government') {
      return deny('Government cannot approve routine PartSentry public-card facts in Phase 2B.1');
    }
  }

  if (actor.role === 'admin') {
    if (['approve', 'reject', 'revoke'].includes(normalizedAction) && !context.reason) {
      return deny('Admin approvals, rejections, and revocations require a reason');
    }
    return allow('Admin may approve or revoke governed trust facts with audit reason');
  }

  if (actor.role === 'owner' && ['approve', 'reject', 'revoke', 'verify'].includes(normalizedAction)) {
    return deny('Owner cannot approve, revoke, or verify trust facts');
  }

  if (isPhase2A && actor.role === 'owner' && normalizedAction === 'submit') {
    if (!context.ownsVehicle) {
      return deny('Owner can request Phase 2A trust facts only for owned vehicles');
    }
    return allow('Owner may request Phase 2A trust facts for owned vehicles');
  }

  if (isPhase2A && actor.role === 'dealer' && normalizedAction === 'submit') {
    if (!context.inTenantScope) {
      return deny('Dealer can request Phase 2A trust facts only for tenant vehicles');
    }
    return allow('Dealer may request Phase 2A trust facts for tenant vehicles');
  }

  if (isPhase2A && actor.role === 'dealer' && ['approve', 'reject', 'revoke'].includes(normalizedAction)) {
    return deny('Dealer cannot approve, reject, or revoke Phase 2A trust facts');
  }

  if (isPhase2A && actor.role === 'government') {
    if (!PHASE_2A_GOVERNMENT_FACTS.has(fact)) {
      return deny('Government cannot review vehicle_condition_category in Phase 2A');
    }
    if (['submit', 'approve', 'reject', 'revoke'].includes(normalizedAction)) {
      return allow('Government may request or review Passport and inspection readiness facts');
    }
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
