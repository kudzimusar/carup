# Serena Vehicle Operations — Closure Certification Receipt

**Hardening + closure pass, 2026-09-03, and the residual closure pass that followed it.** This
receipt supersedes nothing in the 53-point final report; it records the *closure* certification
performed on one frozen candidate, then what the residual pass changed.

> **Superseded statements from the first closure pass are corrected in place, not left standing.**
> Three of its claims are now wrong and are marked where they appear: the frozen SHA (`a9339b94`),
> the open stale-Trust limitation (35a), and the "14 pre-existing failures" reconciliation. Each row
> below records the previous condition, the fix, and the proof.

## Candidate identity

| | |
|---|---|
| Branch | `feat/operations-control-plane-serena-slice` |
| **Functional candidate SHA** | **`f25ea5c6`** — the last commit touching product, test, migration or workflow code. Every gate below ran at this SHA. |
| Documentation head | commits after `f25ea5c6` touch `docs/` only, so the certification stays single-SHA (`git diff --name-only f25ea5c6 HEAD` returns only `docs/`) |
| Superseded | `a9339b94` was the first pass's frozen candidate. It is **no longer the candidate**: the residual pass changed product code (publish-time Trust re-materialization, server-authoritative evidence visibility, governed visibility correction), so the whole gate matrix was re-run at `f25ea5c6` rather than inherited. |
| PR | **#206**, draft, **UNMERGED**, base `fix/zimbabwe-seller-reality-comms-hardening` |

## 40-point closure receipt

