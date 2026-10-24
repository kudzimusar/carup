import { supabase as defaultClient } from '../../db/supabase.js';
import {
  GARAGE_ADMIN_ROLES,
  GARAGE_WORKSPACE_ROLES,
  requireGarageTenant,
} from '../serviceNetwork/serviceAuthority.js';
import { createWorkOrderForCase } from '../serviceNetwork/workOrderAssignmentService.js';
import { resolveWorkOrderCustodian } from '../partsentry/partsentryServiceAuthority.js';
import {
  ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError,
} from '../../utils/errors.js';
import { moneyAmount, quantityValue, requireCurrency } from '../../utils/garageMoney.js';
import { GARAGE_NOTIFICATION_EVENTS, notifyCaseAudience } from './garageNotificationService.js';

/**
 * GARAGE-1.0 OPS04 — estimates and the customer's decision.
 *
 * An estimate is PROPOSED work. It has no authorization of its own: the customer's decision is made
 * by garage_ops04_decide_estimate(), which moves the canonical mechanic_work_orders.owner_authorization
 * in the same database transaction. This service validates, authorises (JS gate + the SQL re-checks),
 * shapes what each audience may see, and translates database refusals into honest HTTP errors.
 */

export const ESTIMATE_LINE_CATEGORIES = Object.freeze(['labour', 'part', 'fee', 'other']);
const CUSTOMER_VISIBLE_STATUSES = ['sent', 'accepted', 'declined', 'superseded', 'cancelled'];

const MESSAGES = Object.freeze({
  WORK_ORDER_NOT_FOUND: 'That job could not be found.',
  CASE_NOT_FOUND: 'That service case could not be found.',
  ESTIMATE_NOT_FOUND: 'That estimate could not be found.',
  WORK_ORDER_HAS_NO_CASE: 'This job is not linked to a service case.',
  WORK_ORDER_TERMINAL: 'This job is finished or cancelled, so an estimate can no longer change.',
  AUTHORIZATION_FINAL: 'The customer has already authorized (or finally revoked) this job, so its scope is settled and cannot be re-estimated.',
  CASE_MUST_BE_ACCEPTED: 'An estimate can be prepared only while the request is accepted and work has not started.',
  LIVE_ESTIMATE_EXISTS: 'This job already has a draft or sent estimate. Finish, cancel or revise it first.',
  ESTIMATE_NOT_DRAFT: 'Only a draft estimate can be edited or sent.',
  ESTIMATE_NOT_PENDING: 'This estimate has already been decided or replaced.',
  ESTIMATE_NOT_REVISABLE: 'Only the latest sent or declined estimate can be revised.',
  ESTIMATE_NOT_CANCELLABLE: 'Only a draft or sent estimate can be cancelled.',
  NOT_LATEST_VERSION: 'A newer version of this estimate exists.',
  STALE_DRAFT: 'This draft changed while you were editing it. Reload and try again.',
  ESTIMATE_EXPIRED: 'This estimate has expired and can no longer be accepted.',
  ESTIMATE_HAS_NO_LINES: 'Add at least one line before sending the estimate.',
  ESTIMATE_NOT_PRICED: 'Every line needs a price before the estimate can be sent. A line with no price is "not recorded", not free — enter 0 only if the item is genuinely free.',
  DECISION_VIA_ESTIMATE: 'An estimate is waiting for the customer\'s decision on this job. Decide it through the estimate.',
  VALID_UNTIL_IN_PAST: 'The validity date must be in the future.',
  CURRENCY_UNSUPPORTED: 'That currency cannot be recorded exactly.',
  AMOUNT_EXCEEDS_CURRENCY_PRECISION: 'An amount has more decimal places than the currency allows.',
  TOO_MANY_LINES: 'An estimate can have at most 100 lines.',
  LINES_INVALID: 'Lines must be a list.',
  LINE_INVALID: 'A line is malformed.',
  LINE_CATEGORY_INVALID: 'A line category must be labour, part, fee or other.',
  LINE_DESCRIPTION_INVALID: 'Every line needs a description (up to 300 characters).',
  LINE_QUANTITY_INVALID: 'Every line needs a positive quantity.',
  LINE_PRICE_INVALID: 'A price cannot be negative.',
  LINE_NUMBER_INVALID: 'A quantity or price is not a valid number.',
  ESTIMATE_LINES_LOCKED: 'A sent estimate\'s lines cannot change. Revise the estimate to make a new version.',
  DECISION_INVALID: 'The decision must be accept or decline.',
  BASIS_INVALID: 'The decision basis is not recognised.',
  ACTOR_REQUIRED: 'An authenticated actor is required.',
});

