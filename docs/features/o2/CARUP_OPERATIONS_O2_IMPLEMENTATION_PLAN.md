# O2 — People & Compliance Operations: Implementation Plan

- **Branch:** `feat/operations-o2-people-compliance` (cut from the integrated candidate `dd94c56d` / docs head `33720d79`)
- **Date:** 2026-09-03 (status corrected the same day at head `90c50cc0`; the plan body below is the original P0 design, preserved)
- **Status:** CORE IMPLEMENTED — **P0–P6 + P1-C complete and certified** (P1-C certification at `e9326f76`; evidence in `CARUP_OPERATIONS_O2_PROGRESS.md`); **P7 staging certification BLOCKED / NOT EXECUTED** (the tracker's P7 note governs); Identity/Onboarding Expansion in DESIGN — see "Post-core expansion" below
- **Governing law:** OPERATIONS ORCHESTRATES. DOMAIN SERVICES OWN TRUTH.
- **Governing ADR:** `docs/architecture/CARUP_OPERATIONS_CONTROL_PLANE_M8_REUSABLE_OPERATIONS_PATTERN_ADR.md`

## What O2 is

One bounded vertical slice that answers, for a person or business:

1. Who is this person/business? — `users` + identity verification (identity service owns it)
2. What verification/compliance state are they in? — verification sessions, dealer compliance profile
3. What evidence supports that state? — identity documents, dealer compliance documents, vehicle evidence for authority
4. Who must act next? — the M8 `who_must_act` vocabulary, as a **derived projection**, never a stored copy
5. What can the reviewer legitimately decide? — exactly the actions the owning domain services already expose
6. What canonical record owns the decision? — named per row; the Operations view writes none of them
7. What happens when ownership/seller authority changes? — transfer completion supersedes the prior seller's authority (P1)
8. What is safe to expose publicly? — the privacy matrix; identity artifacts NEVER
9. What is audited? — every decision through the owning domain's audit path, fail-closed
10. What does Communications need to deliver? — domain events; Communications owns delivery

## What O2 is NOT

- Not a generic Operations platform (M8 REJECTED `operations_cases`; that stands)
- Not a new assignment model, SLA framework, capability-grant table, or Work Index (all M8-DEFERRED with triggers; none of the triggers is met by this plan, and if implementation meets one, the evidence is documented FIRST)
- Not a rebuild of Identity Verification, Dealer Compliance, or Seller Authority — all three are reused as the owning authorities
- Not a "verified seller" boolean. Email verification, identity verification, Seller Authority, vehicle ownership, dealer/business compliance, Zimbabwe registration and Vehicle Trust remain SEPARATE concepts with separate owners, separately displayed

## Bounded phases

| Phase | Deliverable | Writes product code? | Gate |
|---|---|---|---|
| P0 | This design pack (10 artifacts) | No | docs present, roll-call tracker opens |
| P1 | **Ownership transfer → Seller Authority supersession** in canonical domain services | Yes (backend) | unit + PGlite behavioral proof; no history deleted; fail-closed |
| P2 | `who_must_act` responsibility projection on the three domain reads (identity review list/detail, seller authority state, dealer compliance profile) — **derived at read time, ADR vocabulary verbatim** | Yes (backend, read-only additions) | unit tests per domain; no persisted column |
| P3 | People & Compliance operating view: one read-model aggregate + one workspace page (person-centric), capability-gated, zero mutations of its own | Yes (backend read model + web) | read-model tests; UI tests; axe |
| P4 | Reviewer actions wired to EXISTING domain endpoints (identity review, dealer compliance decision, seller authority review) from the workspace | Yes (web only) | adversarial authorization tests |
| P5 | Decision → Communications domain events (`identity.verification.decided`, `dealer.compliance.decided` where missing) | Yes (backend, emit-only) | event emission tests; Communications untouched |
| P6 | Privacy + adversarial pass: unauthenticated/forged/fallback/self-review refusals; identity artifacts unreachable | Tests only | all refusals proven with valid CSRF |
| P7 | Staging certification: the real journeys in the certification matrix, desktop + tablet + mobile, exact-head pair | CI workflow + spec | one SHA, all journeys green |

Each phase lands only when its gate is green; the tracker records evidence per item.

## Authorization model

Extends the M5 **static** capability map (no persistent grants — M8-DEFERRED):

- `operations.person.read_private` — open the People & Compliance view
- `operations.identity.review` — decide identity sessions (wraps the existing role gate)
- `operations.dealer_compliance.review` — record dealer compliance decisions

Derived from `platformRole`/`baseRole` only; proven sessions only; UI consumes server-derived `allowed_actions` and grants nothing. Tenant admin gets none of these. No public signup path can reach any of them.

## Explicit re-open tripwires (from M8)

If during O2 any of these becomes true, STOP and document the evidence before building:

- a reviewer needs a queue spanning two domains in one surface → Work Index evidence memo
- a specialist must hold ONE capability without full admin → capability-grants evidence memo
- a second domain needs a real SLA clock → `computeSlaState` extraction memo

## Merge rule

Do not merge. Stop at a certified O2 candidate for Product Owner review, exactly as the Serena slice did.

## Post-core expansion (added 2026-09-03, head `90c50cc0`)

> **O2 Core Operations P0–P6 + P1-C are implemented/certified. P7 staging certification remains
> blocked. The Identity/Onboarding Expansion is a new governed extension of that existing O2
> foundation, not a restart of O2.**

- Canonical expansion plan: `CARUP_OPERATIONS_O2_IDENTITY_ONBOARDING_EXPANSION_PLAN.md` (this
  directory — deliberately NO second O2 documentation hierarchy is created).
- Expansion planning does not reopen completed phases. P0–P7 above keep their numbering, meaning
  and evidence unchanged; this section is additive.
- Expansion work receives its own phase namespace so core and expansion can never be conflated:
  **X0** expansion discovery/design · **X1** Document Intelligence authority reconciliation ·
  **X2** registration + Progressive Trust · **X3** identity lifecycle/account security ·
  **X4** biometrics/consent · **X5** Dealer onboarding + workbook migration ·
  **X5A** stakeholder workbook catalogue + AI intake workspace ·
  **X6** cross-domain assurance/Communications · **X7** intelligence and integrated certification.
- **X5A deliverable + gate (added 2026-09-04, head `0d1a3a74`):** an exhaustive, repo-backed
  stakeholder catalogue with a disposition for EVERY stakeholder; a canonical workbook field
  registry; stakeholder-scoped Template / Export / Import / Recent Imports on the existing
  governed engine (no second importer, no second history store); and the visible CarUp AI
  Workbook Assistant (AI proposes/explains/checks — authoritative services decide). Gate:
  documentation committed BEFORE code; exposure server-derived and adversarially tested;
  Seller/Dealer workbook covers the current user-enterable contract with a drift-fails-loudly
  completeness test; successful import removes duplicate web entry; full regression green.
  Plan: `CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_PLAN.md`; manual:
  `CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md`.
- **X6 deliverable + gate (added 2026-09-04, head `fdeab872`):** one canonical
  `identity_assurance.v1` projection (derived at read time from the X3 lifecycle + 7C history;
  no copied flags, no shadow store) consumed by registration, dealer onboarding and the
  operations people review; the O2 semantic event catalogue (identity lifecycle changes,
  batched dealer evidence requirements, seller-authority supersession, workbook import
  results) emitted from authoritative writes into the existing outbox with bounded
  Communications wiring (allowlist + policy + template only — delivery untouched). Gate:
  docs-first commit; 32-row assurance + Communications roll-call complete and
  machine-checked; privacy-safe payloads proven; canonical who_must_act total; assurance
  grants nothing; full regression green. Plan:
  `CARUP_OPERATIONS_O2_X6_ASSURANCE_COMMUNICATIONS_PLAN.md`.
- **Post-#194 reconciliation (2026-09-04):** #194 landed at `bb9d9900`; O2 reconciled onto the
  accepted base by manifest-driven merge (`7b9e8907` → certified candidate). The convergence/
  mixed-base hazard that blocked P7's base question is CLOSED; P7's remaining entry conditions
  are the authorization-gated ones (DDL parity for the six O2 migrations, fixture approval,
  pairing). Receipt: `CARUP_OPERATIONS_O2_POST_PR194_RECONCILIATION_RECEIPT.md`.
- P7 remains governed by its own note in the tracker; nothing in the expansion may run it early.
