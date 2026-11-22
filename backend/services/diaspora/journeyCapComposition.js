/**
 * T11-CAP-LR01-R2 step G — THE CUSTOMER'S CAP, COMPOSED.
 *
 * The Journey projection already composes the shipment, the vessel legs, the estimate, the documents and the customs status from the
 * layers that own them. The customer's Car Arrival Progress page needs six more things, and none of them is an authority of its own:
 *
 *   specifications   the vehicle record's fields plus the observations `vehicles` has no column for
 *   parties          who the paperwork names: consignee, notify party, document delivery, document centre, agent
 *   document delivery  where the original documents were sent, and what is known about them
 *   progress         five stages, each with its action rows, from TWO origins in ONE shape (below)
 *   payments         the payment milestones that exist — and an honest sentence when none do
 *   important update the most meaningful REAL record, or nothing
 *
 * ONE CAP, TWO ORIGINS. The progress section reads reported rows (the external ledger) and CarUp-recorded rows into the same shape.
 * CarUp-recorded rows are DERIVED at read time from the authorities that already own the fact — T11 movement, T10 loading, T8 document
 * verification, document dispatches CarUp itself records, T12 customs events. They are never stored twice, so a CarUp-native shipment
 * needs no second architecture and the two origins cannot disagree. A row says which origin it came from, and an externally reported
 * "Completed" is never presented as CarUp's own observation of the vessel or the cargo.
 *
 * WHAT THIS MODULE WILL NOT DO
 *   - state a time nobody supplied (an unknown time is `null`, with a sentence that says so);
 *   - turn a reported stage into a movement fact, a customs decision or a payment;
 *   - show any of this to someone without private access to the order (it says "withheld", identically to a missing one);
 *   - fail the Journey: every read is guarded, and a failed read says "unavailable" — never "none".
 *
 * Pure composers are exported separately from the readers so each can be tested without a database.
 */

const LEDGER = 'diaspora_external_progress_entries';
const PARTIES = 'diaspora_order_parties';
const DISPATCHES = 'diaspora_document_dispatches';
const SPECS = 'vehicle_specification_observations';
const PAYMENTS = 'diaspora_payment_milestones';

export const PROGRESS_STAGES = Object.freeze([
  { code: 'BOOKING', title: 'Booking' },
  { code: 'DEPARTURE', title: 'Departure' },
  { code: 'BILL_OF_LADING', title: 'B/L' },
  { code: 'DISPATCH', title: 'Dispatch' },
  { code: 'CLEARING_DELIVERY', title: 'Clearing & Delivery' },
]);

/**
 * What a row's source is called on screen. The display name travels WITH THE DATA (`metadata.source_label`, written at ingestion), so this
 * reusable code never names any source — and a row that carries none is "an external record", never a guess at a brand.
 */
export const sourceLabelOf = (row) => {
  if (row?.source_system === 'CARUP' || row?.origin === 'CARUP') return 'CarUp';
  const label = row?.metadata?.source_label;
  return typeof label === 'string' && label.trim() && label.length <= 120 ? label.trim() : 'an external record';
};

export const DOCUMENT_LABELS = Object.freeze({
  bill_of_lading: 'Bill of lading', commercial_invoice: 'Commercial invoice', export_certificate: 'Export certificate',
  inspection_certificate: 'Inspection certificate', insurance_certificate: 'Insurance certificate', packing_list: 'Packing list',
});

export const PARTY_ROLES = Object.freeze([
  { role: 'CONSIGNEE', label: 'Consignee' },
  { role: 'NOTIFY_PARTY', label: 'Notify party' },
  { role: 'DOCUMENT_DELIVERY', label: 'Document delivery address' },
  { role: 'DOCUMENT_CENTRE', label: 'Document centre' },
  { role: 'DESTINATION_AGENT', label: 'Agent' },
]);

