# O2-X6 — Cross-Domain Identity Assurance + Communications Semantics: Certification Receipt

- **Branch:** `feat/operations-o2-people-compliance` · **Date:** 2026-09-04
- **Starting SHA:** `fdeab872` (X5A accepted) · **Docs-first gate:** `07222eb3` (+ SHA record
  `2c36da53`) — committed BEFORE any product code.
- **Code + receipt commit:** `d60b03f2` (one lane this phase — 19 files, +1140; the receipt and
  closed roll-call travel with the code they certify; the docs-first GATE stayed its own
  earlier commit).
- **Scope:** X6 ONLY — X7 not started; **P7 remains BLOCKED / NOT EXECUTED**; **LIVE BIOMETRIC
  PROVIDER remains NOT ACTIVATED**; do-not-merge stands.

## 1. The assurance contract (shipped as designed)

`identity_assurance.v1` — `backend/services/identity/identityAssuranceService.js`,
`getIdentityAssurance(client, userId)`: derived at read time from the authoritative X3
lifecycle (which gained additive `approved_at` + `document_expiry` so expiry keeps ONE
deriver) composed with the pending-review session phase. Five levels (`not_established ·
pending · established · reverification_required · unusable` — no numeric score; the retired
X1 tier model stays retired); history ≠ present (`historically_verified`/`verified_at`
coexist with a current requirement); honest freshness (`not_applicable · no_expiry_recorded ·
within_recorded_validity · expired` — unknown stays unknown); canonical `who_must_act`
verbatim; consumer-safe fields only (serialization-scanned: no OCR, no document numbers, no
session ids, no scores, no notes, no paths); `users.is_verified` (the EMAIL flag) is
pin-proven never read. **Derive, don't copy:** no `identity_verified` flag landed anywhere;
no cache/shadow table exists.

**Assurance ≠ authentication:** X3 step-up untouched; a verified person on an ordinary
session still fails step-up gates (X3 suites re-proven green at this head).

## 2. Consumers actually migrated

| Consumer | Change | Proof |
|---|---|---|
| Registration journey | ONE `identityFacts` source replaces the duplicated capability set / double who_must_act / hand-copied lifecycle fields; response shape preserved; additive top-level `identity_assurance` | X2/X3 suites 34/34; source pin: `getCurrentIdentityLifecycle` no longer imported |
| Dealer onboarding | `responsible_person_identity` sourced from the projection (X5 keys kept + `assurance_level`, `historically_verified`, `policy_version`); + batched `action_summary` | dealer suites 34/34; leak pin: no session ids/expiry internals exposed |
| Operations people review | additive `identity_assurance` block | P3 suite 10/10 incl. quarantine leak test |
| Workbook tools | UNCHANGED by policy (no identity gate on safe preparation); forged actor-carried assurance unlocks nothing | roll-call suite pin |
| Seller lane | inventory-proven ZERO person-identity interpretation sites — contract recorded only; assurance never grants Seller Authority | source pins on the authority services |
| Service Network | **DEFERRED — SERVICE NETWORK RECONCILIATION REQUIRED** (contracts recorded for mechanic/responsible-person/garage-principal identity) | catalogue §10 rows 9–10 |

## 3. Stakeholder assurance roll-call (catalogue §10 — machine-checked)

