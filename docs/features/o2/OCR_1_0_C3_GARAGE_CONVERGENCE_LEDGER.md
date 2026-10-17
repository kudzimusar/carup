# OCR 1.0-C3 — Garage evidence consumer: convergence ledger

**Lane:** `feat/ocr10-c3-garage-evidence-consumer-convergence`, built on the accepted C2 SHA `5b49809ca3e56822b6007c7e04d135fd0a410281`.
**Source lane inspected:** PR #209, `feat/garage-mechanic-onboarding-1-0` at `ce45e16f1b52b4eb59cb49e5955cc4830db0cf97`, unchanged from the planning anchor.
**Governing law:** *Document Intelligence observes. Domain authorities decide.*

This ledger records how every #209 Garage component was reconciled. The next agent should read it rather than rediscovering the reconciliation. It does not accept C3; that decision belongs to the moderator.

## 1. Final flow

```
Garage applicant (platform owner whose registration records a garage business)
  → /dashboard/garage-setup                     registry entry owner.garage-setup
  → POST /api/garage-onboarding/application/:id/evidence
      private bucket ocr-documents, server-composed path garage-onboarding/<own application>/<type>-<uuid>.<ext>
      workshop/signage/other photos start `unavailable` (nothing to read)
  → POST …/evidence/:docId/extract              optional, applicant-initiated
      readiness = GARAGE_OCR_ENABLED AND the canonical provider is ready
      (Garage holds no provider or model constant of its own)
  → canonical DocumentIntelligenceService.extractDocumentData('business_document', bytes, userId,
      { visionProvider: the same provider object that answered "ready" })
  → canonical OCR provider boundary → Cloudflare Workers AI → @cf/qwen/qwen3.8-27b (the boundary's default)
  → machine candidates (trading_name, address_line, location_city) or `missing`
      accepted only from executionStatus 'provider_succeeded' with the provider and model the boundary declared
      confidence = the provider's reported number, or NULL when it reported none (never 0 / 0.5 / 0.9)
  → applicant presses "Use this" per value → the ordinary autosave (PATCH application)
  → POST …/acknowledge → extraction_state `confirmed` (it means "the applicant reviewed it", not "CarUp verified")
  → submit → review by the Garage domain authority (outside C3) → activation (outside C3)
```

OCR writes only `garage_application_documents` (state, candidates, provenance, note) and `trust_audit_events`. It never writes `garage_applications`, decisions, tenants, memberships, Seller Authority, vehicles or Trust.

## 2. Convergence ledger

