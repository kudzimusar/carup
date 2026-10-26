/**
 * T11-CAP-LR01-R2 step G — the customer's CAP, composed.
 *
 * The Journey already composes the shipment, the vessel legs, the estimate, the documents and the customs status. Step G adds what the
 * customer's Car Arrival Progress page needs beyond them — specifications, the parties the paperwork names, the posting of the original
 * documents, five stages of progress, payments, the vehicle's governed photographs and the one important update — WITHOUT adding an
 * authority: every part is read from a record another layer or the ingestion owns, and the Journey stays read-only.
 *
 * What these tests hold it to:
 *
 *   1. REPORTED IS NOT OBSERVED. A "Completed" row from an external ledger stays a statement by its sender: it has no time unless one was
 *      supplied, it never becomes movement, a departure, an arrival or a customs fact, and it is never labelled as CarUp's own.
 *   2. ONE CAP, TWO ORIGINS. CarUp's own rows are DERIVED from the authority that owns each fact, appear in the SAME shape as reported
 *      rows, and exist only where that authority says the thing happened (a cargo left behind is not "loaded" by its container).
 *   3. PRIVATE. Every part is withheld — identically to a missing one — from a viewer without private access, and the vehicle's
 *      photographs are shown only to someone entitled to THAT VEHICLE, not merely to the order.
 *   4. HONEST ABSENCE. An unknown value is omitted or null, never "0", never "unknown" padding; a failed read says "unavailable",
 *      never "none", and never fails the Journey. The purchase price is never read from a listing price.
 *   5. READ-ONLY, BOUNDED, GENERIC. It writes nothing, its reads do not grow with the data, and the reusable code names no source.
 *
 * The Vezel-shaped tests feed the rows that the ingestion would INSERT (its plan, not a hand-made copy) into the read model, so the
 * ingestion and the read model cannot drift apart unnoticed. The native tests use synthetic records only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getJourney, JOURNEY_STATES } from '../services/diaspora/journeyProjectionService.js';
import {
  DISPATCH_STATUS_LABELS, PARTY_ROLES, PROGRESS_STAGES, PURCHASE_PRICE_NOT_RECORDED, composeDocumentDelivery, composeImportantUpdate,
  composeParties, composePayments, composeProgress, composeSpecifications, deriveNativeProgress, formatYearMonth, readCapRecords, sourceLabelOf,
} from '../services/diaspora/journeyCapComposition.js';
import { buildPlan, loadFacts } from '../scripts/t11-cap-r2-ingest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const OWNER = { id: 'u-owner', platformRole: 'member' };
const PARTICIPANT = { id: 'u-assigned', platformRole: 'member' };
const STRANGER = { id: 'u-stranger', platformRole: 'member' };
const ADMIN = { id: 'u-platform-admin', platformRole: 'platform_admin' };
const NOW = '2026-10-26T00:00:00Z';

const signer = { async signMany(_bucket, paths) { return new Map(paths.map((p) => [p, `https://signed.example/${encodeURIComponent(p)}?t=1`])); } };
const opts = (client, extra = {}) => ({ supabaseClient: client, governedMediaSigner: signer, now: NOW, ...extra });

// ═══════════════════════════ fixtures ═══════════════════════════

const ledgerRow = (n, stage, action, over = {}) => ({
  id: `l${n}`, import_order_id: 'o', stage_code: stage, entry_sequence: n, action_sequence: action, action_taker_reported: 'Provider', action_taker_kind: 'PROVIDER',
  action_text: `Action ${n}`, reported_status: 'COMPLETED', event_time: null, event_time_basis: null, verification_status: 'REPORTED', source_system: 'EXT',
  observed_at: '2026-10-24T23:46:01Z', metadata: { source_label: 'Partner portal' }, deleted_at: null, ...over,
});
const partyRow = (role, over = {}) => ({
  id: `p-${role}`, import_order_id: 'o', party_role: role, party_kind: 'ORGANISATION', display_name: `Name of ${role}`, address_line: null, city: null, country: null,
  phone: null, email: null, origin: 'EXTERNAL_REPORT', source_system: 'EXT', observed_at: '2026-10-24T23:46:01Z', metadata: { source_label: 'Partner portal' }, deleted_at: null, ...over,
});
const dispatchRow = (over = {}) => ({
  id: 'd1', import_order_id: 'o', recipient_party_id: null, document_types: ['bill_of_lading'], status_reported_text: null, dispatch_status: 'UNKNOWN', message_text: null,
  courier_name: null, tracking_number: null, dispatched_at: null, delivered_at: null, status_observed_at: '2026-10-24T23:46:01Z', origin: 'EXTERNAL_REPORT', source_system: 'EXT',
  metadata: { source_label: 'Partner portal' }, deleted_at: null, ...over,
});
const VEHICLE = {
  vin: 'VIN-CAP-1', make: 'Mk', model: 'Md', year: 2018, color: 'Pearl', mileage: 134741, trim: 'Grade Z', chassis_number: 'CH-1', engine_number: 'EN-1',
  drivetrain: '2WD', transmission: 'Automatic', fuel_type: 'Hybrid', passport_verified: false,
};
const obs = (key, over = {}) => ({ id: `o-${key}-${over.value_text ?? over.value_number ?? ''}`, vin: 'VIN-CAP-1', spec_key: key, verification_status: 'REPORTED', deleted_at: null, ...over });
const SPEC_OBS = [
  obs('MODEL_CODE', { value_text: 'CODE-1' }), obs('REGISTRATION_YEAR_MONTH', { value_text: '2018-12' }), obs('MANUFACTURE_YEAR_MONTH', { value_text: '2018-06' }),
  obs('ENGINE_DISPLACEMENT_CC', { value_number: 1490 }), obs('STEERING_SIDE', { value_text: 'RIGHT' }), obs('SEAT_COUNT', { value_number: 5 }),
  obs('DOOR_COUNT', { value_number: 5 }), obs('FUEL_DETAIL', { value_text: 'Hybrid (Petrol)' }),
  obs('EQUIPMENT_ITEM', { value_text: 'A/C' }), obs('EQUIPMENT_ITEM', { value_text: 'Airbag' }),
];

const withheldShape = (x) => x && x.availability === 'withheld' && typeof x.note === 'string';

// ═══════════════════════════ 1. small pure helpers ═══════════════════════════

test('G-SRC: a source\'s display name comes from the DATA; without one a row is "an external record" — never a guessed brand', () => {
  assert.equal(sourceLabelOf({ metadata: { source_label: '  Partner portal ' } }), 'Partner portal');
  assert.equal(sourceLabelOf({ metadata: { source_label: 'x'.repeat(121) } }), 'an external record', 'an over-long label was accepted');
  assert.equal(sourceLabelOf({ metadata: { source_label: 42 } }), 'an external record');
  assert.equal(sourceLabelOf({ metadata: { source_label: '   ' } }), 'an external record');
  assert.equal(sourceLabelOf({ metadata: {} }), 'an external record');
  assert.equal(sourceLabelOf(null), 'an external record');
  assert.equal(sourceLabelOf(undefined), 'an external record');
  assert.equal(sourceLabelOf({ source_system: 'CARUP', metadata: { source_label: 'Other' } }), 'CarUp', 'CarUp\'s own record was credited to a source');
  assert.equal(sourceLabelOf({ origin: 'CARUP' }), 'CarUp');
});

test('G-YM: a year/month is put in words only when it is exactly YYYY-MM; anything else is shown as recorded, never guessed', () => {
  assert.equal(formatYearMonth('2018-12'), 'December 2018');
  assert.equal(formatYearMonth('2018-01'), 'January 2018');
  assert.equal(formatYearMonth('2018-6'), '2018-6');
  assert.equal(formatYearMonth('2018-13'), '2018-13');
  assert.equal(formatYearMonth('2018-00'), '2018-00');
  assert.equal(formatYearMonth(null), '');
  assert.equal(formatYearMonth(undefined), '');
});

test('G-STAGES: the five stages are the capture\'s, in the capture\'s order', () => {
  assert.deepEqual(PROGRESS_STAGES.map((s) => s.code), ['BOOKING', 'DEPARTURE', 'BILL_OF_LADING', 'DISPATCH', 'CLEARING_DELIVERY']);
  assert.deepEqual(PROGRESS_STAGES.map((s) => s.title), ['Booking', 'Departure', 'B/L', 'Dispatch', 'Clearing & Delivery']);
  assert.deepEqual(PARTY_ROLES.map((r) => r.role), ['CONSIGNEE', 'NOTIFY_PARTY', 'DOCUMENT_DELIVERY', 'DOCUMENT_CENTRE', 'DESTINATION_AGENT']);
  assert.ok(Object.isFrozen(PROGRESS_STAGES) && Object.isFrozen(PARTY_ROLES));
});

// ═══════════════════════════ 2. specifications ═══════════════════════════

test('G-SPEC1: specifications read in the order of a vehicle sheet, each with where it came from', () => {
  const s = composeSpecifications({ vehicle: VEHICLE, specs: SPEC_OBS, externalReference: { reference: 'REF-1' }, privateAccess: true });
  assert.equal(s.availability, 'composed');
  assert.deepEqual(s.items.map((i) => i.key), ['reference', 'mileage', 'model_code', 'registration', 'manufacture', 'model_grade', 'chassis_number', 'engine_size',
    'drive', 'colour', 'steering', 'transmission', 'fuel', 'seats', 'doors', 'engine_number']);
  const by = Object.fromEntries(s.items.map((i) => [i.key, i]));
  assert.equal(by.reference.value, 'REF-1');
  assert.equal(by.mileage.value, '134,741 km');
  assert.equal(by.registration.value, 'December 2018');
  assert.equal(by.manufacture.value, 'June 2018');
  assert.equal(by.engine_size.value, '1,490 cc');
  assert.equal(by.steering.value, 'Right-hand drive');
  assert.equal(by.seats.value, '5');
  assert.equal(by.model_grade.value, 'Grade Z');
  assert.equal(by.mileage.source, 'vehicle_record');
  assert.equal(by.registration.source, 'recorded_observation');
  assert.deepEqual(s.equipment.items, ['A/C', 'Airbag']);
});

test('G-SPEC2: a recorded fuel observation wins over the vehicle record\'s coarser word, and says so', () => {
  const s = composeSpecifications({ vehicle: VEHICLE, specs: SPEC_OBS, privateAccess: true });
  const fuel = s.items.find((i) => i.key === 'fuel');
  assert.equal(fuel.value, 'Hybrid (Petrol)');
  assert.equal(fuel.source, 'recorded_observation');
  const plain = composeSpecifications({ vehicle: VEHICLE, specs: [], privateAccess: true }).items.find((i) => i.key === 'fuel');
  assert.equal(plain.value, 'Hybrid');
  assert.equal(plain.source, 'vehicle_record');
});

test('G-SPEC3: an unknown value is OMITTED — never padded with "unknown", never shown as 0', () => {
  const bare = composeSpecifications({
    vehicle: { vin: 'V', make: 'M', model: 'X', chassis_number: 'CH-ONLY', mileage: 0, trim: null, color: '', engine_number: undefined }, specs: [], privateAccess: true,
  });
  assert.deepEqual(bare.items.map((i) => i.key), ['chassis_number'], 'a value nobody recorded was shown');
  assert.ok(!/unknown|n\/a|not recorded|\b0 km/i.test(JSON.stringify(bare.items)), 'padding or a zero mileage appeared');
  assert.equal(bare.equipment, null);
});

test('G-SPEC4: nothing is called verified unless CarUp verified it — vehicle fields are "reported" until the passport is verified, observations until VERIFIED', () => {
  const unverified = composeSpecifications({ vehicle: VEHICLE, specs: SPEC_OBS, privateAccess: true });
  assert.ok(unverified.items.every((i) => i.reported === true), 'a field was presented as verified without a verification');
  assert.match(unverified.note, /not independently verified/i);

  const passportVerified = composeSpecifications({ vehicle: { ...VEHICLE, passport_verified: true }, specs: [], privateAccess: true });
  assert.ok(passportVerified.items.every((i) => i.reported === false));
  assert.equal(passportVerified.note, null, 'a note about unverified details appeared when nothing was unverified');

  const oneVerified = composeSpecifications({
    vehicle: { ...VEHICLE, passport_verified: true },
    specs: [obs('MODEL_CODE', { value_text: 'CODE-1', verification_status: 'VERIFIED' }), obs('SEAT_COUNT', { value_number: 5 })], privateAccess: true,
  });
  const by = Object.fromEntries(oneVerified.items.map((i) => [i.key, i]));
  assert.equal(by.model_code.reported, false);
  assert.equal(by.seats.reported, true);

  // Equipment counts too: verified equipment on a verified vehicle leaves nothing to caveat; one unverified item brings the caveat back.
  const equipmentVerified = composeSpecifications({
    vehicle: { ...VEHICLE, passport_verified: true }, specs: [obs('EQUIPMENT_ITEM', { value_text: 'A/C', verification_status: 'VERIFIED' })], privateAccess: true,
  });
  assert.equal(equipmentVerified.equipment.reported, false);
  assert.equal(equipmentVerified.note, null, 'a caveat about unverified details appeared with nothing unverified');
  const equipmentMixed = composeSpecifications({
    vehicle: { ...VEHICLE, passport_verified: true },
    specs: [obs('EQUIPMENT_ITEM', { value_text: 'A/C', verification_status: 'VERIFIED' }), obs('EQUIPMENT_ITEM', { value_text: 'Airbag' })], privateAccess: true,
  });
  assert.equal(equipmentMixed.equipment.reported, true);
  assert.match(equipmentMixed.note, /not independently verified/i);
});

test('G-SPEC5: a deleted observation is not shown; an unrecognised steering value is shown as recorded, never read as "left"', () => {
  const s = composeSpecifications({
    vehicle: VEHICLE,
    specs: [obs('MODEL_CODE', { value_text: 'GONE', deleted_at: '2026-10-01T00:00:00Z' }), obs('STEERING_SIDE', { value_text: 'CENTRE' }), obs('EQUIPMENT_ITEM', { value_text: 'Radio', deleted_at: '2026-10-01T00:00:00Z' })],
    privateAccess: true,
  });
  assert.ok(!s.items.some((i) => i.key === 'model_code'), 'a deleted observation was shown');
  assert.equal(s.items.find((i) => i.key === 'steering').value, 'CENTRE');
  assert.equal(s.equipment, null, 'a deleted equipment item was listed');
  const left = composeSpecifications({ vehicle: VEHICLE, specs: [obs('STEERING_SIDE', { value_text: 'LEFT' })], privateAccess: true });
  assert.equal(left.items.find((i) => i.key === 'steering').value, 'Left-hand drive');
});

test('G-SPEC6: private access only, and a missing vehicle or a failed read is said so — not hidden, not "none"', () => {
  const closed = composeSpecifications({ vehicle: VEHICLE, specs: SPEC_OBS, privateAccess: false });
  assert.ok(withheldShape(closed));
  assert.ok(!JSON.stringify(closed).includes('CH-1') && !JSON.stringify(closed).includes('Grade Z'), 'a withheld section still carried the vehicle');
  assert.equal(composeSpecifications({ vehicle: null, specs: [], privateAccess: true }).availability, 'unavailable');
  const partial = composeSpecifications({ vehicle: VEHICLE, specs: [], specsRead: false, privateAccess: true });
  assert.equal(partial.partial, true);
  assert.match(partial.read_note, /could not be read/i);
  assert.equal(composeSpecifications({ vehicle: VEHICLE, specs: [], specsRead: true, privateAccess: true }).read_note, null);
});

// ═══════════════════════════ 3. parties ═══════════════════════════

test('G-PARTY1: parties come in the paperwork\'s order, only those that exist, with their origin and their source named from the data', () => {
  const rows = [partyRow('DESTINATION_AGENT'), partyRow('CONSIGNEE', { party_kind: 'INDIVIDUAL', city: 'HARARE', country: 'Zimbabwe' }), partyRow('DOCUMENT_CENTRE', { phone: '+1 555 0100' })];
  const p = composeParties({ parties: rows, privateAccess: true });
  assert.equal(p.availability, 'composed');
  assert.deepEqual(p.items.map((i) => i.role), ['CONSIGNEE', 'DOCUMENT_CENTRE', 'DESTINATION_AGENT']);
  assert.deepEqual(p.items.map((i) => i.role_label), ['Consignee', 'Document centre', 'Agent']);
  assert.ok(p.items.every((i) => i.origin === 'external_report' && i.source_label === 'Partner portal'));
  assert.equal(p.items[1].phone, '+1 555 0100');
  assert.match(p.note, /declared, not verified/i);
  assert.match(p.note, /do not change who the buyer is/i);
});

test('G-PARTY2: origin is stated as it is — owner-declared reads "you", CarUp\'s own reads CarUp, and an unknown role or a deleted row is not shown', () => {
  const p = composeParties({
    parties: [
      partyRow('CONSIGNEE', { origin: 'OWNER_DECLARED' }), partyRow('NOTIFY_PARTY', { origin: 'CARUP' }),
      partyRow('SOMETHING_ELSE'), partyRow('DOCUMENT_DELIVERY', { deleted_at: '2026-10-01T00:00:00Z' }),
    ],
    privateAccess: true,
  });
  assert.deepEqual(p.items.map((i) => [i.role, i.origin, i.source_label]), [['CONSIGNEE', 'owner_declared', 'you'], ['NOTIFY_PARTY', 'carup', 'CarUp']]);
});

test('G-PARTY3: a party whose personal details were deliberately not stored carries only a note saying where they live', () => {
  const p = composeParties({
    parties: [partyRow('CONSIGNEE', { party_kind: 'INDIVIDUAL', metadata: { source_label: 'Partner portal', withheld_from_source_control: ['address_line', 'phone', 'email'] } })],
    privateAccess: true,
  });
  const [consignee] = p.items;
  assert.equal(consignee.address, null);
  assert.equal(consignee.phone, null);
  assert.equal(consignee.email, null);
  assert.match(consignee.note, /kept on your CarUp account/i);
  assert.equal(composeParties({ parties: [partyRow('CONSIGNEE')], privateAccess: true }).items[0].note, null);
});

test('G-PARTY4: no parties, a failed read and a viewer without private access are three different sentences', () => {
  const none = composeParties({ parties: [], privateAccess: true });
  const failed = composeParties({ parties: null, partiesRead: false, privateAccess: true });
  const closed = composeParties({ parties: [partyRow('CONSIGNEE')], privateAccess: false });
  assert.equal(none.availability, 'composed');
  assert.deepEqual(none.items, []);
  assert.match(none.note, /no parties are recorded/i);
  assert.equal(failed.availability, 'unavailable');
  assert.match(failed.note, /does not mean none are recorded/i);
  assert.ok(withheldShape(closed));
  assert.ok(!JSON.stringify(closed).includes('Name of CONSIGNEE'));
});

// ═══════════════════════════ 4. document delivery ═══════════════════════════

test('G-DELIV1: the source\'s own status phrase is kept, and no tracking number, courier or time is invented', () => {
  const rows = [partyRow('DOCUMENT_DELIVERY', { city: 'Dar es Salaam', country: 'Tanzania' }), partyRow('DOCUMENT_CENTRE', { phone: '+1 555 0100', email: 'centre@example.test' })];
  const d = composeDocumentDelivery({
    dispatches: [dispatchRow({ recipient_party_id: 'p-DOCUMENT_DELIVERY', status_reported_text: 'Arrived at delivery address', dispatch_status: 'DELIVERED', message_text: 'Message from sender.' })],
    parties: rows, privateAccess: true,
  });
  assert.equal(d.availability, 'composed');
  const [item] = d.items;
  assert.equal(item.status_reported_text, 'Arrived at delivery address');
  assert.equal(item.status, 'DELIVERED');
  assert.equal(item.status_label, DISPATCH_STATUS_LABELS.DELIVERED);
  assert.deepEqual(item.document_labels, ['Bill of lading']);
  assert.equal(item.tracking_number, null);
  assert.equal(item.courier, null);
  assert.equal(item.dispatched_at, null);
  assert.equal(item.delivered_at, null);
  assert.deepEqual(item.recipient, { role: 'DOCUMENT_DELIVERY', name: 'Name of DOCUMENT_DELIVERY', city: 'Dar es Salaam', country: 'Tanzania' });
  assert.equal(item.origin, 'external_report');
  assert.equal(item.source_label, 'Partner portal');
  assert.equal(d.contact.name, 'Name of DOCUMENT_CENTRE');
  assert.match(d.contact.note, /actual arrival date/i);
  assert.match(d.note, /as reported by the sender/i);
});

test('G-DELIV2: a date or a tracking number appears only where one was supplied; an unrecognised status is "Status not known"', () => {
  const d = composeDocumentDelivery({
    dispatches: [
      dispatchRow({ id: 'a', dispatch_status: 'IN_TRANSIT', courier_name: 'Courier', tracking_number: 'TRK123', dispatched_at: '2026-10-01T00:00:00Z' }),
      dispatchRow({ id: 'b', dispatch_status: 'SOMETHING_NEW', document_types: ['unlisted_document'] }),
      dispatchRow({ id: 'c', deleted_at: '2026-10-01T00:00:00Z' }),
    ],
    parties: [], privateAccess: true,
  });
  assert.equal(d.items.length, 2, 'a deleted dispatch was listed');
  assert.deepEqual([d.items[0].courier, d.items[0].tracking_number, d.items[0].dispatched_at], ['Courier', 'TRK123', '2026-10-01T00:00:00.000Z']);
  assert.equal(d.items[1].status_label, 'Status not known');
  assert.deepEqual(d.items[1].document_labels, ['unlisted_document']);
  assert.equal(d.contact, null);
});

test('G-DELIV3: delivery is private; none recorded, a failed read and a withheld viewer say different things', () => {
  const none = composeDocumentDelivery({ dispatches: [], parties: [], privateAccess: true });
  assert.deepEqual(none.items, []);
  assert.match(none.note, /no document dispatch is recorded/i);
  const failed = composeDocumentDelivery({ dispatches: null, dispatchesRead: false, parties: [], privateAccess: true });
  assert.equal(failed.availability, 'unavailable');
  assert.match(failed.note, /does not mean nothing was sent/i);
  assert.ok(withheldShape(composeDocumentDelivery({ dispatches: [dispatchRow()], parties: [], privateAccess: false })));
});

// ═══════════════════════════ 5. progress: reported rows ═══════════════════════════

const SHAPE = ['action_taker', 'origin', 'sequence', 'source_label', 'status', 'status_label', 'text', 'time', 'time_note', 'verification'];

test('G-PROG1: five groups in the capture\'s order; reported rows keep their sequence, their text and their sender\'s wording', () => {
  const ledger = [
    ledgerRow(2, 'BOOKING', 2, { action_text: 'Second booking action', action_taker_reported: 'Customer name', action_taker_kind: 'CUSTOMER' }),
    ledgerRow(1, 'BOOKING', 1, { action_text: 'First booking action' }),
    ledgerRow(3, 'DEPARTURE', 1),
  ];
  const p = composeProgress({ ledger, privateAccess: true });
  assert.deepEqual(p.groups.map((g) => g.code), PROGRESS_STAGES.map((s) => s.code));
  const booking = p.groups[0];
  assert.deepEqual(booking.rows.map((r) => r.text), ['First booking action', 'Second booking action'], 'rows were not in the source\'s order');
  assert.equal(booking.rows[0].action_taker.display_label, 'Provider');
  assert.equal(booking.rows[1].action_taker.display_label, 'You', 'the customer\'s own action was attributed to the customer by name, not by role');
  assert.equal(booking.reported_count, 2);
  assert.deepEqual(p.totals, { reported_rows: 3, carup_rows: 0 });
});

test('G-PROG2: a reported "Completed" has NO time unless one was supplied — and says so — and is never CarUp\'s own', () => {
  const p = composeProgress({ ledger: [ledgerRow(1, 'BOOKING', 1)], privateAccess: true });
  const [row] = p.groups[0].rows;
  assert.equal(row.status, 'completed');
  assert.equal(row.status_label, 'Completed');
  assert.equal(row.time, null, 'a completion time was invented');
  assert.match(row.time_note, /did not supply a date/i);
  assert.equal(row.origin, 'external_report');
  assert.equal(row.source_label, 'Partner portal');
  assert.equal(row.verification, 'reported');
  assert.notEqual(row.action_taker.kind, 'CARUP');
  assert.match(p.note, /sender's statement about its own work/i);
  assert.match(p.note, /not CarUp's observation/i);
});

test('G-PROG3: a time the source DID supply is shown with its stated basis, and an unknown status is not "completed"', () => {
  const p = composeProgress({
    ledger: [
      ledgerRow(1, 'BOOKING', 1, { event_time: '2026-09-01T08:00:00Z', event_time_basis: 'STATED_BY_SOURCE' }),
      ledgerRow(2, 'BOOKING', 2, { reported_status: 'IN_PROGRESS' }),
      ledgerRow(3, 'BOOKING', 3, { reported_status: 'PENDING' }),
      ledgerRow(4, 'BOOKING', 4, { reported_status: 'CANCELLED' }),
      ledgerRow(5, 'BOOKING', 5, { reported_status: 'SOMETHING_NEW' }),
      ledgerRow(6, 'BOOKING', 6, { reported_status: null }),
    ],
    privateAccess: true,
  });
  const rows = p.groups[0].rows;
  assert.deepEqual(rows[0].time, { value: '2026-09-01T08:00:00.000Z', basis: 'STATED_BY_SOURCE' });
  assert.equal(rows[0].time_note, null);
  assert.deepEqual(rows.map((r) => r.status_label), ['Completed', 'In progress', 'Pending', 'Cancelled', 'Status not known', 'Status not known']);
});

test('G-PROG4: a group is "reported completed" only when EVERY reported row is; one open row makes it "in progress"; none makes it "not recorded"', () => {
  const p = composeProgress({
    ledger: [ledgerRow(1, 'BOOKING', 1), ledgerRow(2, 'BOOKING', 2), ledgerRow(3, 'DEPARTURE', 1), ledgerRow(4, 'DEPARTURE', 2, { reported_status: 'IN_PROGRESS' })],
    privateAccess: true,
  });
  const state = Object.fromEntries(p.groups.map((g) => [g.code, g.state]));
  assert.deepEqual(state, { BOOKING: 'reported_completed', DEPARTURE: 'reported_in_progress', BILL_OF_LADING: 'not_recorded', DISPATCH: 'not_recorded', CLEARING_DELIVERY: 'not_recorded' });
  const empty = p.groups.find((g) => g.code === 'DISPATCH');
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.reported_count + empty.carup_count, 0);
});

test('G-PROG5: sources are counted per source system, each named from its data; a deleted row is not counted', () => {
  const p = composeProgress({
    ledger: [
      ledgerRow(1, 'BOOKING', 1), ledgerRow(2, 'BOOKING', 2),
      ledgerRow(3, 'DEPARTURE', 1, { source_system: 'OTHER', metadata: {} }),
      ledgerRow(4, 'DEPARTURE', 2, { deleted_at: '2026-10-01T00:00:00Z' }),
    ],
    privateAccess: true,
  });
  assert.deepEqual(p.sources.map((s) => [s.origin, s.source_label, s.row_count]), [['external_report', 'Partner portal', 2], ['external_report', 'an external record', 1]]);
  assert.equal(p.totals.reported_rows, 3);
});

test('G-PROG6: progress is private; a failed read is not "nothing has happened"; an empty ledger is not "not started"', () => {
  assert.ok(withheldShape(composeProgress({ ledger: [ledgerRow(1, 'BOOKING', 1)], privateAccess: false })));
  const failed = composeProgress({ ledger: null, ledgerRead: false, privateAccess: true });
  assert.equal(failed.availability, 'unavailable');
  assert.match(failed.note, /does not mean nothing has happened/i);
  const empty = composeProgress({ ledger: [], privateAccess: true });
  assert.equal(empty.availability, 'composed');
  assert.ok(empty.groups.every((g) => g.state === 'not_recorded'));
  assert.match(empty.note, /not the same as nothing having happened/i);
  assert.ok(!/not started|pending|in progress/i.test(empty.note));
});

// ═══════════════════════════ 6. progress: CarUp's own rows, derived ═══════════════════════════

test('G-NATIVE1: each CarUp row is derived from the authority that owns the fact, in the right stage, with that authority\'s time', () => {
  const native = deriveNativeProgress({
    movement: [{ kind: 'MOVEMENT', stage: 'BOOKED', event_time: '2026-09-01T08:00:00Z' }, { kind: 'MOVEMENT', stage: 'PLANNED', event_time: '2026-08-01T08:00:00Z' }],
    loadRecord: { confirmed_at: '2026-09-12T10:00:00Z' },
    dates: { observed_departure: '2026-09-14T00:00:00Z' },
    documents: { items: [{ document_type: 'bill_of_lading', state: 'VERIFIED', document: { reviewed_at: '2026-09-13T00:00:00Z' } }] },
    dispatches: [dispatchRow({ origin: 'CARUP', dispatched_at: '2026-09-15T00:00:00Z', delivered_at: '2026-09-20T00:00:00Z' })],
    customs: { availability: 'composed', timeline: [{ sentence: 'The goods were released by customs.', strength: 'OBSERVED', event_time: '2026-09-25T00:00:00Z' }] },
  });
  const flat = Object.fromEntries(Object.entries(native).map(([k, v]) => [k, v.map((r) => [r.text, r.time, r.strength])]));
  assert.deepEqual(flat, {
    BOOKING: [['Vessel space booked.', '2026-09-01T08:00:00.000Z', 'OBSERVED']],
    DEPARTURE: [['Loading of the cargo confirmed.', '2026-09-12T10:00:00.000Z', 'OBSERVED'], ['Departure of the vessel recorded.', '2026-09-14T00:00:00.000Z', 'OBSERVED']],
    BILL_OF_LADING: [['Bill of lading checked and verified by CarUp.', '2026-09-13T00:00:00.000Z', 'OBSERVED']],
    DISPATCH: [['Original documents dispatched.', '2026-09-15T00:00:00.000Z', 'OBSERVED'], ['Original documents delivered to the delivery address.', '2026-09-20T00:00:00.000Z', 'OBSERVED']],
    CLEARING_DELIVERY: [['The goods were released by customs.', '2026-09-25T00:00:00.000Z', 'OBSERVED']],
  });
});

test('G-NATIVE2: nothing is derived from a fact that is not recorded — a plan is not a booking, an unverified document is not a verified one', () => {
  const none = deriveNativeProgress({
    movement: [{ stage: 'PLANNED', event_time: '2026-08-01T00:00:00Z' }, { stage: 'IN_TRANSIT', event_time: '2026-08-02T00:00:00Z' }],
    loadRecord: { confirmed_at: null },
    dates: { observed_departure: null, planned_departure: '2026-09-01T00:00:00Z', estimated_arrival: '2026-10-01T00:00:00Z', observed_arrival: null },
    documents: { items: [{ document_type: 'bill_of_lading', state: 'AWAITING_REVIEW', document: { reviewed_at: null } }, { document_type: 'commercial_invoice', state: 'VERIFIED', document: { reviewed_at: '2026-09-13T00:00:00Z' } }] },
    dispatches: [dispatchRow({ origin: 'CARUP' })],
    customs: { availability: 'withheld', timeline: [{ sentence: 'x', event_time: '2026-09-25T00:00:00Z' }] },
  });
  assert.deepEqual(Object.values(none).flat(), [], `rows appeared from nothing: ${JSON.stringify(none)}`);
  assert.deepEqual(Object.keys(none), PROGRESS_STAGES.map((s) => s.code));
  assert.deepEqual(Object.values(deriveNativeProgress({})).flat(), []);
});

test('G-NATIVE3: a dispatch is CarUp\'s row only if CarUp recorded it — a sender\'s or an owner\'s statement never becomes one', () => {
  const rows = ['EXTERNAL_REPORT', 'OWNER_DECLARED', 'CARUP', null].map((origin, i) => dispatchRow({ id: `d${i}`, origin, dispatched_at: '2026-09-15T00:00:00Z' }));
  const native = deriveNativeProgress({ dispatches: rows });
  assert.equal(native.DISPATCH.length, 1);
  const deleted = deriveNativeProgress({ dispatches: [dispatchRow({ origin: 'CARUP', dispatched_at: '2026-09-15T00:00:00Z', deleted_at: '2026-09-16T00:00:00Z' })] });
  assert.deepEqual(deleted.DISPATCH, []);
});

test('G-NATIVE4: a customs event keeps the strength customs gave it — an agent\'s report is not shown as CarUp\'s own observation', () => {
  const native = deriveNativeProgress({
    customs: {
      availability: 'composed',
      timeline: [
        { sentence: 'Clearing agent reported: the declaration was lodged.', strength: 'REPORTED', event_time: '2026-09-20T00:00:00Z' },
        { sentence: 'Authority document received: an assessment was issued.', strength: 'AUTHORITY_EVIDENCE', event_time: '2026-09-21T00:00:00Z' },
        { sentence: 'Importer supplied: the assessed amount was paid.', strength: 'SUPPLIED', event_time: '2026-09-22T00:00:00Z' },
        { sentence: 'The goods were delivered.', strength: 'OBSERVED', event_time: '2026-09-23T00:00:00Z' },
        { sentence: 'A step with no strength given.', event_time: '2026-09-24T00:00:00Z' },
      ],
    },
  });
  assert.deepEqual(native.CLEARING_DELIVERY.map((r) => r.strength), ['REPORTED', 'AUTHORITY_EVIDENCE', 'SUPPLIED', 'OBSERVED', 'REPORTED'], 'a missing strength must be the weakest, not the strongest');

  const p = composeProgress({ ledger: [], native, privateAccess: true });
  const rows = p.groups.find((g) => g.code === 'CLEARING_DELIVERY').rows;
  assert.deepEqual(rows.map((r) => [r.action_taker.display_label, r.status_label]), [
    ['Reported to CarUp', 'Reported'], ['Authority document', 'Document received'], ['Supplied to CarUp', 'Supplied'], ['CarUp', 'Recorded'], ['Reported to CarUp', 'Reported'],
  ]);
  const unlabelled = composeProgress({ ledger: [], native: { CLEARING_DELIVERY: [{ text: 'No strength.', time: null }, { text: 'Odd strength.', time: null, strength: 'WHATEVER' }] }, privateAccess: true });
  const unlabelledGroup = unlabelled.groups.find((g) => g.code === 'CLEARING_DELIVERY');
  assert.deepEqual(unlabelledGroup.rows.map((r) => [r.action_taker.display_label, r.status_label]), [['Reported to CarUp', 'Reported'], ['Reported to CarUp', 'Reported']], 'an unlabelled row was taken for CarUp\'s own');
  assert.equal(unlabelledGroup.state, 'reported_to_carup');
  const agentOnly = composeProgress({ ledger: [], native: { CLEARING_DELIVERY: [{ text: 'Clearing agent reported: x', time: null, strength: 'REPORTED' }] }, privateAccess: true });
  assert.equal(agentOnly.groups.find((g) => g.code === 'CLEARING_DELIVERY').state, 'reported_to_carup', 'a group of agent reports was called CarUp-recorded');
  assert.match(agentOnly.note, /what others have told CarUp/i);
  assert.ok(!/CarUp's own records/i.test(agentOnly.note));
});

test('G-NATIVE5: CarUp\'s rows and reported rows have ONE shape — same keys, same meaning — and differ only in origin', () => {
  const native = deriveNativeProgress({ movement: [{ stage: 'BOOKED', event_time: '2026-09-01T08:00:00Z' }] });
  const p = composeProgress({ ledger: [ledgerRow(1, 'BOOKING', 1)], native, privateAccess: true });
  const [reported, recorded] = p.groups[0].rows;
  assert.deepEqual(Object.keys(reported).sort(), SHAPE);
  assert.deepEqual(Object.keys(recorded).sort(), SHAPE, 'a CarUp row is a different shape from a reported row');
  assert.deepEqual(Object.keys(reported.action_taker).sort(), Object.keys(recorded.action_taker).sort());
  assert.equal(reported.origin, 'external_report');
  assert.equal(recorded.origin, 'carup');
  assert.equal(recorded.source_label, 'CarUp');
  assert.deepEqual(recorded.time, { value: '2026-09-01T08:00:00.000Z', basis: 'CARUP_RECORDED' });
  assert.equal(recorded.status_label, 'Recorded');
  assert.equal(p.groups[0].state, 'reported_completed', 'a group with reported rows is described by them');
  assert.deepEqual(p.totals, { reported_rows: 1, carup_rows: 1 });
  assert.match(p.note, /sender's statement/i);
  assert.match(p.note, /CarUp's own records/i);
});

test('G-NATIVE6: a CarUp-only group is "carup_recorded", sorted by time, with a plain note; a row without a time says so', () => {
  const native = {
    DEPARTURE: [
      { text: 'Later', time: '2026-09-14T00:00:00Z', strength: 'OBSERVED' }, { text: 'Earlier', time: '2026-09-12T00:00:00Z', strength: 'OBSERVED' }, { text: 'Untimed', time: null, strength: 'OBSERVED' },
    ],
  };
  const p = composeProgress({ ledger: [], native, privateAccess: true });
  const g = p.groups.find((x) => x.code === 'DEPARTURE');
  assert.equal(g.state, 'carup_recorded');
  assert.deepEqual(g.rows.map((r) => r.text), ['Earlier', 'Later', 'Untimed'], 'rows were not in time order with the untimed one last');
  assert.deepEqual(g.rows.map((r) => r.sequence), [1, 2, 3]);
  const untimed = g.rows.find((r) => r.text === 'Untimed');
  assert.equal(untimed.time, null);
  assert.match(untimed.time_note, /no time is recorded/i);
  assert.equal(p.note, 'These steps are CarUp\'s own records.');
});

// ═══════════════════════════ 7. payments & the important update ═══════════════════════════

test('G-PAY1: payments are the milestones that exist; an absent amount stays absent (never 0); nothing is inferred', () => {
  const p = composePayments({
    payments: [
      { milestone_type: 'DEPOSIT', amount: '250.50', currency: 'USD', status: 'CONFIRMED', due_date: '2026-09-01', confirmed_at: '2026-09-02T00:00:00Z' },
      { milestone_type: 'BALANCE', amount: null, currency: null, status: 'PENDING' },
      { milestone_type: 'ZERO', amount: 0, currency: 'USD', status: 'WAIVED' },
      { milestone_type: 'GONE', amount: 9, currency: 'USD', status: 'PENDING', deleted_at: '2026-10-01T00:00:00Z' },
    ],
    privateAccess: true,
  });
  assert.equal(p.recorded, 3);
  assert.deepEqual(p.milestones.map((m) => m.amount), [250.5, null, 0]);
  assert.equal(p.milestones[0].confirmed_at, '2026-09-02T00:00:00.000Z');
  assert.equal(p.milestones[1].due_date, null);
  assert.match(p.disclaimer, /nothing is inferred/i);
});

test('G-PAY2: no payment is a sentence, not a zero; a failed read is not "none"; payments are private', () => {
  const none = composePayments({ payments: [], privateAccess: true });
  assert.equal(none.recorded, 0);
  assert.equal(none.note, 'No payment is recorded for this purchase.');
  assert.equal(composePayments({ payments: null, paymentsRead: false, privateAccess: true }).availability, 'unavailable');
  assert.ok(withheldShape(composePayments({ payments: [{ milestone_type: 'X', amount: 1 }], privateAccess: false })));
});

test('G-PRICE: a purchase price is "not recorded" — one frozen statement, carrying no number', () => {
  assert.deepEqual(PURCHASE_PRICE_NOT_RECORDED, { availability: 'not_recorded', note: 'No purchase price is recorded for this vehicle.' });
  assert.ok(Object.isFrozen(PURCHASE_PRICE_NOT_RECORDED));
});

test('G-UPD: the important update is a journey exception first, then the latest REAL document dispatch, otherwise nothing is manufactured', () => {
  const delivery = composeDocumentDelivery({ dispatches: [dispatchRow({ status_reported_text: 'Arrived at delivery address', message_text: 'Message.' })], parties: [], privateAccess: true });
  const both = composeImportantUpdate({ exceptions: [{ code: 'SHIPMENT_EXCEPTION', note: 'The organiser recorded an exception.', recorded_at: '2026-09-25T00:00:00Z' }], deliverySection: delivery });
  assert.equal(both.kind, 'exception');
  assert.equal(both.title, 'The organiser recorded an exception.');
  assert.equal(both.origin, 'carup');

  const dispatch = composeImportantUpdate({ exceptions: [], deliverySection: delivery });
  assert.equal(dispatch.kind, 'document_dispatch');
  assert.equal(dispatch.title, 'Documents: Arrived at delivery address');
  assert.equal(dispatch.detail, 'Message.');
  assert.equal(dispatch.origin, 'external_report');
  assert.equal(dispatch.source_label, 'Partner portal');

  const labelled = composeImportantUpdate({ deliverySection: composeDocumentDelivery({ dispatches: [dispatchRow({ dispatch_status: 'IN_TRANSIT' })], parties: [], privateAccess: true }) });
  assert.equal(labelled.title, `Documents: ${DISPATCH_STATUS_LABELS.IN_TRANSIT}`);

  assert.deepEqual(composeImportantUpdate({}), { availability: 'none', note: 'There is no update to report.' });
  const leftover = [{ status_label: 'Delivered', status_reported_text: 'SHOULD NOT SURFACE', origin: 'external_report' }];
  assert.equal(composeImportantUpdate({ deliverySection: { availability: 'withheld', items: leftover } }).availability, 'none', 'a withheld section supplied the update');
  assert.equal(composeImportantUpdate({ deliverySection: { availability: 'unavailable', items: leftover } }).availability, 'none', 'an unavailable section supplied the update');
  assert.equal(composeImportantUpdate({ deliverySection: composeDocumentDelivery({ dispatches: [], parties: [], privateAccess: true }) }).availability, 'none');
});

// ═══════════════════════════ 8. reading is guarded and independent ═══════════════════════════

test('G-READ1: every read is independent and guarded — one failing marks only itself, and none can throw', async () => {
  const gone = '2026-10-01T00:00:00Z';
  const world = createMockSupabase({
    diaspora_external_progress_entries: [ledgerRow(1, 'BOOKING', 1, { import_order_id: 'o1' }), ledgerRow(2, 'BOOKING', 2, { import_order_id: 'o1', deleted_at: gone })],
    diaspora_order_parties: [partyRow('CONSIGNEE', { import_order_id: 'o1' }), partyRow('NOTIFY_PARTY', { import_order_id: 'o1', deleted_at: gone })],
    diaspora_document_dispatches: [dispatchRow({ id: 'da', import_order_id: 'o1' }), dispatchRow({ id: 'db', import_order_id: 'o1', deleted_at: gone })],
    vehicle_specification_observations: [obs('MODEL_CODE', { id: 'sa', vin: 'V', value_text: 'A' }), obs('MODEL_CODE', { id: 'sb', vin: 'V', value_text: 'B', deleted_at: gone })],
    diaspora_payment_milestones: [
      { id: 'ma', import_order_id: 'o1', milestone_type: 'A', amount: 1, created_at: '2026-10-01T00:00:00Z', deleted_at: null },
      { id: 'mb', import_order_id: 'o1', milestone_type: 'B', amount: 2, created_at: '2026-10-02T00:00:00Z', deleted_at: gone },
    ],
  });
  const ok = await readCapRecords(world, { orderId: 'o1', vin: 'V' });
  assert.deepEqual([ok.ledger.ok, ok.parties.ok, ok.dispatches.ok, ok.specs.ok, ok.payments.ok], [true, true, true, true, true]);
  // The READER excludes deleted rows itself — the composers' own filters are a second line, not the first.
  assert.deepEqual([ok.ledger.rows.length, ok.parties.rows.length, ok.dispatches.rows.length, ok.specs.rows.length, ok.payments.rows.length], [1, 1, 1, 1, 1],
    'a deleted record was read');

  for (const table of ['diaspora_external_progress_entries', 'diaspora_order_parties', 'diaspora_document_dispatches', 'vehicle_specification_observations', 'diaspora_payment_milestones']) {
    for (const mode of ['error', 'throw']) {
      const broken = brokenClient(world, [table], mode);
      const r = await readCapRecords(broken, { orderId: 'o1', vin: 'V' });
      const failed = Object.entries(r).filter(([, v]) => v.ok === false);
      assert.equal(failed.length, 1, `${table}/${mode}: ${failed.length} reads failed`);
      assert.equal(failed[0][1].rows, null, 'a failed read returned rows');
    }
  }
});

test('G-READ2: with no vehicle identifier the specification read is not attempted at all', async () => {
  const world = createMockSupabase({});
  const seen = [];
  const spy = { from(t) { seen.push(t); return world.from(t); } };
  const r = await readCapRecords(spy, { orderId: 'o1', vin: null });
  assert.ok(!seen.includes('vehicle_specification_observations'));
  assert.deepEqual(r.specs, { ok: true, rows: [] });
});

// ═══════════════════════════ 9. THE JOURNEY: a Vezel-shaped purchase, from the ingestion's own plan ═══════════════════════════

const facts = loadFacts();
const VIN = facts.target.vin;
const ORDER = 'ord-cap';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PHOTOS = Array.from({ length: facts.media.expected_count }, (_, i) => ({ id: uuid(5000 + i), uploaded_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() }));

function brokenClient(client, tables, mode) {
  const failing = () => {
    const chain = new Proxy(() => chain, { get: (_t, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error: { message: 'boom' } }) : () => chain) });
    return chain;
  };
  return { ...client, from(t) { if (!tables.includes(t)) return client.from(t); if (mode === 'throw') throw new Error('boom'); return failing(); } };
}

/** The rows exactly as the ingestion would INSERT them, given the identifiers the database would assign. */
function tablesFromPlan() {
  const plan = buildPlan(facts, { order: { id: ORDER }, photos: PHOTOS });
  const stamp = '2026-10-26T00:00:00Z';
  // The database assigns UUIDs; a media reference needs a real opaque identity to be presentable at all.
  const TABLE_OFFSET = { diaspora_order_parties: 100, diaspora_document_dispatches: 200, diaspora_external_progress_entries: 300, vehicle_specification_observations: 400, vehicle_media_references: 500 };
  const rows = (table) => plan[table].map((r, i) => ({ id: uuid(TABLE_OFFSET[table] + i + 1), deleted_at: null, created_at: stamp, ...r }));
  const parties = rows('diaspora_order_parties');
  const dispatches = rows('diaspora_document_dispatches').map(({ recipient_party_role: role, ...r }) => ({
    ...r, recipient_party_id: parties.find((p) => p.party_role === role)?.id ?? null,
    tracking_number: null, courier_name: null, dispatched_at: null, delivered_at: null,
  }));
  return {
    diaspora_order_parties: parties,
    diaspora_document_dispatches: dispatches,
    diaspora_external_progress_entries: rows('diaspora_external_progress_entries').map((r) => ({ ...r, event_time: null, event_time_basis: null, verification_status: 'REPORTED' })),
    vehicle_specification_observations: rows('vehicle_specification_observations').map((r) => ({ ...r, verification_status: 'REPORTED' })),
    vehicle_media_references: rows('vehicle_media_references').map((r) => ({ ...r, label: null })),
    vehicle_evidence: PHOTOS.map((p, i) => ({
      id: p.id, vin: VIN, storage_bucket: 'ocr-documents', file_path: `${VIN}/photo-${i + 1}.jpg`, file_url: null, mime_type: 'image/jpeg', verification_status: 'pending',
    })),
  };
}

