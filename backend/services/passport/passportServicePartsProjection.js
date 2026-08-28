import {
  PASSPORT_AUDIENCES,
  assertPassportAudience,
} from './passportContract.js';

const SAFE_PARTSENTRY_SUSPICION = new Set(['', 'none', 'cleared']);
const SERVICE_AUTHORITIES = new Set([
  'professional_governed',
  'owner_declared',
  'partner_record',
  'unknown',
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

export function buildPassportServicePartsSection({
  workOrders = [],
  parts = [],
  ownerRecords = [],
  audience = PASSPORT_AUDIENCES.PUBLIC,
  coverageState = 'unknown',
  limitations = [],
} = {}) {
  assertPassportAudience(audience);

  const serviceRecords = [
    ...(workOrders || []).map((row) => projectWorkOrderServiceRecord(row, { audience })),
    ...(ownerRecords || []).map((row) => projectOwnerServiceRecord(row, { audience })).filter(Boolean),
  ];

  const partRecords = (parts || [])
    .map((row) => projectPartSentryRecord(row, { audience }))
    .filter(Boolean);

  const all = [...serviceRecords, ...partRecords]
    .sort((a, b) => {
      const at = Date.parse(a.occurred_at || 0) || 0;
      const bt = Date.parse(b.occurred_at || 0) || 0;
      return bt - at;
    });

  return {
    state: all.length > 0 ? 'known' : coverageState,
    coverage_state: coverageState,
    limitations: Array.isArray(limitations) ? [...limitations] : [],
    service_records: serviceRecords,
    part_records: partRecords,
  };
}

export default {
  projectWorkOrderServiceRecord,
  canProjectPartSentryPublicly,
  projectPartSentryRecord,
  projectOwnerServiceRecord,
  buildPassportServicePartsSection,
};
