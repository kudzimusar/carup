/**
 * Trade OS T9.2 — the governed warehouse intake service.
 *
 * T9.1 created the authority (three tables, FORCE RLS, anon/authenticated revoked). This is the only
 * way to write it. A browser cannot reach those tables at all, so every fact below — who received
 * cargo, when, in what condition, and how big it actually turned out to be — is established here or
 * not at all.
 *
 * The boundary the whole phase exists to hold:
 *
 *     ESTIMATED (what the customer said)  ≠  ACTUAL (what the warehouse observed)
 *
 * The estimate lives on `diaspora_cargo_reservations.estimated_volume` and
 * `diaspora_logistics_request_items.estimated_volume_cbm`. **This service never writes either.** It
 * reads them to state a difference, and the difference is a FACT, not a decision: T9 may say "the
 * cargo is 0.8 CBM larger than booked" and may never say "so that costs $60". Pricing is T6's,
 * loading is T10's, and the capacity ledger is T5's.
 *
 * Three refusals are load-bearing and each is mutation-tested:
 *
 *   1. A customer cannot mark their own cargo received. Receiving authority is derived from the
 *      WAREHOUSE, never from the cargo, and the cargo's owner is refused outright.
 *   2. `received_by` and `received_at` are never taken from the request body's claim of who acted.
 *   3. Nothing here writes the T5 capacity ledger or the customer's estimate.
 */
import { randomUUID } from 'node:crypto';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from './diasporaAuthorization.js';
import { resolveClient, appendCriticalAudit, appendBestEffortAudit, paging } from './diasporaServiceUtils.js';
import { canReceiveAtWarehouse } from './warehouseAuthority.js';
import {
  notifyCargoReceived,
  notifyConditionIssue,
  notifyMeasurementDiscrepancy,
} from './warehouseIntakeNotifier.js';

const WAREHOUSES = 'diaspora_warehouses';
const INTAKES = 'diaspora_warehouse_intakes';
const MEASUREMENTS = 'diaspora_warehouse_measurements';
const RESERVATIONS = 'diaspora_cargo_reservations';
const REQUESTS = 'diaspora_logistics_requests';
const REQUEST_ITEMS = 'diaspora_logistics_request_items';

/** What a warehouse intake may be about. Matches the migration's CHECK exactly. */
export const INTAKE_SUBJECTS = Object.freeze(['cargo_reservation', 'logistics_request']);

export const INTAKE_STATUSES = Object.freeze({
  EXPECTED: 'EXPECTED',
  RECEIVED: 'RECEIVED',
  CONDITIONALLY_RECEIVED: 'CONDITIONALLY_RECEIVED',
  REFUSED: 'REFUSED',
});

/**
 * The receiver's bounded vocabulary of what they SAW. Not broadened casually, and never derived from
 * an image, a filename or an OCR result: an AI suggestion is a suggestion, and a recorded condition
 * is a person saying "I looked at this and this is what it was like".
 */
export const INTAKE_CONDITIONS = Object.freeze(['good', 'minor_damage', 'major_damage', 'incomplete', 'unverifiable']);

const MEASUREMENT_METHODS = Object.freeze(['manual', 'scale', 'dimensioner', 'estimated_by_staff']);
const DIMENSION_UNITS = Object.freeze(['cm', 'm']);
const WEIGHT_UNITS = Object.freeze(['kg', 't']);

/** The outcomes a receiving action may produce. `EXPECTED` is not one of them — it is the start. */
const RECEIVING_OUTCOMES = Object.freeze([
  INTAKE_STATUSES.RECEIVED,
  INTAKE_STATUSES.CONDITIONALLY_RECEIVED,
  INTAKE_STATUSES.REFUSED,
]);

/** A receipt recorded more than this far in the past is almost certainly a typo, not a memory. */
const MAX_BACKDATE_DAYS = 30;

const privileged = (ctx) => isPlatformAdmin(ctx) || isPlatformReviewer(ctx);

function shortRef(prefix, id) {
  return `${prefix}-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function requireText(value, field, { max = 500 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${field} is required`);
  if (text.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value, field, { max = 2000 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return requireText(value, field, { max });
}

function positiveNumberOrNull(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`${field} must be a number greater than zero`);
  return Math.round(n * 1000) / 1000;
}

