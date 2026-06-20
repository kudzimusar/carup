/**
 * Phase 5 — deterministic AI intent parser.
 *
 * A repeatable, test-friendly fallback parser. An external LLM adapter could replace `parseCommand`,
 * but the deterministic parser is the contract for tests and offline operation. It never executes
 * anything — it only classifies intent, extracts entities, scores confidence and reports ambiguity.
 */
import { AI_INTENTS, AI_RISK_TIERS } from '../../constants/diaspora/diasporaAiConstants.js';

function normalize(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Extract simple, explainable entities: a target id, then a quantity (ignoring the id's digits). */
export function extractEntities(text) {
  const entities = {};

  const uuid = text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  if (uuid) entities.targetId = uuid[1];
  const ref = text.match(/\b((?:ord|stk|doc|cont|q|res)-[a-z0-9]+)\b/i);
  if (!entities.targetId && ref) entities.targetId = ref[1];

  // Strip any matched id tokens so their embedded digits don't pollute quantity extraction.
  let scratch = text;
  if (entities.targetId) scratch = scratch.split(entities.targetId.toLowerCase()).join(' ');
  const qty = scratch.match(/\b(\d+)\s*(units?|pcs?|pieces?|qty)?\b/);
  if (qty) entities.quantity = Number(qty[1]);

  return entities;
}

/**
 * Classify intent against the catalogue by keyword presence. Returns the best match plus all matched
 * candidates so ambiguity can be reported.
 */
export function classifyIntent(normalized) {
  const matches = [];
  for (const [intent, def] of Object.entries(AI_INTENTS)) {
    const hit = def.keywords.find((kw) => normalized.includes(kw));
    if (hit) matches.push({ intent, def, keyword: hit, specificity: hit.length });
  }
  matches.sort((a, b) => b.specificity - a.specificity);
  return matches;
}

export function parseCommand(rawCommand = '', context = {}) {
  const normalized = normalize(rawCommand);
  const reasons = [];
  if (!normalized) {
    return { intent: null, risk: null, confidence: 0, entities: {}, ambiguous: true, reasons: ['Empty command'], normalized };
  }

  const matches = classifyIntent(normalized);
  const entities = extractEntities(normalized);

  if (matches.length === 0) {
    return { intent: null, risk: null, confidence: 0.1, entities, ambiguous: true, reasons: ['No known intent matched'], normalized };
  }

  const best = matches[0];
  const intent = best.intent;
  const def = best.def;
  const risk = def.risk;

  // Confidence: strong if a single clear match; reduced when multiple distinct intents matched.
  const distinctIntents = new Set(matches.map((m) => m.intent));
  let confidence = 0.9;
  if (distinctIntents.size > 1) {
    confidence = 0.45;
    reasons.push(`Multiple intents matched (${[...distinctIntents].join(', ')})`);
  } else {
    reasons.push(`Matched intent ${intent} via "${best.keyword}"`);
  }

  // Required-entity check → ambiguity if missing.
  const missing = (def.requires || []).filter((r) => entities[r] === undefined || entities[r] === null);
  const ambiguous = distinctIntents.size > 1 || missing.length > 0;
  if (missing.length) {
    reasons.push(`Missing required entit${missing.length > 1 ? 'ies' : 'y'}: ${missing.join(', ')}`);
    confidence = Math.min(confidence, 0.4);
  }

  void context;
  return {
    intent,
    action: def.action,
    risk,
    riskTier: AI_RISK_TIERS[risk] || risk,
    confidence,
    entities,
    missing,
    ambiguous,
    reasons,
    normalized,
    candidates: [...distinctIntents],
  };
}
