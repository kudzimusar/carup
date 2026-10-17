/**
 * The test-fixture guard — ONE rule for every simulated-AI / OCR fixture (OC-3B-R).
 *
 * Extracted from `DocumentIntelligenceService.isOcrMockAllowed()`, the canonical OCR mock guard.
 * Six hand-copied variants of it had drifted: the evidence-vision scenario key honoured
 * NODE_ENV=test alone, and the mock analysis provider — which echoes the caller's own metadata
 * back as an OCR reading — had no gate at all. A fixture (a scripted scenario, a sample document,
 * a canned model reply, a mock analysis) exists only when ALL of these hold:
 *
 *   - NODE_ENV === 'test' and ALLOW_OCR_MOCK === 'true' — the suite's explicit opt-in; and
 *   - the runtime does not DECLARE itself deployed: VERCEL_ENV is not production/preview, and
 *     CARUP_ENV is not production/staging.
 *
 * The second clause exists because the first has already failed once: CarUp ran NODE_ENV=test
 * inside a Vercel production environment (authMiddleware.isUserIdFallbackAllowed records it).
 * Conjoining the deployment declaration means no single mis-set variable can make a fixture live.
 * Values are compared literally for the opt-in (anything but 'true' is no) and case-insensitively
 * for the deployment markers (a ' Production ' typo still declares production).
 */

// The deployment declaration is the CENTRAL classifier (utils/runtimeEnvironment.js), not a copy:
// a second hand-kept list is how the variants above drifted (OC-5R-PROV-01 B1).
import { isDeployedRuntime } from '../utils/runtimeEnvironment.js';

export { isDeployedRuntime };

/** True only inside the test suite's explicit fixture runtime. */
export function isTestFixtureAllowed(env = process.env) {
  return env.NODE_ENV === 'test' && env.ALLOW_OCR_MOCK === 'true' && !isDeployedRuntime(env);
}

/**
 * True inside the test suite's runtime (NODE_ENV=test) — for a test-only DEFAULT that needs no
 * fixture opt-in, such as Document Intelligence's test attribution user. A declared deployment is
 * never the test runtime, whatever NODE_ENV says.
 */
export function isTestRuntime(env = process.env) {
  return env.NODE_ENV === 'test' && !isDeployedRuntime(env);
}

export default { isDeployedRuntime, isTestFixtureAllowed, isTestRuntime };