export const DISPATCH_STATUS_LABELS = Object.freeze({
  PREPARING: 'Being prepared', DISPATCHED: 'Dispatched', IN_TRANSIT: 'On its way', DELIVERED: 'Delivered', RETURNED: 'Returned', UNKNOWN: 'Status not known',
});

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const withheld = (note) => ({ availability: 'withheld', note });
const unavailable = (note) => ({ availability: 'unavailable', note });
const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** 'YYYY-MM' -> 'December 2018'; anything else is shown as it was recorded rather than guessed at. */
export function formatYearMonth(value) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(value ?? '');
}
const withCommas = (n) => Number(n).toLocaleString('en-US');

// ═══════════════════════════ reading ═══════════════════════════

async function guarded(run) {
  try {
    const { data, error } = await run();
    if (error) return { ok: false, rows: null };
    return { ok: true, rows: Array.isArray(data) ? data : [] };
  } catch {
    return { ok: false, rows: null };
  }
}

/** Every read is independent and guarded: one failing never hides another, and none can fail the Journey. */
export async function readCapRecords(client, { orderId, vin }) {
  const [ledger, parties, dispatches, specs, payments] = await Promise.all([
    guarded(() => client.from(LEDGER).select('*').eq('import_order_id', orderId).is('deleted_at', null).order('entry_sequence', { ascending: true })),
    guarded(() => client.from(PARTIES).select('*').eq('import_order_id', orderId).is('deleted_at', null)),
    guarded(() => client.from(DISPATCHES).select('*').eq('import_order_id', orderId).is('deleted_at', null).order('status_observed_at', { ascending: false })),
    vin ? guarded(() => client.from(SPECS).select('*').eq('vin', vin).is('deleted_at', null)) : Promise.resolve({ ok: true, rows: [] }),
    guarded(() => client.from(PAYMENTS).select('*').eq('import_order_id', orderId).is('deleted_at', null).order('created_at', { ascending: true })),
  ]);
  return { ledger, parties, dispatches, specs, payments };
}

// ═══════════════════════════ specifications ═══════════════════════════

/**
 * The vehicle's specifications in the order a buyer reads a vehicle sheet. A fact is shown if it is known and omitted if it is not — never
 * padded with "unknown". Each item says whether it comes from the vehicle record or from a recorded observation, and whether CarUp has
 * verified it; the section says so once, in words, rather than implying a check that did not happen.
 */
