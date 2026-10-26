/**
 * T11-CAP-LR01-R2 step F — GOVERNED VEHICLE MEDIA: the third, key-disjoint block.
 *
 * What these tests hold the block to, in the order the contract states it:
 *   1. it can never be mistaken for listing media or for evidence (zero shared key names, proved three ways);
 *   2. it exists only for people entitled to it, and is ABSENT — not empty — for everyone else;
 *   3. it never says where the bytes live or who put them there;
 *   4. it never publishes an item without a working view, and never calls a fault an absence;
 *   5. review state is the asset's own; primacy is a stated choice and is never elected;
 *   6. a window onto the gallery (a hero) keeps each photograph's absolute rank and honours the designation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESIGNATION_BASES, GOVERNED_MEDIA_EMPTY_STATEMENT, GOVERNED_MEDIA_ENVELOPE_FIELDS, GOVERNED_MEDIA_ITEM_FIELDS, GOVERNED_MEDIA_STATES,
  GOVERNED_MEDIA_VIEW_FIELDS, PRESENTABLE_REVIEW_STATUSES, canViewGovernedMedia, findGovernedMediaLeaks, findThreeBlockCrossContamination,
  selectPresentableMedia, toGovernedMediaBlock, windowPresentable,
} from '../utils/governedVehicleMedia.js';
import {
  EVIDENCE_MEDIA_ITEM_FIELDS, LISTING_MEDIA_ITEM_FIELDS, MEDIA_BLOCK_ENVELOPE_FIELDS, toListingMediaBlock, toVerifiedEvidenceBlock,
} from '../utils/vehicleMediaProjection.js';
import {
  GOVERNED_MEDIA_VIEW_TTL_SECONDS, actorForGovernedMedia, createStorageSigner, readGovernedMedia, readGovernedMediaForVehicles,
} from '../services/evidence/governedVehicleMediaService.js';

const VIN = 'RU3-1316558';
const OTHER_VIN = 'GFC27-027051';
const OWNER = 'u_owner';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ref = (n, over = {}) => ({ id: uuid(n), vin: VIN, evidence_id: uuid(1000 + n), gallery_position: n, is_primary: false, primary_basis: null, label: null, deleted_at: null, ...over });
const asset = (n, over = {}) => ({ id: uuid(1000 + n), vin: VIN, storage_bucket: 'ocr-documents', file_path: `${VIN}/import_photo_${n}.jpg`, file_url: `${VIN}/import_photo_${n}.jpg`, mime_type: 'image/jpeg', verification_status: 'pending', ...over });
const viewOf = (n) => ({ href: `https://signed.example/photo-${n}?token=abc`, expires_at: '2026-10-26T06:00:00.000Z' });
const gallery = (count, { refOver = () => ({}), assetOver = () => ({}) } = {}) => ({
  references: Array.from({ length: count }, (_, i) => ref(i + 1, refOver(i + 1))),
  evidenceRows: Array.from({ length: count }, (_, i) => asset(i + 1, assetOver(i + 1))),
  views: new Map(Array.from({ length: count }, (_, i) => [uuid(1000 + i + 1), viewOf(i + 1)])),
});
const block = (g, extra = {}) => toGovernedMediaBlock({ authorized: true, vin: VIN, ...g, ...extra });

// ═══════════════════════════ 1. DISJOINT FROM THE OTHER TWO BLOCKS ═══════════════════════════

test('G1: the item keys share NOT ONE NAME with a listing item or an evidence item', () => {
  for (const key of GOVERNED_MEDIA_ITEM_FIELDS) {
    assert.ok(!LISTING_MEDIA_ITEM_FIELDS.includes(key), `${key} is also a listing item key`);
    assert.ok(!EVIDENCE_MEDIA_ITEM_FIELDS.includes(key), `${key} is also an evidence item key`);
  }
  for (const key of GOVERNED_MEDIA_VIEW_FIELDS) {
    assert.ok(!LISTING_MEDIA_ITEM_FIELDS.includes(key) && !EVIDENCE_MEDIA_ITEM_FIELDS.includes(key), `view.${key} collides with a sibling block`);
  }
});

test('G2: a real block\'s items carry EXACTLY the declared keys, and a clean three-block body has no cross-contamination', () => {
  const b = block(gallery(3));
  for (const item of b.items) {
    assert.deepEqual(Object.keys(item).sort(), [...GOVERNED_MEDIA_ITEM_FIELDS].sort());
    assert.deepEqual(Object.keys(item.view).sort(), [...GOVERNED_MEDIA_VIEW_FIELDS].sort());
  }
  assert.deepEqual(Object.keys(b).sort(), [...GOVERNED_MEDIA_ENVELOPE_FIELDS].sort());
  const body = {
    listing_media: toListingMediaBlock([{ id: uuid(9), vin: VIN, image_url: 'https://cdn.example/a.jpg', is_primary: true, display_order: 0 }]),
    verified_evidence: toVerifiedEvidenceBlock([], { audience: 'public' }),
    governed_media: b,
  };
  assert.deepEqual(findThreeBlockCrossContamination(body), []);
});

test('G3: the cross-contamination guard catches a governed item that looks like a gallery slot or like evidence, and the reverse', () => {
  const b = block(gallery(2));
  const polluted = { ...b, items: [{ ...b.items[0], url: 'https://x/y.jpg', verification_status: 'verified' }, b.items[1]] };
  assert.deepEqual(findThreeBlockCrossContamination({ governed_media: polluted }), ['governed_media.items[0].url', 'governed_media.items[0].verification_status']);
  const listing = toListingMediaBlock([{ id: uuid(9), vin: VIN, image_url: 'https://cdn.example/a.jpg', is_primary: true, display_order: 0 }]);
  const wrong = { listing_media: { ...listing, items: [{ ...listing.items[0], gallery_item_id: uuid(1) }] } };
  assert.deepEqual(findThreeBlockCrossContamination(wrong), ['listing_media.items[0].gallery_item_id']);
});

// ═══════════════════════════ 2. AUTHORISED OR ABSENT ═══════════════════════════

test('G4: anything other than authorised === true yields NULL — not an empty block, not a count', () => {
  const g = gallery(3);
  for (const authorized of [false, undefined, null, 'true', 1, 'yes', {}]) {
    assert.equal(toGovernedMediaBlock({ authorized, vin: VIN, ...g }), null, `authorized=${JSON.stringify(authorized)}`);
  }
  assert.equal(toGovernedMediaBlock({ vin: VIN, ...g }), null);
  assert.equal(toGovernedMediaBlock(), null);
});

test('G5: who may view — the owner, a privileged role; never a stranger, an anonymous caller, an asserted identity, or "null equals null"', () => {
  assert.equal(canViewGovernedMedia({ actorId: OWNER, ownerId: OWNER }), true);
  assert.equal(canViewGovernedMedia({ actorId: 'someone', ownerId: OWNER, isPrivileged: true }), true);
  assert.equal(canViewGovernedMedia({ actorId: 'stranger', ownerId: OWNER }), false);
  assert.equal(canViewGovernedMedia({ actorId: null, ownerId: OWNER }), false);
  assert.equal(canViewGovernedMedia({ actorId: undefined, ownerId: undefined }), false);
  assert.equal(canViewGovernedMedia({ actorId: OWNER, ownerId: null }), false, 'a vehicle with no owner is not "owned" by any caller');
  assert.equal(canViewGovernedMedia({ actorId: null, ownerId: null }), false, 'null must not equal null');
  assert.equal(canViewGovernedMedia({ actorId: OWNER, ownerId: OWNER, identityAsserted: true }), false, 'a header-asserted identity buys nothing');
  assert.equal(canViewGovernedMedia({ actorId: 'admin-1', ownerId: OWNER, isPrivileged: true, identityAsserted: true }), false);
  assert.equal(canViewGovernedMedia({ actorId: OWNER, ownerId: OWNER, isPrivileged: 'yes' }), true, 'owner still qualifies');
  assert.equal(canViewGovernedMedia({ actorId: 'stranger', ownerId: OWNER, isPrivileged: 'yes' }), false, 'privilege must be exactly true');
  assert.equal(canViewGovernedMedia(), false);
});

// ═══════════════════════════ 3. NO LOCATOR ═══════════════════════════

test('G6: nothing that names where the bytes are, or who put them there, can appear anywhere in a block', () => {
  const g = gallery(4, { assetOver: () => ({ checksum: 'abc', image_hash: 'def', uploaded_by: 'u1', verified_by: 'u2', tenant_id: 't1', metadata: { a: 1 } }) });
  const b = block(g);
  assert.deepEqual(findGovernedMediaLeaks(b), []);
  const text = JSON.stringify(b);
  for (const secret of ['ocr-documents', 'import_photo_', 'storage_bucket', 'file_path', VIN, uuid(1001), 'uploaded_by', 'checksum']) {
    assert.ok(!text.includes(secret), `the block leaks ${secret}`);
  }
  assert.ok(text.includes(uuid(1)), 'the reference id is the item identity');
  assert.ok(!text.includes(uuid(1001)), 'but the evidence id never is');
  assert.deepEqual(findGovernedMediaLeaks({ items: [{ view: { href: 'x', bucket: 'ocr-documents' } }] }), ['items[0].view.bucket']);
});

// ═══════════════════════════ 4. FAULTS ARE NOT ABSENCES ═══════════════════════════

test('G7: a read that failed is NOT_LOADED — never "none"', () => {
  for (const [references, evidenceRows] of [[null, []], [[], null], [undefined, undefined], ['x', []]]) {
    const b = toGovernedMediaBlock({ authorized: true, vin: VIN, references, evidenceRows });
    assert.equal(b.state, GOVERNED_MEDIA_STATES.NOT_LOADED);
    assert.equal(b.empty_statement, null, 'a block that never looked says nothing');
    assert.deepEqual(b.items, []);
  }
});

test('G8: a vehicle with no photographs is NONE with the one honest sentence', () => {
  const b = block({ references: [], evidenceRows: [], views: new Map() });
  assert.equal(b.state, GOVERNED_MEDIA_STATES.NONE);
  assert.equal(b.empty_statement, GOVERNED_MEDIA_EMPTY_STATEMENT);
  assert.equal(b.total_count, 0);
});

test('G9: photographs that exist but cannot be shown right now are NOT_LOADED, with the count — an empty gallery would be a lie', () => {
  const b = block({ ...gallery(5), views: new Map() });
  assert.equal(b.state, GOVERNED_MEDIA_STATES.NOT_LOADED);
  assert.equal(b.total_count, 5);
  assert.equal(b.unavailable_count, 5);
  assert.deepEqual(b.items, []);
});

test('G10: an item without a usable view is counted, never emitted as a broken slot; the rest are unaffected', () => {
  const g = gallery(4);
  g.views.delete(uuid(1002));
  g.views.set(uuid(1003), { href: 'javascript:alert(1)', expires_at: null });
  g.views.set(uuid(1004), { href: 'data:image/png;base64,AAAA', expires_at: null });
  const b = block(g);
  assert.equal(b.state, GOVERNED_MEDIA_STATES.AVAILABLE);
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].gallery_rank, 1);
  assert.equal(b.unavailable_count, 3);
  assert.equal(b.total_count, 4);
});

// ═══════════════════════════ 5. WHAT COUNTS AS A PHOTOGRAPH OF THIS VEHICLE ═══════════════════════════

test('G11: only live references to images of THIS vehicle with a presentable review state are presented', () => {
  const g = gallery(9, {
    refOver: (n) => (n === 2 ? { deleted_at: '2026-10-25T00:00:00Z' } : n === 3 ? { vin: OTHER_VIN } : {}),
    assetOver: (n) => ({
      4: { vin: OTHER_VIN }, 5: { mime_type: 'application/pdf' }, 6: { verification_status: 'rejected' }, 7: { verification_status: 'superseded' },
      8: { verification_status: 'verified' }, 9: { verification_status: 'disputed' },
    }[n] || {}),
  });
  const b = block(g);
  assert.deepEqual(b.items.map((i) => i.gallery_item_id), [uuid(1), uuid(8), uuid(9)]);
  assert.deepEqual(b.items.map((i) => i.review_status), ['pending', 'verified', 'disputed'], 'review state is the asset\'s own, verbatim');
  assert.deepEqual(b.items.map((i) => i.gallery_rank), [1, 2, 3], 'ranks are dense over what is presentable');
  assert.equal(b.total_count, 3);
  assert.deepEqual(PRESENTABLE_REVIEW_STATUSES, ['pending', 'verified', 'disputed']);
});

test('G12: a missing asset, an unaddressable identity and a repeated identity are not presented', () => {
  const g = gallery(4, { refOver: (n) => (n === 2 ? { id: 'not-a-uuid' } : n === 3 ? { id: uuid(1) } : n === 4 ? { evidence_id: uuid(9999) } : {}) });
  const b = block(g);
  assert.deepEqual(b.items.map((i) => i.gallery_item_id), [uuid(1)]);
});

test('G13: gallery order follows gallery_position, then id — not the order rows arrive in', () => {
  const g = gallery(5);
  g.references.reverse();
  g.evidenceRows.reverse();
  assert.deepEqual(block(g).items.map((i) => i.gallery_item_id), [1, 2, 3, 4, 5].map(uuid));
});

test('G14: selectPresentableMedia is what the projector uses — the service and the block cannot disagree', () => {
  const g = gallery(6, { assetOver: (n) => (n % 2 ? {} : { verification_status: 'rejected' }) });
  const picked = selectPresentableMedia({ vin: VIN, references: g.references, evidenceRows: g.evidenceRows });
  assert.deepEqual(picked.map((p) => p.identity), [uuid(1), uuid(3), uuid(5)]);
  assert.deepEqual(block(g).items.map((i) => i.gallery_item_id), picked.map((p) => p.identity));
});

// ═══════════════════════════ 6. PRIMACY IS A CHOICE ═══════════════════════════

test('G15: with no designation there is NO primary — the projection never elects one', () => {
  const b = block(gallery(4));
  assert.ok(b.items.every((i) => i.designated_primary === false && i.designation_basis === null));
});

test('G16: a designation needs a stated basis; the first designated item keeps the claim and the rest are demoted', () => {
  const b = block(gallery(5, { refOver: (n) => (n === 2 ? { is_primary: true, primary_basis: 'SOURCE_FIRST_IMAGE' } : n === 4 ? { is_primary: true, primary_basis: 'OWNER_SELECTED' } : n === 5 ? { is_primary: true, primary_basis: null } : {}) }));
  assert.deepEqual(b.items.map((i) => i.designated_primary), [false, true, false, false, false]);
  assert.equal(b.items[1].designation_basis, 'SOURCE_FIRST_IMAGE');
  const bad = block(gallery(2, { refOver: (n) => (n === 1 ? { is_primary: true, primary_basis: 'ELECTED_BY_ALGORITHM' } : {}) }));
  assert.ok(bad.items.every((i) => !i.designated_primary), 'a basis outside the vocabulary designates nothing');
  assert.deepEqual(DESIGNATION_BASES, ['SOURCE_FIRST_IMAGE', 'OWNER_SELECTED', 'OPERATOR_SELECTED']);
});

test('G17: a caption is the reference\'s label, trimmed, or null', () => {
  const b = block(gallery(3, { refOver: (n) => (n === 1 ? { label: '  Front three-quarter  ' } : n === 2 ? { label: '   ' } : {}) }));
  assert.deepEqual(b.items.map((i) => i.caption), ['Front three-quarter', null, null]);
});

// ═══════════════════════════ 7. A WINDOW ONTO THE GALLERY ═══════════════════════════

test('G18: a hero (limit 1) is the DESIGNATED primary wherever it sits, with its ABSOLUTE rank', () => {
  const g = gallery(8, { refOver: (n) => (n === 5 ? { is_primary: true, primary_basis: 'OWNER_SELECTED' } : {}) });
  const b = block(g, { limit: 1 });
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].gallery_item_id, uuid(5));
  assert.equal(b.items[0].gallery_rank, 5, 'the hero is rank 5 of the gallery, not rank 1 of a window');
  assert.equal(b.total_count, 8, 'the window does not hide how many photographs exist');
});

test('G19: with no designation a hero is simply the first; a larger window keeps the designated item and the earliest others, in order', () => {
  assert.equal(block(gallery(8), { limit: 1 }).items[0].gallery_item_id, uuid(1));
  const g = gallery(8, { refOver: (n) => (n === 7 ? { is_primary: true, primary_basis: 'SOURCE_FIRST_IMAGE' } : {}) });
  const b = block(g, { limit: 3 });
  assert.deepEqual(b.items.map((i) => i.gallery_rank), [1, 2, 7]);
  assert.deepEqual(windowPresentable([1, 2, 3].map((n) => ({ ref: { is_primary: false }, rank: n })), 0), []);
  assert.deepEqual(block(gallery(3), { limit: 0 }).items, []);
  assert.equal(block(gallery(3), { limit: 0 }).state, GOVERNED_MEDIA_STATES.AVAILABLE, 'a count-only window is not a fault');
  assert.equal(block(gallery(3), { limit: 0 }).total_count, 3);
});

test('G20: blocks are immutable', () => {
  const b = block(gallery(2));
  assert.ok(Object.isFrozen(b) && Object.isFrozen(b.items) && Object.isFrozen(b.items[0]) && Object.isFrozen(b.items[0].view));
});

// ═══════════════════════════ THE SERVICE ═══════════════════════════

/** A thenable query builder over fixed rows — the shape of the Supabase client the service reads through. */
function fakeClient({ refs = [], evidence = [], failOn = null } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const filters = {};
      const q = {
        select() { return q; },
        in(col, vals) { filters.in = [col, vals]; return q; },
        is() { return q; },
        order() { return q; },
        then(resolve) {
          calls.push({ table, in: filters.in });
          if (failOn === table) return resolve({ data: null, error: { message: 'boom' } });
          const rows = table === 'vehicle_media_references' ? refs : table === 'vehicle_evidence' ? evidence : [];
          const [col, vals] = filters.in || [];
          return resolve({ data: col ? rows.filter((r) => vals.includes(r[col])) : rows, error: null });
        },
      };
      return q;
    },
  };
  return client;
}
const fakeSigner = ({ fail = false, partial = null } = {}) => {
  const calls = [];
  return {
    calls,
    async signMany(bucket, paths, ttl) {
      calls.push({ bucket, paths: [...paths], ttl });
      if (fail) throw new Error('storage down');
      const out = new Map();
      paths.forEach((p) => { if (!partial || partial(p)) out.set(p, `https://signed.example/${bucket}/${p}?ttl=${ttl}`); });
      return out;
    },
  };
};
const NOW = new Date('2026-10-26T05:00:00.000Z');
const vezelWorld = (count = 50, over = {}) => {
  const g = gallery(count, over);
  g.references[0].is_primary = true;
  g.references[0].primary_basis = 'SOURCE_FIRST_IMAGE';
  return { refs: g.references, evidence: g.evidenceRows };
};
const owner = { id: OWNER, role: 'owner' };

