import { ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { GARAGE_SERVICE_CATEGORIES } from './garageDirectoryService.js';
import { assertBranchBelongsToTenant, assertVehicleAuthority, findLiveCapability } from './serviceAuthority.js';

/**
 * Service Network S2 — Canonical Service Case.
 *
 * A Service Case ORCHESTRATES a service engagement; it does not replace any
 * authority (Invariant 2):
 *   - the vehicle stays canonical (FK to vehicles.vin, never a copy);
 *   - Communications owns conversation (we only carry a thread reference);
 *   - work orders keep owning execution state (S4);
 *   - Trust is never written here (Invariant 4) — completion emits an event
 *     and nothing more.
 *
 * Authorization is app-level and explicit: the garage side acts only through a
 * membership-verified tenant context, and the requester side only for their own
 * case. Nothing is derived from an ambient client-supplied header.
 */

/** Frozen S0 lifecycle states. */
export const SERVICE_CASE_STATUSES = Object.freeze([
  'requested', 'accepted', 'active', 'completed', 'declined', 'cancelled',
]);

/**
 * The state machine. Terminal states have NO outgoing transitions: a completed,
 * declined or cancelled case remains historical (plan §7.6/§7.7, Invariant 12).
 */
const TRANSITIONS = Object.freeze({
  requested: ['accepted', 'declined', 'cancelled'],
  accepted: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  declined: [],
  cancelled: [],
});

const TERMINAL_STATUSES = Object.freeze(['completed', 'declined', 'cancelled']);

/** Source channels reuse the marketplace vocabulary; 'unknown' is honest, not a default lie. */
export const SERVICE_CASE_SOURCE_CHANNELS = Object.freeze([
  'directory', 'passport', 'my_garage', 'marketplace', 'qr', 'operator', 'mobile', 'unknown',
]);

const DECLINE_REASON_CODES = Object.freeze([
  'capacity', 'out_of_scope', 'location', 'parts_unavailable', 'duplicate', 'other',
]);
const CANCELLATION_REASON_CODES = Object.freeze([
  'requester_withdrew', 'garage_unavailable', 'vehicle_unavailable', 'duplicate', 'other',
]);

/** Canonical event namespace (S0 §3, plan §8) — dot-lowercase, one namespace, no synonyms. */
export const SERVICE_CASE_EVENTS = Object.freeze({
  requested: 'service.case.requested',
  accepted: 'service.case.accepted',
  declined: 'service.case.declined',
  cancelled: 'service.case.cancelled',
  completed: 'service.case.completed',
  started: 'service.work.started',
});

function requireTenantContext(userContext = {}) {
  const tenantId = userContext.tenantId || null;
  if (!tenantId) throw new ForbiddenError('A membership-verified garage tenant context is required');
  return tenantId;
}

function actorId(userContext = {}) {
  const id = userContext.id || userContext.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required');
  return id;
}

function assertTransition(from, to) {
  if (!SERVICE_CASE_STATUSES.includes(to)) {
    throw new ValidationError(`Unknown Service Case status: ${to}`);
  }
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    if (TERMINAL_STATUSES.includes(from)) {
      throw new ConflictError(`This case is ${from} and remains historical; it cannot move to ${to}`);
    }
    throw new ConflictError(`A ${from} case cannot move to ${to}`);
  }
}

function normalizeCategory(value) {
  if (value === undefined || value === null || value === '') return null;
  const c = String(value).trim();
  if (!GARAGE_SERVICE_CATEGORIES.includes(c)) {
    throw new ValidationError(`Unknown service category: ${c}`);
  }
  return c;
}

function normalizeSourceChannel(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  const c = String(value).trim();
  if (!SERVICE_CASE_SOURCE_CHANNELS.includes(c)) {
    throw new ValidationError(`Unknown source channel: ${c}`);
  }
  return c;
}

function normalizeReasonCode(value, allowed, label) {
  if (value === undefined || value === null || value === '') return null;
  const c = String(value).trim();
  if (!allowed.includes(c)) {
    throw new ValidationError(`Unknown ${label}: ${c}`);
  }
  return c;
}

function normalizeSummary(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > 4000) throw new ValidationError('request_summary must be at most 4000 characters');
  return s;
}

/**
 * Owner/garage-safe case projection. `request_summary` is private free text: it is
 * returned to the participants here, and MUST NOT be projected into any public
 * Passport surface (plan §7.5) — that boundary lives in the projection layer.
 */