const orderRow = (over = {}) => ({
  id: ORDER, tenant_id: null, buyer_id: 'u-owner', created_by: 'u-owner', linked_vehicle_vin: VIN, status: 'DOCUMENTS_PENDING', origin_country: 'Japan',
  destination_country: 'Zimbabwe', deleted_at: null, created_at: '2026-10-01T00:00:00Z',
  metadata: { external_reference: { reference: facts.source.reference, system: facts.source.system } }, ...over,
});

const DOC_TYPES = ['bill_of_lading', 'commercial_invoice', 'export_certificate', 'inspection_certificate', 'insurance_certificate', 'packing_list']
  .map((code) => ({ id: `type-${code}`, code, display_name: code, verification_required: true, deleted_at: null }));

function world(over = {}) {
  const planned = over.noCap ? {} : tablesFromPlan();
  return createMockSupabase({
    vehicles: over.vehicles || [{
      vin: VIN, make: 'MakeCap', model: 'ModelCap', year: 2018, color: 'Pearl', mileage: 134741, trim: 'Grade Z', chassis_number: `CH-${VIN}`, engine_number: 'EN-CAP',
      drivetrain: '2WD', transmission: 'Automatic', fuel_type: 'Hybrid', price: 12800, currency: 'USD', passport_verified: false, owner_id: 'u-owner', current_seller_id: null,
    }],
    diaspora_import_orders: over.orders || [orderRow()],
    diaspora_import_order_participants: over.participants || [{ id: 'p1', import_order_id: ORDER, user_id: 'u-assigned', verification_status: 'active', deleted_at: null }],
    diaspora_container_shipments: over.containers || [],
    diaspora_cargo_reservations: over.reservations || [],
    diaspora_container_loads: over.loads || [],
    diaspora_container_load_items: over.items || [],
    diaspora_shipments: over.shipments || [{
      id: 'ship-cap', tenant_id: 'tenant-1', import_order_id: ORDER, container_id: null, status: 'PLANNED', carrier_name: 'Carrier', tracking_number: null,
      origin_port: 'Port A', destination_port: 'Port B', departure_date: null, estimated_arrival_date: null, actual_arrival_date: null, metadata: {}, deleted_at: null,
    }],
    diaspora_shipment_stage_events: over.events || [{ id: 'e1', shipment_id: 'ship-cap', stage: 'PLANNED', event_time: '2026-10-02T00:00:00Z', location: null, deleted_at: null }],
    diaspora_shipment_legs: [], diaspora_shipment_observations: [],
    trade_document_types: DOC_TYPES, diaspora_trade_documents: over.documents || [], diaspora_trade_document_readiness: [],
    diaspora_customs_cases: [], diaspora_customs_events: [], diaspora_customs_agent_appointments: [], diaspora_import_quotes: [],
    diaspora_payment_milestones: over.payments || [],
    ...planned,
    ...(over.tables || {}),
  });
}