| #209 component | Disposition | Reason | Destination on C3 |
|---|---|---|---|
| `garageEvidenceService` | **REIMPLEMENT** | #209's version calls #209's Document Intelligence. C3's version consumes C2's Document Intelligence and provider boundary. The remediation round fixed: confidence substitution (null → 0), provenance invented on failure, stale candidates surviving a failed re-run (CHECK violation → 500), a Garage-local Qwen pin, visual evidence offered for reading, and missing availability reporting. | `backend/services/garageOnboarding/garageEvidenceService.js` |
| `garageApplicationService` | **PORT (bounded)** | Applicant start/update/submit/get only. The autosave whitelist (`normaliseInput`) excludes status, decision, activation and ownership fields; tests now prove this. | `backend/services/garageOnboarding/garageApplicationService.js` |
| `garageOnboardingRoutes` | **PORT (applicant routes only)** | No reviewer, activation, invitation or membership route is mounted. `authorizeSessionRole` plus the registration-context guard. | `backend/routes/garageOnboardingRoutes.js` |
| Garage evidence migrations (`20260906090000`, `20260906120000`) | **REIMPLEMENT + RECONCILE** | Same tables, `IF NOT EXISTS`, plus `extraction_model`. Where #209's lineage ran first (staging, per GMO-8), C3's create is a silent no-op, so the reconciliation migration adds the column on both lineages. Historical files are not rewritten. | `20260918090000`, `20260918100000`, `20261003100000_…lineage_reconciliation.sql` |
| Garage RLS (`20260906200000`) | **REIMPLEMENT** for the three C3 tables; **DEFER** `garage_invitations` and `activate_garage_application` | RLS is enabled and forced, and PUBLIC/anon/authenticated are revoked. The reconciliation re-asserts the posture on either lineage. Invitations and activation belong to #209. | `20260918110000`, `20261003100000` |
| `gmo-2-garage-evidence.test.js` | **REIMPLEMENT** | Rewritten against C2 semantics. | `o2-ocr-c3-garage-consumer.test.js` (16), `o2-ocr-c3-garage-security.test.js` (20) |
| `gmo-qwen-ocr-convergence.test.js` | **ALREADY PRESENT** | Provider/Qwen convergence is C2's (`o2-cloudflare-ocr-provider`, `o2-ocr-c2-identity-provider-convergence`). C3 adds one network-stubbed end-to-end test (real DI → real boundary → Qwen request). | `o2-ocr-c3-garage-security.test.js` › END TO END |
| #209 `DocumentIntelligenceService` | **REJECT — WOULD REGRESS ACCEPTED OCR** | Confidence default 0.9, md5-derived image quality, the identity prompt for business documents, placeholder rows. | C2's version is unchanged (blob `680c024d`). |
| #209 `ocrVisionProvider` / `CloudflareVisionClient` | **ALREADY PRESENT** | Byte-identical across #209, P214, C1, C2 and C3. | unchanged |
| Garage UI evidence surfaces (`GarageEvidence`, `GarageSetup`, `lib/garageOnboarding`) | **REIMPLEMENT (manual-first)** | Remediation: the registry entry (the page was unreachable: every visitor was sent to `/login`), the refetch loop (inline parent callback), auto-read offered only where it can work, an availability statement, and the React-Compiler lint error. | `web/src/pages/dashboard/garage/*`, `web/src/lib/garageOnboarding.ts`, `web/src/config/featureRegistry.ts` |
| Garage review (`garageReviewService`, reviewer routes) | **NOT REQUIRED FOR C3** | The domain authority stays separate. | stays in #209 |
| Garage activation (`garage_business_activation`, `activate_garage_application`) | **NOT REQUIRED FOR C3** | Tenant and membership creation is outside OCR. | stays in #209 |
| Invitations, team, `tenant_users_role_catalogue`, Service Network, dashboard redesign | **NOT REQUIRED FOR C3** | Unrelated to the OCR consumer. | stays in #209 / #197 |

## 3. Proof (offline; no provider spend)

| Gate | Result |
|---|---|
| `o2-ocr-c3-garage-consumer` + `o2-ocr-c3-garage-security` | 36/36 |
| Mutation testing: the null→0 confidence defect, an invented failure model, stale candidates, a Garage Qwen pin, simulated readings accepted, visual evidence marked readable, the refetch loop, the missing registry entry | every mutant killed |
| `database/test/ocr_c3_garage_evidence_check.mjs` (real Postgres): both lineages, CHECK coherence, browser-role privileges, idempotence | 38/38; the #209-first defect is reproduced without the reconciliation |
| Full backend suite (ci.yml environment) | see the C3 receipt for counts at the exact head |

## 4. Remaining debt, kept apart

**C3 blockers (moderator decision):**
- Canonical `ci.yml` has never run on C1, C2 or C3: it triggers only on a pull request to, or a push to, `main`. Exact-head evidence comes from the path-filtered offline workflow plus local CI-equivalent runs.
- There is no live provider run (manual dispatch, not authorized in C3) and no deployed preview UAT.

**OCR 1.0-D schema debt:**
- `business_document` has no city/town field, so `location_city` is always `missing`.
- Every Garage document type is read with the generic `business_document` schema. The Garage type is preserved separately as `evidence_type`.
- PDFs are refused by the image transport and show as `unavailable`.

**Broader Garage programme debt (#209):**
- Review, activation and invitations are not on C3.
- #209 and C3 both add the same Garage files, so merging both lanes produces add/add conflicts. C3's versions are the OCR-converged ones.
- On #209, garage activation requires an approved identity, and identity approval requires identity OCR to succeed. The Garage path therefore still depends on OCR there, even though Garage evidence OCR is optional.
- The "Finish Garage Setup" sidebar entry is shown to every owner, as on #209.

**Unrelated work on the C3 lineage (not OCR):**
- `diaspora-logistics-rfq` › SAILING MATCH fails on #207's own head and is unchanged by C3.

**Corrections to the OCR lineage, made in C3 so its exact head is green (§22):**
- `v16-authority-hardening` B7 still pinned Document Intelligence as a vehicle-trust writer after C1 retired it. The pinned set shrank from three writers to two.
- `trade-os-t12-registry-authority` used regexes written for the pre-A/B Document Intelligence layout. It now follows the structured write to the schema registry and the sample reader to the provider-boundary gate.
- Both guards were red at the accepted C2 SHA.
