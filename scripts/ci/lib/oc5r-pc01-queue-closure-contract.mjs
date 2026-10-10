/**
 * OC-5R-PC01 B–E — governed queue closure contract.
 *
 * Continues REL-03B-6 (run 38016065906 @ 98158b51), which stopped at `d7_authority_boundary` with 381
 * eligible pending, 121 dead letters, 1044 processed and 196 quarantined. Every population this
 * contract may touch was frozen from read-only staging by exact id and fingerprint
 * (oc5r-pc01-frozen-sets.json). Anything that drifts is a STOP, never a re-classification.
 *
 * Order (the worker is strictly FIFO — `status='pending' AND attempts<5 ORDER BY created_at LIMIT 10`
 * with no family filter — so phases interleave exactly as the queue does):
 *
 *   S1  PC01-B   D7 prefix: rows 1–30 are D7 only; the first batch that contains another family stops it.
 *   S2  PC01-D   the 82 marketplace.inquiry.created rows that block every later batch are dispositioned
 *                STALE_HISTORICAL_QUARANTINE (no delivery: their policy reaches push/email/WhatsApp/SMS).
 *   S3  PC01-B/C the remaining D7 rows and the Class-A families drain to empty.
 *   S4  PC01-E   7 dead letters dispositioned SUPERSEDED_HISTORICAL_WORK (governed historical quarantine).
 *   S5  PC01-E   114 dead letters proven REPLAYABLE_CURRENT_WORK are replayed by EXACT id through the
 *                worker's own reprocessDeadLetters({ ids }) and drained.
 *
 * Nothing here deletes a row, rewrites a payload, marks an event processed directly, or sends
 * anything outside CarUp. Processing happens only through eventWorker.pollEvents().
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PC01_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer';
export const PC01_CONTINUES_FROM = Object.freeze({
  authority_sha: '98158b5157a681fdb99ddbdde6e810a92e097ce0',
  b6_run: 38016065906,
  b6_stop_reason: 'd7_authority_boundary',
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PC01_FROZEN = JSON.parse(fs.readFileSync(path.join(HERE, 'oc5r-pc01-frozen-sets.json'), 'utf8'));

export const PC01_DISPOSITION = Object.freeze({
  // PC01-D — marketplace Class-B
  SAFE_CURRENT_DELIVERY: 'SAFE_CURRENT_DELIVERY',
  ALREADY_SATISFIED_IDEMPOTENT: 'ALREADY_SATISFIED_IDEMPOTENT',
  STALE_HISTORICAL_QUARANTINE: 'STALE_HISTORICAL_QUARANTINE',
  DEFECT_REQUIRING_REMEDIATION: 'DEFECT_REQUIRING_REMEDIATION',
  // PC01-E — dead letters
  REPLAYABLE_CURRENT_WORK: 'REPLAYABLE_CURRENT_WORK',
  SUPERSEDED_HISTORICAL_WORK: 'SUPERSEDED_HISTORICAL_WORK',
  ALREADY_SATISFIED: 'ALREADY_SATISFIED',
  CURRENT_PRODUCT_DEFECT: 'CURRENT_PRODUCT_DEFECT',
});

export const PC01_D7_FAMILIES = Object.freeze([
  'diaspora.container_booking.reservation_requested',
  'diaspora.container_booking.reservation_received',
  'diaspora.container_booking.reservation_approved',
  'diaspora.container_booking.reservation_rejected',
  'diaspora.container_booking.reservation_cancelled',
]);
export const PC01_CLASS_A_FAMILIES = Object.freeze([
  'evidence.review.decided',
  'diaspora.rfq.quote_submitted',
  'diaspora.rfq.quote_accepted',
]);
export const PC01_E_REPLAY_FAMILIES = Object.freeze([
  'evidence.review.decided',
  'identity.verification.decided',
  'diaspora.warehouse.cargo_received',
  'diaspora.warehouse.measurement_discrepancy',
  'vehicle.ownership.transfer_started',
  'vehicle.ownership.transfer_action_required',
  'vehicle.ownership.transfer_completed',
]);
export const PC01_CLASS_B_FAMILY = 'marketplace.inquiry.created';

// Guest inquiries from the automated staging gates use reserved, never-routable test domains.
export const PC01_SYNTHETIC_GUEST_DOMAINS = Object.freeze(['example.test', 'carup-staging.test', 'carup-uat.invalid']);

export const PC01_EXPECTED_START_TOTALS = Object.freeze({ eligible_pending: 381, dead_letter: 121, processed: 1044, quarantined: 196 });
export const PC01_B5_REASON_COUNTS = Object.freeze({
  AUDIT_ONLY_LEGACY: 6,
  LEGACY_DUPLICATE_WORKFLOW_EVENT: 16,
  LEGACY_DUPLICATE_DIRECT_NOTIFICATION: 168,
  RETIRED_HISTORICAL_EVENT: 6,
});

export const PC01_SEGMENTS = Object.freeze([
  Object.freeze({ key: 'S1_D7_PREFIX', phase: 'PC01-B', kind: 'drain', allowed: PC01_D7_FAMILIES, expected_events: 30, expected_stop: 'unauthorized_family_boundary' }),
  Object.freeze({ key: 'S2_D_MARKETPLACE', phase: 'PC01-D', kind: 'quarantine', set: 'D_MARKETPLACE', from_status: 'pending', reason: PC01_DISPOSITION.STALE_HISTORICAL_QUARANTINE, expected_rows: 82 }),
  Object.freeze({ key: 'S3_BC_DRAIN', phase: 'PC01-B/C', kind: 'drain', allowed: Object.freeze([...PC01_D7_FAMILIES, ...PC01_CLASS_A_FAMILIES]), expected_events: 269, expected_stop: 'empty_queue' }),
  Object.freeze({ key: 'S4_E_SUPERSEDED', phase: 'PC01-E', kind: 'quarantine', set: 'E_QUARANTINE', from_status: 'dead_letter', reason: PC01_DISPOSITION.SUPERSEDED_HISTORICAL_WORK, expected_rows: 7 }),
  Object.freeze({ key: 'S5_E_REPLAY', phase: 'PC01-E', kind: 'replay_drain', set: 'E_REPLAY', allowed: PC01_E_REPLAY_FAMILIES, expected_events: 114, expected_stop: 'empty_queue' }),
]);

/** Totals that must hold after each segment, derived from the start totals — never typed by hand. */
export function expectedTotalsAfter(segmentKey) {
  const t = { ...PC01_EXPECTED_START_TOTALS };
  for (const segment of PC01_SEGMENTS) {
    if (segment.kind === 'drain') {
      t.eligible_pending -= segment.expected_events;
      t.processed += segment.expected_events;
    } else if (segment.kind === 'quarantine') {
      if (segment.from_status === 'pending') t.eligible_pending -= segment.expected_rows;
      else t.dead_letter -= segment.expected_rows;
      t.quarantined += segment.expected_rows;
    } else if (segment.kind === 'replay_drain') {
      t.dead_letter -= segment.expected_events;
      t.processed += segment.expected_events;
    }
    if (segment.key === segmentKey) return Object.freeze(t);
  }
  throw new Error('PC01 UNKNOWN SEGMENT: ' + segmentKey);
}