function toCaseView(row) {
  return {
    id: row.id,
    vin: row.vin,
    garage_tenant_id: row.garage_tenant_id,
    branch_id: row.branch_id || null,
    requester_user_id: row.requester_user_id || null,
    source_inquiry_id: row.source_inquiry_id || null,
    source_channel: row.source_channel,
    conversation_thread_id: row.conversation_thread_id || null,
    status: row.status,
    service_category: row.service_category || null,
    request_summary: row.request_summary || null,
    decline_reason_code: row.decline_reason_code || null,
    cancellation_reason_code: row.cancellation_reason_code || null,
    requested_at: row.requested_at,
    accepted_at: row.accepted_at || null,
    declined_at: row.declined_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    cancelled_at: row.cancelled_at || null,
  };
}

/**
 * Event payloads carry identifiers and safe status metadata ONLY — never the
 * private request summary, never customer free text, never secrets (plan §8).
 */
function eventPayload(caseRow, extra = {}) {
  return {
    serviceCaseId: caseRow.id,
    vin: caseRow.vin,
    garageTenantId: caseRow.garage_tenant_id,
    status: caseRow.status,
    occurredAt: new Date().toISOString(),
    ...extra,
  };
}

async function emitCaseEvent(eventType, caseRow, extra = {}, deps = {}) {
  // Communications/Intelligence consume this asynchronously through the existing
  // domain_events outbox — never a service-specific channel (Invariant 6, plan §8).
  // The emitter defaults to the REAL outbox writer; tests may inject one, but
  // production always runs the default (marketplaceInquiryService idiom).
  const persistDomainEvent = deps.emitDomainEvent || emitDomainEvent;
  // A notification failure must never erase an authoritative Service Case
  // (plan §15.5): the problem is reported, the case stands.
  try {
    await persistDomainEvent(null, eventType, eventPayload(caseRow, extra), caseRow.garage_tenant_id);
  } catch (error) {
    return { emitted: false, reason: error?.message || 'emit failed' };
  }
  return { emitted: true };
}

async function appendCaseEvent(supabaseClient, caseRow, eventType, fromStatus, toStatus, userContext, metadata = {}) {
  const { error } = await supabaseClient.from('service_case_events').insert({
    service_case_id: caseRow.id,
    event_type: eventType,
    from_status: fromStatus,
    to_status: toStatus,
    actor_user_id: userContext.id || userContext.userId || null,
    actor_tenant_id: userContext.tenantId || null,
    metadata,
  });
  if (error) throw new DatabaseError(`Failed to append case history: ${error.message}`);
}

