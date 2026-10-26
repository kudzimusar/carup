/**
 * T11-CAP-04 — shipment legs: which vessel, on which voyage, between which ports.
 *
 * A leg is a DECLARED fact about a vessel and a route. It is deliberately not a record that anything
 * sailed or arrived: movement is T11's alone (the shipment's observed departure and arrival and its
 * append-only timeline), and a second place to assert "it sailed" would be a second lifecycle that
 * could disagree with the first. So this service writes legs and audit rows and nothing else — never a
 * shipment, a stage event or a document — and a test traps every write to prove it.
 *
 * Who may write is T11's own rule, reused verbatim (`assertMayMoveShipment`): a platform admin or
 * reviewer, the record's tenant admin, or the operator of the container the shipment sails on. A buyer
 * does not declare vessels for their own purchase.
 *
 * Provenance is honest. The default source is OPERATOR_DECLARED. A caller cannot declare a leg as
 * CARRIER- or PROVIDER-sourced, because no such integration exists — claiming one would be inventing
 * the very evidence the field is for. A DOCUMENT-sourced leg must point at a live document of THIS
 * order, so "from the bill of lading" cannot be said of a document that is not the order's.
 *
 * Corrections follow the pattern T8, T9 and the T11 timeline use: a leg's plan fields can be
 * corrected (attributed, with before and after in the audit trail); its position, its shipment and its
 * author cannot be rewritten — supersede the leg and declare a new one.
 */
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { requireUserContext } from './diasporaAuthorization.js';
import { loadShipmentWriteContext as loadShipmentContext } from './shipmentWriteContext.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { resolveClient } from './diasporaServiceUtils.js';
import { listLegsForShipment, projectLeg } from './shipmentLegRead.js';

// The read side lives in its own module so the read-only Journey projection need not import this write service.
export { listLegsForShipment, projectLeg };

const LEGS = 'diaspora_shipment_legs';
const DOCUMENTS = 'diaspora_trade_documents';

/** The sources the database allows. Only the first two can be declared by a caller today. */
export const LEG_SOURCES = Object.freeze(['OPERATOR_DECLARED', 'DOCUMENT', 'CARRIER', 'PROVIDER']);
const CALLER_SOURCES = new Set(['OPERATOR_DECLARED', 'DOCUMENT']);

const LIMITS = Object.freeze({
  carrier_name: 120, vessel_name: 120, voyage_ref: 60, port_of_loading: 160, port_of_discharge: 160, source_reference: 500,
});
const TEXT_FIELDS = Object.keys(LIMITS);
const PLAN_FIELDS = [...TEXT_FIELDS, 'imo', 'mmsi', 'planned_departure_date', 'estimated_arrival_date', 'source'];
const ALLOWED_ON_ADD = new Set([...PLAN_FIELDS, 'leg_sequence']);
const ALLOWED_ON_UPDATE = new Set(PLAN_FIELDS);

function requireText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${field} is required`);
  return text;
}

/**
 * An IMO number is seven digits whose last digit is a check digit: the first six digits weighted
 * 7,6,5,4,3,2, summed, and taken modulo ten. Shape alone would accept most typos.
 */
export function isValidImo(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).replace(/^\s*IMO\s*/i, '').trim();
  if (!/^\d{7}$/.test(s)) return false;
  const sum = [...s.slice(0, 6)].reduce((acc, digit, i) => acc + Number(digit) * (7 - i), 0);
  return sum % 10 === Number(s[6]);
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

function optionalText(value, field) {
  if (value === undefined) return undefined;
  if (isBlank(value)) return null;
  const text = String(value).trim();
  if (text.length > LIMITS[field]) throw new ValidationError(`${field} is too long (at most ${LIMITS[field]} characters)`);
  return text;
}

function optionalDate(value, field) {
  if (value === undefined) return undefined;
  if (isBlank(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} is not a readable date`);
  return d.toISOString();
}

function optionalImo(value) {
  if (value === undefined) return undefined;
  if (isBlank(value)) return null;
  if (!isValidImo(value)) throw new ValidationError('The IMO number is not valid: it must be seven digits with a correct check digit');
  return String(value).replace(/^\s*IMO\s*/i, '').trim();
}