function countOrNull(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${field} must be a whole number of zero or more`);
  return n;
}

// ── Warehouse authority ────────────────────────────────────────────────────

// The predicate lives in warehouseAuthority.js so the T8 documents workspace can ask the same
// question and get the same answer. Re-exported here because this service is its main consumer.
export { canReceiveAtWarehouse };

function assertCanReceiveAtWarehouse(warehouse, context) {
  if (!canReceiveAtWarehouse(warehouse, context)) {
    throw new ForbiddenError('You are not authorized to receive cargo at this warehouse');
  }
}

async function loadWarehouse(client, warehouseId) {
  const id = requireText(warehouseId, 'warehouseId');
  const { data } = await client.from(WAREHOUSES).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!data) throw new NotFoundError('Warehouse not found');
  return data;
}

// ── Subject resolution and eligibility ─────────────────────────────────────

/**
 * Resolve what an intake is ABOUT, and decide whether it may be received at all.
 *
 * The eligibility rule is deliberate, not convenient (T9 directive §3):
 *
 *  - `cargo_reservation` must be **APPROVED**. T5's frozen invariant is that only an approved
 *    reservation consumes booked capacity; an unapproved one is a request nobody accepted. Taking
 *    physical delivery against it would mean the warehouse is holding goods for a booking that does
 *    not exist, and the customer would reasonably read the receipt as acceptance. It is not.
 *
 *  - `logistics_request` must be **AWARDED**. This anchor exists because T3's whole premise is that
 *    a shipping request can be answered by a provider with no CarUp sailing — the provider's own
 *    warehouse receives the cargo before any container reservation exists. But before a quote is
 *    accepted, nobody has agreed to carry anything, so there is no party whose warehouse this
 *    legitimately is.
 *
 * An arbitrary UUID resolves to nothing and is refused. A subject that exists but is in the wrong
 * state is refused with the state named, so the operator can see why.
 */
async function resolveSubject(client, subjectType, subjectId) {
  if (!INTAKE_SUBJECTS.includes(String(subjectType))) {
    throw new ValidationError(`Unknown warehouse intake subject "${subjectType}"`);
  }
  const id = requireText(subjectId, 'subjectId', { max: 100 });

  if (subjectType === 'cargo_reservation') {
    const { data } = await client.from(RESERVATIONS).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
    if (!data) throw new NotFoundError('That cargo booking does not exist');
    return {
      type: 'cargo_reservation',
      id,
      record: data,
      tenantId: normalizeId(data.tenant_id),
      ownerIds: [normalizeId(data.buyer_id), normalizeId(data.created_by)].filter(Boolean),
      state: data.reservation_status,
      eligible: String(data.reservation_status).toUpperCase() === 'APPROVED',
      ineligibleReason: `This booking is ${String(data.reservation_status || 'unknown').toLowerCase()}, not approved. Cargo can only be received against an approved booking.`,
      containerId: data.container_id || null,
    };
  }

  const { data } = await client.from(REQUESTS).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!data) throw new NotFoundError('That shipping request does not exist');
  return {
    type: 'logistics_request',
    id,
    record: data,
    tenantId: normalizeId(data.tenant_id),
    ownerIds: [normalizeId(data.requester_id), normalizeId(data.created_by)].filter(Boolean),
    state: data.status,
    eligible: String(data.status).toUpperCase() === 'AWARDED',
    ineligibleReason: `This shipping request is ${String(data.status || 'unknown').toLowerCase()}. Cargo can only be received once a provider's offer has been accepted.`,
    containerId: null,
  };
}

// ── The customer's estimate, read and never written ────────────────────────

/**
 * What the customer SAID the cargo was.
 *
 * Completeness is reported rather than papered over. A shipping request whose five items include two
 * with no stated volume does not have a 3.0 CBM estimate — it has "at least 3.0, and two items
 * nobody measured". Summing a column with NULLs in it and calling the total "the estimate" is the
 * unknown-becomes-zero collapse, and it would make every later discrepancy a lie.
 */
function summarizeEstimate(subject, items = []) {
  if (subject.type === 'cargo_reservation') {
    const volume = subject.record.estimated_volume === null || subject.record.estimated_volume === undefined
      ? null : Number(subject.record.estimated_volume);
    const weight = subject.record.estimated_weight === null || subject.record.estimated_weight === undefined
      ? null : Number(subject.record.estimated_weight);
    return {
      volume_cbm: Number.isFinite(volume) ? volume : null,
      weight_kg: Number.isFinite(weight) ? weight : null,
      // The booking carries one stated volume; it is complete or it is absent.
      completeness: Number.isFinite(volume) ? 'COMPLETE' : 'UNKNOWN',
      items_total: 1,
      items_with_volume: Number.isFinite(volume) ? 1 : 0,
      source: 'The volume this booking was approved against',
    };
  }

  const rows = items || [];
  const withVolume = rows.filter((r) => r.estimated_volume_cbm !== null && r.estimated_volume_cbm !== undefined);
  const withWeight = rows.filter((r) => r.estimated_weight_kg !== null && r.estimated_weight_kg !== undefined);
  const sum = (list, key) => Math.round(list.reduce((t, r) => t + Number(r[key] || 0), 0) * 1000) / 1000;
  let completeness = 'UNKNOWN';
  if (rows.length && withVolume.length === rows.length) completeness = 'COMPLETE';
  else if (withVolume.length) completeness = 'PARTIAL';
  return {
    volume_cbm: withVolume.length ? sum(withVolume, 'estimated_volume_cbm') : null,
    weight_kg: withWeight.length ? sum(withWeight, 'estimated_weight_kg') : null,
    completeness,
    items_total: rows.length,
    items_with_volume: withVolume.length,
    source: 'What the customer stated for each cargo item',
  };
}

// ── The warehouse's actual observation ─────────────────────────────────────