export const PC01_EXPECTED_FINAL_TOTALS = expectedTotalsAfter('S5_E_REPLAY');

export function expectedQuarantineReasonCounts() {
  return Object.freeze({
    ...PC01_B5_REASON_COUNTS,
    [PC01_DISPOSITION.STALE_HISTORICAL_QUARANTINE]: PC01_FROZEN.sets.D_MARKETPLACE.count,
    [PC01_DISPOSITION.SUPERSEDED_HISTORICAL_WORK]: PC01_FROZEN.sets.E_QUARANTINE.count,
  });
}

/**
 * The per-cycle gate. A batch is processed only when EVERY row is an allowed family for the segment,
 * classified IN_APP_ONLY from this checkout, render-ready against the governed registry, and the
 * inventory's own combined gate agrees. The first refusal is the segment boundary.
 */
export function batchGate(batch, allowedFamilies, combinedGatePasses) {
  const rows = Array.isArray(batch) ? batch : [];
  if (rows.length === 0) return { safe: false, reason: 'empty_queue' };
  const allowed = new Set(allowedFamilies || []);
  const outside = rows.find((row) => !allowed.has(row?.event_type));
  if (outside) return { safe: false, reason: 'unauthorized_family_boundary', row: outside };
  const effect = rows.find((row) => row?.classification?.effect_class !== 'IN_APP_ONLY');
  if (effect) return { safe: false, reason: 'effect_class_boundary', row: effect };
  const render = rows.find((row) => row?.render_contract?.render_contract_ready !== true);
  if (render) return { safe: false, reason: 'render_contract_boundary', row: render };
  if (combinedGatePasses !== true) return { safe: false, reason: 'combined_gate_boundary' };
  return { safe: true };
}