export function composeSpecifications({ vehicle, specs, specsRead = true, externalReference = null, privateAccess }) {
  if (!privateAccess) return withheld('The vehicle details are not available to you here.');
  if (!vehicle) return unavailable('The vehicle record could not be read, so its details are not shown.');
  const observed = (key) => (specs || []).filter((s) => s.spec_key === key && s.deleted_at == null);
  const one = (key) => observed(key)[0] || null;
  const items = [];
  const add = (key, label, value, source, reported = false, unit = null) => {
    if (value === null || value === undefined || value === '') return;
    items.push({ key, label, value: String(value), source, reported, unit });
  };
  const rep = (row) => Boolean(row) && row.verification_status !== 'VERIFIED';
  // A vehicle-record field carries no verification of its own; it counts as "recorded, not independently verified" unless CarUp has
  // verified the vehicle's passport.
  const vr = vehicle.passport_verified !== true;

  add('reference', 'Reference no.', externalReference?.reference || null, 'purchase_record', true);
  // `vehicles.mileage` is NOT NULL, so 0 is how a record says "not known" — the same way `price` 0 does. It is omitted, not shown as "0 km".
  add('mileage', 'Mileage', Number(vehicle.mileage) > 0 ? `${withCommas(vehicle.mileage)} km` : null, 'vehicle_record', vr);
  const code = one('MODEL_CODE');
  add('model_code', 'Model code', code?.value_text, 'recorded_observation', rep(code));
  const reg = one('REGISTRATION_YEAR_MONTH');
  add('registration', 'Registration', reg ? formatYearMonth(reg.value_text) : null, 'recorded_observation', rep(reg));
  const mfg = one('MANUFACTURE_YEAR_MONTH');
  add('manufacture', 'Manufactured', mfg ? formatYearMonth(mfg.value_text) : null, 'recorded_observation', rep(mfg));
  add('model_grade', 'Model grade', vehicle.trim, 'vehicle_record', vr);
  add('chassis_number', 'Chassis no.', vehicle.chassis_number, 'vehicle_record', vr);
  const cc = one('ENGINE_DISPLACEMENT_CC');
  add('engine_size', 'Engine size', cc ? `${withCommas(cc.value_number)} cc` : null, 'recorded_observation', rep(cc));
  add('drive', 'Drive', vehicle.drivetrain, 'vehicle_record', vr);
  add('colour', 'Exterior colour', vehicle.color, 'vehicle_record', vr);
  const steering = one('STEERING_SIDE');
  // Only the two known values are put in words; anything else is shown as it was recorded, never read as "left".
  const steeringWords = { RIGHT: 'Right-hand drive', LEFT: 'Left-hand drive' };
  add('steering', 'Steering', steering ? (steeringWords[steering.value_text] || steering.value_text) : null, 'recorded_observation', rep(steering));
  add('transmission', 'Transmission', vehicle.transmission, 'vehicle_record', vr);
  const fuel = one('FUEL_DETAIL');
  add('fuel', 'Fuel', fuel?.value_text || vehicle.fuel_type, fuel ? 'recorded_observation' : 'vehicle_record', fuel ? rep(fuel) : vr);
  const seats = one('SEAT_COUNT');
  add('seats', 'Seats', seats ? String(seats.value_number) : null, 'recorded_observation', rep(seats));
  const doors = one('DOOR_COUNT');
  add('doors', 'Doors', doors ? String(doors.value_number) : null, 'recorded_observation', rep(doors));
  add('engine_number', 'Engine no.', vehicle.engine_number, 'vehicle_record', vr);

  const equipment = observed('EQUIPMENT_ITEM').map((e) => e.value_text).filter(Boolean);
  const equipmentReported = equipment.length > 0 && observed('EQUIPMENT_ITEM').some(rep);
  return {
    availability: 'composed',
    items,
    equipment: equipment.length ? { items: equipment, reported: equipmentReported } : null,
    partial: !specsRead,
    note: items.some((i) => i.reported) || equipmentReported
      ? 'These details are as recorded for this purchase. CarUp has not independently verified them.'
      : null,
    read_note: specsRead ? null : 'Some recorded details could not be read right now, so this list may be incomplete.',
  };
}

// ═══════════════════════════ parties & document delivery ═══════════════════════════

const WITHHELD_NOTE = 'Contact details are kept on your CarUp account and are not repeated here.';

/** Who the paperwork names. Declared, not authoritative: this changes nothing about who the buyer is or who may act. Private access only. */
export function composeParties({ parties, partiesRead = true, privateAccess }) {
  if (!privateAccess) return withheld('The parties named on the paperwork are not available to you here.');
  if (!partiesRead) return unavailable('The parties named on the paperwork could not be read right now. That does not mean none are recorded.');
  const byRole = new Map((parties || []).filter((p) => p.deleted_at == null).map((p) => [p.party_role, p]));
  const items = PARTY_ROLES.filter((r) => byRole.has(r.role)).map((r) => {
    const p = byRole.get(r.role);
    return {
      role: r.role,
      role_label: r.label,
      kind: p.party_kind,
      name: p.display_name,
      address: p.address_line || null,
      city: p.city || null,
      country: p.country || null,
      phone: p.phone || null,
      email: p.email || null,
      origin: p.origin === 'EXTERNAL_REPORT' ? 'external_report' : p.origin === 'OWNER_DECLARED' ? 'owner_declared' : 'carup',
      source_label: p.origin === 'OWNER_DECLARED' ? 'you' : sourceLabelOf(p),
      as_of: isoOrNull(p.observed_at),
      note: p.metadata?.withheld_from_source_control ? WITHHELD_NOTE : null,
    };
  });
  return {
    availability: 'composed',
    items,
    note: items.length
      ? 'These are the parties named on the paperwork for this purchase. They are declared, not verified, and they do not change who the buyer is.'
      : 'No parties are recorded for this purchase yet.',
  };
}

