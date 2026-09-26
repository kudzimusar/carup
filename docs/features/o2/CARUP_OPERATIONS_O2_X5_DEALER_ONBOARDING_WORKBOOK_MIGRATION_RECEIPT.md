# O2-X5 — Dealer Onboarding + Governed Workbook Migration: Certification Receipt

- **Branch:** `feat/operations-o2-people-compliance`
- **Starting head:** `b5c2d488` (X4 receipt) · **Date:** 2026-09-03
- **Scope executed:** X5 ONLY. X6/X7 not started; **P7 remains BLOCKED / NOT EXECUTED**;
  P1/P1-C, X1, X2, X3 and X4 untouched and re-proven green; **no live biometric provider was
  activated** (the X4 gates stand exactly as written).

## The laws this phase enforced

- Identity verified ≠ Dealer compliant ≠ Seller authorised ≠ Vehicle registered ≠ Vehicle
  trusted — nothing in X5 collapses any pair.
- Dealer ONBOARDING access ≠ Dealer AUTHORITY: an applicant works on their OWN application and
  gains nothing else.
- Applicant claim ≠ machine extraction ≠ Dealer Compliance decision — three separate records,
  three separate writers.
- Bulk data enters as claims/evidence via the EXISTING import engine, never as decisions and
  never through a second importer.

## 1. The bounded access policy (§3)

`assertDealerOnboardingContext` (in `backend/services/dealer/dealerOnboardingService.js`)
derives eligibility from SERVER truth: the authenticated user's `user_registration_profiles`
row must say `account_kind='business'` AND `business_type='dealer'` (the X2 registration
journey's routing context). Anything else — buyer, individual, no profile, forged headers —
fails closed with `DEALER_ONBOARDING_CONTEXT_REQUIRED` (403). The middleware wraps EVERY
`/api/dealer-onboarding/*` route after `authorizeRole()`.

What that context grants: the caller's OWN application (profile create/edit, own evidence
upload/preview, own OCR runs, own branches, own workbook migration lane). What it refuses,
pinned by test: any other dealer's records, any tenant administration, any Dealer Compliance
outcome, any reviewer action, the Dealer workspace. **No `dealer` role is granted or
simulated; the role matrix and DealerDashboard (`<DashboardLayout role="dealer">`) are
byte-untouched.**

## 2. Tenant behaviour — the §4 forgery closure

`PROFILE_FIELDS` in `dealerComplianceService.js` no longer contains `tenant_id`: a client
payload can never assign tenant membership. Permanent pins: the o2-x5 suite proves a
`tenant_id` in the create/update payload does not land; `dealer-compliance.test.js`'s
tenant-scoping test now seeds tenant membership directly on the rows (a server-side fact) and
additionally asserts the payload refusal. Admin listing tenant-scoping itself is unchanged and
still proven (`listProfiles({tenantId})`). Cross-dealer and cross-tenant reads fail closed
(§23): every service function resolves the dealer through the CALLER's user id, never a
client-supplied dealer id.

## 3. Evidence upload — private by construction (§7)

- Bucket: the private `ocr-documents` bucket under prefix `dealer-compliance/<dealerId>/`;
  uploads via `dealerEvidenceStorage` (injectable seam, real Supabase storage default).
- API responses NEVER carry storage paths: `sanitizeDealerDocument` strips `file_ref` to a
  `has_file` boolean — pinned by a leak test over every route payload.
- Applicant preview: short-lived signed URL, own-dealer only
  (`GET /api/dealer-onboarding/documents/:docId/preview`).
- Reviewer raw preview: `GET /api/admin/dealers/:id/documents/:docId/preview` behind
  `authorizeRole(ADMIN_ROLES, {allowUserIdFallback:false})` **+ X3 step-up**
  (`requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE)`) — §24 satisfied by reusing the
  X3 guard, not by a new mechanism — and every access is audited. A sanitized listing
  (`GET /api/admin/dealers/:id/documents`) carries candidates and statuses, no paths.
- Document types (§8): `company_registration`, `tax_document`, `business_licence`,
  `address_evidence`, `banking_evidence`, `other` — served to the UI from the backend list.

## 4. OCR behaviour — claim ≠ extraction ≠ decision (§8–§10)