async function loadCase(supabaseClient, caseId) {
  const id = String(caseId || '').trim();
  if (!id) throw new ValidationError('service case id is required');
  const { data, error } = await supabaseClient
    .from('service_cases')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load service case: ${error.message}`);
  if (!data) throw new NotFoundError('Service case not found');
  return data;
}

/** The garage side may act only for its OWN tenant; anything else reads as not-found. */
function assertGarageMayAct(caseRow, userContext) {
  const tenantId = requireTenantContext(userContext);
  if (caseRow.garage_tenant_id !== tenantId) {
    throw new NotFoundError('Service case not found');
  }
  return tenantId;
}

function participantRoles(caseRow, userContext) {
  const id = userContext.id || userContext.userId || null;
  const tenantId = userContext.tenantId || null;
  return {
    isRequester: Boolean(id) && caseRow.requester_user_id === id,
    isGarage: Boolean(tenantId) && caseRow.garage_tenant_id === tenantId,
  };
}

function assertParticipantMayRead(caseRow, userContext) {
  const roles = participantRoles(caseRow, userContext);
  if (!roles.isRequester && !roles.isGarage) {
    throw new NotFoundError('Service case not found');
  }
  return roles;
}

/**
 * Read authorization including live capabilities.
 *
 * A redeemed, unexpired, unrevoked capability granted by the requester is real access —
 * that is the whole point of granting one. It is checked against current rows on every
 * call, so revocation and expiry take effect immediately with nothing cached.
 *
 * A capability grants SERVICE CONTEXT only. It never confers Communications conversation
 * access: the conversation thread reference is withheld unless the caller is a genuine
 * case participant, leaving Communications to apply its own participant rules.
 */
async function assertMayReadCase(supabaseClient, caseRow, userContext) {
  const roles = participantRoles(caseRow, userContext);
  if (roles.isRequester || roles.isGarage) return { ...roles, viaCapability: false };

  const capability = await findLiveCapability(
    supabaseClient, userContext, 'service_case', caseRow.id,
    ['service_case_participation', 'service_context_read'],
  );
  if (!capability) throw new NotFoundError('Service case not found');
  return { ...roles, viaCapability: true, capability };
}

// ─────────────────────────── request ───────────────────────────

/**
 * Create a Service Case, or return the EXISTING case for the same originating
 * inquiry. The idempotent bridge is the database's partial unique index on
 * source_inquiry_id: we insert and treat "you lost the race" as "already handled"
 * (plan §10.3), so a retry can never produce a second case.
 */
export async function requestServiceCase(supabaseClient, userContext, body = {}, deps = {}) {
  const requester = actorId(userContext);
  const vin = String(body.vin || '').trim();
  if (!vin) throw new ValidationError('vin is required');
  const garageTenantId = String(body.garage_tenant_id || '').trim();
  if (!garageTenantId) throw new ValidationError('garage_tenant_id is required');

  // HARDENING: authenticating the caller is not enough. Opening a service engagement
  // against a vehicle is a consequential act, so the caller must hold canonical authority
  // over THIS vin — as its owner, or through a live capability the owner granted.
  // Ownership is never inferred from seller, tenant or Marketplace state.
  // The Marketplace inquiry bridge is a separate governed path and passes its own basis.
  if (!deps.authorityAlreadyVerified) {
    await assertVehicleAuthority(supabaseClient, userContext, vin);
  }

  // The target garage must be a real, PUBLISHED garage: a case cannot be routed
  // to a tenant that never offered itself for service work.
  const { data: profile, error: profileError } = await supabaseClient
    .from('garage_public_profiles')
    .select('tenant_id, publication_status')
    .eq('tenant_id', garageTenantId)
    .maybeSingle();
  if (profileError) throw new DatabaseError(`Failed to verify garage: ${profileError.message}`);
  if (!profile || profile.publication_status !== 'published') {
    throw new ValidationError('That garage is not accepting service requests');
  }

  const sourceInquiryId = body.source_inquiry_id ? String(body.source_inquiry_id).trim() : null;
  if (sourceInquiryId) {
    const { data: existing, error: existingError } = await supabaseClient
      .from('service_cases')
      .select('*')
      .eq('source_inquiry_id', sourceInquiryId)
      .maybeSingle();
    if (existingError) throw new DatabaseError(`Failed to check inquiry bridge: ${existingError.message}`);
    if (existing) return { case: toCaseView(existing), created: false };
  }

  // A branch may only be attached together with its owning garage (also a DB composite FK).
  await assertBranchBelongsToTenant(supabaseClient, body.branch_id, garageTenantId);

  const now = new Date().toISOString();
  const row = {
    vin,
    garage_tenant_id: garageTenantId,
    branch_id: body.branch_id ? String(body.branch_id).trim() : null,
    requester_user_id: requester,
    source_inquiry_id: sourceInquiryId,
    source_channel: normalizeSourceChannel(body.source_channel),
    service_category: normalizeCategory(body.service_category),
    request_summary: normalizeSummary(body.request_summary),
    status: 'requested',
    requested_at: now,
    created_by_user_id: requester,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabaseClient.from('service_cases').insert(row).select().single();
  if (error) {
    if (String(error.code) === '23505' && sourceInquiryId) {
      // Lost the race: another writer bridged the same inquiry first.
      const { data: winner } = await supabaseClient
        .from('service_cases').select('*').eq('source_inquiry_id', sourceInquiryId).maybeSingle();
      if (winner) return { case: toCaseView(winner), created: false };
    }
    throw new DatabaseError(`Failed to create service case: ${error.message}`);
  }

  // Same rule on creation: a case whose creation history cannot be recorded is not left
  // half-born. There is no prior status to roll back to, so the case row is retired to
  // 'cancelled' with the reason recorded rather than existing without provenance.
  try {
    await appendCaseEvent(supabaseClient, data, SERVICE_CASE_EVENTS.requested, null, 'requested', userContext, {
      source_channel: data.source_channel,
    });
  } catch (historyError) {
    await supabaseClient
      .from('service_cases')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason_code: 'other',
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .eq('status', 'requested');
    throw new DatabaseError(`Service case could not be recorded (${historyError.message})`);
  }
  const emit = await emitCaseEvent(SERVICE_CASE_EVENTS.requested, data, {
    requesterUserId: data.requester_user_id,
    sourceChannel: data.source_channel,
  }, deps);
  return { case: toCaseView(data), created: true, notification: emit };
}

// ─────────────────────────── transitions ───────────────────────────

async function transition(supabaseClient, userContext, caseId, toStatus, { patch = {}, metadata = {}, eventType, extraPayload = {} }, deps = {}) {
  const caseRow = await loadCase(supabaseClient, caseId);
  assertGarageMayAct(caseRow, userContext);
  assertTransition(caseRow.status, toStatus);

  const now = new Date().toISOString();
  const update = { status: toStatus, updated_at: now, ...patch };

  // Guard the transition in the WHERE clause too: a concurrent writer that already
  // moved the case must lose, rather than both writers "succeeding".
  const { data, error } = await supabaseClient
    .from('service_cases')
    .update(update)
    .eq('id', caseRow.id)
    .eq('status', caseRow.status)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to update service case: ${error.message}`);
  if (!data) throw new ConflictError('This case changed while you were acting on it; reload and try again');

  // ATOMICITY (hardening, plan §8).
  //
  // Three writes make up a transition: the authoritative status change, the append-only
  // history row, and the durable outbox event. Without a shared transaction there are two
  // failure windows. They are handled differently because they are not equally recoverable:
  //
  //  1. state → history. A state change whose history row is lost is unreconstructable, so
  //     the append is retried and, if it still fails, the transition is ROLLED BACK to the
  //     observed prior status. The rollback is itself guarded on the row not having moved
  //     again, so it can never clobber a concurrent writer.
  //
  //  2. history → outbox. An emit failure is recoverable by design: the case and its history
  //     are intact and the event can be replayed from service_case_events, which records
  //     every transition. It is therefore reported (notification.emitted:false) and never
  //     rolled back — a Communications failure must not erase authoritative service truth
  //     (plan §15.5).
  //
  // This is a genuine narrowing, not full atomicity. True single-transaction emission needs
  // the SECURITY DEFINER RPC pattern #194 finalises (INSERT INTO domain_events inside the
  // mutating transaction); adopting it is recorded as a post-rebase obligation rather than
  // claimed here, and a competing event mechanism is deliberately not introduced.
  try {
    await appendCaseEvent(supabaseClient, data, eventType, caseRow.status, toStatus, userContext, metadata);
  } catch (historyError) {
    try {
      await appendCaseEvent(supabaseClient, data, eventType, caseRow.status, toStatus, userContext, metadata);
    } catch (retryError) {
      // Restore EVERY field the transition wrote, not just the status: a rolled-back
      // acceptance that left accepted_at set would still read as accepted downstream.
      const restore = { status: caseRow.status, updated_at: caseRow.updated_at };
      for (const key of Object.keys(patch)) {
        restore[key] = caseRow[key] ?? null;
      }
      await supabaseClient
        .from('service_cases')
        .update(restore)
        .eq('id', caseRow.id)
        .eq('status', toStatus);
      throw new DatabaseError(
        `Transition rolled back: the case history could not be recorded (${retryError.message})`,
      );
    }
  }

  const emit = await emitCaseEvent(eventType, data, extraPayload, deps);
  return { case: toCaseView(data), notification: emit };
}