/** The posting of the original documents, in the source's own words, with no tracking number or time invented. */
export function composeDocumentDelivery({ dispatches, dispatchesRead = true, parties, privateAccess }) {
  if (!privateAccess) return withheld('Document delivery details are not available to you here.');
  if (!dispatchesRead) return unavailable('Document delivery could not be read right now. That does not mean nothing was sent.');
  const partyById = new Map((parties || []).map((p) => [p.id, p]));
  const centre = (parties || []).find((p) => p.party_role === 'DOCUMENT_CENTRE' && p.deleted_at == null) || null;
  const items = (dispatches || []).filter((d) => d.deleted_at == null).map((d) => {
    const recipient = d.recipient_party_id ? partyById.get(d.recipient_party_id) : null;
    return {
      document_types: d.document_types,
      document_labels: (d.document_types || []).map((t) => DOCUMENT_LABELS[t] || t),
      status: d.dispatch_status,
      status_label: DISPATCH_STATUS_LABELS[d.dispatch_status] || 'Status not known',
      status_reported_text: d.status_reported_text || null,
      message: d.message_text || null,
      courier: d.courier_name || null,
      tracking_number: d.tracking_number || null,
      dispatched_at: isoOrNull(d.dispatched_at),
      delivered_at: isoOrNull(d.delivered_at),
      observed_at: isoOrNull(d.status_observed_at),
      recipient: recipient ? { role: recipient.party_role, name: recipient.display_name, city: recipient.city || null, country: recipient.country || null } : null,
      origin: d.origin === 'EXTERNAL_REPORT' ? 'external_report' : d.origin === 'OWNER_DECLARED' ? 'owner_declared' : 'carup',
      source_label: sourceLabelOf(d),
    };
  });
  return {
    availability: 'composed',
    items,
    contact: centre ? {
      name: centre.display_name, phone: centre.phone || null, email: centre.email || null, city: centre.city || null, country: centre.country || null,
      note: 'For the vessel\'s actual arrival date, contact this document centre.',
    } : null,
    note: items.length
      ? 'Status is as reported by the sender. A date or a tracking number appears only where one was supplied.'
      : 'No document dispatch is recorded for this purchase yet.',
  };
}

// ═══════════════════════════ progress ═══════════════════════════

/** CarUp's own rows: derived from the authorities that own each fact, never stored. A row is added only when the owning record says it happened. */
export function deriveNativeProgress({ movement = [], loadRecord = null, dates = null, documents = null, dispatches = [], customs = null }) {
  const rows = Object.fromEntries(PROGRESS_STAGES.map((s) => [s.code, []]));
  const push = (stage, text, time, source, strength = 'OBSERVED') => rows[stage].push({ text, time: isoOrNull(time), source, strength });

  const booked = (movement || []).find((e) => e.stage === 'BOOKED');
  if (booked) push('BOOKING', 'Vessel space booked.', booked.event_time, 'shipment record');
  if (loadRecord?.confirmed_at) push('DEPARTURE', 'Loading of the cargo confirmed.', loadRecord.confirmed_at, 'loading record');
  if (dates?.observed_departure) push('DEPARTURE', 'Departure of the vessel recorded.', dates.observed_departure, 'shipment record');

  const bl = (documents?.items || []).find((i) => i.document_type === 'bill_of_lading');
  if (bl?.state === 'VERIFIED') push('BILL_OF_LADING', 'Bill of lading checked and verified by CarUp.', bl.document?.reviewed_at || null, 'document review');

  // Only a dispatch CarUp itself recorded is CarUp's record. A reported dispatch is the sender's statement and an owner-declared one is the
  // owner's; both are shown in the document-delivery section with their own origin, never as a CarUp row here.
  for (const d of (dispatches || []).filter((x) => x.deleted_at == null && x.origin === 'CARUP')) {
    if (d.dispatched_at) push('DISPATCH', 'Original documents dispatched.', d.dispatched_at, 'document dispatch');
    if (d.delivered_at) push('DISPATCH', 'Original documents delivered to the delivery address.', d.delivered_at, 'document dispatch');
  }

  // Customs events keep the strength T12 gave them: its sentences already say whose claim each one is ("Clearing agent reported: …"),
  // and the row must not turn an agent's report into CarUp's own observation.
  if (customs?.availability === 'composed') {
    for (const e of customs.timeline || []) push('CLEARING_DELIVERY', e.sentence, e.event_time, 'customs record', e.strength || 'REPORTED');
  }
  return rows;
}