`POST /api/dealer-onboarding/documents/:docId/ocr` runs extraction (docType `dealer_<type>`,
attributed to the REAL user id — the X1/X2 attribution law) and maps output through the X2
truth model: `sanitizeCandidateValue` refuses fallback markers (`N/A`, `Unknown`, `-`, …), and
candidates land on the document row (`extraction_candidates` JSONB with field states +
`extraction_provider`/`extraction_confidence`/`extracted_at`) as CANDIDATES for
`legal_name`, `trading_name`, `registration_number`, `tax_id`, `physical_address`,
`operating_country`. The applicant explicitly uses/corrects them; the profile write derives
`user_confirmed`/`user_corrected`/`user_provided` provenance server-side from
`candidates_seen` and audits it. Nothing in the OCR path touches compliance statuses; the
eight Dealer Compliance dimensions and `recordDecision` (the sole decision writer) are
unchanged, and `deriveCanPublish` stays pure. The o2-x5 suite pins that no X5 code path can
produce a VERIFIED/APPROVED outcome (`classifyWorkbookImportRow` refusals included).

## 5. Workbook migration — a mapping front-end to the EXISTING engine (§13–§22)

```
arbitrary dealer spreadsheet
  → POST /workbook/inspect        headers + row count read (upload security reused:
                                  sha256Checksum, assertAllowedSpreadsheet, size limits)
  → deterministic alias pass      reg_no/registration→VIN, chassis→CHASSIS_NUMBER,
                                  cust_tel→RECEIVER_PHONE, … only when the target exists
                                  on the selected sheet
  → AI semantic proposals         HEADERS ONLY leave the system (pinned by a spy);
                                  allowlist-validated against getXlsxTemplate canonical
                                  columns; AI failure → unmapped, never guessed
  → POST /workbook/mapping/confirm  a HUMAN confirms the exact mapping; recorded in
                                  dealer_workbook_mapping_confirmations bound to the
                                  workbook's sha256 checksum (mapping_version
                                  dealer_workbook_mapping.v1); duplicate targets refused;
                                  targets ⊆ canonical ∪ 'ignore'
  → POST /workbook/dry-run        requireLiveMappingConfirmation (a changed file = new
                                  checksum = MAPPING_CONFIRMATION_REQUIRED) →
                                  applyConfirmedMapping → the EXISTING
                                  runAndPersistDiasporaWorkbookDryRun — the truth gate
```

**§14 byte-stability:** the diaspora planning / review / confirmation / execution / audit
services are unmodified — a source-pin test asserts the mapping service imports none of the
execution/persistence modules, and the existing diaspora suites re-ran green. There is no
second importer, no direct-import bypass (the sync service still refuses direct import), and
the dry run persists through the same audited path with `sourceFilename`/`sourceChecksum`
provenance. VERIFIED/APPROVED import refusals hold (§16).

## 6. The applicant surface (§11–§12)

`web/src/pages/dealer/DealerOnboarding.tsx` at `/dealer/onboarding` (route added in
`App.tsx`; entry button appears on `/onboarding` when the ladder stage
`contact_context_established` is reached and unlocks `prepare_dealer_onboarding`): business
identity form with explicit candidate use-buttons; responsible-person identity from the X3
lifecycle (read-only, applicant-safe); every compliance requirement rendered independently;
private evidence with upload + preview; branches; the eight compliance dimensions verbatim
with `can_publish` from the server; `who_must_act` from the P2 projection; the workbook lane
(file → inspect → editable mapping table → confirm → dry-run, dry-run disabled until
confirmed, results labelled "Nothing has been imported yet"). The workspace badge states
plainly: **"Applicant — not an active Dealer"**; `workspace_access.available=false` with
`dependency='governed_dealer_role_or_tenant_relationship'` (§12 — the DealerDashboard is
never falsely unlocked).

## 7. Refusals (adversarial, all pinned)

| Attempt | Refusal |
|---|---|
| Buyer/individual/no-profile calls any `/api/dealer-onboarding/*` route | 403 `DEALER_ONBOARDING_CONTEXT_REQUIRED` |
| `tenant_id` in profile payload | dropped at the write boundary (§4 pins) |
| Reading/previewing another dealer's document | fails closed (caller-scoped resolution) |
| Storage path in any response | `has_file` only (leak test) |
| Fallback marker as profile/candidate content | refused (`FALLBACK_MARKERS`) |
| Row data / sample values to the AI mapper | headers only (spy pin) |
| AI proposing a non-canonical column | allowlist-validated → unmapped |
| Mapping confirmation for a different file | checksum mismatch → `MAPPING_CONFIRMATION_REQUIRED` |
| Dry-run without a confirmed mapping | refused (same error, by construction) |
| Duplicate mapping targets | `ValidationError` |
| Workbook row importing VERIFIED/APPROVED compliance | refused by the existing classifier (re-pinned) |
| X5 code producing a Dealer Compliance decision | impossible — `recordDecision` untouched, no X5 call site |
| Reviewer raw preview without step-up | 403 from `requireAuthenticationAssurance` (X3) |