/**
 * One processed row is green only when the worker did exactly one attempt, ended `processed` without
 * an error, created (or idempotently found) its OWN in-app notification and message, and nothing
 * external was queued, attempted or sent for it.
 */
export function evaluateProcessedRow({ prior, after, beforeFx = {}, afterFx = {} }) {
  const n = (v) => Number(v || 0);
  const checks = {
    attempts: n(after?.attempts) === n(prior?.attempts) + 1,
    status: after?.status === 'processed',
    no_error: !after?.error_log,
    dead_letter_untouched: (after?.dead_lettered_at ?? null) === (prior?.dead_lettered_at ?? null),
    in_app_exists: n(afterFx.in_app_notifications) > 0,
    message_exists: n(afterFx.messages) > 0,
    no_external_notification: n(afterFx.external_notifications) === 0,
    no_external_attempt: n(afterFx.external_delivery_attempts) === 0,
    no_external_send: n(afterFx.external_send_evidence) === 0,
  };
  const notifDelta = n(afterFx.in_app_notifications) - n(beforeFx.in_app_notifications);
  checks.effect_proven = checks.in_app_exists && (notifDelta > 0 || (n(beforeFx.in_app_notifications) > 0 && notifDelta === 0));
  const ok = Object.values(checks).every(Boolean);
  return { ok, checks, effect: notifDelta > 0 ? 'in_app_created' : 'idempotent_dedupe', notifications_added: Math.max(0, notifDelta), messages_added: Math.max(0, n(afterFx.messages) - n(beforeFx.messages)) };
}

/** PC01-D: the deterministic disposition of one pending marketplace.inquiry.created row. */
export function marketplaceDisposition(fact = {}) {
  if (Number(fact.notifications_for_event || 0) > 0 || Number(fact.notifications_for_inquiry || 0) > 0) {
    return PC01_DISPOSITION.ALREADY_SATISFIED_IDEMPOTENT;
  }
  if (!fact.inquiry_exists || !fact.recipient_exists || !fact.listing_exists || fact.inquiry_seller_is_recipient !== true) {
    return PC01_DISPOSITION.DEFECT_REQUIRING_REMEDIATION;
  }
  const syntheticGuest = !fact.buyer_id && PC01_SYNTHETIC_GUEST_DOMAINS.includes(String(fact.guest_email_domain || '').toLowerCase());
  const listingLive = fact.listing_publication_status === 'published' && !/^sold/i.test(String(fact.listing_status || ''));
  if (syntheticGuest && !listingLive) return PC01_DISPOSITION.STALE_HISTORICAL_QUARANTINE;
  return PC01_DISPOSITION.SAFE_CURRENT_DELIVERY;
}

/** PC01-E: the deterministic disposition of one dead-lettered row. */
export function deadLetterDisposition(fact = {}) {
  if (Number(fact.notifications_for_event || 0) > 0) return PC01_DISPOSITION.ALREADY_SATISFIED;
  if (fact.event_type === PC01_CLASS_B_FAMILY && fact.superseded_payload_shape === true) return PC01_DISPOSITION.SUPERSEDED_HISTORICAL_WORK;
  if (fact.recipient_exists !== true) return PC01_DISPOSITION.SUPERSEDED_HISTORICAL_WORK;
  if (fact.communications_subscribed === true && fact.policy_in_app_only === true && fact.render_contract_ready === true) {
    return PC01_DISPOSITION.REPLAYABLE_CURRENT_WORK;
  }
  return PC01_DISPOSITION.CURRENT_PRODUCT_DEFECT;
}

export function assertSameIdSet(observed, expected, label) {
  const a = [...new Set((observed || []).map(String))].sort();
  const b = [...new Set((expected || []).map(String))].sort();
  if (a.length !== (observed || []).length) throw new Error(`PC01 ${label}: duplicate ids observed`);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    const missing = b.filter((id) => !a.includes(id));
    const extra = a.filter((id) => !b.includes(id));
    throw new Error(`PC01 ${label}: id set drift (missing ${missing.length}, unexpected ${extra.length})`);
  }
  return true;
}

export const PC01_FINGERPRINT_SQL = [
  "SELECT count(*)::int AS total,",
  "  md5(string_agg(concat_ws('|', id::text, event_type, status, attempts::text, created_at::text), '||' ORDER BY id::text)) AS fingerprint",
  'FROM public.domain_events WHERE id::text = ANY($1::text[])',
].join('\n');