const read = (who, w = world(), extra = {}) => getJourney('vehicle', VIN, who, opts(w, extra));

test('G-J1: the ingestion\'s own plan composes into five groups of 7 / 1 / 3 / 1 / 2 reported rows — every one Completed, none with an invented time', async () => {
  const j = await read(OWNER);
  const p = j.sections.progress;
  assert.equal(p.availability, 'composed');
  assert.deepEqual(p.groups.map((g) => [g.code, g.reported_count, g.carup_count, g.state]), [
    ['BOOKING', 7, 0, 'reported_completed'], ['DEPARTURE', 1, 0, 'reported_completed'], ['BILL_OF_LADING', 3, 0, 'reported_completed'],
    ['DISPATCH', 1, 0, 'reported_completed'], ['CLEARING_DELIVERY', 2, 0, 'reported_completed'],
  ]);
  const rows = p.groups.flatMap((g) => g.rows);
  assert.equal(rows.length, 14);
  assert.ok(rows.every((r) => r.status_label === 'Completed' && r.time === null && /did not supply a date/i.test(r.time_note) && r.origin === 'external_report'), 'a reported row gained a time or lost its origin');
  assert.deepEqual(rows.map((r) => r.sequence), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.equal(p.sources.length, 1);
  assert.equal(p.sources[0].row_count, 14);
  assert.equal(p.sources[0].source_label, facts.source.display_label, 'the source is named from the ingested data');
});

test('G-J2: REPORTED progress did not become movement — the shipment is still only planned, with no departure, no arrival, no customs and no new event', async () => {
  const j = await read(OWNER);
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_CREATED);
  assert.equal(j.shipping.dates.observed_departure, null);
  assert.equal(j.shipping.dates.observed_arrival, null);
  assert.deepEqual(j.timeline.map((e) => e.stage), ['PLANNED']);
  assert.ok(!j.timeline.some((e) => ['IN_TRANSIT', 'ARRIVED', 'LOADED', 'DEPARTED'].includes(e.stage)));
  assert.equal(j.sections.customs.availability, 'not_applicable');
  assert.equal(j.sections.intelligence.availability, 'composed');
  assert.equal(j.sections.progress.totals.carup_rows, 0, 'a reported stage produced a CarUp row');
  assert.deepEqual(j.exceptions, []);
});

