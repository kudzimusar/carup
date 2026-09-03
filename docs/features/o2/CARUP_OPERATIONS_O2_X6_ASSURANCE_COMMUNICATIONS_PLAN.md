# O2-X6 — Cross-Domain Identity Assurance + Communications Semantics: Plan & Certification Contract

- **Branch:** `feat/operations-o2-people-compliance` · **Starting head:** `fdeab872` (X5A accepted)
- **Date opened:** 2026-09-04 · **Scope:** X6 ONLY — X7 not started; **P7 remains BLOCKED / NOT
  EXECUTED**; **live biometric provider remains NOT ACTIVATED**; do-not-merge stands.
- **Binding register:** `CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md` §2 — the 32-row
  stakeholder universe. X6 records exactly one assurance disposition AND one Communications
  disposition per row (the X6 roll-call section added to that manual); no row may be silently
  absent. That section becomes the roll-call X7 certifies.

## The governing models

```
7C historical verification + X3 current identity lifecycle + verification freshness
    → O2 identity assurance projection
    → downstream domain reads assurance
    → domain applies its OWN authority rules
```
```
O2/domain state change → semantic domain event → canonical Communications
    → channel/delivery/preferences/templates
```
O2 never sends email/WhatsApp/SMS/push directly (inventory-proven already clean for every O2
lane). **Assurance is NOT authentication**: identity assurance answers "how strongly and how
recently has CarUp established this person's identity, and is it currently usable?";
authentication assurance (X3 step-up) answers "how strongly has this session authenticated this
actor for this action?" — never combined; a strongly verified person on an ordinary session
still fails a step-up gate.

## The assurance contract (`identity_assurance.v1`)

One canonical projection service in the identity domain —
`backend/services/identity/identityAssuranceService.js`, `getIdentityAssurance(client, userId)`
— DERIVED at read time by composing the authoritative `getCurrentIdentityLifecycle` (X3, the one
deriver of lifecycle + document-expiry overlay) with the active verification-session phase.
**Derive, do not copy:** no `identity_verified` flag lands on any dealer/seller/garage/finance/
insurance/workbook profile; no shadow truth table; no cache in v1 (if one is ever needed it gets
one canonical writer + provenance stamps, by plan amendment).

Consumer-safe fields (nothing else):

```
subject_user_id · policy_version ('identity_assurance.v1') · evaluated_at
assurance_level                  — not_established | pending | established |
                                   reverification_required | unusable
identity_state                   — the X3 EFFECTIVE lifecycle state (expiry overlay applied)
current_lifecycle_state          — the raw ledger state (history ≠ present, preserved)
historically_verified            — boolean (a past 7C approval exists)
verified_at                      — latest approval instant, or null
freshness_state                  — not_applicable | no_expiry_recorded |
                                   within_recorded_validity | expired
document_expiry                  — { recorded: bool, expires_at: iso|null }
reverification_required          — boolean
usable_for_identity_gated_actions— boolean (capability-bearing effective state)
who_must_act                     — the canonical 6-value vocabulary, verbatim from X3
reason_code / applicant_guidance — applicant-safe only
pending_review                   — boolean (an undecided verification session exists)
```

**Never exposed:** ID/passport numbers, selfies, biometric scores, OCR payloads, reviewer
notes, evidence paths/URLs, session internals, anti-fraud detail. `users.is_verified` is the
EMAIL flag and is never read by the projection.

