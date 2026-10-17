/**
 * Marketplace AI assistant — ADVISORY ONLY with deterministic fallback.
 *
 * Every function returns a useful deterministic result even when the AI provider is unavailable, and
 * NEVER throws because of AI (plan rule 7). AI output exposed to buyers/sellers never includes internal
 * risk/fraud reasoning. Backend governance rules remain the source of truth — AI cannot approve
 * listings, set verification, or override suppression.
 *
 * Provider (OC-3E wave 1): the canonical CarUp AI gateway, through the domain advisory adapter —
 * Gemma on Cloudflare Workers AI, advisory machine output only. On missing credentials / provider
 * error / timeout / malformed reply we fall back to deterministic templates and surface
 * ai_status='ai_unavailable'.
 *
 * Paid inference needs a PROVEN caller: the public routes pass NO_PAID_INFERENCE for an anonymous
 * (or merely asserted) identity, which returns the same deterministic answer with
 * ai_reason='sign_in_required' and spends no provider capacity.
 *
 * OC-5R-REL-01 — NO VALUATION, FROM ANY PATH. CarUp has no approved valuation provider. The price
 * estimate therefore makes no provider call at all (it used to let the model raise the confidence
 * label and add free-text notes beside a manufactured fair band), and every AI text field that
 * reaches a buyer or a seller passes `containsValuationClaim` — a line or field that makes a
 * valuation claim is withheld and the deterministic answer stands in for it.
 */

import { requestAdvisoryJson } from '../ai/domainAdvisoryAdapter.js';
import { buildPricingSummary } from './marketplacePricingService.js';
import { containsValuationClaim, VALUATION_WITHHELD_GUIDANCE } from './valuationClaimGuard.js';

/** Appended to every prompt that can reach a buyer or a seller. The guard, not this, is the boundary. */
const NO_VALUATION_RULE =
  'CarUp has no valuation provider: never state or estimate a market value, fair price, price range, '
  + 'money amount or percentage, and never say whether a price is good, fair, high or low.';

/** The AI field if it is a usable string that makes no valuation claim, otherwise the fallback. */
function governedText(aiValue, fallback) {
  if (typeof aiValue !== 'string' || !aiValue.trim()) return fallback;
  return containsValuationClaim(aiValue) ? fallback : aiValue;
}

// Bounded by the shared transport (the request is aborted, not merely abandoned).
const AI_TIMEOUT_MS = 12000;

/**
 * OC-5R-REL-02 E — the machine-readable reason on a degraded answer whose AI call TIMED OUT (the gateway's
 * `AI_TIMEOUT`, which the transport raises when the bound above expires). It joins the vocabulary
 * 'sign_in_required', 'input_too_large', 'valuation_not_configured' and 'ai_output_withheld'.
 */
export const AI_TIMEOUT_REASON = 'ai_timeout';

/**
 * One advisory attempt. Returns the answer (or null) and the inference policy to report the degraded
 * answer with: unchanged, except that an AI call that TIMED OUT adds `ai_reason: 'ai_timeout'`. A caller
 * that never reaches the model (anonymous, oversized) already carries its own reason and is never
 * relabelled; any other failure stays unnamed.
 */
async function attempt(callAi, deps, systemPrompt, userPrompt) {
  const outcome = {};
  const ai = await callAi(systemPrompt, userPrompt, { gateway: deps.gateway, outcome });
  const used = !ai && outcome.reason && !deps.aiReason ? { ...deps, aiReason: outcome.reason } : deps;
  return { ai, deps: used };
}

/**
 * Try the gateway in JSON mode; returns the parsed object or null (never throws).
 *
 * Only an answer the gateway marked executed and advisory reaches here (the adapter refuses the
 * rest), so a failure, a timeout or malformed JSON is `null` → `ai_status: 'ai_unavailable'`,
 * never `ai_assisted`.
 */