test('S1: an actor who may not view a vehicle gets NOTHING for it — the client is not even queried, nothing is signed', async () => {
  const client = fakeClient(vezelWorld());
  const signer = fakeSigner();
  for (const actor of [{ id: 'stranger', role: 'owner' }, { id: null }, { id: OWNER, role: 'owner', identityAsserted: true }, null, undefined]) {
    const map = await readGovernedMediaForVehicles({ client, vehicles: [{ vin: VIN, owner_id: OWNER }], actor, signer, now: NOW });
    assert.equal(map.size, 0);
    assert.equal(await readGovernedMedia({ client, vehicle: { vin: VIN, owner_id: OWNER }, actor, signer, now: NOW }), null);
  }
  assert.equal(client.calls.length, 0);
  assert.equal(signer.calls.length, 0);
});

test('S2: the owner gets the whole gallery — one signing request per bucket, the stated lifetime, an expiry the page can show', async () => {
  const client = fakeClient(vezelWorld());
  const signer = fakeSigner();
  const b = await readGovernedMedia({ client, vehicle: { vin: VIN, owner_id: OWNER }, actor: owner, signer, now: NOW });
  assert.equal(b.state, 'available');
  assert.equal(b.items.length, 50);
  assert.equal(b.total_count, 50);
  assert.equal(signer.calls.length, 1, 'fifty photographs, one request');
  assert.equal(signer.calls[0].bucket, 'ocr-documents');
  assert.equal(signer.calls[0].paths.length, 50);
  assert.equal(signer.calls[0].ttl, GOVERNED_MEDIA_VIEW_TTL_SECONDS);
  assert.equal(b.items[0].view.expires_at, new Date(NOW.getTime() + GOVERNED_MEDIA_VIEW_TTL_SECONDS * 1000).toISOString());
  assert.equal(b.items[0].designated_primary, true);
  assert.equal(b.items[0].designation_basis, 'SOURCE_FIRST_IMAGE');
  assert.deepEqual(findGovernedMediaLeaks(b), []);
  // A signed view INEVITABLY contains its object's name — that is what makes it a short-lived capability, and the evidence route
  // returns the same. What must never happen is that any FIELD names where the bytes are kept: with the views set aside,
  // nothing else in the block carries the bucket or the object path.
  const withoutViews = JSON.stringify(b, (key, value) => (key === 'href' ? '[view]' : value));
  assert.ok(!withoutViews.includes('ocr-documents') && !withoutViews.includes('import_photo_'));
});