/** How a derived row's strength is worded. Only an OBSERVED row is CarUp's own; anything else is somebody's claim that CarUp holds. */
const NATIVE_STRENGTH = Object.freeze({
  OBSERVED: { actor: 'CarUp', kind: 'CARUP', status: 'recorded', label: 'Recorded' },
  AUTHORITY_EVIDENCE: { actor: 'Authority document', kind: 'AUTHORITY', status: 'document_received', label: 'Document received' },
  REPORTED: { actor: 'Reported to CarUp', kind: 'REPORTED', status: 'reported', label: 'Reported' },
  SUPPLIED: { actor: 'Supplied to CarUp', kind: 'SUPPLIED', status: 'supplied', label: 'Supplied' },
});

/**
 * Five stages, each with its action rows, from the reported ledger and from CarUp's own records, in one shape. A stage with no rows is
 * `not_recorded` — which is not the same as "not started": the absence of a report is not a statement about the cargo.
 */
export function composeProgress({ ledger, ledgerRead = true, native = null, privateAccess }) {
  if (!privateAccess) return withheld('The progress of this purchase is not available to you here.');
  if (!ledgerRead) return unavailable('The reported progress could not be read right now. That does not mean nothing has happened.');
  const live = (ledger || []).filter((e) => e.deleted_at == null).sort((a, b) => a.entry_sequence - b.entry_sequence);
  const nativeRows = native || Object.fromEntries(PROGRESS_STAGES.map((s) => [s.code, []]));
  const sources = new Map();
  let ownGroups = 0;

  const groups = PROGRESS_STAGES.map((stage) => {
    // `live` is already in the source's own row order (entry_sequence, unique per order), which is the order the sender showed them in.
    const reported = live.filter((e) => e.stage_code === stage.code).map((e) => {
      const src = sourceLabelOf(e);
      const s = sources.get(e.source_system) || { origin: 'external_report', source_label: src, observed_at: isoOrNull(e.observed_at), row_count: 0 };
      s.row_count += 1;
      sources.set(e.source_system, s);
      const completed = e.reported_status === 'COMPLETED';
      return {
        sequence: e.entry_sequence,
        action_taker: { label: e.action_taker_reported, kind: e.action_taker_kind, display_label: e.action_taker_kind === 'CUSTOMER' ? 'You' : e.action_taker_reported },
        text: e.action_text,
        status: String(e.reported_status || 'UNKNOWN').toLowerCase(),
        status_label: completed ? 'Completed' : e.reported_status === 'IN_PROGRESS' ? 'In progress' : e.reported_status === 'PENDING' ? 'Pending' : e.reported_status === 'CANCELLED' ? 'Cancelled' : 'Status not known',
        time: e.event_time ? { value: isoOrNull(e.event_time), basis: e.event_time_basis } : null,
        time_note: e.event_time ? null : 'The source did not supply a date for this step.',
        origin: 'external_report',
        source_label: src,
        verification: String(e.verification_status || 'REPORTED').toLowerCase(),
      };
    });
    // An unknown strength is the weakest one: a row is CarUp's own only when its owner said OBSERVED. The row's SHAPE is the reported row's.
    const nativeFor = nativeRows[stage.code] || [];
    // Timed rows in time order; a row with no time goes last (it is not "the first thing that happened").
    const byTime = (a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : b.time ? 1 : 0);
    const recorded = nativeFor.slice().sort(byTime).map((r, i) => {
      const w = NATIVE_STRENGTH[r.strength] || NATIVE_STRENGTH.REPORTED;
      return {
        sequence: i + 1,
        action_taker: { label: w.actor, kind: w.kind, display_label: w.actor },
        text: r.text,
        status: w.status,
        status_label: w.label,
        time: r.time ? { value: r.time, basis: 'CARUP_RECORDED' } : null,
        time_note: r.time ? null : 'No time is recorded for this step.',
        origin: 'carup',
        source_label: 'CarUp',
        verification: w.status,
      };
    });
    const ownRecord = nativeFor.some((r) => r.strength === 'OBSERVED' || r.strength === 'AUTHORITY_EVIDENCE');
    if (ownRecord) ownGroups += 1;
    const state = reported.length
      ? (reported.every((r) => r.status === 'completed') ? 'reported_completed' : 'reported_in_progress')
      : recorded.length ? (ownRecord ? 'carup_recorded' : 'reported_to_carup') : 'not_recorded';
    return { code: stage.code, title: stage.title, state, reported_count: reported.length, carup_count: recorded.length, rows: [...reported, ...recorded] };
  });

  const reportedTotal = groups.reduce((n, g) => n + g.reported_count, 0);
  const carupTotal = groups.reduce((n, g) => n + g.carup_count, 0);
  return {
    availability: 'composed',
    groups,
    totals: { reported_rows: reportedTotal, carup_rows: carupTotal },
    sources: [...sources.values()],
    note: [
      reportedTotal && '"Completed" on a reported step is the sender\'s statement about its own work. It is not CarUp\'s observation of the vessel or the cargo, and where no date is shown the source supplied none.',
      ownGroups && (reportedTotal ? 'Steps shown as recorded by CarUp are CarUp\'s own records.' : 'These steps are CarUp\'s own records.'),
      carupTotal && !ownGroups && 'Steps shown as reported to CarUp are what others have told CarUp, kept as reported.',
      !reportedTotal && !carupTotal && 'No progress is recorded for this purchase yet. That is not the same as nothing having happened.',
    ].filter(Boolean).join(' '),
  };
}