function optionalMmsi(value) {
  if (value === undefined) return undefined;
  if (isBlank(value)) return null;
  const s = String(value).trim();
  if (!/^\d{9}$/.test(s)) throw new ValidationError('The MMSI must be exactly nine digits');
  return s;
}

function optionalSource(value) {
  if (value === undefined) return undefined;
  const s = String(value).trim().toUpperCase();
  if (!LEG_SOURCES.includes(s)) throw new ValidationError(`The source must be one of: ${[...CALLER_SOURCES].join(', ')}`);
  if (!CALLER_SOURCES.has(s)) {
    throw new ValidationError(`${s}-sourced legs are not available: PROVIDER INTEGRATION PENDING EXTERNAL AUTHORITY. A leg cannot be declared as coming from a source that is not connected.`);
  }
  return s;
}

/** Normalise only the fields supplied (undefined = not supplied). Unknown fields are refused, not ignored. */
function normalise(payload, allowed) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ValidationError('A leg must be an object');
  const unknown = Object.keys(payload).filter((k) => !allowed.has(k));
  if (unknown.length) {
    const fixed = unknown.filter((k) => k === 'leg_sequence' || k === 'shipment_id');
    if (fixed.length) throw new ValidationError(`${fixed.join(', ')} cannot be changed. Supersede the leg and declare a new one.`);
    throw new ValidationError(`Unknown field(s): ${unknown.join(', ')}`);
  }
  const out = {};
  for (const f of TEXT_FIELDS) { const v = optionalText(payload[f], f); if (v !== undefined) out[f] = v; }
  const imo = optionalImo(payload.imo); if (imo !== undefined) out.imo = imo;
  const mmsi = optionalMmsi(payload.mmsi); if (mmsi !== undefined) out.mmsi = mmsi;
  for (const f of ['planned_departure_date', 'estimated_arrival_date']) { const v = optionalDate(payload[f], f); if (v !== undefined) out[f] = v; }
  const source = optionalSource(payload.source); if (source !== undefined) out.source = source;
  if (payload.leg_sequence !== undefined) {
    const n = Number(payload.leg_sequence);
    if (!Number.isInteger(n) || n < 1) throw new ValidationError('leg_sequence must be a whole number from 1');
    out.leg_sequence = n;
  }
  return out;
}

/** Rules that need the whole leg, not just the fields supplied. */
function assertCoherent(merged) {
  const identifies = ['vessel_name', 'carrier_name', 'port_of_loading', 'port_of_discharge'].some((f) => !isBlank(merged[f]));
  if (!identifies) throw new ValidationError('A leg must name at least a vessel, a carrier or a port');
  if (merged.planned_departure_date && merged.estimated_arrival_date
    && new Date(merged.estimated_arrival_date) < new Date(merged.planned_departure_date)) {
    throw new ValidationError('The estimated arrival cannot be before the planned departure');
  }
}

/** "From the bill of lading" may only be said of a live document that belongs to THIS order. */
async function assertDocumentBelongsToOrder(client, reference, order) {
  if (isBlank(reference)) throw new ValidationError('A document-sourced leg must name the document in source_reference');
  const { data: doc } = await client.from(DOCUMENTS).select('*').eq('id', String(reference).trim()).is('deleted_at', null).maybeSingle();
  if (!doc) throw new ValidationError('That document does not exist');
  const bound = String(doc.import_order_id ?? '') === String(order.id)
    || (doc.subject_type === 'import_order' && String(doc.subject_id ?? '') === String(order.id));
  if (!bound) throw new ValidationError('That document does not belong to this order');
}

const snapshot = (leg) => Object.fromEntries(PLAN_FIELDS.map((f) => [f, leg[f] ?? null]));

async function audit(client, { order, shipment, context, action, leg, previousState = null, newState = null, req = null }) {
  await writeDiasporaAudit({
    importOrderId: order.id,
    tenantId: shipment.tenant_id ?? null,
    actorId: context.id,
    action,
    resourceType: 'diaspora_shipment_leg',
    resourceId: leg.id,
    previousState,
    newState,
    req,
    supabaseClient: client,
  });
}

/**
 * What an authorised operator sees of a leg: the declaration plus its identity and attribution — and
 * still never `metadata`, `tenant_id` or `deleted_at`. The routes return this, never a raw row.
 */
