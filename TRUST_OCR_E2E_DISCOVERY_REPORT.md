# Trust Infrastructure & OCR E2E Discovery Report
**Directive: TRUST/OCR E2E DISCOVERY**

This report details the architectural discovery of the trust and OCR verification loops in the CarUp OS platform, mapping 10 critical trust-centric flows across the frontend layout, backend database layers, cryptographic services, and automated background triggers.

---

## 1. Trace of the 10 Critical-Path Flows

We successfully traced the functional and programmatic mechanisms of the 10 core trust verification loops within the codebase:

### 1. OCR Upload Flow
- **Frontend Entry**: Located in `web/src/pages/dashboard/owner/OwnerDashboard.tsx` inside the **Digital Document Vault** card. Triggered by a button with text `"Upload & Parse Logbook"`.
- **API Boundary**: Invokes `runOcrParsing(docType, base64Data)` from `useCarUpApi.ts`, making a `POST` request to `/api/verification/ocr`.
- **Backend Flow**: In `documentIntelligenceService.js`, the service:
  1. Fires a `DOCUMENT_OCR_STARTED` event hook.
  2. Analyzes quality metrics (blur, glare, tampering).
  3. Dispatches prompts to `askGemini()` to parse fields.
  4. Records the master OCR record in `ocr_documents` (status: `Pending_Verification`).
  5. Inserts details into structured tables: `ocr_national_ids`, `ocr_registration_books`, or `ocr_customs_declarations`.

### 2. OCR Failure Flow
- **Backend Handler**: Managed by the `catch` block in `extractDocumentData()`.
- **Logic**: If Gemini throws an error due to missing API keys or unreadable files, the system:
  1. Automatically determines failure severity (e.g. status: `OCR_Provider_Unavailable`).
  2. Emits a `DOCUMENT_FLAGGED_FOR_REVIEW` event hook.
  3. Saves the failure details to `ocr_documents` with error notes.
  4. Returns `success: false` and error reason `AI_OCR_EXTRACTION_FAILED` (unless `ALLOW_OCR_MOCK === 'true'`).

### 3. Low-Confidence OCR Flow
- **Backend Threshold**: If the extracted JSON `confidenceScore` is below **0.80**, the backend:
  1. Sets the document status to `Low_Confidence` (unless `Suspected_Tampering` is detected).
  2. Appends `low_confidence` to `qualityIssues`.
  3. Emits `DOCUMENT_OCR_LOW_CONFIDENCE` and `DOCUMENT_FLAGGED_FOR_REVIEW` internal event hooks.

### 4. Pending Manual Review Flow
- **State Transition**: Occurs when document quality fails (`qualityPassed` is false), OCR confidence is below 0.80, or a Gemini call error is caught.
- **Statuses Applied**: `Low_Confidence`, `Poor_Image_Quality`, `Suspected_Tampering`, or `Pending_Manual_Review`. These records persist in the database, waiting for an administrator.

### 5. Admin Approval Flow
- **Route**: `POST /api/verification/ocr/:id/approve`
- **Backend Handler**: `approveDocumentVerification` takes `actorId` and `vin`. It runs a strict chain:
  - Asserts that OCR confidence score is >= 0.80 and image quality passed.
  - Verifies metadata alignment using `verifyDocumentDataMatch`.
  - Writes verified data to CVR and ZIMRA registries.
  - Appends an administrative override record with a secure `sha512` cryptographic seal.
  - Sets the document status to `Verified`.
  - Recalculates vehicle trust score (`+20`) and restores listing status to `Available`.
  - Emits a `DOCUMENT_VERIFICATION_APPROVED` event hook.

### 6. Trust Recalculation Flow
- **Dynamic Bumps**: Bumps occur after manual review approval (`+20.0` points) or via timeline recalculations in `trustGraphService.js` (odometer integrity, custom clearance status).
- **Dynamic Penalties**: Triggered by metadata mismatches inside `verifyDocumentDataMatch()`:
  - VIN Mismatch: **-50 points** (logged to `security_events` as `CRITICAL`).
  - Owner Name Mismatch: **-30 points** (logged as `HIGH`).
- **History Logging**: All mutations write previous/new scores and event tags into the `trust_score_history` table.

### 7. Vehicle Quarantine Flow
- **Automatic Enforcement**: In `trustEnforcementEngine.js`, `enforceMarketplaceQuarantine(vin)` automatically runs after any score degradation.
- **Quarantine Threshold**: If the trust score falls below **60.0** and the status is `'Available'`, the system:
  1. Updates vehicle status to `'Suspended'`.
  2. Appends a high-severity log to `security_events` (event: `AUTOMATIC_MARKETPLACE_QUARANTINE`).
  3. Emits a `VEHICLE_QUARANTINED` event hook.

### 8. Marketplace Suppression Flow
- **Listing Status**: Set to `'Suspended'`.
- **Marketplace Bounds**: The frontend `Marketplace.tsx` fetches active inventory, which strictly filters out suspended, quarantined, or banned listings from the public inventory grid.

### 9. Government Registry Write Flow
- **Direct Ledger Writes**: Triggered inside `approveDocumentVerification` upon verification success:
  - For logbooks: Writes a verified owner and logbook serial to `cvr_ownership_records`.
  - For declarations: Writes port of entry, duty payment, and signatures to `zimra_declarations`.

