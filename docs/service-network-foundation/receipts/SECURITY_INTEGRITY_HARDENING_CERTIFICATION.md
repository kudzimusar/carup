# Service Network Foundation 1.0 — Security and Integrity Hardening Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Pre-hardening certified head:** `4f187611ada12e5ab4fd2f96831c3cdac1e106ca`
- **Hardening commit:** `34c9fc63affe20137a000b43766137771b858b6e` (all hardening code, tests, migrations and this receipt)
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Branch / PR:** `feat/service-network-foundation-1-0` → Draft PR #197 (**remains Draft**)
- **Scope:** security, authorization, integrity and failure-mode seams only. No product scope
  broadened; PR #194 untouched; no second authority introduced anywhere.

## 1. Empirical proof that these are real regressions

The pre-hardening service modules were materialised from `4f187611` and the attacks run
against them directly. **7 of 7 attacks succeeded** against the previously certified
implementation:

```
!! V1   ATTACK SUCCEEDED  stranger opens a case against a VIN they do not own
!! V2   ATTACK SUCCEEDED  stranger mints a permanent link for a vehicle they do not own
!! V2b  ATTACK SUCCEEDED  client-supplied tenant_id is stamped onto a link
!! V3   ATTACK SUCCEEDED  capability bound to garage A is redeemed by garage B
!! V4   ATTACK SUCCEEDED  garage attaches evidence uploaded by ANOTHER tenant on same VIN
!! V5   ATTACK SUCCEEDED  garage B's branch attached to garage A's case
!! V7   ATTACK SUCCEEDED  accepting without a branch WIPES the branch set at request time
```

The probe scaffolding was removed after the run; it is not part of the shipped tree. Every
finding below therefore describes behaviour that **actually worked**, not a theoretical risk.

## 2. Vulnerabilities, why each was unsafe, remediation, regression test

### V1 — Any authenticated user could open a service engagement against any VIN
- **Was:** `requestServiceCase` verified only that the target garage was published. It never
  asked whether the caller had authority over the vehicle.
- **Unsafe because:** anyone with an account could fabricate service engagements against
  strangers' vehicles, creating history attached to a VIN they have no relationship to and
  exposing the owner to unsolicited garage contact.
- **Fix:** `assertVehicleAuthority()` (`backend/services/serviceNetwork/serviceAuthority.js`) —
  canonical owner, or a **live** owner-granted capability. Ownership is never inferred from
  `current_seller_id`, tenant membership or Marketplace state. Unknown and unauthorised VINs
  return the identical `NotFoundError`, so it is not a VIN-existence oracle. The Marketplace
  bridge is preserved as its own governed path and passes an explicit
  `authorityAlreadyVerified: 'marketplace_inquiry'` basis so it can never be mistaken for an
  unchecked call.
- **Test:** `service-network-hardening-authority.test.js` →
  *"HOSTILE: a stranger cannot open a service case against a VIN they do not own"*,
  *"HOSTILE: an unknown VIN and an unauthorised VIN are indistinguishable"*,
  *"ownership is NEVER inferred from seller, tenant or marketplace state"*.

### V2 — Any authenticated user could mint a permanent public link for any resource
- **Was:** `ensureServiceLink` performed no authority check at all, and stamped a
  **client-supplied `tenant_id`** onto the row.
- **Unsafe because:** a permanent link is a public address printed on a sticker. An attacker
  could mint one for a stranger's vehicle, a case they had nothing to do with, or an
  unaffiliated practitioner — and attribute it to another garage.
- **Fix:** per-resource authority before creation — `vehicle` → owner/capability,
  `service_case` → participant, `practitioner` → self or an admin of a garage they belong to.
  `tenant_id` is now **server-derived from the case**, never read from the body.
- **Test:** *"HOSTILE: a stranger cannot mint a permanent link for a vehicle they do not own"*,
  *"HOSTILE: an outsider cannot mint a link for a case they are not party to"*,
  *"HOSTILE: a garage cannot mint a practitioner link for someone unaffiliated"*,
  *"HOSTILE: a client-supplied tenant_id is never stamped onto a link"*.

### V3 — Capability grants were recorded but granted nothing
- **Was:** redemption wrote `redeemed_at` and returned success, but no authorization decision
  anywhere consulted capabilities, and `grantee_tenant_id` was ignored at redemption.
- **Unsafe because:** it was security theatre in both directions — a legitimate grant conferred
  no access, while a capability addressed to garage A could be redeemed by garage B.
