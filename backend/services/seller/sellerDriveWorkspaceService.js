import crypto from 'crypto';

import { getDriveProvider } from '../diaspora/drive/driveProvider.js';

export const SELLER_DRIVE_ROOT = 'CarUp Sellers';

export const SELLER_VEHICLE_FOLDER_LAYOUT = Object.freeze([
  ['original_master', '00 ORIGINAL MASTER - DO NOT EDIT'],
  ['identity_restricted', '01 Identity - Restricted'],
  ['purchase_payment_private', '02 Purchase & Payment - Private'],
  ['export_shipping', '03 Export & Shipping'],
  ['customs_transit', '04 Customs & Transit'],
  ['inspection_compliance', '05 Inspection & Compliance'],
  ['zimbabwe_registration', '06 Zimbabwe Registration & Licensing'],
  ['carup_evidence_upload', '07 CarUp Evidence Upload Set'],
  ['listing_media_originals', '08 Listing Media - Originals'],
  ['transaction_handover', '09 Transaction & Handover'],
]);

const DESTINATION_KEYS = new Set(SELLER_VEHICLE_FOLDER_LAYOUT.map(([key]) => key));

function cleanKey(value, label) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is required.`);
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
}

function workspaceFingerprint(userId, vehicleKey) {
  return crypto.createHash('sha256').update(`${userId}:${vehicleKey}`).digest('hex').slice(0, 16);
}

/**
 * Create/find the private Seller → Vehicle Drive hierarchy.
 *
 * Google Drive is an archival/operations mirror only. Nothing returned here is a public evidence
 * URL and the credential reference is intentionally absent from the result.
 */
export async function ensureSellerVehicleDriveWorkspace({
  credentialReference,
  userId,
  vehicleKey,
  sellerDisplayName = null,
  vehicleDisplayName = null,
  rootFolderId = null,
  driveProvider = null,
} = {}) {
  if (!credentialReference) throw new Error('Drive credential reference is required.');
  const stableUserKey = cleanKey(userId, 'Seller user id');
  const stableVehicleKey = cleanKey(vehicleKey, 'Vehicle key');
  const provider = driveProvider || await getDriveProvider('google');

  const root = await provider.ensureFolder(credentialReference, SELLER_DRIVE_ROOT, rootFolderId);
  const sellerLabel = sellerDisplayName
    ? `${String(sellerDisplayName).trim().slice(0, 80)} [${stableUserKey}]`
    : `seller-${stableUserKey}`;
  const seller = await provider.ensureFolder(credentialReference, sellerLabel, root.folderId);
  const vehicleLabel = vehicleDisplayName
    ? `${String(vehicleDisplayName).trim().slice(0, 100)} [${stableVehicleKey}]`
    : `vehicle-${stableVehicleKey}`;
  const vehicle = await provider.ensureFolder(credentialReference, vehicleLabel, seller.folderId);

  const folders = {};
  for (const [key, name] of SELLER_VEHICLE_FOLDER_LAYOUT) {
    const entry = await provider.ensureFolder(credentialReference, name, vehicle.folderId);
    folders[key] = {
      folder_id: entry.folderId,
      name,
      created: Boolean(entry.created),
    };
  }

  return {
    provider: provider.name,
    workspace_fingerprint: workspaceFingerprint(stableUserKey, stableVehicleKey),
    root_folder_id: root.folderId,
    seller_folder_id: seller.folderId,
    vehicle_folder_id: vehicle.folderId,
    folders,
  };
}

/**
 * Archive one file into a governed workspace destination.
 *
 * The provider may return an operational Drive URL, but this service deliberately strips it from its
 * result. CarUp Evidence Vault owns public/restricted presentation; callers persist opaque provider
 * IDs + checksums and connect them to canonical evidence records separately.
 */
export async function archiveSellerVehicleFile({
  credentialReference,
  workspace,
  destination,
  name,
  mimeType,
  content,
  userId,
  vehicleKey,
  documentRole,
  visibility,
  original = false,
  driveProvider = null,
} = {}) {
  if (!credentialReference) throw new Error('Drive credential reference is required.');
  if (!workspace?.folders) throw new Error('Seller Drive workspace is required.');
  if (!DESTINATION_KEYS.has(destination)) throw new Error(`Unknown Seller Drive destination '${destination}'.`);
  if (!name) throw new Error('File name is required.');
  if (original && destination !== 'original_master' && destination !== 'listing_media_originals') {
    throw new Error('Original files may only be archived in an original-designated folder.');
  }

  const provider = driveProvider || await getDriveProvider('google');
  const folder = workspace.folders[destination];
  if (!folder?.folder_id) throw new Error(`Seller Drive destination '${destination}' is unavailable.`);

  const upload = await provider.uploadFile(credentialReference, {
    name,
    mimeType,
    content,
    folderId: folder.folder_id,
    description: 'CarUp private Seller workspace artifact. CarUp Evidence Vault remains the presentation authority.',
    appProperties: {
      carup_user_id: cleanKey(userId, 'Seller user id'),
      carup_vehicle_key: cleanKey(vehicleKey, 'Vehicle key'),
      carup_document_role: String(documentRole || destination).slice(0, 100),
      carup_visibility: String(visibility || 'restricted').slice(0, 32),
      carup_original: original ? 'true' : 'false',
      carup_workspace_fingerprint: workspace.workspace_fingerprint,
    },
  });

  return {
    provider: provider.name,
    file_id: upload.fileId,
    name: upload.name || name,
    checksum_sha256: upload.checksum || null,
    bytes: upload.bytes ?? null,
    destination,
    original: Boolean(original),
  };
}

export default {
  SELLER_DRIVE_ROOT,
  SELLER_VEHICLE_FOLDER_LAYOUT,
  ensureSellerVehicleDriveWorkspace,
  archiveSellerVehicleFile,
};
