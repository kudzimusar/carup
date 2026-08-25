/**
 * ==========================================================================================
 * ISSUE #164 PHASE 5 — THE SECOND PUBLIC CONTRACT, AND THE PROOF IT IS GONE
 *
 * ONE VEHICLE. ONE TRUTH. ONE PUBLIC CONTRACT.
 *
 * Phase 5 built the canonical media contract (`backend/utils/vehicleMediaProjection.js`) and wired
 * the passport to it. It did NOT wire the marketplace. So after Phase 5 the repository held TWO
 * definitions of "a publishable listing photo", on the same three rows of the same table:
 *
 *   canonical    `classifyMediaUrl` — https / http / protocol-relative / site-relative, and NOTHING
 *                else. `data:`, `blob:`, `javascript:`, a bare `photo.jpg`, a blank string and a
 *                non-string are UNPUBLISHABLE and are COUNTED.
 *   marketplace  `.filter((row) => row?.image_url)` — is the column truthy.
 *
 * The marketplace one was the permissive one, and it was the one on the public wire.
 *
 * ── WHAT WAS MEASURED BEFORE THE CHANGE (this is the defect, not a hypothetical) ───────────
 * Feeding four `listing_images` rows whose `image_url` values were
 *   `data:image/png;base64,AAAA`, `javascript:alert(1)`, `photo.jpg`, `https://cdn.carup.test/real.jpg`
 * to the shipped code produced:
 *
 *   detail.media               ALL FOUR, verbatim, each as `{url, type:'image', is_primary}`
 *   detail.primary_image_url   "data:image/png;base64,AAAA"
 *   summary.primary_image_url  "data:image/png;base64,AAAA"
 *   canonical block            ONE item, `unpublishable_count: 3`
 *
 * `primary_image_url` is the one that matters most, and it is not saved by any downstream check:
 * `VehicleSearch.tsx:284`, `dashboard/owner/SavedCars.tsx:85` and `MarketplaceCompare.tsx:89` put it
 * straight into an `<img src>`, and `ListingImage.tsx` — the shared component — branches on `src`
 * being TRUTHY and applies no classification at all. On the detail page `VehicleDetail.tsx`
 * re-classifies, so nothing renders there today; that is luck downstream of a permissive server,
 * not architecture, and it does not extend to the list, compare or saved-cars surfaces.
 *
 * A second divergence, same cause: `is_primary: Boolean(row.is_primary)` published EVERY claimant.
 * Nothing in the schema prevents two rows claiming primacy (there is no partial unique index on
 * `(vin) WHERE is_primary`), and fed two such rows the shipped detail published two "main photos".
 *
 * A third: the row's `id` was dropped, so the marketplace transport could not NAME a photograph.
 * Continuity marketplace -> detail could only be argued by comparing URL STRINGS, and 3 of 3
 * staging rows are site-relative `/uat/owner/*.svg` paths with no uniqueness constraint behind them.
 *
 * ── WHAT THIS FILE PROVES ──────────────────────────────────────────────────────────────────
 * Suite 1  ONE DEFINITION      the marketplace decides nothing about publishability itself
 * Suite 2  IDENTITY            the marketplace surface carries `media_id`, and it is the ROW's id
 * Suite 3  CONTINUITY          the same identity reaches list, detail and passport for one VIN
 * Suite 4  THE VIEW            `media` is `listing_media.items` + one legacy key, exactly
 * Suite 5  RULE 1              a FAILED read is `not_loaded`, never "the seller added no photos"
 * Suite 6  PRIMACY             the LIST card's election, and the label that stops it lying
 * Suite 7  E2E PIN             the e2e spec no longer encodes the defect sentence
 *
 * Every suite is written so that REVERTING the convergence turns it red. The mutation table in
 * MEDIA_EVIDENCE_CONTRACT.md records which named test dies for which mutation; each was applied and
 * the file restored byte-identically.
 * ==========================================================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  LISTING_MEDIA_EMPTY_STATEMENT,
  LISTING_MEDIA_ITEM_FIELDS,
  MEDIA_BLOCK_ENVELOPE_FIELDS,
  classifyMediaUrl,
  findTrustLanguage,
  toListingMediaBlock,
} from '../utils/vehicleMediaProjection.js';
import {
  buildMarketplaceListingSummary,
  fetchListingRelatedRows,
  listMarketplaceListings,
  listingImageRowsForVin,
} from '../services/marketplace/listingSummaryService.js';
import { getMarketplaceListingDetail } from '../services/marketplace/marketplaceListingDetailService.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const readSrc = (rel) => readFileSync(`${REPO}${rel}`, 'utf8');

/**
 * Strip `/** … *​/` blocks before scanning for banned constructs.
 *
 * This is not cosmetic. Every file in this programme QUOTES the defect it removed, verbatim, so the
 * record survives the code — `marketplaceListingDetailService.js` reproduces the old
 * `.filter((row) => row?.image_url)` in its header, and the e2e spec reproduces the old
 * `toContainText(/no verified images/i)` in its. A scanner that reads the whole file cannot tell
 * "this code is here" from "this code USED to be here", and would force the archaeology to be
 * deleted to make itself pass — the exact trade this programme refuses.
 *
 * Only BLOCK comments are stripped. Line comments are left alone because regex literals contain
 * `//` (`/^(absolute_https|…)$/`) and a naive line stripper mangles them.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

const DETAIL_SERVICE_SRC = readSrc('backend/services/marketplace/marketplaceListingDetailService.js');
const SUMMARY_SERVICE_SRC = readSrc('backend/services/marketplace/listingSummaryService.js');
const E2E_SPEC_SRC = readSrc('web/e2e/vehicle-detail.spec.ts');
const DETAIL_SERVICE_CODE = code(DETAIL_SERVICE_SRC);
const SUMMARY_SERVICE_CODE = code(SUMMARY_SERVICE_SRC);
const E2E_SPEC_CODE = code(E2E_SPEC_SRC);

const VIN = '1HGBH41JXMN109186';
const NOW = new Date().toISOString();

function publicVehicle(overrides = {}) {
  return {
    vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, mileage: 42000,
    price: 9500, currency: 'USD', status: 'Available',
    owner_id: '550e8400-e29b-41d4-a716-446655440000', tenant_id: null,
    registration_country: 'ZW', import_source: 'Local', current_seller_type: 'Private Owner',
    duty_paid: true, police_verified: true, passport_verified: false, created_at: NOW,
    ...overrides,
  };
}

/**
 * A FAITHFUL `listing_images` row. Every column the table actually has, and `id` is a real uuid
 * because the column is `uuid NOT NULL DEFAULT gen_random_uuid()`. Fixtures that omit it describe a
 * row the table cannot produce, which is how a test about ordering silently becomes a test about an
 * empty gallery.
 */
