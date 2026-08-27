/**
 * CarUp Intelligence 1.0 — I18 governed AI intelligence context.
 *
 * The programme's rule for this phase is short: **Gutu AI may explain, but not
 * invent numbers, authority or access.**
 *
 * That is a constraint on the CONTEXT, not on the prompt. A model asked to "only
 * use provided data" will still fill a gap when the gap is where an answer should
 * be — so the enforcement here is structural rather than instructional:
 *
 *   - the context is a CLOSED SET of facts, each carrying its own value,
 *     availability and source;
 *   - a fact that is not measured is present in the context AS unmeasured, with
 *     its reason. An absent key invites invention; a key that says "not recorded"
 *     does not;
 *   - the answer is checked against the context afterwards. `validateAnswer()`
 *     rejects any figure that does not appear in the facts it was given.
 *
 * WHAT THIS REPLACES. The Gutu surface was not an AI at all: it was a keyword
 * lookup returning fixed strings, and those strings asserted specific facts about
 * the reader's OWN property — a market valuation and a monthly trend for a named
 * vehicle, a service history with dates and mileages, an insurance policy with a
 * policy number, an expiry and a premium, three garages with ratings and
 * distances, and a fraud-detection rate. None of it came from anywhere. It is the
 * most dangerous fabrication class in the programme, because a conversational
 * register invites exactly the trust it cannot bear.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { readAllPages } from './rollupService.js';
import { AVAILABILITY, AuthorizationError } from './intelligenceProjectionService.js';

export const AI_CONTEXT_VERSION = 'ai_context@1';

/**
 * Trust lifecycle states that must never be upgraded by a summary.
 *
 * `not_evaluated` means CarUp has not evaluated this vehicle. A sentence that
 * turns it into a score, a band, or "no issues found" would manufacture the exact
 * authority Issue #164 exists to protect.
 */
export const NON_PUBLISHING_TRUST_STATES = Object.freeze(['not_evaluated', 'stale', 'unavailable']);

/** Words that would promote CarUp's own review into someone else's authority. */
const AUTHORITY_PROMOTION_TERMS = Object.freeze([
  'government verified',
  'government-verified',
  'registry confirmed',
  'registry-confirmed',
  'officially verified',
  'zimra verified',
  'cvr verified',
  'certified by',
]);

/**
 * One fact the assistant is allowed to talk about.
 *
 * `available: false` facts are deliberately INCLUDED. Leaving a gap where an
 * answer should be is what invites a model to fill it.
 */
export function fact(key, { label, value = null, unit = null, available = true, reason = null, source, authority = null }) {
  return {
    key,
    label,
    value: available ? value : null,
    unit,
    available,
    reason: available ? null : (reason || 'not_recorded'),
    source,
    authority,
  };
}

function unmeasured(key, label, reason, source) {
  return fact(key, { label, available: false, reason, source });
}

/**
 * Build the closed set of facts a caller's assistant may use.
 *
 * Scope is the session. There is no subject parameter, so an assistant cannot be
 * pointed at another user's vehicles, leads or organization.
 */
export async function buildAuthorizedContext(client = defaultClient, actor = null) {
  const actorId = actor?.id ? String(actor.id) : null;
  if (!actorId) throw new AuthorizationError('Authentication required.');
  const role = String(actor?.platformRole || actor?.role || '');
  const tenantId = actor?.tenantId ? String(actor.tenantId) : null;

  let vehicles;
  let inquiries;
  try {
    vehicles = await readAllPages(() => client
      .from('vehicles')
      .select('vin, owner_id, current_seller_id, publication_status, make, model, year')
      .or(`owner_id.eq.${actorId},current_seller_id.eq.${actorId}`));
    inquiries = await readAllPages(() => client
      .from('marketplace_inquiries')
      // `marketplace_inquiries` keys the seller as `seller_id`. `current_seller_id`
      // is the VEHICLES column that this one is written FROM — using it here made
      // every read fail against the real schema. It failed CLOSED (unavailable
      // with the reason) rather than reporting a false zero, which is why a live
      // certification run was needed to surface it at all.
      .select('id, seller_id, status, created_at')
      .eq('seller_id', actorId));
  } catch (error) {
    return {
      scope: { actor_id: actorId, role, tenant_id: tenantId },
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'context_read_failed'),
      calculation_version: AI_CONTEXT_VERSION,
      facts: [],
      // With no facts, the assistant may say nothing about the reader's data —
      // which is the correct behaviour, not a degraded one.
      message: 'Your CarUp records could not be read, so no answer can be grounded in them.',
    };
  }

  const published = vehicles.filter((row) => String(row.publication_status) === 'published');
  const waiting = inquiries.filter((row) => ['new', 'pending'].includes(String(row.status || '').toLowerCase()));

  const facts = [
    fact('vehicles_owned', {
      label: 'Vehicles on your account',
      value: vehicles.length,
      unit: 'count',
      source: 'vehicles',
    }),
    fact('vehicles_published', {
      label: 'Published listings',
      value: published.length,
      unit: 'count',
      source: 'vehicles.publication_status',
    }),
    fact('enquiries_received', {
      label: 'Enquiries received',
      value: inquiries.length,
      unit: 'count',
      source: 'marketplace_inquiries',
    }),
    fact('enquiries_awaiting_reply', {
      label: 'Enquiries awaiting your reply',
      value: waiting.length,
      unit: 'count',
      source: 'marketplace_inquiries.status',
    }),

    // Deliberately present, and deliberately unmeasured. Each of these is
    // something the previous assistant answered with an invented figure.
    unmeasured('market_valuation', 'What your vehicle is worth',
      'CarUp does not compute a market valuation for a vehicle you own, and no valuation model is connected.',
      'none'),
    unmeasured('valuation_trend', 'How the value has moved',
      'No valuation exists, so no month-on-month movement can be stated.',
      'none'),
    unmeasured('service_due', 'When your next service is due',
      'CarUp holds no service schedule for your vehicle and cannot predict a due date or mileage.',
      'none'),
    unmeasured('insurance_policy', 'Your insurance policy, premium and expiry',
      'CarUp holds no policy record for you. A policy number, premium or expiry date would be invented.',
      'none'),
    unmeasured('nearby_mechanics', 'Mechanics near you with ratings',
      'CarUp holds no mechanic rating or distance index, so no garage can be ranked or placed near you.',
      'none'),
    unmeasured('fraud_detection_rate', 'CarUp\'s fraud detection rate',
      'No fraud interception rate is computed anywhere in CarUp.',
      'none'),
  ];

  return {
    scope: { actor_id: actorId, role, tenant_id: tenantId },
    availability: AVAILABILITY.VALUE,
    calculation_version: AI_CONTEXT_VERSION,
    facts,
    boundaries: [
      'Answer only from the facts above. A fact marked unavailable must be reported as unavailable, never estimated.',
      'A Trust position may be repeated only exactly as the canonical trust service stated it. Never convert a lifecycle state into a score, a band, or a reassurance.',
      'CarUp\'s own review is never described as a government, registry or official verification.',
      'These facts belong to the signed-in person. Never answer about another user, seller or organization.',
    ],
  };
}

