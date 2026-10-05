/**
 * Typed analysis provider abstraction — Milestone 3A (master plan §7.2, §7.3).
 *
 * One contract for many separate, typed tasks (no single opaque prompt). A deterministic mock provider
 * exists for the test suite ONLY (OC-3B-R): it reads nothing — it echoes the caller's own metadata and
 * calls every image usable — so outside the test-fixture runtime it throws AnalysisUnavailableError
 * and the job fails instead of persisting an echo.
 *
 * OC-5B: the "live" seam is gone. It was selected whenever GEMINI_API_KEY existed and then ran the
 * evidence-vision SIMULATOR for every task (no provider call). Selection is now
 * evidenceVisionProvider.resolveEvidenceVision: the test-fixture runtime gets the mock; anywhere else an
 * adapter must be selected AND certified, and none is, so every task fails terminally with
 * AI_ANALYSIS_UNAVAILABLE — an honest "not configured", never a simulation. AI stays strictly
 * advisory — observations + confidence, never verification or trust decisions (§2.2).
 */
import { honouredMockScenario } from './aiVisionProvider.js';
import { isTestFixtureAllowed } from '../../config/testFixtureGuard.js';
import { resolveEvidenceVision } from './evidenceVisionProvider.js';

export const TASK_TYPES = Object.freeze([
  'image_quality', 'viewpoint', 'identity_cues', 'plate_ocr', 'vin_ocr', 'odometer_ocr',
  'document_extraction', 'component_detection', 'damage_detection',
  'repair_paint_inconsistency', 'manipulation', 'near_duplicate', 'same_vehicle_similarity',
]);


/**
 * No analysis provider can run this task in this runtime (OC-3B-R). Not retryable: a retry cannot
 * create a provider, so a job that meets it fails terminally rather than queueing for ever.
 */
export class AnalysisUnavailableError extends Error {
  constructor(task, reason = 'the deterministic mock is a test fixture') {
    super(`No AI analysis provider can run '${task}' in this runtime: ${reason}.`);
    this.name = 'AnalysisUnavailableError';
    this.code = 'AI_ANALYSIS_UNAVAILABLE';
    this.retryable = false;
  }
}

/**
 * Deterministic mock provider — a TEST FIXTURE. Produces stable, typed results for each task so
 * tests and the evaluation harness are reproducible; it examines no image (its OCR "readings" are
 * the caller's own metadata), so it exists only in the test-fixture runtime (OC-3B-R). Nothing
 * here auto-publishes or auto-approves.
 */
export const mockAnalysisProvider = {
  id: 'mock',
  mode: 'mock',
  async analyze(task, { metadata = {} } = {}) {
    if (!TASK_TYPES.includes(task)) throw new Error(`unknown task '${task}'`);
    if (!isTestFixtureAllowed()) throw new AnalysisUnavailableError(task);
    // Scripted scenarios are a NODE_ENV=test fixture only (OC-3B) — never a caller-chosen result.
    const scenario = honouredMockScenario(metadata);
    const base = { task, provider: 'mock', model: 'mock-v1', execution: 'mock', advisory: true, confidence: 0.9, observations: [], safe_summary: null };
    switch (task) {
      case 'image_quality':
        return { ...base, confidence: 0.95, result: { usable: scenario !== 'blurry', blur: scenario === 'blurry' ? 0.8 : 0.1 } };
      case 'viewpoint':
        return { ...base, result: { viewpoint: metadata.viewpoint || 'front' } };
      case 'plate_ocr':
        return { ...base, confidence: 0.8, result: { plate: metadata.plate_number || null } };
      case 'vin_ocr':
        return { ...base, confidence: 0.8, result: { vin: metadata.vin || null } };
      case 'odometer_ocr':
        return { ...base, confidence: 0.75, result: { odometer: metadata.odometer_reading ?? null, unit: 'km' } };
      case 'document_extraction':
        return { ...base, confidence: 0.7, result: { fields: metadata.expected_fields || {} } };
      case 'component_detection':
        return { ...base, result: { components: metadata.components || ['front_bumper', 'bonnet', 'windscreen'] } };
      case 'damage_detection':
        return { ...base, confidence: 0.7, result: { damage: scenario === 'damaged' ? [{ component: metadata.component || 'front_bumper', severity: 'medium' }] : [] } };
      case 'repair_paint_inconsistency':
        return { ...base, confidence: 0.6, result: { repainted: scenario === 'repainted', components: scenario === 'repainted' ? [metadata.component || 'front_bumper'] : [] } };
      case 'manipulation':
        return { ...base, confidence: 0.6, result: { manipulated: scenario === 'manipulated' } };
      default:
        return { ...base, result: {} };
    }
  },
};

/**
 * Outside the test-fixture runtime, with no certified adapter selected: every task is refused,
 * terminally, with the selector's own reason. Nothing is simulated and nothing is persisted as a result.
 */
export function unavailableAnalysisProvider(reason) {
  return {
    id: 'unavailable',
    mode: 'unavailable',
    async analyze(task) {
      if (!TASK_TYPES.includes(task)) throw new Error(`unknown task '${task}'`);
      throw new AnalysisUnavailableError(task, reason);
    },
  };
}

/** Resolve the active provider through the one evidence-vision selector (OC-5B). */
export function resolveAnalysisProvider({ forceMock = false } = {}) {
  if (forceMock) return mockAnalysisProvider;
  const vision = resolveEvidenceVision();
  if (vision.state === 'test_fixture') return mockAnalysisProvider;
  return unavailableAnalysisProvider(vision.available ? 'no typed adapter is wired for this provider' : vision.reason.replace(/\.$/, ''));
}

export default { TASK_TYPES, AnalysisUnavailableError, mockAnalysisProvider, unavailableAnalysisProvider, resolveAnalysisProvider };
