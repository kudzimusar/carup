/**
 * T11-CAP-05 — recording estimate revisions as observations.
 *
 * An observation is something a provider or an operator SAYS about a shipment. It is an input, not a
 * verified fact, and it must never rewrite the shipment. So this service writes observations and
 * audit rows and NOTHING else — never the shipment, never the movement timeline — and a test traps
 * every write to prove it. T11 has no function that updates a shipment's estimate, and this does not
 * bypass T11 to write the column: an accepted revision is shown BESIDE the shipment's own estimate
 * (current vs original), with the history kept.
 *
 * Provenance is honest. The only provider that can be ingested today is OPERATOR_DECLARED — an
 * authorised operator saying something about their own shipment. A caller cannot name another
 * provider, a status, or a decision: no external integration exists, and claiming one would be
 * inventing the evidence the field is for. (`PROVIDER INTEGRATION PENDING EXTERNAL AUTHORITY`.)
 *
 * Who may record is T11's own rule (`shipmentWriteContext`), checked before anything else.
 *
 * History is evidence. A newer accepted revision SUPERSEDES the older one — the older stays, in the
 * history. A revision whose observation is OLDER than the current one, entered late, is superseded
 * on arrival and can never become "current". Replaying an event is idempotent; reusing its id for
 * different content is a conflict that says nothing about anyone else's shipment.
 */
import { randomUUID } from 'node:crypto';
import { ConflictError, DatabaseError, ValidationError } from '../../utils/errors.js';
import { requireUserContext } from './diasporaAuthorization.js';
import { loadShipmentWriteContext } from './shipmentWriteContext.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { resolveClient } from './diasporaServiceUtils.js';
import { listEtaRevisionsForShipment } from './shipmentObservationRead.js';

const OBSERVATIONS = 'diaspora_shipment_observations';
const PROVIDER = 'OPERATOR_DECLARED';

/** The providers a caller can currently ingest. Everything else is pending external authority. */
export const OBSERVATION_PROVIDERS_INGESTIBLE = Object.freeze([PROVIDER]);

const ALLOWED_KEYS = new Set(['estimated_arrival', 'reason', 'observed_at', 'source_reference', 'provider_event_id']);
const FUTURE_SKEW_MS = 60_000;
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

function requireText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${field} is required`);
  return text;
}

function boundedText(value, field, max) {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  if (text.length > max) throw new ValidationError(`${field} is too long (at most ${max} characters)`);
  return text;
}

function requireDate(value, field) {
  if (isBlank(value)) throw new ValidationError(`${field} is required`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} is not a readable date`);
  return d;
}

function normalise(payload, shipment) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ValidationError('An estimate revision must be an object');
  const unknown = Object.keys(payload).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length) throw new ValidationError(`Unknown or non-assertable field(s): ${unknown.join(', ')}`);

  const estimated = requireDate(payload.estimated_arrival, 'estimated_arrival');
  const planned = shipment.metadata?.planned_departure_date ? new Date(shipment.metadata.planned_departure_date) : null;
  const departed = shipment.departure_date ? new Date(shipment.departure_date) : null;
  if ((planned && estimated < planned) || (departed && estimated < departed)) {
    throw new ValidationError('The estimated arrival cannot be before the shipment\'s departure');
  }

  const observed = isBlank(payload.observed_at) ? new Date() : requireDate(payload.observed_at, 'observed_at');
  if (observed.getTime() > Date.now() + FUTURE_SKEW_MS) throw new ValidationError('An observation cannot be dated in the future');

  return {
    estimated_arrival: estimated.toISOString(),
    observed_at: observed.toISOString(),
    observed_supplied: !isBlank(payload.observed_at),
    reason: boundedText(payload.reason, 'reason', 500),
    source_reference: boundedText(payload.source_reference, 'source_reference', 500),
    provider_event_id: boundedText(payload.provider_event_id, 'provider_event_id', 200) ?? randomUUID(),
  };
}

/** What an authorised operator sees of one recorded revision: the content and its attribution, not internals. */
function projectForOperator(row) {
  return {
    id: row.id,
    estimated_arrival: row.payload?.estimated_arrival ?? null,
    observed_at: row.observed_at ?? null,
    reason: row.payload?.reason ?? null,
    source: row.provider_id ?? null,
    status: row.status,
    recorded_by: row.created_by ?? null,
    recorded_at: row.created_at ?? row.received_at ?? null,
  };
}

