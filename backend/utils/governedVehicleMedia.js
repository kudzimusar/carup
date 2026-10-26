/**
 * ===========================================================================================
 * GOVERNED VEHICLE MEDIA — the THIRD, key-disjoint media block (T11-CAP-LR01-R2, step F).
 *
 * The #164 media contract (vehicleMediaProjection.js, marked final) keeps two things apart on purpose:
 * LISTING MEDIA, a seller's unverified marketing photographs that are never signed and carry no
 * verification claim; and VERIFIED EVIDENCE, governed proof that may be published only once reviewed.
 * It also says, in so many words, that a listing photo can never be "promoted" into evidence by being
 * displayed, and an evidence artifact can never be "demoted" into a gallery by being an image.
 *
 * A vehicle's OWNER holds photographs that are neither: real images of their own vehicle, imported as
 * evidence, still awaiting review, private. The owner is entitled to see their own photographs — a
 * pending review decides what may be PUBLISHED or called VERIFIED, never whether the owner may look at
 * their own car. And an owner "may not know less true media than an anonymous buyer".
 *
 * So the contract is extended, not bent. This is a THIRD block:
 *
 *   {
 *     state:             'available' | 'none' | 'not_loaded',
 *     items:             [{ gallery_item_id, gallery_rank, designated_primary, designation_basis, caption, review_status, view }],
 *     total_count:       number,   // how many presentable photographs exist (items may be a window onto them)
 *     unavailable_count: number,   // presentable photographs whose view could not be produced right now
 *     empty_statement:   string|null,
 *   }
 *
 * WHAT MAKES IT SAFE, AND HOW EACH PROPERTY IS ENFORCED RATHER THAN HOPED FOR
 *
 *   1. KEY-DISJOINT. Its item keys share not one name with a listing item or an evidence item. A test
 *      runs the three-way disjointness proof, and `findThreeBlockCrossContamination` runs it against a
 *      live payload — exactly the device the original contract uses.
 *   2. AUTHORISED OR ABSENT. `toGovernedMediaBlock` returns `null` for anyone not authorised, and every
 *      surface OMITS the key when it gets `null`. Not an empty block, not a count, not "withheld": a
 *      public response is byte-identical whether or not the vehicle has any governed media, so the
 *      block can never be used to learn that it does.
 *   3. NO LOCATOR. The item carries a short-lived view (`view.href`, `view.expires_at`) and nothing
 *      that names where the bytes live: no bucket, no path, no checksum, no uploader, no tenant, no
 *      evidence id. `gallery_item_id` is the REFERENCE's opaque id, never the asset's.
 *   4. NO ITEM WITHOUT A VIEW. A photograph whose view cannot be produced is counted in
 *      `unavailable_count`, not emitted as a broken slot and not silently dropped.
 *   5. REVIEW STATE IS THE ASSET'S OWN. `review_status` is the evidence's verification status verbatim
 *      (pending / verified / disputed). Nothing here can make a photograph "verified" by presenting it,
 *      and a rejected or superseded asset is not presented at all.
 *   6. PRIMACY IS A STATED CHOICE (the #164 Rule 6, kept). `designated_primary` is true only when the
 *      reference says someone designated it, and `designation_basis` says who. The projection never
 *      elects a primary; with no designation there is simply no primary.
 *   7. IT IS NOT LISTING MEDIA AND DOES NOT BECOME ONE. Nothing here writes `listing_images`, copies a
 *      binary, or makes an image public. Publishing a photograph to the marketplace is a separate,
 *      deliberate act by the seller, through the listing flow, and is unchanged.
 * ===========================================================================================
 */
import {
  EVIDENCE_MEDIA_ITEM_FIELDS,
  LISTING_MEDIA_ITEM_FIELDS,
  findMediaBlockCrossContamination,
  isPublishableMediaIdentity,
  toMediaIdentity,
} from './vehicleMediaProjection.js';

export const GOVERNED_MEDIA_STATES = Object.freeze({
  AVAILABLE: 'available',
  NONE: 'none',
  NOT_LOADED: 'not_loaded',
});
export const GOVERNED_MEDIA_STATE_VALUES = Object.freeze(Object.values(GOVERNED_MEDIA_STATES));

/** The EXACT keys an item carries. Always all of them, never any other. Zero names shared with either sibling block. */
export const GOVERNED_MEDIA_ITEM_FIELDS = Object.freeze([
  'gallery_item_id', 'gallery_rank', 'designated_primary', 'designation_basis', 'caption', 'review_status', 'view',
]);
/** The keys of `view`. A locator the browser can use for a limited time — and nothing about where the bytes are kept. */
export const GOVERNED_MEDIA_VIEW_FIELDS = Object.freeze(['href', 'expires_at']);
export const GOVERNED_MEDIA_ENVELOPE_FIELDS = Object.freeze(['state', 'items', 'total_count', 'unavailable_count', 'empty_statement']);

