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

/**
 * What the reader can legitimately DO next.
 *
 * The passport used to answer "what is this / what happened / what is waiting" and stop there, so
 * a freshly awarded logistics transaction offered no action at all even though the next step
 * existed one navigation away. This derives the step from the same authoritative facts as the
 * stage, and it obeys the same two rules: never invent an action whose capability does not exist,
 * and when a step is blocked, say exactly what is missing instead of hiding the button.
 *
 * `href` points at the canonical workspace that already owns the action. T4 links to the workflow;
 * it does not reimplement it.
 *
 * @returns {{state:'ACTION'|'BLOCKED'|'WAITING'|'NONE', label:string, detail:string|null, href:string|null}}
 */
export function deriveNextStep(facts = {}) {
  const {
    kind, stage,
    hasContinuation = false, continuationId = null, continuationStatus = null,
    hasSailing = false, knownVolume = false, reservationStatus = null,
  } = facts;
  const none = (label, detail = null) => ({ state: 'NONE', label, detail, href: null });
  const waiting = (label, detail = null) => ({ state: 'WAITING', label, detail, href: null });

  if (kind === 'procurement') {
    if (stage !== 'COUNTERPARTY_SELECTED') {
      if (stage === 'DRAFT') return { state: 'ACTION', label: 'Finish and publish this request', detail: 'Suppliers cannot see it until you publish.', href: '/diaspora/requests' };
      if (stage === 'OPEN_FOR_OFFERS') return waiting('Waiting for supplier offers', 'CarUp will tell you when an offer arrives.');
      if (stage === 'OFFERS_RECEIVED') return { state: 'ACTION', label: 'Compare offers and choose a supplier', detail: null, href: '/diaspora/requests' };
    }
    // A purchase with a supplier chosen: shipping is the next real step.
    if (hasContinuation) {
      const draft = String(continuationStatus || '').toUpperCase() === 'DRAFT';
      return {
        state: 'ACTION',
        label: draft ? 'Continue shipping request' : 'View shipping request',
        detail: draft ? 'Your shipping request is a draft — review it and publish when you are ready.' : null,
        href: continuationId ? `/diaspora/containers?view=mine&request=${continuationId}` : '/diaspora/containers?view=mine',
      };
    }
    if (stage === 'COUNTERPARTY_SELECTED') {
      return { state: 'ACTION', label: 'Arrange shipping for this purchase', detail: 'CarUp already has the route and the vehicle, so you will not be asked for them again.', href: null };
    }
    return none('Nothing to do right now');
  }

  // ── logistics ──────────────────────────────────────────────────────────
  switch (stage) {
    case 'DRAFT':
      return { state: 'ACTION', label: 'Review and publish this shipping request', detail: 'Providers cannot see it until you publish.', href: '/diaspora/containers?view=mine' };
    case 'OPEN_FOR_OFFERS':
      return waiting('Waiting for provider offers', 'CarUp will tell you when an offer arrives.');
    case 'OFFERS_RECEIVED':
      return { state: 'ACTION', label: 'Compare offers and choose a provider', detail: null, href: '/diaspora/containers?view=mine' };
    case 'COUNTERPARTY_SELECTED': {
      if (!hasSailing) {
        // No CarUp sailing is attached, so container space is not the next step and pretending it
        // is would send the customer at a button that cannot succeed.
        return none('Agree the shipping arrangement with your provider', 'This offer does not use a CarUp shared-container sailing, so there is no container space to request.');
      }
      if (!knownVolume) {
        return { state: 'BLOCKED', label: 'Confirm cargo volume before requesting space', detail: 'An organiser cannot approve space for a volume nobody has stated yet.', href: '/diaspora/containers?view=mine' };
      }
      return { state: 'ACTION', label: 'Request container space', detail: 'Asking for space does not take up space — the organiser still has to approve it.', href: '/diaspora/containers?view=mine' };
    }
    case 'SPACE_REQUESTED':
      return waiting('Waiting for the organiser to review your space request', 'Your request takes up no space on the sailing until it is approved.');
    case 'SPACE_APPROVED':
      return none('Container space approved', 'The later stages of the journey are not connected yet.');
    default:
      return none('Nothing to do right now');
  }
}
