/**
 * Canonical public-safe Vehicle Lifecycle projection.
 *
 * This is deliberately separate from evidence_class. Evidence describes an artifact; lifecycle
 * describes what happened to the vehicle. The old legacy evidence mapping grouped insurance and
 * police-clearance documents under "accident", which can turn an administrative document into a
 * false damage claim. This projection never does that.
 */
export const VEHICLE_LIFECYCLE_PROJECTION_VERSION = 'vehicle-lifecycle-1.0.0';

export const LIFECYCLE_CATEGORIES = Object.freeze([
  'import',
  'auction',
  'accident',
  'repair',
  'service',
  'inspection',
  'ownership_transfer',
  'registration',
  'insurance',
  'clearance',
  'dealer_listing',
  'current_condition',
]);

const EVIDENCE_TYPE_TO_LIFECYCLE = Object.freeze({
  import_photo: 'import',
  customs_photo: 'import',
  auction_photo: 'auction',
  inspection_photo: 'inspection',
  odometer_photo: 'inspection',
  damage_photo: 'accident',
  repair_photo: 'repair',
  dealer_listing_photo: 'dealer_listing',
  owner_handover_photo: 'ownership_transfer',
  ownership_transfer_document: 'ownership_transfer',
  registration_document: 'registration',
  insurance_document: 'insurance',
  police_clearance_document: 'clearance',
});

const PUBLIC_SAFE_SUSPICION = new Set(['', 'none', 'cleared']);

const CATEGORY_SOURCES = Object.freeze({
  import: ['evidence'],
  auction: ['evidence'],
  accident: ['evidence'],
  repair: ['evidence', 'partsentry'],
  service: ['partsentry', 'mechanic_work_orders'],
  inspection: ['evidence', 'vid_inspections'],
  ownership_transfer: ['evidence', 'ownership_ledger'],
  registration: ['evidence'],
  insurance: ['evidence', 'insurance_registry'],
  clearance: ['evidence'],
  dealer_listing: ['evidence', 'listing_snapshots'],
  current_condition: ['evidence', 'current_listing'],
});

function readStateEnvelope(rows, state = 'available') {
  return { state, rows: Array.isArray(rows) ? rows : rows ? [rows] : [] };
}

function dateOf(row) {
  return row?.event_date || row?.captured_at || row?.uploaded_at || row?.timestamp
    || row?.transfer_date || row?.inspected_at || row?.start_date || row?.created_at || null;
}

function safeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCategory(value) {
  return LIFECYCLE_CATEGORIES.includes(value) ? value : null;
}

export function lifecycleCategoryForEvidence(row = {}) {
  // Administrative legacy evidence types have an explicit lifecycle meaning that overrides the old
  // evidence_class mapping. This is the truth fix for insurance/police documents previously treated
  // as accidents by a backward-compatibility taxonomy.
  const legacy = EVIDENCE_TYPE_TO_LIFECYCLE[row.evidence_type];
  if (legacy) return legacy;
  return normalizeCategory(row.evidence_class);
}

async function readRows(client, table, vin, columns = '*') {
  try {
    const { data, error } = await client.from(table).select(columns).eq('vin', vin);
    if (error) return readStateEnvelope([], 'unavailable');
    return readStateEnvelope(data, 'available');
  } catch {
    return readStateEnvelope([], 'unavailable');
  }
}

function categoryCountState(category, count, sourceStates) {
  const sources = CATEGORY_SOURCES[category] || [];
  const states = sources.map((source) => sourceStates[source] || 'unavailable');
  const available = states.filter((state) => state === 'available').length;
  const state = available === states.length
    ? 'complete'
    : available === 0
      ? 'unavailable'
      : 'partial';
  return { value: count, state };
}

function aggregateCoverageState(sourceNames, sourceStates) {
  const states = sourceNames.map((source) => sourceStates[source] || 'unavailable');
  const available = states.filter((state) => state === 'available').length;
  if (available === states.length) return 'complete';
  if (available === 0) return 'unavailable';
  return 'partial';
}

function event({
  id,
  category,
  date,
  label,
  sourceKind,
  sourceId = null,
  verificationStatus = null,
  mileage = null,
  mileageUnit = 'km',
  evidenceId = null,
  detailState = 'recorded',
}) {
  return {
    id,
    category,
    date,
    label,
    source_kind: sourceKind,
    source_id: sourceId,
    verification_status: verificationStatus,
    mileage: safeNumber(mileage),
    mileage_unit: mileageUnit || 'km',
    evidence_id: evidenceId,
    detail_state: detailState,
  };
}

