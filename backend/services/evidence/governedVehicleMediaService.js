/**
 * T11-CAP-LR01-R2 step F — read a vehicle's GOVERNED MEDIA for the people entitled to it.
 *
 * What is read: `vehicle_media_references` (a vehicle's presentation of existing evidence images: order, primacy, caption) and
 * the `vehicle_evidence` rows they point at. What is produced: the third, key-disjoint media block described in
 * utils/governedVehicleMedia.js, with a short-lived view per photograph. What is NOT done, ever: no image is copied, no
 * `listing_images` row is written, no image is made public, and nothing about where the bytes live leaves this module.
 *
 * ONE CODE PATH. A garage list asks for the hero of each of a user's vehicles; the passport and the customer's journey ask for the
 * whole gallery of one. Both go through `readGovernedMediaForVehicles`, so there is not a second, subtly different rule for "who may
 * see this" or "which photographs count".
 *
 * AUTHORISED OR ABSENT. A vehicle the actor may not view is not in the result at all — not as an empty block, not as "withheld".
 * Callers omit the key, so a response is the same whether or not the vehicle has governed media.
 *
 * FAILS CLOSED AND SILENT. A failed read is `not_loaded`, never "none". A gallery whose views cannot be produced is `not_loaded`,
 * never an empty gallery. A signing failure counts the photograph as unavailable; it never publishes a broken slot.
 */
import {
  canViewGovernedMedia,
  selectPresentableMedia,
  toGovernedMediaBlock,
  windowPresentable,
} from '../../utils/governedVehicleMedia.js';
import { isPublishableMediaUrl } from '../../utils/vehicleMediaProjection.js';

/** How long a view lasts. The page loads the gallery once; an hour matches the evidence route and is short enough to be a capability, not a credential. */
export const GOVERNED_MEDIA_VIEW_TTL_SECONDS = 3600;
const PUBLIC_IMAGE_BUCKET = 'vehicle-images';
const ID_CHUNK = 50;

const REFERENCE_COLUMNS = 'id, vin, evidence_id, gallery_position, is_primary, primary_basis, label, deleted_at';
const EVIDENCE_COLUMNS = 'id, vin, storage_bucket, file_path, file_url, mime_type, verification_status';

/** The roles the passport already admits to a vehicle's private evidence, besides its owner. */
export const GOVERNED_MEDIA_PRIVILEGED_ROLES = Object.freeze(['admin', 'government']);

/** A signer over Supabase storage: many private objects, one request per bucket. A failure signs nothing; the caller counts those unavailable. */
export function createStorageSigner(supabaseClient) {
  return {
    async signMany(bucket, paths, ttlSeconds) {
      const out = new Map();
      if (!paths.length) return out;
      const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrls(paths, ttlSeconds);
      if (error || !Array.isArray(data)) return out;
      for (const row of data) if (row && row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
      return out;
    },
  };
}

/** The actor as the media rules need it, from the context `optionalAuth()` / `authorizeRole()` publish. */
export function actorForGovernedMedia(userContext) {
  return {
    id: userContext?.id ?? null,
    role: userContext?.role ?? null,
    identityAsserted: userContext?.identityAsserted === true,
  };
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

async function readRows(client, vins) {
  const refs = [];
  for (const part of chunk(vins, ID_CHUNK)) {
    const { data, error } = await client.from('vehicle_media_references').select(REFERENCE_COLUMNS).in('vin', part).is('deleted_at', null).order('gallery_position', { ascending: true });
    if (error) return null;
    refs.push(...(data || []));
  }
  const evidence = [];
  const ids = [...new Set(refs.map((r) => r.evidence_id).filter(Boolean))];
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await client.from('vehicle_evidence').select(EVIDENCE_COLUMNS).in('id', part);
    if (error) return null;
    evidence.push(...(data || []));
  }
  return { refs, evidence };
}

/**
 * @param {object} input
 * @param {object} input.client                       a Supabase-shaped client (service role)
 * @param {Array<{vin:string, owner_id?:string|null}>} input.vehicles
 * @param {{id?:string|null, role?:string|null, identityAsserted?:boolean}} input.actor
 * @param {boolean} [input.isPrivileged]              overrides the role check (the Journey has its own platform-role helpers)
 * @param {{signMany:Function}} input.signer
 * @param {number|null} [input.limit]                 a window onto each gallery (1 = the hero)
 * @returns {Promise<Map<string, object>>}            vin -> block, ONLY for the vehicles the actor may view
 */
export async function readGovernedMediaForVehicles({
  client, vehicles, actor, isPrivileged, signer, limit = null, ttlSeconds = GOVERNED_MEDIA_VIEW_TTL_SECONDS, now = new Date(),
}) {
  const result = new Map();
  const privileged = typeof isPrivileged === 'boolean' ? isPrivileged : GOVERNED_MEDIA_PRIVILEGED_ROLES.includes(actor?.role);
  const allowed = (vehicles || []).filter((v) => v?.vin && canViewGovernedMedia({
    actorId: actor?.id, ownerId: v.owner_id, isPrivileged: privileged, identityAsserted: actor?.identityAsserted === true,
  }));
  if (!allowed.length) return result;
  const vins = [...new Set(allowed.map((v) => v.vin))];

  let rows = null;
  try { rows = await readRows(client, vins); } catch { rows = null; }
  if (!rows) {
    for (const vin of vins) result.set(vin, toGovernedMediaBlock({ authorized: true, vin, references: null, evidenceRows: null }));
    return result;
  }

  // Decide which photographs need a view (only the window the caller asked for), then produce them in as few requests as possible.
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const views = new Map();
  const toSign = new Map();   // bucket -> [{ evidenceId, path }]
  const perVin = new Map();
  for (const vin of vins) {
    const references = rows.refs.filter((r) => r.vin === vin);
    const evidenceRows = rows.evidence.filter((e) => e.vin === vin && references.some((r) => r.evidence_id === e.id));
    perVin.set(vin, { references, evidenceRows });
    for (const { asset } of windowPresentable(selectPresentableMedia({ vin, references, evidenceRows }), limit)) {
      if (asset.storage_bucket === PUBLIC_IMAGE_BUCKET && /^https:\/\//i.test(asset.file_url || '') && isPublishableMediaUrl(asset.file_url)) {
        views.set(asset.id, { href: asset.file_url, expires_at: null });
      } else if (asset.storage_bucket && asset.file_path) {
        if (!toSign.has(asset.storage_bucket)) toSign.set(asset.storage_bucket, []);
        toSign.get(asset.storage_bucket).push({ evidenceId: asset.id, path: asset.file_path });
      }
    }
  }
  for (const [bucket, targets] of toSign) {
    let signed = new Map();
    try { signed = await signer.signMany(bucket, targets.map((t) => t.path), ttlSeconds); } catch { signed = new Map(); }
    for (const { evidenceId, path } of targets) {
      const href = signed.get(path);
      if (href) views.set(evidenceId, { href, expires_at: expiresAt });
    }
  }

  for (const vin of vins) {
    const { references, evidenceRows } = perVin.get(vin);
    result.set(vin, toGovernedMediaBlock({ authorized: true, vin, references, evidenceRows, views, limit }));
  }
  return result;
}

/** One vehicle's governed media, or `null` when the actor may not view it (the caller omits the key). */
export async function readGovernedMedia({ client, vehicle, actor, isPrivileged, signer, limit = null, ttlSeconds, now }) {
  const map = await readGovernedMediaForVehicles({ client, vehicles: [vehicle], actor, isPrivileged, signer, limit, ttlSeconds, now });
  return map.get(vehicle?.vin) ?? null;
}