- **Fix:** `findLiveCapability()` — a capability counts only while **redeemed AND unexpired AND
  unrevoked AND matching the grantee tenant AND matching the redeeming actor**, evaluated
  against current rows on every call so revocation and expiry take effect immediately with
  nothing cached. Redemption checks the grantee tenant **before** consuming the token, so a
  mis-delivered link is not burned for its rightful holder. A named grantee must be a real
  tenant. Live capabilities now genuinely participate in Service Case authorization.
- **Deliberate limit:** a capability conveys **service context only**. It never confers
  Communications conversation access — the thread reference is withheld from capability-based
  readers, leaving Communications to apply its own participant rules (Invariant 6).
- **Test:** *"HOSTILE: a capability bound to garage A cannot be redeemed by garage B"*,
  *"a redeemed capability stops granting access the moment it is revoked"*,
  *"…the moment it expires"*, *"a capability redeemed by one actor does not confer access to a
  different actor"*, *"an UNREDEEMED capability is not access"*,
  *"a case capability grants service context but NOT the conversation"*,
  *"all bearer-token failures remain indistinguishable"*.

### V4 — A matching VIN authorized attaching any evidence row
- **Was:** `linkEvidence` checked only that `evidence.vin === record.vin`.
- **Unsafe because:** a VIN match says the evidence concerns the same vehicle, not that this
  garage may use it. Any garage that ever serviced a vehicle could attach evidence uploaded by
  a different tenant and inherit `evidence_backed` provenance from someone else's work.
- **Fix:** `assertEvidenceUsable()` — requires a governed Service Case for **that vehicle and
  that garage**, and refuses evidence uploaded by another tenant unless the vehicle's owner
  provided it. Evidence itself remains the Evidence authority's; this decides usage only.
- **Test:** *"HOSTILE: matching VIN alone does not authorize attaching evidence"*,
  *"HOSTILE: evidence cannot be attached without a governed case for this garage"*,
  *"HOSTILE: a case belonging to another garage does not authorize evidence use"*,
  *"evidence uploaded by the vehicle owner IS usable by the servicing garage"*.

### V5 — Garage B's branch could be attached to Garage A's case
- **Was:** `branch_id` was accepted unvalidated at case creation and acceptance, and propagated
  into the work order.
- **Unsafe because:** it silently attributes work to another garage's physical location,
  corrupting branch-scoped history and any future branch metric.
- **Fix:** application checks (`assertBranchBelongsToTenant`) at creation, acceptance **and**
  work-order propagation, plus database composite foreign keys making it unrepresentable:
  `service_cases (branch_id, garage_tenant_id) → garage_branches (id, tenant_id)` and the same
  on `mechanic_work_orders (branch_id, tenant_id)`, backed by a new
  `garage_branches UNIQUE(id, tenant_id)` composite target.
- **Test:** *"HOSTILE: garage B's branch cannot be attached to a case for garage A"*,
  *"HOSTILE: a garage cannot ACCEPT a case onto another garage's branch"*,
  *"a foreign branch on a case row cannot be laundered into a work order"*, plus the real-PG
  proof in `service_network_s2_check.mjs`.

### V6 — Service history could be erased by an unrelated delete
- **Was:** 14 `ON DELETE CASCADE` foreign keys. Deleting a vehicle or a tenant destroyed its
  service cases, case events, service records, mileage observations, part/evidence references
  and assignment history. `DELETE` was granted to `service_role` on every table.
- **Unsafe because:** history is the product. A routine tenant cleanup could silently erase the
  evidence of what happened to a vehicle, with no trace that anything was lost.
- **Fix:** **every CASCADE replaced with `RESTRICT`**, and **every `DELETE` grant removed** from
  all nine Service Network tables. `service_case_events` is now `SELECT, INSERT` only —
  append-only by grant *and* by trigger. Deleting a vehicle, tenant or service record that
  carries history now fails with `23503`.
- **Test:** `service-network-hardening-truth-audit.test.js` → *"every Service Network migration
  is retention-safe"* (source-level: no CASCADE, no DELETE grant), plus real-PG retention
  proofs added to `service_network_s1_check.mjs`, `s2`, `s5`.

### V7 — Accepting a case wiped the branch recorded at request time
- **Was:** `acceptServiceCase` spread `branch_id: undefined` into the update payload.
- **Unsafe because:** silent data loss. Real Supabase drops `undefined` keys so it was latent,
  but it is one client or transport change away from erasing branch attribution.
- **Fix:** the key is included only when a branch is actually supplied.
- **Test:** *"a garage's own branch flows through the whole journey"*.

