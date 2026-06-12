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