let idSeq = 0;
function imageRow({ url, primary = false, order = 0, id } = {}) {
  idSeq += 1;
  return {
    id: id ?? `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`,
    vin: VIN,
    image_url: url,
    is_primary: primary,
    display_order: order,
  };
}

/**
 * A supabase double that PROJECTS to the selected columns, the way PostgREST does.
 *
 * The repo's shared `buildMockSupabase` has `select() { return builder }` — a no-op — so a service
 * that narrowed its select would keep passing against it. That is not a hypothetical concern here:
 * the identity is published from `listing_images.id`, and a select that stops naming `id` turns
 * every row unpublishable at runtime while every fixture-fed test stays green. Honouring `.select()`
 * is what makes suite 2's `M4` mutation die behaviourally rather than only in source text.
 *
 * `failTables` makes a named table's read REJECT, which is the only way to exercise Rule 1's
 * "the read did not resolve" branch.
 */
function projectingSupabase(store = {}, { failTables = [] } = {}) {
  return {
    from(table) {
      const rows = Array.isArray(store[table]) ? store[table] : [];
      const filters = [];
      let columns = null;
      const project = (row) => {
        if (columns === null) return { ...row };
        const out = {};
        for (const col of columns) if (col in row) out[col] = row[col];
        return out;
      };
      const resolve = () => {
        if (failTables.includes(table)) {
          return { data: null, error: { message: `permission denied for table ${table}` } };
        }
        return { data: rows.filter((r) => filters.every((f) => f(r))).map(project), error: null };
      };
      const builder = {
        select(cols) {
          // `tenant:tenants(name, …)` embeds and `*` are passed through untouched; only a plain
          // comma list narrows, which is all the media reads use.
          if (typeof cols === 'string' && !cols.includes('(') && !cols.includes('*')) {
            columns = cols.split(',').map((c) => c.trim()).filter(Boolean);
          }
          return builder;
        },
        eq(col, val) { filters.push((r) => r[col] === val); return builder; },
        neq(col, val) { filters.push((r) => r[col] !== val); return builder; },
        gte(col, val) { filters.push((r) => Number(r[col]) >= Number(val)); return builder; },
        lte(col, val) { filters.push((r) => Number(r[col]) <= Number(val)); return builder; },
        in(col, vals) { const set = new Set(vals); filters.push((r) => set.has(r[col])); return builder; },
        or() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        single() { const res = resolve(); return Promise.resolve({ data: (res.data || [])[0] ?? null, error: res.error }); },
        maybeSingle() { return builder.single(); },
        then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
      };
      return builder;
    },
  };
}

/** The four values the canonical contract refuses, and one it publishes. */
const UNPUBLISHABLE = [
  'data:image/png;base64,AAAA',
  'javascript:alert(1)',
  'photo.jpg',
  '   ',
];
const REAL_URL = 'https://cdn.carup.test/real.jpg';