test('G-J3: the parties are the paperwork\'s five, in order; the consignee carries a name and a city only — no street, phone or email', async () => {
  const j = await read(OWNER);
  const parties = j.contacts.parties;
  assert.equal(parties.availability, 'composed');
  assert.deepEqual(parties.items.map((i) => i.role), ['CONSIGNEE', 'NOTIFY_PARTY', 'DOCUMENT_DELIVERY', 'DOCUMENT_CENTRE', 'DESTINATION_AGENT']);
  const consignee = parties.items[0];
  assert.deepEqual([consignee.name, consignee.city, consignee.country], [facts.parties[0].display_name, facts.parties[0].city, facts.parties[0].country]);
  assert.deepEqual([consignee.address, consignee.phone, consignee.email], [null, null, null], 'the consignee\'s personal contact details were carried');
  assert.match(consignee.note, /kept on your CarUp account/i);
  assert.ok(parties.items.every((i) => i.origin === 'external_report'));
  assert.match(parties.items.find((i) => i.role === 'DESTINATION_AGENT').name, /./);
});

test('G-J4: the one document dispatch is reported in the sender\'s words, with no tracking number, courier or time', async () => {
  const j = await read(OWNER);
  const delivery = j.sections.document_delivery;
  assert.equal(delivery.items.length, 1);
  const [d] = delivery.items;
  assert.equal(d.status_reported_text, facts.dispatch.status_reported_text);
  assert.deepEqual([d.tracking_number, d.courier, d.dispatched_at, d.delivered_at], [null, null, null, null]);
  assert.equal(d.recipient.role, 'DOCUMENT_DELIVERY');
  assert.equal(d.origin, 'external_report');
  assert.ok(delivery.contact && delivery.contact.name);
  assert.equal(j.important_update.kind, 'document_dispatch');
  assert.equal(j.important_update.title, `Documents: ${facts.dispatch.status_reported_text}`);
  assert.equal(j.important_update.origin, 'external_report');
});

