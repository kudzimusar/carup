/**
 * O2 OCR Stage-4 certification POLICY — pure predicates that classify UAT proof.
 *
 * This module holds ONLY the decision logic that turns observed deployed-journey proof into a
 * certification disposition. It contains no product authority, no DB access, no network, and no
 * side effects, so it can be unit-tested deterministically. The Stage-4 driver
 * (o2-ocr-stage4-staging-uat.mjs) imports these predicates; the driver still owns all real I/O.
 *
 * Certification rule (moderator continuation 5):
 *   Presence is proof ONLY when it is positive and exact. Missing provider/model provenance is not
 *   acceptable evidence. A provider runtime error is not a document verdict. Three journeys means
 *   three independently proven journeys.
 */

export const CERTIFIED_PROVIDER = 'cloudflare';
export const CERTIFIED_MODEL = '@cf/qwen/qwen3.8-27b';
export const CLASSIFIER_PROVIDER = CERTIFIED_PROVIDER;
export const CLASSIFIER_MODEL = CERTIFIED_MODEL;
export const EXTRACTION_ALLOWED_CLASSIFICATIONS = Object.freeze([
  'valid_identity_document',
  'likely_identity_document',
]);

/**
 * A definitive PROVIDER-level configuration/outage signal in free text (HTTP error body, runtime
 * error, persisted classifier reason). NOT a document verdict.
 */
export function isProviderBlockText(...parts) {
  const s = parts
    .filter((p) => p !== undefined && p !== null)
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  return /provider unavailable|not configured|OCR_PROVIDER_UNAVAILABLE|OCR provider unavailable|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_API_TOKEN|GEMINI_API_KEY|Classification provider error|Classification provider unavailable|timed out|timeout|quota|rate limit|rate-limit|provider refused|transport failure|provider HTTP/i.test(s);
}

/** A provider-level execution status (the provider was reached and did not succeed). */
export function isProviderBlockStatus(execStatus) {
  return execStatus === 'provider_failed' || execStatus === 'provider_unavailable';
}

/**
 * Given the persisted classifier reasons (verification_assessments.risk_flags.reasons), decide
 * whether they describe a genuine PROVIDER failure (block) as opposed to a model VERDICT
 * (unreadable / non_document / uncertain about the document itself, which is a product outcome).
 */
export function classifierReasonIndicatesProviderError(reasons) {
  const list = Array.isArray(reasons) ? reasons : (reasons ? [reasons] : []);
  return isProviderBlockText(...list);
}

/**
 * Positive, exact Identity certification proof:
 *   classifier provider == cloudflare AND classifier model == @cf/qwen/qwen3.8-27b AND
 *   classification ∈ {valid,likely} AND OCR provider == cloudflare AND
 *   OCR model == @cf/qwen/qwen3.8-27b AND ocr_execution_status == provider_succeeded.
 * Missing provider/model provenance on either classifier or extraction is NOT proof.
 */
export function identityCertifiable(s = {}) {
  return (
    s.classificationProvider === CLASSIFIER_PROVIDER
    && s.classificationModel === CLASSIFIER_MODEL
    && EXTRACTION_ALLOWED_CLASSIFICATIONS.includes(s.classification)
    && s.ocrExecutionStatus === 'provider_succeeded'
    && s.ocrProvider === CERTIFIED_PROVIDER
    && s.ocrModel === CERTIFIED_MODEL
  );
}

/** Whether a non-certified Identity outcome is a definitive PROVIDER block. */
export function identityProviderBlocked(s = {}) {
  if (s.classificationProvider === 'unavailable') return true;
  if (classifierReasonIndicatesProviderError(s.reasons)) return true;
  if (isProviderBlockStatus(s.ocrExecutionStatus)) return true;
  if (isProviderBlockText(s.failureReason, s.ocrError)) return true;
  return false;
}

/**
 * Identity disposition: 'certified' | 'blocked_provider' | 'failed'.
 * A genuine model verdict (unreadable / non_document / unsupported / uncertain) from the
 * governed provider with no provider-error reason is a product failure, never a provider outage.
 */
export function identityDisposition(s = {}) {
  if (identityCertifiable(s)) return 'certified';
  if (identityProviderBlocked(s)) return 'blocked_provider';
  return 'failed';
}

/**
 * Positive, exact Diaspora certification proof — BOTH persisted levels:
 *   HTTP 201, document == OCR_EXTRACTED, extraction_provider == cloudflare,
 *   raw_response.provider == cloudflare, raw_response.model == @cf/qwen/qwen3.8-27b,
 *   raw_response.executionStatus == provider_succeeded, raw_response.success == true,
 *   verification rows == 0. A null model is a failure.
 */