export const GOVERNED_MEDIA_EMPTY_STATEMENT = 'No photographs are on file for this vehicle.';

/** Only these review states are presentable. A rejected or superseded photograph is not a photograph of the vehicle to show. */
export const PRESENTABLE_REVIEW_STATUSES = Object.freeze(['pending', 'verified', 'disputed']);
export const DESIGNATION_BASES = Object.freeze(['SOURCE_FIRST_IMAGE', 'OWNER_SELECTED', 'OPERATOR_SELECTED']);

/**
 * WHO may see a vehicle's governed media: the vehicle's owner, or a platform role the passport already admits (admin,
 * government) — from a PROVEN identity only. The same rule `buildVehiclePassport` applies to its private evidence vault,
 * stated once here so no surface invents a looser one. A header-asserted identity never qualifies.
 */
export function canViewGovernedMedia({ actorId, ownerId, isPrivileged = false, identityAsserted = false } = {}) {
  if (!actorId || identityAsserted === true) return false;
  if (isPrivileged === true) return true;
  return Boolean(ownerId) && String(actorId) === String(ownerId);
}

const closed = (state) => Object.freeze({
  state,
  items: Object.freeze([]),
  total_count: 0,
  unavailable_count: 0,
  empty_statement: state === GOVERNED_MEDIA_STATES.NONE ? GOVERNED_MEDIA_EMPTY_STATEMENT : null,
});

/**
 * The photographs that may be presented, in gallery order, each with its ABSOLUTE rank. Shared by the projector and by the
 * service that decides which views to produce, so the two can never disagree about which photographs exist.
 *
 * A reference is presentable only if: it is live and belongs to this vehicle; its asset exists, belongs to this vehicle, is an
 * image, and has a presentable review status (a rejected or superseded asset is not presented); and it has a usable, unrepeated
 * opaque identity (an item that cannot be addressed would let a consumer conflate two photographs).
 */