export async function acceptServiceCase(supabaseClient, userContext, caseId, body = {}, deps = {}) {
  const acceptor = actorId(userContext);
  // A garage cannot accept a case onto another garage's branch.
  if (body.branch_id) {
    await assertBranchBelongsToTenant(supabaseClient, body.branch_id, requireTenantContext(userContext));
  }
  // Only include branch_id when one was actually supplied. Spreading `undefined` into the
  // update payload would NULL the branch recorded at request time — a silent data loss the
  // hardening tests caught.
  const patch = {
    accepted_at: new Date().toISOString(),
    accepted_by_user_id: acceptor,
  };
  if (body.branch_id) patch.branch_id = String(body.branch_id).trim();

  return transition(supabaseClient, userContext, caseId, 'accepted', {
    patch,
    eventType: SERVICE_CASE_EVENTS.accepted,
    extraPayload: { acceptedByUserId: acceptor },
  }, deps);
}

export async function declineServiceCase(supabaseClient, userContext, caseId, body = {}, deps = {}) {
  const reason = normalizeReasonCode(body.reason_code, DECLINE_REASON_CODES, 'decline reason code');
  return transition(supabaseClient, userContext, caseId, 'declined', {
    patch: { declined_at: new Date().toISOString(), decline_reason_code: reason },
    metadata: reason ? { reason_code: reason } : {},
    eventType: SERVICE_CASE_EVENTS.declined,
    extraPayload: { reasonCode: reason },
  }, deps);
}