| # | Item | Result |
|---|---|---|
| 1 | Final branch | `feat/operations-control-plane-serena-slice` |
| 2 | **Final SHA (frozen)** | **`f25ea5c6`** (supersedes `a9339b94` — see above) |
| 3 | PR | **#206**, draft, **UNMERGED** |
| 4 | **PR target — CORRECTED** | Was `main` (760 files, +120,936, 930 commits of unmerged ancestor history). **Retargeted to `fix/zimbabwe-seller-reality-comms-hardening`**, its true parent. The PR now shows only this slice. |
| 5 | Staging frontend SHA | exact candidate head; the provenance gate asserts it before any UAT step |
| 6 | Staging backend SHA | identical to frontend — run 33698035782 recorded `{"frontend_sha":"…","backend_sha":"…","unpaired":false}` |
| 7 | unpaired | `false` |
| 8 | Migrations | `20260902150000`, `20260902160000` — additive, forward-only; applied to staging; re-proven on real PostgreSQL (PGlite, 14/14, exit 0) incl. constraints, RLS, service_role-only grants and idempotent re-apply |
| 9 | Serena final state | **1 row** (no duplicate), `published`, identity unchanged |
| 10 | Evidence | 5/5 verified, all checksummed; canonical class/subtype authoritative; no import document counted as registration; T1 stays transit; Export Certificate stays import; CBCA stays inspection |
| 11 | Seller Authority | `confirmed`, basis `existing_relationship`, reviewer independent, seller could not self-approve (proven with a REAL owner session) |
| 12 | Registration | `arrived_customs_pending`, source `seller_declared`, published to buyers as a **Seller statement** |
| 13 | CVR / plate / TIP / ZIMRA / duty | none recorded; `plate_number` NULL, `temp_plate_id` NULL, `zimra_verified` false, `duty_paid` false, `cid_clear` false, `duty_cleared` false |
| 14 | **Canonical Trust — HEALED** | **60 / moderate**, `trust-decision-1.0.0`. Was 46 with a false published sentence (see 35a). Healed through the **governed product path**: the seller's own unpublish→republish, which now re-materializes the canonical position. No SQL, no hand-edited score, no fabricated review, no weakened guard. The +14 is the `registration_readiness` dimension moving from `not_recorded` to `pending` — the score followed the facts, the facts were not moved to follow the score. |
| 15 | Audit events | uploads (owner) → verifies (admin) → authority review (admin) → publish/unpublish/publish (**owner**) → `EVIDENCE_CLASSIFICATION_CORRECTED` (admin, with reason) |
| 16 | Fraud / governance | 0 cases, 0 review tasks, 0 disputes; `risk_governance` requirement present |
| 17 | **Public privacy — CORRECTED** | The signed-out evidence read now returns **zero** rows. It previously returned one: the Tanzania T1, published as `public_safe` by the uploader's own choice with no reviewer decision anywhere in its provenance. It has been withdrawn to `restricted` through the governed correction path (see 35a′). No bucket, path, uploader/verifier identity, notes, engine/chassis or tenant reaches a buyer; reviewer free-text never reaches the public payload. |
| 18 | Operations authorization | Aggregate + every mutation refuse unauthenticated, `x-user-id` fallback, forged `x-stakeholder-role: admin` and forged tenant — **with a valid CSRF token**, so authorization refuses independently of CSRF. A real authenticated OWNER session cannot open the workspace, self-approve authority, or re-classify evidence, while reading its OWN authority state without reviewer identity or reason |
| 19–21 | Desktop / tablet / mobile | **15/15 passed** on all three Chromium profiles — run **33698035782 @ `f25ea5c6`**, SUCCESS |
| 22 | Accessibility | axe serious/critical = 0 on the workspace, all viewports. The gate caught three real defects first: unnamed selects, an unlabelled scroll region, and a white-on-green-600 Published badge (3.29:1) that appeared only once the Serena was genuinely published |
| 23 | **Seller Golden lifecycle — CLEARED** | **PASS** — run **33698702769 @ `f25ea5c6`**, SUCCESS. The deferral was a *concurrency* hazard, not an unresolvable one: the two workflows overlap on exactly one identity (`uat.reviewer`), and each rotates-then-uses it inside its own run, so sequential execution is self-contained. Proven the hard way — dispatching it while the Serena run held the identity produced exactly the predicted collision, and it was cancelled and re-run after. Golden never touches Kingstone or the real Serena; it mints and retires its own synthetic VIN. |
| 24–27 | Passport / Marketplace / inquiry / unpublish-republish | Marketplace card + Vehicle Detail visible; public projection truthful; buyer inquiry recorded and surfaced in the Seller inbox; unpublish removes the public listing and republish restores it, each with an `owner` audit event |
| 28 | Communications | Communication Command Center CI **PASS** at `f25ea5c6` (33698035630) |
| 29 | Navigation | Navigation Intelligence CI **PASS** at `f25ea5c6` (33700738045) — a real dispatched workflow run, not a local reproduction |
| 30 | Finance obligation | Vehicle Finance Obligation Authority CI green; its PGlite authority gate re-run locally at the final SHA |
| 31 | **Broader CI matrix** | Classified below. Every gate is now either a real workflow PASS at `f25ea5c6` or a named, reproduced equivalent. |
| 32 | **Pre-existing failures — RECONCILED BY MEASUREMENT** | The earlier "16, now 14" figure was an artifact of running the suite **without** the `ci.yml` environment. Measured properly, under the exact CI env, on the same command, against the merge-base: **base `569e4f14` = 5674 tests / 11 fail; candidate `f25ea5c6` = 5746 tests / 0 fail.** This slice **resolved 9** of the 11 and **fixed the remaining 2** rather than inheriting them. **Zero new failures, and none left.** |
| 33 | Credentials / test data | Kingstone's credential captured and restored (`always()` step); verified afterwards directly against staging — still `role='owner'`, hash a well-formed 168-char scrypt. `uat.reviewer` remains `admin` (its permanent staging-only design), `uat.buyer` remains `owner`. **No test account gained permanent excess authority.** No secret committed; no backup table, no stray privileged account, no orphan authority rows, no duplicate or synthetic Serena |
| 34 | **Production touched** | **NO** |
| 35 | Known limitations | **(a) RESOLVED — see 35a.** **(a′) RESOLVED — see 35a′.** (b) PayPal payment receipt still not in the Evidence Vault. (c) `import_source` still the placeholder `'import'`. (d) Kingstone's email unverified, no identity document — neither is a publication requirement. (e) `reviewer` remains backend-only, explicitly bounded |
| 35a | **The stale Trust sentence — CLOSED** | **Previous condition:** the public payload asserted both "Zimbabwe registration stage has not been established from a recorded claim" *and* a registration claim block reporting that stage as recorded from a seller declaration. One document, two contradictory sentences. **Cause:** the stamp was written at 19:17:26 by evidence verification; the seller stated the stage a minute later; nothing re-evaluated. Because the stamp carries the current calculation version it classifies as FRESH, so no read path would ever recompute it. The rule was never wrong — the vehicle's real facts evaluate to `pending`, whose sentence is "Zimbabwe local registration is still in progress; this is a readiness limitation, not an adverse Trust finding." **Fix:** publication now re-materializes the canonical position, because publication is the moment CarUp asserts a public one. Best-effort and after the state change, exactly as at evidence review, so it can never refuse a legitimate publication. **Proof:** the live payload now carries the `pending` sentence and 60/moderate; the spec asserts the two halves of the payload cannot contradict each other |
| 35a′ | **The published Tanzania T1 — CLOSED** | **Previous condition:** the T1 sat at `visibility_level='public_safe'`, contradicting the manual's §13 table (Restricted) and flagged at M0.20 for M7 review. It was the only row passing the guest filter, so it alone drove the listing's public evidence count. **Cause:** three compounding gaps — the upload route took visibility from the request body with the server default as a mere fallback, so the uploader decided; the web uploader initialised that field to `public_safe` for every artifact; and no post-upload writer for `visibility_level` existed anywhere in the backend, so it could not be withdrawn through the product at all. Its provenance chain holds exactly one event: the owner's own upload. That is seller self-certification of publication, which §3.11/G7 forbid. **Fix:** visibility is now resolved server-side (narrowing always allowed, widening requires the evidence-review capability, refusals recorded on the row); the governed correction primitive learned visibility, so a wrongly published document can be withdrawn with an actor, a reason and an audit event; and the workspace offers that correction on already-verified rows, which is when such a mistake is actually found. **Proof:** the row is now `restricted`, corrected by `u_69f5fc051fdc4d63` (admin) with a written reason, `EVIDENCE_CLASSIFICATION_CORRECTED` recorded with `previous_value.visibility_level='public_safe'` → `new_value.visibility_level='restricted'`; the signed-out evidence read returns zero rows |
| 36 | Security-relevant findings | The only Supabase service credentials available to GitHub Actions are **not** the staging project. The Trust re-materialization step's guard refused rather than pointing a staging certification at another project — it announces and skips rather than failing or lying. That guard was **not weakened** to heal the Serena; the product path was used instead. Six other workflows reference `STAGING_SUPABASE_*` secrets that **do not exist** in this repository; that pre-existing latent gap is reported, not fixed here |
| 37 | Owner-UAT-ready | **YES** — `docs/features/CARUP_OPERATIONS_SERENA_OWNER_UAT_GUIDE.md` |
| 38 | Merge-ready (technical) | **YES**, on the corrected target |
| 39 | **Merge order — CORRECTED** | **#206 → #205 → #194.** The earlier receipt recorded `#194 → #205 → #206`, which is inverted for a stacked chain: merging #194 first promotes `integration/vehicle-passport-v16-cert` to `main` **without** this slice, leaving #205 and #206 still stacked underneath and requiring a fresh integration→main PR afterwards. Landing this work means merging the deepest PR first. Verified topology (on full history, after unshallowing): `main`(`ba208963`) ← `integration/…`(`f180c47d`) ← `fix/zimbabwe-…`(`569e4f14`) ← this branch — a clean linear stack in which every merge is a fast-forward. Parallel lane #200 (Seller UX convergence) also targets #194 and touches My Garage / My Listings / Sell router; it must be reconciled on that lane, not here |
| 39a | **What the certification covers — CORRECTED 2026-09-03** | An earlier version of this row claimed `integration/vehicle-passport-v16-cert` is **not** an ancestor of `fix/zimbabwe-seller-reality-comms-hardening`, and therefore that #205 would combine this slice with integration work no run here exercised. **That was wrong**, and the cause is worth recording: this working clone was a **shallow** clone (`git rev-parse --is-shallow-repository` = true, 5 graft points). `569e4f14` had no parent locally, so `git merge-base` returned empty and every ancestry answer computed from it was an artifact of the graft rather than a fact about the repository. After `git fetch --unshallow`, the true topology is a **clean linear stack**: `main`(`ba208963`) → `integration`(`f180c47d`) → `fix`(`569e4f14`, +14) → this branch (+39). Integration's tip `f180c47d` **is an ancestor of the certified candidate `f25ea5c6`**, so the certified tree already contained every integration commit — including the seller lifecycle fixes (`07741c0c`, `7769599c`, `baa63163`, `52352271`, `f180c47d`) this row previously warned were unexercised. Consequently every merge in the stack is a **fast-forward**, no conflict is possible, and the certification does cover the combination. |
| 40 | Recommendation | Owner review of the slice diff, then merge in lane order. Next slice: M8 pattern extraction, then O2 People & Compliance |