async function tryAi(systemPrompt, userPrompt, { gateway, timeoutMs, outcome } = {}) {
  try {
    const reply = await requestAdvisoryJson(
      { systemPrompt, userPrompt, timeoutMs: timeoutMs ?? AI_TIMEOUT_MS, purpose: 'marketplace assistant' },
      gateway ? { gateway } : {},
    );
    const parsed = reply.value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.error === true) return null;
    PROVENANCE.set(parsed, { provider: reply.provider, model: reply.model, execution: reply.execution });
    return parsed;
  } catch (error) {
    // AiAdvisoryError (failure, timeout, malformed JSON, no credentials): the deterministic result stands.
    // OC-5R-REL-02 E: ONLY a timeout is named. It is the one failure a buyer can act on (ask again) and
    // the one the deployed proof measured; every other failure keeps the deterministic answer with no
    // reason, exactly as before — a provider outage is not a slow answer.
    if (outcome && error?.code === 'AI_TIMEOUT') outcome.reason = AI_TIMEOUT_REASON;
    return null;
  }
}

/**
 * OC-5R-REL-01: which model wrote an AI-assisted answer, carried on the answer itself
 * (`ai_provenance: { provider, model, execution }`) so a reader — and a deployed proof — never has
 * to infer it from configuration. Recorded only for answers the gateway actually executed.
 */
const PROVENANCE = new WeakMap();
function withProvenance(ai) {
  const provenance = ai && typeof ai === 'object' ? PROVENANCE.get(ai) : null;
  return provenance ? { ai_provenance: provenance } : {};
}

/**
 * The inference policy for a caller who has not PROVEN who they are (OC-3E-W1): no provider call at
 * all — the deterministic answer, and the reason the caller can act on.
 */
export const NO_PAID_INFERENCE = Object.freeze({
  aiCall: async () => null,
  aiReason: 'sign_in_required',
});

/**
 * Paid inference takes bounded input (OC-3E-W1): a request whose AI input serialises beyond this is
 * answered deterministically, ai_reason 'input_too_large', with no provider call.
 */
export const MAX_AI_INPUT_CHARS = 4000;

/** The inference policy for one request: anonymous → none; oversized → none; otherwise the caller's. */
function inferencePolicy(aiInput, deps = {}) {
  if (deps.aiReason) return deps;
  let size;
  try { size = JSON.stringify(aiInput ?? {}).length; } catch { size = Infinity; }
  if (size > MAX_AI_INPUT_CHARS) return { aiCall: async () => null, aiReason: 'input_too_large' };
  return deps;
}