export async function startServiceCase(supabaseClient, userContext, caseId, deps = {}) {
  return transition(supabaseClient, userContext, caseId, 'active', {
    patch: { started_at: new Date().toISOString() },
    eventType: SERVICE_CASE_EVENTS.started,
  }, deps);
}

/**
 * Completion stamps an authoritative SERVER timestamp and emits an event.
 * It deliberately does NOT touch Trust: service activity is not Trust
 * (Invariant 4). Downstream consumers observe the event.
 */
export async function completeServiceCase(supabaseClient, userContext, caseId, deps = {}) {
  return transition(supabaseClient, userContext, caseId, 'completed', {
    patch: { completed_at: new Date().toISOString() },
    eventType: SERVICE_CASE_EVENTS.completed,
  }, deps);
}

/** Cancellation is a real state, never a deletion (plan §7.7). */
export async function cancelServiceCase(supabaseClient, userContext, caseId, body = {}, deps = {}) {
  const caseRow = await loadCase(supabaseClient, caseId);
  const { isRequester } = assertParticipantMayRead(caseRow, userContext);
  const reason = normalizeReasonCode(body.reason_code, CANCELLATION_REASON_CODES, 'cancellation reason code');
  assertTransition(caseRow.status, 'cancelled');

  const now = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from('service_cases')
    .update({ status: 'cancelled', cancelled_at: now, cancellation_reason_code: reason, updated_at: now })
    .eq('id', caseRow.id)
    .eq('status', caseRow.status)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to cancel service case: ${error.message}`);
  if (!data) throw new ConflictError('This case changed while you were acting on it; reload and try again');

  await appendCaseEvent(supabaseClient, data, SERVICE_CASE_EVENTS.cancelled, caseRow.status, 'cancelled', userContext, {
    ...(reason ? { reason_code: reason } : {}),
    cancelled_by: isRequester ? 'requester' : 'garage',
  });
  const emit = await emitCaseEvent(SERVICE_CASE_EVENTS.cancelled, data, { reasonCode: reason }, deps);
  return { case: toCaseView(data), notification: emit };
}

// ─────────────────────────── reads ───────────────────────────

export async function getServiceCase(supabaseClient, userContext, caseId) {
  const caseRow = await loadCase(supabaseClient, caseId);
  const access = await assertMayReadCase(supabaseClient, caseRow, userContext);
  const { data: events, error } = await supabaseClient
    .from('service_case_events')
    .select('*')
    .eq('service_case_id', caseRow.id)
    .order('created_at', { ascending: true });
  if (error) throw new DatabaseError(`Failed to load case history: ${error.message}`);
  const view = toCaseView(caseRow);
  if (access.viaCapability) {
    // Service context only: conversation membership is Communications' decision, not a
    // side effect of holding a capability.
    view.conversation_thread_id = null;
  }
  return {
    case: view,
    access_basis: access.viaCapability ? 'capability' : (access.isRequester ? 'requester' : 'garage'),
    history: (events || []).map((e) => ({
      event_type: e.event_type,
      from_status: e.from_status,
      to_status: e.to_status,
      created_at: e.created_at,
    })),
  };
}

/** Garage queue — strictly tenant-scoped. */
export async function listGarageServiceCases(supabaseClient, userContext, query = {}) {
  const tenantId = requireTenantContext(userContext);
  let builder = supabaseClient.from('service_cases').select('*').eq('garage_tenant_id', tenantId);
  if (query.status) {
    const status = String(query.status).trim();
    if (!SERVICE_CASE_STATUSES.includes(status)) throw new ValidationError(`Unknown status: ${status}`);
    builder = builder.eq('status', status);
  }
  const { data, error } = await builder.order('requested_at', { ascending: false }).limit(200);
  if (error) throw new DatabaseError(`Failed to list service cases: ${error.message}`);
  return { cases: (data || []).map(toCaseView), total: (data || []).length };
}

/** Requester's own cases. */
export async function listMyServiceCases(supabaseClient, userContext) {
  const requester = actorId(userContext);
  const { data, error } = await supabaseClient
    .from('service_cases')
    .select('*')
    .eq('requester_user_id', requester)
    .order('requested_at', { ascending: false })
    .limit(200);
  if (error) throw new DatabaseError(`Failed to list service cases: ${error.message}`);
  return { cases: (data || []).map(toCaseView), total: (data || []).length };
}
