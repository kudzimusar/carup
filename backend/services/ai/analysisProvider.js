/**
 * Typed analysis provider abstraction — Milestone 3A (master plan §7.2, §7.3).
 *
 * One contract for many separate, typed tasks (no single opaque prompt). A deterministic
 * mock provider is always available for tests/fallback; a live provider is selected only
 * when configured. OCR/document tasks route to the existing live Gemini client; vision
 * tasks reuse the existing aiVisionProvider. The abstraction keeps AI strictly advisory —
 * it returns observations + confidence, never verification or trust decisions (§2.2).
 */
import { analyzeEvidenceImage } from './aiVisionProvider.js';

export const TASK_TYPES = Object.freeze([
  'image_quality', 'viewpoint', 'identity_cues', 'plate_ocr', 'vin_ocr', 'odometer_ocr',
  'document_extraction', 'component_detection', 'damage_detection',
  'repair_paint_inconsistency', 'manipulation', 'near_duplicate', 'same_vehicle_similarity',
]);

const OCR_TASKS = new Set(['plate_ocr', 'vin_ocr', 'odometer_ocr', 'document_extraction']);

export function isLiveConfigured() {
  return Boolean(process.env.GEMINI_API_KEY) && process.env.ALLOW_OCR_MOCK !== 'true';
}

/**
 * Deterministic mock provider. Produces stable, typed results for each task so tests and
 * the evaluation harness are reproducible. Confidence is conservative; nothing here
 * auto-publishes or auto-approves.
 */
export const mockAnalysisProvider = {
  id: 'mock',
  mode: 'mock',
  async analyze(task, { metadata = {} } = {}) {
    if (!TASK_TYPES.includes(task)) throw new Error(`unknown task '${task}'`);
    const scenario = metadata.mock_ai_scenario || null;
    const base = { task, provider: 'mock', model: 'mock-v1', confidence: 0.9, observations: [], safe_summary: null };
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
 * Live provider seam. OCR/document tasks call the live Gemini-backed image analyzer; vision
 * tasks reuse aiVisionProvider. Falls back to mock task output if a live call yields nothing.
 * Kept thin on purpose — the heavy lifting (jobs, retries, persistence) lives in the job service.
 */
export const liveAnalysisProvider = {
  id: 'gemini',
  mode: 'live',
  async analyze(task, ctx = {}) {
    const { buffer, mimeType, evidenceType, metadata = {} } = ctx;
    if (OCR_TASKS.has(task) || task === 'damage_detection' || task === 'manipulation') {
      // analyzeEvidenceImage returns a structured advisory result; adapt to the typed shape.
      const r = await analyzeEvidenceImage(buffer, mimeType, evidenceType, metadata);
      return {
        task, provider: 'gemini', model: process.env.OCR_MODEL || 'gemini-2.5-flash',
        confidence: typeof r.confidence === 'number' ? r.confidence : 0.7,
        result: {
          plate: r.visible_plate ?? null, vin: r.visible_vin ?? null, odometer: r.visible_odometer ?? null,
          damage: r.damage_indicators || [], manipulation: r.manipulation_indicators || [],
        },
        safe_summary: r.public_safe_summary || null,
        observations: [],
      };
    }
    // No live model wired for this task yet — fall back to the deterministic mock result.
    return mockAnalysisProvider.analyze(task, ctx);
  },
};

/** Resolve the active provider. Live only when configured; mock otherwise (master plan §7.2). */
export function resolveAnalysisProvider({ forceMock = false } = {}) {
  if (forceMock || !isLiveConfigured()) return mockAnalysisProvider;
  return liveAnalysisProvider;
}

export default { TASK_TYPES, isLiveConfigured, mockAnalysisProvider, liveAnalysisProvider, resolveAnalysisProvider };
