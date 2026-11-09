/**
 * Trade OS T10.2 — load readiness, the plan, and the loaded fact.
 *
 * The T10.0 audit found the word "loaded" in five places and the fact in none, so this service owns
 * the fact and nothing else. It reads T5 (what space was committed), T9 (what physically arrived and
 * how big it really is) and T8 (what paperwork exists), and it writes only T10's own tables.
 *
 * Three things are load-bearing:
 *
 *  1. **Readiness is DERIVED, never stored.** It is a projection over facts other phases own, and it
 *     always carries its reasons. A stored `is_ready` boolean is a fact about the past that keeps
 *     asserting itself after the facts underneath it change — and a magic true/false gives an
 *     operator nothing to act on.
 *
 *  2. **A plan is not a load.** Planning to put something in a container is an intention; putting it
 *     in is an attributed act. Two records, two lifecycles, and a planned item never becomes a
 *     loaded item without somebody confirming it.
 *
 *  3. **Nothing here writes T5, T9 or T11.** Not the capacity ledger, not the customer's estimate,
 *     not a warehouse measurement, and above all not a shipment: LOADED is not DEPARTED.
 *
 * On readiness and paperwork: T10 may say a document is PRESENT or MISSING, because T8 knows that.
 * It may never say a shipment is legally cleared to travel — that is T12's, and the fabricated
 * customs values in `documentIntelligenceService` are deliberately untouched and unused.
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
import { resolveClient, appendCriticalAudit, appendBestEffortAudit } from './diasporaServiceUtils.js';
import { notifyCargoLoaded, notifyCargoLeftBehind } from './loadingLifecycleNotifier.js';

const CONTAINERS = 'diaspora_container_shipments';
const RESERVATIONS = 'diaspora_cargo_reservations';
const INTAKES = 'diaspora_warehouse_intakes';
const MEASUREMENTS = 'diaspora_warehouse_measurements';
const DOCUMENTS = 'diaspora_trade_documents';
const PLANS = 'diaspora_container_load_plans';
const PLAN_ITEMS = 'diaspora_container_load_plan_items';
const LOADS = 'diaspora_container_loads';
const LOAD_ITEMS = 'diaspora_container_load_items';
const SEALS = 'diaspora_container_seal_records';

export const PLAN_STATUSES = Object.freeze({ DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED', SUPERSEDED: 'SUPERSEDED', CANCELLED: 'CANCELLED' });
export const LOAD_STATUSES = Object.freeze({ IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', ABANDONED: 'ABANDONED' });

export const EXCLUSION_REASONS = Object.freeze([
  'NOT_RECEIVED', 'DOES_NOT_FIT', 'DOCUMENTS_OUTSTANDING', 'CONDITION_ISSUE',
  'PARTICIPANT_REQUEST', 'OPERATIONAL_EXCEPTION',
]);
export const LEFT_BEHIND_REASONS = Object.freeze([
  'NO_SPACE', 'DID_NOT_FIT', 'CONDITION_ISSUE', 'DOCUMENTS_OUTSTANDING',
  'NOT_PRESENTED', 'PARTICIPANT_REQUEST', 'OPERATIONAL_EXCEPTION',
]);

/**
 * The reasons a consignment is not ready, in the operator's own terms.
 *
 * Deliberately a fixed list. "Not ready" with no reason is the magic boolean this service exists to
 * avoid, and free-text reasons are how a vocabulary stops being auditable.
 */
export const READINESS_BLOCKERS = Object.freeze({
  NOT_APPROVED: 'The booking has not been approved, so no space is committed for it.',
  NOT_RECEIVED: 'The warehouse has not received this cargo.',
  REFUSED_AT_INTAKE: 'The warehouse did not take this cargo in.',
  NOT_MEASURED: 'Nobody has measured this cargo, so there is no actual size to plan against.',
  CONDITION_NOTED: 'The warehouse recorded a problem with the cargo when it arrived.',
});

const privileged = (ctx) => isPlatformAdmin(ctx) || isPlatformReviewer(ctx);

/** Who runs this sailing. The same predicate T5 and T7 use — one sailing, one idea of its operator. */
function isOperator(container, context) {
  const coordinator = normalizeId(container.coordinator_id || container.created_by);
  if (coordinator && coordinator === context.id) return true;
  return privileged(context) || isTenantAdminForRecord(container, context);
}

function assertOperator(container, context) {
  if (!isOperator(container, context)) {
    throw new ForbiddenError('You are not authorized to plan or load this sailing');
  }
}

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

function positiveOrNull(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`${field} must be a number greater than zero`);
  return Math.round(n * 1000) / 1000;
}

async function loadContainer(client, containerId) {
  const id = requireText(containerId, 'containerId');
  const { data } = await client.from(CONTAINERS).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!data) throw new NotFoundError('Sailing not found');
  return data;
}

// ── Readiness ──────────────────────────────────────────────────────────────

