/**
 * Typed analysis provider abstraction — Milestone 3A (master plan §7.2, §7.3).
 *
 * One contract for many separate, typed tasks (no single opaque prompt). A deterministic
 * mock provider is always available for tests/fallback; the "live" seam is selected when a
 * Gemini key is configured, but it still runs the aiVisionProvider SIMULATOR for every task —
 * no Gemini call exists on this path — and is labelled `simulated` accordingly (OC-3B). The
 * abstraction keeps AI strictly advisory — it returns observations + confidence, never
 * verification or trust decisions (§2.2).
 */
import { analyzeEvidenceImage, honouredMockScenario } from './aiVisionProvider.js';

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
 * The "live" provider seam — which, today, is NOT live (OC-3B).
 *
 * Every task it serves runs `aiVisionProvider.analyzeEvidenceImage`, a simulator that calls no
 * provider. It used to label that output `provider: 'gemini'`, `model: 'gemini-2.5-flash'`, and
 * `analysisJobService` persisted those labels into `ai_analysis_jobs` — a durable record claiming a
 * provider executed that never did. Invariant: the provider field names the EXECUTOR. The label is
 * therefore taken from what actually ran, so wiring a real provider later changes the label by
 * construction, and nothing here can claim Gemini without Gemini having answered.
 */
export const liveAnalysisProvider = {
  id: 'simulated',
  mode: 'simulated',
  async analyze(task, ctx = {}) {
    const { buffer, mimeType, evidenceType, metadata = {} } = ctx;
    if (OCR_TASKS.has(task) || task === 'damage_detection' || task === 'manipulation') {
      // analyzeEvidenceImage returns a structured advisory result; adapt to the typed shape.
      const r = await analyzeEvidenceImage(buffer, mimeType, evidenceType, metadata);
      return {
        task,
        provider: r.provider || 'simulated',
        model: r.model || null,
        execution: r.execution || 'simulated',
        advisory: true,
        confidence: typeof r.confidence === 'number' ? r.confidence : 0,
        result: {
          plate: r.visible_plate ?? null, vin: r.visible_vin ?? null, odometer: r.visible_odometer ?? null,
          damage: r.damage_indicators || [], manipulation: r.manipulation_indicators || [],
        },
        // A simulation has no public-safe summary to give.
        safe_summary: r.execution === 'provider_executed' ? (r.public_safe_summary || null) : null,
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
