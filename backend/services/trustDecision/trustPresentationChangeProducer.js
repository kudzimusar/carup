/**
 * R5 — the canonical Trust-presentation change producer.
 *
 * This is the missing half that `R5_PRODUCER_GAP` recorded: `refreshCanonicalTrust` was the single
 * writer of `vehicles.trust_score`, and it told nobody. Nothing in the system announced that what a
 * customer can see about their vehicle had changed.
 *
 * It does NOT become a second Trust writer. `refreshCanonicalTrust` remains the one writer; this
 * runs immediately after a successful write, compares the AUDIENCE-SAFE public projection before
 * and after, and emits only when the customer-visible position genuinely moved.
 *
 * THE RECIPIENT (owner decision, v1): the current canonical CarUp vehicle owner, and nobody else.
 * `vehicles.owner_id` is read HERE — inside the trusted producer, as an internal routing fact — and
 * is never handed to the Email layer, never placed on the public projection, and never rendered.
 * With no resolvable active owner there is no Email; a dealer tenant is organisational scope, not
 * one deterministic human, and guessing a recipient for a message about someone's vehicle is worse
 * than sending nothing.
 */
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { PUBLIC_TRUST_FIELDS, toPublicTrust } from './canonicalTrustService.js';

/** One event identity, not a family of overlapping ones. */
export const TRUST_PRESENTATION_CHANGED_EVENT = 'vehicle.trust.presentation_changed';
export const TRUST_PRESENTATION_CONTRACT_VERSION = 1;

/**
 * The fields whose change is customer-visible.
 *
 * Derived from the live `PUBLIC_TRUST_FIELDS` contract rather than a second list, so the comparison
 * cannot drift from what is actually published. `evaluated_at` and `vin` are excluded on purpose:
 * a fresh timestamp is not news, and re-mailing someone every time a recompute runs would teach
 * them to ignore the messages that matter.
 */
export const MATERIAL_TRUST_FIELDS = Object.freeze(
  PUBLIC_TRUST_FIELDS.filter((field) => field !== 'evaluated_at' && field !== 'vin'),
);

function stableValue(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify([...value]);
  if (value && typeof value === 'object') {
    return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => ({ ...acc, [key]: value[key] }), {}));
  }
  return JSON.stringify(value ?? null);
}

/**
 * Which material fields differ between two public Trust projections.
 *
 * Returns the field names, so an event and an audit line can say WHAT moved rather than that
 * something did — the difference between a report and a shrug.
 */
export function materialTrustChanges(previous, next) {
  const before = previous ? toPublicTrust(previous) : null;
  const after = next ? toPublicTrust(next) : null;
  if (!after) return [];
  if (!before) return [...MATERIAL_TRUST_FIELDS];
  return MATERIAL_TRUST_FIELDS.filter((field) => stableValue(before[field]) !== stableValue(after[field]));
}

/**
 * The current canonical owner, as an internal routing fact.
 *
 * Deliberately strict. An owner reference that is missing, or points at an account that is not
 * active, yields null — and null means no Email. There is no fallback to a dealer tenant, a listing
 * viewer, a saved-car user, a buyer, a previous owner, a mechanic or a garage: none of those is the
 * person whose vehicle this is.
 */
export async function resolveCurrentVehicleOwner(vin, client) {
  if (!vin || !client) return null;
  const { data: vehicle, error } = await client
    .from('vehicles')
    .select('vin, owner_id')
    .eq('vin', vin)
    .maybeSingle();
  if (error || !vehicle?.owner_id) return null;

  const { data: owner, error: ownerError } = await client
    .from('users')
    .select('id, status, deleted_at')
    .eq('id', vehicle.owner_id)
    .maybeSingle();
  if (ownerError || !owner?.id) return null;
  if (owner.deleted_at) return null;
  if (owner.status && ['inactive', 'suspended', 'deleted', 'banned'].includes(String(owner.status).toLowerCase())) return null;
  return owner.id;
}

/**
 * Emit the Trust presentation change, when there is one and someone to tell.
 *
 * Returns a verdict rather than throwing. A Trust refresh is a background correctness operation;
 * failing to announce its result must never fail the write that produced it.
 */
export async function emitTrustPresentationChange({
  vin, previousRecord, nextRecord, client, tenantId = null, pgClient = null,
} = {}) {
  if (!vin || !nextRecord) return { emitted: false, reason: 'no_record' };

  const changed = materialTrustChanges(previousRecord, nextRecord);
  if (!changed.length) return { emitted: false, reason: 'no_material_change' };

  const recipientUserId = await resolveCurrentVehicleOwner(vin, client);
  if (!recipientUserId) return { emitted: false, reason: 'no_resolvable_owner', changed };

  const previousPublic = previousRecord ? toPublicTrust(previousRecord) : null;
  const nextPublic = toPublicTrust(nextRecord);

  // The event type is written as a LITERAL here on purpose. The coverage gate greps for an emit
  // call with a quoted event type, and it is right to: a constant makes an emitter invisible to the
  // check that exists to prove emitters are real. The exported constant remains the public identity,
  // and a test pins that the two agree.
  await emitDomainEvent(pgClient, 'vehicle.trust.presentation_changed', {
    // The canonical vehicle identifier and the internal routing identity. `owner_id` appears ONLY as
    // `recipientUserId`, which the notification layer uses to address a person — never as content.
    vin,
    recipientUserId,
    contract_version: TRUST_PRESENTATION_CONTRACT_VERSION,
    changed_fields: changed,
    // Audience-safe projections only. No private evidence, no vehicle row, no legacy trust_score.
    previous_trust: previousPublic
      ? { evaluation_state: previousPublic.evaluation_state, band: previousPublic.band, score: previousPublic.score }
      : null,
    trust: nextPublic,
  }, tenantId);

  return { emitted: true, recipientUserId, changed };
}

export default emitTrustPresentationChange;
