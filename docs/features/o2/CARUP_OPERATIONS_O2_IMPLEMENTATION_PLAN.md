# O2 — People & Compliance Operations: Implementation Plan

- **Branch:** `feat/operations-o2-people-compliance` (cut from the integrated candidate `dd94c56d` / docs head `33720d79`)
- **Date:** 2026-09-03
- **Status:** DESIGN — no product code yet
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
