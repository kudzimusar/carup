/**
 * Marketplace AI assistant — ADVISORY ONLY with deterministic fallback.
 *
 * Every function returns a useful deterministic result even when the AI provider is unavailable, and
 * NEVER throws because of AI (plan rule 7). AI output exposed to buyers/sellers never includes internal
 * risk/fraud reasoning. Backend governance rules remain the source of truth — AI cannot approve
 * listings, set verification, or override suppression.
 *
 * Provider: backend/services/ai/GeminiClient.js (askGemini). On missing key / error / timeout we fall
 * back to deterministic templates and surface ai_status='ai_unavailable'.
 */

import { askGemini } from '../ai/GeminiClient.js';
import { buildPricingSummary } from './marketplacePricingService.js';

const AI_TIMEOUT_MS = 12000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('ai_timeout')), ms)),
  ]);
}

/** Try the provider in JSON mode; returns parsed object or null (never throws). */
async function tryAi(systemPrompt, userPrompt) {
  try {
    const raw = await withTimeout(Promise.resolve(askGemini(systemPrompt, userPrompt, true)), AI_TIMEOUT_MS);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // GeminiClient returns an {error:true,...} envelope on provider failure — treat as unavailable.
    if (parsed && parsed.error === true) return null;
    return parsed;
  } catch {
    return null;
  }
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

export async function listingDraft(input = {}, deps = {}) {
  const callAi = deps.aiCall || tryAi;
  const deterministic = deterministicListingDraft(input);
  const ai = await callAi(
    'You are CarUp listing assistant. Return strict JSON {title, short_description, detailed_description, recommended_tags[]}. Do not claim verification/PartSentry/passport status.',
    `Draft a marketplace listing for: ${JSON.stringify(input)}`
  );
  if (!ai) return { ...deterministic, ai_status: 'ai_unavailable', ai_available: false };
  return {
    title: ai.title || deterministic.title,
    short_description: ai.short_description || deterministic.short_description,
    detailed_description: ai.detailed_description || deterministic.detailed_description,
    recommended_tags: deterministic.recommended_tags, // tags stay deterministic/governed
    missing_fields: deterministic.missing_fields,
    seller_checklist: deterministic.seller_checklist,
    ai_status: 'ai_assisted',
    ai_available: true,
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

export async function buyerAssistant(input = {}, deps = {}) {
  const callAi = deps.aiCall || tryAi;
  const deterministic = deterministicBuyerRecommendation(input);
  const ai = await callAi(
    'You are CarUp buyer assistant. Return strict JSON {guidance: string[]}. Be safety-first; never invent trust/verification facts; never expose internal risk data.',
    `Buyer query: ${JSON.stringify(input)}`
  );
  if (!ai || !Array.isArray(ai.guidance)) return { ...deterministic, ai_status: 'ai_unavailable', ai_available: false };
  return { ...deterministic, guidance: ai.guidance, ai_status: 'ai_assisted', ai_available: true };
}

// ---- AI Price Intelligence (anchored to deterministic bands) ---------------

export async function priceEstimate({ listingSummary = {}, listingType = 'vehicle' } = {}, deps = {}) {
  const callAi = deps.aiCall || tryAi;
  // Deterministic all-in cost is authoritative; AI may only annotate confidence/notes.
  const pricing = buildPricingSummary({ listingSummary, listingType });
  const ai = await callAi(
    'You are CarUp price intelligence. Return strict JSON {price_confidence: "low"|"medium"|"high", notes: string[]}. Be conservative; this is advisory only.',
    `Vehicle: ${JSON.stringify({ make: listingSummary.make, model: listingSummary.model, year: listingSummary.year, mileage: listingSummary.mileage, price: listingSummary.price })}`
  );
  if (!ai) return { ...pricing, ai_status: 'ai_unavailable', ai_available: false };
  return {
    ...pricing,
    price_confidence: ['low', 'medium', 'high'].includes(ai.price_confidence) ? ai.price_confidence : pricing.price_confidence,
    estimate_basis: 'ai_assisted',
    ai_notes: Array.isArray(ai.notes) ? ai.notes.slice(0, 5) : [],
    ai_status: 'ai_assisted',
    ai_available: true,
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

export async function shareCopy(input = {}, deps = {}) {
  const callAi = deps.aiCall || tryAi;
  const deterministic = deterministicShareCopy(input);
  const ai = await callAi(
    'You are CarUp social copy assistant. Return strict JSON {whatsapp, telegram, facebook, short}. Keep it honest; no fabricated trust claims.',
    `Listing: ${JSON.stringify(input)}`
  );
  if (!ai) return { ...deterministic, ai_status: 'ai_unavailable', ai_available: false };
  return {
    whatsapp: ai.whatsapp || deterministic.whatsapp,
    telegram: ai.telegram || deterministic.telegram,
    facebook: ai.facebook || deterministic.facebook,
    short: ai.short || deterministic.short,
    ai_status: 'ai_assisted',
    ai_available: true,
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

export async function moderationSummary({ listingSummary = {}, trustSummary = {} } = {}, deps = {}) {
  const callAi = deps.aiCall || tryAi;
  const deterministic = deterministicModerationSummary({ listingSummary, trustSummary });
  const ai = await callAi(
    'You are CarUp moderation copilot. Return strict JSON {summary, suggested_action}. Advisory only — you cannot approve or change status. Do not expose private data.',
    `Listing trust state: ${JSON.stringify({ vin: listingSummary.vin, risk: trustSummary.risk_status, partsentry: trustSummary.partsentry_public_status, evidence: trustSummary.evidence_status })}`
  );
  if (!ai) return { ...deterministic, ai_status: 'ai_unavailable', ai_available: false };
  return {
    summary: ai.summary || deterministic.summary,
    suggested_action: ['review', 'monitor', 'approve', 'suppress'].includes(ai.suggested_action) ? ai.suggested_action : deterministic.suggested_action,
    flags: deterministic.flags,
    ai_status: 'ai_assisted',
    ai_available: true,
  };
}
