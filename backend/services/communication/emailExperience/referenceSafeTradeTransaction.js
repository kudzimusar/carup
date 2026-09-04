/**
 * R4 — SafeTrade transaction update.
 *
 * The word "Transaction" is the danger in this template. It invites a payment claim, and CarUp is
 * not in a position to make one: `diaspora_safetrade_transactions` carries a table-level
 * `CHECK (live_payment = false)`, and `SAFETRADE_APPROVED_LIVE_PROVIDERS` is an EMPTY allowlist.
 * No live money can be recorded by this system today. An Email that implied otherwise would be a
 * false financial statement, which is a different category of wrong from a typo.
 *
 * So R4 communicates what is actually true: the journey exists, this is its canonical stage, this is
 * what CarUp has recorded, and this is what happens next. It never says funds were received, held,
 * released or refunded unless the canonical authority proves that exact state — and the sandbox
 * states say sandbox, out loud.
 *
 * DATA MINIMISATION. This is potentially regulated content. Amounts, identity and private financial
 * detail stay out of the Email even when the database holds them; the reference, the stage and an
 * authenticated CarUp link are enough to act on, and are all a forwarded Email should carry.
 */
import { canonicalEmailLink } from './canonicalEmailLinks.js';
import { greeting } from './recipientPresentation.js';
import { resolveCanonicalWebOrigin } from '../../../config/canonicalWebOrigin.js';

/**
 * Canonical `escrow_trust_sessions.status` -> what an Email may say.
 *
 * `assertsFunds` is the load-bearing field. It is true ONLY for states the transaction authority
 * reaches through a provider-confirmed transition, and even those are qualified where the provider
 * is a sandbox. Anything absent from this map is refused rather than described — an unrecognised
 * state is not a licence to write something vague and reassuring.
 */
export const SAFETRADE_STAGE_PRESENTATION = Object.freeze({
  not_requested: { headline: 'SafeTrade has not been requested', detail: 'No SafeTrade journey has been started for this vehicle yet.', tone: 'unknown', assertsFunds: false },
  pending_eligibility: { headline: 'Checking SafeTrade eligibility', detail: 'CarUp is checking whether this vehicle and listing meet the requirements for a SafeTrade journey.', tone: 'neutral', assertsFunds: false },
  eligible: { headline: 'Eligible for SafeTrade', detail: 'This vehicle meets the requirements. Nothing has been paid and no commitment has been made.', tone: 'positive', assertsFunds: false },
  initiated: { headline: 'SafeTrade journey started', detail: 'A SafeTrade journey has been opened. CarUp has recorded the intent; no payment has been confirmed.', tone: 'neutral', assertsFunds: false },
  inspection_pending: { headline: 'Inspection pending', detail: 'The next step in this journey is an inspection.', tone: 'attention', assertsFunds: false },
  release_approved: { headline: 'Release approved', detail: 'The release step has been approved in the CarUp record.', tone: 'positive', assertsFunds: false },
  disputed: { headline: 'This journey is disputed', detail: 'A dispute has been raised. CarUp has paused the journey while it is reviewed.', tone: 'attention', assertsFunds: false },
  cancelled: { headline: 'This journey was cancelled', detail: 'The SafeTrade journey has been cancelled in the CarUp record.', tone: 'neutral', assertsFunds: false },
  failed: { headline: 'This journey could not continue', detail: 'The SafeTrade journey stopped before completing. Open CarUp to see what is needed.', tone: 'attention', assertsFunds: false },

  // Provider-confirmed states. Only these may reference funds at all, and only in CarUp's own record.
  funds_held: { headline: 'Funds recorded as held', detail: 'The payment provider has confirmed funds are held for this journey.', tone: 'positive', assertsFunds: true },
  settled: { headline: 'This journey is settled', detail: 'The payment provider has confirmed this journey is settled.', tone: 'positive', assertsFunds: true },
  refunded: { headline: 'A refund was recorded', detail: 'The payment provider has confirmed a refund for this journey.', tone: 'neutral', assertsFunds: true },

  // SANDBOX. Named unmistakably, because a sandbox confirmation is not a payment.
  funded_sandbox: { headline: 'Sandbox: funds recorded as held', detail: 'This is a SANDBOX journey. No real money has moved.', tone: 'neutral', assertsFunds: false, sandbox: true },
  released_sandbox: { headline: 'Sandbox: release recorded', detail: 'This is a SANDBOX journey. No real money has moved.', tone: 'neutral', assertsFunds: false, sandbox: true },
  refunded_sandbox: { headline: 'Sandbox: refund recorded', detail: 'This is a SANDBOX journey. No real money has moved.', tone: 'neutral', assertsFunds: false, sandbox: true },
});