export function projectLegForOperator(leg) {
  return {
    id: leg.id,
    shipment_id: leg.shipment_id,
    ...projectLeg(leg),
    source_reference: leg.source_reference ?? null,
    created_by: leg.created_by ?? null,
    created_at: leg.created_at ?? null,
    updated_by: leg.updated_by ?? null,
    updated_at: leg.updated_at ?? null,
  };
}

/** The live legs of a shipment, for someone who may manage it. Authority is T11's own rule. */
export async function listShipmentLegs(shipmentId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const id = requireText(shipmentId, 'shipmentId');
  await loadShipmentContext(client, id, context);
  return (await listLegsForShipment(id, client)).map(projectLegForOperator);
}

export async function addShipmentLeg(shipmentId, payload, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const id = requireText(shipmentId, 'shipmentId');

  // Authority first: a caller who may not write learns nothing about what would have been accepted.
  const { shipment, order } = await loadShipmentContext(client, id, context);

  const fields = normalise(payload, ALLOWED_ON_ADD);
  const merged = { source: 'OPERATOR_DECLARED', ...fields };
  assertCoherent(merged);
  if (merged.source === 'DOCUMENT') await assertDocumentBelongsToOrder(client, merged.source_reference, order);

  const existing = await listLegsForShipment(id, client);
  const sequence = fields.leg_sequence ?? (existing.reduce((m, l) => Math.max(m, l.leg_sequence), 0) + 1);
  if (existing.some((l) => l.leg_sequence === sequence)) {
    throw new ValidationError(`Position ${sequence} in this journey is already used by a live leg. Supersede it first, or choose another position.`);
  }

  const row = {
    tenant_id: shipment.tenant_id ?? null,
    shipment_id: id,
    leg_sequence: sequence,
    ...Object.fromEntries(PLAN_FIELDS.map((f) => [f, merged[f] ?? null])),
    source: merged.source,
    created_by: context.id,
    updated_by: context.id,
  };
  const { data, error } = await client.from(LEGS).insert(row).select().single();
  if (error) {
    if (error.code === '23505') throw new ValidationError(`Position ${sequence} in this journey is already used by a live leg.`);
    throw new DatabaseError(error.message);
  }
  await audit(client, { order, shipment, context, action: 'SHIPMENT_LEG_DECLARED', leg: data, newState: snapshot(data), req: options.req || null });
  return data;
}

async function loadLiveLeg(client, legId) {
  const { data: leg } = await client.from(LEGS).select('*').eq('id', legId).is('deleted_at', null).maybeSingle();
  if (!leg) throw new NotFoundError('Leg not found');
  return leg;
}

export async function updateShipmentLeg(legId, patch, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const id = requireText(legId, 'legId');

  const leg = await loadLiveLeg(client, id);
  const { shipment, order } = await loadShipmentContext(client, leg.shipment_id, context);

  const fields = normalise(patch, ALLOWED_ON_UPDATE);
  const merged = { ...leg, ...fields };
  assertCoherent(merged);
  if (merged.source === 'DOCUMENT' && ('source' in fields || 'source_reference' in fields)) {
    await assertDocumentBelongsToOrder(client, merged.source_reference, order);
  }

  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => (leg[k] ?? null) !== (v ?? null)));
  if (!Object.keys(changed).length) return leg;

  const { data, error } = await client.from(LEGS)
    .update({ ...changed, updated_by: context.id, updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select().single();
  if (error) throw new DatabaseError(error.message);
  await audit(client, { order, shipment, context, action: 'SHIPMENT_LEG_UPDATED', leg: data, previousState: snapshot(leg), newState: snapshot(data), req: options.req || null });
  return data;
}

export async function supersedeShipmentLeg(legId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const id = requireText(legId, 'legId');

  const leg = await loadLiveLeg(client, id);
  const { shipment, order } = await loadShipmentContext(client, leg.shipment_id, context);

  const { data, error } = await client.from(LEGS)
    .update({ deleted_at: new Date().toISOString(), updated_by: context.id, updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select().single();
  if (error) throw new DatabaseError(error.message);
  await audit(client, { order, shipment, context, action: 'SHIPMENT_LEG_SUPERSEDED', leg: data, previousState: snapshot(leg), req: options.req || null });
  return data;
}