/** Is this stored observation the one the caller is describing? */
function sameObservation(existing, shipmentId, fields) {
  return String(existing.shipment_id) === String(shipmentId)
    && existing.kind === 'ETA_REVISION'
    && existing.payload?.estimated_arrival === fields.estimated_arrival
    && (existing.payload?.reason ?? null) === fields.reason
    && (!fields.observed_supplied || new Date(existing.observed_at).toISOString() === fields.observed_at);
}

const CONFLICT = 'That event id has already been used for a different observation.';

async function findByEvent(client, providerEventId) {
  const { data } = await client.from(OBSERVATIONS).select('*')
    .eq('provider_id', PROVIDER).eq('provider_event_id', providerEventId).maybeSingle();
  return data || null;
}

/**
 * Mark every accepted estimate revision of a shipment SUPERSEDED except the one with the latest
 * observation. "Latest" is by when it was OBSERVED, so a late-entered older observation loses.
 */
async function reconcileCurrent(client, shipmentId) {
  const { data } = await client.from(OBSERVATIONS).select('*')
    .eq('shipment_id', shipmentId).eq('kind', 'ETA_REVISION').eq('status', 'ACCEPTED');
  const accepted = (data || []).slice().sort((a, b) =>
    String(a.observed_at).localeCompare(String(b.observed_at)) || String(a.received_at || a.created_at || '').localeCompare(String(b.received_at || b.created_at || '')));
  for (const older of accepted.slice(0, -1)) {
    const { error } = await client.from(OBSERVATIONS).update({ status: 'SUPERSEDED', updated_at: new Date().toISOString() })
      .eq('id', older.id).eq('status', 'ACCEPTED');
    if (error) throw new DatabaseError(error.message);
  }
}

export async function recordEtaRevision(shipmentId, payload, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const id = requireText(shipmentId, 'shipmentId');

  // Authority first: a caller who may not write learns nothing about what would have been accepted.
  const { shipment, order } = await loadShipmentWriteContext(client, id, context);
  const fields = normalise(payload, shipment);

  // Replay: the same event, described the same way, is the same event.
  const replay = await findByEvent(client, fields.provider_event_id);
  if (replay) {
    if (sameObservation(replay, id, fields)) return projectForOperator(replay);
    throw new ConflictError(CONFLICT);
  }

  const before = await listEtaRevisionsForShipment(id, client);
  const currentBefore = [...before].reverse().find((r) => r.status === 'ACCEPTED')?.payload?.estimated_arrival
    ?? shipment.estimated_arrival_date ?? null;

  const now = new Date().toISOString();
  const row = {
    tenant_id: shipment.tenant_id ?? null,
    shipment_id: id,
    provider_id: PROVIDER,
    provider_event_id: fields.provider_event_id,
    kind: 'ETA_REVISION',
    observed_at: fields.observed_at,
    payload: { estimated_arrival: fields.estimated_arrival, reason: fields.reason },
    source_reference: fields.source_reference,
    // An authorised operator declaring their own shipment's estimate IS the authority for it: it is
    // accepted on arrival, attributed to them. An external provider's observation would arrive RECEIVED.
    status: 'ACCEPTED',
    decided_by: context.id,
    decided_at: now,
    decision_reason: 'Declared by an authorized operator',
    created_by: context.id,
  };
  const { data, error } = await client.from(OBSERVATIONS).insert(row).select().single();
  if (error) {
    if (error.code === '23505') {
      // Lost the insert race for this event id: it is a replay or a conflict, decided on what won.
      const winner = await findByEvent(client, fields.provider_event_id);
      if (winner && sameObservation(winner, id, fields)) return projectForOperator(winner);
      throw new ConflictError(CONFLICT);
    }
    throw new DatabaseError(error.message);
  }

  await reconcileCurrent(client, id);

  await writeDiasporaAudit({
    importOrderId: order.id,
    tenantId: shipment.tenant_id ?? null,
    actorId: context.id,
    action: 'SHIPMENT_ETA_REVISED',
    resourceType: 'diaspora_shipment_observation',
    resourceId: data.id,
    previousState: { current_estimate: currentBefore },
    newState: { estimated_arrival: fields.estimated_arrival, reason: fields.reason, observed_at: fields.observed_at },
    req: options.req || null,
    supabaseClient: client,
  });
  return projectForOperator(data);
}

/** The estimate-revision history of a shipment, for someone who may manage it. */
export async function listEtaRevisions(shipmentId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const id = requireText(shipmentId, 'shipmentId');
  await loadShipmentWriteContext(client, id, context);
  return (await listEtaRevisionsForShipment(id, client)).map(projectForOperator);
}
