/**
 * Trade OS T4 — the deterministic operating stage of a trade transaction.
 *
 * This is a PURE function over authoritative facts, and it lives on the server precisely because
 * T3 taught that lesson the hard way: T3's `transactionStage()` lives in a React component, which
 * means it cannot be tested independently, cannot be shared between the procurement and logistics
 * origins, and cannot be relied on by anything but the one screen that owns it.
 *
 * Two rules govern every entry in the ladder, and they pull in opposite directions:
 *
 *   1. Report the FURTHEST stage the facts actually prove. A passport that still says "provider
 *      selected" when the organiser has already approved container space is lying by omission —
 *      it is surfacing one table's enum instead of the transaction's real position.
 *
 *   2. Never leap beyond the evidence. An APPROVED reservation is approved capacity and nothing
 *      more: it is not loaded, not shipped, not cleared, not delivered. Stages whose authority
 *      does not exist yet are reported as unknown, not as zero and not as done.
 *
 * Stages are ordered and each carries the fact that PROVES it, so a caller can always show its
 * own evidence rather than asking the reader to trust the label.
 */

/** Ordered ladder. Index is precedence: a later stage always wins over an earlier one. */
export const TRANSACTION_STAGES = Object.freeze([
  'DRAFT',
  'OPEN_FOR_OFFERS',
  'OFFERS_RECEIVED',
  'COUNTERPARTY_SELECTED',
  'SPACE_REQUESTED',
  'SPACE_APPROVED',
]);

/** Human product language (§5) — never an internal enum, never a table name. */
export const STAGE_LABELS = Object.freeze({
  DRAFT: 'Draft',
  OPEN_FOR_OFFERS: 'Waiting for offers',
  OFFERS_RECEIVED: 'Offers received',
  COUNTERPARTY_SELECTED: 'Provider selected',
  SPACE_REQUESTED: 'Container space requested',
  SPACE_APPROVED: 'Container space approved',
});

/** Procurement says "supplier", logistics says "provider". Same stage, different word. */
export const PROCUREMENT_STAGE_LABELS = Object.freeze({
  ...STAGE_LABELS,
  OPEN_FOR_OFFERS: 'Waiting for supplier offers',
  COUNTERPARTY_SELECTED: 'Supplier selected',
});

const rank = (stage) => {
  const index = TRANSACTION_STAGES.indexOf(stage);
  return index < 0 ? -1 : index;
};

/**
 * Stages BEYOND this ladder. T4 deliberately implements none of them: their authorities are owned
 * by later phases, and the only truthful thing a passport can say about a fact no authority can
 * state is that it has not been recorded. Reporting these as `unknown` — rather than as 0%, "not
 * done", or a hopeful checkmark — is the whole point.
 */
export const UNIMPLEMENTED_STAGES = Object.freeze([
  { key: 'WAREHOUSE_INTAKE', label: 'Warehouse intake', state: 'NOT_STARTED', owner: 'T9' },
  { key: 'LOADING', label: 'Loading', state: 'NOT_STARTED', owner: 'T10' },
  { key: 'SHIPMENT', label: 'Shipment', state: 'NOT_CONNECTED', owner: 'T11' },
  { key: 'CUSTOMS', label: 'Customs', state: 'NOT_RECORDED', owner: 'T12' },
  { key: 'HANDOVER', label: 'Zimbabwe handoff', state: 'NOT_RECORDED', owner: 'T12' },
]);

/**
 * Derive the furthest proven stage.
 *
 * @param {object} facts
 * @param {string|null} facts.status            the anchor's own status enum
 * @param {number}      facts.visibleOfferCount offers the VIEWER may legitimately see
 * @param {boolean}     facts.hasAcceptedOffer  a counterparty has been selected
 * @param {string|null} facts.reservationStatus live reservation state, if any
 * @returns {{stage: string, index: number, evidence: string}}
 */
export function deriveTransactionStage(facts = {}) {
  const status = String(facts.status || '').toUpperCase();
  const reservation = String(facts.reservationStatus || '').toUpperCase();

  let stage = 'DRAFT';
  let evidence = 'No offers have been published yet';

  // Published and taking offers.
  if (status && status !== 'DRAFT') {
    stage = 'OPEN_FOR_OFFERS';
    evidence = 'The request is published';
  }
  // At least one offer the viewer may see.
  if (Number(facts.visibleOfferCount) > 0 && rank('OFFERS_RECEIVED') > rank(stage)) {
    stage = 'OFFERS_RECEIVED';
    evidence = `${Number(facts.visibleOfferCount)} offer(s) received`;
  }
  // A counterparty has been chosen. This is an award, NOT a booking — the distinction T3 exists to
  // protect, and T4 must not quietly collapse it just because it aggregates more domains.
  if (facts.hasAcceptedOffer && rank('COUNTERPARTY_SELECTED') > rank(stage)) {
    stage = 'COUNTERPARTY_SELECTED';
    evidence = 'An offer has been accepted';
  }
  // Space asked for. Consumes NO capacity — see the container authority.
  if (reservation === 'REQUESTED' && rank('SPACE_REQUESTED') > rank(stage)) {
    stage = 'SPACE_REQUESTED';
    evidence = 'Container space has been requested and is awaiting the organiser';
  }
  // Space granted. This is where capacity actually moves — and where the ladder stops.
  if (reservation === 'APPROVED' && rank('SPACE_APPROVED') > rank(stage)) {
    stage = 'SPACE_APPROVED';
    evidence = 'The organiser approved the container space';
  }

  return { stage, index: rank(stage), evidence };
}

/**
 * The lifecycle rail: every stage with its truthful position. Stages the transaction has passed
 * are DONE, the current one is CURRENT, ones ahead of it are PENDING, and everything beyond the
 * implemented ladder keeps the honest state its owner phase gave it.
 */
export function buildLifecycleRail(stage, { procurement = false } = {}) {
  const labels = procurement ? PROCUREMENT_STAGE_LABELS : STAGE_LABELS;
  const current = rank(stage);
  const rail = TRANSACTION_STAGES.map((key, index) => ({
    key,
    label: labels[key],
    state: index < current ? 'DONE' : index === current ? 'CURRENT' : 'PENDING',
  }));
  return [...rail, ...UNIMPLEMENTED_STAGES.map((entry) => ({ ...entry }))];
}