/**
 * Is this consignment ready to go in the box, and if not, why not?
 *
 * A pure function over facts already read. Every blocker names the phase that owns it, so an
 * operator looking at "not ready" can see whose problem it is and go and fix it.
 *
 * What it deliberately does NOT do: assert anything about customs, legal clearance, or whether the
 * documents present are the RIGHT documents. T8 knows a file exists; T12 will know what the law
 * wants. Reporting "3 documents present" is true; reporting "customs ready" would not be.
 */
export function deriveReadiness({ reservation, intake, measurement, documentCount = 0 }) {
  const blockers = [];
  if (String(reservation?.reservation_status || '').toUpperCase() !== 'APPROVED') blockers.push('NOT_APPROVED');

  const status = String(intake?.status || '').toUpperCase();
  if (!intake || status === 'EXPECTED') blockers.push('NOT_RECEIVED');
  else if (status === 'REFUSED') blockers.push('REFUSED_AT_INTAKE');

  if (!measurement || measurement.actual_volume_cbm === null || measurement.actual_volume_cbm === undefined) {
    blockers.push('NOT_MEASURED');
  }
  // An advisory blocker, not a refusal: an operator may knowingly load damaged cargo, and the point
  // is that they see it rather than that the system decides for them.
  if (intake?.condition && intake.condition !== 'good') blockers.push('CONDITION_NOTED');

  return {
    ready: blockers.length === 0,
    blockers: blockers.map((code) => ({ code, reason: READINESS_BLOCKERS[code] })),
    facts: {
      booking_approved: String(reservation?.reservation_status || '').toUpperCase() === 'APPROVED',
      received: status === 'RECEIVED' || status === 'CONDITIONALLY_RECEIVED',
      // Unknown stays unknown. `null` here means nobody measured it, not that it is zero.
      measured_volume_cbm: measurement?.actual_volume_cbm === null || measurement?.actual_volume_cbm === undefined
        ? null : Number(measurement.actual_volume_cbm),
      condition: intake?.condition || null,
      // Counted, never interpreted. T8 knows these exist; nothing here says they are sufficient.
      documents_present: Number(documentCount) || 0,
    },
    // Said in the payload so no screen can upgrade it.
    disclaimer: 'Ready to load means the cargo is here, measured and booked. It is not a statement about customs, duties or any legal permission to travel.',
  };
}

function currentMeasurement(rows = []) {
  const live = (rows || []).filter((m) => !m.deleted_at);
  if (!live.length) return null;
  return live.slice().sort((a, b) => String(b.measured_at || '').localeCompare(String(a.measured_at || '')))[0];
}

/**
 * Everything the operator needs about one sailing, in a bounded number of reads.
 *
 * Seven queries regardless of how many consignments are on the sailing — never one lookup per row.
 */
async function readSailingFacts(client, containerId) {
  const { data: reservations } = await client.from(RESERVATIONS).select('*')
    .eq('container_id', containerId).is('deleted_at', null);
  const live = (reservations || []).filter((r) => String(r.reservation_status).toUpperCase() !== 'CANCELLED');
  const subjectIds = live.map((r) => String(r.id));

  const [{ data: intakes }, { data: documents }] = await Promise.all([
    subjectIds.length
      ? client.from(INTAKES).select('*').eq('subject_type', 'cargo_reservation').in('subject_id', subjectIds).is('deleted_at', null)
      : Promise.resolve({ data: [] }),
    subjectIds.length
      ? client.from(DOCUMENTS).select('id, subject_type, subject_id').eq('subject_type', 'cargo_reservation').in('subject_id', subjectIds).is('deleted_at', null)
      : Promise.resolve({ data: [] }),
  ]);

  const intakeIds = (intakes || []).map((i) => i.id);
  const { data: measurements } = intakeIds.length
    ? await client.from(MEASUREMENTS).select('*').in('intake_id', intakeIds).is('deleted_at', null)
    : { data: [] };

  const intakeBySubject = new Map((intakes || []).map((i) => [String(i.subject_id), i]));
  const measurementsByIntake = new Map();
  for (const m of measurements || []) {
    if (!measurementsByIntake.has(m.intake_id)) measurementsByIntake.set(m.intake_id, []);
    measurementsByIntake.get(m.intake_id).push(m);
  }
  const docCountBySubject = new Map();
  for (const d of documents || []) {
    docCountBySubject.set(String(d.subject_id), (docCountBySubject.get(String(d.subject_id)) || 0) + 1);
  }

  return live.map((reservation) => {
    const intake = intakeBySubject.get(String(reservation.id)) || null;
    const measurement = intake ? currentMeasurement(measurementsByIntake.get(intake.id)) : null;
    return {
      subject: { type: 'cargo_reservation', id: String(reservation.id) },
      reservation,
      intake,
      measurement,
      readiness: deriveReadiness({ reservation, intake, measurement, documentCount: docCountBySubject.get(String(reservation.id)) || 0 }),
    };
  });
}

/**
 * The load-readiness queue for one sailing.
 *
 * Shows all three measurements side by side, because the operator is the person who has to notice
 * that a 3.0 CBM booking measured 3.8 and plan for the real one.
 */