/**
 * Volume from the dimensions the receiver actually measured.
 *
 * The dimensions describe **the consignment as presented at the bay**, not one carton — so package
 * count does NOT multiply the volume. Multiplying would invent cubic metres nobody measured the
 * moment a receiver counted five boxes and measured the stack once.
 */
export function deriveVolumeCbm({ length_value: l, width_value: w, height_value: h, dimension_unit: unit }) {
  if (l === null || w === null || h === null || !unit) return null;
  const divisor = unit === 'cm' ? 100 : 1;
  const cbm = (Number(l) / divisor) * (Number(w) / divisor) * (Number(h) / divisor);
  const rounded = Math.round((cbm + Number.EPSILON) * 1000) / 1000;
  return rounded > 0 ? rounded : null;
}

/** Normalize weight to kilograms for comparison only. The recorded row keeps the receiver's unit. */
function weightInKg(measurement) {
  if (measurement?.weight_value === null || measurement?.weight_value === undefined) return null;
  return measurement.weight_unit === 't' ? Number(measurement.weight_value) * 1000 : Number(measurement.weight_value);
}

/**
 * State the difference between what was said and what was found.
 *
 * A FACT and only a fact. There is deliberately no amount, no rate, no charge and no adjustment
 * anywhere in this object — T9 records that the cargo is bigger; whether that costs anything is a
 * T6 commercial action somebody has to actually take.
 */
export function projectDiscrepancy(estimate, measurement) {
  const base = {
    volume: null,
    weight: null,
    // Said in the payload so no screen can imply otherwise.
    commercial_effect: 'none',
    note: 'A difference between the estimate and the measurement is a record of what was found. It does not by itself change the price, the booking or the space reserved.',
  };
  if (!measurement) return { ...base, status: 'NOT_MEASURED', reason: 'The warehouse has not measured this cargo yet.' };

  const actualVolume = measurement.actual_volume_cbm === null || measurement.actual_volume_cbm === undefined
    ? null : Number(measurement.actual_volume_cbm);
  const actualWeight = weightInKg(measurement);

  if (estimate.completeness !== 'COMPLETE') {
    return {
      ...base,
      status: 'NOT_COMPARABLE',
      reason: estimate.completeness === 'PARTIAL'
        ? `Only ${estimate.items_with_volume} of ${estimate.items_total} cargo items were given a volume, so there is no complete estimate to compare against.`
        : 'No volume was estimated for this cargo, so there is nothing to compare the measurement against.',
      actual_volume_cbm: actualVolume,
      actual_weight_kg: actualWeight,
    };
  }

  const round = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
  if (actualVolume !== null && estimate.volume_cbm !== null) {
    const diff = round(actualVolume - estimate.volume_cbm);
    base.volume = {
      estimated_cbm: estimate.volume_cbm,
      actual_cbm: actualVolume,
      difference_cbm: diff,
      direction: diff > 0 ? 'LARGER' : diff < 0 ? 'SMALLER' : 'SAME',
    };
  }
  if (actualWeight !== null && estimate.weight_kg !== null) {
    const diff = round(actualWeight - Number(estimate.weight_kg));
    base.weight = {
      estimated_kg: Number(estimate.weight_kg),
      actual_kg: round(actualWeight),
      difference_kg: diff,
      direction: diff > 0 ? 'HEAVIER' : diff < 0 ? 'LIGHTER' : 'SAME',
    };
  }
  const anyDifference = (base.volume && base.volume.direction !== 'SAME') || (base.weight && base.weight.direction !== 'SAME');
  return { ...base, status: base.volume || base.weight ? (anyDifference ? 'DIFFERS' : 'MATCHES') : 'NOT_COMPARABLE' };
}

// ── Warehouses ─────────────────────────────────────────────────────────────

/**
 * Register a receiving operation.
 *
 * Tenant is derived: a tenant admin creates warehouses for their OWN tenant and cannot name another,
 * because the tenant on this row is what later grants receiving authority over other people's cargo.
 */
export async function createWarehouse(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  if (!privileged(context) && !String(context.tenantRole || '').trim()) {
    throw new ForbiddenError('You are not authorized to register a receiving warehouse');
  }
  const tenantId = privileged(context)
    ? (normalizeId(payload.tenantId ?? payload.tenant_id) || null)
    : context.tenantId;
  if (!privileged(context) && !tenantId) {
    throw new ForbiddenError('You are not authorized to register a receiving warehouse');
  }
  if (!privileged(context) && !isTenantAdminForRecord({ tenant_id: tenantId }, context)) {
    throw new ForbiddenError('Only a tenant administrator can register a warehouse for that tenant');
  }

  const row = {
    tenant_id: tenantId,
    name: requireText(payload.name, 'Warehouse name', { max: 200 }),
    country: requireText(payload.country, 'Country', { max: 100 }),
    city: optionalText(payload.city, 'City', { max: 100 }),
    address_line: optionalText(payload.addressLine ?? payload.address_line, 'Address', { max: 300 }),
    // Never taken from the body for a non-privileged caller: naming somebody else the operator would
    // be handing them authority over cargo they do not own.
    operator_user_id: privileged(context)
      ? (normalizeId(payload.operatorUserId ?? payload.operator_user_id) || context.id)
      : context.id,
    active: payload.active === undefined ? true : Boolean(payload.active),
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(WAREHOUSES).insert(row).select().single();
  if (error) throw new ValidationError(`Could not register the warehouse: ${error.message}`);
  await appendBestEffortAudit(client, {
    actorId: context.id, tenantId, action: 'WAREHOUSE_REGISTERED',
    resourceType: 'diaspora_warehouse', resourceId: data.id, newState: { name: data.name, country: data.country }, req: options.req,
  });
  return data;
}

/** The warehouses this actor may receive at. A participant sees none — they do not receive cargo. */
export async function listWarehouses(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data } = await client.from(WAREHOUSES).select('*').is('deleted_at', null);
  return (data || []).filter((w) => canReceiveAtWarehouse(w, context));
}

