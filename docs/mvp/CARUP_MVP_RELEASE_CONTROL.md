# CarUp Client MVP — Release Control

**Work unit:** CARUP-MVP-STAB-01 — client-ready MVP stabilization, Service Network convergence and MSCS-VAP release control
**Status of this document:** canonical operational index for the client MVP. It summarizes and points to the
authoritative product plans; it does not replace or restate them.
**Verification framework:** 11-11 Tech MSCS-VAP 1.0 (Verification & Acceptance Protocol, issued 2026-10-21) on top of
MSCS 1.0 (2026-10-20). Product plans define what CarUp means; MSCS-VAP defines how the MVP is proven.
**Implementer posture:** every state recorded here by the implementation agent is a **claim with evidence pointers**
(VAP-R01/R02). Only the certification moderator issues PASS or FAIL.

---

## 1. Authority

| Field | Value |
|---|---|
| Repository | `kudzimusar/carup` |
| Branch | `fix/carup-mvp-stab-01-client-readiness` |
| Base (start authority) | `0fc425a997e1e2e02a039e728dcd5ee90f5fd936` (OC-NATIVE-FINAL-02-R1) |
| Historical Owner-UAT parent | `05250ab08760ddbaebfea218f06c0ceddd96f79b` (OC-NATIVE-FINAL-01C) |
| Candidate | recorded in §9 and in `evidence-index.json` when the exact candidate is built |
| Staging Supabase | `eoyenigwevnxwwhyhaer` (the only database this work unit may read or write) |
| Production Supabase | `vhmnajoeicasaigiophh` — **forbidden**; never queried, never written |
| Canonical staging aliases | not moved by this work unit (`api-staging.carup.dev`, `staging.carup.dev`) |
| Communications | `COMMUNICATION_OUTBOUND_DISABLED=true` throughout; no external message is sent |

## 2. Authoritative product documents (read in this order)

| # | Document | What it governs for the MVP |
|---|---|---|
| 1 | [`DESIGN.md`](../../DESIGN.md) | Global design law: truthful data states (§8), Seller standard incl. autosave, draft preview and governed publication (§11), My Listings lifecycle actions (§13), Vehicle Detail order (§14), Verify never implies verification from absence (§15), Communications never exposes channels the runtime cannot deliver (§16), responsive contract (§10), end-to-end certification rule (§23) |
| 2 | [`docs/CARUP_MARKETPLACE_V1_CLAUDE_GOAL_LOOP_PLAN.md`](../CARUP_MARKETPLACE_V1_CLAUDE_GOAL_LOOP_PLAN.md) | Marketplace loop: backend-owned Trust summary (§6), durable inquiry with referral/campaign context (§14), audited moderation with reasons (§24), seller status explanations (§25), SafePay labels only when backed (§27) |
| 3 | [`docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md`](../seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md) | Seller lifecycle authority: `publication_status` vs commerce `status` (H7, R27), receipt-gated autosave (F1/F2/F15/F18), Buyer Preview (J15/K11/K16), My Listings counters incl. the open inquiry-vs-conversation defect (I4), Phase Q (inquiry ≠ proven conversation) |
| 4 | [`docs/seller/SELLER_MARKETPLACE_CONVERGENCE_IMPLEMENTATION_PLAN.md`](../seller/SELLER_MARKETPLACE_CONVERGENCE_IMPLEMENTATION_PLAN.md) | Lifecycle CTAs (§7), autosave honesty (§8–9), My Listings (§11), Seller Studio hydration (§12), one buyer presentation for preview (§13) |
| 5 | [`docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`](../communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md) | The CarUp conversation is the system of record (§1, §4); the exact buyer message enters the canonical conversation and the buyer submits once (§15.1, §28 Phase 2, §29); participant-based server authorization (§8); a true inbox (§24.1) |
| 6 | [`docs/features/CARUP_OPERATIONS_CONTROL_PLANE_AND_SERENA_VEHICLE_OPS_MANUAL.md`](../features/CARUP_OPERATIONS_CONTROL_PLANE_AND_SERENA_VEHICLE_OPS_MANUAL.md) | Operations authority boundaries (§7–8, G1–G4): platform authority ≠ source authority, Super Admin exceptional; audit-before-effect decision records (§23A); Serena facts (§13–14, §45); honest unavailable states (§3.2); preserve/attribute instead of delete (§33–34, §45) |
| 7 | [`docs/CARUP_FEATURE_REGISTRY_AND_NAVIGATION_MAP.md`](../CARUP_FEATURE_REGISTRY_AND_NAVIGATION_MAP.md) | Feature Registry is the single navigation source; route mirroring and access guards |
| 8 | [`docs/UNIFIED_PRODUCT_ADVANCEMENT_REPORT.md`](../UNIFIED_PRODUCT_ADVANCEMENT_REPORT.md) | Publication gate (drafts invisible), event-outbox drain that creates inquiry threads asynchronously, remaining engineering gaps |