**32/32 rows, each with one assurance AND one Communications disposition** (test-parsed):
assurance — 3 CONSUMER (registration/seller journey, dealer responsible person, ops readers —
implemented) · 12 CONSUMER_CONDITIONAL (contracts recorded at named gates) · 2 NONE_TODAY ·
8 NOT_APPLICABLE (incl. every machine actor) · 3 DEFERRED (garage/mechanic on PR #197; fleet)
· 3 INTERNAL_READER · 1 folded row (container operator → logistics provider). Government officers explicitly:
role/capability authorization, NEVER O2 customer identity verification. Machine/internal rows
(15, 22, 25, 29, 30, 32) pin-proven never human recipients.

## 4. Semantic event catalogue (shipped)

**Added (emitted after the authoritative durable write, best-effort, `o2_event.v1`):**
`identity.lifecycle.changed` (governed transitions; `sessions_revoked` flag; reviewer note
stays in the ledger) · `dealer.compliance.evidence_required` (ONE batched
missing-requirements message on `request_more_info`) · `seller.authority.superseded` (the
former seller is finally told; idempotent no-op re-emits nothing) ·
`workbook.import.completed` (outcome + counts).
**Corrected:** `dealer.compliance.decided` payload no longer forwards the reviewer's
free-text `reason` (a §14 violation found by inventory) — safe decision verb +
requirement key + duty instead; free text stays in the governed ledger.
**Wired (bounded, stop-condition 7):** the five types above joined
`COMMUNICATION_EVENT_TYPES` + `NOTIFICATION_POLICIES` (all `transactional`, `in_app`,
`policyChannelsOnly`, legal thread types `account`/`trust_safety`/`import`) + registered
templates — the three coordinated edits the existing listener contract requires; delivery,
channels, preferences and providers untouched. `communication-event-coverage` CI gate 9/9.
**Evaluated-and-declined (recorded with reasons):** registration/onboarding synchronous
moments · workbook mapping/dry-run synchronous moments · standalone sessions-revoked (a flag
on lifecycle.changed). **Evaluated-and-deferred (named dependencies):** compliance-expiry and
document-expiry warning events (need a scheduled evaluation lane; none may be created here) ·
all biometric events (provider NOT ACTIVATED — no fake "biometric verified" ever).

## 5. Communications stakeholder roll-call

Catalogue §10's comms column, reconciled by test with
`communicationStakeholderContracts`: workflow names valid; regulated workflows
(insurance/finance/government_public_service/trust_safety) marked REGULATED on every carrying
row (⇒ AI draft-only, marketing prohibited); `emailStakeholderMatrix` untouched; **zero
marketing expansion** (all five new policies are `transactional`; the roll-call may mention
marketing only to bound it — pinned). Tenant/participant scoping stays the engine's existing
law; O2 events address a single recipient by server-derived `recipientUserId`.

## 6. AI role in X6

`narrateActionSummary` (safeNarrationService): deterministic sentence first; optional
injectable AI may REPHRASE; the structured summary passes through BY REFERENCE (never
re-authored); an AI answer that loses any governed item is refused; AI failure degrades to
the deterministic sentence; `ai: null` = no model call on request paths. Pinned: AI cannot
change codes, counts, statuses or `who_must_act`; AI invents no rejection reasons, no
requirements, no assurance, no recipients.

## 7. Privacy protections (proven)

Projection serialization scan (no OCR/id-number/selfie/score/note/session-id/storage) ·
per-emitter payload scans (no `note`, no forwarded free-text `reason`, no artifacts) ·
emit-only source scan across all six O2 lanes (no provider calls, no `notification_queue`
writes) · the dealer overview exposure pin. Named out-of-lane residuals recorded in the
discovery addendum (auth token URLs in queue payloads; diaspora rendered-copy events;
`is_verified` naming inconsistency) — not X6's to fix.

## 8. Dealer-activation dependency (§19)

The inventory confirms no canonical applicant→active-Dealer path exists anywhere (no event,
no listener, no writer). X6 invented nothing: no silent role grant, no minted tenant
membership. The contract a future governed activation needs now exists
(responsible-person assurance + privacy-safe `dealer.compliance.decided`); the decision
itself remains an explicit **Product Owner dependency**, unchanged since X5.

## 9. Tests

- New X6 suites **24/24**: identity-assurance 10 · events 7 · roll-call 7.
- Targeted regression batch **319/319** (X6 ×3, comms coverage/engine/outbox-dedupe, X2 ×2,
  X3 ×3, X5 ×2, X5A ×3, dealer ×2, P1-C review + adversarial, former-seller, supersession).
- **Full backend suite: 5930 tests — 5909 pass / 0 fail / 21 skipped** (X5A baseline 5906 +
  exactly the 24 new X6 tests). One interim full-run failure was traced and fixed honestly:
  the eager `eventBusService` import added to `sellerAuthorityService` chained the eager
  supabase client into canonical Trust's env-free import graph, tripping the Issue #164
  fail-fast pin — the emit import is now LAZY (loaded at emit time), the pin and every
  affected suite re-proven green, then this certifying rerun.
- **Full web suite: 1585/1585 — unchanged** (X6 is backend-only by design — response shapes preserved,
  additions additive; the web surfaces continue to render state/next action/locked
  capabilities from the same fields, now canonically sourced).
- `tsc --noEmit` clean · lint gate **NET_NEW 0/0**.

## 10. Unresolved / deferred consumers

Diaspora/finance/escrow person-assurance adoption (contracts recorded at their gates) ·
Service Network trio (PR #197) · expiry-warning events (scheduler lane) · biometric events
(provider activation) · dealer activation (PO dependency).

## 11. Confirmations & recommendation

**X1–X5A remain green** at this head (targeted batches + full suite). **LIVE BIOMETRIC
PROVIDER: NOT ACTIVATED.** **P7 NOT EXECUTED** (no staging pairing, migrations, fixtures,
deploys, or UAT). Do-not-merge stands.

**X7 is safe to begin** — the expansion now has: the stakeholder register with completed
assurance + Communications roll-calls (catalogue §2+§10, machine-checked), one assurance
projection with live consumers, a semantic event catalogue wired end-to-end, and green
certification across every prior phase. X7's integrated certification should roll-call
catalogue §2/§10 row by row; P7 remains its own blocked gate (PR #194) and is NOT unblocked
by anything in X6.