// ── Intake lifecycle ───────────────────────────────────────────────────────

/**
 * Book cargo IN — an appointment, not a receipt.
 *
 * This says the warehouse expects something. It sets no `received_at`, names no receiver, and
 * changes nothing about the cargo's real state. A customer messaging "I'm coming tomorrow" does not
 * reach this function; an operator deciding to expect them does.
 *
 * Idempotent by the database: `uq_warehouse_intake_subject` allows one live intake per cargo, so a
 * repeated call returns the existing appointment rather than a second one.
 */
export async function scheduleIntake(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const warehouse = await loadWarehouse(client, payload.warehouseId ?? payload.warehouse_id);
  assertCanReceiveAtWarehouse(warehouse, context);

  const subject = await resolveSubject(client, payload.subjectType ?? payload.subject_type, payload.subjectId ?? payload.subject_id);
  if (!subject.eligible) throw new ValidationError(subject.ineligibleReason);

  const existing = await findIntakeBySubject(client, subject.type, subject.id);
  if (existing) return { ...existing, already_existed: true };

  // The reference is derived from the INTAKE's own id, not the subject's.
  //
  // Deriving it from the subject looked tidy and was wrong: a short reference is the first 8 hex
  // characters of an id, so two consignments whose ids share a prefix present the SAME reference to
  // the operator — and the receive confirmation asks them to type exactly that string. A
  // disambiguator that does not disambiguate makes the confirmation worse than none, because it
  // looks like a check. Found by reading the deployed queue at 393px, where four rows read alike.
  //
  // Idempotency does not depend on this: `uq_warehouse_intake_subject` is what makes a repeat call
  // return the existing appointment, and it keys on the subject, not the reference.
  const id = randomUUID();
  const row = {
    id,
    // Derived from the warehouse, never from the body: the tenant here decides who may later act.
    tenant_id: warehouse.tenant_id,
    warehouse_id: warehouse.id,
    subject_type: subject.type,
    subject_id: subject.id,
    reference: shortRef('WHIN', id),
    status: INTAKE_STATUSES.EXPECTED,
    notes: optionalText(payload.notes, 'Notes'),
    // An expected arrival the operator was told about. Recorded as what it is — an expectation —
    // and never as a fact about where the cargo is.
    metadata: payload.expectedArrival || payload.expected_arrival
      ? { expected_arrival: String(payload.expectedArrival ?? payload.expected_arrival), expected_arrival_source: 'stated_by_operator' }
      : {},
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(INTAKES).insert(row).select().single();
  if (error) {
    // Lost the race for the one live intake — hand back the winner, do not raise.
    const winner = await findIntakeBySubject(client, subject.type, subject.id);
    if (winner) return { ...winner, already_existed: true };
    throw new ValidationError(`Could not book this cargo in: ${error.message}`);
  }
  await appendBestEffortAudit(client, {
    actorId: context.id, tenantId: warehouse.tenant_id, action: 'WAREHOUSE_INTAKE_EXPECTED',
    resourceType: 'diaspora_warehouse_intake', resourceId: data.id,
    newState: { subject_type: subject.type, subject_id: subject.id, warehouse_id: warehouse.id }, req: options.req,
  });
  return data;
}

async function findIntakeBySubject(client, subjectType, subjectId) {
  const { data } = await client.from(INTAKES).select('*')
    .eq('subject_type', subjectType).eq('subject_id', subjectId).is('deleted_at', null).maybeSingle();
  return data || null;
}

async function loadIntake(client, intakeId) {
  const id = requireText(intakeId, 'intakeId');
  const { data } = await client.from(INTAKES).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!data) throw new NotFoundError('Intake not found');
  return data;
}

/**
 * Resolve `received_at` truthfully.
 *
 * A receiver recording an arrival an hour after it happened should be able to say so, and the row
 * records WHICH of those two things it is. What it may never be is the future: cargo has not
 * arrived at a time that has not happened.
 */