Supporting: [`docs/one-carup/OC5E_GARAGE_ONBOARDING_COMPLETION.md`](../one-carup/OC5E_GARAGE_ONBOARDING_COMPLETION.md) (Garage onboarding authority as ported into this lineage).

## 3. MSCS-VAP mapping used by this register

- **Control IDs.** Project IDs only (`CARUP-MVP-<AREA>-NNN`). The repository contains **no MSCS control ID**, so none is
  mapped as authoritative and none is invented. Each register row may carry an *informative* reference copied verbatim
  from the MSCS 1.0 catalogue (e.g. `MKT-015 Buyer-seller communication`); it is not an adopted control.
- **Maturity.** `target_maturity = NOT_SELECTED`. No CarUp acceptance contract has formally selected M1–M4. (MSCS 1.0
  describes M1 as "MVP Ready"; that is descriptive context, not a selection.)
- **Criticality** C0–C4, **evidence** P0–P6, **depth** V1–V7, **release gates** GATE-A…GATE-G, **finding classes** and
  **severities** F0–F4 are used exactly as MSCS-VAP 1.0 §7–§12 define them.
- **Binary rule (VAP §10).** NOT TESTED, BLOCKED, UNKNOWN, EVIDENCE INCOMPLETE and STALE are not PASS.

## 4. Machine-readable control files

| File | Purpose |
|---|---|
| [`capability-register.json`](capability-register.json) | One row per MVP capability: acceptance criterion, gate, criticality, required evidence/depth, candidate, positive/negative/runtime/human proof, open finding, state, next action |
| [`findings.json`](findings.json) | VAP B5 finding records (class, severity, observed/expected, evidence, disposition) |
| [`evidence-index.json`](evidence-index.json) | VAP B12 evidence index: ID, control, candidate authority, source, timestamp (UTC from the clock), collector, integrity hash, interpretation |
| [`CARUP_MVP_CLIENT_DRY_RUN.md`](CARUP_MVP_CLIENT_DRY_RUN.md) | Executable Owner/client dry-run script with prerequisites and expected outcomes |
| [`CARUP_MVP_DEFERRED_V2.md`](CARUP_MVP_DEFERRED_V2.md) | Every intentionally postponed item with its truthful current state and invalidation rule |
| [`CARUP_MVP_LEGAL_REVIEW_PACKET.md`](CARUP_MVP_LEGAL_REVIEW_PACKET.md) | Unresolved legal/governance decisions behind Gate F |
| [`STAGING_RECONCILIATION_REPORT.md`](STAGING_RECONCILIATION_REPORT.md) | Read-only staging data reconciliation with a proposed (unapplied) mutation ledger |

## 5. Readiness fields (two separate questions)

| Field | Meaning |
|---|---|
| `CLIENT_MVP_TECHNICAL_READINESS` | Whether the exact staging candidate is technically ready for an Owner/client dry run (`READY_FOR_OWNER_UAT` / `NOT_READY`) |
| `PRODUCTION_RELEASE_READINESS` | Whether Production certification may begin. It stays `BLOCKED` while `LEGAL_RELEASE_GATE = BLOCKED_OWNER_LEGAL_APPROVAL` (Gate F), regardless of technical readiness |

## 6. Frozen accepted foundations (preserved, regression-tested, not reopened)

AUTH-05 real-session authority · atomic registration · session restoration · R6 presenting-session logout ·
revoked-session rejection · Corporate persistent authority · BE1 buyer legal ownership → My Garage ·
BE2 `transaction_intent_id` → ownership-transfer lineage · seller/`current_seller_id` separated from legal ownership ·
`x-user-id` consequential fallback denied · communications outbound kill switch · production isolation.

## 7. Database rule

`DATABASE_SCHEMA_MUTATION = NO` by default. A migration is proposed — never applied — if a consequential transition
cannot be made atomic or integrity-enforced with the existing schema (directive §24).

## 8. Current state

See §9 for the candidate and the register for per-capability state. Summary table is updated at each phase boundary.

## 9. Candidate record

_Filled when the exact candidate is built (directive §26)._
