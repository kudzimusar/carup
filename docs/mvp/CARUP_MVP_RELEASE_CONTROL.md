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

**Implementer status:** `EVIDENCE CLOSURE IN PROGRESS`. Product remediation is substantially implemented, but this
document does **not** certify the candidate. The moderator still owns acceptance.

| Area | Current implementer state | Evidence / limitation |
|---|---|---|
| Product candidate | `88bffa50b34d81cdeb1f13f2c90bfb957190c732` frozen | 69 commits ahead / 0 behind `0fc425a9`; 171 changed files; no database or migration files |
| Fully tested parent | `6b678c5f82d168e89c5bb5b71a61a05eda14cc7d` | Final product candidate differs by four Native files only, all for F-040 outside-delivery wording/readiness |
| Backend/web pair | exact-pair immutable Preview | Backend `carup-backend-staging-lmnyhj874-11-11.vercel.app`; web `carup-staging-mn3bx7ymb-11-11.vercel.app`; certification proved both at the exact product SHA and staging DB |
| Full local suites | implementation-agent receipt says clean | Backend 9138 / 0 failures (9 inherited cancellations); web 304 files / 3148 tests; Native 330 tests; 30 DB/ledger harnesses; lint no net-new findings. These local receipt files were not re-read by the moderator in this chat session |
| Exact-SHA staging certification | **40/40 steps passed** | GitHub run `39607555572`, artifact `12348897183`, digest `sha256:e67ee3cc522224d3204a573bd19474ca08c1274ea89f646db53aeabafaaff0a4` |
| Candidate APK package | build/install/cold-launch proven | SHA-256 `ce022f3df8274ef64f275f38a7470f3f8dfabafa54c5eddb2c7e125ece764b0e`; 108894116 bytes; exact immutable backend baked in |
| Candidate APK runtime closure | **EVIDENCE INCOMPLETE** | Run `39607550267` built, installed and cold-launched CarUp, then Android's system package displayed **"Quickstep isn't responding"** during the login hierarchy assertion. No CarUp ANR was proven. The APK-only artifact step was skipped because the runtime job concluded failure; the APK itself is preserved inside evidence artifact `12350393031` |
| APK evidence harness | remediated, rerun required | Harness-only commit `0006cb892740f0bebf43086a192228c0371904d6` restores the already-established bounded Quickstep-only recovery and adds a frozen `candidate_sha` input. It does not change product source. The patched workflow has not yet been dispatched |
| SafePay / preferences failure-state browser proof | **NOT RUN** | `web-truth-states.mjs` remains a required exact-deployment evidence step: failed reads must show Not available/no number, no switches, and no PATCH |
| Physical Native Owner UAT | **NOT PERFORMED** | Existing Native evidence is emulator evidence, not a physical-device Owner acceptance |
| Inquiry reconciliation staging runtime | **NOT PROVEN** | Reconciliation implementation is test-proven; applying/reconciling staging remains separately authorized |
| Production | **BLOCKED / UNTOUCHED** | Legal Gate F remains blocked; Production Supabase remains forbidden |

Therefore:

```text
CLIENT_MVP_TECHNICAL_READINESS = NOT_READY
PRODUCTION_RELEASE_READINESS = BLOCKED
LEGAL_RELEASE_GATE = BLOCKED_OWNER_LEGAL_APPROVAL
```

The remaining technical work is evidence closure, not another product redesign.

## 9. Candidate record

| Field | Value |
|---|---|
| Product candidate SHA | `88bffa50b34d81cdeb1f13f2c90bfb957190c732` |
| Evidence-harness branch head | `0006cb892740f0bebf43086a192228c0371904d6` (workflow-only; product candidate remains frozen) |
| Base authority | `0fc425a997e1e2e02a039e728dcd5ee90f5fd936` |
| Product ahead / behind | 69 / 0 |
| Product changed files | 171 |
| Database / migration changes | none |
| Backend immutable Preview | `https://carup-backend-staging-lmnyhj874-11-11.vercel.app` |
| Backend deployment | `dpl_EUKJZc8MbtNx1nPhM9AKsZi5hkHE` |
| Web immutable Preview | `https://carup-staging-mn3bx7ymb-11-11.vercel.app` |
| Web/backend exact pair | proven in run `39607555572` |
| Staging Supabase | `eoyenigwevnxwwhyhaer` |
| Communications kill switch | active; external sends disabled |
| Candidate APK SHA-256 | `ce022f3df8274ef64f275f38a7470f3f8dfabafa54c5eddb2c7e125ece764b0e` |
| Candidate APK size | `108894116` bytes |
| APK evidence artifact | `12350393031` / `sha256:cc7e988f55b6d25c81d9ce530a26227f73f15fcc8d8bd5b44c906f6fb81b31bf` |
| Exact certification artifact | `12348897183` / `sha256:e67ee3cc522224d3204a573bd19474ca08c1274ea89f646db53aeabafaaff0a4` |
| Canonical aliases moved | NO |
| Production touched | NO |
| Owner credentials used | NO |
| Staging rows deleted | 0 |

