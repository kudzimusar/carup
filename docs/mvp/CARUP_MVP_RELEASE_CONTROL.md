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

| Area | Implementer/evidence state | Release meaning |
|---|---|---|
| Executable product candidate | **BUILT / DEPLOYED** at `88bffa50b34d81cdeb1f13f2c90bfb957190c732` | This is the immutable web/backend/native product authority under verification. |
| Candidate ancestry | **69 ahead / 0 behind** base; 171 net changed files; **0 database/migration files** | No schema mutation was introduced by this work unit. |
| Final staging certification | **SUCCESS** — GitHub Actions run `39607555572`, all 40 steps | Exact-SHA API/data journeys are evidenced; this is not moderator acceptance. |
| Web/backend staging pair | **EXACT / PAIRED** | Both immutable previews report `88bffa50b34d81cdeb1f13f2c90bfb957190c732`, staging DB `eoyenigwevnxwwhyhaer`; web provenance reports `unpaired=false`. |
| Communications | **EXTERNAL SENDS DISABLED** | Backend health reports the kill switch active. Provider readiness is blocked; in-app remains enabled. |
| Native package | **APK built, installed and cold-launched; final runtime proof incomplete** | Attempt 1 of run `39607550267` was obstructed by Android system launcher Quickstep ANR overlay. APK/product failure was not proven. |
| APK evidence harness | **REMEDIATED_PENDING_VERIFICATION** on separate branch `fix/carup-mvp-stab-01-apk-evidence-r1@c15a9e125d27c14a95d97dfdc6bd5b79a3d8f090` | Workflow-only patch adds the previously accepted bounded Quickstep recovery rule. Product authority remains `88bffa50b34d81cdeb1f13f2c90bfb957190c732`. |
| Local candidate suites | **Specialist-reported clean** | Handoff reports backend 9138 tests / 0 failures, web 3148, mobile 330, lint no new findings. These results were not independently re-executed in this release-record session. |
| Serena inquiry/conversation baseline | **37 inquiries / 34 canonical conversations / 3 historical uncanonicalized inquiries** | Point-in-time read-only staging truth after certification. No reconciliation mutation was applied. |
| Garage approval/activation | **BLOCKED_IDENTITY_PROVIDER** | Candidate correctly refuses approval when applicant identity is not established. |
| Independent mechanic activation | **BLOCKED_MECHANIC_ACTIVATION_MODEL** | Owner/moderator product decision remains required. |
| Container policy items referenced as F-033/F-034/F-035/F-036 in the continuation handoff | **BLOCKED_OWNER_POLICY / DEFINITIONS NOT MATERIALIZED IN REPO** | Do not invent the missing policy definitions. |
| Legal / Production | **BLOCKED_OWNER_LEGAL_APPROVAL** | Production certification cannot start. |
| Staging reconciliation apply | **NOT AUTHORIZED** | Read-only report exists; no row was deleted or reconciled by this work unit. |
| Hosted main CI | **NOT RUN** | `ci.yml` is PR-triggered and no PR was opened for this lane. |
| Physical-device Native proof | **NOT PERFORMED** | Native evidence is emulator evidence only. |

## 9. Candidate record

| Field | Exact value |
|---|---|
| Executable product SHA | `88bffa50b34d81cdeb1f13f2c90bfb957190c732` |
| Base authority | `0fc425a997e1e2e02a039e728dcd5ee90f5fd936` |
| Product branch | `fix/carup-mvp-stab-01-client-readiness` |
| Ahead / behind | `69 / 0` |
| Net changed files | `171` |
| Database/migration changes | `0` |
| Backend immutable preview | `https://carup-backend-staging-lmnyhj874-11-11.vercel.app` |
| Backend deployment | `dpl_EUKJZc8MbtNx1nPhM9AKsZi5hkHE` |
| Web immutable preview | `https://carup-staging-mn3bx7ymb-11-11.vercel.app` |
| Web deployment | `dpl_E4TVhhiTuWoA3XUARadEarXAZJBR` |
| Staging Supabase | `eoyenigwevnxwwhyhaer` |
| Final staging certification | run `39607555572` — SUCCESS |
| Certification artifact | `12348897183`; digest `sha256:e67ee3cc522224d3204a573bd19474ca08c1274ea89f646db53aeabafaaff0a4` |
| Candidate APK attempt-1 evidence | run `39607550267`; artifact `12350393031`; evidence zip digest `sha256:cc7e988f4cf06d4332ab2c4d9e71ca2c18071bb3ee7b8227367ad43510d9f3b5` |
| APK SHA-256 from attempt 1 | `ce022f3df8274ef64f275f38a7470f3f8dfabafa54c5eddb2c7e125ece764b0e` |
| APK size | `108894116 bytes` |
| APK package/version | `com.carup.mobile` · `1.0.0 (1)` |
| APK baked API base | `https://carup-backend-staging-lmnyhj874-11-11.vercel.app` |
| Canonical aliases moved | `NO` |
| Production touched | `NO` |
| Owner credentials used | `NO` |
| Rows deleted | `0` |

