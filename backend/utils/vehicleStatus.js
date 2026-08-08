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

/** Publication lifecycle states (20260624140000) that may appear in public marketplace reads. */
const PUBLICLY_VISIBLE_PUBLICATION_STATUSES = ['publishable', 'published'];

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

