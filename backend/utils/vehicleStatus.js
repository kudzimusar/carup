const PUBLIC_VEHICLE_STATUSES = ['Available', 'Reserved', 'available', 'reserved', 'ACTIVE', 'RESERVED'];
const QUARANTINED_VEHICLE_STATUSES = ['Suspended', 'Flagged', 'Banned'];
const MARKETPLACE_RESTORED_STATUSES = ['Available', 'Reserved'];

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
  return QUARANTINED_VEHICLE_STATUSES.includes(normalizeVehicleStatus(status));
}

export function isVehicleRestoredToMarketplaceStatus(status) {
  return MARKETPLACE_RESTORED_STATUSES.includes(normalizeVehicleStatus(status));
}
