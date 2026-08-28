export const PASSPORT_ACTION_PRIORITIES = Object.freeze([
  'required',
  'recommended',
  'informational',
]);

export const PASSPORT_ACTION_ORIGINS = Object.freeze([
  'canonical_state',
  'governed_intelligence',
  'explicit_estimate',
]);

const PRIORITIES = new Set(PASSPORT_ACTION_PRIORITIES);
const ORIGINS = new Set(PASSPORT_ACTION_ORIGINS);

function normalizeBasis(basis) {
  if (!basis || typeof basis !== 'object') {
    throw new Error('Passport action requires a governed basis');
  }
  if (!ORIGINS.has(basis.origin)) {
    throw new Error(`Unsupported Passport action origin: ${basis.origin}`);
  }
  if (!basis.source_type) {
    throw new Error('Passport action basis requires source_type');
  }
  return {
    origin: basis.origin,
    source_type: basis.source_type,
    source_ref: basis.source_ref ?? null,
    state: basis.state ?? null,
    measured_at: basis.measured_at ?? null,
  };
}

export function normalizePassportAction(action) {
  if (!action?.id || !action?.label) {
    throw new Error('Passport action requires id and label');
  }
  if (!PRIORITIES.has(action.priority)) {
    throw new Error(`Unsupported Passport action priority: ${action.priority}`);
  }

  const basis = normalizeBasis(action.basis);
  const dueAt = action.due_at ?? null;
  const estimated = action.estimated === true;

  if (dueAt && !action.due_basis) {
    throw new Error('Passport due action requires due_basis');
  }
  if (estimated && basis.origin !== 'explicit_estimate') {
    throw new Error('Estimated Passport action must use explicit_estimate origin');
  }
  if (!estimated && basis.origin === 'explicit_estimate') {
    throw new Error('Explicit-estimate Passport action must be labelled estimated');
  }

  return {
    id: action.id,
    label: action.label,
    description: action.description ?? null,
    priority: action.priority,
    action_type: action.action_type ?? null,
    href: action.href ?? null,
    due_at: dueAt,
    due_basis: action.due_basis ?? null,
    estimated,
    advisory: basis.origin === 'governed_intelligence' || estimated,
    basis,
  };
}

function addAction(target, action) {
  target.push(normalizePassportAction(action));
}

export function buildPassportAttentionRail({
  ownershipClaim = null,
  discrepancies = [],
  evidence = null,
  transfer = null,
  dueItems = [],
  partsIssues = [],
  intelligence = null,
} = {}) {
  const actions = [];
  const abstentions = [];

  if (ownershipClaim?.state === 'not_claimed') {
    addAction(actions, {
      id: 'verify-ownership',
      label: 'Verify ownership',
      priority: 'required',
      action_type: 'ownership_claim',
      basis: {
        origin: 'canonical_state',
        source_type: 'passport_claim',
        source_ref: ownershipClaim.id ?? null,
        state: ownershipClaim.state,
      },
    });
  }

  if (['evidence_required', 'disputed'].includes(ownershipClaim?.state)) {
    addAction(actions, {
      id: 'resolve-ownership-claim',
      label: 'Resolve ownership verification',
      priority: 'required',
      action_type: 'ownership_claim',
      basis: {
        origin: 'canonical_state',
        source_type: 'passport_claim',
        source_ref: ownershipClaim.id ?? null,
        state: ownershipClaim.state,
      },
    });
  }

  for (const discrepancy of discrepancies || []) {
    if (!['pending_review', 'pending', 'disputed', 'inconclusive'].includes(discrepancy?.state)) continue;
    addAction(actions, {
      id: `resolve-discrepancy:${discrepancy.discrepancy_id}`,
      label: 'Resolve vehicle record discrepancy',
      priority: 'required',
      action_type: 'discrepancy',
      basis: {
        origin: 'canonical_state',
        source_type: 'governed_discrepancy',
        source_ref: discrepancy.discrepancy_id,
        state: discrepancy.state,
      },
    });
  }

  if (evidence && ['partial', 'unknown'].includes(evidence.state) && evidence.missing_actionable === true) {
    addAction(actions, {
      id: 'add-missing-evidence',
      label: 'Add missing vehicle evidence',
      priority: 'recommended',
      action_type: 'evidence',
      basis: {
        origin: 'canonical_state',
        source_type: 'passport_evidence_coverage',
        source_ref: evidence.source_ref ?? null,
        state: evidence.state,
      },
    });
  }

  if (transfer && ['awaiting_parties', 'evidence_required', 'under_review', 'disputed'].includes(transfer.state)) {
    addAction(actions, {
      id: 'ownership-transfer-action',
      label: 'Complete ownership transfer action',
      priority: 'required',
      action_type: 'ownership_transfer',
      basis: {
        origin: 'canonical_state',
        source_type: 'ownership_transfer',
        source_ref: transfer.id ?? null,
        state: transfer.state,
      },
    });
  }

  for (const item of dueItems || []) {
    if (!item?.id || !item?.label || !item?.due_at || !item?.source_type) continue;
    addAction(actions, {
      id: `due:${item.id}`,
      label: item.label,
      description: item.description ?? null,
      priority: item.priority ?? 'required',
      action_type: item.action_type ?? 'due_item',
      due_at: item.due_at,
      due_basis: item.due_basis ?? `${item.source_type}:${item.source_ref ?? item.id}`,
      estimated: item.estimated === true,
      basis: {
        origin: item.estimated === true ? 'explicit_estimate' : 'canonical_state',
        source_type: item.source_type,
        source_ref: item.source_ref ?? item.id,
        state: item.state ?? null,
        measured_at: item.measured_at ?? null,
      },
    });
  }

  for (const issue of partsIssues || []) {
    if (!['watch', 'flagged', 'disputed'].includes(String(issue?.state || '').toLowerCase())) continue;
    addAction(actions, {
      id: `parts-issue:${issue.id}`,
      label: 'Review PartSentry issue',
      priority: 'required',
      action_type: 'partsentry',
      basis: {
        origin: 'canonical_state',
        source_type: 'partsentry_log',
        source_ref: issue.id,
        state: issue.state,
      },
    });
  }

  if (intelligence?.availability === 'value') {
    for (const rec of intelligence.recommendations || []) {
      if (rec?.fired !== true || !rec?.rule || !rec?.action) continue;
      addAction(actions, {
        id: `intelligence:${rec.rule}`,
        label: rec.action,
        description: rec.explanation ?? null,
        priority: 'recommended',
        action_type: 'intelligence_recommendation',
        basis: {
          origin: 'governed_intelligence',
          source_type: 'intelligence_recommendation',
          source_ref: rec.evidence_fingerprint ?? rec.rule,
          state: rec.calculation_version ?? null,
        },
      });
    }
    abstentions.push(...(intelligence.abstentions || []));
  } else if (intelligence) {
    abstentions.push({
      rule: 'passport_intelligence',
      abstained: 'input_unavailable',
      note: intelligence.reason ?? 'Governed Intelligence is unavailable; no advice was inferred.',
    });
  }

  const order = { required: 0, recommended: 1, informational: 2 };
  actions.sort((a, b) => order[a.priority] - order[b.priority] || a.id.localeCompare(b.id));

  return {
    state: actions.length > 0 ? 'known' : 'none',
    actions,
    abstentions,
  };
}

export default {
  PASSPORT_ACTION_PRIORITIES,
  PASSPORT_ACTION_ORIGINS,
  normalizePassportAction,
  buildPassportAttentionRail,
};