// ===========================================================================================
// SUITE 1 — ONE DEFINITION OF PUBLISHABLE
// ===========================================================================================
describe('Phase 5 convergence — ONE definition of a publishable listing photo', () => {

  it('the marketplace DETAIL refuses every value the canonical contract refuses', async () => {
    for (const bad of UNPUBLISHABLE) {
      const store = {
        vehicles: [publicVehicle()],
        listing_images: [imageRow({ url: bad, primary: true }), imageRow({ url: REAL_URL, order: 1 })],
        vehicle_evidence: [],
      };
      const detail = await getMarketplaceListingDetail(projectingSupabase(store), VIN);
      const urls = detail.media.map((m) => m.url);
      assert.ok(!urls.includes(bad), `detail.media published the unpublishable value ${JSON.stringify(bad)}`);
      assert.deepEqual(urls, [REAL_URL]);
      // Counted, never silently dropped — a short gallery that hides what it could not render is
      // passing our defect off as the seller's omission.
      assert.equal(detail.listing_media.unpublishable_count, 1);
    }
  });

  it('the LIST CARD cover image refuses every value the canonical contract refuses', () => {
    for (const bad of UNPUBLISHABLE) {
      const summary = buildMarketplaceListingSummary({
        vehicle: publicVehicle(),
        imageRows: [imageRow({ url: bad, primary: true })],
      });
      assert.notEqual(summary.primary_image_url, bad,
        `primary_image_url published ${JSON.stringify(bad)} — it goes straight into an <img src> on VehicleSearch, SavedCars and MarketplaceCompare`);
      assert.equal(summary.primary_image_url, null);
      // `none` alone would be a lie here: the seller DID add a photo, we could not publish it.
      assert.equal(summary.primary_image_state, 'none');
      assert.equal(summary.primary_image_unpublishable_count, 1);
    }
  });

  it('agrees with the canonical projection on EVERY url form, by construction not by coincidence', async () => {
    const cases = [
      ['https://cdn/a.jpg', 'absolute_https'],
      ['http://cdn/a.jpg', 'absolute_http'],
      ['//cdn/a.jpg', 'protocol_relative'],
      ['/uat/owner/toyota-corolla.svg', 'site_relative'],
    ];
    for (const [url, form] of cases) {
      assert.equal(classifyMediaUrl(url), form, 'canonical classification changed — update this table');
      const detail = await getMarketplaceListingDetail(
        projectingSupabase({ vehicles: [publicVehicle()], listing_images: [imageRow({ url })], vehicle_evidence: [] }), VIN);
      assert.deepEqual(detail.media.map((m) => m.url), [url]);
      // The form travels. A consumer must be able to tell `//cdn/a.jpg` (a FOREIGN host) from
      // `/uat/...` (this origin) without re-parsing the string.
      assert.equal(detail.media[0].url_form, form);
    }
  });

  it('NEITHER marketplace file contains a url test of its own', () => {
    // The convergence is a fact about the SOURCE, not only about outputs: two files that agree
    // today because both were written correctly are still two definitions.
    for (const [name, src] of [['detail', DETAIL_SERVICE_CODE], ['summary', SUMMARY_SERVICE_CODE]]) {
      assert.ok(!/\.filter\(\s*\(?\s*row\s*\)?\s*=>\s*row\??\.image_url\s*\)/.test(src),
        `${name} re-introduced the truthiness filter — that IS the second definition`);
      assert.ok(!/startsWith\(\s*['"]https?:/.test(src),
        `${name} authored its own scheme test instead of calling the canonical projection`);
      assert.ok(src.includes("from '../../utils/vehicleMediaProjection.js'"),
        `${name} must source publishability from the canonical projection`);
    }
  });

  it('the DETAIL does not re-implement sorting or primacy arbitration', () => {
    // The shipped file sorted and Boolean()-ed on its own. Both decisions now belong to Rule 6.
    const body = DETAIL_SERVICE_CODE.slice(DETAIL_SERVICE_CODE.indexOf('export async function getMarketplaceListingDetail'));
    assert.ok(!/is_primary:\s*Boolean\(/.test(body),
      'publishing Boolean(row.is_primary) publishes EVERY claimant — Rule 6 demotes all but the first');
    assert.ok(!/display_order/.test(body),
      'the detail must not sort on display_order itself; toListingMediaBlock owns the order');
  });

  it('publishes NO trust language over the gallery — the block that is never verified', async () => {
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [imageRow({ url: REAL_URL })], vehicle_evidence: [] }), VIN);
    assert.deepEqual(findTrustLanguage(detail.listing_media, 'listing_media'), []);
    assert.deepEqual(findTrustLanguage(detail.media, 'media'), []);
  });
});

