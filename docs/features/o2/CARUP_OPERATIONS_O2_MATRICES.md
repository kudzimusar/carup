# O2 — Authority, privacy, API/data delta and certification matrices

## 6. Identity / Seller / Dealer authority matrix

Who may decide what. Capabilities extend the M5 STATIC map (`platformRole`/`baseRole` only, proven
sessions only, no persistent grants — M8-DEFERRED stands).

| Decision | Owning service | Required capability (O2) | Underlying role gate today | Explicitly refused |
|---|---|---|---|---|
| Open People & Compliance view | — (read model) | `operations.person.read_private` | admin/government | tenant admin; any seller/dealer; x-user-id fallback |
| Identity session decision (approve/reject/resubmit/escalate/note) | identity service | `operations.identity.review` | admin/government (existing) | the applicant themself; tenant admin |
| Seller Authority decision | sellerAuthorityService | `operations.seller_authority.review` (exists, M5) | admin/government | the claiming seller (G5-equivalent) |
| Dealer compliance decision | dealerComplianceService | `operations.dealer_compliance.review` | government/admin (existing) | the dealer's own tenant admin — a tenant admin is NOT CarUp Operations |
| Ownership transfer completion | passport transfer service | none new — GOVERNANCE_ROLES as today, plus registry authority + completion reference | governance roles | ordinary admin without registry reference; either party alone |
| Evidence visibility/classification correction | evidenceClassificationCorrectionService | `operations.vehicle_evidence.classify` (exists, M5) | admin/government | uploader self-correction |

Separate concepts stay separate — one row each in the view, never a combined boolean:

| Concept | Source of truth | Public? |
|---|---|---|
| Email verified | auth/email lane | no (flag only, private view) |
| Identity verified | identity service | **status only, never artifacts**; public exposure = none in O2 |
| Seller Authority (per vehicle) | vehicle_seller_authority | public-safe statement only (existing `toPublicSellerAuthorityStatement`) |
| Vehicle ownership | vehicles.owner_id via governed transfer | not public as a person-fact |
| Dealer/business compliance | dealerComplianceService | domain's own public projection only |
| Zimbabwe registration | vehicle registration lifecycle | already governed (vehicle surface) |
| Vehicle Trust | canonicalTrustService | already governed (vehicle surface) |

## 8. Privacy matrix

| Data | Reviewer (capability-gated) | Subject (self) | Tenant admin | Public/buyer |
|---|---|---|---|---|
| Identity document images / selfie | via identity service preview only, audited | own session only | **never** | **never** |
| Identity decision + reason codes | yes | outcome + resubmission guidance (no internal notes) | never | never |
| Internal reviewer notes | yes | **never** | never | never |
| OCR extractions / binding detail | yes | limited (their own, as identity service already scopes) | never | never |
| Email address / phone | yes (private view) | own | existing tenant scoping only | never |
| Seller Authority state + basis + reason | yes | own state WITHOUT reviewer identity (as certified in M7) | no | public-safe statement only |
| Dealer compliance docs (e.g. licences) | yes | own dealer's | own dealer's (existing scoping) | never; only the domain's public projection |
| Ownership transfer parties | yes | own transfers (existing scoping in `getOwnershipTransfer`) | no | never |
| Audit actor identities | reviewer identities visible to operators only | no | no | never |

Rules carried from the certified slice: no `file_url`/bucket/path in any aggregate; no ip/user_agent
in displayed audit; reviewer free text never reaches a subject-facing payload; artifacts served only
through the owning service's scoped preview path.

## 9. API/data delta (complete list — anything not here is out of scope)

