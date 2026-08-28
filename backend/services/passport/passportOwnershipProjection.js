import {
  PASSPORT_AUDIENCES,
  assertPassportAudience,
} from './passportContract.js';

const RELATIONSHIP_STATES = new Set([
  'current',
  'historical',
  'pending',
  'disputed',
  'revoked',
]);

function normalizeRelationship(row) {
  if (!row?.source_type || !row?.source_ref) {
    throw new Error('Passport ownership relationship requires source_type and source_ref');
  }

  const state = RELATIONSHIP_STATES.has(row.state) ? row.state : 'pending';

  return {
    relationship_id: row.relationship_id ?? row.id ?? null,
    state,
    started_at: row.started_at ?? null,
    ended_at: row.ended_at ?? null,
    source_type: row.source_type,
    source_ref: row.source_ref,
    authority: row.authority ?? null,
    verification_state: row.verification_state ?? 'unknown',
    owner_id: row.owner_id ?? null,
    owner_type: row.owner_type ?? null,
    display_label: row.display_label ?? null,
    transfer_ref: row.transfer_ref ?? null,
  };
}

function publicProjection(row) {
  return {
    relationship_id: row.relationship_id,
    state: row.state,
    started_at: row.started_at,
    ended_at: row.ended_at,
    source_type: row.source_type,
    source_ref: row.source_ref,
    authority: row.authority,
    verification_state: row.verification_state,
    owner_type: row.owner_type,
    display_label: row.display_label,
    transfer_ref: row.transfer_ref,
  };
}

export function projectOwnershipRelationship(row, {
  audience = PASSPORT_AUDIENCES.PUBLIC,
} = {}) {
  assertPassportAudience(audience);
  const normalized = normalizeRelationship(row);
  const projected = publicProjection(normalized);

  if (audience === PASSPORT_AUDIENCES.GOVERNANCE) {
    projected.owner_id = normalized.owner_id;
  }

  return projected;
}

export function buildOwnershipHistory(rows = [], {
  audience = PASSPORT_AUDIENCES.PUBLIC,
  coverageState = 'unknown',
  limitations = [],
} = {}) {
  assertPassportAudience(audience);

  const history = (rows || [])
    .map((row) => projectOwnershipRelationship(row, { audience }))
    .sort((a, b) => {
      const aTime = Date.parse(a.started_at || 0) || 0;
      const bTime = Date.parse(b.started_at || 0) || 0;
      return bTime - aTime;
    });

  const current = history.filter((row) => row.state === 'current');
  if (current.length > 1) {
    throw new Error('Passport ownership history cannot project multiple current owners');
  }

  return {
    state: history.length > 0 ? 'known' : coverageState,
    coverage_state: coverageState,
    limitations: Array.isArray(limitations) ? [...limitations] : [],
    current_relationship: current[0] ?? null,
    history,
  };
}

export default {
  projectOwnershipRelationship,
  buildOwnershipHistory,
};