### V8 — A rolled-back transition left stale timestamps
- **Was:** the compensating rollback restored `status` only.
- **Unsafe because:** a rolled-back acceptance would still carry `accepted_at`, reading as
  accepted to every downstream consumer.
- **Fix:** the rollback restores **every** field the transition wrote.
- **Test:** *"a transition whose history cannot be recorded is ROLLED BACK, not silently kept"*.

## 3. Database constraints added or changed

| Change | Tables |
|---|---|
| `ON DELETE CASCADE` → `ON DELETE RESTRICT` (14 FKs) | `garage_public_profiles`, `garage_branches`, `service_cases`, `service_case_events`, `work_order_assignments`, `service_records`, `service_mileage_observations`, `service_record_parts`, `service_record_evidence`, `service_links`, `service_capability_grants` |
| `DELETE` grant removed (all 9 tables) | as above |
| `service_case_events` reduced to `SELECT, INSERT` | append-only by grant **and** trigger |
| **New** `garage_branches UNIQUE(id, tenant_id)` | composite FK target |
| **New** `service_cases_branch_within_tenant` composite FK | `service_cases` |
| **New** `mechanic_work_orders_branch_within_tenant` composite FK | `mechanic_work_orders` |
| **New** `mechanic_work_orders_service_case_fk` | `mechanic_work_orders` → `service_cases` |

All changes are inside the unmerged, never-applied Service Network migration set, so they are
edits to that set rather than fix-up migrations layered on a published schema.

## 4. Lifecycle atomicity — precise claim

A transition is three writes: authoritative state, append-only history, durable outbox event.

- **state → history: narrowed and compensated.** The history append is retried; on persistent
  failure the transition is **rolled back** to the observed prior status, guarded on the row not
  having moved so it cannot clobber a concurrent writer, and restoring every field written. On
  the creation path there is no prior status, so a case whose provenance cannot be recorded is
  retired to `cancelled` rather than left live.
- **history → outbox: reported, never rolled back.** The case and its history are intact and the
  event is replayable from `service_case_events`, so an emit failure surfaces as
  `notification.emitted:false` and authoritative service truth stands (plan §15.5).

**Full state + history + outbox atomicity is NOT claimed and is NOT implemented.** Single
transaction emission requires the SECURITY DEFINER RPC pattern #194 finalises
(`INSERT INTO domain_events` inside the mutating transaction). It is carried as a **mandatory
post-#194 reconciliation item** (§7.1). No competing event mechanism was introduced.

## 5. Fourth shared-mock defect — closed with dual proofs

`UNIQUE_INDEXES` could not express a **partial** unique index.
`uq_work_order_assignments_live` is `UNIQUE (work_order_id) WHERE unassigned_at IS NULL`;
registered as a plain column list it never fired, because every live row has `NULL` there and
NULLs do not collide — so a concurrent double-assignment test passed while leaving **two
current mechanics** on one work order.

- **Mock fix:** entries may now be `{ columns, where }`; the predicate is carried and enforced.
- **Mock regression test:** `mock-supabase-partial-unique-index.test.js` (6 tests) — the index is
  registered as partial with a correct predicate; a second live row is rejected `23505`;
  unlimited historical rows are allowed; the predicate is per-work-order; reassignment works;
  plain indexes still behave as before.
- **Independent real-PostgreSQL proof:** `service_network_s4_check.mjs` proves the same
  invariant — unlimited historical rows permitted, exactly one live row, a second live row
  refused `23505`, and `pg_indexes` confirming the index really is predicated on
  `unassigned_at IS NULL`. Neither proof stands alone.

This is the fourth defect of this family, after missing `count` support (S1), unregistered
unique indexes (S5) and no-op comparison filters (S8).

## 6. Verification — commands and counts

Full battery run from the hardened head in the exact `ci.yml` environment
(`NODE_ENV=test`, test Supabase/JWT placeholders, `ALLOW_OCR_MOCK=true`).
**27 of 27 gates passed. Zero failures.**