### 10. Automation Event Hook Emission Flow
- **Webhook Gateway**: Powered by `automationWebhookService.js`. If `AUTOMATION_WEBHOOK_URL` is set, it posts events to external platforms.
- **Event Catalog**:
  - `DOCUMENT_OCR_STARTED`, `DOCUMENT_OCR_EXTRACTED`, `DOCUMENT_OCR_LOW_CONFIDENCE`, `DOCUMENT_FLAGGED_FOR_REVIEW`
  - `DOCUMENT_VERIFICATION_APPROVED`, `DOCUMENT_VERIFICATION_REJECTED`
  - `VEHICLE_QUARANTINED`

---

## 2. Codebase Audits & Existing Implementations

### Existing Routes (API Gateway)
- `POST /api/verification/ocr` (OCR upload & Gemini analysis)
- `POST /api/verification/ocr/:id/approve` (Admin verification override)
- `GET /api/verification/trust-score/:userId` (Dynamic trust score)
- `POST /api/verification/promote-trust` (Manual stakeholder level bumps)
- `GET /api/compliance/registry` (Government registry listing)
- `POST /api/compliance/registry/:id/update` (Government registry verification update)

### Existing UI Screens & Locators
1. **Owner Dashboard Vault** (`OwnerDashboard.tsx`):
   - Button text: `"Upload & Parse Logbook"` (Simulated OCR upload trigger)
   - Documents grid: Lists document titles, verification badges (`AI Verified`)
2. **Compliance Registry Verification** (`RegistryVerification.tsx`):
   - Search: `data-testid="registry-search-input"`
   - Table: `data-testid="registry-table"`
   - Rows: `data-testid="registry-row-${id}"`
   - Eye icon: `data-testid="open-registry-verification-button"` (opens details dialog)
   - Dialog: `data-testid="registry-verification-dialog"`
   - Dialog reject button: `data-testid="reject-registration-button"`
   - Dialog approve button: `data-testid="approve-registration-button"`
3. **Marketplace Moderation Dashboard** (`MarketplaceModeration.tsx`):
   - Metrics cards detailing banned and approved counts.
   - Moderator lists displaying current listings and status badges.

### Existing Backend Unit Tests
Located in `backend/tests/run-tests.js`:
- **Test 25**: Dynamic Trust Engine, Risk Propagation & Quarantine (anomaly penalties, dealer reputation drop, and dynamic quarantine).
- **Test 26**: Strict OCR Mock Enforcement & API Key Checks (verifies OCR unavailable fallback).
- **Test 27**: Direct Government Table & Trust Bumps Blocked (ensures no score bump occurs without administrative approval).
- **Test 28**: Administrative Approval Validation Chain (fully triggers the registry write, cryptographic override seals, and dynamic trust recalculation).
- **Test 29**: Automation Event Hooks Validation (validates webhook failure isolation).

---

## 3. Discovered Gaps & Test Recommendations

### Missing UI Selectors (Frontend Gaps)
- **Logbook Upload Selector**: The upload button in `OwnerDashboard.tsx` lacks a `data-testid` hook. Locating it relies on generic button text `"Upload & Parse Logbook"`.
- **Vault Items**: There are no item-specific `data-testid` attributes inside the Document Vault listing, which prevents Playwright from asserting that a specific PDF file card was uploaded.
- **Admin Moderation Actions**: Buttons for approving/rejecting a listing in `MarketplaceModeration.tsx` lack `data-testid` anchors.

### Missing Backend State Transitions
- **Rejection Penalty Asymmetry**: A manual review rejection (`DOCUMENT_VERIFICATION_REJECTED`) does not degrade the vehicle's trust score or enforce an automatic quarantine. Only data mismatch anomalies during check sequences trigger active penalties.
- **No Self-Serve Dispute**: A private owner cannot dispute a quarantine or trigger a manual review request directly from the vehicle detail view; they must wait for admin override.

### Flows Testable Now in Playwright E2E
- **Government Registry Verification Flow**: Standard ZIMRA officers can query pending verifications, inspect the verification dialog, and trigger approvals/rejections using standard test id selectors.
- **Owner Dashboard Mock Upload**: The mock OCR parser triggers upon button click, loading cards in the Document Vault for asserting success.
- **Marketplace Listing Suppression**: Suspended listings can be verified to ensure they do not appear in the Marketplace public grid.

### Flows Best Tested via Backend Tests (Instead of Playwright)
- **Cryptographic Hash Checks**: Verifying the `sha512` seal format for administrative overrides or `sha256` blockchain audit ledgers requires DB read queries that are unsuited for browser tests.
- **Gemini Parser Failures**: Simulating real LLM API variance, rate limits, or low-confidence parsing outputs is mock-heavy and best executed via integration tests (`run-tests.js`).
- **Risk Propagation**: Stakeholder reputation downgrades propagating to vehicle child rows are async background database processes that should remain in backend integration suites.

### Recommended Playwright Spec File to Add
We recommend creating **`tests/agents/16-trust-ocr.spec.ts`**:
1. **Flow 1: Owner Document Vault Ingestion**: Navigates to `/dashboard`, logs in as `owner`, clicks `"Upload & Parse Logbook"`, and asserts that the vault card is generated with `"AI Verified"` badge.
2. **Flow 2: Government Registry Inspection & Approval**: Logs in as ZIMRA `government` user, navigates to `/compliance/registry`, searches for a VIN, clicks to view verification lineage details, and approves it to write records and lift quarantine.
3. **Flow 3: Dynamic Marketplace Suppression**: Verifies that a listing with a degraded trust score (< 60.0) is dynamically suppressed from the `/marketplace` search page.
