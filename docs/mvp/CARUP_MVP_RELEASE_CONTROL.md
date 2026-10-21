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

**Implementer evidence state:** `READY_FOR_MODERATOR / OWNER UAT REVIEW`.

The product candidate remains frozen. Evidence-only and documentation commits after it do not change the shipped product tree.

| Area | Current evidence state | Exact evidence |
|---|---|---|
| Product candidate | **FROZEN** | `88bffa50b34d81cdeb1f13f2c90bfb957190c732`; 69 commits ahead / 0 behind `0fc425a9`; 171 changed files; no database or migration files |
| Fully tested parent | **PASS evidence** | `6b678c5f82d168e89c5bb5b71a61a05eda14cc7d`; the final product delta is four Native F-040 files |
| Full local suites | **PASS receipt** | backend 9138 tests / 0 failures with 9 inherited cancellations; web 304 files / 3148 tests; Native 330 tests; 30 database/ledger harnesses; lint no net-new findings |
| Exact-SHA staging certification | **PASS 40/40** | run `39607555572`; artifact `12348897183`; digest `sha256:e67ee3cc522224d3204a573bd19474ca08c1274ea89f646db53aeabafaaff0a4` |
| Candidate APK runtime | **PASS** | run `39607550267`, attempt 2; job `119262615117`; true Expo/React Native, build/install/cold launch/login/register/full restart, no CarUp fatal runtime |
| Final APK | **CUSTODIED** | SHA-256 `6a5c056f2e26fd17625db79ac5b661a104136e915b98d148f729ef2a38b75415`; 108894116 bytes; artifact `12352064023`; artifact digest `sha256:2b0920ed55b124b831887c2ba2d076982fbc086a5b309c6cb4fd8e0fdec6ba0a` |
| APK runtime evidence | **PASS** | artifact `12352014086`; digest `sha256:7067e267347aba320a720845c4874546e4abb24f37e9706c9621a9fd1ddc6d24` |
| SafePay / preference failed-read truth | **PASS** | run `39687174054`; SafePay = Not available/no numeric zero; preference switches = 0; PATCH requests = 0; session revoked |
| Web truth artifact | **PASS** | artifact `12387410776`; digest `sha256:2274bb989b736aa24c97197d6546afeb6bbc2f95c002f6fe8def586f558898e6` |
| Final Native Trust / delivery / Inbox visuals | **PASS** | sanitized run `39688449357`; artifact `12387332691`; digest `sha256:53c36334f845d38f62be24939eb56aaa4d713006eb05b0b782fd1b812deff54a` |
| Native Send | **NOT REPEATED** | visual proof explicitly records `native_send_performed=NO`; existing exactly-once proof remains authoritative |
| Disposable test sessions | **CLEAN** | CARUP-MVP-STAB-01 staging-only session sweep readback = 0 active |
| Serena reconciliation truth | **READ-ONLY PROVEN** | 37 inquiries / 34 exact inquiry-linked conversations / 3 historical unmatched inquiries; no reconciliation mutation applied |
| Physical Native Owner UAT | **REQUIRED** | emulator evidence is not physical Owner acceptance |
| Hosted PR-only `ci.yml` | **NOT RUN** | no PR has been opened; pre-merge/release evidence item, not a blocker to Owner physical UAT |
| Production | **BLOCKED / UNTOUCHED** | Gate F legal approval remains blocked; Production Supabase remains forbidden |
| Canonical staging aliases | **UNMOVED** | immutable Preview pair only |

```text
CLIENT_MVP_TECHNICAL_READINESS = READY_FOR_OWNER_UAT
PHYSICAL_OWNER_NATIVE_UAT = REQUIRED
PRODUCTION_RELEASE_READINESS = BLOCKED
LEGAL_RELEASE_GATE = BLOCKED_OWNER_LEGAL_APPROVAL
PRODUCTION_TOUCHED = NO
CANONICAL_ALIASES_MOVED = NO
```

## 9. Candidate record