## CI matrix classification (final head `f25ea5c6`)

| Workflow | Class |
|---|---|
| **Operations Serena Staging UAT** | **PASS — GitHub workflow** · 33698035782 · 15/15 desktop + tablet + mobile |
| **Seller Exact-Head Staging UAT (Golden)** | **PASS — GitHub workflow** · 33698702769 · deferral cleared |
| **Navigation Intelligence CI** | **PASS — GitHub workflow** · 33700738045 · dispatched |
| **Marketplace Reference Regression** | **PASS — GitHub workflow** · 33700740664 · dispatched, including its unmocked exact-head staging certification |
| **Vehicle Passport Foundation CI** | **PASS — GitHub workflow** · 33698035614 |
| **Communication Command Center CI** | **PASS — GitHub workflow** · 33698035630 |
| **Referral Engine CI** | **PASS — GitHub workflow** · 33698035676 |
| **Diaspora Phases 3-7 Validation** | **PASS — GitHub workflow** · 33698035572 |
| `CI` (Lint · Types · Build · Tests) | **PASS — exact underlying gate reproduced.** This is the one workflow that genuinely cannot be dispatched: it declares only `pull_request:[main]` and `push:[main]`, with **no `workflow_dispatch` trigger at all**, so the correct retarget removed it from this PR and no dispatch can restore it. Its `validate` job was reproduced command-for-command at `f25ea5c6` with its exact job env (`NODE_ENV=test`, the four placeholder Supabase/JWT vars, `ALLOW_OCR_MOCK=true`): lint regression gate **NET_NEW_ERRORS=0 / NET_NEW_WARNINGS=0**; `npx tsc --noEmit --project web/tsconfig.app.json` **exit 0**; `npm run build` **PASS**; `node --test backend/tests/*.test.js` **5746 tests, 5725 pass, 0 fail, 21 skipped**; all 8 PGlite gates PASS; all 11 diaspora ledger harnesses PASS (11 matched, 0 failed). The workflow's branch policy was **not** changed to manufacture a green badge — the policy is correct, and CI will gate these changes when #205/#194 target main. |
| Diaspora Deployed Staging UAT · Marketplace Reference Media Staging Apply · Seller Registration Profile / S0 Taxonomy / S3 Location Staging Gates | **SKIPPED — NOT APPLICABLE**: path/base-filtered to lanes this slice does not touch |
| Earlier Serena runs (33670227213 … 33697442149) | **SUPERSEDED** by the final-SHA run. Each is recorded in the tracker with what it proved or found — several found real defects: the `fraud_cases.severity` mismatch, the published-state contrast violation, the masked-credential defect in my own gate, and the missing CSRF token on the governed correction |