const CONFLICT_TOKENS = new Set([
  'AUTHORIZATION_FINAL', 'CASE_MUST_BE_ACCEPTED', 'LIVE_ESTIMATE_EXISTS', 'WORK_ORDER_TERMINAL',
  'ESTIMATE_NOT_DRAFT', 'ESTIMATE_NOT_PENDING', 'ESTIMATE_NOT_REVISABLE', 'ESTIMATE_NOT_CANCELLABLE',
  'NOT_LATEST_VERSION', 'STALE_DRAFT', 'ESTIMATE_EXPIRED', 'DECISION_VIA_ESTIMATE', 'ESTIMATE_LINES_LOCKED',
  'ESTIMATE_HAS_NO_LINES', 'ESTIMATE_NOT_PRICED',
]);
const NOT_FOUND_TOKENS = new Set(['WORK_ORDER_NOT_FOUND', 'CASE_NOT_FOUND', 'ESTIMATE_NOT_FOUND', 'WORK_ORDER_HAS_NO_CASE']);

function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}
const adminTenant = (actor) => requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
const workspaceTenant = (actor) => requireGarageTenant(actor, GARAGE_WORKSPACE_ROLES);

export function estimateFailure(error, fallback = 'Could not complete the estimate action') {
  const message = String(error?.message || error || '');
  const match = /GARAGE_OPS04_([A-Z_]+)/.exec(message);
  if (/GARAGE_OPS03_ADMIN_REQUIRED/.test(message)) return new ForbiddenError('Only a garage administrator can do that.');
  if (error?.code === '42501' || /registered owner|cannot authorize it|only the registered/i.test(message)) {
    return new ForbiddenError(message.replace(/^.*?:\s*/, '') || 'You are not allowed to decide this.');
  }
  if (error?.code === '55000') return new ConflictError(message);
  if (error?.code === '23505') return new ConflictError(MESSAGES.LIVE_ESTIMATE_EXISTS);
  if (match) {
    const token = match[1];
    const text = MESSAGES[token] || token.toLowerCase().replaceAll('_', ' ');
    if (NOT_FOUND_TOKENS.has(token)) return new NotFoundError(text);
    if (CONFLICT_TOKENS.has(token)) return new ConflictError(text);
    return new ValidationError(text);
  }
  return new DatabaseError(`${fallback}: ${message || 'database error'}`);
}

function one(data) { return Array.isArray(data) ? data[0] ?? null : data ?? null; }
function rows(data) { return Array.isArray(data) ? data : data ? [data] : []; }

// ───────────────────────────── input ─────────────────────────────

function cleanText(value, label, max) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new ValidationError(`${label} must be at most ${max} characters`);
  return text;
}

export function normalizeLines(rawLines, currency) {
  if (rawLines === undefined || rawLines === null) return [];
  if (!Array.isArray(rawLines)) throw new ValidationError('lines must be a list');
  if (rawLines.length > 100) throw new ValidationError('An estimate can have at most 100 lines');
  return rawLines.map((raw, index) => {
    const n = index + 1;
    if (!raw || typeof raw !== 'object') throw new ValidationError(`Line ${n} is malformed`);
    const category = String(raw.category ?? '').trim();
    if (!ESTIMATE_LINE_CATEGORIES.includes(category)) {
      throw new ValidationError(`Line ${n}: category must be one of ${ESTIMATE_LINE_CATEGORIES.join(', ')}`);
    }
    const description = cleanText(raw.description, `Line ${n} description`, 300);
    if (!description) throw new ValidationError(`Line ${n}: a description is required`);
    return {
      category,
      description,
      quantity: quantityValue(raw.quantity, `Line ${n} quantity`),
      // null = not recorded. 0 is accepted and means explicitly free.
      unit_price: moneyAmount(raw.unit_price, `Line ${n} price`, currency, { optional: true }),
    };
  });
}