// ===========================================================================================
// SUITE 2 — IDENTITY ON THE MARKETPLACE SURFACE
// ===========================================================================================
describe('Phase 5 convergence — the marketplace can NAME a photograph', () => {

  it('publishes media_id on EVERY published item, on both keys', async () => {
    const rows = [imageRow({ url: 'https://cdn/a.jpg', primary: true }), imageRow({ url: 'https://cdn/b.jpg', order: 1 })];
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: rows, vehicle_evidence: [] }), VIN);
    assert.equal(detail.media.length, 2);
    for (const item of detail.media) {
      assert.match(item.media_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    for (const item of detail.listing_media.items) {
      assert.match(item.media_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('carries the ROW id — never a value derived from position or from the url', async () => {
    const rows = [
      imageRow({ url: 'https://cdn/a.jpg', id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', order: 5 }),
      imageRow({ url: 'https://cdn/b.jpg', id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', order: 1 }),
    ];
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: rows, vehicle_evidence: [] }), VIN);
    // b sorts first (display_order 1) — so position 0 carries B's id, not A's, and not "0".
    assert.equal(detail.media[0].position, 0);
    assert.equal(detail.media[0].media_id, 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');
    assert.equal(detail.media[1].media_id, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
  });

  it('is STABLE UNDER RE-ORDERING — the identity follows the photograph, the position does not', async () => {
    const a = imageRow({ url: 'https://cdn/a.jpg', id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', order: 0 });
    const b = imageRow({ url: 'https://cdn/b.jpg', id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', order: 1 });
    const first = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [a, b], vehicle_evidence: [] }), VIN);
    // The seller re-orders. `position` swaps; `media_id` must not.
    const second = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [{ ...a, display_order: 9 }, b], vehicle_evidence: [] }), VIN);
    assert.equal(first.media[0].media_id, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    assert.equal(second.media[0].media_id, 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');
    assert.equal(first.media[0].position, second.media[0].position, 'position is a slot and it collided, as it always will');
    const idOf = (d, url) => d.media.find((m) => m.url === url).media_id;
    assert.equal(idOf(first, 'https://cdn/a.jpg'), idOf(second, 'https://cdn/a.jpg'),
      'the same photograph must keep the same identity across two reads');
  });

  it('is DISTINCT per item — the identities never collide inside one block', async () => {
    const rows = [
      imageRow({ url: 'https://cdn/a.jpg', order: 0 }),
      imageRow({ url: 'https://cdn/b.jpg', order: 1 }),
      imageRow({ url: 'https://cdn/c.jpg', order: 2 }),
    ];
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: rows, vehicle_evidence: [] }), VIN);
    const ids = detail.media.map((m) => m.media_id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('M4: the listing_images READ selects the identity column it publishes', async () => {
    // Source text AND behaviour. The behavioural half needs a stub that honours `.select()`, which
    // the repo's shared mock does not — see `projectingSupabase`.
    assert.match(SUMMARY_SERVICE_SRC, /\.select\('id, vin, image_url, is_primary, display_order'\)/,
      'the marketplace read must name `id` — publishing an identity it never selected is impossible');
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [imageRow({ url: REAL_URL })], vehicle_evidence: [] }), VIN);
    assert.equal(detail.media.length, 1, 'a select that drops `id` turns every row unpublishable');
    assert.notEqual(detail.media[0].media_id, null);
  });

  it('does NOT publish listing_images.created_at as if it were a capture time', async () => {
    const row = { ...imageRow({ url: REAL_URL }), created_at: '2020-01-01T00:00:00.000Z' };
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [row], vehicle_evidence: [] }), VIN);
    assert.equal('created_at' in detail.media[0], false);
    assert.equal('created_at' in detail.listing_media.items[0], false);
  });
});

