/**
 * T11-CAP-LR01-R3 — a vehicle's MARKETPLACE capability, derived once, on the server, from governed state.
 *
 * Why this exists. `VEHICLE != MARKETPLACE LISTING != IMPORT ORDER`. My Garage and My Listings used to
 * answer "is this vehicle being sold?" from different field heuristics, and My Listings answered it
 * with "every vehicle you own is a listing". A vehicle that was never listed — the Honda Vezel — showed
 * as an unpublished draft needing action, and opening it led a person into the Seller Studio.
 *
 * The four states a customer can be told:
 *
 *   published    the listing is public
 *   in_progress  the Seller has really begun: there is Seller content, a Seller relationship, a stated
 *                price, listing photographs, or an explicit publication workflow state
 *   sold         the vehicle has been marked sold
 *   not_listed   nothing says this vehicle is, or is becoming, a Marketplace listing
 *   unavailable  we could not tell — never folded into `not_listed`
 *
 * What it must NOT read (Moderator ruling D-3), each for a stated reason:
 *
 *   publication_status = 'draft'        a column DEFAULT on every vehicle; it proves no Seller intent.
 *   import_source                       provenance ('Japan', 'import', 'diaspora_import'…), not Seller state.
 *   seller_listing_recorded_at,
 *   listing_location_recorded_at,
 *   listing_location_* / claim_source   stamped by the Seller Studio's autosave merely by OPENING the
 *                                       page (R2 finding PE-1); counting them would make looking at a
 *                                       vehicle turn it into a listing.
 *
 * Pure: no I/O, no clock. The caller supplies the one fact that needs a query (how many listing
 * photographs the Seller has chosen), or `null` when that read failed.
 */
export const MARKETPLACE_CAPABILITY = Object.freeze({
  PUBLISHED: 'published',
  IN_PROGRESS: 'in_progress',
  SOLD: 'sold',
  NOT_LISTED: 'not_listed',
  UNAVAILABLE: 'unavailable',
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * How many listing photographs the Seller has chosen, from the block `toListingMediaBlock` publishes.
 * `null` = we did not look (a failed read), which is NOT zero. Unpublishable rows count: "we could not
 * publish it" is not "the seller added none".
 */
export function listingMediaCountFromBlock(block) {
  if (!block || block.state === 'not_loaded') return null;
  const items = Array.isArray(block.items) ? block.items.length : 0;
  const unpublishable = Number.isFinite(Number(block.unpublishable_count)) ? Number(block.unpublishable_count) : 0;
  return items + Math.max(0, unpublishable);
}

/**
 * The state AND the reasons for it. The reasons are for tests and logs; they are never sent to a client.
 */
export function explainMarketplaceCapability(vehicle, facts = {}) {
  if (!vehicle || typeof vehicle !== 'object') {
    return { state: MARKETPLACE_CAPABILITY.UNAVAILABLE, basis: ['no_vehicle_row'] };
  }
  const publication = text(vehicle.publication_status).toLowerCase();
  if (text(vehicle.status).toLowerCase() === 'sold') {
    return { state: MARKETPLACE_CAPABILITY.SOLD, basis: ['status_sold'] };
  }
  if (publication === 'published') {
    return { state: MARKETPLACE_CAPABILITY.PUBLISHED, basis: ['publication_published'] };
  }

  const mediaCount = facts && Object.prototype.hasOwnProperty.call(facts, 'listingMediaCount') ? facts.listingMediaCount : null;
  const basis = [];
  if (text(vehicle.current_seller_id)) basis.push('seller_relationship');
  if (text(vehicle.seller_description)) basis.push('seller_description');
  if (Array.isArray(vehicle.seller_features) && vehicle.seller_features.some((feature) => text(feature))) basis.push('seller_features');
  // An asking price is stated only with an amount AND a currency (owner surfaces never print a bare 0).
  const price = Number(vehicle.price);
  if (Number.isFinite(price) && price > 0 && text(vehicle.currency)) basis.push('asking_price');
  // Any recorded publication-workflow state other than the default is an explicit step the Seller took.
  if (publication && publication !== 'draft') basis.push('publication_workflow');
  if (typeof mediaCount === 'number' && mediaCount > 0) basis.push('listing_media');

  if (basis.length > 0) return { state: MARKETPLACE_CAPABILITY.IN_PROGRESS, basis };
  // Nothing says "in progress" — but the one signal we could not read might have. Say so, don't guess.
  if (mediaCount === null || mediaCount === undefined) {
    return { state: MARKETPLACE_CAPABILITY.UNAVAILABLE, basis: ['listing_media_unread'] };
  }
  return { state: MARKETPLACE_CAPABILITY.NOT_LISTED, basis: [] };
}

/** What a client is sent: the state, nothing else. */
export function deriveMarketplaceCapability(vehicle, facts = {}) {
  return { state: explainMarketplaceCapability(vehicle, facts).state };
}
