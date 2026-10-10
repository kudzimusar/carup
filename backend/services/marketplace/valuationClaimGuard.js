/**
 * OC-5R-REL-01 — the deterministic guard that keeps valuation claims out of Marketplace AI output.
 *
 * CarUp has no approved valuation provider and publishes no vehicle valuation (no "current value",
 * no fair price, no market range). An advisory model asked "is this a fair price?" will answer
 * anyway, in free text, and an answer such as "a fair price for a 2020 Hilux" or "about 10% below
 * market" is a valuation claim with nothing behind it. The prompt asks the model not to make one;
 * this guard is what makes that hold, because a prompt is a request and not a boundary.
 *
 * The rule is deliberately CONSERVATIVE: a line that matches is withheld whole, and the caller falls
 * back to its deterministic answer. Withholding a harmless line ("it is worth requesting an
 * inspection") costs a sentence; publishing an invented valuation misleads a buyer. Money figures
 * and percentages are withheld too — the model holds no governed price, so any amount it writes is
 * either an echo of the caller's input or an invention, and the guard cannot tell which.
 */

export const VALUATION_CLAIM_PATTERNS = Object.freeze([
  // A money figure in any common shape.
  /(?:\$|\bUS\$)\s?\d/,
  /\b(?:USD|ZWG|ZiG|ZWL|ZAR)\s?\d/i,
  /\bR\s?\d[\d,]{2,}/,
  /\b\d[\d,.]*\s?(?:USD|ZWG|ZiG|ZWL|ZAR|dollars?|rand)\b/i,
  // A percentage ("10% below market").
  /\b\d+(?:\.\d+)?\s?%/,
  // Valuation vocabulary.
  /\b(?:valuations?|valued|undervalued|overvalued|worth|appraisal|appraised)\b/i,
  /\b(?:over|under)-?priced\b/i,
  /\b(?:bargain|steal|rip-?off|cheap|expensive|pricey|affordable)\b/i,
  /\b(?:market|resale|trade-?in|retail|book|fair|true|real|current|estimated)\s+(?:value|price|pricing|rate|range)\b/i,
  /\b(?:fair|reasonable|good|great|excellent|competitive|attractive|solid|decent|bad|poor|high|low|steep|inflated|realistic|best)\s+(?:price|pricing|value|deal|buy|offer)\b/i,
  /\bvalue\s+for\s+money\b/i,
  /\bpriced\s+(?:well|right|fairly|competitively|to\s+sell|below|above|under|over|high|low)\b/i,
  /\b(?:below|above|under|over)\s+(?:the\s+)?market\b/i,
  /\b(?:depreciat\w*|holds?\s+(?:its\s+|their\s+)?value)\b/i,
]);

/** True when the text makes (or may make) a valuation claim. Non-strings are not claims. */
export function containsValuationClaim(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return VALUATION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The line a buyer sees in place of withheld AI guidance. Worded so it passes the guard itself:
 * every guidance line the assistant returns satisfies one invariant.
 */
export const VALUATION_WITHHELD_GUIDANCE =
  'AI comments about price or value are withheld: CarUp has no approved source for what a vehicle should cost. '
  + 'Compare the asking price yourself and request an independent inspection before paying.';
