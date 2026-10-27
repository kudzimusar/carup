/**
 * T11-CAP-LR01-R3 — the MARKETPLACE capability of a vehicle (Moderator D-3).
 *
 * `VEHICLE != MARKETPLACE LISTING`. A vehicle that was never listed must not be presented as a listing
 * "needing action" merely because it is owned, or imported, or because someone opened the Seller Studio.
 *
 * What this file holds:
 *   1. The two real vehicles. The Serena is `published`. The Vezel — as it stands on staging today, with
 *      the autosave columns the Studio stamped by being opened twice — is `not_listed`.
 *   2. Every input the Moderator ruled OUT is, alone, unable to make a listing: the `'draft'` default,
 *      `import_source`, and each column the Studio autosave stamps.
 *   3. Every input that IS real Seller activity makes `in_progress`, alone.
 *   4. A signal we could not read is `unavailable`, never `not_listed`.
 *
 * Fixtures are the real staging rows reduced to the columns the derivation can see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKETPLACE_CAPABILITY as M,
  deriveMarketplaceCapability,
  explainMarketplaceCapability,
  listingMediaCountFromBlock,
} from '../utils/marketplaceCapability.js';

const KINGSTON = 'u_66cace85fad949e4';

/** The Honda Vezel as staging holds it on 2026-10-27: identity from the import handoff + the Studio's autosave stamps. */
const VEZEL = Object.freeze({
  vin: 'RU3-1316558',
  owner_id: KINGSTON,
  current_seller_id: null,
  publication_status: 'draft',
  status: 'Pending',
  import_source: 'diaspora_import',
  price: 0,
  currency: null,
  seller_description: null,
  seller_features: [],
  seller_listing_recorded_at: '2026-10-26T11:43:07.74Z',
  listing_location_recorded_at: '2026-10-26T11:43:07.74Z',
  listing_location_source: 'seller_declared',
  listing_location_visibility: 'withheld',
  seller_listing_claim_source: 'seller_declared',
});

/** The Nissan Serena: owned, current seller, published, with a price and listing photographs. */
const SERENA = Object.freeze({
  vin: 'GFC27-027051',
  owner_id: KINGSTON,
  current_seller_id: KINGSTON,
  publication_status: 'published',
  status: 'Available',
  import_source: 'import',
  price: 12800,
  currency: 'USD',
  seller_description: 'One careful owner.',
  seller_features: ['Reverse camera'],
});

const state = (vehicle, facts) => deriveMarketplaceCapability(vehicle, facts).state;
const why = (vehicle, facts) => explainMarketplaceCapability(vehicle, facts);

test('R3-M1: the Serena is a published Marketplace vehicle', () => {
  assert.deepEqual(deriveMarketplaceCapability(SERENA, { listingMediaCount: 10 }), { state: M.PUBLISHED });
});

test('R3-M2: the Vezel — draft default, import provenance and the Studio\'s autosave stamps — is NOT a listing', () => {
  assert.deepEqual(deriveMarketplaceCapability(VEZEL, { listingMediaCount: 0 }), { state: M.NOT_LISTED });
  assert.deepEqual(why(VEZEL, { listingMediaCount: 0 }).basis, []);
});

test('R3-M3: each input the Moderator ruled OUT is, by itself, unable to make a listing', () => {
  const base = { ...VEZEL };
  const cases = {
    "publication_status 'draft' (a column default)": { publication_status: 'draft' },
    'publication_status absent': { publication_status: undefined },
    "import_source 'diaspora_import'": { import_source: 'diaspora_import' },
    "import_source 'import'": { import_source: 'import' },
    "import_source 'Japan'": { import_source: 'Japan' },
    'seller_listing_recorded_at (stamped by opening the Studio)': { seller_listing_recorded_at: '2026-10-26T11:43:07.74Z' },
    'listing_location_recorded_at (stamped by opening the Studio)': { listing_location_recorded_at: '2026-10-26T11:43:07.74Z' },
    "listing_location_source 'seller_declared'": { listing_location_source: 'seller_declared' },
    "listing_location_visibility 'withheld'": { listing_location_visibility: 'withheld' },
    "seller_listing_claim_source 'seller_declared'": { seller_listing_claim_source: 'seller_declared' },
    'seller_features [] (the autosave writes an empty list)': { seller_features: [] },
    'price 0 with no currency (the handoff placeholder)': { price: 0, currency: null },
    "status 'Pending' (the handoff's value)": { status: 'Pending' },
    'a linked import order (not a column of the vehicle, but it must not matter)': { linked_vehicle_vin: 'RU3-1316558', import_order_id: 'x' },
  };
  for (const [label, over] of Object.entries(cases)) {
    assert.equal(state({ ...base, ...over }, { listingMediaCount: 0 }), M.NOT_LISTED, `${label} alone made a listing`);
  }
});

