import {
  PASSPORT_AUDIENCES,
  assertPassportAudience,
} from './passportContract.js';

const SAFE_PARTSENTRY_SUSPICION = new Set(['', 'none', 'cleared']);

/**
 * Provenance-strength vocabulary.
 *
 * Service Network (S5) records carry a superset of the original four values. It is EXTENDED here
 * rather than forked: Passport remains the single projection authority for service history, and a
 * second vocabulary would let the same fact carry two different provenance strengths depending on
 * which surface read it. Without these entries `normalizeAuthority` silently collapses a
 * governed 'evidence_backed' record to 'unknown', which understates real provenance — the mirror
 * of the fabrication problem, and just as wrong.
 *
 * Kept in lockstep with the CHECK constraint in
 * database/migrations/20260904160000_service_network_s5_service_records.sql.
 */
const SERVICE_AUTHORITIES = new Set([
  'professional_governed',
  'owner_declared',
  'partner_record',
  'unknown',
  // Service Network extensions:
  'garage_stated',
  'mechanic_attributed',
  'evidence_backed',
]);

/** Audiences permitted to see a garage's private free text. */
const PRIVATE_NOTE_AUDIENCES = new Set([
  PASSPORT_AUDIENCES.OWNER,
  PASSPORT_AUDIENCES.GOVERNANCE,
]);

function normalizeAuthority(value) {
  return SERVICE_AUTHORITIES.has(value) ? value : 'unknown';
}