export function diasporaCertifiable(s = {}) {
  return (
    s.runStatus === 201
    && s.documentStatus === 'OCR_EXTRACTED'
    && s.extractionProvider === CERTIFIED_PROVIDER
    && s.rawProvider === CERTIFIED_PROVIDER
    && s.rawModel === CERTIFIED_MODEL
    && s.rawExecutionStatus === 'provider_succeeded'
    && s.rawSuccess === true
    && s.verificationCount === 0
    // Fail-closed presence: the real owning import order and the SafeTrade ledger must exist, so a
    // "0 before / 0 after" is meaningful evidence rather than an absent-table false negative.
    && s.realImportOrderPresent === true
    && s.safeTradeLedgerPresent === true
    // Independent T13 negative: OCR created/advanced no SafeTrade payment/release authority.
    && s.safeTradeAuthorityUnchanged === true
    // Independent import-order negative: OCR extraction did not transition the owning order.
    && s.importOrderAuthorityUnchanged === true
  );
}

/** Whether a non-certified Diaspora genuine run is a definitive PROVIDER block. */
export function diasporaProviderBlocked(s = {}) {
  return isProviderBlockStatus(s.rawExecutionStatus) || isProviderBlockText(s.error, s.rawError);
}

/**
 * Positive, exact Vehicle certification proof:
 *   success == true, provider == cloudflare, model == @cf/qwen/qwen3.8-27b,
 *   execution_status == provider_succeeded, candidates > 0, pending candidates > 0,
 *   authority effects all false, evidence stays pending, authority snapshot unchanged.
 * A null model is a failure.
 */
export function vehicleCertifiable(s = {}) {
  return (
    s.success === true
    && s.provider === CERTIFIED_PROVIDER
    && s.model === CERTIFIED_MODEL
    && s.executionStatus === 'provider_succeeded'
    && Number(s.candidatesPersisted) > 0
    && Number(s.pendingReviewCount) > 0
    && s.authorityEffectsAllFalse === true
    && s.evidenceStatusAfter === 'pending'
    && s.authorityUnchanged === true
    // Fail-closed presence: the canonical Seller Authority ledger must exist (absence is
    // "evidence unavailable", not "authority preserved").
    && s.sellerAuthorityLedgerPresent === true
    // Independent canonical Seller Authority ledger negative: OCR neither created nor changed a
    // vehicle_seller_authority decision (self-reported authority_effects is not sufficient alone).
    && s.sellerAuthorityUnchanged === true
  );
}

/** Whether a non-certified Vehicle run is a definitive PROVIDER block. */
export function vehicleProviderBlocked(s = {}) {
  return isProviderBlockStatus(s.executionStatus) || isProviderBlockText(s.error);
}

/**
 * Provider readiness — POSITIVE and EXACT, computed from the deployed `/api/health` payload
 * (`{ ocr: {selectedProvider, selectedModel, configured, mockRuntimeAllowed}, ocrProviders: {...} }`).
 * The Stage-4 driver calls this BEFORE any fixture creation, storage upload or provider call, so a
 * dispatch during a configuration hold fails before side effects. Pure; no network, no secrets.
 */
export function stage4ProviderReadiness(health = {}) {
  const ocr = health.ocr || {};
  const providers = health.ocrProviders || {};
  const selected_provider = ocr.selectedProvider ?? null;
  const selected_model = ocr.selectedModel ?? null;
  const cloudflare_configured = ocr.configured === true;
  const cloudflare_provider_present = providers.cloudflare === true;
  const gemini_present = providers.gemini === true;
  const mock_runtime_allowed = ocr.mockRuntimeAllowed === true;
  const ready = selected_provider === CERTIFIED_PROVIDER
    && selected_model === CERTIFIED_MODEL
    && cloudflare_configured === true
    && mock_runtime_allowed === false
    && cloudflare_provider_present === true;
  return {
    selected_provider, selected_model, cloudflare_configured, cloudflare_provider_present,
    gemini_present, mock_runtime_allowed, ready,
  };
}

/**
 * Global disposition — strict 3/3. A provider block takes precedence over a product-journey
 * failure so the hold is reported honestly; only all-three-certified yields CERTIFIED.
 */
export function overallDisposition({ identityCertified, diasporaCertified, vehicleCertified, providerBlocked } = {}) {
  if (identityCertified && diasporaCertified && vehicleCertified) return 'CERTIFIED';
  if (providerBlocked) return 'BLOCKED_PROVIDER';
  return 'FAILED_PRODUCT_JOURNEY';
}