// ===========================================================================================
// SUITE 3 — CONTINUITY, PROVED ON IDENTITY RATHER THAN ON A STRING
// ===========================================================================================
describe('Phase 5 convergence — identity continuity marketplace list -> detail', () => {

  it('the LIST card and the DETAIL agree on WHICH photograph is the cover', async () => {
    const rows = [
      imageRow({ url: 'https://cdn/cover.jpg', id: 'cccccccc-1111-4111-8111-cccccccccccc', primary: true, order: 7 }),
      imageRow({ url: 'https://cdn/other.jpg', id: 'dddddddd-2222-4222-8222-dddddddddddd', order: 0 }),
    ];
    const store = { vehicles: [publicVehicle()], listing_images: rows, vehicle_evidence: [] };
    const { listings } = await listMarketplaceListings(projectingSupabase(store));
    const detail = await getMarketplaceListingDetail(projectingSupabase(store), VIN);

    const card = listings.find((l) => l.vin === VIN);
    assert.equal(card.primary_image_url, 'https://cdn/cover.jpg');
    // The DETAIL names the same photograph, and names it by IDENTITY. Comparing url strings would
    // prove only that two surfaces printed the same characters — and 3 of 3 staging rows are
    // site-relative paths with no uniqueness constraint behind them.
    const detailPrimary = detail.listing_media.items.find((i) => i.is_primary);
    assert.equal(detailPrimary.media_id, 'cccccccc-1111-4111-8111-cccccccccccc');
    assert.equal(detailPrimary.url, card.primary_image_url);
  });

  it('one read feeds both surfaces — the card cannot show a photo the detail refuses', async () => {
    const store = {
      vehicles: [publicVehicle()],
      listing_images: [imageRow({ url: 'data:image/png;base64,AAAA', primary: true }), imageRow({ url: REAL_URL, order: 1 })],
      vehicle_evidence: [],
    };
    const { listings } = await listMarketplaceListings(projectingSupabase(store));
    const detail = await getMarketplaceListingDetail(projectingSupabase(store), VIN);
    assert.equal(listings.find((l) => l.vin === VIN).primary_image_url, REAL_URL);
    assert.deepEqual(detail.media.map((m) => m.url), [REAL_URL]);
    // This is the defect the ORIGINAL bug report described, inverted: marketplace served a card
    // image the detail page could not account for. Now neither can serve what the other refuses.
  });

  it('the shared read reports whether listing_images was consulted at all', async () => {
    const store = { vehicles: [publicVehicle()], listing_images: [imageRow({ url: REAL_URL })] };
    const ok = await fetchListingRelatedRows(projectingSupabase(store), [VIN]);
    assert.equal(ok.listingImagesRead, true);
    assert.deepEqual(listingImageRowsForVin(ok, VIN).map((r) => r.image_url), [REAL_URL]);

    const failed = await fetchListingRelatedRows(projectingSupabase(store, { failTables: ['listing_images'] }), [VIN]);
    assert.equal(failed.listingImagesRead, false);
    assert.equal(listingImageRowsForVin(failed, VIN), null,
      'a failed read must reach the projection as null (not_loaded), never as [] (a finding)');
  });
});

// ===========================================================================================
// SUITE 4 — `media` IS A VIEW, NOT A SECOND PROJECTION
// ===========================================================================================
describe('Phase 5 convergence — `media` is derived from `listing_media`, exactly', () => {

  const LEGACY_ONLY_KEYS = ['type'];

  it('every media entry is its listing_media item plus exactly one legacy key', async () => {
    const rows = [
      imageRow({ url: 'https://cdn/a.jpg', primary: true, order: 2 }),
      imageRow({ url: '//cdn/b.jpg', order: 0 }),
      imageRow({ url: '/local/c.svg', order: 1 }),
      imageRow({ url: 'data:image/png;base64,AAAA', order: 3 }),
    ];
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: rows, vehicle_evidence: [] }), VIN);

    assert.equal(detail.media.length, detail.listing_media.items.length);
    detail.media.forEach((entry, i) => {
      const { type, ...rest } = entry;
      assert.equal(type, 'image');
      // Exact structural equality. A view cannot disagree with its source; a second projection can,
      // and that is the whole distinction this key rests on.
      assert.deepEqual(rest, detail.listing_media.items[i]);
      assert.deepEqual(Object.keys(entry).sort(), [...LISTING_MEDIA_ITEM_FIELDS, ...LEGACY_ONLY_KEYS].sort());
    });
  });

  it('the canonical envelope is published in full, with the contract`s own wording', async () => {
    const empty = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [], vehicle_evidence: [] }), VIN);
    assert.deepEqual(Object.keys(empty.listing_media).sort(), [...MEDIA_BLOCK_ENVELOPE_FIELDS].sort());
    assert.equal(empty.listing_media.state, 'none');
    // The sentence is the contract's, not this file's. "No verified images uploaded yet" was
    // authored in a .tsx, which is exactly how a marketing gallery published a governance finding.
    assert.equal(empty.listing_media.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    assert.deepEqual(empty.media, []);
  });

  it('legacy consumers still find the three keys they read', async () => {
    // `web/src/pages/VehicleDetail.tsx:1376` feeds `detail.media` to its own projection and DROPS
    // any entry whose `type !== 'image'`; `mobile/utils/marketplaceApi.ts:57` declares
    // `{url, type, is_primary}`. Removing any of the three is a live breakage, which is why the key
    // was converged rather than renamed.
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [imageRow({ url: REAL_URL, primary: true })], vehicle_evidence: [] }), VIN);
    for (const key of ['url', 'type', 'is_primary']) {
      assert.ok(key in detail.media[0], `legacy consumers read media[].${key}`);
    }
    assert.equal(detail.media[0].type, 'image');
  });

  it('the detail payload publishes no OTHER gallery key that could disagree', async () => {
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [imageRow({ url: REAL_URL, primary: true })], vehicle_evidence: [] }), VIN);
    for (const key of ['images', 'photos', 'gallery', 'image_urls', 'cover_url', 'thumbnail_url']) {
      assert.equal(key in detail, false, `${key} would be a third place the same fact lives`);
    }
    // `primary_image_url` DOES survive — it is the card key and it is now sourced from the same
    // projection, so it can only ever name a photo the gallery also carries.
    assert.ok(detail.media.some((m) => m.url === detail.primary_image_url));
  });
});