**Level mapping (total, justified by the five consumer questions — no numeric score, and the
retired X1 six-tier model stays retired):** `established` ⇐ effective state ∈
{verified, recovered}; `reverification_required` ⇐ effective reverification_required (reviewer
transition OR the derived expiry overlay — "approved historically" coexists with "currently
reverification required" via `historically_verified`+`verified_at` alongside);
`unusable` ⇐ effective ∈ {suspended, compromised, disputed, revoked} (fails closed for every
identity-gated capability); `pending` ⇐ not capability-bearing AND an undecided session is in
flight; `not_established` ⇐ everything else.

**Freshness from real facts only (§8):** `verified_at` from the approval row;
`document_expiry` from the SAME X3 overlay that already parses the approved document's recorded
expiry (the lifecycle service gains additive `approved_at` + `document_expiry` fields so expiry
keeps exactly ONE deriver); no fabricated windows — an established identity with no recorded
expiry is honestly `no_expiry_recorded`, never "fresh for N days".

## First live consumers (inventory-grounded)

| Consumer | Today (duplication found) | X6 change |
|---|---|---|
| **A. Registration journey** (`registrationJourneyService.js`) | re-derives capability/approval, hand-rolls a second CAPABILITY_BEARING set, re-derives who_must_act twice, hand-copies 5 lifecycle fields (§5 of the discovery addendum, with line cites) | consume `getIdentityAssurance` as the single identity interpretation; response SHAPE preserved (X2/X3 pins stay green); UI still shows state, next action, locked/unlocked capabilities |
| **B. Dealer onboarding** (`dealerOnboardingService.js`) | `responsible_person_identity` hand-picks 4 lifecycle fields | source the block from the projection (same 4 keys + `assurance_level`, `historically_verified`, `policy_version`); Dealer Compliance stays separate — assurance never marks it approved |
| **C. Workbook tools** | no identity gate on safe preparation (deliberate X5A stance) | UNCHANGED by policy — recorded; plus a forged-assurance pin: actor-carried assurance-like fields change catalogue eligibility not at all |
| **D. Seller lane** | inventory-proven: ZERO person-identity interpretation sites (gates are vehicle-evidence/relationship) | no code change — the contract is RECORDED (a future person-gate consumes the projection, never invents a flag); assurance never grants Seller Authority (pinned) |
| **E. Service Network** | absent on branch | **DEFERRED — SERVICE NETWORK RECONCILIATION REQUIRED** (contract recorded for mechanic / responsible person / garage principal identity) |
| **F. Operations people review** (`peopleComplianceReadModel.js`) | reads `is_verified` + sessions, never the lifecycle ledger | ADDITIVE `identity_assurance` block from the projection (existing fields untouched; P3 pins stay green) |

## Semantic event catalogue (after the §12 inventory — no duplicate names)

Existing O2-relevant events (KEPT, never re-minted): `identity.verification.decided` (full
chain: emit→subscribe→policy→template) · `seller.authority.decided` (full chain) ·
`dealer.compliance.decided`, `dealer.onboarding.started`, `dealer.compliance.document.received`
(emitted, unconsumed) · `identity.biometric.consent.granted`, `identity.biometric.assessed`
(emitted, unconsumed) · `user.email.verified` · `evidence.review.decided` · trust/transfer/
marketplace/finance/diaspora families (other lanes).

**X6 additions (emitted AFTER the authoritative durable write, best-effort like every O2 emit):**

| Event | Emitted from | Fires when | Consumer wiring |
|---|---|---|---|
| `identity.lifecycle.changed` | `transitionIdentityLifecycle` after ledger+audit | reviewer-governed transition (suspended/compromised/disputed/revoked/reverification_required); payload flags `sessions_revoked` when compromise cascaded | YES — subscribe + policy (`account` thread, in_app, transactional) + template `identity_lifecycle_v1` |
| `dealer.compliance.evidence_required` | `recordDecision` after the decided emit | a `request_more_info` decision — carries the BATCHED missing-requirements action summary (§15) | YES — `trust_safety` thread, in_app, template `dealer_evidence_required_v1` |
| `seller.authority.superseded` | `supersedeSellerAuthorityOnOwnershipTransfer` after audit-first revocation | a completed transfer ends the former seller's authority (today: invisible to them) | YES — `trust_safety` thread, in_app, template `seller_authority_superseded_v1` |
| `workbook.import.completed` | `executeVehicleWorkbookImport` after receipts+batch update | execution finished (payload outcome IMPORTED / PARTIALLY_IMPORTED + counts) | YES — `import` thread, in_app, template `workbook_import_result_v1` |

**Bounded existing-listener integration (stop-condition 7):** `dealer.compliance.decided` gains
its missing consumer wiring (subscribe + policy + template `dealer_compliance_decision_v1`) —
and its payload is privacy-corrected: the reviewer's free-text `reason` (a §14 violation) is
replaced by the safe `decision` verb + `requirement_key`; free text stays in the governed
ledger where it belongs.

**Evaluated and DECLINED (with reasons, per §13's "evaluate"):** onboarding-started /
profile-required / evidence-required / case-submitted / confirmation-required registration
events (synchronous UI moments — the user is present; `identity.verification.decided` covers
the async reviewer outcome) · workbook mapping-confirmation-required + dry-run-ready
(synchronous — the importer is mid-flow) · a blocked dry run (shown live in the workspace) ·
standalone sessions-revoked (carried as a flag on `identity.lifecycle.changed`) · per-cell/
per-document spam events. **Evaluated and DEFERRED (named dependency):**
`dealer.compliance.expiring` + expiry-driven reverification notice (both need a scheduled
evaluation lane — no scheduler exists and none may be created here) · biometric
consent-required / retry / manual-review events (LIVE PROVIDER NOT ACTIVATED — no biometric
comms until activation; no fake "biometric verified" event ever).

**Payload law (§14), every X6 event:** `event_type`, subject (`userId`/`recipientUserId`),
domain resource id, safe status, `who_must_act` (canonical 6 values, total), safe reason/action
code, `occurred_at`, `schema_version: 'o2_event.v1'`, and — via the existing outbox — event id;
NEVER identity documents, biometric scores, banking data, OCR payloads, evidence URLs/paths,
reviewer free text, or rendered message copy (the diaspora rendered-copy pattern is a named
anti-precedent).

## Missing-items batching (§15)

`buildDealerActionSummary` (dealer domain): the outstanding requirement keys + safe labels +
`who_must_act` as ONE structured summary — exposed on the onboarding overview and carried in
`dealer.compliance.evidence_required`, so Communications can say "We still need: A · B · C" in
one message. Registration already carries a single batched `required_action`/steps projection
(X2) — recorded as satisfied. Compliance logic stays in the domain; templates only render.

## AI in X6 (§18)

`narrateActionSummary(summary, {ai})` — a small operations-side helper: DETERMINISTIC sentence
from the structured codes first; optional injectable AI may rephrase for friendliness; the
structured facts pass through VERBATIM alongside the narrative and the pin proves AI cannot
alter codes, statuses, or `who_must_act`. AI never invents rejection reasons, requirements,
assurance, event truth, or recipient/channel eligibility. AI failure → the deterministic
sentence stands.

## Dealer activation dependency (§19)

The event inventory confirms NO canonical applicant→active-Dealer relationship path exists
(nothing emits or listens for an activation; the only dealer authority writes are the
compliance ledger). X6 does NOT invent it: no silent `users.role='dealer'`, no minted tenant
membership. X6 defines the contract a future governed activation needs — the assurance
projection for the responsible person + the `dealer.compliance.decided` semantics — and the
dependency stays an explicit Product Owner item, restated in the receipt.

## who_must_act (§16)

Only `none · platform_processing · carup_review · subject_action · external_authority ·
escalated` — assurance projections and event payloads carry the same canonical values; no
`dealer_action`/`customer_action`/`AI_action` anywhere (pinned total).

---

## Stage A checklist

- [x] A1 This plan authored (contract, levels, freshness, consumers, event catalogue with
      add/decline/defer dispositions, payload law, batching, AI bounds, dealer dependency)
- [x] A2 Catalogue manual gains the X6 roll-call section: 32 rows × (assurance disposition ·
      Communications disposition · status · dependency) — none absent
- [x] A3 Expansion plan + implementation plan + discovery (X6 addendum: outbox mechanics, gaps,
      emit-only cleanliness, named residuals) + matrices (X6 assurance/event/consumer matrices)
      + progress (X6.1–X6.10 live roll-call) + who-must-act (X6 note) updated
- [x] A4 Docs-only gate commit BEFORE code — SHA recorded below

**Stage A docs commit:** `07222eb3` — docs-only, before any product code (8 files, +390)

## Stage B checklist (close only with evidence)

- [ ] B1 `identityAssuranceService.js` — the contract above; lifecycle service gains additive
      `approved_at` + `document_expiry` (X3 suites green)
- [ ] B2 Registration journey consumes the projection (shape preserved; X2/X3 pins green)
- [ ] B3 Dealer onboarding consumes the projection; `buildDealerActionSummary` +
      `narrateActionSummary` on the overview
- [ ] B4 Operations people read model: additive `identity_assurance` block (P3 pins green)
- [ ] B5 Events emitted from authoritative writes: `identity.lifecycle.changed` ·
      `dealer.compliance.evidence_required` · `seller.authority.superseded` ·
      `workbook.import.completed`; `dealer.compliance.decided` payload privacy-corrected
- [ ] B6 Bounded Communications wiring: allowlist + policy + template for the five types above
      (coverage CI test green; classifications explicit; thread types from the DB CHECK list)
- [ ] B7 No-grant pins: assurance grants no Seller Authority, no Dealer Compliance, no Vehicle
      Trust, no workbook escalation (forged assurance inert)
- [ ] B8 Privacy pins: assurance payload artifact-free; every event payload prohibited-field-free
- [ ] B9 32-row roll-call machine-checked (test parses the catalogue X6 section; comms
      dispositions reconciled with `communicationStakeholderContracts`; machine actors never
      human recipients; regulated flags correct; no marketing expansion)
- [ ] B10 Full certification: new suites green · X1–X5A batches green · full backend · full web
      · tsc · lint NET_NEW 0/0
- [ ] B11 Receipt `CARUP_OPERATIONS_O2_X6_ASSURANCE_COMMUNICATIONS_RECEIPT.md`; docs live
      throughout; STOP before X7

## Certification contract — the 28 proofs (task §20)

1 canonical projection exists · 2 history ≠ current preserved · 3 reverification fails closed ·
4 no Seller Authority grant · 5 no Dealer Compliance grant · 6 no Vehicle Trust change ·
7 no raw artifacts in assurance · 8 dealer consumes canonical · 9 registration consumes
canonical · 10 forged workbook assurance inert · 11 events after authoritative state ·
12 no duplicate semantic events · 13 payloads sensitive-field-free · 14 who_must_act canonical
+ total · 15 Communications receives semantic events only · 16 no O2 delivery-provider calls ·
17 missing-item summary from domain facts · 18 AI cannot change structured truth · 19 32-row
Communications coverage · 20 machine actors excluded · 21 tenant isolation · 22 regulated
classification correct · 23 X5A suites green · 24 X1–X5 green · 25 P1/P1-C green · 26 full
suites green · 27 tsc clean · 28 lint NET_NEW 0/0.

## Stop condition

X6 closes only when the 13 conditions of the task's stop list hold; then STOP for Product
Owner review. **Do not merge. Do not begin X7 or P7.**