test('G-J5: the specifications are the vehicle record plus the thirteen recorded observations, all marked as not independently verified', async () => {
  const j = await read(OWNER);
  const s = j.asset.specifications;
  assert.equal(s.availability, 'composed');
  const by = Object.fromEntries(s.items.map((i) => [i.key, i]));
  assert.equal(by.reference.value, facts.source.reference);
  assert.deepEqual(j.asset.reference, { value: facts.source.reference }, 'the header reference is the purchase\'s own number and names no issuing system');
  assert.equal(by.mileage.value, '134,741 km');
  assert.equal(by.model_code.value, 'DAA-RU3');
  assert.equal(by.registration.value, 'December 2018');
  assert.equal(by.manufacture.value, 'June 2018');
  assert.equal(by.engine_size.value, '1,490 cc');
  assert.equal(by.steering.value, 'Right-hand drive');
  assert.equal(by.seats.value, '5');
  assert.equal(by.doors.value, '5');
  assert.equal(by.fuel.value, 'Hybrid (Petrol)');
  assert.ok(s.equipment.items.includes('A/C') && s.equipment.items.includes('Airbag'));
  assert.equal(s.equipment.items.length, facts.specifications.filter((x) => x.spec_key === 'EQUIPMENT_ITEM').length);
  assert.ok(s.items.every((i) => i.reported === true));
  assert.match(s.note, /not independently verified/i);
});

