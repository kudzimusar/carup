/**
 * R5 — Vehicle Passport / Trust update.
 *
 * Sent to the current canonical owner when what CarUp can publish about their vehicle materially
 * changes. Classification is `service`: a platform-initiated notice about something they own, which
 * is exactly what `service` was reserved for.
 *
 * THE STATES ARE FOUR DIFFERENT FACTS and the whole template turns on keeping them apart:
 *
 *   evaluated       a decision under the running calculation version — the only state that publishes
 *                   a score
 *   stale           a decision exists but is no longer current
 *   not_evaluated   no decision has been made
 *   unavailable     we could not determine the position at all
 *
 * `not_evaluated` is NOT zero, NOT `unavailable`, and NOT a placeholder. Rendering an unknown as a
 * number is the single worst thing a trust product can do: it converts an absence of evidence into
 * a claim, and the customer has no way to tell which they are looking at.
 */
import { EMAIL_BRAND_IDENTITY } from './emailBrandIdentity.js';
import { greeting } from './recipientPresentation.js';
import { resolveCanonicalWebOrigin } from '../../../config/canonicalWebOrigin.js';

/** How each canonical evaluation state is presented. Copy, tone, and whether a score may appear. */
export const TRUST_STATE_PRESENTATION = Object.freeze({
  evaluated: {
    headline: 'Trust position updated',
    detail: 'CarUp has evaluated this vehicle against the evidence currently recorded for it.',
    tone: 'positive',
    scorePublishable: true,
  },
  stale: {
    headline: 'Trust position needs re-checking',
    detail: 'CarUp has a previous evaluation for this vehicle, but it is no longer current. It is not shown as a live position.',
    tone: 'attention',
    scorePublishable: false,
  },
  not_evaluated: {
    headline: 'Not evaluated yet',
    detail: 'CarUp has not evaluated this vehicle. That is not a low score — it means no decision has been made, and none is being implied.',
    tone: 'unknown',
    scorePublishable: false,
  },
  unavailable: {
    headline: 'Trust position unavailable',
    detail: 'CarUp could not determine a trust position for this vehicle. This is different from having evaluated it and found little.',
    tone: 'unknown',
    scorePublishable: false,
  },
});

export function trustStatePresentation(state) {
  return TRUST_STATE_PRESENTATION[String(state || '').toLowerCase()] || null;
}

/**
 * The score line, or a qualitative one.
 *
 * A number appears only when the canonical projection publishes one — which happens only when the
 * state is `evaluated` AND a score survived the publishable check. No `--/100`, no estimate, no zero.
 */
function scoreRow(trust, presentation) {
  const publishable = presentation.scorePublishable && trust.evaluation_state === 'evaluated' && Number.isFinite(trust.score);
  return { label: 'Trust score', value: publishable ? `${trust.score} / 100` : presentation.headline };
}

/** Evidence basis, only where the canonical projection actually supplied numbers. */
function evidenceRows(trust) {
  const basis = trust.evidence_basis;
  if (!basis || typeof basis !== 'object') return [];
  const rows = [];
  if (Number.isFinite(basis.governed_facts_substantiated) && Number.isFinite(basis.governed_facts_total)) {
    rows.push({ label: 'Facts with evidence', value: `${basis.governed_facts_substantiated} of ${basis.governed_facts_total}` });
  }
  if (Number.isFinite(basis.connected_sources)) {
    rows.push({ label: 'Connected sources', value: String(basis.connected_sources) });
  }
  return rows;
}

/** Public vehicle identity. A missing fact is a stated gap, never backfilled from a legacy default. */
function vehicleRows(vehicle = {}) {
  return [
    { label: 'Year', value: vehicle.year ?? null },
    { label: 'Make', value: vehicle.make ?? null },
    { label: 'Model', value: vehicle.model ?? null },
    { label: 'Mileage', value: vehicle.mileage != null && vehicle.mileage !== '' ? `${Number(vehicle.mileage).toLocaleString('en-US')} km` : null },
  ];
}

/**
 * Build the R5 document, or null when the state is not one of the four canonical values.
 *
 * Refusing an unrecognised state is deliberate. A trust message about a state nobody defined is a
 * trust message nobody can vouch for.
 */
export function buildVehicleTrustUpdateDocument({ payload = {}, classification, env = process.env } = {}) {
  const trust = payload.trust && typeof payload.trust === 'object' ? payload.trust : null;
  const presentation = trust ? trustStatePresentation(trust.evaluation_state) : null;
  if (!trust || !presentation) return null;

  const origin = resolveCanonicalWebOrigin(env).replace(/\/+$/, '');
  const vin = trust.vin || payload.vin || null;
  const vehicle = payload.vehicle && typeof payload.vehicle === 'object' ? payload.vehicle : {};
  const titleParts = [vehicle.year, vehicle.make, vehicle.model].filter((p) => p != null && String(p).trim() !== '');

  // The strongest truthful owner-accessible destination. `/dashboard/garage/<vin>` is the owner's
  // vehicle profile and exists; there is no separate Passport deep-link route, and inventing one
  // would answer HTTP 200 with the SPA shell and land the owner nowhere.
  const vehicleUrl = vin ? `${origin}/dashboard/garage/${encodeURIComponent(vin)}` : `${origin}/dashboard/garage`;

  const limitations = Array.isArray(trust.known_limitations) ? trust.known_limitations.filter(Boolean) : [];

  const blocks = [
    { type: 'statusList', items: [{ label: presentation.headline, tone: presentation.tone, detail: presentation.detail }] },
    {
      type: 'card',
      title: titleParts.length ? titleParts.join(' ') : 'Your vehicle',
      subtitle: vin ? `VIN ${vin}` : null,
      rows: [
        scoreRow(trust, presentation),
        ...(trust.band && presentation.scorePublishable ? [{ label: 'Band', value: trust.band }] : []),
        ...(trust.confidence ? [{ label: 'Evidence confidence', value: trust.confidence.replace(/_/g, ' ') }] : []),
        ...evidenceRows(trust),
        ...vehicleRows(vehicle),
      ],
    },
    { type: 'action', label: 'View your vehicle record', url: vehicleUrl },
  ];

  // Explanations come from canonical `known_limitations` verbatim. Nothing is written here about WHY
  // a position is what it is — manufacturing that prose is how a trust product starts editorialising
  // about evidence it did not weigh.
  if (limitations.length) {
    blocks.push({ type: 'sectionHeading', text: 'What CarUp cannot confirm yet' });
    blocks.push({ type: 'statusList', items: limitations.slice(0, 6).map((text) => ({ label: text, tone: 'unknown' })) });
  }

  blocks.push({
    type: 'panel',
    text: `${EMAIL_BRAND_IDENTITY.consumerTagline} A gap in a vehicle record is shown as a gap. CarUp does not fill one in with an assumption.`,
  });

  return {
    classification,
    preheaderText: `${presentation.headline}${vin ? ` — ${vin}` : ''}`,
    heading: 'Your Vehicle Passport was updated',
    bodyText: [greeting(payload.recipient_name), '', presentation.detail].join('\n'),
    blocks,
    action: null,
    note: null,
    reasonReceived: 'You are receiving this because you are the recorded owner of this vehicle on CarUp.',
    unsubscribeUrl: null,
    trustEvaluationState: trust.evaluation_state,
    trustScorePublished: Boolean(presentation.scorePublishable && trust.evaluation_state === 'evaluated' && Number.isFinite(trust.score)),
  };
}

export default buildVehicleTrustUpdateDocument;