### Candidate evidence classification

The final APK workflow's failure does **not** erase its successful package evidence. Gradle completed successfully, installation
returned Success, `com.carup.mobile/.MainActivity` cold-launched in 989 ms, and the app was top-resumed. The hierarchy
failure was the Android system Quickstep ANR overlay. Because the workflow had accidentally omitted the bounded Quickstep
recovery already present in the accepted Native evidence harness, this is classified as an **evidence-harness defect** until the
patched workflow is rerun. A `CarUp isn't responding` / `CarUp keeps stopping` dialog remains an unconditional failure.

## 10. Release-gate roll-up

| Gate | Implementer position | Reason |
|---|---|---|
| Gate A — Identity & Access | evidence-backed, pending moderator disposition | registration/session/logout/x-user-id denial passed exact-SHA certification |
| Gate B — Data & Integrity | evidence incomplete | inquiry reconciliation is test-proven but not applied/proven on staging; reconciliation mutation is separately authorized |
| Gate C — Commerce & Finance | evidence incomplete | buyer/seller inquiry and Seller lifecycle passed; SafePay successful-empty read passed; failed-read browser truth-state proof still outstanding |
| Gate D — Security | evidence-backed, pending moderator disposition | exact certification kept external sends disabled and denied x-user-id fallback; Production untouched |
| Gate E — Operations | evidence incomplete | immutable candidate exists, but final APK runtime evidence harness must rerun and remaining runtime receipts must be captured |
| Gate F — Governance | **BLOCKED** | Owner/legal approval outstanding |
| Gate G — Product Control | evidence incomplete | major product remediations implemented; final Native F-040 / Trust / preferences screenshots and exact final runtime closure outstanding |

No gate above is a moderator PASS.

## 11. Findings disposition policy at handoff

A code fix is recorded as `REMEDIATED_PENDING_VERIFICATION`, not CLOSED. `BLOCKED` means an Owner, external-provider or
legal decision is still required. `OPEN` means no authorized mutation/closure has occurred.

The takeover handoff also reports Owner/moderator-only container-policy questions `F-033`, `F-034`, `F-035` and the
absolute-date question in spec 45 (`F-036`). Their exact original finding records are not present in this branch, so this
takeover does **not** reconstruct or resolve them from memory. They remain explicit decision gates for the next moderator.

## 12. Evidence still required before moderator review

1. Dispatch the patched candidate APK workflow from evidence-harness head `0006cb892740f0bebf43086a192228c0371904d6` with
   `candidate_sha=88bffa50b34d81cdeb1f13f2c90bfb957190c732` and `backend_host=carup-backend-staging-lmnyhj874-11-11.vercel.app`; require a successful runtime job and APK artifact.
2. Run the already-written `web-truth-states.mjs` against `https://carup-staging-mn3bx7ymb-11-11.vercel.app` using the controlled certification session.
3. Repeat final web/API/Native read-only evidence on the exact immutable pair. **Do not repeat Native Send**; the one-send proof
   already created the required inquiry and another send would contaminate Serena.
4. Capture Native Vehicle Detail Trust rows and Account/Communications preference labels plus the F-040 Inbox delivery notice.
5. Keep inquiry reconciliation as a dry-run/read-only proof unless the moderator separately authorizes staging mutation.
6. Physical Owner Native UAT remains a later gate; emulator evidence must not be labelled physical-device acceptance.

## 13. Known non-product blockers / deferrals

- `BLOCKED_MECHANIC_ACTIVATION_MODEL`: independent-mechanic activation remains an Owner policy decision.
- Garage **approval** runtime proof is blocked until the applicant has a legitimately approved identity; current refusal is correct.
- Gate F / Terms / Privacy remain `BLOCKED_OWNER_LEGAL_APPROVAL`.
- Container policy questions F-033/F-034/F-035 and spec-45 date question F-036 remain Owner/moderator decisions.
- Staging reconciliation application is not authorized.
- Hosted PR-only `ci.yml` has not run because no PR has been opened.