test('G-J6: the purchase price is NEVER read from a listing price — 12800 on the vehicle record does not appear anywhere', async () => {
  const j = await read(OWNER);
  assert.deepEqual(j.transaction.purchase_price, PURCHASE_PRICE_NOT_RECORDED);
  assert.ok(!/12800|12,800/.test(JSON.stringify(j)), 'a listing price leaked into the Journey');
  const zero = await read(OWNER, world({ vehicles: [{ vin: VIN, make: 'M', model: 'X', price: 0, owner_id: 'u-owner', mileage: 1 }] }));
  assert.deepEqual(zero.transaction.purchase_price, PURCHASE_PRICE_NOT_RECORDED);
});

test('G-J7: payments say none are recorded; a recorded milestone is shown as recorded and nothing else is inferred', async () => {
  const none = await read(OWNER);
  assert.equal(none.sections.payments.recorded, 0);
  assert.equal(none.sections.payments.note, 'No payment is recorded for this purchase.');
  const some = await read(OWNER, world({ payments: [{ id: 'm1', import_order_id: ORDER, milestone_type: 'DEPOSIT', amount: 100, currency: 'USD', status: 'CONFIRMED', created_at: '2026-10-02T00:00:00Z', deleted_at: null }] }));
  assert.equal(some.sections.payments.recorded, 1);
  assert.deepEqual(some.sections.payments.milestones.map((m) => [m.type, m.amount, m.currency]), [['DEPOSIT', 100, 'USD']]);
});