export async function getLoadReadiness(containerId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const container = await loadContainer(client, containerId);
  assertOperator(container, context);

  const candidates = await readSailingFacts(client, container.id);
  const readyCount = candidates.filter((c) => c.readiness.ready).length;

  return {
    container: {
      id: container.id,
      reference: shortRef('SAIL', container.id),
      status: container.status,
      // T5's numbers, read and never written. Named "booked" so nothing mistakes them for actuals.
      booked_capacity: {
        total_cbm: Number(container.total_capacity_volume ?? 0),
        used_cbm: Number(container.used_capacity_volume ?? 0),
        available_cbm: Number(container.available_capacity_volume ?? 0),
        basis: 'Booked space, from the approved reservations. Not what has been measured or loaded.',
      },
    },
    candidates: candidates.map((c) => ({
      subject: c.subject,
      reference: shortRef('RES', c.subject.id),
      booked_volume_cbm: c.reservation.estimated_volume === null || c.reservation.estimated_volume === undefined
        ? null : Number(c.reservation.estimated_volume),
      warehouse_volume_cbm: c.readiness.facts.measured_volume_cbm,
      intake_status: c.intake?.status || null,
      condition: c.intake?.condition || null,
      readiness: c.readiness,
    })),
    summary: {
      total: candidates.length,
      ready: readyCount,
      not_ready: candidates.length - readyCount,
      // The sum of what was actually MEASURED, for the ready ones only, so an operator can compare
      // it against booked space. Consignments nobody measured contribute nothing rather than zero —
      // and the count of them is reported so the total is never read as complete.
      measured_ready_cbm: Math.round(candidates
        .filter((c) => c.readiness.ready && c.readiness.facts.measured_volume_cbm !== null)
        .reduce((t, c) => t + c.readiness.facts.measured_volume_cbm, 0) * 1000) / 1000,
      unmeasured: candidates.filter((c) => c.readiness.facts.measured_volume_cbm === null).length,
    },
  };
}

/**
 * Does the plan physically fit?
 *
 * The asymmetry here is deliberate and is the whole of §7:
 *
 *   a PLAN is a claim about the future — it can be wrong, and an impossible one is refused;
 *   an ACTUAL LOAD is an observation of the past — if a person says it went in, it went in.
 *
 * So this gates `confirmLoadPlan` and never `recordLoadItem`. A system that refused to record what
 * somebody watched happen, because its arithmetic disagreed, would be choosing its model over
 * reality — and the operator would write the truth down somewhere the system cannot see.
 *
 * It compares against the container's TOTAL capacity, not T5's `available_capacity_volume`. Booked
 * space is an entitlement ledger; this is about whether the boxes fit in the box. And nothing here
 * writes either number.
 */
export function projectPlanPressure(container, planItems = []) {
  const total = Number(container?.total_capacity_volume ?? 0);
  const included = (planItems || []).filter((i) => i.disposition === 'PLANNED_IN' && !i.deleted_at);
  const withVolume = included.filter((i) => i.planned_volume_cbm !== null && i.planned_volume_cbm !== undefined);
  const planned = Math.round(withVolume.reduce((t, i) => t + Number(i.planned_volume_cbm), 0) * 1000) / 1000;
  const unpriced = included.length - withVolume.length;
  const overBy = Math.round((planned - total) * 1000) / 1000;
  return {
    container_total_cbm: total,
    planned_in_cbm: planned,
    planned_in_lines: included.length,
    // Lines with no figure contribute nothing rather than zero, and are COUNTED so the total is
    // never read as complete.
    lines_without_volume: unpriced,
    over_capacity: overBy > 0,
    over_by_cbm: overBy > 0 ? overBy : 0,
    headroom_cbm: overBy > 0 ? 0 : Math.round((total - planned) * 1000) / 1000,
    note: unpriced > 0
      ? `${unpriced} planned line(s) have no measured volume, so this total is a floor rather than the whole plan.`
      : null,
  };
}

// ── The plan ───────────────────────────────────────────────────────────────

async function liveePlan(client, containerId) {
  const { data } = await client.from(PLANS).select('*')
    .eq('container_id', containerId).is('deleted_at', null).maybeSingle();
  if (!data) return null;
  return [PLAN_STATUSES.DRAFT, PLAN_STATUSES.CONFIRMED].includes(data.status) ? data : null;
}