test('S3: a privileged role may view a vehicle it does not own; a stranger may not', async () => {
  const client = fakeClient(vezelWorld(3));
  const signer = fakeSigner();
  const admin = await readGovernedMedia({ client, vehicle: { vin: VIN, owner_id: OWNER }, actor: { id: 'adm', role: 'admin' }, signer, now: NOW });
  assert.equal(admin.items.length, 3);
  const gov = await readGovernedMedia({ client, vehicle: { vin: VIN, owner_id: OWNER }, actor: { id: 'gov', role: 'government' }, signer, now: NOW });
  assert.equal(gov.items.length, 3);
  assert.equal(await readGovernedMedia({ client, vehicle: { vin: VIN, owner_id: OWNER }, actor: { id: 'dealer', role: 'dealer' }, signer, now: NOW }), null);
});

test('S4: a garage list asks for each vehicle\'s hero — only the hero is signed, only vehicles the actor may view appear', async () => {
  const world = vezelWorld(50);
  const serenaRefs = [ref(1, { id: uuid(500), vin: OTHER_VIN, evidence_id: uuid(2500) })];
  const serenaEv = [asset(1, { id: uuid(2500), vin: OTHER_VIN })];
  const client = fakeClient({ refs: [...world.refs, ...serenaRefs], evidence: [...world.evidence, ...serenaEv] });
  const signer = fakeSigner();
  const vehicles = [{ vin: VIN, owner_id: OWNER }, { vin: OTHER_VIN, owner_id: 'someone-else' }];
  const map = await readGovernedMediaForVehicles({ client, vehicles, actor: owner, signer, limit: 1, now: NOW });
  assert.deepEqual([...map.keys()], [VIN], 'the Serena is not this actor\'s to see');
  assert.equal(map.get(VIN).items.length, 1);
  assert.equal(map.get(VIN).total_count, 50);
  assert.equal(signer.calls.length, 1);
  assert.equal(signer.calls[0].paths.length, 1, 'only the hero was signed');
  assert.ok(!JSON.stringify([...map.values()]).includes(String(uuid(500))), 'the other vehicle\'s reference never reached the output');
});