function parseValidUntil(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError('valid_until must be a date and time');
  if (d.getTime() <= Date.now()) throw new ValidationError(MESSAGES.VALID_UNTIL_IN_PAST);
  return d.toISOString();
}

// ───────────────────────────── views ─────────────────────────────

function lineView(l) {
  return {
    line_no: l.line_no,
    category: l.category,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price ?? null,
    line_total: l.line_total ?? null,
    price_recorded: l.unit_price !== null && l.unit_price !== undefined,
  };
}

function isExpired(row) {
  return row.status === 'sent' && row.valid_until ? new Date(row.valid_until).getTime() <= Date.now() : false;
}

async function totalsFor(client, estimateId) {
  const { data, error } = await client.rpc('garage_ops04_estimate_totals', { p_estimate_id: estimateId });
  if (error) throw estimateFailure(error, 'Could not total the estimate');
  const t = one(data) || {};
  return {
    line_count: t.line_count ?? 0,
    priced_line_count: t.priced_line_count ?? 0,
    total_amount: t.total_amount ?? null,
  };
}

function baseView(row, lines, totals) {
  const frozen = row.sent_total_amount ?? null;
  const total = frozen !== null ? frozen : (totals ? totals.total_amount : null);
  return {
    id: row.id,
    service_case_id: row.service_case_id,
    work_order_id: row.work_order_id,
    version: row.version,
    status: row.status,
    currency: row.currency,
    customer_note: row.customer_note ?? null,
    valid_until: row.valid_until ?? null,
    expired: isExpired(row),
    sent_at: row.sent_at ?? null,
    decided_at: row.decided_at ?? null,
    decision_basis: row.decision_basis ?? null,
    decision_reason: row.decision_reason ?? null,
    total_amount: total,
    // "not recorded" is a state, not a zero
    total_state: total === null ? 'not_recorded' : (frozen !== null ? 'frozen_at_send' : 'draft_total'),
    line_count: totals ? totals.line_count : (row.sent_line_count ?? lines.length),
    lines: lines.map(lineView),
  };
}

export function garageEstimateView(row, lines, totals, events) {
  return {
    ...baseView(row, lines, totals),
    internal_note: row.internal_note ?? null,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sent_by_user_id: row.sent_by_user_id ?? null,
    cancel_reason: row.cancel_reason ?? null,
    ...(events ? { history: events.map((e) => ({
      event_type: e.event_type, actor_scope: e.actor_scope, previous_status: e.previous_status,
      new_status: e.new_status, estimate_version: e.estimate_version,
      work_order_authorization: e.work_order_authorization, created_at: e.created_at,
    })) } : {}),
  };
}

/** What the customer may see: never a draft, never the garage's internal note or authorship. */
export function customerEstimateView(row, lines, extra = {}) {
  return {
    ...baseView(row, lines, null),
    vin: extra.vin ?? null,
    can_decide: Boolean(extra.canDecide),
    awaiting_owner: Boolean(extra.awaitingOwner),
    // The CANONICAL authorization (OC-5A), so a screen never has to infer it from an estimate: an accepted
    // estimate whose authorization was later revoked must not keep reading "authorized".
    work_order_authorization: extra.workOrderAuthorization ?? null,
  };
}

async function loadLines(client, estimateIds) {
  if (!estimateIds.length) return new Map();
  const { data, error } = await client.from('garage_estimate_lines')
    .select('estimate_id, line_no, category, description, quantity, unit_price, line_total')
    .in('estimate_id', estimateIds).order('line_no', { ascending: true });
  if (error) throw new DatabaseError('Could not load estimate lines: ' + error.message);
  const byEstimate = new Map();
  for (const l of rows(data)) {
    if (!byEstimate.has(l.estimate_id)) byEstimate.set(l.estimate_id, []);
    byEstimate.get(l.estimate_id).push(l);
  }
  return byEstimate;
}

// ───────────────────────────── garage side ─────────────────────────────

async function garageCase(client, tenantId, caseId) {
  const id = String(caseId ?? '').trim();
  if (!id) throw new ValidationError('service case id is required');
  const { data, error } = await client.from('service_cases')
    .select('id, garage_tenant_id, vin, status, requester_user_id, branch_id')
    .eq('id', id).eq('garage_tenant_id', tenantId).maybeSingle();
  if (error) throw new DatabaseError('Could not load the service case: ' + error.message);
  if (!data) throw new NotFoundError('Service case not found');
  return data;
}