export function stagePresentation(status) {
  return SAFETRADE_STAGE_PRESENTATION[String(status || '').toLowerCase()] || null;
}

/** Statuses R4 is allowed to describe. Anything else is refused. */
export function describableSafeTradeStatuses() {
  return Object.keys(SAFETRADE_STAGE_PRESENTATION);
}

/**
 * Build the R4 document, or null when the status is not one R4 may describe.
 *
 * Returning null rather than guessing is the point: a stage nobody mapped is a stage nobody decided
 * what to say about, and inventing reassuring prose for it is how a false financial claim gets
 * written by accident.
 */
export function buildSafeTradeTransactionDocument({ payload = {}, classification, env = process.env } = {}) {
  const session = payload.transaction_session && typeof payload.transaction_session === 'object' ? payload.transaction_session : {};
  const stage = stagePresentation(session.status);
  if (!stage) return null;

  const origin = resolveCanonicalWebOrigin(env).replace(/\/+$/, '');
  const reference = session.transaction_intent_id || payload.reference || null;
  const vin = session.vin || null;
  const supportUrl = canonicalEmailLink('support', env);

  const rows = [
    { label: 'Reference', value: reference },
    { label: 'Stage', value: stage.headline },
  ];
  if (vin) rows.push({ label: 'Vehicle', value: `VIN ${vin}` });
  // Deliberately NO amount, NO currency, NO payment identifiers, NO counterparty. All exist in the
  // database; none belongs in a forwardable Email.

  const blocks = [
    { type: 'statusList', items: [{ label: stage.headline, tone: stage.tone, detail: stage.detail }] },
    { type: 'card', title: 'SafeTrade journey', subtitle: vin ? `VIN ${vin}` : null, rows },
    // The label and the destination now agree. It said "Open this journey" and went to the vehicle
    // listing — there is no SafeTrade journey route in the application, and naming the button after
    // a page that does not exist is a promise the click cannot keep. The listing IS the strongest
    // truthful destination, so the action says so.
    {
      type: 'action',
      label: vin ? 'View this vehicle on CarUp' : 'Open CarUp',
      url: vin ? `${origin}/marketplace/listing/${encodeURIComponent(vin)}` : `${origin}/dashboard/communications`,
    },
    ...(supportUrl ? [{ type: 'link', prefix: 'Questions about this journey?', label: 'Contact CarUp Support', url: supportUrl }] : []),
    {
      type: 'panel',
      text: stage.sandbox
        ? 'This is a sandbox journey used for testing. No real money has moved, and nothing here is a payment record.'
        : 'CarUp records the stage of a SafeTrade journey. Always confirm payment details on CarUp itself, and never send money to someone because an email asked you to.',
    },
  ];

  return {
    classification,
    preheaderText: `${stage.headline}${reference ? ` — ${reference}` : ''}`,
    heading: 'Your SafeTrade journey',
    bodyText: [greeting(payload.recipient_name), '', stage.detail].join('\n'),
    blocks,
    action: null,
    note: null,
    reasonReceived: 'You are receiving this because you are part of this SafeTrade journey on CarUp.',
    unsubscribeUrl: null,
    safeTradeAssertsFunds: Boolean(stage.assertsFunds),
    safeTradeSandbox: Boolean(stage.sandbox),
  };
}

export default buildSafeTradeTransactionDocument;
