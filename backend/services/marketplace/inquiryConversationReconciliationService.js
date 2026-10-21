/**
 * CARUP-MVP-STAB-01 F-005 — Marketplace inquiries that never got their conversation.
 *
 * A conversation is created asynchronously from the inquiry's `marketplace.inquiry.created` outbox event.
 * Staging (2026-10-21) held 325 inquiries; 95 had no conversation: 81 whose events are GOVERNED historical
 * quarantines (domain_events.quarantine_reason — decisions that must never be undone by a tool) and 14
 * from before the event existed, which no worker will ever thread.
 *
 *   planReconciliation   the dry-run. Reads only. Every inquiry with no conversation is classified:
 *                          GOVERNED_QUARANTINE  its creation event was quarantined — never reconciled here
 *                          PENDING_DELIVERY     its event is pending/processing — the worker's job, not ours
 *                          NOT_THREADABLE       no seller, not vehicle-bound, or the inquiry is spam/rejected
 *                          NEEDS_REVIEW         an event status this tool does not recognise — never assumed safe
 *                          ELIGIBLE             seller present, vehicle-bound, and no event or a settled one
 *                                               (processed / dead_letter)
 *                        "Has a conversation" is the SUBJECT LINK (subject_type='marketplace_inquiry',
 *                        subject_id=<inquiry id>) — never the thread key: legacy threads use another key.
 *   applyReconciliation  acts on ELIGIBLE ids only, each re-classified immediately before it is touched, via
 *                        the canonical conversation service in `reconciliation` mode (silent, chronological,
 *                        consent not re-derived, inquiry row untouched), and writes one audit event per
 *                        conversation it creates. Idempotent: a second apply is `already_present` for all.
 *
 * Nothing here runs on its own; the admin endpoints are the only callers.
 */
import { readAllIn } from '../communication/conversationTruthLoader.js';
import { readAllPages } from '../intelligence/rollupService.js';
import { logAuditEvent } from '../auditLogger.js';
import { ValidationError } from '../../utils/errors.js';
import { isVehicleBoundInquiryType } from './marketplaceInquiryService.js';

export const RECONCILIATION_CATEGORIES = Object.freeze({
  GOVERNED_QUARANTINE: 'GOVERNED_QUARANTINE',
  PENDING_DELIVERY: 'PENDING_DELIVERY',
  NOT_THREADABLE: 'NOT_THREADABLE',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  ELIGIBLE: 'ELIGIBLE',
});
const C = RECONCILIATION_CATEGORIES;

export const RECONCILIATION_AUDIT_EVENT = 'MARKETPLACE_INQUIRY_CONVERSATION_RECONCILED';
export const RECONCILIATION_CONFIRMATION = 'RECONCILE';
export const RECONCILIATION_MAX_APPLY_IDS = 50;
export const RECONCILIATION_PLAN_DEFAULT_LIMIT = 500;
export const RECONCILIATION_PLAN_MAX_LIMIT = 2000;

/** Machine codes for a refused apply request. Each is the response's own `code`, never a hidden detail. */
export const RECONCILIATION_REQUEST_CODES = Object.freeze({
  IDS_REQUIRED: 'RECONCILIATION_IDS_REQUIRED',
  TOO_MANY_IDS: 'RECONCILIATION_TOO_MANY_IDS',
  ID_INVALID: 'RECONCILIATION_ID_INVALID',
  CONFIRMATION_REQUIRED: 'RECONCILIATION_CONFIRMATION_REQUIRED',
});

const CREATION_EVENT = 'marketplace.inquiry.created';
const SUBJECT_TYPE = 'marketplace_inquiry';
const UNTHREADABLE_INQUIRY_STATUSES = new Set(['spam', 'rejected']);
const IN_FLIGHT_EVENT_STATUSES = new Set(['pending', 'processing']);
const SETTLED_EVENT_STATUSES = new Set(['processed', 'dead_letter']);
// Inquiry ids are UUIDs; this pattern also keeps every value safe inside a PostgREST filter.
const INQUIRY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const INQUIRY_COLUMNS = 'id, listing_id, listing_type, inquiry_type, status, seller_id, buyer_id, created_at';
const THREAD_COLUMNS = 'id, thread_key, subject_type, subject_id, metadata, created_at';
const EVENT_COLUMNS = 'id, event_type, status, created_at, quarantined_at, quarantine_reason, payload';
const MESSAGE_COLUMNS = 'id, thread_id, client_message_id';

