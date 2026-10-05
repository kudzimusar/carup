# One CarUp — Open PR disposition at RC2

**Source RC:** `integration/one-carup-source-rc2`. Its code head is `3b36b1b4` (the OC-5J residual
fixes). This document and the RC2 records follow it as docs-only commits.

- It is RC1 (`75449a16`, Draft PR #220) plus OC-5A … OC-5J, linear, with no merges.
- Every phase head is pushed and CI-proven.
- It sits 0 commits behind `main` `bb9d9900`; RC1 did too, and nothing has landed on `main` since.

**Rule applied (unchanged from RC1):** no PR was merged wholesale. Each PR was reconciled against this
lineage, and only its valid, unique remainder was implemented. The order of priority:

1. Identity / People / Compliance
2. Seller
3. Garage / Mechanic / Service Network
4. Marketplace reliability
5. Trade OS remainder
6. Scenario infrastructure

**What changed since RC1:**
- OC-5 ported #208, #197, #209 and #213 as far as owner decisions allow.
- This disposition adds the six open PRs RC1 did not list: #137, #181, #200, #210, #216, and #220
  itself.
- Every RC1 entry was re-checked by ancestry and `git cherry` against RC2. None changed by accident.

## Categories

| Category | Meaning |
|---|---|
| **FULLY ABSORBED** | Everything valid in the PR is in RC2, by ancestry, patch-equivalence or a verified port. Closing the PR loses nothing. |
| **PARTIALLY ABSORBED** | Part of the PR is in RC2; the rest is listed under "Still required" or "Blocked". |
| **SUPERSEDED** | A later or better implementation on RC2 makes the PR's approach obsolete. |
| **STILL REQUIRED** | Valid, unique, and not yet in RC2. It needs a port. |
| **BLOCKED** | It cannot proceed without an owner decision, or it was parked by the moderator. |
| **DOCUMENTATION ONLY** | A plan, receipt or tracker; it is not a runtime change. |
| **RC1 CHECKPOINT** | The previous release candidate: kept, not closed, superseded by RC2. |

## Summary

| PR | Title | Head | RC1 | RC2 |
|---|---|---|---|---|
| #220 | One CarUp — OC-4 source RC1 | `75449a16` | — | **RC1 HISTORICAL CHECKPOINT / SUPERSEDED BY RC2** (do not close) |
| #197 | Service Network Foundation 1.0 | `c23f012c` | STILL REQUIRED | **FULLY ABSORBED** (code; plan documents not carried) |
| #209 | Garage & Mechanic Onboarding 1.0 | `ce45e16f` | PARTIALLY ABSORBED | **PARTIALLY ABSORBED** (one O2 commit and runtime certification remain) |
| #213 | Seller UAT remediation continuation | `ab9cc0e7` | PARTIALLY ABSORBED | **PARTIALLY ABSORBED** (D and O blocked on the owner) |
| #208 | O2 People, Compliance, Identity & Onboarding | `e65c0bb8` | PARTIALLY ABSORBED | **PARTIALLY ABSORBED** (runtime absorbed; workbook lane deferred; two P2s need the owner) |
| #137 | Remediate Issue #127 owner UAT regressions | `f0d00238` | (not listed) | **PARTIALLY ABSORBED** (one P1 fixed in RC2; the rest still required) |
| #200 | Seller UAT convergence and visual certification | `3778e5df` | (not listed) | **SUPERSEDED** |
| #207 | Trade OS: cross-border sourcing and shared logistics | `577428de` | FULLY ABSORBED | **FULLY ABSORBED** (ancestor) |
| #214 | Trade OS phases 3–13 | `4ec68f7e` | FULLY ABSORBED | **FULLY ABSORBED** (ancestor) |
| #218 | fix(vercel): release-only deployments | `8253acc9` | FULLY ABSORBED | **FULLY ABSORBED** (patch-equivalent) |
| #211 | Scenario Lab: template ingestion and golden scenarios | `30393a71` | FULLY ABSORBED | **FULLY ABSORBED** (ported) |
| #210 | docs(scenario-lab): template ingestion and scenario testing | `8385c2bb` | (not listed) | **FULLY ABSORBED** (documents present) |
| #184 | docs(intelligence): Intelligence 1.0 canonical plan | `0ea51b58` | FULLY ABSORBED | **FULLY ABSORBED** (documents present) |
| #217 | AI-01-B: CarUp AI gateway + Cloudflare Gemma | `6c8ff6f7` | FULLY ABSORBED (runtime) | **FULLY ABSORBED** (runtime) |
| #215 | Trade OS phases 3–13 (alternate) | `deed00c7` | SUPERSEDED | **SUPERSEDED** |
| #182 | Marketplace buyer↔seller reliability + reference UX | `cce3966c` | SUPERSEDED | **SUPERSEDED** |
| #196 | docs(service-network): Foundation 1.0 plan | `be8706db` | SUPERSEDED | **DOCUMENTATION ONLY** (correction below) |
| #186 | docs(seller): Seller Journey 1.0 plan + S0 | `8697db38` | DOCUMENTATION ONLY | **DOCUMENTATION ONLY** |
| #181 | docs(product): Dual-Lane Product Advancement & Design System | `857d672a` | (not listed) | **DOCUMENTATION ONLY** |
| #216 | docs(ocr): OCR 1.0 Global Document Intelligence programme | `1668daf1` | (not listed) | **DOCUMENTATION ONLY** |
| #219 | ci(vc-03): release-only CI | `db8bb088` | BLOCKED | **BLOCKED** (parked by the moderator) |

## Detail

### RC1 CHECKPOINT

**#220 — RC1.** RC1's head `75449a16` is an ancestor of RC2. The RC2 Draft PR names #220 the
**RC1 historical checkpoint, superseded by RC2**. #220 is not closed: it remains the reviewed record of
the RC1 candidate.

### Ported in OC-5

**#197 — Service Network Foundation 1.0 → FULLY ABSORBED (code).**
- **Ported:** OC-5D, P0–P7. See `OC5D_SERVICE_NETWORK_CONVERGENCE.md`.
- **Re-authored on a verified, explicit active tenant.** #197's oldest-membership guess is replaced;
  this was RC1's open decision 1.
- **Owner service-history v1 contract:** RC1's decision 2.
- **Migrations re-stamped:** RC1's decision 3.
- **Every garage route re-gated:** RC1's decision 4.
- **Not carried:**
  - #197's preview-pairing entries. They pair #197's own previews.
  - The "Active portal" label. It is presentation only, recorded in OC-5D.
  - The plan and UAT documents under `docs/service-network-foundation/` and
    `docs/garage-mechanic-onboarding/`. See #196.

**#196 — Correction to RC1.** RC1 recorded that #196's two plan documents "travel in #197" and "will
land with the Service Network port". They did not land. OC-5D carried the code, and its record
(`OC5D_SERVICE_NETWORK_CONVERGENCE.md`) is the port's governing document. The plans also describe the
oldest-membership rule OC-5D replaced. Landing them unmarked would publish a superseded authority
model as canonical. Category: **DOCUMENTATION ONLY**. Land them as history, with a superseded banner,
only if the owner wants them.

**#209 — Garage & Mechanic Onboarding 1.0 → PARTIALLY ABSORBED.**
- **Ported:** OC-5E. See `OC5E_GARAGE_ONBOARDING_COMPLETION.md`.
  - GMO-3: the reviewer, with an atomic decision. Review is platform administration only.
  - GMO-4: activation, which re-checks identity. The founder selects the garage.
  - GMO-6: invitations, with F1. Only an active garage seats anyone, and only the invitee's own
    verified address can accept.
  - GMO-7: membership, under a tenant lock.
  - GMO-0: a guard on membership writers.
  - GMO-1: autosave tests.
- **Superseded:** GMO-5, #209's own garage-context rule, by OC-5D.
- **Remaining:**
  - `43be0ad2`: identity classification and extraction trust as independent axes. It is O2's lane.
    Without it, some applicants never reach an approved identity.
  - GMO-8's certification tooling (golden journey, activation race, step-up scripts). It needs a
    staging pair: a **runtime-certification** item.
  - Garage notifications: no templates exist. This is an owner decision.
- #209's GMO-8 owner acceptance (`5bc3c96e`) certified #209's lineage. It does not transfer.

**#213 — Seller UAT remediation continuation → PARTIALLY ABSORBED.**
- **Ported in RC1:** slice C (`02853cf6`) and slice E (`33d7fe26`).
- **Ported in OC-5F:**
  - A: rollup@2. Reservations are credited to their own seller, which corrects #213.
  - B: the compare-funnel migration, re-stamped. It raises when its table is missing.
  - F: spec 48, a sibling gate. Its Communications phase is `fixme`, because as written it sends a
    real WhatsApp message.
- **Also fixed on the way:** rollup writes now fail closed (F1), and the report's unique-visitors
  wiring is corrected.
- **Blocked on the owner:**
  - D: the production inquiry path. It also gates spec 48's Phase Q.
  - O: the Intelligence panels.
- **Never:** `f45dce7b`, which edits a certified gate.

**#208 — O2 People, Compliance, Identity & Onboarding → PARTIALLY ABSORBED.**
All 96 of its non-merge commits were classified one by one. None is patch-equivalent: #208's work
reached RC2 by re-authored ports. 24 commits are ported, 3 superseded, 11 deferred as recorded, 3
unrecorded (now listed below), and 55 are certification, docs or CI only.

**Absorbed:**
- **People & Compliance:**
  - P1 and P1-C, through #194;
  - P2–P6 and C2/C3/C8, in OC-4D;
  - the dealer-authority review rounds D–M, `981ab07b`.
- **Identity and onboarding:**
  - X1, converged in OC-2A;
  - X2, X3 (with the step-up UI — RC1's blocked "step-up UI" choice is resolved, one shared path),
    X5 and X6, all in OC-5C;
  - X4, as an interface only.
- **U1, U2 and X5A's upload idempotency (bounded).**
- **Two late owner-UAT fixes:** the identity-decision step-up gate, and the onboarding pages inside the
  app shell.

**Fixed in RC2 (OC-5J):** ownership-transfer refusals answered 500 instead of 403/404/409/400. This
was the half of `4002dbea` OC-5C's port dropped; the Product Owner hit it live in UAT.

**Deferred, as recorded (OC-5C) — owner or lane:**
- **#208's own workbook catalogue and AI Workbook Assistant (`06ef4b9a`),** and everything stacked on
  it:
  - the workbook parts of review rounds D–M;
  - **U3** (`2b3cd26f`, `5d92d00d`). RC1's "U3 goes with X5A" meant this workbook X5A, not OC-5C's
    upload-idempotency X5A;
  - the workbook mobile and accessibility fixes;
  - `workbook.import.completed`.
- The X4 consent and assessment services, routes and UI. No provider is selected.
- Company-document OCR for dealers.
- The HMAC provenance stamp. Recommendation: no.
- The U2 per-stage timing log.
- The candidate migrations.

**Still required — found by the RC2 classification, recorded nowhere before:**
1. **P2 — identity documents cannot be submitted as PDFs** (`b822a3bb`).
   - On RC2 the page and the backend agree on images only, so nobody is told something false.
   - **Owner decision.** If yes, port it as a targeted change and add a PDF viewer to the reviewer
     console, which renders evidence with `<img>`. #208's own feature was never usable end to end.
2. **P2 — the home page's phone layout** (`b822a3bb`).
   - RC2's home page is the version the Product Owner rejected on a phone. Overflow at 393 px is
     unmeasured on RC2.
   - Measure it in the RC2 runbook's mobile UAT step, and port only the layout classes.
3. **P3 items:**
   - the dealer onboarding phone layout remainder;
   - strict server-side identity upload validation;
   - the U1 journey-level test;
   - `auth_method` never written (no behaviour change);
   - file inputs `hidden` rather than `sr-only` on the registration and dealer onboarding pages
     (keyboard reachability);
   - #208's documentation, not carried: the owner UAT pack, the workbook catalogue, the reconciliation
     manifest and the register addenda.

**Re-certification is runtime work.** #208's P7, X7 and mobile UAT have to be redone on RC2 as
sibling gates, because its workflows hard-pin #208's SHAs. #208's spec 45 collides with RC2's spec 45
(Trade OS) and needs a new number.

**Never as written** (each would regress RC2):
- `verificationSessionService.js` whole. It re-exposes `review_notes` and the reviewer's identity to
  the applicant (undoing `fcb1a908`), restores a blur-score fallback, and imports X4 services that do
  not exist.
- `3855f250`'s hunks on the retired `/api/ai/ocr`. RC2 answers 410.
- The HMAC stamp, and dedupe by stored metadata.
- The U2 `trustGraphService` (a second Trust writer).
- Modules importing the retired `askGemini`.
- #208's lifecycle, dealer-compliance and registration versions, which leak internal identity state
  and accept client-set fields.
- #208's original migrations, which duplicate RC2's re-stamped ones.
- `authMiddleware.js` whole. It predates OC-5A and OC-5D.
- Its staging harness edits.
- `b822a3bb`'s page JSX whole. Take only layout classes.

### Newly listed

**#137 — Issue #127 owner UAT regressions → PARTIALLY ABSORBED.**
- None of its 77 commits reaches RC2 by ancestry. The single patch-equivalent commit is empty. #129
  and #130 are its base, not a later landing.
- **Already on RC2 through later, independent work:**
  - the session-selected tenant (OC-5D);
  - server identity on boot;
  - live, identity-stamped notifications and the owner bell;
  - the reverse-RFQ page, deleted by T2;
  - container request bounding (T5).
- **Fixed in RC2 (OC-5J):** the Diaspora AI Command Center request loop. It is a live P1: 330 loads
  in 1.5 s at 20 ms latency, and #137's `effce404` fixed it. RC2 destructures the hook and adds a
  guard so that no effect anywhere depends on the API aggregate.
- **Still required, in priority order. Each is re-authored on RC2's shapes, never ported as written:**
  1. **P2** — the import document checklist can never show "Uploaded". It compares Title Case labels
     with sentence-case labels. Port: `cf8ef2c2`, `106c9c96`, and the checklist hunks of `7665e24a`
     and `31cb8ade`.
  2. **P2** — Diaspora notifications are written without a channel (R7B), and the in-app endpoints
     filter `channel = 'in_app'`, so they are invisible.
     - Re-author `10529d3e` and `c6e79a87` on the canonical row shape.
     - Fix `diasporaOwnershipHandoffService.notifyOwnershipHandoff`, which has the same shape.
     - Then run the staging retest R7B never received.
  3. **P2** — the portal switcher offers roles the backend refuses. **Decision needed:** keep #137's
     interim rule (show only the active role), or remove the switcher now that OC-5D's
     organisation switcher exists. Port: `88756be6`, `7fb701f1`, `b4e62ba8`, `33133c16`,
     `806bec02`, `e4346b21`, plus the role-filter hunks and spec 27.
  4. **P3** — Passport sign-in links lose their way back (`returnTo`). Port: `f960c35c`, `b161d463`,
     `f9411aa7`, `0e6b8852`, `4bb29f1f`.
  5. **P3** — import detail: the Passport button, and Cancel going to `/diaspora/imports`.
  6. **P3** — the free-text organisation field, front end and back end. Nothing reads it for
     authority.
- **Never as written:** #137's whole-file copies of `authMiddleware.js`, `sessionAccountRoutes.js` and
  `AuthContext.tsx`. They would reopen the lendable-role escalation OC-5A closed and drop OC-5D's
  verified tenant context. Also never: its `active_role` pinning, which is a design divergence, not a
  defect.

**#200 — Seller UAT convergence and visual certification → SUPERSEDED.**
- #200 and #202 ran the same Seller UAT convergence from the same base, on the same day. #202's lane
  is in RC2 by ancestry, through #194.
- Two #200 commits are patch-identical to RC2 commits: `4c0b7e21` ≡ `fecfd992`, and `51bd339d` ≡
  `857c1e8f`.
- Every other intent has a later RC2 implementation with stronger truthfulness contracts.
- **Never:**
  - `11cf8484`, which edits the certified gate;
  - `004f4043`, a public exact-VIN reveal of automation listings, which RC2's preview-only
    `fixture_scope` replaces;
  - `1e3a6e52` and `4accc269`, the stale marker and identity model.
- **Optional, for the owner:** each would be a small fresh commit if wanted.
  - `0abe0b15`, a login recovery hint;
  - `a468a3ff`, an existing-account panel on Register;
  - `3778e5df`, the evidence basis on the Marketplace card;
  - the `?tab=evidence` deep link from `fa2ce135`.
- **Blocked with #213 Phase O:** `f98fdd05` and `ea785a3f`.

**#210 — Scenario Lab documents → FULLY ABSORBED.** #210 is an ancestor of #211. Its two documents are
on RC2. They differ only by the trailing-space → `\` line-break normalisation RC1 recorded for #184,
which does not change rendering.

**#181 — Dual-lane product advancement and the CarUp Design System → DOCUMENTATION ONLY.** Two plan
documents, not on RC2. Land them only if the owner wants them.

**#216 — OCR 1.0 Global Document Intelligence → DOCUMENTATION ONLY.** The programme's canonical plan
(three documents) is not on RC2. Its runtime direction — "DI observes, domains decide", Qwen —
already governs the lineage, through C1–C3, OC-3 and OC-4C. The documents land when the owner
canonicalises them.

### Unchanged since RC1

Each row below was re-checked against RC2:

| PR | RC2 evidence |
|---|---|
| #207, #214 | ancestors |
| #218 | `git cherry` patch-equivalent |
| #211 | its net diff ported in `c7d08100` |
| #184 | documents present |
| #217 | runtime converged in OC-3C |
| #215 | superseded |
| #182 | superseded |
| #186 | documentation only |
| #219 | parked by moderator instruction; not absorbed without that instruction being lifted |
