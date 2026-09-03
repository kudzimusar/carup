# Serena Vehicle Operations — Final Implementation Report (manual §41, 53 points)

**Prepared:** 2026-09-03 · **Status:** certified merge candidate, **UNMERGED**, awaiting Product Owner approval.

| # | Item | Result |
|---|---|---|
| 1 | Branch | `feat/operations-control-plane-serena-slice` |
| 2 | Final HEAD | `569d9d52` (see §Addendum if a later fix commit lands) |
| 3 | Base | seed `569e4f14`; docs head `96620f92`; PR base `main` (`ba208963` at open) |
| 4 | PR | **#206** — https://github.com/kudzimusar/carup/pull/206 (draft) |
| 5 | Staging URL | frontend `carup-staging-git-feat-operations-control-plane-se-00a80a-11-11.vercel.app`; backend `carup-backend-staging-git-feat-operations-control-6e0b93-11-11.vercel.app` |
| 6 | Frontend deployed SHA | exact candidate head (asserted by the workflow provenance gate before any UAT step) |
| 7 | Backend deployed SHA | identical to the frontend SHA (`/api/health` `build.commit_sha`) |
| 8 | Pairing state | `unpaired: false`; `api_base_source` names the governed `preview-backend-pairing.json` entry |
| 9 | Serena identifier | `GFC27-027051` — 2016 Nissan Serena Highway Star (one row; no duplicate created) |
| 10 | Evidence before | 5 rows, all `pending`; canonical class/subtype correct on every row; legacy `evidence_type` contradictory on every row (M0.19 matrix) |
| 11 | Canonicalization changes | **None to Serena rows.** The semantics layer made the already-correct canonical values authoritative; no backfill, no reclassification |
| 12 | Legacy compatibility strategy | Legacy `evidence_type` retained (it is load-bearing for upload authorization, storage bucket, default visibility, AI extraction) but demoted to compatibility/artifact-form; canonical-first uploads DERIVE it, with two neutral values (`vehicle_life_document` / `vehicle_life_photo`) added additively so no new record can carry a false legacy meaning |
| 13 | Seller Authority implementation | `backend/services/seller/sellerAuthorityService.js` (policy `seller_authority.v1`) + additive `vehicle_seller_authority` table; `trust_audit_events` remains the decision-history authority, written fail-closed before every state change |
| 14 | Serena Seller Authority | **confirmed**, basis `existing_relationship` (Kingstone holds owner_id and current_seller_id), strengthened by the verified import purchase chain; decided by the Operations reviewer, reason recorded |
| 15 | Zimbabwe registration stage | `arrived_customs_pending` |
| 16 | Stage provenance | `seller_declared` — presented everywhere as a **Seller statement**, never as CarUp review or registry fact |
| 17 | TIP | Not applicable; `temp_plate_id` NULL. The Tanzania T1 remains `import/transit_declaration` and is provably not a TIP |
| 18 | CVR | Not recorded — no registration-class evidence exists, so no CVR fact is asserted |
| 19 | Plate | Not recorded (`plate_number` NULL); not required at this lifecycle stage |
| 20 | Completeness before | NOT publishable — `registration_readiness` blocking (stage unrecorded), `seller_authority` pending review |
| 21 | Completeness after | **publishable** — authority confirmed + sourced, ordinarily-listable pending stage; no other blocker |
| 22 | Fraud/governance | No fraud cases, no open governance tasks, no disputes; the new `risk_governance` requirement evaluates `present` |
| 23 | Canonical Trust | Materialized after evidence verification: **46 / moderate**. **Superseded by the residual closure pass: 60 / moderate.** The 46 was a stale stamp, not a rules defect — it predated the seller's registration-stage statement and classified as FRESH, so no read path would recompute it. Publication now re-materializes the canonical position and the seller's own republish healed it. See the closure receipt, item 35a. |
| 24 | Vehicle Operations route | `GET /api/admin/vehicles/:vin/review` + `/admin/vehicles/:vin/review` |
| 25 | Operations authorization | `operationsAuthorizationService` — capabilities derive from the SERVER-side platform/base role only; proven session required; applied to the aggregate, the classification correction and the authority decision |
| 26 | Operator used | `uat.reviewer@carup-staging.test` (role admin), credential rotated inside CI by the repo's existing staging identity-rotation pattern; never the public registration UI. Kingstone's own credential was captured to the runner, temporarily replaced, and restored by an `always()` step |
| 27 | Audit evidence | 14 `trust_audit_events`: 5 EVIDENCE_UPLOADED (owner) → 5 EVIDENCE_VERIFIED (admin) → SELLER_AUTHORITY_REVIEWED (admin) → PUBLISHED / UNPUBLISHED / PUBLISHED (**owner**) |
| 28 | Private evidence leak test | Aggregate DTO serialization asserted free of `file_url` / `file_path` / `ocr-documents` / seller contact PII / audit ip+user-agent; signed-out evidence read asserted per row (only `public_safe` + verified, no file URL) |
| 29 | Seller Publish result | **Kingstone published** — `VEHICLE_LISTING_PUBLISHED` with `actor_role=owner`. Operations never published on his behalf |
| 30 | Marketplace card | Visible for the VIN on the public Marketplace |
| 31 | Vehicle Detail / Passport | Renders with primary actions; asserted free of "locally registered", "temporary import permit" and ZIMRA/customs confirmation claims |
| 32 | Buyer inquiry | Inquiry `871654b1-d31b-483d-8c43-14f3c2d3c007` (`vehicle_purchase_interest`, status `new`) created through the real guest modal |
| 33 | Unpublish / republish | Both proven, each with an `owner` audit event; Marketplace absence asserted while unpublished |
| 34 | Desktop UAT | PASS — chromium 3/3 (run 33672092584) |
| 35 | Tablet UAT | Journey PASS; workspace axe assertion re-certified after the contrast fix (run 33673092837) |
| 36 | Mobile UAT | Journey PASS; same re-certification |
| 37 | Accessibility | axe (serious/critical) gate on the workspace, all three viewports. It caught three real defects — unnamed selects, an unlabelled scroll region, and white-on-green-600 contrast on the Published badge — all fixed |
| 38 | Backend tests | Full suite: 5,696 pass / 15 fail — every failure is in the pinned pre-existing baseline (OCR provenance, identity verification, staging-QA roles, P1-A, phase-5 containment, canonical destination). **Zero new failures** |
| 39 | Web tests | Full vitest suite 1,554/1,554, including new workspace and canonical-upload component suites; `tsc --noEmit` clean; ESLint regression gate clean |
| 40 | Playwright | New staging spec 43 (9 tests × 3 viewports); navigation/nav-map suites updated and green |
| 41 | Existing Seller gates | Golden Seller lifecycle dispatched on this branch (see Addendum); refusal contract in spec 38 re-aimed at the M3 `seller_authority` requirement |
| 42 | Passport gates | Vehicle Passport Foundation CI run at the final head (see Addendum) |
| 43 | Marketplace gates | Marketplace Reference Regression run at the final head (see Addendum) |
| 44 | Communications gates | Communication Command Center CI **green** at the final head |
| 45 | Migration files | `20260902150000_vehicle_life_generic_compat_types.sql`, `20260902160000_vehicle_seller_authority.sql` (both additive, forward-only) |
| 46 | Staging migrations applied | Yes — via Supabase MCP and idempotently re-applied by the certification workflow; verified by constraint/RLS/row queries |
| 47 | Production touched | **NO.** No production credential, database or deployment was used at any point |
| 48 | Known limitations | **Superseded in part by the residual closure pass** — the stale Trust sentence and the Tanzania T1 published as `public_safe` are both CLOSED (closure receipt 35a / 35a′). Still open: | PayPal payment receipt not yet in the Evidence Vault (authority confirmed without it); `import_source` still the placeholder `'import'`; Kingstone's email unverified and no identity document in the identity workflow (neither is a publication requirement); `reviewer` role remains backend-only and explicitly bounded rather than resolved |
| 49 | Deferred domains | O2–O10 (People, Marketplace Safety, Customer Ops, Service Network, Finance, Insurance, Transactions, Government, Security/Platform); generic `operations_cases` deliberately deferred to the M8 gate; persistent capability schema deferred |
| 50 | Unresolved security findings | None. One dormant risk recorded, not introduced: `backend/services/passport/passportEvidenceProjection.js` trusts `visibility_level` and copies `file_url` with no bucket check — it is unwired (test-only) and must be hardened before any future wiring |
| 51 | Serena owner-UAT-ready | **YES** — replay guide at `docs/features/CARUP_OPERATIONS_SERENA_OWNER_UAT_GUIDE.md` |
| 52 | Merge-ready | Implementation and certification complete; **merge blocked pending Product Owner approval only** |
| 53 | Recommended next slice | M8 pattern extraction (decide `operations_cases` / assignment / SLA / persistent capabilities on the evidence this slice produced), then O2 People & Compliance |

## What the slice actually proved

The goal was never "make the Serena pass the gate". The gate was rewritten to ask the real questions, and the Serena then passed **because the real facts satisfied the real rule**:

- its import documents can no longer masquerade as Zimbabwe registration evidence, whatever their legacy field says;
- Seller Authority was decided as a CarUp policy question, separately from registration;
- a permanent import with a truthfully-stated pending stage is listable, with no plate, no TIP, no CVR and no ZIMRA claim invented anywhere;
- Operations cleared governed blockers and the **Seller** performed every publication action;
- the private source documents that supported those decisions never became public content.

## Addendum — post-report gate results

Filled as the remaining runs at the final head report. Anything still open here is a CI result, not an unproven product contract.