const canonicalMessageId = (inquiryId) => `marketplace-inquiry:${inquiryId}`;

function groupBy(rows, keyOf) {
  const out = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined || key === null) continue;
    const bucket = out.get(String(key));
    if (bucket) bucket.push(row); else out.set(String(key), [row]);
  }
  return out;
}

/**
 * The verdict for ONE inquiry, from the threads linked to it, its creation events and which of its
 * reconciliation-made threads were finished. Pure, so the rules can be read — and tested — on their own.
 */
export function classifyInquiry(inquiry, { threads = [], events = [], finishedThreadIds = new Set() } = {}) {
  // A linked thread IS the conversation — except one reconciliation began and never finished, which is
  // unfinished work for the next apply to complete, not a conversation to report as present.
  const conversation = threads.find((t) => !t.metadata?.reconciliation_run_id || finishedThreadIds.has(String(t.id)));
  if (conversation) return { has_conversation: true, thread_id: String(conversation.id) };
  const unfinished = threads.find((t) => t.metadata?.reconciliation_run_id) || null;
  const verdict = (category, reason) => ({
    has_conversation: false,
    thread_id: unfinished ? String(unfinished.id) : null,
    category,
    reason,
  });

  const quarantined = events.filter((e) => e.status === 'quarantined');
  if (quarantined.length) {
    // A governed decision outranks every other fact: it is reported with its reason and never acted on.
    return verdict(C.GOVERNED_QUARANTINE, [...new Set(quarantined.map((e) => e.quarantine_reason || 'UNSPECIFIED'))].join(','));
  }
  if (!isVehicleBoundInquiryType(inquiry.inquiry_type)) return verdict(C.NOT_THREADABLE, 'not_vehicle_bound');
  if (!inquiry.seller_id) return verdict(C.NOT_THREADABLE, 'no_seller');
  if (UNTHREADABLE_INQUIRY_STATUSES.has(inquiry.status)) return verdict(C.NOT_THREADABLE, `inquiry_status_${inquiry.status}`);
  const inFlight = events.find((e) => IN_FLIGHT_EVENT_STATUSES.has(e.status));
  if (inFlight) return verdict(C.PENDING_DELIVERY, `event_${inFlight.status}`);
  const unrecognized = events.find((e) => !SETTLED_EVENT_STATUSES.has(e.status));
  if (unrecognized) return verdict(C.NEEDS_REVIEW, `unrecognized_event_status:${unrecognized.status ?? 'none'}`);
  if (unfinished) return verdict(C.ELIGIBLE, 'resume_incomplete_reconciliation');
  if (!events.length) return verdict(C.ELIGIBLE, 'no_event');
  return verdict(C.ELIGIBLE, `event_${[...new Set(events.map((e) => e.status))].sort().join('+')}`);
}

/** Linked threads, creation events and finished reconciliation threads for a set of inquiries. Reads only. */
async function loadFacts(supabase, inquiries) {
  const ids = [...new Set(inquiries.map((row) => String(row.id)))];
  if (!ids.length) return { threadsByInquiry: new Map(), eventsByInquiry: new Map(), finishedThreadIds: new Set() };
  const [threads, events] = await Promise.all([
    readAllIn(supabase, 'message_threads', THREAD_COLUMNS, 'subject_id', ids, (q) => q.eq('subject_type', SUBJECT_TYPE)),
    // Historical inquiry events predate the dedupe key, so the payload is the one reference every event carries.
    readAllIn(supabase, 'domain_events', EVENT_COLUMNS, 'payload->>inquiryId', ids, (q) => q.eq('event_type', CREATION_EVENT)),
  ]);
  const stamped = threads.filter((t) => t.metadata?.reconciliation_run_id);
  const messages = stamped.length
    ? await readAllIn(supabase, 'messages', MESSAGE_COLUMNS, 'thread_id', stamped.map((t) => String(t.id)))
    : [];
  const finishedThreadIds = new Set(stamped
    .filter((t) => messages.some((m) => String(m.thread_id) === String(t.id) && m.client_message_id === canonicalMessageId(t.subject_id)))
    .map((t) => String(t.id)));
  return {
    threadsByInquiry: groupBy(threads, (t) => t.subject_id),
    eventsByInquiry: groupBy(events.filter((e) => e.event_type === CREATION_EVENT), (e) => e.payload?.inquiryId),
    finishedThreadIds,
  };
}