test('G-J8: the owner is shown the vehicle\'s fifty governed photographs, in gallery order, with the stated primary — and nothing says where they live', async () => {
  const j = await read(OWNER);
  const media = j.asset.media;
  assert.equal(media.state, 'available');
  assert.equal(media.total_count, 50);
  assert.equal(media.items.length, 50);
  assert.deepEqual(media.items.map((i) => i.gallery_rank), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal(media.items.filter((i) => i.designated_primary).length, 1);
  assert.equal(media.items.find((i) => i.designated_primary).gallery_rank, facts.media.primary_position);
  assert.ok(media.items.every((i) => /^https:\/\/signed\.example\//.test(i.view.href)));
  const noViews = JSON.stringify(media.items.map(({ view, ...rest }) => rest));
  assert.ok(!/ocr-documents|vehicle-images|storage_bucket|file_path|photo-\d+\.jpg/.test(noViews), 'where the bytes live leaked through a field');
});

test('G-J9: the vehicle route and the order route are ONE Journey — the CAP sections are identical', async () => {
  const w = world();
  const byVehicle = await getJourney('vehicle', VIN, OWNER, opts(w));
  const byOrder = await getJourney('import_order', ORDER, OWNER, opts(w));
  const strip = ({ subject, generated_at, ...rest }) => rest;
  assert.deepEqual(strip(byVehicle), strip(byOrder));
});

test('G-J10: an administrator sees what the owner sees; a platform admin\'s identity is not the vehicle\'s owner but is entitled to its photographs', async () => {
  const j = await read(ADMIN);
  assert.equal(j.viewer.kind, 'ADMIN');
  assert.equal(j.sections.progress.availability, 'composed');
  assert.equal(j.contacts.parties.availability, 'composed');
  assert.equal(j.asset.media.state, 'available');
});

// ═══════════════════════════ 10. PRIVACY ═══════════════════════════

test('G-P1: a participant — who may read the journey but is not the owner — is shown NOTHING of the CAP, in the same words as if none existed', async () => {
  const withData = await read(PARTICIPANT);
  const without = await read(PARTICIPANT, world({ noCap: true }));
  assert.equal(withData.viewer.kind, 'PARTICIPANT');
  for (const section of [withData.sections.progress, withData.sections.document_delivery, withData.sections.payments, withData.contacts.parties, withData.asset.specifications]) {
    assert.ok(withheldShape(section), `not withheld: ${JSON.stringify(section)}`);
  }
  assert.equal(withData.asset.reference, null);
  assert.ok(!('media' in withData.asset), 'a participant was shown the vehicle\'s photographs');
  assert.deepEqual(withData.sections.progress, without.sections.progress);
  assert.deepEqual(withData.sections.document_delivery, without.sections.document_delivery);
  assert.deepEqual(withData.contacts.parties, without.contacts.parties);
  assert.deepEqual(withData.asset.specifications, without.asset.specifications);
  assert.deepEqual(withData.important_update, without.important_update);
  const text = JSON.stringify(withData);
  for (const leaked of [facts.parties[0].display_name, facts.dispatch.status_reported_text, facts.progress[0].action_text, 'DAA-RU3', facts.source.reference, 'Hybrid (Petrol)']) {
    assert.ok(!text.includes(leaked), `a participant was shown: ${leaked}`);
  }
});

test('G-P2: a stranger is refused — the CAP is not a way around the order\'s own access rule', async () => {
  await assert.rejects(() => read(STRANGER), (e) => e.name === 'ForbiddenError' || /access/i.test(e.message));
});

test('G-P3: a buyer who is not the vehicle\'s owner reads the CAP but is NOT shown the owner\'s photographs', async () => {
  const w = world({ vehicles: [{ vin: VIN, make: 'M', model: 'X', year: 2018, mileage: 1, owner_id: 'u-someone-else', price: 0 }] });
  const j = await getJourney('import_order', ORDER, OWNER, opts(w));
  assert.equal(j.viewer.kind, 'OWNER');
  assert.equal(j.sections.progress.availability, 'composed');
  assert.ok(!('media' in j.asset), 'a buyer who does not own the vehicle was shown its private photographs');
});

test('G-P4: a document id is forwarded only to a viewer with private access, so the page can offer to open it — and never a storage path', async () => {
  const documents = [{
    id: 'doc-bl', import_order_id: ORDER, document_type: 'bill_of_lading', version: 1, verification_status: 'VERIFIED', uploaded_by: 'u-secret', reviewed_by: 'u-secret-reviewer',
    reviewed_at: '2026-09-13T00:00:00Z', storage_path: 'secret/path.pdf', created_at: '2026-09-02T00:00:00Z', deleted_at: null, superseded_at: null,
  }];
  const owner = await read(OWNER, world({ documents }));
  const bl = owner.sections.documents.items.find((i) => i.document_type === 'bill_of_lading');
  assert.equal(bl.document.id, 'doc-bl');
  assert.equal(bl.document.can_open, true);
  const participant = await read(PARTICIPANT, world({ documents }));
  const text = JSON.stringify(participant.sections.documents);
  assert.ok(!text.includes('doc-bl') && !text.includes('can_open'), 'a document id was forwarded to a viewer without private access');

  // A SUPPLIER with a quote on the order is admitted by T8 to the documents' states, and is a participant of the Journey — but is not the owner,
  // so is given NO id to open anything with. (The admission is T8's; the id is the Journey's, and follows private access alone.)
  const supplier = { id: 'u-supplier', platformRole: 'member' };
  const supplierWorld = world({
    documents,
    participants: [{ id: 'p-sup', import_order_id: ORDER, user_id: 'u-supplier', verification_status: 'active', deleted_at: null }],
    tables: { diaspora_import_quotes: [{ id: 'q1', import_order_id: ORDER, seller_id: 'u-supplier', deleted_at: null }] },
  });
  const viaSupplier = await getJourney('import_order', ORDER, supplier, opts(supplierWorld));
  assert.equal(viaSupplier.viewer.kind, 'PARTICIPANT');
  assert.equal(viaSupplier.sections.documents.availability, 'composed', 'the supplier was not shown the document states, so this proves nothing about ids');
  assert.equal(viaSupplier.sections.documents.items.find((i) => i.document_type === 'bill_of_lading').state, 'VERIFIED');
  assert.ok(!JSON.stringify(viaSupplier.sections.documents).includes('doc-bl') && !JSON.stringify(viaSupplier.sections.documents).includes('can_open'), 'a supplier was given a document id');
  assert.ok(withheldShape(viaSupplier.sections.progress) && withheldShape(viaSupplier.contacts.parties) && withheldShape(viaSupplier.asset.specifications), 'a supplier was given private access to the CAP');
  assert.ok(!('media' in viaSupplier.asset));

  // A tenant administrator is not given private access either.
  const tenantAdmin = { id: 'u-tenant-admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-1' };
  const viaTenant = await getJourney('import_order', ORDER, tenantAdmin, opts(world({ documents, orders: [orderRow({ tenant_id: 'tenant-1' })] })));
  assert.equal(viaTenant.viewer.kind, 'ADMIN');
  assert.ok(!JSON.stringify(viaTenant.sections.documents).includes('doc-bl') && !JSON.stringify(viaTenant.sections.documents).includes('can_open'), 'a tenant administrator was given a document id');
  assert.ok(withheldShape(viaTenant.sections.progress) && withheldShape(viaTenant.contacts.parties) && withheldShape(viaTenant.asset.specifications), 'a tenant administrator was given private access to the CAP');
  assert.ok(!('media' in viaTenant.asset));
  assert.ok(!JSON.stringify(owner).includes('secret/path.pdf') && !JSON.stringify(owner).includes('u-secret'), 'a storage path or a user id leaked');
});

// ═══════════════════════════ 11. ONE CAP, TWO ORIGINS: a CarUp-native journey ═══════════════════════════

const NATIVE_VIN = 'NATIVE-VIN-1';
function nativeWorld(over = {}) {
  return world({
    noCap: true,
    vehicles: [{ vin: NATIVE_VIN, make: 'NativeMake', model: 'NativeModel', year: 2020, mileage: 12000, owner_id: 'u-owner', price: 0, passport_verified: true, chassis_number: 'NATIVE-CH' }],
    orders: [{ id: ORDER, tenant_id: null, buyer_id: 'u-owner', created_by: 'u-owner', linked_vehicle_vin: NATIVE_VIN, status: 'SHIPPED', deleted_at: null, created_at: '2026-09-01T00:00:00Z' }],
    containers: [{ id: 'cont-n', tenant_id: null, coordinator_id: 'u-operator', status: 'SHIPPED', deleted_at: null }],
    reservations: [{ id: 'res-n', container_id: 'cont-n', import_order_id: ORDER, buyer_id: 'u-owner', created_by: 'u-owner', deleted_at: null }],
    loads: [{ id: 'load-n', container_id: 'cont-n', status: 'COMPLETED', confirmed_at: '2026-09-12T10:00:00Z', deleted_at: null }],
    items: [{ id: 'li-n', load_id: 'load-n', subject_type: 'cargo_reservation', subject_id: 'res-n', outcome: over.outcome || 'LOADED', deleted_at: null }],
    shipments: [{
      id: 'ship-n', tenant_id: null, import_order_id: ORDER, container_id: 'cont-n', status: 'SHIPPED', carrier_name: 'Carrier', tracking_number: null, origin_port: 'Port A',
      destination_port: 'Port B', departure_date: '2026-09-14T00:00:00Z', estimated_arrival_date: null, actual_arrival_date: null, metadata: {}, deleted_at: null,
    }],
    events: [{ id: 'ev1', shipment_id: 'ship-n', stage: 'BOOKED', event_time: '2026-09-01T08:00:00Z', location: 'Port A', deleted_at: null }, ...(over.events || [])],
    documents: [{
      id: 'doc-bl', import_order_id: ORDER, document_type: 'bill_of_lading', version: 1, verification_status: 'VERIFIED', reviewed_at: '2026-09-13T00:00:00Z',
      created_at: '2026-09-02T00:00:00Z', deleted_at: null, superseded_at: null,
    }],
    tables: {
      diaspora_document_dispatches: [
        dispatchRow({ id: 'dn1', import_order_id: ORDER, origin: 'CARUP', source_system: 'CARUP', dispatch_status: 'DELIVERED', dispatched_at: '2026-09-15T00:00:00Z', delivered_at: '2026-09-20T00:00:00Z', metadata: {} }),
        dispatchRow({ id: 'dn2', import_order_id: ORDER, origin: 'EXTERNAL_REPORT', dispatched_at: '2026-09-16T00:00:00Z' }),
        dispatchRow({ id: 'dn3', import_order_id: ORDER, origin: 'OWNER_DECLARED', dispatched_at: '2026-09-17T00:00:00Z' }),
      ],
    },
  });
}

test('G-N1: a native journey with NO external ledger populates the SAME progress structure from the records that own each fact', async () => {
  const j = await getJourney('import_order', ORDER, OWNER, opts(nativeWorld()));
  const p = j.sections.progress;
  assert.equal(p.availability, 'composed');
  assert.deepEqual(p.totals, { reported_rows: 0, carup_rows: 6 });
  const byCode = Object.fromEntries(p.groups.map((g) => [g.code, g]));
  assert.deepEqual(byCode.BOOKING.rows.map((r) => [r.text, r.time.value]), [['Vessel space booked.', '2026-09-01T08:00:00.000Z']]);
  assert.deepEqual(byCode.DEPARTURE.rows.map((r) => [r.text, r.time.value]), [['Loading of the cargo confirmed.', '2026-09-12T10:00:00.000Z'], ['Departure of the vessel recorded.', '2026-09-14T00:00:00.000Z']]);
  assert.deepEqual(byCode.BILL_OF_LADING.rows.map((r) => [r.text, r.time.value]), [['Bill of lading checked and verified by CarUp.', '2026-09-13T00:00:00.000Z']]);
  assert.deepEqual(byCode.DISPATCH.rows.map((r) => r.text), ['Original documents dispatched.', 'Original documents delivered to the delivery address.'], 'only the dispatch CarUp recorded became a CarUp row');
  assert.equal(byCode.CLEARING_DELIVERY.state, 'not_recorded');
  assert.deepEqual(p.groups.filter((g) => g.rows.length).map((g) => g.state), ['carup_recorded', 'carup_recorded', 'carup_recorded', 'carup_recorded']);
  assert.ok(p.groups.flatMap((g) => g.rows).every((r) => r.origin === 'carup' && r.source_label === 'CarUp' && r.status_label === 'Recorded'));
  assert.equal(p.note, 'These steps are CarUp\'s own records.');
  // …and the reported dispatches stay where they are shown with their own origin, not in the CarUp rows.
  assert.deepEqual(j.sections.document_delivery.items.map((d) => d.origin).sort(), ['carup', 'external_report', 'owner_declared']);
});

test('G-N2: a native row\'s shape is the reported row\'s — one component can draw both', async () => {
  const native = (await getJourney('import_order', ORDER, OWNER, opts(nativeWorld()))).sections.progress.groups[0].rows[0];
  const reported = (await read(OWNER)).sections.progress.groups[0].rows[0];
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reported).sort());
  assert.deepEqual(Object.keys(native.action_taker).sort(), Object.keys(reported.action_taker).sort());
});

test('G-N3: cargo that was LEFT BEHIND is not "loaded" because its container was — no loading row, no departure row, no bill-of-lading shortcut', async () => {
  const j = await getJourney('import_order', ORDER, OWNER, opts(nativeWorld({ outcome: 'LEFT_BEHIND' })));
  assert.equal(j.state, JOURNEY_STATES.LEFT_BEHIND);
  const text = JSON.stringify(j.sections.progress.groups.find((g) => g.code === 'DEPARTURE'));
  assert.ok(!/Loading of the cargo confirmed|Departure of the vessel recorded/.test(text), 'a cargo that did not travel was shown as loaded or departed');
  assert.equal(j.sections.progress.groups.find((g) => g.code === 'DEPARTURE').state, 'not_recorded');
  assert.equal(j.sections.progress.groups.find((g) => g.code === 'BOOKING').rows.length, 0, 'a shipment that is not this cargo\'s was read for its booking');
});

test('G-N4: a recorded exception outranks everything as the important update; it is CarUp\'s and is not customs', async () => {
  const events = [{ id: 'ev2', shipment_id: 'ship-n', stage: 'EXCEPTION', event_time: '2026-09-18T00:00:00Z', location: 'Port B', deleted_at: null }];
  const j = await getJourney('import_order', ORDER, OWNER, opts(nativeWorld({ events })));
  assert.equal(j.state, JOURNEY_STATES.EXCEPTION);
  assert.equal(j.important_update.kind, 'exception');
  assert.equal(j.important_update.origin, 'carup');
  assert.match(j.important_update.title, /not a customs decision/i);
});

test('G-N5: a native journey has no external source anywhere in it, and its purchase price is still not recorded', async () => {
  const j = await getJourney('import_order', ORDER, OWNER, opts(nativeWorld()));
  assert.deepEqual(j.sections.progress.sources, []);
  assert.equal(j.contacts.parties.items.length, 0);
  assert.match(j.contacts.parties.note, /no parties are recorded/i);
  assert.deepEqual(j.transaction.purchase_price, PURCHASE_PRICE_NOT_RECORDED);
  assert.equal(j.asset.reference, null);
  // The vehicle's passport is verified in this fixture, so its own fields are not "reported" — a native vehicle is not described as unverified.
  assert.ok(j.asset.specifications.items.every((i) => i.reported === false));
  assert.equal(j.asset.specifications.note, null);
});

// ═══════════════════════════ 12. FAULTS, WRITES, BOUNDS, GENERICITY ═══════════════════════════

test('G-ISO: another order\'s ledger, parties, dispatches, payments and another vehicle\'s specifications never appear on this Journey', async () => {
  const mine = tablesFromPlan();
  const theirs = {
    diaspora_external_progress_entries: [ledgerRow(901, 'BOOKING', 901, { id: 'l-other', import_order_id: 'ord-other', action_text: 'OTHER-ORDER-ACTION' })],
    diaspora_order_parties: [partyRow('CONSIGNEE', { id: 'p-other', import_order_id: 'ord-other', display_name: 'OTHER-PARTY' })],
    diaspora_document_dispatches: [dispatchRow({ id: 'd-other', import_order_id: 'ord-other', status_reported_text: 'OTHER-DISPATCH' })],
    vehicle_specification_observations: [obs('MODEL_CODE', { id: 'o-other', vin: 'VIN-OTHER', value_text: 'OTHER-CODE' })],
    diaspora_payment_milestones: [{ id: 'm-other', import_order_id: 'ord-other', milestone_type: 'OTHER-PAYMENT', amount: 999, currency: 'USD', status: 'CONFIRMED', created_at: '2026-10-02T00:00:00Z', deleted_at: null }],
  };
  const alone = await getJourney('import_order', ORDER, OWNER, opts(world()));
  const strip = ({ generated_at, ...rest }) => rest;
  // The foreign rows are placed FIRST and LAST: a read that forgot its scope would meet them before, or after, this order's own — and
  // which of two same-role records wins depends on the order they arrive in.
  for (const placement of ['first', 'last']) {
    const merged = Object.fromEntries(Object.entries({ ...mine, diaspora_payment_milestones: [] }).map(([table, rows]) => [
      table, placement === 'first' ? [...(theirs[table] || []), ...rows] : [...rows, ...(theirs[table] || [])],
    ]));
    const crowded = await getJourney('import_order', ORDER, OWNER, opts(world({ tables: merged })));
    const text = JSON.stringify(crowded);
    for (const foreign of ['OTHER-ORDER-ACTION', 'OTHER-PARTY', 'OTHER-DISPATCH', 'OTHER-CODE', 'OTHER-PAYMENT']) {
      assert.ok(!text.includes(foreign), `another order's record was shown (${placement}): ${foreign}`);
    }
    assert.deepEqual(strip(crowded), strip(alone), `the presence of another order's records changed this Journey (${placement})`);
  }
});

test('G-F3: an unexpected fault anywhere in the media step cannot fail the Journey — the rest of the CAP is still served', async () => {
  const explosive = { supabaseClient: world(), now: NOW };
  Object.defineProperty(explosive, 'governedMediaSigner', { enumerable: true, get() { throw new Error('unexpected'); } });
  const j = await getJourney('import_order', ORDER, OWNER, explosive);
  assert.equal(j.sections.progress.availability, 'composed');
  assert.equal(j.contacts.parties.availability, 'composed');
  assert.ok(!('media' in j.asset), 'a broken media step produced a media block');
});

test('G-F1: any one of the new reads failing — by error or by throw — marks only its own part "unavailable"; the Journey is still served', async () => {
  const w = world();
  const expectations = {
    diaspora_external_progress_entries: (j) => j.sections.progress.availability === 'unavailable',
    diaspora_order_parties: (j) => j.contacts.parties.availability === 'unavailable',
    diaspora_document_dispatches: (j) => j.sections.document_delivery.availability === 'unavailable' && j.important_update.availability === 'none',
    vehicle_specification_observations: (j) => j.asset.specifications.partial === true && /could not be read/i.test(j.asset.specifications.read_note),
    diaspora_payment_milestones: (j) => j.sections.payments.availability === 'unavailable',
  };
  const baseline = await getJourney('import_order', ORDER, OWNER, opts(w));
  for (const [table, check] of Object.entries(expectations)) {
    for (const mode of ['error', 'throw']) {
      const j = await getJourney('import_order', ORDER, OWNER, opts(brokenClient(w, [table], mode)));
      assert.ok(check(j), `${table}/${mode}: the failed read was not reported as unavailable`);
      assert.equal(j.state, baseline.state, `${table}/${mode}: the Journey changed`);
      assert.deepEqual(j.shipping, baseline.shipping, `${table}/${mode}: the shipment section changed`);
      assert.equal(j.sections.documents.availability, baseline.sections.documents.availability);
      // A failed read is never presented as an absence.
      assert.ok(!/no (parties|payment|document dispatch|progress)/i.test(JSON.stringify(Object.values({
        ledger: j.sections.progress, parties: j.contacts.parties, dispatch: j.sections.document_delivery, payments: j.sections.payments,
      }).filter((x) => x.availability === 'unavailable'))), `${table}/${mode}: a fault was worded as an absence`);
    }
  }
});

test('G-F2: the governed media failing — the signer throwing or the tables unreadable — never fails the Journey and never claims an empty gallery', async () => {
  const w = world();
  const throwing = { async signMany() { throw new Error('storage down'); } };
  const j1 = await getJourney('import_order', ORDER, OWNER, opts(w, { governedMediaSigner: throwing }));
  assert.equal(j1.sections.progress.availability, 'composed');
  assert.ok(!j1.asset.media || j1.asset.media.state !== 'none', 'a signing fault was presented as no photographs');
  const j2 = await getJourney('import_order', ORDER, OWNER, opts(brokenClient(w, ['vehicle_media_references'], 'throw')));
  assert.equal(j2.sections.progress.availability, 'composed');
  assert.ok(!j2.asset.media || j2.asset.media.state === 'not_loaded');
});

test('G-W1: the Journey WRITES NOTHING — proven by trap on every new table too', async () => {
  const w = world();
  const writes = [];
  const trapped = {
    ...w,
    from(table) {
      return new Proxy(w.from(table), {
        get(target, prop) {
          if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
  for (const who of [OWNER, ADMIN, PARTICIPANT]) await getJourney('vehicle', VIN, who, opts(trapped));
  await getJourney('import_order', ORDER, OWNER, opts(trapped));
  assert.deepEqual(writes, []);
});

test('G-B1: the reads are bounded — fourteen ledger rows or fourteen hundred cost the same number of queries', async () => {
  const count = async (rows) => {
    const tables = tablesFromPlan();
    const extra = Array.from({ length: rows }, (_, i) => ledgerRow(100 + i, 'BOOKING', 100 + i, { import_order_id: ORDER }));
    const w = world({ tables: { diaspora_external_progress_entries: [...tables.diaspora_external_progress_entries, ...extra] } });
    let n = 0;
    await getJourney('import_order', ORDER, OWNER, opts({ ...w, from(t) { n += 1; return w.from(t); } }));
    return n;
  };
  assert.equal(await count(0), await count(1400));
});

test('G-G1: the reusable CAP code names no vehicle, reference, carrier, port, seller or source from any real purchase', () => {
  const files = [
    'backend/services/diaspora/journeyCapComposition.js', 'backend/services/diaspora/journeyProjectionService.js',
    'backend/utils/governedVehicleMedia.js', 'backend/services/evidence/governedVehicleMediaService.js', 'backend/routes/governedMediaRoutes.js',
  ];
  const forbidden = [/RU3-?1316558/i, /CD740269/i, /GFC27/i, /LEB6736579/i, /HOEGH/i, /TRACER/i, /\bVezel\b/i, /Serena/i, /BE ?FORWARD/i, /beforward/i, /u_66cace85fad949e4/, /Kingston/i, /Kingstone/i, /Dar es Salaam/i, /Shimonoseki/i];
  const hits = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of forbidden) if (re.test(text)) hits.push(`${rel}: ${re}`);
  }
  assert.deepEqual(hits, [], `a real purchase is hard-coded into the reusable capability: ${hits.join('; ')}`);
});