test('S5: reads are chunked so a long gallery does not build an over-long query', async () => {
  const client = fakeClient(vezelWorld(120));
  await readGovernedMedia({ client, vehicle: { vin: VIN, owner_id: OWNER }, actor: owner, signer: fakeSigner(), now: NOW });
  const evidenceCalls = client.calls.filter((c) => c.table === 'vehicle_evidence');
  assert.equal(evidenceCalls.length, 3);
  assert.ok(evidenceCalls.every((c) => c.in[1].length <= 50));
});

test('S6: a failed read — of references or of evidence — is NOT_LOADED, and nothing is signed', async () => {
  for (const failOn of ['vehicle_media_references', 'vehicle_evidence']) {
    const signer = fakeSigner();
    const b = await readGovernedMedia({ client: fakeClient({ ...vezelWorld(3), failOn }), vehicle: { vin: VIN, owner_id: OWNER }, actor: owner, signer, now: NOW });
    assert.equal(b.state, 'not_loaded', failOn);
    assert.equal(b.empty_statement, null);
    assert.equal(signer.calls.length, 0);
  }
  const thrown = fakeClient(vezelWorld(3));
  thrown.from = () => { throw new Error('connection reset'); };
  assert.equal((await readGovernedMedia({ client: thrown, vehicle: { vin: VIN, owner_id: OWNER }, actor: owner, signer: fakeSigner(), now: NOW })).state, 'not_loaded');
});