function classifyAll(inquiries, facts) {
  return inquiries.map((inquiry) => {
    const id = String(inquiry.id);
    const events = facts.eventsByInquiry.get(id) || [];
    return {
      inquiry,
      events,
      verdict: classifyInquiry(inquiry, {
        threads: facts.threadsByInquiry.get(id) || [],
        events,
        finishedThreadIds: facts.finishedThreadIds,
      }),
    };
  });
}

/** A plan item carries ids, states and reasons — never a buyer's name, contact or message. */
function planItem({ inquiry, events, verdict }) {
  return {
    inquiry_id: String(inquiry.id),
    listing_id: inquiry.listing_id || null,
    inquiry_type: inquiry.inquiry_type,
    inquiry_status: inquiry.status || null,
    created_at: inquiry.created_at || null,
    seller_id: inquiry.seller_id || null,
    buyer: inquiry.buyer_id ? 'signed_in' : 'guest',
    category: verdict.category,
    reason: verdict.reason,
    thread_id: verdict.thread_id,
    events: events.map((e) => ({ id: String(e.id), status: e.status, quarantine_reason: e.quarantine_reason || null })),
  };
}

export function normalizePlanLimit(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return RECONCILIATION_PLAN_DEFAULT_LIMIT;
  return Math.min(n, RECONCILIATION_PLAN_MAX_LIMIT);
}

/**
 * The dry-run. Every inquiry is read (paged, so nothing is silently cut at PostgREST's 1000 rows) and the
 * summary counts all of them; `limit` bounds only the items listed, newest first.
 */
