import { supabase } from '../../db/supabase.js';
import { SHIPMENT_STATUSES, IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateShipmentPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { transitionImportOrder } from './diasporaWorkflowService.js';
import { emitDiasporaEvent } from './diasporaNotificationService.js';
import { notifyShipmentException, isExceptionStage } from './shipmentExceptionNotifier.js';
import { requireUserContext, canManageLogistics, assertCanReadImportOrder, isPlatformReviewer, isPlatformAdmin, isTenantAdminForRecord, isSailingOperator } from './diasporaAuthorization.js';

// Authorize a read against the import order this shipment belongs to (buyer owns it, or reviewer/admin).
async function assertOrderReadAccess(importOrderId, userContext) {
  if (!importOrderId) throw new ValidationError('importOrderId is required');
  const { data: order, error } = await supabase.from('diaspora_import_orders').select('*').eq('id', importOrderId).is('deleted_at', null).single();
  if (error || !order) throw new NotFoundError('Diaspora import order not found');
  const { data: participants } = await supabase.from('diaspora_import_order_participants').select('*').eq('import_order_id', importOrderId).is('deleted_at', null);
  assertCanReadImportOrder(order, participants || [], userContext);
  return order;
}

/**
 * Who may create or move a shipment.
 *
 * `canManageLogistics` reads authority off the affected record's tenant. For a shipment that is not
 * on a co-loaded container that is the whole answer. For one that IS, it was the wrong question: a
 * diaspora buyer's import order carries no tenant at all, so on every co-loaded sailing the check
 * fell through to platform admins and reviewers only — and the container's own operator, who had
 * just planned the load, loaded it and sealed it under T10, was refused. Found on the deployed
 * product, where the first act of the T11 journey was a 403 for the person the phase is for.
 *
 * So a container-bound shipment additionally accepts the operator OF THAT CONTAINER — the same test
 * T10 applies before it will let anyone complete its load, read off the container row rather than
 * from a header. It widens nothing else: another sailing's operator, a buyer, and a foreign tenant
 * are refused exactly as before, and a shipment with no container keeps the original rule.
 */
export async function assertMayMoveShipment(order, containerId, context, client = supabase) {
  if (canManageLogistics(order, context)) return;
  if (containerId) {
    const { data: container } = await client
      .from('diaspora_container_shipments').select('*').eq('id', containerId).is('deleted_at', null).maybeSingle();
    if (container && isSailingOperator(container, context)) return;
  }
  throw new ForbiddenError('You are not authorized to manage Diaspora shipment logistics');
}

/**
 * T11.1 — which stage may follow which.
 *
 * Before this, any stage could follow any stage, so a timeline could be written backwards and assert
 * that goods went back to sea after arriving.
 *
 * The rule is **forward or lateral, never backward** — and the first version of it was wrong in a way
 * worth recording. It demanded the ordinary sequence, refusing `PLANNED → IN_TRANSIT`. But a stage
 * that was never recorded is a stage nobody observed, not one that did not happen: an operator who
 * learns a ship sailed, having never logged BOOKED or LOADING, would have had to invent two facts to
 * record the one they had. **Forcing invented intermediate states is exactly the failure this
 * programme exists to prevent**, and the existing authorization suite caught it.
 *
 * So skipping forward is allowed. Rewinding is not.
 */
const STAGE_RANK = Object.freeze({
  PLANNED: 0,
  BOOKED: 1,
  LOADING: 2,
  IN_TRANSIT: 3,
  ARRIVED: 4,
  CUSTOMS_HOLD: 5,
  RELEASED: 6,
  COMPLETED: 7,
});

/**
 * `EXCEPTION` has no rank on purpose. It is something that happens TO a shipment rather than a place
 * in its journey, so it is reachable from anywhere still moving, and leaving it returns to wherever
 * the goods actually are — which the operator knows and this map does not.
 */
const EXCEPTION_STAGE = 'EXCEPTION';

/**
 * The one legitimate backward step: a customs hold being LIFTED.
 *
 * The goods did not move; a hold was placed and then released, and they are still arrived. Every
 * other backward transition is refused.
 */
const ALLOWED_REVERSALS = Object.freeze([['CUSTOMS_HOLD', 'ARRIVED']]);

export function assertShipmentTransition(currentStage, nextStage) {
  if (currentStage === nextStage) {
    // Not an error and not a second event: re-reporting the stage a shipment is already at is what a
    // retried request looks like. The caller is told nothing changed.
    return { unchanged: true };
  }

  const refuse = (why) => {
    throw new ValidationError(
      `A shipment at ${currentStage} cannot move to ${nextStage}. ${why}`,
      { code: 'ILLEGAL_SHIPMENT_TRANSITION', currentStage, nextStage },
    );
  };

  if (currentStage === 'COMPLETED') refuse('A completed shipment is finished.');
  if (nextStage === EXCEPTION_STAGE) return { unchanged: false };
  if (currentStage === EXCEPTION_STAGE) {
    if (!(nextStage in STAGE_RANK)) refuse('That is not a stage a shipment can be at.');
    return { unchanged: false };
  }

  const from = STAGE_RANK[currentStage];
  const to = STAGE_RANK[nextStage];
  if (from === undefined) refuse('That is not a stage a shipment can be at.');
  if (to === undefined) refuse('That is not a stage a shipment can be at.');
  if (ALLOWED_REVERSALS.some(([a, b]) => a === currentStage && b === nextStage)) return { unchanged: false };
  if (to < from) {
    // A stage that was skipped is a stage nobody recorded. A stage that is REVISITED would be a
    // claim that the goods went back, and a timeline that can be written backwards is not a record
    // of movement.
    refuse('A shipment cannot go backwards — that would say the goods moved back.');
  }
  return { unchanged: false };
}

/**
 * T11.1 — a shipment may only exist for a container that was actually loaded.
 *
 * `createShipment` took `container_id` as a free optional field and checked nothing, so a shipment
 * could be created for a container with no manifest, no cargo and no T10 load — the same free-claim
 * shape T10 closed on `mark-loading`.
 *
 * The requirement is a **COMPLETED** T10 load, and that is derived from T10's own design rather than
 * invented: a completed load may legitimately carry `LEFT_BEHIND` lines, so demanding "all cargo
 * loaded" would make T10's left-behind path unable to ever produce a shipment.
 *
 * An `ABANDONED` load is refused. Whether an abandoned load should ever produce a shipment is an
 * operational policy question with no repository evidence either way, so this takes the conservative
 * reading and says so rather than guessing.
 *
 * A shipment with no container at all is untouched: not every shipment is a co-loaded container, and
 * T11 is not the place to make that a requirement.
 */
async function assertContainerWasLoaded(containerId, client) {
  if (!containerId) return;
  const { data } = await client.from('diaspora_container_loads').select('id, status')
    .eq('container_id', containerId).is('deleted_at', null);
  const completed = (data || []).filter((l) => String(l.status) === 'COMPLETED');
  if (!completed.length) {
    const abandoned = (data || []).some((l) => String(l.status) === 'ABANDONED');
    throw new ValidationError(
      abandoned
        ? 'Loading this container was abandoned, so a shipment cannot be created for it.'
        : 'This container has no completed load, so there is nothing recorded as being inside it. Complete the load first.',
      { code: 'SHIPMENT_WITHOUT_COMPLETED_LOAD', containerId },
    );
  }
}

/**
 * Which shipment stages may move the purchase's own status — **movement facts only**.
 *
 * T11.1's audit flagged this map as a T11/T12 boundary leak and left it alone. Looking at the import
 * order's own ladder makes it worse than "shaped like customs":
 *
 *     ARRIVED_AT_BORDER → CUSTOMS_IN_PROGRESS → DUTY_PENDING → DUTY_PAID → RELEASED
 *
 * `RELEASED` sits **after DUTY_PAID**. So a shipment stage transition was writing a purchase status
 * meaning duty had been paid and the goods released by an authority — from a movement action, with
 * no assessment, no payment evidence and no authority anywhere in the picture. `CUSTOMS_HOLD →
 * CUSTOMS_IN_PROGRESS` was the same error one step earlier: a hold is where the goods ARE, not proof
 * that a declaration is being processed.
 *
 * That is precisely "a T11 movement action manufacturing a T12 customs fact", so the three customs
 * and completion entries are removed. What remains is only what movement can honestly establish:
 *
 *     the goods are being loaded · the goods departed · the goods reached the border
 *
 * **`CUSTOMS_HOLD` still records the exception** on the shipment and still reaches the customer
 * through T7 — T11 may say "your shipment is held", which is an observation of where the cargo is.
 * It may not say a declaration is in progress. **T12 owns everything from CUSTOMS_IN_PROGRESS
 * onward**, and the existing rows are untouched: this changes what is written from now on, not
 * history.
 */
const SHIPMENT_TO_IMPORT_STATUS = Object.freeze({
  LOADING: IMPORT_ORDER_STATUSES.READY_FOR_LOADING,
  IN_TRANSIT: IMPORT_ORDER_STATUSES.SHIPPED,
  ARRIVED: IMPORT_ORDER_STATUSES.ARRIVED_AT_BORDER,
});

/**
 * The stages T11 deliberately no longer projects onto the purchase, and who owns them instead.
 * Exported so the boundary is testable rather than a comment somebody can quietly delete.
 */
export const STAGES_HANDED_TO_T12 = Object.freeze({
  CUSTOMS_HOLD: 'T12 — a hold is where the goods are; a declaration being processed is a customs fact',
  RELEASED: 'T12 — the purchase ladder puts RELEASED after DUTY_PAID, so this asserted duty was paid',
  COMPLETED: 'T12 — a finished shipment is not a finished import; customs, registration and delivery follow',
});

export async function createShipment(payload, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  validateShipmentPayload(payload);
  const { data: order, error: orderError } = await supabase.from('diaspora_import_orders').select('*').eq('id', payload.import_order_id).single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');
  // Creating an official shipment is a logistics action — for the order's tenant, or for the
  // operator of the container it sails on.
  await assertMayMoveShipment(order, payload.container_id || null, context);
  // …and for a co-loaded container, it also requires that something was actually loaded into it.
  await assertContainerWasLoaded(payload.container_id || null, supabase);

  const { data, error } = await supabase
    .from('diaspora_shipments')
    .insert({
      tenant_id: userContext?.tenantId || order.tenant_id,
      import_order_id: payload.import_order_id,
      container_id: payload.container_id || null,
      carrier_name: payload.carrier_name || null,
      tracking_number: payload.tracking_number || null,
      origin_port: payload.origin_port || null,
      destination_port: payload.destination_port || null,
      // T11.1 — a date supplied at CREATE is a plan, not an observation.
      //
      // `departure_date` was a free field, so an intended sail date and the fact that a ship sailed
      // were the same column. A customer reading "departed" deserves the second. The planned date is
      // kept where it belongs and the column stays NULL until a real IN_TRANSIT transition sets it.
      departure_date: null,
      estimated_arrival_date: payload.estimated_arrival_date || null,
      // Likewise: an arrival is observed, never declared at creation.
      actual_arrival_date: null,
      status: payload.status || SHIPMENT_STATUSES.PLANNED,
      metadata: {
        ...(payload.metadata || {}),
        ...(payload.departure_date ? { planned_departure_date: payload.departure_date, planned_departure_source: 'stated_at_creation' } : {}),
        ...(payload.actual_arrival_date ? { claimed_arrival_at_creation: payload.actual_arrival_date } : {}),
      },
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeShipmentStageEvent(data.id, data.status, 'Shipment created', userContext, req, { created: true });
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'SHIPMENT_CREATED', resourceType: 'diaspora_shipment', resourceId: data.id, newState: data, req });
  return data;
}

export async function listShipments({ importOrderId, status, limit = 50, offset = 0 }, userContext = {}) {
  const context = requireUserContext(userContext);
  // Buyers may only read shipments for an order they can access, scoped by importOrderId.
  if (!isPlatformReviewer(context) && !isPlatformAdmin(context)) {
    if (!importOrderId) throw new ValidationError('importOrderId is required to list shipments');
    await assertOrderReadAccess(importOrderId, context);
  }

  let query = supabase.from('diaspora_shipments').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function getShipment(id, userContext = {}) {
  const { data, error } = await supabase.from('diaspora_shipments').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora shipment not found');

  const hasUserContext = userContext && (userContext.id || userContext.userId || userContext.actorId);
  if (hasUserContext) {
    const context = requireUserContext(userContext);
    if (!isPlatformReviewer(context) && !isPlatformAdmin(context)) {
      if (isTenantAdminForRecord(data, context)) {
        return data;
      }
      await assertOrderReadAccess(data.import_order_id, context);
    }
  }

  return data;
}

export async function writeShipmentStageEvent(shipmentId, stage, notes, userContext = {}, req = null, metadata = {}) {
  const shipment = await getShipment(shipmentId).catch(() => null);
  const { data, error } = await supabase
    .from('diaspora_shipment_stage_events')
    .insert({
      shipment_id: shipmentId,
      import_order_id: shipment?.import_order_id || null,
      tenant_id: shipment?.tenant_id || userContext?.tenantId || null,
      stage,
      notes,
      location: metadata.location || null,
      event_time: metadata.event_time || new Date().toISOString(),
      metadata,
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  return data;
}

/**
 * When a movement was observed.
 *
 * Defaults to now, accepts a stated time, and refuses the future outright: a ship has not sailed at
 * a time that has not happened, and a shipment dated forwards would make a tracking page lie about
 * where the goods are.
 *
 * This is applied to EVERY stage, not only the two that stamp a column. The first version guarded
 * `IN_TRANSIT` and `ARRIVED` — the stages with a `departure_date` and an `actual_arrival_date` to
 * write — and left every other stage's `event_time` unchecked. But the timeline is what a person
 * reads: an unguarded stage could put "Held at customs" a week into the future and the tracking page
 * would show it as something that had happened. A rule about observation is a rule about the whole
 * record of observations.
 */
function observedTime(stated, now) {
  if (!stated) return now;
  const when = new Date(stated);
  if (Number.isNaN(when.getTime())) throw new ValidationError('That is not a valid date and time');
  if (when.getTime() > Date.parse(now) + 60_000) {
    throw new ValidationError('A shipment cannot be recorded as moving at a time in the future');
  }
  return when.toISOString();
}

/**
 * The ONE observed time for a stage change, whatever shape the caller stated it in.
 *
 * Exported so the rule can be tested as a rule rather than inferred from where it happens to be
 * called: every stated form goes through the same validation, and the same value is what both the
 * shipment column and the timeline event are given.
 */
export function resolveObservedTime(payload = {}, now = new Date().toISOString()) {
  const stated = payload.event_time
    || payload.metadata?.event_time
    || payload.departure_date
    || payload.actual_arrival_date;
  return observedTime(stated, now);
}

export async function updateShipmentStage(id, payload, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  const nextStage = payload.stage || payload.status;
  if (!Object.values(SHIPMENT_STATUSES).includes(nextStage)) throw new ValidationError(`Invalid shipment stage: ${nextStage}`);
  const previous = await getShipment(id);
  // Advancing official shipment stage is a logistics action — same authority as creating it, so an
  // operator who could create a shipment cannot then be locked out of recording that it sailed.
  await assertMayMoveShipment(previous, previous.container_id || null, context);

  // T11.1 — the timeline cannot be written out of order, and a retry is not a second journey.
  const { unchanged } = assertShipmentTransition(previous.status, nextStage);
  if (unchanged) {
    const timeline = await supabase.from('diaspora_shipment_stage_events').select('*')
      .eq('shipment_id', id).eq('stage', nextStage).is('deleted_at', null)
      .order('event_time', { ascending: false }).limit(1);
    return { shipment: previous, stageEvent: timeline.data?.[0] || null, unchanged: true };
  }

  const now = new Date().toISOString();

  // T11.1 — ONE observed time, validated once, used everywhere.
  //
  // It used to be read in two unrelated places: the column took `payload.event_time`, and the stage
  // event took `payload.metadata.event_time`. Two consequences, both wrong. A caller stating the
  // real departure time moved the column and left the timeline stamped `now`, so the shipment and
  // its own history disagreed about when it sailed. And a stage that writes no column — a customs
  // hold, an exception — reached the timeline through the other path, which validated nothing, so a
  // movement could be recorded in the future after all.
  const observedAt = resolveObservedTime(payload, now);

  const { data, error } = await supabase
    .from('diaspora_shipments')
    .update({
      status: nextStage,
      // T11.1 — these are OBSERVED, stamped when the movement is actually reported rather than
      // accepted as a claim at creation.
      ...(nextStage === SHIPMENT_STATUSES.IN_TRANSIT ? { departure_date: observedAt } : {}),
      ...(nextStage === SHIPMENT_STATUSES.ARRIVED ? { actual_arrival_date: observedAt } : {}),
      updated_by: userContext?.id,
      updated_at: now,
      metadata: { ...(previous.metadata || {}), lastStage: payload },
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  const stageEvent = await writeShipmentStageEvent(id, nextStage, payload.notes || `Shipment moved to ${nextStage}`, userContext, req, { ...(payload.metadata || {}), event_time: observedAt });
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'SHIPMENT_STAGE_CHANGED', resourceType: 'diaspora_shipment', resourceId: id, previousState: { status: previous.status }, newState: { status: nextStage }, metadata: { stageEventId: stageEvent.id }, req });
  await emitDiasporaEvent(`DIASPORA_SHIPMENT_${nextStage}`, { shipmentId: id, importOrderId: data.import_order_id, stage: nextStage }, data.tenant_id);

  // T7.5 — the customer-facing half. After the audited authoritative change, never before it, and
  // never in a way that can alter it: an exception the customer is not told about is the one stage
  // that most needs saying.
  if (isExceptionStage(nextStage)) {
    await notifyShipmentException({
      shipment: data, stage: nextStage, notes: payload.notes || null, tenantId: data.tenant_id,
    });
  }

  const importStatus = SHIPMENT_TO_IMPORT_STATUS[nextStage];
  if (importStatus) {
    try {
      await transitionImportOrder({ importOrderId: data.import_order_id, nextStatus: importStatus, actorId: userContext?.id, userContext, metadata: { shipmentId: id, shipmentStage: nextStage }, req });
    } catch (err) {
      console.warn(`Skipping automatic import transition for shipment stage ${nextStage}:`, err.message);
    }
  }

  return { shipment: data, stageEvent };
}

export async function getShipmentTimeline(id, userContext = {}) {
  // Enforce read access/existence checks via getShipment
  await getShipment(id, userContext);

  const { data, error } = await supabase.from('diaspora_shipment_stage_events').select('*').eq('shipment_id', id).is('deleted_at', null).order('event_time', { ascending: true });
  if (error) throw new DatabaseError(error.message);
  return data || [];
}