/** Open a plan for a sailing. Idempotent: an existing live plan is handed back, not duplicated. */
export async function createLoadPlan(containerId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const container = await loadContainer(client, containerId);
  assertOperator(container, context);

  const existing = await liveePlan(client, container.id);
  if (existing) return { ...existing, already_existed: true };

  const id = randomUUID();
  const row = {
    id,
    tenant_id: container.tenant_id ? String(container.tenant_id) : null,
    container_id: container.id,
    reference: shortRef('LPLN', id),
    status: PLAN_STATUSES.DRAFT,
    planned_by: context.id,
    notes: optionalText(payload.notes, 'Notes'),
    created_by: context.id,
    updated_by: context.id,
  };
  const { data, error } = await client.from(PLANS).insert(row).select().single();
  if (error) {
    const winner = await liveePlan(client, container.id);
    if (winner) return { ...winner, already_existed: true };
    throw new ValidationError(`Could not start a load plan: ${error.message}`);
  }
  await appendBestEffortAudit(client, {
    actorId: context.id, tenantId: row.tenant_id, action: 'LOAD_PLAN_OPENED',
    resourceType: 'diaspora_container_load_plan', resourceId: data.id,
    newState: { container_id: container.id }, req: options.req,
  });
  return data;
}

/**
 * Put a consignment on the plan, in or out.
 *
 * The planned figure is taken from the WAREHOUSE MEASUREMENT when one exists, and from the booking
 * estimate otherwise — and the row records which. Planning against an estimate is legitimate; not
 * saying so is not.
 */
export async function setPlanItem(planId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data: plan } = await client.from(PLANS).select('*').eq('id', requireText(planId, 'planId')).is('deleted_at', null).maybeSingle();
  if (!plan) throw new NotFoundError('Load plan not found');
  const container = await loadContainer(client, plan.container_id);
  assertOperator(container, context);
  if (plan.status !== PLAN_STATUSES.DRAFT) {
    throw new ValidationError('This plan has been confirmed. Supersede it with a revision rather than editing it.');
  }

  const subjectType = String(payload.subjectType ?? payload.subject_type ?? 'cargo_reservation');
  if (!['cargo_reservation', 'logistics_request'].includes(subjectType)) {
    throw new ValidationError(`Unknown load-plan subject "${subjectType}"`);
  }
  const subjectId = requireText(payload.subjectId ?? payload.subject_id, 'subjectId', { max: 100 });
  const disposition = String(payload.disposition ?? 'PLANNED_IN').toUpperCase();
  if (!['PLANNED_IN', 'PLANNED_OUT'].includes(disposition)) {
    throw new ValidationError('A plan line is either planned in or planned out');
  }
  const exclusionReason = payload.exclusionReason ?? payload.exclusion_reason ?? null;
  if (disposition === 'PLANNED_OUT') {
    if (!exclusionReason || !EXCLUSION_REASONS.includes(String(exclusionReason))) {
      throw new ValidationError(`Say why this cargo is being left off the plan (${EXCLUSION_REASONS.join(', ')})`);
    }
  }

  // Server-derived figures. A client-supplied planned volume is a claim; the numbers here come from
  // the authorities that own them.
  const facts = await readSailingFacts(client, container.id);
  const candidate = facts.find((f) => f.subject.id === subjectId);
  let plannedVolume = null;
  let plannedWeight = null;
  let plannedSource = 'UNKNOWN';
  if (candidate) {
    if (candidate.readiness.facts.measured_volume_cbm !== null) {
      plannedVolume = candidate.readiness.facts.measured_volume_cbm;
      plannedWeight = candidate.measurement?.weight_value === null || candidate.measurement?.weight_value === undefined
        ? null
        : Math.round((candidate.measurement.weight_unit === 't' ? Number(candidate.measurement.weight_value) * 1000 : Number(candidate.measurement.weight_value)) * 1000) / 1000;
      plannedSource = 'WAREHOUSE_ACTUAL';
    } else if (candidate.reservation.estimated_volume !== null && candidate.reservation.estimated_volume !== undefined) {
      plannedVolume = Number(candidate.reservation.estimated_volume);
      plannedWeight = candidate.reservation.estimated_weight === null || candidate.reservation.estimated_weight === undefined
        ? null : Number(candidate.reservation.estimated_weight);
      plannedSource = 'BOOKED_ESTIMATE';
    }
  }
  // An excluded line carries no figure: it is not going in, so a volume would only be misleading.
  if (disposition === 'PLANNED_OUT') { plannedVolume = null; plannedWeight = null; plannedSource = 'UNKNOWN'; }

  const row = {
    load_plan_id: plan.id,
    tenant_id: plan.tenant_id,
    subject_type: subjectType,
    subject_id: subjectId,
    intake_id: candidate?.intake?.id || null,
    disposition,
    exclusion_reason: disposition === 'PLANNED_OUT' ? String(exclusionReason) : null,
    planned_volume_cbm: plannedVolume,
    planned_weight_kg: plannedWeight,
    planned_source: plannedSource,
    notes: optionalText(payload.notes, 'Notes'),
    created_by: context.id,
    updated_by: context.id,
  };

  const { data: existing } = await client.from(PLAN_ITEMS).select('*')
    .eq('load_plan_id', plan.id).eq('subject_type', subjectType).eq('subject_id', subjectId).is('deleted_at', null).maybeSingle();
  if (existing) {
    const { data, error } = await client.from(PLAN_ITEMS)
      .update({ ...row, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
    if (error) throw new ValidationError(`Could not update the plan line: ${error.message}`);
    return data;
  }
  const { data, error } = await client.from(PLAN_ITEMS).insert(row).select().single();
  if (error) throw new ValidationError(`Could not add the plan line: ${error.message}`);
  return data;
}

/** Commit to the plan. An attributed decision, not a state that drifts into being. */
export async function confirmLoadPlan(planId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data: plan } = await client.from(PLANS).select('*').eq('id', requireText(planId, 'planId')).is('deleted_at', null).maybeSingle();
  if (!plan) throw new NotFoundError('Load plan not found');
  const container = await loadContainer(client, plan.container_id);
  assertOperator(container, context);
  if (plan.status === PLAN_STATUSES.CONFIRMED) return { ...plan, already_confirmed: true };
  if (plan.status !== PLAN_STATUSES.DRAFT) throw new ValidationError('Only a draft plan can be confirmed');

  const { data: items } = await client.from(PLAN_ITEMS).select('*').eq('load_plan_id', plan.id).is('deleted_at', null);
  if (!(items || []).some((i) => i.disposition === 'PLANNED_IN')) {
    throw new ValidationError('A plan with nothing planned in is not a plan');
  }

  // §7 — an impossible plan is refused, and the refusal says by how much and what to do about it.
  // The operator resolves it with a governed T10 action (revise the plan, or exclude cargo with a
  // reason). Nothing is repriced, refunded, re-sailed or settled here — none of that is T10's.
  const pressure = projectPlanPressure(container, items);
  if (pressure.over_capacity) {
    throw new ValidationError(
      `This plan puts ${pressure.planned_in_cbm} CBM into a ${pressure.container_total_cbm} CBM container — `
      + `${pressure.over_by_cbm} CBM too much. Take something out of the plan, with a reason, before confirming it.`,
      { code: 'LOAD_PLAN_EXCEEDS_CONTAINER', overBy: pressure.over_by_cbm, plannedCbm: pressure.planned_in_cbm, containerCbm: pressure.container_total_cbm },
    );
  }

  const { data, error } = await client.from(PLANS)
    .update({ status: PLAN_STATUSES.CONFIRMED, confirmed_by: context.id, confirmed_at: new Date().toISOString(), updated_by: context.id })
    .eq('id', plan.id).eq('status', PLAN_STATUSES.DRAFT).select().single();
  if (error || !data) throw new ValidationError('Could not confirm the plan');
  await appendBestEffortAudit(client, {
    actorId: context.id, tenantId: plan.tenant_id, action: 'LOAD_PLAN_CONFIRMED',
    resourceType: 'diaspora_container_load_plan', resourceId: plan.id,
    newState: { planned_in: (items || []).filter((i) => i.disposition === 'PLANNED_IN').length }, req: options.req,
  });
  return data;
}