async function loadEstimate(client, tenantId, estimateId) {
  const id = String(estimateId ?? '').trim();
  if (!id) throw new ValidationError('estimate id is required');
  const { data, error } = await client.from('garage_estimates').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new DatabaseError('Could not load the estimate: ' + error.message);
  if (!data) throw new NotFoundError('Estimate not found');
  return data;
}

async function detailView(client, row, { withHistory = false } = {}) {
  const lines = (await loadLines(client, [row.id])).get(row.id) || [];
  const totals = await totalsFor(client, row.id);
  let events = null;
  if (withHistory) {
    const { data, error } = await client.from('garage_estimate_events')
      .select('event_type, actor_scope, previous_status, new_status, estimate_version, work_order_authorization, created_at')
      .eq('estimate_id', row.id).order('seq', { ascending: true });
    if (error) throw new DatabaseError('Could not load estimate history: ' + error.message);
    events = rows(data);
  }
  return garageEstimateView(row, lines, totals, events);
}

/** Every version of a case's estimate, newest first, with the work-order authorization alongside. */
export async function listCaseEstimates(client = defaultClient, actor = {}, caseId) {
  const tenantId = workspaceTenant(actor);
  const serviceCase = await garageCase(client, tenantId, caseId);
  const { data: workOrder, error: woError } = await client.from('mechanic_work_orders')
    .select('id, status, owner_authorization, owner_authorized_at, currency')
    .eq('service_case_id', serviceCase.id).maybeSingle();
  if (woError) throw new DatabaseError('Could not load the job: ' + woError.message);
  const { data, error } = await client.from('garage_estimates').select('*')
    .eq('service_case_id', serviceCase.id).eq('tenant_id', tenantId).order('version', { ascending: false });
  if (error) throw new DatabaseError('Could not load estimates: ' + error.message);
  const list = rows(data);
  const isAdmin = actor?.activeTenant?.role === 'admin';
  const views = [];
  for (const row of list) {
    const view = await detailView(client, row);
    if (!isAdmin) delete view.internal_note;
    views.push(view);
  }
  return {
    service_case_id: serviceCase.id,
    case_status: serviceCase.status,
    work_order: workOrder ? {
      id: workOrder.id,
      status: workOrder.status,
      owner_authorization: workOrder.owner_authorization,
      owner_authorized_at: workOrder.owner_authorized_at ?? null,
    } : null,
    estimates: views,
    latest: views[0] || null,
  };
}

export async function getGarageEstimate(client = defaultClient, actor = {}, estimateId) {
  const tenantId = workspaceTenant(actor);
  const row = await loadEstimate(client, tenantId, estimateId);
  const view = await detailView(client, row, { withHistory: true });
  if (actor?.activeTenant?.role !== 'admin') delete view.internal_note;
  return view;
}

/** Prepare a draft for an accepted case. Opens the job (work order) if the case does not have one yet. */
export async function createEstimateForCase(client = defaultClient, actor = {}, caseId, body = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const serviceCase = await garageCase(client, tenantId, caseId);
  if (serviceCase.status !== 'accepted') {
    throw new ConflictError(MESSAGES.CASE_MUST_BE_ACCEPTED);
  }
  const currency = requireCurrency(body.currency);
  const lines = normalizeLines(body.lines, currency);
  const customerNote = cleanText(body.customer_note, 'customer_note', 2000);
  const internalNote = cleanText(body.internal_note, 'internal_note', 2000);
  const validUntil = parseValidUntil(body.valid_until);

  const { workOrder } = await createWorkOrderForCase(client, actor, serviceCase.id, {});
  const { data, error } = await client.rpc('garage_ops04_create_estimate', {
    p_tenant_id: tenantId,
    p_work_order_id: workOrder.id,
    p_currency: currency,
    p_customer_note: customerNote,
    p_internal_note: internalNote,
    p_valid_until: validUntil,
    p_lines: lines,
    p_actor_user_id: actorUserId,
  });
  if (error) throw estimateFailure(error, 'Could not create the estimate');
  return detailView(client, one(data), { withHistory: true });
}