/** The answer every function gives when no AI result is used. */
function withoutAi(deterministic, deps = {}) {
  return {
    ...deterministic,
    ai_status: 'ai_unavailable',
    ai_available: false,
    ...(deps.aiReason ? { ai_reason: deps.aiReason } : {}),
  };
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- AI Listing Builder ----------------------------------------------------

export function deterministicListingDraft(input = {}) {
  const { make, model, year, mileage, price, currency = 'USD', condition_category, fuel_type, transmission } = input;
  const headline = [year, titleCase(make), titleCase(model)].filter(Boolean).join(' ') || 'Vehicle listing';
  const specs = [
    mileage ? `${Number(mileage).toLocaleString()} km` : null,
    fuel_type ? titleCase(fuel_type) : null,
    transmission ? titleCase(transmission) : null,
    condition_category ? String(condition_category).replace(/_/g, ' ') : null,
  ].filter(Boolean);
  const missing = [];
  if (!make) missing.push('make');
  if (!model) missing.push('model');
  if (!year) missing.push('year');
  if (!price) missing.push('price');
  if (!input.primary_image_url) missing.push('at least one photo');
  return {
    title: headline,
    short_description: specs.length ? `${headline} · ${specs.join(' · ')}` : headline,
    detailed_description:
      `${headline}${specs.length ? ` (${specs.join(', ')})` : ''}. ` +
      `${price ? `Asking ${currency} ${Number(price).toLocaleString()}. ` : ''}` +
      'Contact via the CarUp verified inquiry flow. Inspection available on request.',
    recommended_tags: specs.length ? ['inspection_ready'] : [],
    missing_fields: missing,
    seller_checklist: [
      'Add clear photos (front, rear, sides, interior, odometer, engine bay).',
      'Confirm price and whether it is negotiable.',
      'Upload available evidence (registration, service history).',
      'Avoid unverifiable claims ("PartSentry checked", "verified") — those are governed.',
    ],
  };
}

export async function listingDraft(input = {}, requested = {}) {
  const deps = inferencePolicy(input, requested);
  const callAi = deps.aiCall || tryAi;
  const deterministic = deterministicListingDraft(input);
  const { ai, deps: used } = await attempt(callAi, deps,
    `You are CarUp listing assistant. Return strict JSON {title, short_description, detailed_description, recommended_tags[]}. Do not claim verification/PartSentry/passport status. ${NO_VALUATION_RULE}`,
    `Draft a marketplace listing for: ${JSON.stringify(input)}`
  );
  if (!ai) return withoutAi(deterministic, used);
  return {
    title: governedText(ai.title, deterministic.title),
    short_description: governedText(ai.short_description, deterministic.short_description),
    detailed_description: governedText(ai.detailed_description, deterministic.detailed_description),
    recommended_tags: deterministic.recommended_tags, // tags stay deterministic/governed
    missing_fields: deterministic.missing_fields,
    seller_checklist: deterministic.seller_checklist,
    ai_status: 'ai_assisted',
    ai_available: true,
    ...withProvenance(ai),
  };
}

// ---- AI Buyer Assistant ----------------------------------------------------

export function deterministicBuyerRecommendation(input = {}) {
  const notes = [];
  if (input.budget) notes.push(`Filter to listings at or below ${input.budget}.`);
  if (input.use_case) notes.push(`For "${input.use_case}", prioritise trust badges and inspection availability.`);
  notes.push('Prefer listings with verified evidence and request an independent inspection before paying.');
  notes.push('Use the verified inquiry flow — never pay outside CarUp.');
  return {
    intent: input.use_case || 'general_browse',
    suggested_filters: {
      maxPrice: input.budget || undefined,
      tag: 'evidence_available',
      sort: 'trust',
    },
    guidance: notes,
  };
}

export async function buyerAssistant(input = {}, requested = {}) {
  const deps = inferencePolicy(input, requested);
  const callAi = deps.aiCall || tryAi;
  const deterministic = deterministicBuyerRecommendation(input);
  const { ai, deps: used } = await attempt(callAi, deps,
    `You are CarUp buyer assistant. Return strict JSON {guidance: string[]}. Be safety-first; never invent trust/verification facts; never expose internal risk data. ${NO_VALUATION_RULE}`,
    `Buyer query: ${JSON.stringify(input)}`
  );
  if (!ai || !Array.isArray(ai.guidance)) return withoutAi(deterministic, used);
  const offered = ai.guidance.filter((line) => typeof line === 'string' && line.trim());
  const kept = offered.filter((line) => !containsValuationClaim(line));
  const withheld = offered.length - kept.length;
  if (kept.length === 0) {
    // Nothing usable survived: the buyer gets the deterministic guidance, told why.
    return {
      ...withoutAi(deterministic, { aiReason: withheld > 0 ? 'ai_output_withheld' : undefined }),
      ...(withheld > 0 ? { guidance: [...deterministic.guidance, VALUATION_WITHHELD_GUIDANCE], ai_withheld: withheld } : {}),
    };
  }
  return {
    ...deterministic,
    guidance: withheld > 0 ? [...kept, VALUATION_WITHHELD_GUIDANCE] : kept,
    ...(withheld > 0 ? { ai_withheld: withheld } : {}),
    ai_status: 'ai_assisted',
    ai_available: true,
    ...withProvenance(ai),
  };
}

// ---- Price estimate: deterministic, and no valuation ------------------------

/**
 * The all-in cost estimate, and nothing an AI could add to it. There is no approved valuation
 * provider, so there is no price intelligence to request: no provider call is made for any caller,
 * `price_confidence` stays the fixed cost-estimate label, and no `ai_notes` exist. The reason is the
 * same for every caller — signing in would not change it.
 */
export async function priceEstimate({ listingSummary = {}, listingType = 'vehicle' } = {}) {
  const pricing = buildPricingSummary({ listingSummary, listingType });
  return {
    ...pricing,
    ai_status: 'ai_unavailable',
    ai_available: false,
    ai_reason: 'valuation_not_configured',
  };
}

// ---- AI Share Copy ---------------------------------------------------------

export function deterministicShareCopy(input = {}) {
  const headline = [input.year, titleCase(input.make), titleCase(input.model)].filter(Boolean).join(' ') || 'this CarUp listing';
  const priceBit = input.price ? ` — ${input.currency || 'USD'} ${Number(input.price).toLocaleString()}` : '';
  const url = input.url || 'https://carup.example/marketplace';
  return {
    whatsapp: `Check out ${headline}${priceBit} on CarUp 🚗 ${url}`,
    telegram: `${headline}${priceBit} on CarUp — verified inquiry flow available. ${url}`,
    facebook: `${headline}${priceBit}. Browse trust-verified listings on CarUp. ${url}`,
    short: `${headline}${priceBit} · CarUp`,
  };
}

export async function shareCopy(input = {}, requested = {}) {
  const deps = inferencePolicy(input, requested);
  const callAi = deps.aiCall || tryAi;
  const deterministic = deterministicShareCopy(input);
  const { ai, deps: used } = await attempt(callAi, deps,
    `You are CarUp social copy assistant. Return strict JSON {whatsapp, telegram, facebook, short}. Keep it honest; no fabricated trust claims. ${NO_VALUATION_RULE}`,
    `Listing: ${JSON.stringify(input)}`
  );
  if (!ai) return withoutAi(deterministic, used);
  return {
    whatsapp: governedText(ai.whatsapp, deterministic.whatsapp),
    telegram: governedText(ai.telegram, deterministic.telegram),
    facebook: governedText(ai.facebook, deterministic.facebook),
    short: governedText(ai.short, deterministic.short),
    ai_status: 'ai_assisted',
    ai_available: true,
    ...withProvenance(ai),
  };
}

// ---- AI Admin Moderation Summary (advisory; human decides) -----------------

export function deterministicModerationSummary({ listingSummary = {}, trustSummary = {} } = {}) {
  const flags = [];
  if (trustSummary.risk_status && trustSummary.risk_status !== 'clear') flags.push(`risk=${trustSummary.risk_status}`);
  if (trustSummary.partsentry_public_status === 'suppressed') flags.push('partsentry_suppressed');
  if (trustSummary.evidence_status === 'review_required') flags.push('evidence_pending');
  return {
    summary: `Listing ${listingSummary.vin || ''}: ${flags.length ? flags.join(', ') : 'no governance flags raised'}.`,
    suggested_action: flags.length ? 'review' : 'monitor',
    flags,
  };
}

export async function moderationSummary({ listingSummary = {}, trustSummary = {} } = {}, requested = {}) {
  const deps = inferencePolicy({ vin: listingSummary.vin, risk: trustSummary.risk_status, partsentry: trustSummary.partsentry_public_status, evidence: trustSummary.evidence_status }, requested);
  const callAi = deps.aiCall || tryAi;
  const deterministic = deterministicModerationSummary({ listingSummary, trustSummary });
  const { ai, deps: used } = await attempt(callAi, deps,
    'You are CarUp moderation copilot. Return strict JSON {summary, suggested_action}. Advisory only — you cannot approve or change status. Do not expose private data.',
    `Listing trust state: ${JSON.stringify({ vin: listingSummary.vin, risk: trustSummary.risk_status, partsentry: trustSummary.partsentry_public_status, evidence: trustSummary.evidence_status })}`
  );
  if (!ai) return withoutAi(deterministic, used);
  return {
    summary: ai.summary || deterministic.summary,
    suggested_action: ['review', 'monitor', 'approve', 'suppress'].includes(ai.suggested_action) ? ai.suggested_action : deterministic.suggested_action,
    flags: deterministic.flags,
    ai_status: 'ai_assisted',
    ai_available: true,
    ...withProvenance(ai),
  };
}
