#!/usr/bin/env node
/**
 * Marketplace reference media v1 — staging-only importer.
 *
 * PURPOSE
 * -------
 * Copy the reviewed 45-image synthetic demo manifest into CarUp-controlled public storage and
 * converge listing_images for exactly nine seeded staging VINs to exactly five rows each.
 *
 * HARD BOUNDARIES
 * ---------------
 * - staging Supabase identity is required by the same guard used by Issue #164 Golden Vehicles;
 * - only VINs declared in backend/fixtures/marketplace-reference-media-v1.json may be touched;
 * - source assets must come from the pinned Higgsfield CloudFront host and carry the generation id;
 * - uploads land only under vehicle-images/marketplace-reference-synthetic/v1/...;
 * - the script NEVER reads/writes vehicle_evidence, trust cache/decisions, ownership, users, prices,
 *   publication state, or any provider/payment table;
 * - all five target assets are uploaded before any legacy listing-image row is removed;
 * - --mode=verify is read-only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateStagingGuard } from './issue164-golden-vehicles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, '../fixtures/marketplace-reference-media-v1.json');
const RECEIPT_FILE = 'marketplace-reference-media-v1-receipt.json';
const SOURCE_HOST = 'd8j0ntlcm91z4.cloudfront.net';
const EXPECTED_PROGRAMME = 'CARUP_MARKETPLACE_REFERENCE_MEDIA_V1';
const EXPECTED_PREFIX = 'marketplace-reference-synthetic/v1';
const EXPECTED_VEHICLES = 9;
const EXPECTED_MEDIA_PER_VEHICLE = 5;
const MAX_ASSET_BYTES = 15 * 1024 * 1024;

const MODE = (process.argv.find((arg) => arg.startsWith('--mode=')) || '--mode=verify').split('=')[1];
if (!['verify', 'apply'].includes(MODE)) {
  console.error('BLOCKED: --mode must be verify or apply');
  process.exit(2);
}

const blocked = (message) => {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
};
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

function loadManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.programme !== EXPECTED_PROGRAMME) blocked('unexpected manifest programme');
  if (manifest.environment !== 'staging-only') blocked('manifest is not staging-only');
  if (manifest.provenance?.synthetic_demo !== true) blocked('manifest must declare synthetic_demo=true');
  if (manifest.provenance?.evidence_eligible !== false) blocked('synthetic media must be evidence_eligible=false');
  if (manifest.provenance?.trust_input !== false) blocked('synthetic media must be trust_input=false');
  if (manifest.storage?.bucket !== 'vehicle-images' || manifest.storage?.prefix !== EXPECTED_PREFIX) {
    blocked('manifest storage boundary is not the approved vehicle-images synthetic prefix');
  }
  if (!Array.isArray(manifest.vehicles) || manifest.vehicles.length !== EXPECTED_VEHICLES) {
    blocked(`manifest must contain exactly ${EXPECTED_VEHICLES} vehicles`);
  }

  const vins = new Set();
  const generationIds = new Set();
  for (const vehicle of manifest.vehicles) {
    const vin = String(vehicle.vin || '').toUpperCase();
    if (!/^[A-Z0-9]{17}$/.test(vin)) blocked(`invalid VIN in manifest: ${vehicle.vin}`);
    if (vins.has(vin)) blocked(`duplicate VIN in manifest: ${vin}`);
    vins.add(vin);
    if (vehicle.synthetic_demo !== true) blocked(`${vin} is not marked synthetic_demo`);
    if (!Array.isArray(vehicle.media) || vehicle.media.length !== EXPECTED_MEDIA_PER_VEHICLE) {
      blocked(`${vin} must carry exactly ${EXPECTED_MEDIA_PER_VEHICLE} media entries`);
    }

    vehicle.media.forEach((asset, index) => {
      if (asset.display_order !== index) blocked(`${vin} media display_order must be dense 0..4`);
      if (asset.is_primary !== false) blocked(`${vin} synthetic media may not invent seller primacy`);
      if (!/^[0-9a-f-]{36}$/i.test(asset.generation_id || '')) blocked(`${vin} carries an invalid generation id`);
      if (generationIds.has(asset.generation_id)) blocked(`generation id reused: ${asset.generation_id}`);
      generationIds.add(asset.generation_id);
      let parsed;
      try { parsed = new URL(asset.source_url); } catch { blocked(`${vin} carries an invalid source URL`); }
      if (parsed.protocol !== 'https:' || parsed.hostname !== SOURCE_HOST) blocked(`${vin} source host is not approved`);
      if (!parsed.pathname.includes(asset.generation_id)) blocked(`${vin} source URL does not bind its generation id`);
    });
  }
  return manifest;
}

function storagePath(vin, asset) {
  const safeFacet = String(asset.facet || 'view').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `${EXPECTED_PREFIX}/${vin}/${String(asset.display_order).padStart(2, '0')}-${safeFacet}-${asset.generation_id}.png`;
}

async function downloadAsset(asset) {
  const response = await fetch(asset.source_url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`source download failed (${response.status})`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/png') throw new Error(`unexpected source content type: ${type || 'missing'}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 8 || bytes.length > MAX_ASSET_BYTES) throw new Error(`source byte size out of bounds: ${bytes.length}`);
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    throw new Error('source bytes do not carry PNG magic');
  }
  return bytes;
}

async function expectedTargets(client, manifest, { upload = false } = {}) {
  const uploadToStorage = upload
    ? (await import('../services/storage/storageService.js')).uploadToStorage
    : null;
  const targets = new Map();

  for (const vehicle of manifest.vehicles) {
    const vin = String(vehicle.vin).toUpperCase();
    const urls = [];
    for (const asset of vehicle.media) {
      const path = storagePath(vin, asset);
      let publicUrl;
      if (upload) {
        const bytes = await downloadAsset(asset);
        publicUrl = await uploadToStorage('vehicle-images', path, bytes, 'image/png');
      } else {
        publicUrl = client.storage.from('vehicle-images').getPublicUrl(path).data.publicUrl;
      }
      if (!publicUrl || !String(publicUrl).includes('/marketplace-reference-synthetic/')) {
        throw new Error(`${vin} resolved outside the approved synthetic media path`);
      }
      urls.push({ url: publicUrl, display_order: asset.display_order });
    }
    targets.set(vin, urls);
  }
  return targets;
}

async function readVehicle(client, vehicle) {
  const { data, error } = await client
    .from('vehicles')
    .select('vin, make, model, year, publication_status')
    .eq('vin', vehicle.vin)
    .maybeSingle();
  if (error) throw new Error(`${vehicle.vin} vehicle lookup failed: ${error.message}`);
  if (!data) throw new Error(`${vehicle.vin} does not exist in staging`);
  if (String(data.make || '').toLowerCase() !== String(vehicle.make || '').toLowerCase()
      || String(data.model || '').toLowerCase() !== String(vehicle.model || '').toLowerCase()
      || Number(data.year) !== Number(vehicle.year)) {
    throw new Error(`${vehicle.vin} identity does not match the reviewed synthetic manifest`);
  }
  if (data.publication_status !== 'published') {
    throw new Error(`${vehicle.vin} is not a published seeded reference listing`);
  }
  return data;
}

async function readListingRows(client, vin) {
  const { data, error } = await client
    .from('listing_images')
    .select('id, vin, image_url, is_primary, display_order')
    .eq('vin', vin)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`${vin} listing_images read failed: ${error.message}`);
  return data || [];
}

async function convergeVehicle(client, vehicle, targetRows) {
  const vin = String(vehicle.vin).toUpperCase();
  await readVehicle(client, vehicle);
  const before = await readListingRows(client, vin);
  const targetUrls = new Set(targetRows.map((row) => row.url));

  // Add/repair every target first. Legacy rows remain visible until the complete target set exists.
  for (const target of targetRows) {
    const found = before.find((row) => row.image_url === target.url);
    if (found) {
      const { error } = await client
        .from('listing_images')
        .update({ display_order: target.display_order, is_primary: false })
        .eq('id', found.id)
        .eq('vin', vin);
      if (error) throw new Error(`${vin} target update failed: ${error.message}`);
    } else {
      const { error } = await client.from('listing_images').insert({
        vin,
        image_url: target.url,
        display_order: target.display_order,
        is_primary: false,
      });
      if (error) throw new Error(`${vin} target insert failed: ${error.message}`);
    }
  }

  const withTargets = await readListingRows(client, vin);
  const presentTargetUrls = new Set(withTargets.filter((row) => targetUrls.has(row.image_url)).map((row) => row.image_url));
  if (presentTargetUrls.size !== EXPECTED_MEDIA_PER_VEHICLE) {
    throw new Error(`${vin} refused legacy cleanup because the five target assets are not all present`);
  }

  // Only after the complete new gallery exists, remove rows outside the reviewed target set.
  for (const row of withTargets) {
    if (targetUrls.has(row.image_url)) continue;
    const { error } = await client.from('listing_images').delete().eq('id', row.id).eq('vin', vin);
    if (error) throw new Error(`${vin} legacy listing-image cleanup failed: ${error.message}`);
  }

  const after = await readListingRows(client, vin);
  return { before_count: before.length, after_count: after.length };
}

async function verifyVehicle(client, vehicle, targetRows) {
  const vin = String(vehicle.vin).toUpperCase();
  await readVehicle(client, vehicle);
  const rows = await readListingRows(client, vin);
  const expected = targetRows.map((row) => row.url);
  const actual = rows.map((row) => row.image_url);
  const exact = rows.length === EXPECTED_MEDIA_PER_VEHICLE
    && expected.every((url) => actual.includes(url))
    && rows.every((row) => String(row.image_url).includes('/marketplace-reference-synthetic/'))
    && rows.every((row) => row.is_primary !== true);
  return { vin, ok: exact, row_count: rows.length };
}

async function main() {
  const guard = evaluateStagingGuard(process.env);
  if (!guard.ok) blocked(guard.reason);

  const manifest = loadManifest();
  const { supabase } = await import('../db/supabase.js');

  const { error: readError } = await supabase.from('vehicles').select('vin', { head: true, count: 'exact' });
  if (readError) blocked(`staging read check failed: ${readError.message}`);

  // Apply mode uploads all forty-five files before any listing_images mutation.
  const targets = await expectedTargets(supabase, manifest, { upload: MODE === 'apply' });

  const receipt = {
    programme: EXPECTED_PROGRAMME,
    mode: MODE,
    staging_host: guard.host,
    synthetic_demo: true,
    evidence_rows_touched: 0,
    trust_rows_touched: 0,
    vehicles: [],
  };

  if (MODE === 'apply') {
    for (const vehicle of manifest.vehicles) {
      const result = await convergeVehicle(supabase, vehicle, targets.get(vehicle.vin));
      receipt.vehicles.push({ vin: vehicle.vin, ...result });
    }
  }

  const verification = [];
  for (const vehicle of manifest.vehicles) {
    verification.push(await verifyVehicle(supabase, vehicle, targets.get(vehicle.vin)));
  }
  receipt.verification = verification;
  receipt.ok = verification.every((item) => item.ok);

  writeFileSync(RECEIPT_FILE, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.ok) fail('reference-media verification failed');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