export async function updateEstimateDraft(client = defaultClient, actor = {}, estimateId, body = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const current = await loadEstimate(client, tenantId, estimateId);
  const currency = requireCurrency(body.currency ?? current.currency);
  const lines = normalizeLines(body.lines, currency);
  const { data, error } = await client.rpc('garage_ops04_replace_draft', {
    p_tenant_id: tenantId,
    p_estimate_id: current.id,
    p_currency: currency,
    p_customer_note: cleanText(body.customer_note, 'customer_note', 2000),
    p_internal_note: cleanText(body.internal_note, 'internal_note', 2000),
    p_valid_until: parseValidUntil(body.valid_until),
    p_lines: lines,
    p_expected_updated_at: body.expected_updated_at ?? null,
    p_actor_user_id: actorUserId,
  });
  if (error) throw estimateFailure(error, 'Could not save the draft');
  return detailView(client, one(data), { withHistory: true });
}

async function simpleAction(client, actor, estimateId, rpcName, extra = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const current = await loadEstimate(client, tenantId, estimateId);
  const { data, error } = await client.rpc(rpcName, {
    p_tenant_id: tenantId, p_estimate_id: current.id, ...extra, p_actor_user_id: actorUserId,
  });
  if (error) throw estimateFailure(error, 'Could not update the estimate');
  return detailView(client, one(data), { withHistory: true });
}

/**
 * Send the estimate to the customer. The notification is best-effort and reported, never assumed: a
 * Communications failure must not undo an authoritative estimate (Service Network plan §15.5).
 */
export async function sendEstimate(client = defaultClient, actor = {}, estimateId, deps = {}) {
  const view = await simpleAction(client, actor, estimateId, 'garage_ops04_send_estimate');
  let notification = { attempted: 0, emitted: 0, failures: ['case unavailable'] };
  try {
    const { data: serviceCase } = await client.from('service_cases')
      .select('id, vin, garage_tenant_id, requester_user_id').eq('id', view.service_case_id).maybeSingle();
    if (serviceCase) {
      notification = await notifyCaseAudience(client, {
        eventType: GARAGE_NOTIFICATION_EVENTS.estimateSent, serviceCase, entity: { field: 'estimateId', id: view.id },
      }, deps);
    }
  } catch (error) {
    notification = { attempted: 0, emitted: 0, failures: [error?.message || 'notification failed'] };
  }
  return { ...view, notification };
}
export const reviseEstimate = (client = defaultClient, actor = {}, estimateId) =>
  simpleAction(client, actor, estimateId, 'garage_ops04_revise_estimate');
export const cancelEstimate = (client = defaultClient, actor = {}, estimateId, body = {}) =>
  simpleAction(client, actor, estimateId, 'garage_ops04_cancel_estimate', {
    p_reason: cleanText(body?.reason, 'reason', 300),
  });

// ───────────────────────────── customer side ─────────────────────────────

/** Cases the person may follow: ones they requested, and ones on vehicles they own. */
export async function followedCases(client, userId) {
  const byId = new Map();
  const { data: requested, error } = await client.from('service_cases')
    .select('id, vin, garage_tenant_id, requester_user_id, status').eq('requester_user_id', userId);
  if (error) throw new DatabaseError('Could not load your service requests: ' + error.message);
  for (const c of rows(requested)) byId.set(c.id, c);

  const { data: owned, error: vehicleError } = await client.from('vehicles').select('vin').eq('owner_id', userId);
  if (vehicleError) throw new DatabaseError('Could not load your vehicles: ' + vehicleError.message);
  const vins = rows(owned).map((v) => v.vin);
  if (vins.length) {
    const { data: onOwned, error: ownedError } = await client.from('service_cases')
      .select('id, vin, garage_tenant_id, requester_user_id, status').in('vin', vins);
    if (ownedError) throw new DatabaseError('Could not load service requests on your vehicles: ' + ownedError.message);
    for (const c of rows(onOwned)) byId.set(c.id, c);
  }
  return { cases: [...byId.values()], ownedVins: new Set(vins) };
}