**Data (DDL):** **NONE.** O2 adds no tables and no columns. (P1's supersession uses existing
`vehicle_seller_authority` columns; P2's projection is derived; P3 is a read model.)

**Backend:**

| Delta | Kind | Phase |
|---|---|---|
| `sellerAuthorityService.supersedeSellerAuthorityOnOwnershipTransfer(...)` | new export, domain-internal | P1 |
| call from `transitionOwnershipTransfer` on completion | edit | P1 |
| `shared` responsibility vocabulary module (6 strings) + per-domain `toResponsibilityProjection` | new pure modules | P2 |
| `GET /api/admin/people/:userId/review` — People & Compliance aggregate (read-only) | new route + read model | P3 |
| capability additions to the STATIC map: `operations.person.read_private`, `operations.identity.review`, `operations.dealer_compliance.review` | edit `operationsAuthorizationService` | P3 |
| `emitDomainEvent('identity.verification.decided', …)` (and dealer equivalent if absent) | emit-only | P5 |

**Web:**

| Delta | Kind | Phase |
|---|---|---|
| `/admin/people/:userId/review` workspace page (person-centric; sections: identity, seller authority, dealer compliance, transfers; `who_must_act` chips; actions from server `allowed_actions` only) | new page | P3–P4 |
| feature registry entry + nav (admin group), same pattern as `admin.vehicle-operations` | edit | P3 |

**CI:** one new staging UAT spec + workflow for the O2 journeys (own dedicated staging identities
per the reconciliation lesson: `uat.reviewer.ops` reused; the O2 applicant/dealer identities are
spec-owned synthetics). | P7

## 10. Test / certification matrix (the O2 exit gate)

Real journeys, not unit tests alone; desktop + tablet + mobile on the exact-head pair; one SHA.

| # | Journey | Proof |
|---|---|---|
| 1 | Individual seller identity review — approve | session → REVIEWER_ACTION_REQUIRED → approve → RESOLVED_APPROVED; audit; subject sees outcome, not notes |
| 2 | Resubmission | reject-to-resubmit → `subject_action`; applicant resubmits → back to review |
| 3 | Rejection | governed rejection with reason codes; fail-closed audit |
| 4 | Approval reflected in seller-compliance view | identity row flips; email/identity/authority remain separate rows |
| 5 | Seller compliance view | one person: email ✓/identity ✓/authority per-vehicle/ownership — four distinct facts on screen |
| 6 | Dealer compliance | blocking requirement unmet → `subject_action`; document submitted → `carup_review`; decision → `active` |
| 7 | Restricted/suspended dealer | domain status displayed verbatim; remediation projected `subject_action`; no generic status replaces it |
| 8 | Ownership transfer end-to-end | begin → counterparty → governance completes with registry reference |
| 9 | **Former Seller Authority superseded** | previous owner's authority `revoked` with transfer-stamped reason; audit intact; no deletion |
| 10 | New owner/seller relationship | incoming owner has NO fabricated authority; listing path works through normal governed claim |
| 11 | Dispute / fail-closed | incomplete transfer supersedes nothing; disputed authority handled per design; refusals loud |
| 12 | Communications notification | decision events emitted; delivery owned by Communications |
| 13 | Private evidence withholding | identity artifacts unreachable publicly and by tenant admin; preview only via owning service |
| 14 | Audit history | every decision attributable; audit precedes effect |
| 15 | Desktop/mobile Operations UI | all three viewports; axe serious/critical = 0 |
| 16 | Authorization adversarial | unauthenticated / fallback / forged role / forged tenant / self-review all refused WITH valid CSRF |
| 17 | Regressions | Seller/Passport/Marketplace/Operations-Serena gates green at the same SHA; backend suite 0 fail vs base |

## 11. Expansion Authority Matrix (X0 — design; governs all expansion phases)

Added 2026-09-03 for the Identity/Onboarding Expansion
(`CARUP_OPERATIONS_O2_IDENTITY_ONBOARDING_EXPANSION_PLAN.md`). Sections 6–10 above are the core-O2
matrices, preserved unchanged. Binding rule for every row: **machine/user input proposes;
governed domain decisions decide; no AI output ever becomes an authoritative outcome directly.**

*X1 (2026-09-03) enforced this boundary for Document Intelligence: the legacy `/api/verification`
authority surface is retired and extraction writes only the ocr candidate tables — receipt:
`CARUP_OPERATIONS_O2_X1_DOCUMENT_INTELLIGENCE_AUTHORITY_RECEIPT.md`.*

*X2 (2026-09-03) implemented the first two rows end-to-end: candidates are presented with
explicit field states (`machine_candidate`/`missing` — markers are never data), the user decides
what enters `user_registration_profiles`, confirmed-vs-corrected provenance is derived
server-side and audited, and the Progressive Trust ladder is a derived, advisory, zero-write
projection — receipt: `CARUP_OPERATIONS_O2_X2_REGISTRATION_PROGRESSIVE_TRUST_RECEIPT.md`.*

*X5 (2026-09-03) implemented the dealer-onboarding and workbook rows below (marked X5 —
IMPLEMENTED): bounded applicant access derived from the X2 registration profile (no dealer role
granted), client `tenant_id` assignment removed at the write boundary, evidence private with
audited step-up reviewer preview, and workbook migration as a checksum-bound human-confirmed
mapping in front of the byte-unchanged diaspora engine — receipt:
`CARUP_OPERATIONS_O2_X5_DEALER_ONBOARDING_WORKBOOK_MIGRATION_RECEIPT.md`.*

*X3 (2026-09-03) added two governed facts with the same discipline — receipt:
`CARUP_OPERATIONS_O2_X3_IDENTITY_LIFECYCLE_ACCOUNT_SECURITY_RECEIPT.md`:*

| Fact | Source of truth | Who may propose | Who may decide | AI may influence? | Public? | Which service writes it |
|---|---|---|---|---|---|---|
| CURRENT identity lifecycle | `identity_lifecycle_events` (append-only; latest row, with historical-approval fallback and the derived expiry overlay) | reviewer transitions; the 7C approval; governed security/recovery policy | `operations.identity.lifecycle` holders on proven stepped-up sessions; `verified`/`recovered` ONLY via the governed 7C approval hook; never the subject | never | never (applicant sees only state/reason/guidance/actor) | `identityLifecycleService` |
| Session authentication assurance | `user_sessions` (`auth_method`, `step_up_at`, `step_up_method`) | the account holder, by re-proving the credential | the SERVER derives strength/freshness per action class (`authentication_assurance.v1`); nothing client-supplied is read | never | never | `authenticationAssuranceService.recordStepUp` (the only writer) |

| Fact | Source of truth | Who may propose | Who may decide | AI may influence? | Public? | Which service writes it |
|---|---|---|---|---|---|---|
| OCR extracted value | extraction output + provenance (identity lane: `verification_ocr_provenance`) | the extraction system (machine) | nobody — it is candidate evidence, never a decision | yes — it IS machine output, always marked candidate | never | identity service (provenance); the extraction utility produces it |
| User-confirmed profile value | `user_registration_profiles` | OCR candidate or the user | the user (self-asserted; earns nothing authoritative) | propose only | no | `registrationProfileService` |
| Identity decision | `verification_decisions` | reviewer via governed actions | capability-holding reviewer (`operations.identity.review`); self-review refused | never decides; may annotate assessments as evidence | never | identity service (`decisionRecorder`) |
| Biometric assessment (X4 — IMPLEMENTED; provider not activated) | `verification_assessments` (append-only; face/liveness statuses + scores, `provider_reference`/`provider_state`, `biometric_threshold.v1`, `consent_id`) | biometric provider only (as evidence; client scores are inert; consent gates every call) | reviewer via the unchanged 7C decision policy — mismatch/failed-liveness BLOCK approval, nothing biometric grants it; manual fallback always exists | provider input is evidence only | never | identity service (`biometricAssessmentService`) |
| Biometric consent (X4 — IMPLEMENTED) | `identity_biometric_consents` (append-only ledger; grant/withdraw events, purposes, `biometric_consent.v1` + text version) | the subject, affirmatively (`consent: true`; Terms/uploads are never consent) | the subject grants/withdraws their OWN consent only; withdrawal stops new processing and erases nothing | never | never | identity service (`biometricConsentService`) |
| Dealer Compliance decision | compliance decision ledger + profile | dealer submits documents; OCR may fill candidate fields | `operations.dealer_compliance.review` (never the dealer's own tenant admin) | candidates only — never `active`/passed/unrestricted/unsuspended/publishable | domain's own public projection only | `dealerComplianceService` (`recordDecision`) |
| Dealer onboarding evidence + candidates (X5 — IMPLEMENTED) | `dealer_compliance_documents` (private file_ref never exposed; `extraction_candidates` JSONB with X2 field states + provider/confidence) | the applicant uploads; OCR proposes candidates (fallback markers refused) | the applicant confirms/corrects what enters their OWN profile (`candidates_seen` provenance, audited); `tenant_id` is NOT client-assignable (removed from `PROFILE_FIELDS`) | candidates only | never — signed preview self-only; reviewer raw preview = admin role + X3 step-up, audited | `dealerOnboardingService` |
| Seller Authority | `vehicle_seller_authority` | seller claim + evidence | `operations.seller_authority.review`; self-review refused; completed transfer supersedes | never | public-safe statement only | `sellerAuthorityService` |
| Vehicle Registration | registration lifecycle records (vehicle domain) | evidence upload | governed vehicle-domain review / external registry authority | extraction candidates only | vehicle-surface presentation only | registration lifecycle (vehicle domain) — O2 reads only |
| Vehicle Trust | canonical trust records | nobody in O2 | `canonicalTrustService` computation only | never | governed vehicle surface | `canonicalTrustService` ONLY (one-writer invariant) |
| Workbook mapping / import (X5 — IMPLEMENTED) | `dealer_workbook_mapping_confirmations` (mapping bound to the workbook's sha256 checksum, `dealer_workbook_mapping.v1`) + the UNCHANGED diaspora planning/review/confirmation pipeline | deterministic aliases first, then AI semantic mapping over HEADERS ONLY (allowlist-validated; failure → unmapped, never guessed) | a human confirms the exact mapping per checksum (a changed file voids it); dry run via the EXISTING `runAndPersistDiasporaWorkbookDryRun`; imports refuse VERIFIED/APPROVED compliance outcomes | mapping suggestions only — advisory | no | `workbookSemanticMappingService` (mapping record); the existing diaspora services (import truth) |