function resolveReceivedAt(stated, now = new Date()) {
  if (stated === undefined || stated === null || String(stated).trim() === '') {
    return { received_at: now.toISOString(), source: 'server_clock' };
  }
  const when = new Date(stated);
  if (Number.isNaN(when.getTime())) throw new ValidationError('The arrival time is not a valid date and time');
  if (when.getTime() > now.getTime() + 60_000) {
    throw new ValidationError('Cargo cannot be recorded as received at a time in the future');
  }
  if (when.getTime() < now.getTime() - MAX_BACKDATE_DAYS * 86_400_000) {
    throw new ValidationError(`An arrival time more than ${MAX_BACKDATE_DAYS} days ago cannot be recorded here`);
  }
  return { received_at: when.toISOString(), source: 'stated_by_receiver' };
}

/**
 * THE central T9 act — physically receiving cargo.
 *
 * Everything else in the phase is a projection of this one row changing. What it proves, by being
 * the only way to set the status, is that none of these is a receipt:
 *
 *     an APPROVED booking · an uploaded document · a photo · a message · a measurement
 *
 * The receiver is the authenticated actor and nothing else. `receivedBy` in the body is ignored
 * entirely, so a forged attribution has nowhere to land.
 *
 * Idempotent: receiving an already-received intake returns it unchanged and — importantly — sends no
 * second notification. A retried request is one arrival, not two.
 */
export async function receiveIntake(intakeId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const intake = await loadIntake(client, intakeId);
  const warehouse = await loadWarehouse(client, intake.warehouse_id);
  assertCanReceiveAtWarehouse(warehouse, context);

  const subject = await resolveSubject(client, intake.subject_type, intake.subject_id);

  // A customer cannot mark their own cargo received — whatever else they are. Receiving is somebody
  // else confirming your goods turned up; a party confirming it about themselves is not a receipt,
  // it is a claim.
  if (subject.ownerIds.includes(context.id)) {
    throw new ForbiddenError('You cannot record your own cargo as received. A warehouse receiver has to confirm it.');
  }

  // A fast path, NOT the guarantee. Mutation-testing removed this line alone and every gate stayed
  // green, because the conditional UPDATE below is what actually holds: it matches only a row still
  // in EXPECTED, so two concurrent receives cannot both win. Deleting THAT is what would let cargo be
  // received twice — this early return only saves the work.
  if (intake.status !== INTAKE_STATUSES.EXPECTED) {
    return { ...intake, already_received: true };
  }

  const outcome = String(payload.outcome ?? INTAKE_STATUSES.RECEIVED).toUpperCase();
  if (!RECEIVING_OUTCOMES.includes(outcome)) {
    throw new ValidationError('The intake outcome must be received, conditionally received, or refused');
  }

  const condition = payload.condition === undefined || payload.condition === null || String(payload.condition).trim() === ''
    ? null : String(payload.condition).toLowerCase();
  if (condition && !INTAKE_CONDITIONS.includes(condition)) {
    throw new ValidationError(`"${condition}" is not one of the conditions a receiver can record`);
  }
  const reason = optionalText(payload.outcomeReason ?? payload.outcome_reason, 'Reason');
  if (outcome !== INTAKE_STATUSES.RECEIVED && !reason) {
    throw new ValidationError(outcome === INTAKE_STATUSES.REFUSED
      ? 'Say why the cargo was refused — the customer has to be able to act on it'
      : 'Say what the condition was on — a conditional receipt without a reason cannot be acted on');
  }

  const { received_at: receivedAt, source: receivedAtSource } = resolveReceivedAt(payload.receivedAt ?? payload.received_at);

  const update = {
    status: outcome,
    // Server-derived. The body's opinion about who received this is never consulted.
    received_by: context.id,
    received_at: receivedAt,
    condition,
    outcome_reason: reason,
    observed_package_count: countOrNull(payload.observedPackageCount ?? payload.observed_package_count, 'Package count'),
    storage_location: optionalText(payload.storageLocation ?? payload.storage_location, 'Storage location', { max: 200 }),
    notes: optionalText(payload.notes, 'Notes'),
    metadata: { ...(intake.metadata || {}), received_at_source: receivedAtSource },
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  };

  // Compare-and-set. `.eq('status', EXPECTED)` is the concurrency guarantee for the whole phase: the
  // loser of a race matches no row, reloads, and is handed the winner's receipt instead of writing a
  // second arrival over it. Do not relax this predicate.
  const { data, error } = await client.from(INTAKES).update(update)
    .eq('id', intake.id).eq('status', INTAKE_STATUSES.EXPECTED).select().single();
  if (error || !data) {
    const current = await loadIntake(client, intake.id);
    if (current.status !== INTAKE_STATUSES.EXPECTED) return { ...current, already_received: true };
    throw new ValidationError(`Could not record the receipt: ${error?.message || 'the intake could not be updated'}`);
  }

  // Security-relevant: this is the row that says somebody else's goods are now in a warehouse.
  await appendCriticalAudit(client, {
    actorId: context.id, tenantId: intake.tenant_id, action: `WAREHOUSE_INTAKE_${outcome}`,
    resourceType: 'diaspora_warehouse_intake', resourceId: intake.id,
    previousState: { status: intake.status },
    newState: { status: outcome, condition, received_at: receivedAt, received_at_source: receivedAtSource },
    req: options.req,
  });

  const recipients = subject.ownerIds;
  await notifyCargoReceived({ intake: data, subject, recipients, outcome, reason });
  if (condition && condition !== 'good') {
    await notifyConditionIssue({ intake: data, subject, recipients, condition });
  }
  return data;
}