// ═══════════════════════════ payments ═══════════════════════════

export function composePayments({ payments, paymentsRead = true, privateAccess }) {
  if (!privateAccess) return withheld('Payment information is not available to you here.');
  if (!paymentsRead) return unavailable('Payments could not be read right now. That does not mean none are recorded.');
  const milestones = (payments || []).filter((p) => p.deleted_at == null).map((p) => ({
    type: p.milestone_type, amount: num(p.amount), currency: p.currency, status: p.status, due_date: isoOrNull(p.due_date), confirmed_at: isoOrNull(p.confirmed_at),
  }));
  return {
    availability: 'composed',
    milestones,
    recorded: milestones.length,
    note: milestones.length ? 'Payment milestones recorded for this purchase.' : 'No payment is recorded for this purchase.',
    disclaimer: 'CarUp shows a payment only where a payment milestone has been recorded. Nothing is inferred from a document, from ownership, or from a listing price.',
  };
}

export const PURCHASE_PRICE_NOT_RECORDED = Object.freeze({
  availability: 'not_recorded',
  note: 'No purchase price is recorded for this vehicle.',
});

// ═══════════════════════════ the important update ═══════════════════════════

/** The most meaningful REAL record: a journey exception first, then the latest document dispatch. Nothing is manufactured when there is neither. */
export function composeImportantUpdate({ exceptions = [], deliverySection = null }) {
  if (exceptions.length) {
    const e = exceptions[0];
    return { availability: 'composed', kind: 'exception', title: e.note, detail: null, as_of: e.recorded_at || null, origin: 'carup' };
  }
  const latest = deliverySection?.availability === 'composed' ? deliverySection.items[0] : null;
  if (latest) {
    return {
      availability: 'composed',
      kind: 'document_dispatch',
      title: `Documents: ${latest.status_reported_text || latest.status_label}`,
      detail: latest.message || null,
      as_of: latest.observed_at,
      origin: latest.origin,
      source_label: latest.source_label,
    };
  }
  return { availability: 'none', note: 'There is no update to report.' };
}