// ── The loaded fact ────────────────────────────────────────────────────────

async function liveLoad(client, containerId) {
  const { data } = await client.from(LOADS).select('*').eq('container_id', containerId).is('deleted_at', null).maybeSingle();
  if (!data) return null;
  return [LOAD_STATUSES.IN_PROGRESS, LOAD_STATUSES.COMPLETED].includes(data.status) ? data : null;
}

/** Start actually loading. Idempotent per sailing. */
export async function openLoad(containerId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const container = await loadContainer(client, containerId);
  assertOperator(container, context);

  const existing = await liveLoad(client, container.id);
  if (existing) return { ...existing, already_existed: true };

  const plan = await liveePlan(client, container.id);
  const id = randomUUID();
  const row = {
    id,
    tenant_id: container.tenant_id ? String(container.tenant_id) : null,
    container_id: container.id,
    load_plan_id: plan?.id || null,
    reference: shortRef('LOAD', id),
    status: LOAD_STATUSES.IN_PROGRESS,
    created_by: context.id,
    updated_by: context.id,
  };
  const { data, error } = await client.from(LOADS).insert(row).select().single();
  if (error) {
    const winner = await liveLoad(client, container.id);
    if (winner) return { ...winner, already_existed: true };
    throw new ValidationError(`Could not start loading: ${error.message}`);
  }
  await appendBestEffortAudit(client, {
    actorId: context.id, tenantId: row.tenant_id, action: 'LOAD_OPENED',
    resourceType: 'diaspora_container_load', resourceId: data.id,
    newState: { container_id: container.id, load_plan_id: row.load_plan_id }, req: options.req,
  });
  return data;
}

/**
 * Record that a consignment went in — or did not.
 *
 * The loader is the authenticated actor; `loaded_by` in the body is ignored. The server also checks
 * the consignment actually belongs to this sailing, so a checkbox in client state cannot put
 * somebody else's cargo on this manifest.
 */