/**
 * Record what the warehouse actually measured.
 *
 * Append-only: a correction is a new observation, and the earlier one stays readable with its own
 * measurer and time. The latest is authoritative; none is erased.
 *
 * Volume is DERIVED here from the dimensions on this row. A client-supplied CBM is a claim, not a
 * measurement, and is never stored — when there are no dimensions the volume simply stays unknown
 * rather than becoming somebody's number.
 */
export async function recordMeasurement(intakeId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const intake = await loadIntake(client, intakeId);
  const warehouse = await loadWarehouse(client, intake.warehouse_id);
  assertCanReceiveAtWarehouse(warehouse, context);

  if (intake.status === INTAKE_STATUSES.EXPECTED) {
    throw new ValidationError('Cargo has to be received before it can be measured');
  }
  if (intake.status === INTAKE_STATUSES.REFUSED) {
    throw new ValidationError('This cargo was refused, so there is nothing here to measure');
  }

  const unit = payload.dimensionUnit ?? payload.dimension_unit ?? null;
  const dims = {
    length_value: positiveNumberOrNull(payload.lengthValue ?? payload.length_value, 'Length'),
    width_value: positiveNumberOrNull(payload.widthValue ?? payload.width_value, 'Width'),
    height_value: positiveNumberOrNull(payload.heightValue ?? payload.height_value, 'Height'),
    dimension_unit: unit ? String(unit).toLowerCase() : null,
  };
  const provided = [dims.length_value, dims.width_value, dims.height_value].filter((v) => v !== null).length;
  if (provided > 0 && provided < 3) {
    throw new ValidationError('Record all three of length, width and height, or none of them — two sides is not a box');
  }
  if (provided === 3 && !DIMENSION_UNITS.includes(dims.dimension_unit)) {
    throw new ValidationError('Say whether the dimensions are in centimetres or metres');
  }
  if (provided === 0) dims.dimension_unit = null;

  const weightValue = positiveNumberOrNull(payload.weightValue ?? payload.weight_value, 'Weight');
  const weightUnit = payload.weightUnit ?? payload.weight_unit ?? null;
  if (weightValue !== null && !WEIGHT_UNITS.includes(String(weightUnit || '').toLowerCase())) {
    throw new ValidationError('Say whether the weight is in kilograms or tonnes');
  }
  const packageCount = countOrNull(payload.packageCount ?? payload.package_count, 'Package count');
  if (provided === 0 && weightValue === null && packageCount === null) {
    throw new ValidationError('Record at least one of dimensions, weight or a package count');
  }

  // A stated volume with no dimensions behind it would be a claim wearing a measurement's clothes.
  const claimedVolume = payload.actualVolumeCbm ?? payload.actual_volume_cbm;
  if (claimedVolume !== undefined && claimedVolume !== null && String(claimedVolume).trim() !== '' && provided === 0) {
    throw new ValidationError('Volume is worked out from the measured dimensions. Record length, width and height, or leave the volume unknown.');
  }

  const method = String(payload.method || 'manual').toLowerCase();
  if (!MEASUREMENT_METHODS.includes(method)) throw new ValidationError('That is not a measurement method this warehouse records');

  const row = {
    intake_id: intake.id,
    tenant_id: intake.tenant_id,
    ...dims,
    weight_value: weightValue,
    weight_unit: weightValue === null ? null : String(weightUnit).toLowerCase(),
    package_count: packageCount,
    // Derived, always. Never the client's number.
    actual_volume_cbm: deriveVolumeCbm(dims),
    measured_by: context.id,
    measured_at: new Date().toISOString(),
    method,
    notes: optionalText(payload.notes, 'Notes'),
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(MEASUREMENTS).insert(row).select().single();
  if (error) throw new ValidationError(`Could not record the measurement: ${error.message}`);
  await appendBestEffortAudit(client, {
    actorId: context.id, tenantId: intake.tenant_id, action: 'WAREHOUSE_MEASUREMENT_RECORDED',
    resourceType: 'diaspora_warehouse_measurement', resourceId: data.id,
    newState: { intake_id: intake.id, actual_volume_cbm: data.actual_volume_cbm, weight_value: data.weight_value }, req: options.req,
  });

  const subject = await resolveSubject(client, intake.subject_type, intake.subject_id);
  const items = subject.type === 'logistics_request' ? await loadRequestItems(client, [subject.id]) : [];
  const estimate = summarizeEstimate(subject, items);
  const discrepancy = projectDiscrepancy(estimate, data);
  if (discrepancy.status === 'DIFFERS') {
    await notifyMeasurementDiscrepancy({ intake, subject, recipients: subject.ownerIds, discrepancy });
  }
  return { measurement: data, estimate, discrepancy };
}

/**
 * Put the cargo somewhere, and say where.
 *
 * Only when a person actually assigns a position. An unknown location stays unknown — "Bay A" typed
 * in to complete a card is a place somebody will later go and look.
 */
export async function assignStorageLocation(intakeId, location, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const intake = await loadIntake(client, intakeId);
  const warehouse = await loadWarehouse(client, intake.warehouse_id);
  assertCanReceiveAtWarehouse(warehouse, context);
  if (intake.status === INTAKE_STATUSES.EXPECTED || intake.status === INTAKE_STATUSES.REFUSED) {
    throw new ValidationError('Only cargo the warehouse is actually holding can be given a storage location');
  }
  const value = requireText(location, 'Storage location', { max: 200 });
  const { data, error } = await client.from(INTAKES)
    .update({ storage_location: value, updated_by: context.id, updated_at: new Date().toISOString() })
    .eq('id', intake.id).select().single();
  if (error) throw new ValidationError(`Could not set the storage location: ${error.message}`);
  await appendBestEffortAudit(client, {
    actorId: context.id, tenantId: intake.tenant_id, action: 'WAREHOUSE_STORAGE_ASSIGNED',
    resourceType: 'diaspora_warehouse_intake', resourceId: intake.id,
    previousState: { storage_location: intake.storage_location }, newState: { storage_location: value }, req: options.req,
  });
  return data;
}

// ── Projections ────────────────────────────────────────────────────────────

async function loadRequestItems(client, requestIds) {
  if (!requestIds.length) return [];
  const { data } = await client.from(REQUEST_ITEMS).select('*').in('logistics_request_id', requestIds).is('deleted_at', null);
  return data || [];
}

/** The current measurement is the latest one. Earlier observations are history, never overwritten. */
function currentMeasurement(rows = []) {
  const live = rows.filter((m) => !m.deleted_at);
  if (!live.length) return null;
  return live.slice().sort((a, b) => String(b.measured_at || '').localeCompare(String(a.measured_at || '')))[0];
}

function statusSentence(intake) {
  switch (intake.status) {
    case INTAKE_STATUSES.RECEIVED: return 'The warehouse has your cargo.';
    case INTAKE_STATUSES.CONDITIONALLY_RECEIVED: return 'The warehouse has your cargo, with something noted about it.';
    case INTAKE_STATUSES.REFUSED: return 'The warehouse did not take your cargo in.';
    default: return 'The warehouse is expecting your cargo. Nothing has arrived yet.';
  }
}

function projectIntake(intake, measurements, estimate, discrepancy, { includePrivate }) {
  const current = currentMeasurement(measurements);
  const base = {
    id: intake.id,
    reference: intake.reference,
    warehouse_id: intake.warehouse_id,
    subject: { type: intake.subject_type, id: intake.subject_id },
    status: intake.status,
    status_sentence: statusSentence(intake),
    received_at: intake.received_at || null,
    received_at_source: intake.metadata?.received_at_source || null,
    condition: intake.condition || null,
    outcome_reason: intake.outcome_reason || null,
    observed_package_count: intake.observed_package_count === null || intake.observed_package_count === undefined
      ? null : Number(intake.observed_package_count),
    // Unknown stays unknown. No placeholder bay, rack or zone is ever manufactured here.
    storage_location: intake.storage_location || null,
    estimate,
    actual: current ? {
      id: current.id,
      length_value: current.length_value, width_value: current.width_value, height_value: current.height_value,
      dimension_unit: current.dimension_unit,
      weight_value: current.weight_value, weight_unit: current.weight_unit,
      package_count: current.package_count,
      volume_cbm: current.actual_volume_cbm === null || current.actual_volume_cbm === undefined ? null : Number(current.actual_volume_cbm),
      measured_at: current.measured_at, method: current.method,
    } : null,
    earlier_measurements: Math.max(0, measurements.filter((m) => !m.deleted_at).length - (current ? 1 : 0)),
    discrepancy,
  };
  if (!includePrivate) return base;
  return {
    ...base,
    received_by: intake.received_by || null,
    measured_by: current?.measured_by || null,
    notes: intake.notes || null,
    measurement_notes: current?.notes || null,
    tenant_id: intake.tenant_id || null,
  };
}

async function buildProjections(client, intakes, { includePrivate }) {
  if (!intakes.length) return [];
  const ids = intakes.map((i) => i.id);
  const reservationIds = intakes.filter((i) => i.subject_type === 'cargo_reservation').map((i) => i.subject_id);
  const requestIds = intakes.filter((i) => i.subject_type === 'logistics_request').map((i) => i.subject_id);

  // Bounded: four reads for any number of intakes, not four reads per intake.
  const [{ data: measurements }, { data: reservations }, { data: requests }, items] = await Promise.all([
    client.from(MEASUREMENTS).select('*').in('intake_id', ids).is('deleted_at', null),
    reservationIds.length ? client.from(RESERVATIONS).select('*').in('id', reservationIds).is('deleted_at', null) : Promise.resolve({ data: [] }),
    requestIds.length ? client.from(REQUESTS).select('*').in('id', requestIds).is('deleted_at', null) : Promise.resolve({ data: [] }),
    loadRequestItems(client, requestIds),
  ]);

  const measurementsByIntake = new Map();
  for (const m of measurements || []) {
    if (!measurementsByIntake.has(m.intake_id)) measurementsByIntake.set(m.intake_id, []);
    measurementsByIntake.get(m.intake_id).push(m);
  }
  const reservationById = new Map((reservations || []).map((r) => [String(r.id), r]));
  const requestById = new Map((requests || []).map((r) => [String(r.id), r]));
  const itemsByRequest = new Map();
  for (const it of items) {
    if (!itemsByRequest.has(it.logistics_request_id)) itemsByRequest.set(it.logistics_request_id, []);
    itemsByRequest.get(it.logistics_request_id).push(it);
  }

  return intakes.map((intake) => {
    const record = intake.subject_type === 'cargo_reservation'
      ? reservationById.get(String(intake.subject_id))
      : requestById.get(String(intake.subject_id));
    const subject = {
      type: intake.subject_type,
      record: record || {},
      ownerIds: intake.subject_type === 'cargo_reservation'
        ? [normalizeId(record?.buyer_id), normalizeId(record?.created_by)].filter(Boolean)
        : [normalizeId(record?.requester_id), normalizeId(record?.created_by)].filter(Boolean),
    };
    const estimate = summarizeEstimate(subject, itemsByRequest.get(intake.subject_id) || []);
    const rows = measurementsByIntake.get(intake.id) || [];
    const discrepancy = projectDiscrepancy(estimate, currentMeasurement(rows));
    return projectIntake(intake, rows, estimate, discrepancy, { includePrivate });
  });
}

/**
 * The operator's queue.
 *
 * Scoped to the warehouses this actor may receive at — which for a customer is none, so the queue is
 * empty rather than forbidden. A foreign tenant's warehouse never enters the scope, so its cargo
 * cannot be listed, found or received.
 */
export async function listIntakeQueue(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const warehouses = await listWarehouses(context, options);
  if (!warehouses.length) return { warehouses: [], intakes: [] };

  const allowed = new Set(warehouses.map((w) => String(w.id)));
  const { limit } = paging(filters);
  let query = client.from(INTAKES).select('*').in('warehouse_id', [...allowed]).is('deleted_at', null);
  if (filters.status) query = query.eq('status', String(filters.status).toUpperCase());
  if (filters.warehouseId && allowed.has(String(filters.warehouseId))) {
    query = query.eq('warehouse_id', String(filters.warehouseId));
  }
  const { data } = await query.order('created_at', { ascending: false }).limit(limit);
  const intakes = (data || []).filter((i) => allowed.has(String(i.warehouse_id)));
  return {
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, country: w.country, city: w.city })),
    intakes: await buildProjections(client, intakes, { includePrivate: true }),
  };
}

