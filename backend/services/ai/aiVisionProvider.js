/**
 * Evidence-image analysis — a SIMULATOR, and labelled as one (OC-3B).
 *
 * No AI provider is called here: this module has never been wired to a live vision model. Before
 * OC-3B it nevertheless answered `ai_passed` / `approve`, echoed the uploader's own metadata back
 * as the VIN, plate and odometer it had "seen", invented a dent on every damage photo, and produced
 * the public string "AI analysis: image verified clean." — republished on every human-verified
 * evidence row. A simulation that cannot see the image may not say what is in it.
 *
 * Contract of every result:
 *   provider 'simulated' · execution 'simulated' · advisory true · verifying false ·
 *   public_safe_summary null · never ai_passed / approve.
 *
 * `metadata.mock_ai_scenario` (reachable from `req.body.metadata` on upload) selects a scripted
 * outcome ONLY in the test-fixture runtime (config/testFixtureGuard.js: NODE_ENV=test AND
 * ALLOW_OCR_MOCK=true AND no declared deployment — OC-3B-R; it used to need NODE_ENV=test alone).
 * Anywhere else an uploader could otherwise choose the verdict on their own evidence.
 *
 * OC-5B: the simulator itself now exists ONLY in the test-fixture runtime. It was selectable in
 * production (by any GEMINI_API_KEY, and on every upload); outside the fixture runtime it refuses,
 * and the one selector (evidenceVisionProvider.js) records "not configured" instead of running it.
 */
import { isTestFixtureAllowed } from '../../config/testFixtureGuard.js';

export const SIMULATED_VISION = Object.freeze({
  provider: 'simulated',
  model: 'carup-evidence-vision-simulator-v1',
  execution: 'simulated',
});

/** The scripted-scenario key is a test fixture; outside the test-fixture runtime it does not exist. */
export function honouredMockScenario(metadata) {
  if (!isTestFixtureAllowed()) return null;
  const scenario = metadata?.mock_ai_scenario;
  return typeof scenario === 'string' && scenario ? scenario : null;
}

/** The simulator was asked to run outside the test-fixture runtime. Never retryable. */
export class EvidenceVisionUnavailableError extends Error {
  constructor() {
    super('No evidence-image analysis provider is available in this runtime; the simulator is a test fixture.');
    this.name = 'EvidenceVisionUnavailableError';
    this.code = 'EVIDENCE_VISION_UNAVAILABLE';
    this.retryable = false;
  }
}

export async function analyzeEvidenceImage(fileBuffer, mimeType, evidenceType, metadata = {}) {
  if (!isTestFixtureAllowed()) throw new EvidenceVisionUnavailableError();
  const scenario = honouredMockScenario(metadata);
  if (scenario === 'provider_error') {
    throw new Error('AI Vision provider service timeout or connection refused (Simulated API error).');
  }

  // Abstracted wrapper that simulates Vision analysis
  // Decoupled from live API providers for Phase 4.
  const timeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 10000);
  
  const analysisPromise = new Promise((resolve) => {
    // Simulate minor network processing latency
    setTimeout(() => {
      // The simulator examined nothing, so by default it reports nothing: no score, no confidence,
      // nothing "visible", and a human inspection as the only recommendation it can honestly make.
      let riskScore = null;
      let confidence = 0;
      let aiStatus = 'ai_simulated';
      let recommendedAction = 'inspect';
      let reviewerSummary = 'Simulated analysis only: no AI provider examined this image. A human reviewer must inspect it.';
      let visiblePlate = null;
      let visibleVin = null;
      let visibleOdometer = null;
      let damageIndicators = [];
      let manipulationIndicators = [];
      let detectedObjects = [];

      switch (scenario) {
        case 'flagged_vin_mismatch':
          riskScore = 0.9;
          confidence = 0.98;
          aiStatus = 'ai_flagged';
          recommendedAction = 'reject';
          visibleVin = 'VIN_MISMATCH_999';
          reviewerSummary = 'Visible VIN in document/photo (VIN_MISMATCH_999) does not match vehicle registered VIN.';
          detectedObjects = ['vin_plate', 'registration_document'];
          break;

        case 'flagged_manipulation':
          riskScore = 0.8;
          confidence = 0.85;
          aiStatus = 'ai_flagged';
          recommendedAction = 'reject';
          manipulationIndicators = [{ type: 'compression_mismatch', severity: 'high', notes: 'Metadata mismatch detected' }];
          reviewerSummary = 'Suspicious metadata modification and compression levels suggesting image manipulation.';
          detectedObjects = ['car_photo'];
          break;

        case 'flagged_odometer_rollback':
          riskScore = 0.85;
          confidence = 0.92;
          aiStatus = 'ai_flagged';
          recommendedAction = 'reject';
          visibleOdometer = 45000;
          reviewerSummary = 'Odometer reading in photo (45,000 km) is lower than the last recorded mileage (80,000 km) in maintenance logs.';
          detectedObjects = ['odometer_display'];
          break;

        case 'low_confidence':
          riskScore = 0.15;
          confidence = 0.45;
          aiStatus = 'ai_low_confidence';
          recommendedAction = 'inspect';
          reviewerSummary = 'Image is blurry or low resolution. Unable to confidently extract details.';
          break;

        case 'manual_review_required':
          riskScore = 0.3;
          confidence = 0.7;
          aiStatus = 'ai_manual_review_required';
          recommendedAction = 'inspect';
          reviewerSummary = 'Complex or unreadable document layout. Manual reviewer inspection recommended.';
          break;

        default:
          // No scripted scenario: the honest simulated result above stands. (This branch used to
          // invent an odometer of 120,000 km, a front-bumper dent and "detected" objects.)
          break;
      }

      resolve({
        ...SIMULATED_VISION,
        advisory: true,
        verifying: false,
        risk_score: riskScore,
        confidence,
        ai_status: aiStatus,
        recommended_action: recommendedAction,
        reviewer_summary: reviewerSummary,
        visible_plate: visiblePlate,
        visible_vin: visibleVin,
        visible_odometer: visibleOdometer,
        damage_indicators: damageIndicators,
        manipulation_indicators: manipulationIndicators,
        detected_objects: detectedObjects,
        // A simulation has nothing to tell the public. Never a "verified"/"clean" claim.
        public_safe_summary: null
      });
    }, 50);
  });

  // Enforce strict timeout boundary. The timer MUST be cleared once the race
  // settles — otherwise every analysis leaves a dangling multi-second timer
  // that keeps the event loop alive (a real resource leak under load, and the
  // cause of the test-runner IPC crash when this suite runs alongside others).
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`AI Vision provider analysis timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([analysisPromise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}
