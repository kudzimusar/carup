const PUBLIC_VEHICLE_STATUSES = ['Available', 'Reserved', 'available', 'reserved', 'ACTIVE', 'RESERVED'];

const STATUS_ALIASES = new Map([
  ['available', 'Available'],
  ['active', 'Available'],
  ['approved', 'Available'],
  ['listed', 'Available'],
  ['reserved', 'Reserved'],
  ['sold', 'Sold'],
  ['archived', 'Archived'],
  ['pending', 'Pending'],
  ['banned', 'Banned'],
  ['flagged', 'Flagged'],
  ['suspended', 'Suspended'],
]);

export function normalizeVehicleStatus(status) {
  const raw = String(status || '').trim();
  if (!raw) return 'Available';
  return STATUS_ALIASES.get(raw.toLowerCase()) || raw;
}

export function publicVehicleStatusFilterValues() {
  return PUBLIC_VEHICLE_STATUSES;
}

export function isPublicVehicleStatus(status) {
  return PUBLIC_VEHICLE_STATUSES.includes(status) || ['Available', 'Reserved'].includes(normalizeVehicleStatus(status));
}

export function isVehicleQuarantinedStatus(status) {
  const norm = normalizeVehicleStatus(status);
  return norm === 'Suspended' || norm === 'Banned' || norm === 'Flagged';
}

export function isVehicleRestoredToMarketplaceStatus(status) {
  const norm = normalizeVehicleStatus(status);
  return norm === 'Available';
}

/** Publication lifecycle states (20260624140000) that may appear in public marketplace
 *  reads. Exactly one state is live: 'publishable' means the completeness gate passed
 *  but the seller has NOT pushed the listing live — unpublish returns there, and the
 *  seller UI labels it "Ready to publish". Making it visible would turn unpublish into
 *  a no-op. */
const PUBLICLY_VISIBLE_PUBLICATION_STATUSES = ['published'];

export function publiclyVisiblePublicationStatuses() {
  return [...PUBLICLY_VISIBLE_PUBLICATION_STATUSES];
}

/**
 * Whether a vehicle's publication_status permits public marketplace visibility.
 * A missing value (column not selected, or hermetic fixtures predating the
 * lifecycle) stays visible — the real read path always selects the column and
 * the DB guarantees NOT NULL DEFAULT 'draft', so enforcement is complete on
 * real data while legacy fixtures keep working.
 */
export function isPubliclyVisiblePublication(publicationStatus) {
  if (publicationStatus === undefined || publicationStatus === null) return true;
  return PUBLICLY_VISIBLE_PUBLICATION_STATUSES.includes(publicationStatus);
}

/** Columns safe to return from legacy public vehicle endpoints. Never include
 *  owner_id, tenant_id, plate_number, engine_number, chassis_number or
 *  temp_plate_id — the marketplace summary builder deliberately redacts them
 *  and raw select('*') on public routes was a confirmed leak. */
export const PUBLIC_VEHICLE_COLUMNS = [
  'vin', 'make', 'model', 'generation', 'trim', 'year', 'color', 'mileage',
  'fuel_type', 'drivetrain', 'transmission', 'import_source', 'duty_paid',
  'police_verified', 'status', 'trust_score', 'price', 'currency', 'created_at',
  'registration_country', 'current_seller_type', 'passport_verified',
  'vehicle_condition_category', 'publication_status',
].join(', ');

