# O2 — "Who must act next" normalization matrix

The first cross-domain contract from the M8 ADR, applied. **The ADR vocabulary is used verbatim —
no new names.** The projection is DERIVED at read time from domain-owned state; nothing is
persisted, no generic table exists, and each domain's own vocabulary remains canonical inside that
domain (M8 §10.1: existing domains are not migrated).

## Canonical vocabulary (ADR §10.1, verbatim)

```
none · platform_processing · carup_review · subject_action · external_authority · escalated
```

An SLA clock, if one ever exists here, may run only in `carup_review` (ADR §6). Nothing in O2
introduces a clock — age + timestamps only (M8 default).

## Identity Verification → projection

| Domain state (`WORKFLOW_PHASE`, caseWorkflow.js) | Projected `who_must_act` |
|---|---|
| `SYSTEM_PROCESSING` | `platform_processing` |
| `REVIEWER_ACTION_REQUIRED` | `carup_review` |
| `APPLICANT_ACTION_REQUIRED` (incl. after `RESUBMISSION_REQUESTED`) | `subject_action` |
| `ESCALATED` | `escalated` |
| `RESOLVED_APPROVED` / `RESOLVED_REJECTED` / `CANCELLED` | `none` |

No identity state maps to `external_authority` today — identity review has no external registry
wait. If a government identity registry integration arrives (O9 territory), it maps there; that is
a projection change, not a schema change.

## Seller Authority → projection

| `vehicle_seller_authority.status` | Projected |
|---|---|
| `evidence_submitted` | `carup_review` |
| `under_review` | `carup_review` |
| `confirmed` | `none` |
| `insufficient` | `subject_action` (the seller must supply the missing evidence) |
| `disputed` | `escalated` |
| `revoked` | `none` (a superseded/withdrawn authority asks nothing of anyone; a NEW claim starts a new row) |
| no row (`not_assessed`) | `subject_action` if the seller wants to list; `none` otherwise — projected as `subject_action` only in a listing context |

## Dealer Compliance → projection