test('S7: a signing outage is NOT_LOADED (a fault, not an empty gallery); a partial one counts the missing photographs', async () => {
  const down = await readGovernedMedia({ client: fakeClient(vezelWorld(5)), vehicle: { vin: VIN, owner_id: OWNER }, actor: owner, signer: fakeSigner({ fail: true }), now: NOW });
  assert.equal(down.state, 'not_loaded');
  assert.equal(down.total_count, 5);
  const partial = await readGovernedMedia({ client: fakeClient(vezelWorld(5)), vehicle: { vin: VIN, owner_id: OWNER }, actor: owner, signer: fakeSigner({ partial: (p) => !p.endsWith('_2.jpg') && !p.endsWith('_4.jpg') }), now: NOW });
  assert.equal(partial.state, 'available');
  assert.equal(partial.items.length, 3);
  assert.equal(partial.unavailable_count, 2);
});

test('S8: a photograph kept in the public bucket under a real https URL is viewed there, unsigned; a non-https URL is never used as a view', async () => {
  const world = vezelWorld(2, { assetOver: (n) => (n === 1 ? { storage_bucket: 'vehicle-images', file_url: 'https://cdn.example/a.jpg' } : { storage_bucket: 'vehicle-images', file_url: '/uat/owner/x.svg', file_path: 'qa/x.svg' }) });
  const signer = fakeSigner();
  const b = await readGovernedMedia({ client: fakeClient(world), vehicle: { vin: VIN, owner_id: OWNER }, actor: owner, signer, now: NOW });
  assert.equal(b.items[0].view.href, 'https://cdn.example/a.jpg');
  assert.equal(b.items[0].view.expires_at, null);
  assert.deepEqual(signer.calls.map((c) => c.bucket), ['vehicle-images'], 'the second is signed as a stored object, never shown by its dangling site-relative path');
});