/** One intake, for somebody with warehouse authority over it. */
export async function getIntake(intakeId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const intake = await loadIntake(client, intakeId);
  const warehouse = await loadWarehouse(client, intake.warehouse_id);
  assertCanReceiveAtWarehouse(warehouse, context);
  const [projection] = await buildProjections(client, [intake], { includePrivate: true });
  return { ...projection, warehouse: { id: warehouse.id, name: warehouse.name, country: warehouse.country, city: warehouse.city } };
}

/**
 * The customer's own view of their own cargo.
 *
 * Authorized from the SUBJECT, not the warehouse: you may read the intake for cargo you own. A
 * co-loader on the same sailing owns a different booking and gets nothing here — sharing a container
 * is not sharing each other's consignments.
 *
 * Returns the projection without the warehouse's internal attribution: the customer needs to know
 * their cargo arrived and what was found, not which staff member logged it.
 */
export async function getMyCargoIntake(subjectType, subjectId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const subject = await resolveSubject(client, subjectType, subjectId);
  const isOwner = subject.ownerIds.includes(context.id);
  if (!isOwner && !privileged(context) && !isTenantAdminForRecord(subject.record, context)) {
    throw new ForbiddenError('This is not your cargo');
  }
  const intake = await findIntakeBySubject(client, subject.type, subject.id);
  if (!intake) {
    const items = subject.type === 'logistics_request' ? await loadRequestItems(client, [subject.id]) : [];
    return {
      subject: { type: subject.type, id: subject.id },
      intake: null,
      estimate: summarizeEstimate(subject, items),
      // Truthful absence. Not "pending", not "in transit" — nobody has booked this in anywhere.
      status_sentence: 'No warehouse has booked this cargo in yet.',
      eligible_for_intake: subject.eligible,
      eligibility_note: subject.eligible ? null : subject.ineligibleReason,
    };
  }
  const [projection] = await buildProjections(client, [intake], { includePrivate: false });
  return {
    subject: { type: subject.type, id: subject.id },
    intake: projection,
    estimate: projection.estimate,
    status_sentence: projection.status_sentence,
    eligible_for_intake: subject.eligible,
    eligibility_note: null,
  };
}