| Domain state | Projected |
|---|---|
| `pending` profile, or any blocking requirement unmet with no submitted document | `subject_action` |
| blocking requirement with a submitted, undecided document | `carup_review` |
| `active`, nothing blocking outstanding | `none` |
| `restricted` / `suspended` | `subject_action` (remediation is the dealer's) — with the domain status displayed verbatim beside it, never replaced |
| decision recorded as investigation | `escalated` |
| document past `deriveExpiryState` expiry | `subject_action` |

## Ownership transfer → projection (display-only within the People view)

| Transfer `state` | Projected |
|---|---|
| begun / in progress, awaiting counterparty confirmation | `subject_action` |
| awaiting governance completion (registry authority + completion reference) | `external_authority` — completion is gated on a REAL registry reference; CarUp review alone cannot finish it |
| `complete` | `none` |
| blocked by governed finance encumbrance | `external_authority` (lender settlement/release) |

## Vehicle Operations (already conformant — reference)

`completenessEvaluator.js` `ACT` → canonical: `seller`→`subject_action`, `carup_review`→`carup_review`,
`external_authority`→`external_authority`, `none`→`none`. The Vehicle Operations internal names
pre-date the ADR and stay as they are inside that domain; the O2 projection module maps them when
they appear in a People-facing context.

## Implementation shape (P2)

One pure module per domain read that already returns state — e.g. a
`toResponsibilityProjection(domainState)` beside each read model — plus one shared constants module
holding ONLY the six vocabulary strings. No table. No cross-domain store. Unit tests assert every
domain state maps to exactly one canonical value and that the mapping is total (a new domain state
without a mapping fails the test by name).

## Expansion design — proposed projections (X0; NOT current runtime state)

Proposed responsibility semantics for the Identity/Onboarding Expansion
(`CARUP_OPERATIONS_O2_IDENTITY_ONBOARDING_EXPANSION_PLAN.md`), added 2026-09-03. Everything in
this section is **expansion design for future X-phases**; the mappings above remain the only
implemented ones and are unchanged. The ADR vocabulary stays verbatim — still no new names.

| Expansion state | Proposed `who_must_act` | Note |
|---|---|---|
| OCR/extraction running | `platform_processing` | machine work on the platform's side |
| Extraction complete, awaiting user confirmation/correction | `subject_action` | the user must confirm or correct candidate values |
| Missing onboarding evidence | `subject_action` | consistent with the identity/dealer rows above |
| Biometric provider processing | `platform_processing` | a vendor processing FOR the platform is not an external AUTHORITY; `external_authority` stays reserved for registry-style waits |
| Dealer document submitted, undecided (expansion flows) | `carup_review` | unchanged from the core dealer mapping |
| Workbook mapping awaiting human confirmation | `subject_action` | the importing user confirms the advisory AI mapping before any import runs |
| External authority verification (e.g. government identity registry, future) | `external_authority` | matches the existing note under the identity projection |

## Identity lifecycle → projection (X3 — IMPLEMENTED, derived at read time)

`lifecycleToResponsibilityProjection` in `identityLifecycleService.js` — same law as every
projection above: ADR vocabulary verbatim, derived, never persisted (the dormant
`next_actor`/`required_action` session columns remain dormant by decision).

| Current lifecycle state | Projected `who_must_act` |
|---|---|
| `verified` / `recovered` | `none` |
| `reverification_required` (incl. the derived document-expiry overlay) | `subject_action` |
| `disputed` | `escalated` |
| `suspended` / `compromised` | `carup_review` |
| `revoked` | `none` (re-entry starts with a governed reviewer step, then a new evidence journey) |
| `not_established` | `none` at lifecycle grain — the onboarding journey's own projection owns the "start verifying" nudge |

## Dealer onboarding → projection (X5 — IMPLEMENTED, derived at read time)

The dealer-onboarding overview reuses the P2 dealer module (`toResponsibilityProjection` in
`dealerComplianceService.js`) — no new vocabulary, no new store, derived on every read:

| Onboarding state | Projected `who_must_act` |
|---|---|
| No application yet / blocking requirement outstanding / evidence missing | `subject_action` |
| Application + evidence submitted, Dealer Compliance undecided | `carup_review` (the core dealer mapping, unchanged) |
| Under investigation | `escalated` |
| Approved / nothing outstanding | `none` |

The overview additionally carries `responsible_person_identity.who_must_act` verbatim from the
X3 lifecycle projection above — the responsible person's identity duty is shown alongside, never
merged into, the dealer application's own duty (identity verified ≠ dealer compliant). The
X0 design rows above ("Workbook mapping awaiting human confirmation" → `subject_action`) became
real in X5: the workbook lane blocks the dry run until the human confirms the mapping, so the
outstanding duty sits with the importing user exactly as designed.

*(Repair note 2026-09-04: the X5 edit had accidentally detached the `not_established` row from
the X3 lifecycle table above; it is restored to its table — no semantics changed.)*

## Workbook intake → projection (X5A — design; same vocabulary, no new names)

The X5A Template/Export/Import/Recent-Imports workspace projects each import batch's outstanding
duty from the EXISTING ADR vocabulary — derived from batch/mapping/dry-run state at read time,
never persisted as a parallel store:

| Workbook state | Projected `who_must_act` |
|---|---|
| File uploaded, needs mapping (no confirmation for this checksum) | `subject_action` |
| AI/deterministic inspection running | `platform_processing` |
| Mapping proposed, awaiting human confirmation | `subject_action` |
| Dry run processing | `platform_processing` |
| Dry run blocked — rows need the user's correction | `subject_action` |
| Import blocked pending CarUp review (governed review of the target domain) | `carup_review` |
| External authoritative confirmation genuinely required (e.g. registry wait on the target record) | `external_authority` |
| Import executed, receipt issued, nothing outstanding | `none` |

AI assistance never changes the duty holder: an AI proposal awaiting acceptance is still
`subject_action` — the human decision IS the outstanding action.

## X6 note — assurance and events carry the SAME vocabulary (2026-09-04)

The `identity_assurance.v1` projection's `who_must_act` is the X3 lifecycle projection
verbatim, and every X6 event payload carries one of the six canonical values — total, pinned.
No `dealer_action` / `customer_action` / `AI_action` exists anywhere; an AI narration may
rephrase a sentence but can never change the `who_must_act` value it narrates (pinned).