The APK attempt-1 package itself built successfully, installed successfully and cold-launched `com.carup.mobile/.MainActivity`.
Its `runtime_complete=NO` is an evidence result: the Android launcher displayed **“Quickstep isn't responding”** from
package `android`, covering CarUp during the login hierarchy probe. No CarUp ANR/crash dialog was captured.

## 10. Verification ledger

**Independently re-read in the continuation session**

- remote product branch is exactly `88bffa50b34d81cdeb1f13f2c90bfb957190c732`;
- base comparison is 69 ahead / 0 behind with 171 files and no database/migration file;
- `6b678c5f82d168e89c5bb5b71a61a05eda14cc7d → 88bffa50b34d81cdeb1f13f2c90bfb957190c732` changes exactly four Native Inbox/channel-readiness files;
- staging certification run `39607555572` completed successfully on the exact candidate;
- immutable backend health and web provenance both report the exact candidate and paired staging configuration;
- staging Serena currently reads 37 inquiry rows, 34 exact canonical conversations and 3 historical inquiries without an exact canonical conversation;
- final APK attempt 1 independently proves package custody, build, install, cold launch and the external Quickstep overlay.

**Specialist-supplied, retained but not independently re-executed here**

- full local candidate suites on `88bffa50b34d81cdeb1f13f2c90bfb957190c732`: backend 9138 / 0 failures (9 inherited cancellations), web 3148, mobile 330;
- visible-browser checks at 1440 / 900 / 768 / 653 / 390;
- authenticated Native no-write composer / one-send / Back-continuity evidence on `6b678c5f...`.
  The final four-file delta does not touch the inquiry composer, vehicle navigation, Trust screen or backend/web product code.

## 11. Evidence gaps and non-claims

| Gap | Current truthful state |
|---|---|
| `web-truth-states.mjs` | The handoff says the vault-only script was written but never run. It is not committed in this repository and depends on a local controlled session. SafePay/preferences success reads are proven; their browser **failed-read** states remain `EVIDENCE_INCOMPLETE`. |
| Final exact-head Native Send | Not repeated to avoid another inquiry on the Owner's Serena. The composer files are identical to the successful `6b678c5f...` runtime proof, but this is inherited evidence, not a new physical send. |
| Native physical device | Not performed; emulator only. |
| Inquiry reconciliation apply | Not performed; tests/service path exist but mutation requires separate moderator authority. |
| Garage approval activation | Correctly blocked without verified applicant identity. |
| Main hosted CI | Not run because no PR exists for the lane. |
| F-033/F-034/F-035/F-036 definitions | Referenced by the continuation handoff as Owner/moderator container-policy decisions, but their exact definitions are absent from the checked-in MVP records. They are not reconstructed or guessed here. |

## 12. Release-gate posture

| VAP gate | Current posture |
|---|---|
| GATE-A Identity & Access | Preserved foundation + candidate regression evidence; awaiting moderator verdict. |
| GATE-B Data & Integrity | Candidate implementation present; reconciliation apply remains separately blocked. |
| GATE-C Commerce & Finance | Buyer/Seller corrections implemented; container Owner-policy items and some failed-read browser evidence remain open. |
| GATE-D Security | Accepted foundations preserved; negative authorization evidence included in certification. |
| GATE-E Operations | Exact immutable staging pair proven; final APK runtime completion remains an evidence gate. |
| GATE-F Governance | **BLOCKED_OWNER_LEGAL_APPROVAL**. |
| GATE-G Product Control | Major MVP convergence implemented; independent-mechanic model and garage identity-provider activation remain blocked. |

## 13. Release posture

```text
EXECUTABLE_PRODUCT_SHA = 88bffa50b34d81cdeb1f13f2c90bfb957190c732
CLIENT_MVP_TECHNICAL_READINESS = NOT_READY
PRODUCTION_RELEASE_READINESS = BLOCKED
LEGAL_RELEASE_GATE = BLOCKED_OWNER_LEGAL_APPROVAL
GARAGE_APPROVAL_GATE = BLOCKED_IDENTITY_PROVIDER
MECHANIC_ACTIVATION_GATE = BLOCKED_MECHANIC_ACTIVATION_MODEL
CONTAINER_POLICY_GATE = BLOCKED_OWNER_POLICY
STAGING_RECONCILIATION_APPLIED = NO
COMMUNICATION_OUTBOUND_DISABLED = YES
CANONICAL_ALIASES_MOVED = NO
PRODUCTION_TOUCHED = NO
OWNER_CREDENTIALS_USED = NO
OWNER_UAT_PERFORMED = NO
```

`NOT_READY` is deliberate: it prevents a successful implementation sprint or a green API certification from being
misstated as client/Production acceptance while final package proof and Owner/external gates remain unresolved.
