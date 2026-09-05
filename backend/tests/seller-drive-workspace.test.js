import test from 'node:test';
import assert from 'node:assert/strict';

import { MockDriveProvider } from '../services/diaspora/drive/driveProvider.js';
import {
  SELLER_VEHICLE_FOLDER_LAYOUT,
  ensureSellerVehicleDriveWorkspace,
  archiveSellerVehicleFile,
} from '../services/seller/sellerDriveWorkspaceService.js';

async function connectedMock() {
  const provider = new MockDriveProvider();
  const connection = await provider.exchangeAuthorizationCode('seller-drive-test');
  return { provider, credentialReference: connection.credentialReference };
}

test('Seller Drive workspace is idempotent and keyed to stable seller + vehicle identity', async () => {
  const { provider, credentialReference } = await connectedMock();
  const input = {
    credentialReference,
    userId: 'user-123',
    vehicleKey: 'GFC27-027051',
    sellerDisplayName: 'Seller',
    vehicleDisplayName: '2016 Nissan Serena',
    driveProvider: provider,
  };
  const first = await ensureSellerVehicleDriveWorkspace(input);
  const second = await ensureSellerVehicleDriveWorkspace(input);

  assert.equal(first.seller_folder_id, second.seller_folder_id);
  assert.equal(first.vehicle_folder_id, second.vehicle_folder_id);
  assert.equal(first.workspace_fingerprint, second.workspace_fingerprint);
  assert.equal(Object.keys(first.folders).length, SELLER_VEHICLE_FOLDER_LAYOUT.length);
  assert.ok(first.folders.zimbabwe_registration.folder_id);
  assert.ok(first.folders.carup_evidence_upload.folder_id);
  assert.equal('credentialReference' in first, false);
  assert.equal(JSON.stringify(first).includes(credentialReference), false);
});

test('archive helper keeps Drive operational URLs out of its result and records checksum', async () => {
  const { provider, credentialReference } = await connectedMock();
  const workspace = await ensureSellerVehicleDriveWorkspace({
    credentialReference,
    userId: 'user-123',
    vehicleKey: 'GFC27-027051',
    driveProvider: provider,
  });

  const archived = await archiveSellerVehicleFile({
    credentialReference,
    workspace,
    destination: 'carup_evidence_upload',
    name: 'bill-of-lading.pdf',
    mimeType: 'application/pdf',
    content: Buffer.from('test-document'),
    userId: 'user-123',
    vehicleKey: 'GFC27-027051',
    documentRole: 'bill_of_lading',
    visibility: 'restricted',
    driveProvider: provider,
  });

  assert.ok(archived.file_id);
  assert.equal(archived.checksum_sha256.length, 64);
  assert.equal('fileUrl' in archived, false);
  assert.equal('file_url' in archived, false);
  assert.equal(JSON.stringify(archived).includes(credentialReference), false);
});

test('original artifacts cannot be silently placed in a derived/private evidence folder', async () => {
  const { provider, credentialReference } = await connectedMock();
  const workspace = await ensureSellerVehicleDriveWorkspace({
    credentialReference,
    userId: 'user-123',
    vehicleKey: 'GFC27-027051',
    driveProvider: provider,
  });

  await assert.rejects(
    () => archiveSellerVehicleFile({
      credentialReference,
      workspace,
      destination: 'carup_evidence_upload',
      name: 'master.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('master'),
      userId: 'user-123',
      vehicleKey: 'GFC27-027051',
      original: true,
      driveProvider: provider,
    }),
    /original-designated folder/,
  );

  await assert.rejects(
    () => archiveSellerVehicleFile({
      credentialReference,
      workspace,
      destination: 'unknown',
      name: 'x.pdf',
      content: Buffer.from('x'),
      userId: 'user-123',
      vehicleKey: 'GFC27-027051',
      driveProvider: provider,
    }),
    /Unknown Seller Drive destination/,
  );
});
