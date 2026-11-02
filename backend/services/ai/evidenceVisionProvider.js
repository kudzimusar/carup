/**
 * Evidence-image analysis: WHICH executor, if any, may examine an evidence image (OC-5B).
 *
 * RC1 still selected a "live" analysis seam because GEMINI_API_KEY existed, and that seam ran the
 * evidence-vision SIMULATOR (no provider call). Every evidence upload ran the same simulator too. Its
 * output was labelled honestly (OC-3B), but a production-selectable simulator is itself the defect: a
 * key's presence decided that something "analysed" a person's evidence when nothing could.
 *
 * The rule now:
 *   - the labelled simulator exists ONLY in the test-fixture runtime (config/testFixtureGuard.js);
 *   - anywhere else an executor must be SELECTED (CARUP_EVIDENCE_VISION_PROVIDER) AND have a certified
 *     adapter. No adapter is certified on this lineage, so evidence-image inference is disabled, and
 *     says so: 'not_configured' (nothing selected) or 'provider_not_certified' (selected, no adapter).
 *   - a credential's presence selects nothing. GEMINI_API_KEY is not read here.
 *
 * Evidence-image analysis is advisory only. Reading text off an image (plate, VIN, odometer,
 * documents) belongs to the governed Document Intelligence OCR boundary, never to this module.
 */
import { isTestFixtureAllowed } from '../../config/testFixtureGuard.js';
import { analyzeEvidenceImage } from './aiVisionProvider.js';

export const EVIDENCE_VISION_STATES = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  PROVIDER_NOT_CERTIFIED: 'provider_not_certified',
  TEST_FIXTURE: 'test_fixture',
});

/**
 * Adapters CarUp has for evidence-image analysis, by selection name. EMPTY: none has been built and
 * certified (a LIVE-PROVIDER receipt in docs/one-carup/certification). Adding one is a deliberate,
 * reviewed change — never a side effect of a key appearing in an environment.
 */
export const CERTIFIED_EVIDENCE_VISION_ADAPTERS = Object.freeze({});

/**
 * @returns {{ available: true, state: 'test_fixture', provider: string, analyze: Function }
 *   | { available: false, state: 'not_configured' | 'provider_not_certified', provider: string|null, reason: string }}
 */
export function resolveEvidenceVision(env = process.env) {
  if (isTestFixtureAllowed(env)) {
    return { available: true, state: EVIDENCE_VISION_STATES.TEST_FIXTURE, provider: 'simulated', analyze: analyzeEvidenceImage };
  }
  const selected = String(env.CARUP_EVIDENCE_VISION_PROVIDER ?? '').trim().toLowerCase();
  if (!selected || selected === 'none') {
    return {
      available: false,
      state: EVIDENCE_VISION_STATES.NOT_CONFIGURED,
      provider: null,
      reason: 'No evidence-image analysis provider is configured.',
    };
  }
  const adapter = CERTIFIED_EVIDENCE_VISION_ADAPTERS[selected];
  if (!adapter) {
    return {
      available: false,
      state: EVIDENCE_VISION_STATES.PROVIDER_NOT_CERTIFIED,
      provider: selected,
      reason: `No certified evidence-image analysis adapter exists for '${selected}'.`,
    };
  }
  return { available: true, state: 'provider_selected', provider: selected, analyze: adapter.analyze };
}

/** The non-secret health projection: a state and a name, never a credential. */
export function evidenceVisionHealth(env = process.env) {
  const vision = resolveEvidenceVision(env);
  return { state: vision.state, provider: vision.provider, available: vision.available, authority: 'advisory' };
}

/**
 * The record kept on an evidence row when nothing examined its image: it says so, carries no score
 * and no confidence, and asks for the only thing that can honestly be asked — a human inspection.
 */
export function analysisNotRunRecord(vision) {
  return {
    ai_status: 'ai_not_configured',
    execution: 'not_run',
    provider: null,
    model: null,
    advisory: true,
    verifying: false,
    risk_score: null,
    confidence: null,
    public_safe_summary: null,
    recommended_action: 'inspect',
    analysis_state: vision.state,
    reviewer_summary: 'No AI analysis: no evidence-image analysis provider is configured, so nothing examined this image. A human reviewer must inspect it.',
  };
}

export default {
  EVIDENCE_VISION_STATES,
  CERTIFIED_EVIDENCE_VISION_ADAPTERS,
  resolveEvidenceVision,
  evidenceVisionHealth,
  analysisNotRunRecord,
};