test('R3-M4: each REAL Seller signal makes the vehicle in_progress, by itself', () => {
  const real = {
    'a current Seller relationship': [{ current_seller_id: KINGSTON }, 'seller_relationship'],
    'a Seller description': [{ seller_description: 'Hybrid, one owner, full service history.' }, 'seller_description'],
    'a selected feature': [{ seller_features: ['Alloy wheels'] }, 'seller_features'],
    'an asking price with a currency': [{ price: 9500, currency: 'USD' }, 'asking_price'],
    "the 'review_pending' workflow state": [{ publication_status: 'review_pending' }, 'publication_workflow'],
    "the 'documents_submitted' workflow state": [{ publication_status: 'documents_submitted' }, 'publication_workflow'],
    "the 'identity_complete' workflow state": [{ publication_status: 'identity_complete' }, 'publication_workflow'],
    "the 'publishable' workflow state": [{ publication_status: 'publishable' }, 'publication_workflow'],
    "an 'unpublished' listing": [{ publication_status: 'unpublished' }, 'publication_workflow'],
  };
  for (const [label, [over, basis]] of Object.entries(real)) {
    const verdict = why({ ...VEZEL, ...over }, { listingMediaCount: 0 });
    assert.equal(verdict.state, M.IN_PROGRESS, `${label} was not treated as Seller activity`);
    assert.deepEqual(verdict.basis, [basis]);
  }
  // Listing photographs the Seller chose are a real signal too (and need no other column).
  assert.deepEqual(why(VEZEL, { listingMediaCount: 1 }), { state: M.IN_PROGRESS, basis: ['listing_media'] });
});

test('R3-M5: blank content is not Seller content', () => {
  assert.equal(state({ ...VEZEL, seller_description: '   ' }, { listingMediaCount: 0 }), M.NOT_LISTED);
  assert.equal(state({ ...VEZEL, seller_features: ['', '  '] }, { listingMediaCount: 0 }), M.NOT_LISTED);
  assert.equal(state({ ...VEZEL, current_seller_id: '  ' }, { listingMediaCount: 0 }), M.NOT_LISTED);
  // A price needs BOTH an amount above zero and a currency; owner surfaces never print a bare number.
  assert.equal(state({ ...VEZEL, price: 9500, currency: null }, { listingMediaCount: 0 }), M.NOT_LISTED);
  assert.equal(state({ ...VEZEL, price: 9500, currency: '  ' }, { listingMediaCount: 0 }), M.NOT_LISTED);
  assert.equal(state({ ...VEZEL, price: 0, currency: 'USD' }, { listingMediaCount: 0 }), M.NOT_LISTED);
  assert.equal(state({ ...VEZEL, price: -5, currency: 'USD' }, { listingMediaCount: 0 }), M.NOT_LISTED);
  assert.equal(state({ ...VEZEL, price: 'abc', currency: 'USD' }, { listingMediaCount: 0 }), M.NOT_LISTED);
  assert.equal(state({ ...VEZEL, price: Number.NaN, currency: 'USD' }, { listingMediaCount: 0 }), M.NOT_LISTED);
});