export async function recordLoadItem(loadId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data: load } = await client.from(LOADS).select('*').eq('id', requireText(loadId, 'loadId')).is('deleted_at', null).maybeSingle();
  if (!load) throw new NotFoundError('Load not found');
  const container = await loadContainer(client, load.container_id);
  assertOperator(container, context);
  if (load.status !== LOAD_STATUSES.IN_PROGRESS) {
    throw new ValidationError('This load is closed. Reopen it or start a new one rather than editing history.');
  }

  const subjectType = String(payload.subjectType ?? payload.subject_type ?? 'cargo_reservation');
  const subjectId = requireText(payload.subjectId ?? payload.subject_id, 'subjectId', { max: 100 });
  const outcome = String(payload.outcome ?? 'LOADED').toUpperCase();
  if (!['LOADED', 'LEFT_BEHIND'].includes(outcome)) throw new ValidationError('A manifest line is either loaded or left behind');

  // The consignment must belong to THIS sailing. Not a client assertion — read from T5.
  const facts = await readSailingFacts(client, container.id);
  const candidate = facts.find((f) => f.subject.id === subjectId && f.subject.type === subjectType);
  if (!candidate) throw new ValidationError('That cargo is not booked on this sailing');

  let volume = null;
  let weight = null;
  if (outcome === 'LOADED') {
    // Observed at the door when anybody observed it; otherwise the warehouse measurement, which is
    // the closest true figure. Never the booking estimate — that is what was BOOKED, not what went in.
    volume = positiveOrNull(payload.loadedVolumeCbm ?? payload.loaded_volume_cbm, 'Loaded volume')
      ?? candidate.readiness.facts.measured_volume_cbm;
    weight = positiveOrNull(payload.loadedWeightKg ?? payload.loaded_weight_kg, 'Loaded weight');
    if (!candidate.readiness.facts.received) {
      throw new ValidationError('This cargo has not been received at a warehouse, so it cannot have gone into a container');
    }
  }

  const reason = payload.leftBehindReason ?? payload.left_behind_reason ?? null;
  if (outcome === 'LEFT_BEHIND' && (!reason || !LEFT_BEHIND_REASONS.includes(String(reason)))) {
    throw new ValidationError(`Say why this cargo was not loaded (${LEFT_BEHIND_REASONS.join(', ')})`);
  }

  const row = {
    load_id: load.id,
    tenant_id: load.tenant_id,
    subject_type: subjectType,
    subject_id: subjectId,
    intake_id: candidate.intake?.id || null,
    outcome,
    left_behind_reason: outcome === 'LEFT_BEHIND' ? String(reason) : null,
    loaded_volume_cbm: outcome === 'LOADED' ? volume : null,
    loaded_weight_kg: outcome === 'LOADED' ? weight : null,
    // Server-derived. The body's opinion about who loaded this is never consulted.
    loaded_by: outcome === 'LOADED' ? context.id : null,
    loaded_at: outcome === 'LOADED' ? new Date().toISOString() : null,
    notes: optionalText(payload.notes, 'Notes'),
    created_by: context.id,
    updated_by: context.id,
  };

  const { data: existing } = await client.from(LOAD_ITEMS).select('*')
    .eq('load_id', load.id).eq('subject_type', subjectType).eq('subject_id', subjectId).is('deleted_at', null).maybeSingle();
  if (existing) {
    const { data, error } = await client.from(LOAD_ITEMS)
      .update({ ...row, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
    if (error) throw new ValidationError(`Could not update the manifest line: ${error.message}`);
    return data;
  }
  const { data, error } = await client.from(LOAD_ITEMS).insert(row).select().single();
  if (error) throw new ValidationError(`Could not record the manifest line: ${error.message}`);
  await appendCriticalAudit(client, {
    actorId: context.id, tenantId: load.tenant_id, action: `LOAD_ITEM_${outcome}`,
    resourceType: 'diaspora_container_load_item', resourceId: data.id,
    newState: { subject_id: subjectId, outcome, loaded_volume_cbm: row.loaded_volume_cbm }, req: options.req,
  });

  // AFTER the authoritative row and its audit. Only on a first record, never on an edit: correcting
  // a line is not a second event in the customer's life. The left-behind notice is the one that
  // matters — somebody at the other end is expecting goods that are not coming.
  const recipients = [candidate.reservation?.buyer_id, candidate.reservation?.created_by]
    .map(normalizeId).filter(Boolean);
  if (outcome === 'LOADED') await notifyCargoLoaded({ loadItem: data, load, recipients });
  else await notifyCargoLeftBehind({ loadItem: data, load, recipients });
  return data;
}

/**
 * Close the load.
 *
 * The total is the SUM OF WHAT WAS LOADED, derived here rather than accepted from a client, and it
 * is explicitly not the plan's total: a plan that said 3.8 and a load that put in 3.6 are two true
 * numbers, and the second is the one this field means.
 *
 * Completing a load says nothing about departure. There is no state here that could.
 */
export async function completeLoad(loadId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data: load } = await client.from(LOADS).select('*').eq('id', requireText(loadId, 'loadId')).is('deleted_at', null).maybeSingle();
  if (!load) throw new NotFoundError('Load not found');
  const container = await loadContainer(client, load.container_id);
  assertOperator(container, context);
  if (load.status === LOAD_STATUSES.COMPLETED) return { ...load, already_completed: true };
  if (load.status !== LOAD_STATUSES.IN_PROGRESS) throw new ValidationError('Only a load in progress can be completed');

  const { data: items } = await client.from(LOAD_ITEMS).select('*').eq('load_id', load.id).is('deleted_at', null);
  const loaded = (items || []).filter((i) => i.outcome === 'LOADED');
  if (!loaded.length) throw new ValidationError('Nothing has been recorded as loaded, so there is nothing to complete');

  const withVolume = loaded.filter((i) => i.loaded_volume_cbm !== null && i.loaded_volume_cbm !== undefined);
  // Unknown is not zero: a total is only stated when every loaded line has a figure.
  const totalVolume = withVolume.length === loaded.length
    ? Math.round(withVolume.reduce((t, i) => t + Number(i.loaded_volume_cbm), 0) * 1000) / 1000
    : null;

  const { data, error } = await client.from(LOADS)
    .update({
      status: LOAD_STATUSES.COMPLETED,
      confirmed_by: context.id,
      confirmed_at: new Date().toISOString(),
      actual_loaded_volume_cbm: totalVolume,
      notes: optionalText(payload.notes, 'Notes'),
      updated_by: context.id,
    })
    .eq('id', load.id).eq('status', LOAD_STATUSES.IN_PROGRESS).select().single();
  if (error || !data) {
    const current = await client.from(LOADS).select('*').eq('id', load.id).maybeSingle();
    if (current.data?.status === LOAD_STATUSES.COMPLETED) return { ...current.data, already_completed: true };
    throw new ValidationError('Could not complete the load');
  }
  await appendCriticalAudit(client, {
    actorId: context.id, tenantId: load.tenant_id, action: 'LOAD_COMPLETED',
    resourceType: 'diaspora_container_load', resourceId: load.id,
    newState: { loaded: loaded.length, left_behind: (items || []).length - loaded.length, actual_loaded_volume_cbm: totalVolume },
    req: options.req,
  });
  return data;
}