test('S9: rows the client returns for the wrong vehicle are ignored (a mis-scoped read cannot leak another vehicle\'s photographs)', async () => {
  const world = vezelWorld(2);
  world.refs.push(ref(3, { vin: OTHER_VIN, evidence_id: uuid(1003) }));
  world.evidence.push(asset(3, { vin: OTHER_VIN }));
  const b = await readGovernedMedia({ client: fakeClient(world), vehicle: { vin: VIN, owner_id: OWNER }, actor: owner, signer: fakeSigner(), now: NOW });
  assert.equal(b.items.length, 2);
});

test('S10: the storage signer batches by bucket, keeps only well-formed results, and signs nothing on error', async () => {
  const calls = [];
  const storage = (result) => ({ storage: { from: (bucket) => ({ createSignedUrls: async (paths, ttl) => { calls.push({ bucket, paths, ttl }); return result; } }) } });
  const ok = await createStorageSigner(storage({ data: [{ path: 'a', signedUrl: 'https://s/a', error: null }, { path: 'b', signedUrl: null, error: 'nope' }, { path: 'c', signedUrl: 'https://s/c' }], error: null })).signMany('ocr-documents', ['a', 'b', 'c'], 60);
  assert.deepEqual([...ok.entries()], [['a', 'https://s/a'], ['c', 'https://s/c']]);
  assert.deepEqual(calls[0], { bucket: 'ocr-documents', paths: ['a', 'b', 'c'], ttl: 60 });
  assert.equal((await createStorageSigner(storage({ data: null, error: { message: 'x' } })).signMany('b', ['a'], 60)).size, 0);
  assert.equal((await createStorageSigner(storage({ data: null, error: null })).signMany('b', ['a'], 60)).size, 0);
  assert.equal((await createStorageSigner(storage({ data: [], error: null })).signMany('b', [], 60)).size, 0);
  assert.equal(calls.length, 3, 'an empty path list makes no request');
});

test('S11: the actor is taken from the context the auth middleware publishes — and an asserted identity is carried through as asserted', () => {
  assert.deepEqual(actorForGovernedMedia({ id: 'u1', role: 'owner', identityAsserted: true, x: 1 }), { id: 'u1', role: 'owner', identityAsserted: true });
  assert.deepEqual(actorForGovernedMedia({ id: 'u1', role: 'owner' }), { id: 'u1', role: 'owner', identityAsserted: false });
  assert.deepEqual(actorForGovernedMedia(null), { id: null, role: null, identityAsserted: false });
});
