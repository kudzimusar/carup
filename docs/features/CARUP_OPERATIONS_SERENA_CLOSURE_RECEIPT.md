# Serena Vehicle Operations — Closure Certification Receipt

**Hardening + closure pass, 2026-09-03.** This receipt supersedes nothing in the 53-point final
report; it records the *closure* certification performed on one frozen candidate.

| # | Item | Result |
|---|---|---|
| 1 | Final branch | `feat/operations-control-plane-serena-slice` |
| 2 | **Final SHA (frozen)** | **`a9339b94c495e6494a6130e56ab9fc49664ccce6`** |
| 3 | PR | **#206**, draft, **UNMERGED** |
| 4 | **PR target — CORRECTED** | Was `main` (760 files, +120,936, 930 commits of unmerged ancestor history). **Retargeted to `fix/zimbabwe-seller-reality-comms-hardening`**, its true parent. PR now shows **55 files, +9,836/−293, 21 commits** — only this slice. |
| 5 | Staging frontend SHA | exact candidate head (workflow provenance gate asserts before any UAT step) |
| 6 | Staging backend SHA | identical to frontend |
| 7 | unpaired | `false` (governed pairing file names the paired backend) |
| 8 | Migrations | `20260902150000`, `20260902160000` — additive, forward-only; applied to staging; re-proven on real PostgreSQL (PGlite, 14/14, exit 0) incl. constraints, RLS, service_role-only grants and idempotent re-apply |
| 9 | Serena final state | 1 row (no duplicate); `published`; identity unchanged |
| 10 | Evidence | 5/5 verified, all checksummed; canonical class/subtype authoritative; no import doc counted as registration; T1 stays transit; Export Certificate stays import; CBCA stays inspection |
| 11 | Seller Authority | `confirmed`, basis `existing_relationship`, reviewer independent, seller could not self-approve (proven with a REAL owner session) |
| 12 | Registration | `arrived_customs_pending`, source `seller_declared`, published to buyers as a **Seller statement** |
| 13 | CVR / plate / TIP / ZIMRA / duty | none recorded; `plate_number` NULL, `temp_plate_id` NULL, `zimra_verified` false, `duty_paid` false, `cid_clear` false, `duty_cleared` false |
| 14 | Canonical Trust | 46 / moderate / confidence low, `trust-decision-1.0.0`, refreshed by evidence verification; engine-produced, no manual score, single canonical writer |
| 15 | Audit events | 14+ — uploads (owner) → verifies (admin) → authority review (admin) → publish/unpublish/publish (**owner**) |
| 16 | Fraud / governance | 0 cases, 0 review tasks, 0 disputes; `risk_governance` requirement present |
| 17 | Public privacy | Signed-out evidence read returns only the one `public_safe` verified row with `file_url: null`, `file_availability: withheld_private`; no bucket, path, uploader/verifier identity, notes, engine/chassis or tenant. Reviewer free-text never reaches the public payload |
| 18 | Operations authorization | Aggregate + both mutations refuse unauthenticated, `x-user-id` fallback, forged `x-stakeholder-role: admin` and forged tenant — **with a valid CSRF token**, so authorization refuses independently of CSRF. A real authenticated OWNER session cannot open the workspace, self-approve authority, or re-classify evidence, while reading its OWN authority state without reviewer identity or reason |
| 19–21 | Desktop / tablet / mobile | **12/12 passed** on all three Chromium profiles |
| 22 | Accessibility | axe serious/critical = 0 on the workspace, all viewports. The gate caught three real defects first: unnamed selects, an unlabelled scroll region, and a white-on-green-600 Published badge (3.29:1) that appeared only once the Serena was genuinely published |
| 23 | Seller Golden lifecycle | **DEFERRED, explained** — shares the `uat.reviewer` identity this certification rotates; concurrent runs invalidate one another. Its refusal contract was updated for M3. Must run on lane #205/#194 before their merge |
| 24–27 | Passport / Marketplace / inquiry / unpublish-republish | Marketplace card + Vehicle Detail visible; public projection truthful; buyer inquiry recorded and surfaced in the Seller inbox; unpublish removes the public listing and republish restores it, each with an `owner` audit event |
| 28 | Communications | Communication Command Center CI **green** at the final head |
| 29 | Navigation | Navigation Intelligence CI at the final head; nav-map admin count recomputed 29 → 32 (three consoles restored) |
| 30 | Finance obligation | Vehicle Finance Obligation Authority CI green |
| 31 | Broader CI matrix | Classified below — no unexplained gate |
| 32 | Pre-existing failures | Baseline was 16. **Now 14, and two were RESOLVED rather than excused** (stale 8-class taxonomy test; `registration_status` having no recorded canonical destination — the latter sat inside this slice's own subject matter). Remaining 14 are OCR/identity-verification, P1-A, phase-5 containment and staging-QA role catalog — none in code this slice changed. **Zero new failures.** |
| 33 | Credentials / test data | Kingstone's credential captured to the runner and restored (`always()` step, asserts exactly one row); hash well-formed scrypt. No secret committed. No backup table, no stray privileged account, no orphan authority rows, no duplicate or synthetic Serena |
| 34 | **Production touched** | **NO** |
| 35 | Known limitations | (a) The published Trust block still carries one stale sentence — "Zimbabwe registration stage has not been established from a recorded claim" — because the cache was materialized minutes before the seller stated the stage. The **forward fix is in place and pinned**: the seller save path now re-materializes canonical Trust whenever it records a stage, so this cannot recur; the existing row heals on the next governed evidence or stage event. It cannot be healed from CI today (see 36). (b) PayPal payment receipt not yet in the Evidence Vault. (c) `import_source` still the placeholder `'import'`. (d) Kingstone's email unverified, no identity document — neither is a publication requirement. (e) `reviewer` remains backend-only, explicitly bounded |
| 36 | Security-relevant finding | The only Supabase service credentials available to GitHub Actions are **not** the staging project. The Trust re-materialization step's guard refused rather than pointing a staging certification at another project — the step now announces and skips instead of failing or lying. Six other workflows reference `STAGING_SUPABASE_*` secrets that **do not exist** in this repository; that pre-existing latent gap is reported, not fixed here |
| 37 | Owner-UAT-ready | **YES** — `docs/features/CARUP_OPERATIONS_SERENA_OWNER_UAT_GUIDE.md` |
| 38 | Merge-ready (technical) | **YES**, on the corrected target |
| 39 | **Retarget required before merge** | **DONE** — #206 now targets `fix/zimbabwe-seller-reality-comms-hardening`. Merge order must be #194 → #205 → #206. Parallel lane #200 (Seller UX convergence) also targets #194 and touches My Garage / My Listings / Sell router; it must be reconciled on that lane, not here |
| 40 | Recommendation | Owner review of the 55-file diff, then merge in lane order. Next slice: M8 pattern extraction, then O2 People & Compliance |

## CI matrix classification (final head)

| Workflow | Class |
|---|---|
| Operations Serena Staging UAT | **PASS** — 12/12, three viewports |
| Communication Command Center CI | **PASS** |
| Vehicle Finance Obligation Authority CI | **PASS** |
| CI (lint · types · build · tests) | at final head — see PR checks |
| Vehicle Passport Foundation CI | at final head — see PR checks |
| Navigation Intelligence CI | at final head — see PR checks |
| Marketplace Reference Regression | at final head — see PR checks |
| Referral Engine CI · Diaspora Phases 3-7 | run because shared navigation/registry contracts changed |
| Diaspora Deployed Staging UAT · Marketplace Reference Media Staging Apply · Seller Registration Profile / S0 Taxonomy / S3 Location Staging Gates | **SKIPPED — NOT APPLICABLE**: path/base-filtered to lanes this slice does not touch |
| Earlier Serena runs 33670227213 / 33671072128 / 33672092584 / 33673092837 / 33674960836 / 33675351878 / 33676230598 | **SUPERSEDED** by the final-SHA run (each is recorded in the tracker with what it proved or found) |
| Seller Exact-Head Staging UAT (Golden) | **DEFERRED** — item 23 |

## Closure rule check

Serena truthfully published · no false registration/TIP/ZIMRA/duty/plate claim · canonical evidence
semantics hold · Seller Authority independently governed · private documents private · exact-head
pair proven · accessibility passes after the fix · desktop/tablet/mobile pass · inquiry passes ·
unpublish/republish passes · zero new regressions · pre-existing failures reconciled (two resolved) ·
staging credentials and test state restored · migrations and RLS proven · tracker complete · PR
topology corrected · final SHA frozen · **PR remains UNMERGED**.

One item is deliberately open and named rather than hidden: the stale Trust sentence (35a), with its
forward fix already in place.