| Field | Value |
|---|---|
| Product candidate SHA | `88bffa50b34d81cdeb1f13f2c90bfb957190c732` |
| Base authority | `0fc425a997e1e2e02a039e728dcd5ee90f5fd936` |
| Product ahead / behind | 69 / 0 |
| Product changed files | 171 |
| Database / migration changes | none |
| Backend immutable Preview | `https://carup-backend-staging-lmnyhj874-11-11.vercel.app` |
| Backend deployment | `dpl_EUKJZc8MbtNx1nPhM9AKsZi5hkHE` |
| Web immutable Preview | `https://carup-staging-mn3bx7ymb-11-11.vercel.app` |
| Staging Supabase | `eoyenigwevnxwwhyhaer` |
| Communications kill switch | active; external sends disabled |
| Candidate APK SHA-256 | `6a5c056f2e26fd17625db79ac5b661a104136e915b98d148f729ef2a38b75415` |
| Candidate APK size | `108894116` bytes |
| APK artifact | `12352064023` / `sha256:2b0920ed55b124b831887c2ba2d076982fbc086a5b309c6cb4fd8e0fdec6ba0a` |
| Runtime evidence artifact | `12352014086` / `sha256:7067e267347aba320a720845c4874546e4abb24f37e9706c9621a9fd1ddc6d24` |
| Staging certification artifact | `12348897183` / `sha256:e67ee3cc522224d3204a573bd19474ca08c1274ea89f646db53aeabafaaff0a4` |
| Web truth artifact | `12387410776` / `sha256:2274bb989b736aa24c97197d6546afeb6bbc2f95c002f6fe8def586f558898e6` |
| Native visual artifact | `12387332691` / `sha256:53c36334f845d38f62be24939eb56aaa4d713006eb05b0b782fd1b812deff54a` |
| Canonical aliases moved | NO |
| Production touched | NO |
| Owner credentials used | NO |
| Native Send repeated | NO |
| Staging rows deleted | 0 |

### Final Native runtime proof

Run `39607550267` attempt 2 supersedes the interrupted first attempt for final APK custody. It proves exact source, true Expo/React Native authority, exact immutable staging backend baked into the APK, build/install/cold launch/login/register/full restart PASS, no CarUp fatal runtime exception, and `runtime_complete=YES`.

### Final Native visual proof

Sanitized run `39688449357` proves Serena Trust (60/100, Moderate, Confidence Low, Evidence support 0 of 7, Connected official sources 0), Native delivery settings (Push/WhatsApp/Telegram/Email = Setup pending), truthful F-040 Inbox wording, no Native Send, and product-path sign-out. The final artifact contains no runtime credential file.

## 10. Release-gate roll-up

| Gate | Implementer position | Reason |
|---|---|---|
| Gate A — Identity & Access | evidence-backed, pending moderator disposition | registration/session/logout/x-user-id denial have exact-SHA evidence |
| Gate B — Data & Integrity | evidence-backed for Owner UAT | exactly-once inquiry + canonical conversation creation proven; 3 historical Serena inquiries remain quarantined/read-only |
| Gate C — Commerce & Finance | evidence-backed, pending moderator disposition | Seller lifecycle and SafePay truthful success/failure states proven |
| Gate D — Security | evidence-backed, pending moderator disposition | external sends disabled; disposable evidence sessions revoked; Production untouched |
| Gate E — Operations | evidence-backed, pending moderator disposition | immutable candidate, APK custody, restart/runtime evidence and cleanup receipts exist |
| Gate F — Governance | **BLOCKED** | Owner/legal approval outstanding |
| Gate G — Product Control | evidence-backed, pending moderator disposition | responsive/browser evidence plus final Native Trust/readiness/F-040 visuals are present |

The register remains an implementer/evidence record; the certification moderator issues the formal disposition.

## 11. Findings disposition policy

Repaired findings remain `REMEDIATED_PENDING_VERIFICATION` in the implementation register until moderator disposition. `BLOCKED` remains reserved for Owner, legal or external-provider gates. The handoff's F-033/F-034/F-035 container-policy questions and F-036 spec-45 date question remain Owner/moderator decisions because their original records are not present in this branch.

## 12. Remaining work after technical evidence closure

1. Owner physical UAT against this exact APK and immutable Preview pair.
2. Do not repeat Native Send merely to refresh evidence.
3. Keep historical inquiry reconciliation read-only unless separately authorized.
4. Before merge/release, open the appropriate PR so PR-only `ci.yml` executes and is reviewed.
5. Gate F / Terms / Privacy require Owner/legal approval before Production certification.
6. Production deployment, Production DB access and canonical alias movement remain separate release authorities.

## 13. Known non-product blockers / deferrals

- `BLOCKED_MECHANIC_ACTIVATION_MODEL`.
- Garage successful approval proof requires a legitimately approved applicant identity.
- `BLOCKED_OWNER_LEGAL_APPROVAL`.
- Container policy F-033/F-034/F-035 and spec-45/F-036 remain Owner/moderator decisions.
- Staging reconciliation apply is not authorized.
- Hosted PR-only `ci.yml` remains not run until a PR is deliberately opened.