function normalizeMileage(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function projectWorkOrderServiceRecord(row, {
  audience = PASSPORT_AUDIENCES.PUBLIC,
} = {}) {
  assertPassportAudience(audience);
  if (!row?.id) throw new Error('Passport service record requires work-order id');

  // Deliberately whitelist only governed/controlled fields. Work-order free text
  // and customer identity never enter this projection.
  const projected = {
    record_id: String(row.id),
    record_type: 'work_order',
    source_type: 'mechanic_work_order',
    source_ref: String(row.id),
    authority: normalizeAuthority(row.authority ?? 'professional_governed'),
    status: row.status ?? null,
    occurred_at: row.completed_at ?? row.updated_at ?? row.created_at ?? null,
    mileage: normalizeMileage(row.mileage),
    mileage_unit: row.mileage == null ? null : (row.mileage_unit ?? 'km'),
    total_cost: row.total_cost ?? null,
    currency: row.currency ?? null,
    garage_display_name: row.garage_display_name ?? null,
    evidence_ids: Array.isArray(row.evidence_ids) ? [...row.evidence_ids] : [],
  };

  if (audience === PASSPORT_AUDIENCES.PUBLIC || audience === PASSPORT_AUDIENCES.BUYER) {
    projected.total_cost = null;
    projected.currency = null;
  }

  return projected;
}

export function canProjectPartSentryPublicly(row) {
  const suspicion = String(row?.suspicion_status ?? '').trim().toLowerCase();
  return row?.public_card_eligible === true && SAFE_PARTSENTRY_SUSPICION.has(suspicion);
}

export function projectPartSentryRecord(row, {
  audience = PASSPORT_AUDIENCES.PUBLIC,
} = {}) {
  assertPassportAudience(audience);
  if (row?.id === null || row?.id === undefined) {
    throw new Error('Passport PartSentry record requires log id');
  }

  const publicLike = audience === PASSPORT_AUDIENCES.PUBLIC
    || audience === PASSPORT_AUDIENCES.BUYER;

  if (publicLike && !canProjectPartSentryPublicly(row)) return null;

  const projected = {
    record_id: String(row.id),
    record_type: 'partsentry',
    source_type: 'partsentry_log',
    source_ref: String(row.id),
    authority: normalizeAuthority(row.authority ?? 'professional_governed'),
    occurred_at: row.timestamp ?? row.created_at ?? null,
    part_name: row.part_name ?? null,
    part_oem: row.part_oem ?? null,
    action_type: row.action_type ?? null,
    mileage: normalizeMileage(row.mileage),
    mileage_unit: row.mileage == null ? null : (row.mileage_unit ?? 'km'),
    verification_status: row.verification_status ?? 'unverified',
    part_verification_status: row.part_verification_status ?? 'unverified',
    public_card_eligible: row.public_card_eligible === true,
    evidence_ids: Array.isArray(row.evidence_ids) ? [...row.evidence_ids] : [],
  };

  if (!publicLike) {
    projected.suspicion_status = row.suspicion_status ?? 'none';
  }

  return projected;
}

export function projectOwnerServiceRecord(row, {
  audience = PASSPORT_AUDIENCES.OWNER,
} = {}) {
  assertPassportAudience(audience);
  if (!row?.id) throw new Error('Passport owner service record requires id');

  if (![PASSPORT_AUDIENCES.OWNER, PASSPORT_AUDIENCES.SELLER, PASSPORT_AUDIENCES.GOVERNANCE].includes(audience)) {
    return null;
  }

  return {
    record_id: String(row.id),
    record_type: 'owner_service',
    source_type: 'owner_service_record',
    source_ref: String(row.id),
    authority: 'owner_declared',
    occurred_at: row.occurred_at ?? row.created_at ?? null,
    mileage: normalizeMileage(row.mileage),
    mileage_unit: row.mileage == null ? null : (row.mileage_unit ?? 'km'),
    summary: row.summary ?? null,
    evidence_ids: Array.isArray(row.evidence_ids) ? [...row.evidence_ids] : [],
    verification_status: row.verification_status ?? 'unverified',
  };
}

/**
 * Project one governed Service Network `service_records` row (S5).
 *
 * This is the Service Network's contribution to the ONE canonical Passport service history, not a
 * parallel one. Two fields are deliberately withheld:
 *
 *   - `work_performed` is a garage's private free text. The S5 schema states it is never projected
 *     to a public surface, so it reaches only the owner and governance audiences.
 *   - cost is withheld from public/buyer, exactly as it is for a work order.
 *
 * `garage_display_name` must be supplied by the caller from the governed publication projection.
 * A name is never invented here, and an unprofiled tenant stays null rather than becoming "Garage".
 */
export function projectServiceNetworkRecord(row, {
  audience = PASSPORT_AUDIENCES.PUBLIC,
} = {}) {
  assertPassportAudience(audience);
  if (!row?.id) throw new Error('Passport service network record requires id');

  const publicLike = audience === PASSPORT_AUDIENCES.PUBLIC || audience === PASSPORT_AUDIENCES.BUYER;

  const projected = {
    record_id: String(row.id),
    record_type: 'service_network',
    source_type: 'service_record',
    source_ref: String(row.id),
    // Provenance strength as recorded by S5. Never upgraded here.
    authority: normalizeAuthority(row.service_authority ?? row.authority ?? 'unknown'),
    // A controlled taxonomy value, unlike work_performed.
    service_category: row.service_category ?? null,
    occurred_at: row.performed_at ?? row.created_at ?? null,
    mileage: normalizeMileage(row.mileage),
    mileage_unit: row.mileage == null ? null : (row.mileage_unit ?? 'km'),
    // The S5 CHECK guarantees a cost always carries a currency, so an absent currency means an
    // absent cost — never a zero and never an assumed USD.
    total_cost: publicLike ? null : (row.total_cost ?? null),
    currency: publicLike ? null : (row.currency ?? null),
    garage_display_name: row.garage_display_name ?? null,
    evidence_ids: Array.isArray(row.evidence_ids) ? [...row.evidence_ids] : [],
  };

  if (PRIVATE_NOTE_AUDIENCES.has(audience)) {
    projected.work_performed = row.work_performed ?? null;
  }

  return projected;
}

export function buildPassportServicePartsSection({
  workOrders = [],
  parts = [],
  ownerRecords = [],
  serviceNetworkRecords = [],
  audience = PASSPORT_AUDIENCES.PUBLIC,
  coverageState = 'unknown',
  limitations = [],
} = {}) {
  assertPassportAudience(audience);

  const serviceRecords = [
    ...(workOrders || []).map((row) => projectWorkOrderServiceRecord(row, { audience })),
    ...(ownerRecords || []).map((row) => projectOwnerServiceRecord(row, { audience })).filter(Boolean),
    ...(serviceNetworkRecords || []).map((row) => projectServiceNetworkRecord(row, { audience })).filter(Boolean),
  ];

  const partRecords = (parts || [])
    .map((row) => projectPartSentryRecord(row, { audience }))
    .filter(Boolean);

  // Newest first. This ordering was previously computed into a local `all` and then discarded, so
  // the returned collections came back in source order — work orders, then owner records, then
  // (now) Service Network records. That is not one history; it is three lists concatenated, and a
  // reader would see an older entry above a newer one. The merged list is now returned too, so
  // there is one chronological story rather than a per-source ordering.
  const byRecency = (a, b) => (Date.parse(b.occurred_at || 0) || 0) - (Date.parse(a.occurred_at || 0) || 0);
  const sortedServiceRecords = [...serviceRecords].sort(byRecency);
  const sortedPartRecords = [...partRecords].sort(byRecency);
  const all = [...serviceRecords, ...partRecords].sort(byRecency);

  return {
    state: all.length > 0 ? 'known' : coverageState,
    coverage_state: coverageState,
    limitations: Array.isArray(limitations) ? [...limitations] : [],
    service_records: sortedServiceRecords,
    part_records: sortedPartRecords,
    /** Service and part records interleaved into a single chronological history. */
    records: all,
  };
}

export default {
  projectWorkOrderServiceRecord,
  canProjectPartSentryPublicly,
  projectPartSentryRecord,
  projectOwnerServiceRecord,
  projectServiceNetworkRecord,
  buildPassportServicePartsSection,
};