export async function listMyEstimates(client = defaultClient, actor = {}) {
  const userId = actorId(actor);
  const { cases, ownedVins } = await followedCases(client, userId);
  if (!cases.length) return { estimates: [] };
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const { data, error } = await client.from('garage_estimates').select('*')
    .in('service_case_id', cases.map((c) => c.id))
    .in('status', CUSTOMER_VISIBLE_STATUSES)
    .order('version', { ascending: false });
  if (error) throw new DatabaseError('Could not load estimates: ' + error.message);
  // a cancelled DRAFT was never sent, so it was never the customer's to see
  const sent = rows(data).filter((r) => r.sent_at);
  const lines = await loadLines(client, sent.map((r) => r.id));
  const woIds = [...new Set(sent.map((r) => r.work_order_id))];
  const authorizationByWorkOrder = new Map();
  if (woIds.length) {
    const { data: orders, error: orderError } = await client.from('mechanic_work_orders').select('id, owner_authorization').in('id', woIds);
    if (orderError) throw new DatabaseError('Could not load authorization state: ' + orderError.message);
    for (const o of rows(orders)) authorizationByWorkOrder.set(o.id, o.owner_authorization);
  }
  return {
    estimates: sent.map((row) => {
      const c = caseById.get(row.service_case_id);
      const isOwner = ownedVins.has(c.vin);
      return customerEstimateView(row, lines.get(row.id) || [], {
        vin: c.vin,
        canDecide: row.status === 'sent' && !isExpired(row) && isOwner,
        awaitingOwner: row.status === 'sent' && !isOwner,
        workOrderAuthorization: authorizationByWorkOrder.get(row.work_order_id) ?? null,
      });
    }),
  };
}

/** The customer's decision. Only the vehicle's custodian may make it (OC-5A's own rule, reused). */
export async function decideMyEstimate(client = defaultClient, actor = {}, estimateId, body = {}) {
  const userId = actorId(actor);
  const decisionWord = String(body.decision ?? '').trim();
  const decision = { accept: 'accepted', accepted: 'accepted', decline: 'declined', declined: 'declined' }[decisionWord];
  if (!decision) throw new ValidationError('decision must be accept or decline');
  const reason = cleanText(body.reason, 'reason', 500);

  const id = String(estimateId ?? '').trim();
  if (!id) throw new ValidationError('estimate id is required');
  const { data: est, error } = await client.from('garage_estimates').select('id, service_case_id, status, sent_at').eq('id', id).maybeSingle();
  if (error) throw new DatabaseError('Could not load the estimate: ' + error.message);
  // not yet sent == not yet theirs: indistinguishable from "does not exist"
  if (!est || !est.sent_at) throw new NotFoundError('Estimate not found');
  const { data: serviceCase, error: caseError } = await client.from('service_cases')
    .select('id, vin, requester_user_id').eq('id', est.service_case_id).maybeSingle();
  if (caseError) throw new DatabaseError('Could not load the service request: ' + caseError.message);
  if (!serviceCase) throw new NotFoundError('Estimate not found');

  const custodian = await resolveWorkOrderCustodian({ vin: serviceCase.vin, userContext: actor, client });
  if (!custodian.allowed) {
    // A requester who is not the custodian can SEE it (list) but not decide it; everyone else learns nothing.
    if (serviceCase.requester_user_id === userId) {
      throw new ForbiddenError('Only the vehicle\'s registered owner can accept or decline an estimate for it.');
    }
    throw new NotFoundError('Estimate not found');
  }

  const { data, error: rpcError } = await client.rpc('garage_ops04_decide_estimate', {
    p_estimate_id: est.id,
    p_decision: decision,
    p_basis: custodian.basis,
    p_actor_user_id: userId,
    p_actor_role: actor.platformRole ?? actor.role ?? null,
    p_actor_tenant_id: custodian.basis === 'dealer' ? (actor.tenantId ?? null) : null,
    p_reason: reason,
  });
  if (rpcError) throw estimateFailure(rpcError, 'Could not record your decision');
  const result = typeof data === 'string' ? JSON.parse(data) : data;
  return { success: true, decision, estimate_id: est.id, work_order_authorization: result.work_order_authorization };
}

export default {
  listCaseEstimates, getGarageEstimate, createEstimateForCase, updateEstimateDraft,
  sendEstimate, reviseEstimate, cancelEstimate, listMyEstimates, decideMyEstimate,
};