/**
 * Record a container number or a seal.
 *
 * Append-only. A replaced seal leaves the previous one readable with who recorded it and when,
 * because the question later is always "what was on it when it left, and who says so".
 */
export async function recordSeal(loadId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data: load } = await client.from(LOADS).select('*').eq('id', requireText(loadId, 'loadId')).is('deleted_at', null).maybeSingle();
  if (!load) throw new NotFoundError('Load not found');
  const container = await loadContainer(client, load.container_id);
  assertOperator(container, context);

  const containerNumber = optionalText(payload.containerNumber ?? payload.container_number, 'Container number', { max: 40 });
  const sealNumber = optionalText(payload.sealNumber ?? payload.seal_number, 'Seal number', { max: 40 });
  if (!containerNumber && !sealNumber) {
    throw new ValidationError('Record a container number, a seal number, or both — an empty record says nothing');
  }
  const reason = String(payload.recordReason ?? payload.record_reason ?? 'OBSERVED').toUpperCase();
  if (!['OBSERVED', 'CORRECTED', 'SEAL_REPLACED'].includes(reason)) throw new ValidationError('That is not a reason this record can have');
  const note = optionalText(payload.reasonNote ?? payload.reason_note, 'Reason');
  if (reason === 'SEAL_REPLACED' && !note) throw new ValidationError('Say why the seal was replaced — it is the first thing anybody will ask later');

  const { data, error } = await client.from(SEALS).insert({
    load_id: load.id,
    tenant_id: load.tenant_id,
    container_number: containerNumber,
    seal_number: sealNumber,
    record_reason: reason,
    reason_note: note,
    recorded_by: context.id,
    recorded_at: new Date().toISOString(),
    created_by: context.id,
    updated_by: context.id,
  }).select().single();
  if (error) throw new ValidationError(`Could not record that: ${error.message}`);
  await appendBestEffortAudit(client, {
    actorId: context.id, tenantId: load.tenant_id, action: `CONTAINER_SEAL_${reason}`,
    resourceType: 'diaspora_container_seal_record', resourceId: data.id,
    newState: { has_container_number: Boolean(containerNumber), has_seal: Boolean(sealNumber) }, req: options.req,
  });
  return data;
}

// ── Projections ────────────────────────────────────────────────────────────

/** The latest seal record is authoritative; the earlier ones are history, never overwritten. */
function currentSeal(rows = []) {
  const live = (rows || []).filter((r) => !r.deleted_at);
  if (!live.length) return null;
  return live.slice().sort((a, b) => String(b.recorded_at || '').localeCompare(String(a.recorded_at || '')))[0];
}

