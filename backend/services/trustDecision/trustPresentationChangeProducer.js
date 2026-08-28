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
import crypto from 'node:crypto';

import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { PUBLIC_TRUST_FIELDS, toPublicTrust } from './canonicalTrustService.js';

/** One event identity, not a family of overlapping ones. */
export const TRUST_PRESENTATION_CHANGED_EVENT = 'vehicle.trust.presentation_changed';
export const TRUST_PRESENTATION_CONTRACT_VERSION = 1;

/** Where the durable announcement marker lives. */
export const ANNOUNCED_FINGERPRINT_COLUMN = 'trust_presentation_announced_fingerprint';

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

/**
 * The fingerprint of a public Trust presentation.
 *
 * R5-D1. This is what makes a lost announcement recoverable, and it is also the idempotency key.
 *
 * The comparison that matters is "what did we TELL the owner?", not "what did we last write?". The
 * original implementation compared the new cache against the previous cache, so if the outbox insert
 * failed after the cache write, the next refresh saw no material change and the event was lost
 * PERMANENTLY. Comparing against the ANNOUNCED fingerprint means an announcement that never happened
 * is still outstanding, and will be retried until it succeeds.
 *
 * Built from the material fields only, in a fixed order, so the same transition always produces the
 * same value — reconciling it twice emits once.
 */
export function trustPresentationFingerprint(record) {
  if (!record) return null;
  const projection = toPublicTrust(record);
  const material = MATERIAL_TRUST_FIELDS
    .map((field) => `${field}=${stableValue(projection[field])}`)
    .join('\u001f');
  return crypto.createHash('sha256').update(`${TRUST_PRESENTATION_CONTRACT_VERSION}\u001e${projection.vin}\u001e${material}`, 'utf8').digest('hex');
}

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
  // TERMINAL vs TRANSIENT. "This vehicle has no eligible owner" is a settled fact about the world:
  // retrying it forever would let one such vehicle hold the front of the reconciliation queue and
  // starve every genuinely recoverable announcement behind it. "I could not find out who the owner
  // is" is a database fault, and abandoning the announcement over one would silently lose it.
  // Collapsing the two is what let the scanner starve, so they are now different answers.
  const { data: vehicle, error } = await client
    .from('vehicles')
    .select('vin, owner_id')
    .eq('vin', vin)
    .maybeSingle();
  if (error) return { known: false, userId: null };
  if (!vehicle?.owner_id) return { known: true, userId: null };

  const { data: owner, error: ownerError } = await client
    .from('users')
    .select('id, status, deleted_at')
    .eq('id', vehicle.owner_id)
    .maybeSingle();
  if (ownerError) return { known: false, userId: null };
  if (!owner?.id) return { known: true, userId: null };
  if (owner.deleted_at) return { known: true, userId: null };
  if (owner.status && ['inactive', 'suspended', 'deleted', 'banned'].includes(String(owner.status).toLowerCase())) {
    return { known: true, userId: null };
  }
  return { known: true, userId: owner.id };
}

/**
 * Whether the durable announcement marker was actually recorded.
 *
 * `recorded` — the event is durable AND the marker names it. Nothing is outstanding.
 * `pending`  — the event is durable but the marker write did not land. The announcement HAPPENED;
 *              only the bookkeeping is behind, so reconciliation must repair it. This is not a
 *              failure of the announcement and must never be reported as one, nor as a full success.
 */