export async function planReconciliation({ supabase, limit = RECONCILIATION_PLAN_DEFAULT_LIMIT, now = () => new Date() } = {}) {
  if (!supabase?.from) throw new Error('planReconciliation needs a database client.');
  const max = normalizePlanLimit(limit);
  const inquiries = await readAllPages(() => supabase
    .from('marketplace_inquiries')
    .select(INQUIRY_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id'));
  const classified = classifyAll(inquiries, await loadFacts(supabase, inquiries));
  const without = classified.filter((c) => !c.verdict.has_conversation);

  const byCategory = Object.fromEntries(Object.values(C).map((category) => [category, 0]));
  const quarantineReasons = {};
  for (const { verdict } of without) {
    byCategory[verdict.category] += 1;
    if (verdict.category === C.GOVERNED_QUARANTINE) {
      for (const reason of verdict.reason.split(',')) quarantineReasons[reason] = (quarantineReasons[reason] || 0) + 1;
    }
  }
  const items = without.slice(0, max).map(planItem);
  return {
    mode: 'dry_run',
    generated_at: now().toISOString(),
    summary: {
      inquiries_total: inquiries.length,
      with_conversation: classified.length - without.length,
      without_conversation: without.length,
      by_category: byCategory,
      quarantine_reasons: quarantineReasons,
    },
    limit: max,
    items,
    items_truncated: without.length > items.length,
  };
}

/** A refused apply request as `{ code, message }`, or null when it may proceed. Shared by route and service. */
export function reconciliationIdsProblem(inquiryIds) {
  if (!Array.isArray(inquiryIds) || inquiryIds.length === 0) {
    return { code: RECONCILIATION_REQUEST_CODES.IDS_REQUIRED, message: 'Name the inquiries to reconcile in inquiry_ids.' };
  }
  if (inquiryIds.length > RECONCILIATION_MAX_APPLY_IDS) {
    return {
      code: RECONCILIATION_REQUEST_CODES.TOO_MANY_IDS,
      message: `At most ${RECONCILIATION_MAX_APPLY_IDS} inquiries can be reconciled in one request.`,
    };
  }
  if (!inquiryIds.every((id) => typeof id === 'string' && INQUIRY_ID_PATTERN.test(id))) {
    return { code: RECONCILIATION_REQUEST_CODES.ID_INVALID, message: 'Every inquiry id must be an inquiry id string.' };
  }
  return null;
}

/** 400 with the refusal's OWN code — a production-like runtime hides `details`, never `code`. */
export class ReconciliationRequestError extends ValidationError {
  constructor({ code, message }) {
    super(message);
    this.code = code;
  }
}

/** One inquiry, freshly read. An id that is not a UUID names no inquiry (PostgREST 22P02) — not a fault. */
async function readInquiry(supabase, inquiryId) {
  const { data, error } = await supabase.from('marketplace_inquiries').select(INQUIRY_COLUMNS).eq('id', inquiryId).maybeSingle();
  if (error) {
    if (error.code === '22P02') return null;
    throw new Error(`marketplace_inquiries read failed: ${error.message}`);
  }
  return data || null;
}

const SUMMARY_OUTCOMES = ['created', 'already_present', 'skipped', 'failed'];

/**
 * Apply the reconciliation to the named inquiries, one at a time, in the order given.
 *
 * Each id is re-classified from fresh reads immediately before anything is done to it — the plan an
 * operator looked at may be minutes old, and an event the worker picked up since then is the worker's.
 * Outcomes: `created` (a conversation now exists, audited), `already_present` (one existed),
 * `skipped` (not ELIGIBLE — `reason` is the category, `detail` says why) and `failed` (the attempt broke;
 * a half-built thread is recognised and completed by the next apply). One failure never stops the rest.
 */
export async function applyReconciliation({
  supabase,
  conversationService,
  inquiryIds,
  actor,
  runId,
  request = null,
  deps = {},
} = {}) {
  const problem = reconciliationIdsProblem(inquiryIds);
  if (problem) throw new ReconciliationRequestError(problem);
  if (!supabase?.from) throw new Error('applyReconciliation needs a database client.');
  if (typeof conversationService?.canonicalizeMarketplaceInquiry !== 'function') {
    throw new Error('applyReconciliation needs the canonical conversation service.');
  }
  const actorId = actor?.id || actor?.userId || null;
  if (!actorId || !runId) throw new Error('A reconciliation needs an attributable actor and a run id.');
  const audit = deps.logAuditEvent || logAuditEvent;

  const results = [];
  for (const inquiryId of [...new Set(inquiryIds)]) {
    try {
      const inquiry = await readInquiry(supabase, inquiryId);
      if (!inquiry) {
        results.push({ inquiryId, outcome: 'skipped', reason: 'INQUIRY_NOT_FOUND' });
        continue;
      }
      const [{ verdict }] = classifyAll([inquiry], await loadFacts(supabase, [inquiry]));
      if (verdict.has_conversation) {
        results.push({ inquiryId, outcome: 'already_present', threadId: verdict.thread_id });
        continue;
      }
      if (verdict.category !== C.ELIGIBLE) {
        results.push({ inquiryId, outcome: 'skipped', reason: verdict.category, detail: verdict.reason });
        continue;
      }

      const [built] = await conversationService.canonicalizeMarketplaceInquiry(
        { event_type: CREATION_EVENT, payload: { inquiryId: String(inquiry.id) } },
        { mode: 'reconciliation', reconciliationRunId: runId, actor },
      );
      if (built?.reconciliation?.outcome !== 'created') {
        results.push({ inquiryId, outcome: 'already_present', threadId: built?.thread?.id ? String(built.thread.id) : null });
        continue;
      }

      // Ids only: the audit trail says which conversation was made, from which inquiry, by whom and when —
      // never who the buyer is or what they wrote. (Key names avoid the audit redactor's sensitive words.)
      const recorded = await audit(supabase, {
        event_type: RECONCILIATION_AUDIT_EVENT,
        actor_user_id: String(actorId),
        actor_role: actor?.platformRole || actor?.baseRole || actor?.role || null,
        actor_type: 'user',
        reason: 'inquiry_conversation_reconciliation',
        source_dashboard: 'admin_communications',
        previous_value: { inquiry_id: String(inquiry.id), conversation: null },
        new_value: {
          inquiry_id: String(inquiry.id),
          thread_id: String(built.thread.id),
          message_id: built.message?.id ? String(built.message.id) : null,
          message_created_at: built.message?.created_at || null,
          reconciliation_run_id: String(runId),
        },
        req: request || undefined,
      }).catch((error) => ({ success: false, error: error?.message }));
      results.push({
        inquiryId,
        outcome: 'created',
        threadId: String(built.thread.id),
        audit_recorded: recorded?.success === true,
      });
    } catch (error) {
      results.push({ inquiryId, outcome: 'failed', reason: 'APPLY_FAILED', detail: String(error?.message || error).slice(0, 300) });
    }
  }

  const summary = { requested: results.length };
  for (const outcome of SUMMARY_OUTCOMES) summary[outcome] = results.filter((r) => r.outcome === outcome).length;
  return { mode: 'apply', run_id: String(runId), results, summary };
}