## Residual roll call

Every residual carried into this pass, with its final state. "Deferred" is not used where the item
could actually be completed.

| Residual | Original state | Action taken | Final state | Evidence | SHA run at | Remaining owner action |
|---|---|---|---|---|---|---|
| Serena Trust position stale and self-contradicting | Known limitation 35a, "heals on the next governed event" | Made publication re-materialize the canonical position; healed via the seller's own republish | **RESOLVED** | Live payload: `pending` sentence, 60/moderate | `f25ea5c6` | none |
| Tanzania T1 published as `public_safe` | M0.20 "should be reviewed in M7" | Closed the upload hole server-side; taught the governed correction primitive visibility; withdrew the row | **RESOLVED** | Row `restricted`; `EVIDENCE_CLASSIFICATION_CORRECTED` audit with reason | `f25ea5c6` | none |
| Seller Golden lifecycle | `[!]` DEFERRED (M7.41) | Established that sequential execution is safe; ran it | **PROVEN** | Run 33698702769 SUCCESS | `f25ea5c6` | none |
| `CI` gate not triggering | Item 31, "reproduced locally" (partial) | Established it has no `workflow_dispatch` at all; reproduced every `validate` step with the exact CI env | **PROVEN — exact underlying gate reproduced** | Step-by-step results above | `f25ea5c6` | CI gates it when #205/#194 target main |
| Navigation Intelligence CI not triggering | Item 31, bundled | Dispatched the real workflow | **PROVEN** | 33700738045 SUCCESS | `f25ea5c6` | none |
| Marketplace Reference Regression not triggering | Item 31, bundled | Dispatched the real workflow | **PROVEN** | 33700740664 SUCCESS | `f25ea5c6` | none |
| "14 pre-existing failures" | Item 32, asserted not measured | Ran base and candidate under identical CI env and compared | **RESOLVED** | base 11 fail → candidate 0 fail | `f25ea5c6` vs `569e4f14` | none |
| P1-A trust refresh failure | Called pre-existing | Fixed: the PGlite fixture omitted columns governed readers select, and this slice deepened that drift | **RESOLVED** | 14/14 in that file | `f25ea5c6` | none |
| Phase 5 media-identity containment failure | Called pre-existing | Fixed: the chain scanner terminated on `;` in semicolon-free source and absorbed an unrelated handler | **RESOLVED** | 23/23, incl. a new false-negative guard | `f25ea5c6` | none |
| Eligibility contract doc drift | M0 delta table, "reconcile if in scope" | Corrected two stale rows against the helper | **RESOLVED** | `docs/CARUP_REAL_LISTING_ELIGIBILITY_CONTRACT.md` correction note | `e2ec8bc4` | none |
| M4.22/23/24 responsive items | `[ ]` unchecked | Carried the M7.32–34 evidence that already covered them | **RESOLVED** | Progress tracker | `e2ec8bc4` | none |
| PayPal payment receipt absent from the vault | Known limitation (b) | None — it is Kingstone's artifact to upload; authority was confirmed without it | **OUTSIDE-SLICE — justified** | Item 35(b) | — | Kingstone uploads it if desired |
| `import_source` = `'import'` placeholder | Known limitation (c) | None — changing it is a data decision for the Seller lane | **OUTSIDE-SLICE — justified** | Item 35(c) | — | Seller lane |
| Kingstone email unverified / no identity document | Known limitation (d) | None — neither is a publication requirement, and identity goes through the identity workflow, never the vehicle vault | **OUTSIDE-SLICE — justified** | Item 35(d) | — | Identity lane |
| `reviewer` role backend-only | Known limitation (e) | None — deliberately bounded in this slice | **OUTSIDE-SLICE — justified** | Item 35(e) | — | People/Access lane |
| `STAGING_SUPABASE_*` secrets do not exist | Item 36 | Reported; the guard refuses rather than mis-targeting | **EXTERNAL BLOCKER — exact dependency identified** | Item 36; the step's spoken SKIPPED outcome | `f25ea5c6` | Repo owner creates the secrets, or accepts CI cannot re-materialize Trust |
| One published synthetic Golden vehicle in staging | Not previously recorded | Detected and attributed, **not** silently remediated | **OUTSIDE-SLICE — justified** | `JTDKARFP0H3000731`, `publication_status='published'`, created **2026-06-17** — eleven weeks before this slice. This slice's own Golden runs left their vehicles at `publishable` (not public), and the cancelled run created nothing | `f25ea5c6` | Owner of the Passport/Golden lane decides; unpublishing another lane's fixture from here could red their gates |
| M8.1–M8.9 | `[ ]` | None — explicitly out of scope by instruction | **OUTSIDE-SLICE — justified** | Tracker | — | Next slice |
| O2–O10 domains | Deferred | None — explicitly out of scope by instruction | **OUTSIDE-SLICE — justified** | Tracker | — | Later programme |

## Closure rule check

Serena truthfully published · no false registration/TIP/ZIMRA/duty/plate claim · canonical evidence
semantics hold · Seller Authority independently governed · **no source document published without a
governed decision** · **the public payload does not contradict itself** · exact-head pair proven ·
accessibility passes · desktop/tablet/mobile pass · inquiry passes · unpublish/republish passes ·
**zero failing backend tests, measured against the base** · staging credentials restored and verified
· no test account holds excess authority · migrations and RLS proven · tracker complete · PR topology
correct · final SHA frozen and re-certified · **PR remains UNMERGED**.

No item is left open with a hidden cause. The two that remain open are open by instruction (M8,
O2–O10) or by an external dependency named exactly (the absent staging secrets).