/**
 * Reject an answer that asserts a number the context did not contain.
 *
 * This is the structural half of "cannot invent". A model told to stay inside its
 * context will still produce a plausible figure when the context has a hole where
 * an answer belongs, so the answer is checked rather than trusted.
 *
 * Numbers that appear verbatim in the facts are allowed; so are years, which occur
 * in ordinary prose. Anything else is treated as fabricated.
 */
export function validateAnswer(answer, context) {
  const problems = [];
  const text = String(answer || '');

  const allowed = new Set();
  for (const entry of context?.facts || []) {
    if (entry.available && entry.value !== null && entry.value !== undefined) {
      allowed.add(String(entry.value));
    }
  }

  // Currency amounts and percentages are the two shapes that read as measurements.
  const figures = text.match(/\$\s?[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%/g) || [];
  for (const figure of figures) {
    const normalized = figure.replace(/[$,%\s]/g, '');
    if (!allowed.has(normalized)) {
      problems.push({ kind: 'invented_figure', found: figure });
    }
  }

  // A fact the context says is unavailable must not be answered with a value.
  for (const entry of context?.facts || []) {
    if (entry.available) continue;
    const mentionsLabel = text.toLowerCase().includes(entry.label.toLowerCase().slice(0, 18));
    const assertsValue = /\$\s?[\d,]+|\b\d+(?:\.\d+)?\s?%|\b\d{2,}\s?(km|miles)\b/i.test(text);
    if (mentionsLabel && assertsValue) {
      problems.push({ kind: 'answered_an_unavailable_fact', key: entry.key });
    }
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Reject an answer that upgrades a Trust lifecycle state.
 *
 * `not_evaluated` must stay not-evaluated. Turning it into a score, a band or a
 * reassurance is the failure mode Issue #164 governs against.
 */
export function validateTrustStatement(answer, trust) {
  const problems = [];
  const text = String(answer || '').toLowerCase();
  const state = String(trust?.evaluation_state || 'not_evaluated');

  if (NON_PUBLISHING_TRUST_STATES.includes(state)) {
    if (/trust score (is|of)\s*\d|\b\d{1,3}\s*(\/\s*100|% trust)/i.test(String(answer || ''))) {
      problems.push({ kind: 'published_a_withheld_trust_score', state });
    }
    for (const phrase of ['high trust', 'moderate trust', 'low trust', 'trusted vehicle', 'no issues found', 'fully verified']) {
      if (text.includes(phrase)) {
        problems.push({ kind: 'stated_a_band_for_an_unevaluated_vehicle', state, phrase });
      }
    }
  }
  return { valid: problems.length === 0, problems };
}

/**
 * Reject an answer that promotes CarUp's own review into an external authority.
 *
 * I15 established that no registry has confirmed anything: `provider_registry` is
 * empty and every check ran against a sandbox. A summary must not close that gap
 * with a word.
 */
export function validateAuthorityStatement(answer, { registryConfirmed = false } = {}) {
  const problems = [];
  const text = String(answer || '').toLowerCase();
  if (registryConfirmed) return { valid: true, problems };
  for (const term of AUTHORITY_PROMOTION_TERMS) {
    if (text.includes(term)) {
      problems.push({ kind: 'promoted_unconfirmed_state_to_verified', term });
    }
  }
  return { valid: problems.length === 0, problems };
}

/**
 * Every guard at once. An answer must pass all three to be shown.
 */
export function validateAssistantAnswer(answer, context, { trust = null, registryConfirmed = false } = {}) {
  const invention = validateAnswer(answer, context);
  const trustCheck = validateTrustStatement(answer, trust);
  const authority = validateAuthorityStatement(answer, { registryConfirmed });
  const problems = [...invention.problems, ...trustCheck.problems, ...authority.problems];
  return { valid: problems.length === 0, problems };
}
