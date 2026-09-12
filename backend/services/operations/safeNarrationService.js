/**
 * O2-X6 §18 — safe narration over governed structured facts.
 *
 * AI may make a sentence FRIENDLIER; it may never make it DIFFERENT. The
 * structured summary passes through VERBATIM alongside any narrative, the
 * deterministic sentence is always computed first, and an AI failure (or a
 * response that contradicts the facts) falls back to the deterministic
 * sentence. AI cannot change codes, counts, statuses or who_must_act — pinned.
 */
import { askGemini } from '../ai/GeminiClient.js';

export function deterministicNarrative(summary = {}) {
  const missing = Array.isArray(summary.missing) ? summary.missing : [];
  if (!missing.length) {
    return 'Nothing is outstanding from your side right now.';
  }
  const labels = missing.map((item) => item.label || item.code).filter(Boolean);
  return `We still need: ${labels.join(' · ')}.`;
}

/**
 * @returns {{ structured: object, narrative: string, narrative_provider: 'deterministic'|'ai' }}
 * `structured` is the input summary UNCHANGED (same reference — truth is not re-authored here).
 */
export async function narrateActionSummary(summary = {}, options = {}) {
  const base = deterministicNarrative(summary);
  const askAi = options.ai || (async (system, user) => askGemini(system, user, false));
  const labels = (Array.isArray(summary.missing) ? summary.missing : [])
    .map((item) => item.label || item.code)
    .filter(Boolean);

  if (!labels.length || options.ai === null) {
    return { structured: summary, narrative: base, narrative_provider: 'deterministic' };
  }

  try {
    const response = await askAi(
      'Rewrite the sentence in warm, plain English for a user. You MUST mention every listed item '
      + 'verbatim, add no new requirements, no reasons, and no promises. Reply with the sentence only.',
      `Items still needed: ${labels.join(' | ')}\nBase sentence: ${base}`,
    );
    const narrative = String(response || '').trim();
    // The narrative is refused unless every governed item survives verbatim.
    const complete = narrative.length > 0 && labels.every((label) => narrative.toLowerCase().includes(String(label).toLowerCase()));
    if (!complete) {
      return { structured: summary, narrative: base, narrative_provider: 'deterministic' };
    }
    return { structured: summary, narrative, narrative_provider: 'ai' };
  } catch {
    return { structured: summary, narrative: base, narrative_provider: 'deterministic' };
  }
}