## 8. Migrations and files

**Migration (additive only, `-- +migrate Up` marker present, executed on real PostgreSQL in
tests):** `database/migrations/20260903220000_dealer_onboarding_extensions.sql` —
`dealer_compliance_documents` + `extraction_candidates` JSONB / `extraction_provider` /
`extraction_confidence` / `extracted_at`; NEW `dealer_workbook_mapping_confirmations`
(id, monotonic `seq`, user_id, dealer_id FK, template_type, sheet_name, workbook_checksum,
mapping JSONB, mapping_version, created_at; RLS service_role). **No staging migration was
applied** (P7 discipline).

**New:** `backend/services/dealer/dealerOnboardingService.js` ·
`backend/services/dealer/workbookSemanticMappingService.js` ·
`backend/routes/dealerOnboardingRoutes.js` · `backend/tests/o2-x5-dealer-onboarding.test.js` ·
`backend/tests/o2-x5-workbook-mapping.test.js` · `web/src/pages/dealer/DealerOnboarding.tsx` ·
`web/src/pages/dealer/DealerOnboarding.test.tsx`

**Edited:** `backend/services/dealer/dealerComplianceService.js` (§4 tenant_id removal) ·
`backend/routes/dealerRoutes.js` (admin document listing + step-up preview) ·
`backend/server.js` (mount) · `web/src/hooks/useCarUpApi.ts` (8 functions) ·
`web/src/App.tsx` (route) · `web/src/pages/onboarding/RegistrationJourney.tsx` (entry button;
plus a load-effect hardening — the effect is keyed on `user.id`, not the user object, so a
context re-render can no longer re-run the initial fetch; the same idiom applied to the new
DealerOnboarding page) · `backend/tests/dealer-compliance.test.js` (tenant test seeds
server-side facts and pins the §4 refusal).

## 9. Test evidence (§29)

- New backend suites: `o2-x5-dealer-onboarding` **8/8** · `o2-x5-workbook-mapping` **8/8**
  (includes the migration executed on real PostgreSQL via PGlite).
- New web suite: `DealerOnboarding.test.tsx` **4/4**; `RegistrationJourney.test.tsx` re-run
  **11/11** (3× for stability after the effect hardening).
- Targeted regression batch (dealer ×3, X2 ×2, X3 ×2, diaspora workbook ×4, X1): **201/201**.
- Certified-lane batch (P1-C review, former-seller, responsibility projection, transfer
  supersession, adversarial, X3 journey, X4 consent + assessment): **64/64**.
- **Full backend suite: 5871 tests — 5850 pass / 0 fail / 21 skipped** (X4 baseline 5855 +
  exactly the 16 new X5 tests). An earlier run showed 54 failures — all manufactured by the
  invocation (wrong CWD broke source-pin paths; `CARUP_ALLOW_X_USER_ID_FALLBACK` exported to
  the whole suite defeats the d0 identity-refusal guard) during a load-average-107 spike;
  named, re-proven green file-by-file, then the full corrected run above.
- **Full web suite: 1578/1578** (X4 baseline 1574 + exactly the 4 new); `tsc --noEmit` clean;
  lint gate **NET_NEW 0/0**.

## 10. The unresolved dependency (§12, recorded, deliberately NOT invented)

**How an APPROVED applicant becomes an ACTIVE Dealer is not implemented anywhere today**: no
governed path grants the `dealer` role or creates the tenant relationship that
DealerDashboard's role gate requires. X5 records this as
`workspace_access.dependency='governed_dealer_role_or_tenant_relationship'` and shows the
honest applicant badge instead of fabricating an unlock. Closing it needs a governed
role-grant/tenant-provisioning decision (a future phase with PO approval) — the same
discipline as X3's deferred strong authenticator.

## 11. Confirmations

- X1, X2, X3, X4 and P1-C lanes re-proven green at this head (batches above + full suite).
- **LIVE BIOMETRIC PROVIDER: NOT ACTIVATED** — X5 added no provider configuration, no consent
  text changes, no biometric code.
- **P7 NOT EXECUTED** — no staging pairing entries, no staging migrations, no staging
  fixtures, no deploys, no UAT runs.
- Do-not-merge stands: the branch stops at the certified candidate for Product Owner review.