test('R3-M6: sold outranks published; a published listing is published whatever else is true', () => {
  assert.equal(state({ ...SERENA, status: 'Sold' }, { listingMediaCount: 10 }), M.SOLD);
  assert.equal(state({ ...SERENA, status: 'sold' }, { listingMediaCount: 10 }), M.SOLD);
  assert.equal(state({ ...VEZEL, status: 'SOLD' }, { listingMediaCount: 0 }), M.SOLD, 'a private sale of an unpublished vehicle is still sold');
  assert.equal(state({ ...SERENA, status: 'Reserved' }, { listingMediaCount: 10 }), M.PUBLISHED);
  // Publication does not depend on the media read at all.
  assert.equal(state(SERENA, { listingMediaCount: null }), M.PUBLISHED);
  assert.equal(state(SERENA, {}), M.PUBLISHED);
});

test('R3-M7: what could not be read is `unavailable` — never folded into `not_listed`', () => {
  // Nothing says in-progress, and the one signal we could not read might have.
  assert.equal(state(VEZEL, { listingMediaCount: null }), M.UNAVAILABLE);
  assert.equal(state(VEZEL, {}), M.UNAVAILABLE);
  assert.equal(state(VEZEL), M.UNAVAILABLE);
  assert.deepEqual(why(VEZEL, {}).basis, ['listing_media_unread']);
  // …but if another real signal already settles it, the unread signal cannot change the answer.
  assert.equal(state({ ...VEZEL, current_seller_id: KINGSTON }, { listingMediaCount: null }), M.IN_PROGRESS);
  // No row at all is unavailable too.
  for (const missing of [null, undefined, 'x', 7]) assert.equal(state(missing, { listingMediaCount: 0 }), M.UNAVAILABLE);
});

test('R3-M8: a client is sent the state and nothing else', () => {
  const sent = deriveMarketplaceCapability(VEZEL, { listingMediaCount: 3 });
  assert.deepEqual(Object.keys(sent), ['state']);
  assert.equal(JSON.stringify(sent).includes('basis'), false);
});

test('R3-M9: it reads the listing-media block the way the owner list publishes it', () => {
  assert.equal(listingMediaCountFromBlock({ state: 'not_loaded', items: [], unpublishable_count: 0 }), null);
  assert.equal(listingMediaCountFromBlock({ state: 'none', items: [], unpublishable_count: 0 }), 0);
  assert.equal(listingMediaCountFromBlock({ state: 'published', items: [{}, {}], unpublishable_count: 1 }), 3, 'a photograph we could not publish is still a photograph the seller added');
  assert.equal(listingMediaCountFromBlock({ state: 'none', items: [], unpublishable_count: 2 }), 2);
  for (const garbage of [null, undefined]) assert.equal(listingMediaCountFromBlock(garbage), null);
  assert.equal(listingMediaCountFromBlock({ state: 'none' }), 0);
});

test('R3-M10: it is pure — it does not modify its input and gives the same answer twice', () => {
  const frozen = Object.freeze({ ...VEZEL, seller_features: Object.freeze([]) });
  const first = explainMarketplaceCapability(frozen, { listingMediaCount: 0 });
  const second = explainMarketplaceCapability(frozen, { listingMediaCount: 0 });
  assert.deepEqual(first, second);
  assert.deepEqual({ ...frozen }, { ...VEZEL }, 'the input changed');
});

test('R3-M11: the Vezel and the Serena differ ONLY in facts: identical code, different states', () => {
  assert.notEqual(state(VEZEL, { listingMediaCount: 0 }), state(SERENA, { listingMediaCount: 10 }));
  // Give the Vezel the Serena's Seller facts and it becomes the same kind of listing — no "imported vehicle" branch exists.
  const listed = { ...VEZEL, publication_status: 'published', status: 'Available', current_seller_id: KINGSTON, price: 12800, currency: 'USD' };
  assert.equal(state(listed, { listingMediaCount: 10 }), state(SERENA, { listingMediaCount: 10 }));
  assert.equal(state({ ...SERENA, import_source: 'diaspora_import' }, { listingMediaCount: 10 }), M.PUBLISHED);
});
