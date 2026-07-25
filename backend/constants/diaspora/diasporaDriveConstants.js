/**
 * Phase 7 — Drive integration constants.
 *
 * Drive is provider-abstracted and feature-flagged. Google is the first provider; OneDrive is
 * represented by the interface only. Tokens are NEVER stored in the DB or returned to the frontend —
 * only an opaque credential reference (a key into the project's secret store) is persisted.
 */
export const DRIVE_PROVIDERS = Object.freeze({ GOOGLE: 'google', ONEDRIVE: 'onedrive' });

// Minimal scope: per-file access only (drive.file), not full-drive.
export const DRIVE_SCOPES = Object.freeze(['https://www.googleapis.com/auth/drive.file']);

export const DRIVE_CONNECTION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
});

export const DRIVE_FILE_SYNC_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
});

// Linked-entity types a Drive file may reference.
export const DRIVE_LINKED_ENTITY_TYPES = Object.freeze([
  'buyer_order', 'import_order', 'stock_item', 'supply_document', 'trade_document', 'shipment', 'export',
]);

// Approved folder structure (created/located lazily on first upload).
export const DRIVE_FOLDER_STRUCTURE = Object.freeze({
  root: 'CarUp Trade',
  children: ['Buyer Orders', 'Seller Stock', 'Import Documents', 'Export Documents', 'Invoices', 'Bills of Lading', 'Compliance', 'Payment Proof', 'Completed Orders'],
});

// Short-lived OAuth state window (one-time, replay-protected).
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function isDriveEnabled() {
  return String(process.env.DIASPORA_DRIVE_ENABLED || '').toLowerCase() === 'true';
}

// Fail closed: production NEVER auto-selects the mock provider. The mock is only used in dev/test or
// when DIASPORA_DRIVE_MOCK is explicitly set outside production.
export function shouldUseMockProvider() {
  if (isProduction()) return false;
  if (String(process.env.DIASPORA_DRIVE_MOCK || '').toLowerCase() === 'true') return true;
  if (process.env.NODE_ENV === 'test') return true;
  return false;
}

// Reject an attempt to force the mock provider in production.
export function assertDriveProductionSafety() {
  if (isProduction() && String(process.env.DIASPORA_DRIVE_MOCK || '').toLowerCase() === 'true') {
    throw new Error('DIASPORA_DRIVE_MOCK must not be enabled in production');
  }
}

export function driveStateSecret() {
  const secret = process.env.DIASPORA_DRIVE_STATE_SECRET;
  if (secret) return secret;
  // No fixed production fallback secret — fail closed.
  if (isProduction()) {
    throw new Error('DIASPORA_DRIVE_STATE_SECRET is required in production');
  }
  return 'diaspora-drive-dev-state-secret';
}