function eventKey(item) {
  return [item.category, item.date || '', item.source_kind, item.source_id || item.evidence_id || item.id].join('|');
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((item) => {
    const key = eventKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build one lifecycle read-model for all public report surfaces.
 * No mutation occurs here and no score is calculated.
 */
export async function buildCanonicalVehicleLifecycle(client, vin, {
  audience = 'public',
  vehicle = null,
  listings = null,
} = {}) {
  const privileged = ['admin', 'government', 'reviewer'].includes(audience);

  const [
    evidenceRead,
    ownershipRead,
    partRead,
    workOrderRead,
    insuranceRead,
    inspectionRead,
    listingRead,
  ] = await Promise.all([
    readRows(client, 'vehicle_evidence', vin),
    readRows(client, 'vehicle_ownership_history', vin, 'id, transfer_date'),
    readRows(client, 'partsentry_logs', vin, 'id, timestamp, action_type, mileage, public_card_eligible, suspicion_status, verification_status, part_verification_status'),
    readRows(client, 'mechanic_work_orders', vin, 'id, created_at, status'),
    readRows(client, 'insurance_records', vin, 'id, policy_number, start_date, active'),
    readRows(client, 'vid_inspections', vin, 'id, inspected_at, inspection_status, odometer_reading'),
    listings !== null && listings !== undefined
      ? Promise.resolve(readStateEnvelope(listings, 'available'))
      : readRows(client, 'listing_snapshots', vin),
  ]);

  const evidenceRows = evidenceRead.rows;
  const ownershipRows = ownershipRead.rows;
  const partRows = partRead.rows;
  const workOrderRows = workOrderRead.rows;
  const insuranceRows = insuranceRead.rows;
  const inspectionRows = inspectionRead.rows;
  const listingRows = listingRead.rows;

  const sourceStates = {
    evidence: evidenceRead.state,
    ownership_ledger: ownershipRead.state,
    partsentry: partRead.state,
    mechanic_work_orders: workOrderRead.state,
    insurance_registry: insuranceRead.state,
    vid_inspections: inspectionRead.state,
    listing_snapshots: listingRead.state,
    // The caller already read the vehicle identity before invoking this projection. A missing
    // mileage value is a legitimate empty observation, not an unavailable source.
    current_listing: 'available',
  };

  const evidence = privileged
    ? evidenceRows
    : evidenceRows.filter((row) => row.verification_status === 'verified' && row.visibility_level === 'public_safe');

  const events = [];

  for (const row of evidence) {
    const category = lifecycleCategoryForEvidence(row);
    if (!category) continue;
    events.push(event({
      id: `evidence:${row.id}`,
      category,
      date: dateOf(row),
      label: row.evidence_subtype || row.evidence_type || category,
      sourceKind: 'evidence',
      sourceId: row.source_id || null,
      verificationStatus: row.verification_status || null,
      mileage: row.odometer_value,
      mileageUnit: row.odometer_unit || 'km',
      evidenceId: row.id,
    }));
  }

  for (const row of ownershipRows) {
    events.push(event({
      id: `ownership:${row.id}`,
      category: 'ownership_transfer',
      date: row.transfer_date || null,
      label: 'Ownership transfer',
      sourceKind: 'ownership_ledger',
      sourceId: row.id,
      verificationStatus: 'recorded',
    }));
  }

  for (const row of partRows) {
    // The existence/count of maintenance records is already a public Trust signal. Detailed
    // PartSentry cards remain separately governed by public_card_eligible; lifecycle therefore
    // publishes a generic event when detail is not public rather than leaking the part/supplier.
    const suspicion = String(row.suspicion_status ?? '').trim().toLowerCase();
    const detailPublic = row.public_card_eligible === true && PUBLIC_SAFE_SUSPICION.has(suspicion);
    const action = String(row.action_type || '').trim().toLowerCase();
    const isRepair = ['replaced', 'repaired', 'installed', 'overhauled'].includes(action);
    events.push(event({
      id: `partsentry:${row.id}`,
      category: isRepair ? 'repair' : 'service',
      date: row.timestamp || null,
      label: detailPublic && row.action_type ? `Maintenance — ${row.action_type}` : 'Maintenance record',
      sourceKind: 'partsentry',
      sourceId: row.id,
      verificationStatus: row.verification_status || row.part_verification_status || 'recorded',
      mileage: row.mileage,
      detailState: detailPublic ? 'public_detail' : 'summary_only',
    }));
  }

  for (const row of workOrderRows) {
    events.push(event({
      id: `workorder:${row.id}`,
      category: 'service',
      date: row.created_at || null,
      label: row.status ? `Service — ${row.status}` : 'Service record',
      sourceKind: 'mechanic_work_order',
      sourceId: row.id,
      verificationStatus: row.status || 'recorded',
    }));
  }

  for (const row of insuranceRows) {
    events.push(event({
      id: `insurance:${row.id || row.policy_number}`,
      category: 'insurance',
      date: row.start_date || null,
      label: row.active === true ? 'Insurance policy recorded — active' : 'Insurance policy recorded',
      sourceKind: 'insurance_registry',
      sourceId: row.id || row.policy_number || null,
      verificationStatus: row.active === true ? 'active' : 'recorded',
    }));
  }

  for (const row of inspectionRows) {
    events.push(event({
      id: `vid:${row.id}`,
      category: 'inspection',
      date: row.inspected_at || null,
      label: row.inspection_status ? `VID inspection — ${row.inspection_status}` : 'VID inspection',
      sourceKind: 'vid_registry',
      sourceId: row.id,
      verificationStatus: row.inspection_status || 'recorded',
      mileage: row.odometer_reading,
    }));
  }

  const normalizedListings = listingRows;
  for (const row of normalizedListings) {
    const mileage = safeNumber(row.advertised_mileage);
    if (mileage === null) continue;
    events.push(event({
      id: `listing:${row.id || row.version || row.captured_at || mileage}`,
      category: 'dealer_listing',
      date: row.captured_at || null,
      label: 'Listing mileage observation',
      sourceKind: 'listing_snapshot',
      sourceId: row.id || null,
      verificationStatus: 'seller_stated',
      mileage,
      mileageUnit: row.mileage_unit || 'km',
    }));
  }

  // Current listing odometer is a stated marketplace fact, not historical proof. It is included as
  // the latest observation with its own source kind so the UI can distinguish "current reading" from
  // a historical checkpoint.
  const currentMileage = safeNumber(vehicle?.mileage);
  if (currentMileage !== null) {
    events.push(event({
      id: `current-listing:${vin}`,
      category: 'current_condition',
      date: vehicle?.updated_at || vehicle?.created_at || null,
      label: 'Current listing mileage',
      sourceKind: 'current_listing',
      sourceId: vin,
      verificationStatus: 'seller_stated',
      mileage: currentMileage,
      mileageUnit: 'km',
    }));
  }

  const timeline = dedupeEvents(events)
    .filter((item) => item.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const counts = Object.fromEntries(LIFECYCLE_CATEGORIES.map((category) => [category, 0]));
  for (const item of timeline) counts[item.category] = (counts[item.category] || 0) + 1;

  const countStates = Object.fromEntries(
    LIFECYCLE_CATEGORIES.map((category) => [
      category,
      categoryCountState(category, counts[category] || 0, sourceStates),
    ]),
  );

  const mileageObservations = timeline
    .filter((item) => item.mileage !== null)
    .map((item) => ({
      date: item.date,
      value: item.mileage,
      unit: item.mileage_unit,
      source: item.source_kind,
      lifecycle_event_id: item.id,
      evidence_id: item.evidence_id,
    }));

  let mileageAnomaly = false;
  let previous = null;
  for (const observation of mileageObservations) {
    if (previous && observation.value < previous.value) mileageAnomaly = true;
    previous = observation;
  }

  const sourceDiversity = new Set(
    timeline.map((item) => item.source_kind).filter(Boolean),
  ).size;

  return {
    schema: 'vehicle_lifecycle_projection.v1',
    projection_version: VEHICLE_LIFECYCLE_PROJECTION_VERSION,
    vin,
    audience,
    events: timeline,
    counts,
    mileage: {
      observations: mileageObservations,
      anomaly: mileageAnomaly,
      coverage_state: aggregateCoverageState(
        ['evidence', 'partsentry', 'vid_inspections', 'listing_snapshots', 'current_listing'],
        sourceStates,
      ),
    },
    count_states: countStates,
    source_states: sourceStates,
    source_diversity: sourceDiversity,
  };
}

export default {
  VEHICLE_LIFECYCLE_PROJECTION_VERSION,
  LIFECYCLE_CATEGORIES,
  lifecycleCategoryForEvidence,
  buildCanonicalVehicleLifecycle,
};