// ===========================================================================================
// SUITE 5 — RULE 1 ON THE MARKETPLACE PATH
// ===========================================================================================
describe('Phase 5 convergence — a read that did not happen says nothing', () => {

  it('a FAILED listing_images read is not_loaded, and publishes NO sentence', async () => {
    const store = { vehicles: [publicVehicle()], listing_images: [imageRow({ url: REAL_URL })], vehicle_evidence: [] };
    const detail = await getMarketplaceListingDetail(
      projectingSupabase(store, { failTables: ['listing_images'] }), VIN);
    assert.equal(detail.listing_media.state, 'not_loaded');
    assert.equal(detail.listing_media.empty_statement, null,
      'a read that never resolved may not report "the seller added no photos"');
    assert.deepEqual(detail.listing_media.items, []);
  });

  it('an EMPTY listing_images read says "no photos", which is a DIFFERENT fact', async () => {
    const detail = await getMarketplaceListingDetail(
      projectingSupabase({ vehicles: [publicVehicle()], listing_images: [], vehicle_evidence: [] }), VIN);
    assert.equal(detail.listing_media.state, 'none');
    assert.equal(detail.listing_media.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
  });

  it('the two states are not interchangeable on the LIST card either', async () => {
    const store = { vehicles: [publicVehicle()], listing_images: [imageRow({ url: REAL_URL })] };
    const okList = await listMarketplaceListings(projectingSupabase(store));
    assert.equal(okList.listings[0].primary_image_state, 'first_published');

    const failedList = await listMarketplaceListings(projectingSupabase(store, { failTables: ['listing_images'] }));
    assert.equal(failedList.listings[0].primary_image_state, 'not_loaded');
    assert.equal(failedList.listings[0].primary_image_url, null);
  });

  it('a caller that passes NO image rows gets not_loaded, not "none"', () => {
    // The default was `imageRows = []`, which made "I did not look" indistinguishable from "there
    // are none" for every caller that omitted the argument.
    const summary = buildMarketplaceListingSummary({ vehicle: publicVehicle() });
    assert.equal(summary.primary_image_state, 'not_loaded');
    assert.equal(summary.primary_image_url, null);
    assert.equal(buildMarketplaceListingSummary({ vehicle: publicVehicle(), imageRows: [] }).primary_image_state, 'none');
  });
});

// ===========================================================================================
// SUITE 6 — PRIMACY ON THE LIST CARD
// ===========================================================================================
describe('Phase 5 convergence — the card cover, and the label that stops it lying', () => {

  it('honours is_primary over display_order (the certifier`s correction, verified)', () => {
    // The claim that this path ignored `is_primary` was WRONG, and this pins the true behaviour:
    // a primary claimant wins even when its display_order sorts it last.
    const summary = buildMarketplaceListingSummary({
      vehicle: publicVehicle(),
      imageRows: [imageRow({ url: 'https://cdn/a.jpg', order: 1 }), imageRow({ url: 'https://cdn/b.jpg', primary: true, order: 9 })],
    });
    assert.equal(summary.primary_image_url, 'https://cdn/b.jpg');
    assert.equal(summary.primary_image_state, 'seller_primary');
  });

  it('elects the first slot when NOBODY claims primacy — and SAYS SO', () => {
    // The election is unchanged (it is the same row the shipped sort picked). What changed is that
    // the payload no longer lets a key called `primary_image_url` assert a choice nobody made.
    const summary = buildMarketplaceListingSummary({
      vehicle: publicVehicle(),
      imageRows: [imageRow({ url: 'https://cdn/a.jpg', order: 5 }), imageRow({ url: 'https://cdn/b.jpg', order: 1 })],
    });
    assert.equal(summary.primary_image_url, 'https://cdn/b.jpg', 'the ELECTION must not change — cards would blank');
    assert.equal(summary.primary_image_state, 'first_published',
      'Rule 6: primacy is the seller`s choice or it does not exist. This one is ours.');
  });

  it('the DETAIL demotes a second primary claimant; nothing in the schema prevents two', async () => {
    const detail = await getMarketplaceListingDetail(projectingSupabase({
      vehicles: [publicVehicle()],
      listing_images: [imageRow({ url: 'https://cdn/p1.jpg', primary: true, order: 0 }), imageRow({ url: 'https://cdn/p2.jpg', primary: true, order: 1 })],
      vehicle_evidence: [],
    }), VIN);
    assert.deepEqual(detail.media.map((m) => m.is_primary), [true, false],
      'two "main photos" leaves the consumer to arbitrate — the shipped code published both');
  });

  it('elects nothing at all when every row is unpublishable, and counts them', () => {
    const summary = buildMarketplaceListingSummary({
      vehicle: publicVehicle(),
      imageRows: [imageRow({ url: 'data:x', primary: true }), imageRow({ url: 'blob:y', order: 1 })],
    });
    assert.equal(summary.primary_image_url, null);
    assert.equal(summary.primary_image_state, 'none');
    assert.equal(summary.primary_image_unpublishable_count, 2,
      '"none" without a count says the seller added nothing — they added two we could not render');
  });

  it('the card`s cover is the canonical block`s first item, always', () => {
    for (const rows of [
      [imageRow({ url: 'https://cdn/a.jpg', order: 3 }), imageRow({ url: 'https://cdn/b.jpg', primary: true, order: 8 })],
      [imageRow({ url: 'data:bad' }), imageRow({ url: 'https://cdn/c.jpg', order: 2 })],
      [imageRow({ url: '/rel/d.svg', order: 0 })],
      [],
    ]) {
      const summary = buildMarketplaceListingSummary({ vehicle: publicVehicle(), imageRows: rows });
      assert.equal(summary.primary_image_url, toListingMediaBlock(rows).items[0]?.url ?? null);
    }
  });
});

// ===========================================================================================
// SUITE 7 — THE E2E SPEC NO LONGER ENCODES THE DEFECT
// ===========================================================================================
describe('Phase 5 convergence — the e2e spec asserts the true behaviour', () => {

  /**
   * `web/e2e/` is in NO tsconfig `include` and is excluded from vitest, so no gate in this
   * repository executes or even type-checks that file. These assertions are the only automated
   * thing standing between it and silent drift, which is why they read the source as text.
   */
  it('no longer asserts the sentence that WAS the defect', () => {
    // Positive assertion only. `not.toContainText(...)` is the corrected form and must survive, so
    // the check is for a `toContainText` NOT preceded by `not.`.
    assert.ok(!/(?<!not\.)toContainText\(\s*\/no verified images/i.test(E2E_SPEC_CODE),
      'the e2e spec asserted "no verified images" — a correct implementation FAILS that assertion');
  });

  it('asserts the defect sentence is ABSENT from the page', () => {
    assert.match(E2E_SPEC_CODE, /not\.toContainText\(\s*\/no verified images\/i\s*\)/);
  });

  /**
   * KEPT EXACTLY AS IT WAS, AND IT IS CURRENTLY RED ON PURPOSE — Lane D disclosure.
   *
   * Rule 1b changed `LISTING_MEDIA_EMPTY_STATEMENT` (see `vehicleMediaProjection.js`): the gated
   * block a non-published listing publishes must be BYTE-IDENTICAL to the one a published-and-empty
   * listing publishes, so both carry one sentence, and that sentence may not assert whether photos
   * exist. "No photos have been added to this listing." asserted exactly that and was false for a
   * draft listing that has photographs.
   *
   * `web/**` is owned by two other lanes right now and Lane D may not edit it, so this pin is doing
   * precisely its job: it has detected a real, required, one-line drift in a file no other gate in
   * this repository executes or type-checks. THE ASSERTION IS NOT WEAKENED AND MUST NOT BE — it
   * goes green the moment the three `web/**` literals are updated:
   *
   *   web/e2e/vehicle-detail.spec.ts       const LISTING_MEDIA_EMPTY_STATEMENT = '<new>'
   *   web/src/pages/VehicleDetail.tsx      const LISTING_MEDIA_EMPTY_STATEMENT = '<new>'
   *   web/src/pages/VehicleDetail.media.test.tsx   expect(CONTRACT_LISTING_EMPTY).toBe('<new>')
   *
   * where <new> is the value of LISTING_MEDIA_EMPTY_STATEMENT printed in the failure below. The
   * .tsx one is not cosmetic: Vehicle Detail re-seals the block client-side from its OWN copy of
   * the constant, so until it is updated the browser renders the OLD sentence — the false one —
   * over a correctly gated draft listing.
   */
  it('restates the contract`s empty statement EXACTLY (this is the anti-drift pin)', () => {
    assert.ok(E2E_SPEC_CODE.includes(`const LISTING_MEDIA_EMPTY_STATEMENT = '${LISTING_MEDIA_EMPTY_STATEMENT}'`),
      'the e2e literal has drifted from LISTING_MEDIA_EMPTY_STATEMENT in vehicleMediaProjection.js. '
      + `The contract now says: '${LISTING_MEDIA_EMPTY_STATEMENT}'. Update web/e2e/vehicle-detail.spec.ts, `
      + 'web/src/pages/VehicleDetail.tsx and web/src/pages/VehicleDetail.media.test.tsx to that exact '
      + 'string. DO NOT relax this assertion: the .tsx copy is what the browser renders, so a drift '
      + 'here means the page is publishing a sentence the backend has retired.');
  });

  it('covers all THREE states, not just the two the old spec knew about', () => {
    for (const needle of ["'none'", "'not_loaded'", 'data-media-state']) {
      assert.ok(E2E_SPEC_CODE.includes(needle), `the e2e spec must branch on ${needle}`);
    }
  });

  it('KEEPS the structural half — exactly one of image/placeholder renders', () => {
    assert.match(E2E_SPEC_CODE, /expect\(hasReal \+ hasPlaceholder\)\.toBe\(1\)/,
      'the one assertion in the old test that was correct must survive verbatim');
  });
});

// ===========================================================================================
// SUITE 8 — THE DOOR THIS DEFECT COULD COME BACK THROUGH
// ===========================================================================================
describe('Phase 5 convergence — listing media stays unreachable from a browser', () => {

  /**
   * MEASURED ON STAGING (`eoyenigwevnxwwhyhaer`), and it CORRECTS the standing note.
   *
   * The record said `listing_images` is "deny-all to anon and authenticated" and that a
   * browser-direct read "returns empty WITH NO ERROR". The second half is FALSE today, and the
   * distinction matters because a silent empty set is the defect and a loud error is not:
   *
   *   has_table_privilege('anon',          'public.listing_images', 'SELECT')  ->  false
   *   has_table_privilege('authenticated', 'public.listing_images', 'SELECT')  ->  false
   *   SET LOCAL ROLE anon;          SELECT count(*) FROM listing_images  ->  ERROR 42501
   *   SET LOCAL ROLE authenticated; SELECT count(*) FROM listing_images  ->  ERROR 42501
   *
   * There is no GRANT, so RLS is never reached. PostgREST surfaces 42501 as an HTTP error with the
   * code in the body — a read that fails loudly, which `not_loaded` can represent honestly.
   *
   * That state is not an accident and not a gap: it is the applied end state of
   * `20260619201406_production_access_containment.sql`, which does
   * `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated` + `GRANT ALL TO service_role`
   * over eleven tables including `listing_images` and `vehicle_documents`. It matches the standing
   * disposition RLS_AUDIT.md records for the Phase 0 cohort. NO MIGRATION IS AUTHORED FOR IT,
   * because there is nothing to change.
   *
   * THE RESIDUAL RISK IS ONE STEP FURTHER OUT, and it is this test's whole subject. RLS-enabled-with-
   * zero-policies is the SECOND lock. Add `GRANT SELECT ON public.listing_images TO anon` without a
   * policy and the loud 42501 becomes a silent empty set — this exact defect through a new door. And
   * PostgreSQL prints the instructions for doing it, in the error itself:
   *
   *   HINT: Grant the required privileges to the current role with:
   *         GRANT SELECT ON public.listing_images TO anon;
   *
   * A migration cannot prevent a future migration. A guard can, and the realistic vector is somebody
   * following that hint in a `.sql` file, which is a thing this repository CAN see.
   */
  const MEDIA_TABLES = ['listing_images', 'vehicle_documents'];

  it('no migration grants listing media to a browser role', () => {
    const dir = `${REPO}database/migrations/`;
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    assert.ok(files.length > 0, 'migration directory not found — this guard would pass vacuously');

    const offenders = [];
    for (const file of files) {
      const sql = readFileSync(dir + file, 'utf8');
      // Strip `--` line comments so an explanatory note about the hint does not trip the guard.
      const executable = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
      for (const stmt of executable.split(';')) {
        if (!/\bGRANT\b/i.test(stmt)) continue;
        if (!/\b(anon|authenticated)\b/i.test(stmt)) continue;
        for (const table of MEDIA_TABLES) {
          if (new RegExp(`\\b${table}\\b`).test(stmt)) offenders.push(`${file}: ${stmt.trim().slice(0, 120)}`);
        }
      }
    }
    assert.deepEqual(offenders, [],
      'granting listing media to anon/authenticated converts a loud 42501 into a SILENT EMPTY SET — '
      + 'the original defect through a new door. If a browser really must read this table, it needs a '
      + 'policy in the same migration, and a deliberate entry in RLS_AUDIT.md.');
  });

  it('no client-side code QUERIES the listing-media tables', () => {
    // The backend reads them with the service-role key, which bypasses RLS. Anything in `web/src`,
    // `mobile` or `shared` runs as `anon` and could only ever get the 42501 above — which, once
    // somebody "fixes" it with the hinted GRANT, becomes the silent empty set.
    //
    // The match is on the QUERY FORM (`.from('listing_images')`), not on the table NAME. Three
    // client files legitimately NAME these tables in documentation — `ListingImage.tsx` records
    // where its media comes from, `VehicleDetail.tsx` records the defect, `types/index.ts`
    // annotates a field — and a guard that cannot tell a comment from a query would force that
    // documentation to be deleted to stay green.
    const pattern = MEDIA_TABLES.map((t) => `from\\(['"\`]${t}['"\`]\\)`).join('|');
    let hits = '';
    try {
      hits = execFileSync('git', ['grep', '-n', '-E', pattern, '--', 'web/src', 'mobile', 'shared'],
        { cwd: REPO, encoding: 'utf8' }).trim();
    } catch (error) {
      // git grep exits 1 with no output when nothing matches — that is the passing case.
      if (error.status !== 1) throw error;
    }
    assert.equal(hits, '', `client-side code must not query listing media directly:\n${hits}`);
  });
});