export const TRUST_MARKER_STATES = Object.freeze({ RECORDED: 'recorded', PENDING: 'pending' });

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

  const fingerprint = trustPresentationFingerprint(nextRecord);

  // The durable marker is the authority on whether this presentation has been announced. A
  // `previousRecord` comparison alone would treat a never-announced change as already handled the
  // moment the cache was written — which is exactly how R5-D1 lost events.
  const marker = await readAnnouncedFingerprint(vin, client);
  // UNKNOWN IS NOT PERMISSION. Without a readable marker there is no way to tell an outstanding
  // announcement from one already delivered, and guessing "not yet" re-announces to a real owner.
  // Declining defers the announcement; the marker stays outstanding and reconciliation delivers it
  // once the store is readable again. This is the same fail-closed rule G3 applies to consent.
  if (!marker.known) {
    return { emitted: false, reason: 'announcement_state_unavailable', fingerprint };
  }
  const announced = marker.fingerprint;
  if (announced && announced === fingerprint) {
    return { emitted: false, reason: 'already_announced', fingerprint };
  }

  // `changed` is still computed for the audit line — it names WHAT moved. But an outstanding
  // announcement is emitted even when the cache did not move since the previous read, because the
  // question is whether the owner was told, not whether the value changed twice.
  const changed = materialTrustChanges(previousRecord, nextRecord);
  const outstanding = announced !== fingerprint;
  if (!changed.length && !outstanding) return { emitted: false, reason: 'no_material_change', fingerprint };
  if (!changed.length && announced === null && !previousRecord) {
    // Nothing has ever been announced and there is no prior position: treat every material field as
    // new rather than as unchanged.
    changed.push(...MATERIAL_TRUST_FIELDS);
  }

  const ownership = await resolveCurrentVehicleOwner(vin, client);
  if (!ownership.known) {
    // Transient: retry later. The announcement stays outstanding.
    return { emitted: false, reason: 'owner_lookup_unavailable', transient: true, changed, fingerprint };
  }
  if (!ownership.userId) {
    // Terminal for THIS presentation. There is nobody to tell and guessing is forbidden, so the
    // work is settled rather than pending. A future material change re-opens it.
    return { emitted: false, reason: 'no_resolvable_owner', terminal: true, changed, fingerprint };
  }
  const recipientUserId = ownership.userId;

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
    // The deterministic identity of this presentation. A consumer can dedupe on it, and
    // reconciliation of the same transition produces the same value.
    presentation_fingerprint: fingerprint,
    changed_fields: changed,
    // Audience-safe projections only. No private evidence, no vehicle row, no legacy trust_score.
    previous_trust: previousPublic
      ? { evaluation_state: previousPublic.evaluation_state, band: previousPublic.band, score: previousPublic.score }
      : null,
    trust: nextPublic,
  }, tenantId);

  // The marker is written ONLY after the event is durably persisted. If the emit above throws, the
  // marker stays stale and the announcement remains outstanding — which is the whole point.
  //
  // C3-C: the marker write can ALSO fail on its own, and that is a different fact from the emit
  // failing. Reporting an unqualified success there was the defect: the event is durable, the
  // marker is not, and a caller told "announced" has no way to know a repair is still outstanding.
  // The two states are now named, and the return value is no longer discarded.
  const marked = await markAnnounced(vin, fingerprint, client);

  // The durable event is NEVER rolled back because the marker failed. It is a real thing that
  // really happened; deleting it to tidy the bookkeeping would destroy the announcement itself.
  // Instead the marker stays outstanding and reconciliation repairs it — which is safe precisely
  // because `vehicle.trust.presentation_changed` is now database-idempotent on its fingerprint
  // (C3-A/C3-B), so the retry recovers the SAME event rather than creating a second one.
  return {
    emitted: true,
    marker: marked ? TRUST_MARKER_STATES.RECORDED : TRUST_MARKER_STATES.PENDING,
    recipientUserId,
    changed,
    fingerprint,
  };
}

/** The fingerprint of the presentation last announced for this vehicle, or null. */
/**
 * Read the durable marker.
 *
 * Returns `{ known, fingerprint }`, because "this vehicle has never been announced" and "I could
 * not find out whether it has been announced" are different facts and collapsing them is what makes
 * a duplicate storm possible.
 *
 * The case that forces the distinction is real and imminent: if the application is deployed before
 * `trust_presentation_announced_fingerprint` exists, EVERY read errors. Treating that as "never
 * announced" would re-announce every material Trust change on every refresh, for as long as the
 * window lasts — not a rare race, a 100% duplication rate. Reporting `known: false` lets the caller
 * decline to emit, which defers announcements until the column exists rather than flooding.
 */
async function readAnnouncedFingerprint(vin, client) {
  if (!client) return { known: false, fingerprint: null };
  try {
    const { data, error } = await client
      .from('vehicles')
      .select(ANNOUNCED_FINGERPRINT_COLUMN)
      .eq('vin', vin)
      .maybeSingle();
    // An error is UNKNOWN. A successful read with no row is a genuine "no such vehicle", and a
    // successful read with a null column is a genuine "never announced" — both are known answers.
    if (error) return { known: false, fingerprint: null };
    return { known: true, fingerprint: data?.[ANNOUNCED_FINGERPRINT_COLUMN] || null };
  } catch {
    return { known: false, fingerprint: null };
  }
}

/**
 * Record that this presentation was announced.
 *
 * A failure here is safe in the direction that matters: the marker stays stale, the announcement
 * looks outstanding, and reconciliation retries. That produces at most a duplicate attempt, which
 * `already_announced` then absorbs — and a duplicate attempt is a far better failure than a
 * customer never being told their vehicle's trust position changed.
 */
async function markAnnounced(vin, fingerprint, client) {
  if (!client || !fingerprint) return false;
  try {
    const { error } = await client
      .from('vehicles')
      .update({ [ANNOUNCED_FINGERPRINT_COLUMN]: fingerprint })
      .eq('vin', vin);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Re-announce a Trust presentation whose event never reached the outbox.
 *
 * The recovery path R5-D1 requires. It reads the canonical position, compares it against the durable
 * marker, and emits when they disagree — so a change that was written but never announced is
 * eventually announced, exactly once, without a second Trust writer and without recomputing anything.
 */
export async function reconcileTrustPresentation(vin, { client, getRecord, tenantId = null, pgClient = null } = {}) {
  if (!vin || !client || typeof getRecord !== 'function') return { emitted: false, reason: 'not_reconcilable' };
  const record = await getRecord(vin);
  if (!record) return { emitted: false, reason: 'no_record' };
  return emitTrustPresentationChange({
    vin,
    // No previous position is supplied: the durable marker, not a cache diff, decides whether this
    // is outstanding. That is precisely the distinction the original implementation collapsed.
    previousRecord: null,
    nextRecord: record,
    client,
    tenantId,
    pgClient,
  });
}

export default emitTrustPresentationChange;