/** The operator's whole picture of one sailing's loading: readiness, plan, manifest, seal. */
export async function getContainerLoadState(containerId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const container = await loadContainer(client, containerId);
  assertOperator(container, context);

  const readiness = await getLoadReadiness(container.id, context, options);
  const plan = await liveePlan(client, container.id);
  const load = await liveLoad(client, container.id);

  const [{ data: planItems }, { data: loadItems }, { data: seals }] = await Promise.all([
    plan ? client.from(PLAN_ITEMS).select('*').eq('load_plan_id', plan.id).is('deleted_at', null) : Promise.resolve({ data: [] }),
    load ? client.from(LOAD_ITEMS).select('*').eq('load_id', load.id).is('deleted_at', null) : Promise.resolve({ data: [] }),
    load ? client.from(SEALS).select('*').eq('load_id', load.id).is('deleted_at', null) : Promise.resolve({ data: [] }),
  ]);

  const seal = currentSeal(seals);
  return {
    ...readiness,
    plan: plan ? {
      id: plan.id, reference: plan.reference, status: plan.status,
      confirmed_at: plan.confirmed_at || null,
      // Shown BEFORE confirming, so an operator can see the pressure building rather than meeting
      // it as a refusal at the end.
      pressure: projectPlanPressure(container, planItems || []),
      items: (planItems || []).map((i) => ({
        subject: { type: i.subject_type, id: i.subject_id },
        disposition: i.disposition,
        exclusion_reason: i.exclusion_reason,
        planned_volume_cbm: i.planned_volume_cbm === null ? null : Number(i.planned_volume_cbm),
        // WHICH number this line was planned against — the difference between planning on a
        // measurement and planning on a guess.
        planned_source: i.planned_source,
      })),
    } : null,
    load: load ? {
      id: load.id, reference: load.reference, status: load.status,
      confirmed_at: load.confirmed_at || null,
      actual_loaded_volume_cbm: load.actual_loaded_volume_cbm === null ? null : Number(load.actual_loaded_volume_cbm),
      items: (loadItems || []).map((i) => ({
        subject: { type: i.subject_type, id: i.subject_id },
        outcome: i.outcome,
        left_behind_reason: i.left_behind_reason,
        loaded_volume_cbm: i.loaded_volume_cbm === null ? null : Number(i.loaded_volume_cbm),
        loaded_at: i.loaded_at || null,
      })),
      // Unknown stays unknown. No plausible container number is manufactured to complete a screen.
      container_number: seal?.container_number || null,
      seal_number: seal?.seal_number || null,
      seal_history: (seals || []).length,
    } : null,
    // Said in the payload so no screen can imply the container has gone anywhere.
    note: 'Loading is what went into the container. Whether it has left, and where it is, is recorded separately and is not shown here.',
  };
}

/**
 * What ONE participant may see about their own cargo's loading.
 *
 * Authorized from the cargo, not the sailing: a co-loader owns a different booking and gets nothing
 * about this one. The projection deliberately carries no other participant's line, no operator
 * identity, and no view of the sailing's total.
 */
export async function getMyLoadStatus(subjectType, subjectId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  if (String(subjectType) !== 'cargo_reservation') {
    throw new ValidationError('Loading is currently tracked for container bookings only');
  }
  const id = requireText(subjectId, 'subjectId', { max: 100 });
  const { data: reservation } = await client.from(RESERVATIONS).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!reservation) throw new NotFoundError('That cargo booking does not exist');

  const owners = [reservation.buyer_id, reservation.created_by].map(normalizeId).filter(Boolean);
  if (!owners.includes(context.id) && !privileged(context) && !isTenantAdminForRecord(reservation, context)) {
    throw new ForbiddenError('This is not your cargo');
  }

  const load = await liveLoad(client, reservation.container_id);
  if (!load) {
    return {
      subject: { type: 'cargo_reservation', id },
      state: 'NOT_STARTED',
      // Truthful absence: nobody has started loading, which is different from "your cargo was left out".
      sentence: 'Loading this container has not started.',
      left_behind_reason: null,
      loaded_at: null,
    };
  }
  const { data: mine } = await client.from(LOAD_ITEMS).select('*')
    .eq('load_id', load.id).eq('subject_type', 'cargo_reservation').eq('subject_id', id).is('deleted_at', null).maybeSingle();

  if (!mine) {
    return {
      subject: { type: 'cargo_reservation', id },
      state: 'NOT_RECORDED',
      sentence: load.status === 'COMPLETED'
        ? 'Loading finished and nothing was recorded about your cargo. Ask the organiser what happened to it.'
        : 'Loading has started. Nothing has been recorded about your cargo yet.',
      left_behind_reason: null,
      loaded_at: null,
    };
  }
  return {
    subject: { type: 'cargo_reservation', id },
    state: mine.outcome,
    sentence: mine.outcome === 'LOADED'
      ? 'Your cargo has been loaded into the container.'
      : 'Your cargo was not loaded into this container.',
    left_behind_reason: mine.left_behind_reason || null,
    loaded_volume_cbm: mine.loaded_volume_cbm === null ? null : Number(mine.loaded_volume_cbm),
    loaded_at: mine.loaded_at || null,
    // The boundary said in words, because "loaded" is the point at which a customer starts assuming
    // their goods are on their way.
    note: 'Loaded means your cargo is inside the container. It does not mean the container has sailed.',
  };
}