export function selectPresentableMedia({ vin, references, evidenceRows }) {
  const evidenceById = new Map((evidenceRows || []).map((row) => [row?.id, row]));
  const out = [];
  const seenIdentities = new Set();
  const live = (references || [])
    .filter((ref) => ref && ref.deleted_at == null && ref.vin === vin)
    .sort((a, b) => (a.gallery_position - b.gallery_position) || String(a.id).localeCompare(String(b.id)));
  for (const ref of live) {
    const asset = evidenceById.get(ref.evidence_id);
    if (!asset || asset.vin !== vin) continue;
    if (!/^image\//.test(String(asset.mime_type || ''))) continue;
    if (!PRESENTABLE_REVIEW_STATUSES.includes(asset.verification_status)) continue;
    const identity = toMediaIdentity(ref.id);
    if (!isPublishableMediaIdentity(identity) || seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    out.push({ ref, asset, identity, rank: out.length + 1 });
  }
  return out;
}

/**
 * A window onto the gallery. With no limit, all of it. With a limit — a hero for a list, say — the DESIGNATED primary comes
 * first when there is one (a "hero" that ignored the designation would silently mean "whichever is first"), then the earliest
 * of the rest; the window is returned in gallery order and every item keeps its absolute rank.
 */
export function windowPresentable(presentable, limit = null) {
  if (!Number.isInteger(limit) || limit < 0) return presentable;
  if (limit === 0) return [];
  const designated = presentable.find((p) => p.ref.is_primary === true && DESIGNATION_BASES.includes(p.ref.primary_basis));
  const chosen = new Set(designated ? [designated] : []);
  for (const p of presentable) { if (chosen.size >= limit) break; chosen.add(p); }
  return presentable.filter((p) => chosen.has(p));
}

/**
 * @param {object} input
 * @param {boolean} input.authorized          the CALLER's authorisation, decided by `canViewGovernedMedia`. Anything but `true` yields null.
 * @param {string}  input.vin                 the vehicle every row must belong to (defence in depth against a mis-scoped read)
 * @param {Array|null} input.references       live `vehicle_media_references` rows for the vehicle; `null` means the read FAILED
 * @param {Array|null} input.evidenceRows     the referenced `vehicle_evidence` rows; `null` means the read FAILED
 * @param {Map|object|null} input.views       evidence id -> { href, expires_at } for the photographs a view was produced for
 * @param {number|null} [input.limit]         present only a window of the gallery (see `windowPresentable`)
 */
export function toGovernedMediaBlock({ authorized, vin, references, evidenceRows, views, limit = null } = {}) {
  if (authorized !== true) return null;
  // A read that failed is not an absence: say nothing rather than "none" (the original contract's Rule 1).
  if (!Array.isArray(references) || !Array.isArray(evidenceRows)) return closed(GOVERNED_MEDIA_STATES.NOT_LOADED);

  const presentable = selectPresentableMedia({ vin, references, evidenceRows });
  if (presentable.length === 0) return closed(GOVERNED_MEDIA_STATES.NONE);

  const viewFor = (evidenceId) => (views instanceof Map ? views.get(evidenceId) : views?.[evidenceId]) ?? null;
  const items = [];
  let unavailable = 0;
  let primaryClaimed = false;
  const windowed = windowPresentable(presentable, limit);
  for (const { ref, asset, identity, rank } of windowed) {
    const view = viewFor(ref.evidence_id);
    if (!view || typeof view.href !== 'string' || !/^https?:\/\//i.test(view.href)) { unavailable += 1; continue; }
    // A designation needs a stated basis; the first designated item keeps the claim and the rest are demoted, so a consumer
    // never arbitrates between two "main photographs". The projection never elects one itself.
    const designated = ref.is_primary === true && DESIGNATION_BASES.includes(ref.primary_basis) && !primaryClaimed;
    if (designated) primaryClaimed = true;
    items.push(Object.freeze({
      gallery_item_id: identity,
      gallery_rank: rank,
      designated_primary: designated,
      designation_basis: designated ? ref.primary_basis : null,
      caption: typeof ref.label === 'string' && ref.label.trim() ? ref.label.trim() : null,
      review_status: asset.verification_status,
      view: Object.freeze({ href: view.href, expires_at: view.expires_at ?? null }),
    }));
  }
  // Photographs exist but none could be shown right now: that is OUR fault, not an absence. Closed and silent.
  if (items.length === 0 && windowed.length > 0) {
    return Object.freeze({ ...closed(GOVERNED_MEDIA_STATES.NOT_LOADED), total_count: presentable.length, unavailable_count: unavailable });
  }
  return Object.freeze({
    state: GOVERNED_MEDIA_STATES.AVAILABLE,
    items: Object.freeze(items),
    total_count: presentable.length,
    unavailable_count: unavailable,
    empty_statement: null,
  });
}

/**
 * Test/guard helper — the disjointness proof run against a live payload, now across all THREE blocks. Returns dotted paths
 * where an item carries a key that belongs to a different block's item shape. An empty array means the blocks are still
 * structurally distinct in this body.
 */
export function findThreeBlockCrossContamination(body) {
  const offenders = [...findMediaBlockCrossContamination(body)];
  const governed = body?.governed_media?.items;
  if (Array.isArray(governed)) {
    governed.forEach((item, i) => {
      for (const key of Object.keys(item ?? {})) {
        if (LISTING_MEDIA_ITEM_FIELDS.includes(key) || EVIDENCE_MEDIA_ITEM_FIELDS.includes(key)) offenders.push(`governed_media.items[${i}].${key}`);
      }
    });
  }
  for (const [block, fields] of [['listing_media', LISTING_MEDIA_ITEM_FIELDS], ['verified_evidence', EVIDENCE_MEDIA_ITEM_FIELDS]]) {
    const items = body?.[block]?.items;
    if (!Array.isArray(items)) continue;
    items.forEach((item, i) => {
      for (const key of Object.keys(item ?? {})) if (GOVERNED_MEDIA_ITEM_FIELDS.includes(key) && !fields.includes(key)) offenders.push(`${block}.items[${i}].${key}`);
    });
  }
  return [...new Set(offenders)].sort();
}

/** Strings that would reveal where the bytes live or who put them there. None may appear anywhere in a governed block. */
export const GOVERNED_MEDIA_FORBIDDEN_KEYS = Object.freeze([
  'storage_bucket', 'file_path', 'bucket', 'path', 'checksum', 'image_hash', 'uploaded_by', 'verified_by', 'tenant_id', 'evidence_id',
  'metadata', 'file_url', 'storage_path', 'perceptual_hash', 'source_id',
]);

/** Test/guard helper: dotted paths where a governed block carries a key it must never carry. */
export function findGovernedMediaLeaks(block) {
  const hits = [];
  const walk = (value, path) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    for (const [key, entry] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key;
      if (GOVERNED_MEDIA_FORBIDDEN_KEYS.includes(key)) hits.push(here);
      walk(entry, here);
    }
  };
  walk(block, '');
  return hits.sort();
}