| Gate | Command | Result |
|---|---|---|
| Web typecheck | `npx tsc --noEmit --project web/tsconfig.app.json` | **PASS** — zero diagnostics |
| Lint regression gate | `node scripts/lint-baseline-gate.mjs` (`LINT_BASE_REF=origin/main`) | **PASS** — no net-new lint |
| Migration integrity | `node database/test/migration_pglite_check.mjs` | **PASS** |
| Issue #101 harnesses (5) | `issue101_{p0_hardening,parity,parity_then_p0_chain,public_keys_transition,post_cutover_certifier}_check.mjs` | **PASS** |
| Diaspora ledger harnesses (11) | `database/test/diaspora_*_check.mjs` | **PASS** |
| Service Network migration harnesses (6) | `database/test/service_network_s{1,2,3,4,5,8}_check.mjs` | **PASS** — now including retention (23503), branch-integrity and partial-index proofs |
| **Full backend suite** | `node --test backend/tests/*.test.js` | **PASS** — 4542 tests, **4521 pass, 0 fail**, 21 skipped, 48 suites |
| **Full web suite** | `npx vitest run` (in `web/`) | **PASS** — 108 files, **1115 tests, 0 fail** |

Included in the backend suite:

| Hardening suite | Tests |
|---|---|
| `service-network-hardening-authority.test.js` (hostile: VIN, link, capability, branch, evidence) | 24 |
| `service-network-hardening-integrity.test.js` (atomicity, concurrency, idempotency, correction) | 15 |
| `service-network-hardening-truth-audit.test.js` (no second authority; published ≠ verified; retention-safe migrations) | 7 |
| `mock-supabase-partial-unique-index.test.js` (mock self-regression) | 6 |
| **Total new** | **52** |

Pre-hardening baseline at `4f187611` was 4490 backend tests / 0 fail and 108 web files /
1115 tests. The hardening added **+52 backend tests with zero regressions**, and changed no
web behaviour (web count unchanged, as expected for a backend/authorization pass).

Service Network phase suites S1–S10, including all eight Golden Journeys, remain green under
the hardened authority rules.

## 7. Post-#194 obligations (deliberately NOT done now)

1. **MANDATORY — full transactional atomicity.** Converge state + append-only history +
   domain-outbox emission into a single transaction using #194's canonical mechanism, and retire
   the compensating rollback in favour of it.
2. **Event dedupe identity.** Register `service.*` in `DETERMINISTIC_EVENT_IDENTITY_FIELDS`
   **and** the DB dedupe trigger in lockstep (3-way pinned; a one-sided change turns recovery
   into insert failure).
3. **Evidence/custody authority.** Reconcile `assertEvidenceUsable` against #194's final
   Evidence visibility and custody rules; today's rule is Service-Network-local and conservative.
4. **Communications.** Bind to #194's finalised recipient-resolution and channel contracts. A
   capability confers no conversation access today, by design.
5. **Passport.** Extend `SERVICE_AUTHORITIES`, never fork it.
6. **Intelligence.** Reconcile I9 `NOT_MEASURABLE` against S7 §3; re-point service demand from
   `seller_id` to `target_provider_tenant_id` / canonical Service Case garage authority.
7. **Re-confirm at the rebased head:** exactly one canonical mileage writer; still no Trust
   writer, ownership writer, second messaging authority or second analytics authority.
8. Resolve the two known overlap hotspots carefully: `backend/server.js`, `web/src/App.tsx`.


## 8. Exact heads and rebase gate status

| | SHA |
|---|---|
| Pre-hardening certified head | `4f187611ada12e5ab4fd2f96831c3cdac1e106ca` |
| **Hardening commit** | `34c9fc63affe20137a000b43766137771b858b6e` |
| **Branch head** | the commit immediately following, which carries only this SHA correction (a commit cannot contain its own hash; verify with `git log --oneline -2`) |
| Implementation base (`main`) | `ba208963d863654157335189c60f587cbe330041` |

### Canonical rebase gate — CLOSED, rebase deliberately NOT performed

Checked at the time of this receipt:

| Required condition | Status |
|---|---|
| PR #194 (or approved successor) merged into `main` | ❌ **OPEN, still Draft — not merged** |
| PR #196 (canonical plan) merged into `main` | ❌ **OPEN — not merged** |
| Hardened #197 head pushed and recorded | ✅ this receipt |
| `origin/main` | unchanged at `ba208963` |

Two of three conditions are unmet, so the rebase was **not** attempted. This is plan §30
condition 1 — *"PR #194/successor is not merged and there is no canonical implementation
base"* — a legitimate manual gate, not a failure.

**Resume trigger:** when both #194 and #196 are merged, fetch `origin`, record the new exact
`origin/main` SHA, rebase this branch onto it (resolving `backend/server.js` and
`web/src/App.tsx` semantically, never by taking a side wholesale), re-run S0 against merged
truth, close every obligation in §7, replace the compensating state/history pattern with
#194's canonical transactional mechanism, then re-run this full battery and update the S0,
S10 and this receipt with the rebased head.

PR #197 remains **Draft** throughout.
