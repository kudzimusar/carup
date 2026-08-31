# CARUP — Non-Seller Convergence Hardening & Production-Readiness Execution Ledger

**Status:** ACTIVE — continuous execution ledger\
**Branch:** `hardening/non-seller-convergence`\
**Source #194 SHA:** `43204beeec40123b0cce0c457aded6d0f733c4bc`\
**Source main SHA:** `ba208963d863654157335189c60f587cbe330041`\
**Source #196 SHA:** `30728299e9e60b1c1d51b3eff8363db080edf22f`\
**Frozen #197 SHA:** `5683b74edaaa86a01c55005839b8f092aea8fccb`\
**Active Seller remediation:** PR #200, branch `fix/seller-uat-convergence-final-194`, observed head `3778e5dfa4fdbf32233d8764a917cc8cea5ff5e3` at lane opening.\
**Historical Seller PR #198:** already merged into #194 at `43204bee...`; do not attempt to merge it again.\
**Historical probe #199:** already closed/unmerged; do not reopen.

> This file is the roll-call authority for this cycle. A phase is not considered cleared until its checklist is checked here with evidence. The execution must continue phase-to-phase without pausing for narrative status updates unless an external authorization/credential/production gate prevents further work.

## Execution status and evidence index

This ledger is the PLAN. The executed evidence lives in `docs/hardening/`, produced after the
two concurrent hardening lanes were reconciled (see the receipt's "Concurrency event"). Read
them together: this file states what was to be done, those state what was done and proven.

| Phase | Status | Evidence |
|---|---|---|
| 0 Re-fetch truth | done | receipt §1 — three authorities moved mid-cycle |
| 1 Seller boundary | done | `hardening/SELLER_JOIN_BOUNDARY_AND_CONTRACT.md` §2 |
| 2 Isolated lane | done | this branch |
| 3 Durable terminal identity | done | receipt §2; both #194 threads closed |
| 4 Payload idempotency semantics | done | `issue-158-terminal-operation-identity.test.js` §1 |
| 5 Adversarial battery | done | 19/19 incl. 3 mutation kills |
| 6 Referral nondeterminism | done | fixed at the product source, receipt §2 |
| 7 Cross-system authority audit | done | `hardening/AUTHORITY_AUDIT_REGISTER.md` — 79 agents, 70 candidates, **30 confirmed / 40 refuted**, 7 closed |
| 8 Migration integrity | done | `hardening/PRODUCTION_READINESS_PACKAGE.md` §1–2 — full DAG; rehearsal found a real defect |
| 9 #196 | **stood down** | another session pushed an equivalent fix (`be8706db`) first; the historical CI failure did NOT reproduce in 5 local full-suite runs |
| 10 #197 audit | done | `hardening/PR197_AUDIT_AND_MERGE_REHEARSAL.md` — 20 obligations (not 12), no second event mechanism |
| 11 Merge rehearsal | done | same document §4 — one conflicted file, semantic resolution rule stated |
| 12 Seller Join Contract | done | boundary document §4–5, incl. a 16-check join battery |
| 13 Production readiness | done | `hardening/PRODUCTION_READINESS_PACKAGE.md` — verdict BLOCKED, 7 named gates |
| 14 Full battery | done | receipt §3 |
| 15 Receipt | done | `hardening/NON_SELLER_HARDENING_RECEIPT.md` |
| 16 Seller join gate | done | receipt §8 |

## Mission guardrails

- [x] Do not modify active Seller implementation.
- [x] Do not merge #194 to `main`.
- [x] Do not perform the final #197 rebase.
- [x] Do not perform production activation/writes.
- [x] Do not change production secrets.
- [x] Do not weaken assertions or hide nondeterminism behind retries.
- [x] Do not edit already-published migrations to append later invariants.
- [x] Preserve one canonical authority per domain.
- [x] Stop only at the Seller Join Gate after all non-Seller work is exhausted.

## Seller exclusion boundary

PR #200 is the live Seller owner. Until the final Seller join, all PR #200 changed paths are treated as read-only in this lane, including:

- `.github/workflows/seller-exact-head-staging-uat.yml`
- `backend/services/marketplace/listingSummaryService.js`
- `docs/seller/SELLER_MARKETPLACE_PARITY_MATRIX.md`
- `docs/seller/SELLER_UAT_CONVERGENCE_EXECUTION_PLAN.md`
- `tests/agents/38-seller-staging-browser-golden.spec.ts`
- `tests/agents/seller-uat-automation-cleanup.mjs`
- `web/src/App.tsx`
- `web/src/components/dashboard/WorkspaceHeader.tsx`
- `web/src/components/intelligence/MarketplacePulse.tsx`
- `web/src/components/layout/DashboardLayout.tsx`
- `web/src/components/marketplace/MarketplaceListingCard.tsx`
- `web/src/components/sell/SellerIntentRouter.tsx`
- `web/src/config/featureRegistry.ts`
- `web/src/pages/GuestSell.tsx`
- `web/src/pages/Landing.tsx`
- `web/src/pages/Marketplace.tsx`
- `web/src/pages/auth/LoginErrorAlert.tsx`
- `web/src/pages/auth/Register.tsx`
- `web/src/pages/dashboard/owner/EvidenceVault.tsx`
- `web/src/pages/dashboard/owner/MyGarage.tsx`
- `web/src/pages/dashboard/owner/MyListings.tsx`
- `web/src/pages/dashboard/owner/OwnerDashboard.tsx`
- `web/src/pages/dashboard/owner/SellVehicle.tsx`
- `web/src/pages/dashboard/owner/VehicleProfile.tsx`

Any additional path changed by PR #200 or a successor Seller PR during this cycle is automatically added to this boundary.

A non-Seller concern that requires touching a Seller-owned path becomes a `SELLER_JOIN_OBLIGATION`, not a concurrent edit.

---

# Phase 0 — Re-fetch repository truth before acting

- [x] Re-fetch `main` and verify exact SHA.
- [x] Re-fetch #194 and verify exact head/base/state.
- [x] Re-fetch #196 and verify exact head/base/state.
- [x] Re-fetch #197 and verify exact head/base/state.
- [x] Re-fetch #198 and confirm historical merged state.
- [x] Re-fetch #199 and confirm historical closed/unmerged state.
- [x] Discover active Seller PR/branch: #200.
- [x] Read current unresolved review threads for #194/#196/#197/#200.
- [x] Read current repository ruleset inventory.
- [ ] Record required status checks for active branches.
- [ ] Confirm remote branch SHAs again before each push/merge-sensitive action.
- [ ] Local worktree/dirty-tree inventory — only possible if a repository workspace is attached; remote GitHub cannot prove local agent worktrees. Record this limitation, do not guess.

**Observed at opening**
- `main` = `ba208963d863654157335189c60f587cbe330041`
- #194 = `integration/vehicle-passport-v16-cert@43204beeec40123b0cce0c457aded6d0f733c4bc`, open Draft.
- #196 = `docs/service-network-foundation-1-0-plan@30728299e9e60b1c1d51b3eff8363db080edf22f`, open Ready-for-review.
- #197 = `feat/service-network-foundation-1-0@5683b74edaaa86a01c55005839b8f092aea8fccb`, open Draft, zero unresolved threads.
- #194 unresolved review threads: `PRRT_kwDOSp7_h86dYQd3`, `PRRT_kwDOSp7_h86dYQd5`.
- #196 unresolved review thread: `PRRT_kwDOSp7_h86dXiNw`.
- #200 = active Seller lane; zero unresolved review threads observed at opening.
- main ruleset: `Protect main` (id 20850554). Direct branch-protection endpoint is not accessible to this integration; ruleset evidence is authoritative where available.

# Phase 1 — Hard Seller exclusion boundary

- [x] Build boundary from live Seller PR #200.
- [ ] Compare #198 historical diff and Seller canonical docs for additional Seller-owned contracts not currently touched by #200.
- [ ] Produce finite `SELLER_JOIN_OBLIGATION` register.
- [ ] Verify every hardening commit contains zero unintended Seller-owned diff.

# Phase 2 — Isolated non-Seller hardening lane

- [x] Create `hardening/non-seller-convergence` from exact #194 source SHA.
- [x] Record source authorities in this ledger.
- [ ] Keep commits bounded by concern.
- [ ] Never merge this branch directly to main.
- [ ] Verify remote branch exact SHA after each pushed checkpoint.

# Phase 3 — Close #194 Issue #158 durable terminal idempotency gap

- [ ] Trace every terminal-capable stakeholder ledger writer to its durable operation identity.
- [ ] Reject terminal-capable call paths that cannot provide stable operation identity.
- [ ] Persist durable operation identity in a new forward-only migration.
- [ ] Same operation ID + same persisted logical content => return existing terminal row.
- [ ] Same operation ID + different content => explicit refusal.
- [ ] Different operation ID + identical content => explicit refusal.
- [ ] Same signer/VIN/event/payload alone never proves same operation.
- [ ] Preserve terminal uniqueness, DB time, half-open validity, saturation/rotation refusal, generation auth, reseed/watermark, range guards, custody.
- [ ] Harden finalizer prerequisites.
- [ ] Resolve #194 review thread `PRRT_kwDOSp7_h86dYQd3` only after executable evidence.

# Phase 4 — JSON/payload idempotency semantics

- [ ] Normalize attempted payload through actual JSON persistence semantics before deterministic canonicalization.
- [ ] Test `undefined` object fields.
- [ ] Test `Date`.
- [ ] Test object key-order variation.
- [ ] Test array order significance.
- [ ] Test nested arrays/objects.
- [ ] Test null/boolean/number/string.
- [ ] Test equivalent persisted JSON from differently ordered JS objects.
- [ ] Mutation-test durable-operation guard and payload-consistency guard.
- [ ] Resolve #194 review thread `PRRT_kwDOSp7_h86dYQd5` only after executable evidence.

# Phase 5 — One adversarial Issue #158 battery before push

- [ ] Normal signing below saturation.
- [ ] Colliding clocks.
- [ ] Skewed clocks.
- [ ] Forward-skewed historical events.
- [ ] Malformed timestamps / NULL / ±infinity.
- [ ] Runtime-unrepresentable timestamps.
- [ ] Final representable day and terminal `.999Z`.
- [ ] Terminal allocation followed by failed insert.
- [ ] Retry after known failed insert.
- [ ] Successful terminal commit followed by lost response.
- [ ] Fresh retry after advanced VIN tail.
- [ ] Simultaneous same-operation retries.
- [ ] Same-content independent operations.
- [ ] Different payload / event type / VIN.
- [ ] Operation-ID reuse with mismatching content.
- [ ] Rotation attempt at terminal.
- [ ] Exactly one terminal row.
- [ ] Signature valid.
- [ ] `verifyChain() === true`.
- [ ] No skipped-signature notes.
- [ ] Real PostgreSQL/PGlite evidence.
- [ ] Mutation-check every load-bearing guard.

# Phase 6 — Referral nondeterminism

- [ ] Reproduce the contradictory same-SHA Referral failure.
- [ ] Identify root cause rather than add blind retry.
- [ ] Fix only non-Seller-owned root cause.
- [ ] If Seller-owned, record `SELLER_JOIN_OBLIGATION`.
- [ ] Re-run repeatedly to prove determinism.

# Phase 7 — Cross-system authority audit

For each authority, prove canonical writer/mechanism and inspect bypasses:

- [ ] Ownership.
- [ ] Vehicle Passport.
- [ ] Trust/verification.
- [ ] Evidence.
- [ ] Odometer truth.
- [ ] Lifecycle ledger.
- [ ] Communications routing.
- [ ] Outbound communication.
- [ ] Intelligence observation/rollups.
- [ ] Marketplace publication authority.
- [ ] Service Network work orders.
- [ ] PartSentry.
- [ ] Identity/auth.
- [ ] Tenant isolation.
- [ ] Search duplicate services/direct DB writes/legacy endpoints/permissive fallbacks/in-memory authorities/mock production paths/client-controlled authority/duplicate emitters.
- [ ] Fix safe non-Seller defects.
- [ ] Record Seller-overlap defects as join obligations.

# Phase 8 — Migration integrity and future production join

- [ ] Build exact migration inventory/DAG for #194 and dependencies.
- [ ] Verify published migration identities immutable.
- [ ] Verify later fixes use later identities.
- [ ] Detect duplicate versions/order collisions.
- [ ] Rehearse upgrade from staging-representative state.
- [ ] Rehearse upgrade from production-representative state.
- [ ] Verify finalizers fail closed.
- [ ] Document honest rollback/abort semantics.
- [ ] No production migration executed.

# Phase 9 — Finish #196 independently, do not merge

- [ ] Move exact work-order schema/state/transition/event vocabulary freeze into S0.
- [ ] Make S2/S3/S4 consumers of frozen S0 contract.
- [ ] Reproduce historical #196 CI failure.
- [ ] Run complete #196 checks.
- [ ] Resolve thread `PRRT_kwDOSp7_h86dXiNw`.
- [ ] Request/re-run review as available.
- [ ] Record clean #196 candidate SHA.
- [ ] Do not merge #196 to main.

# Phase 10 — Audit #197 without final rebase

- [ ] Preserve frozen #197 authority `5683b74e...`.
- [ ] Enumerate all twelve `[#194-sensitive]` obligations.
- [ ] Mark independently resolvable obligations.
- [ ] Mark Seller-dependent obligations.
- [ ] Identify stale assumptions.
- [ ] Identify expected conflict files and semantic rules.
- [ ] Harden independent tests/contracts only if no Seller-owned file is touched.
- [ ] Do not create duplicate #194 transaction/event authority.
- [ ] Do not perform final rebase.

# Phase 11 — Throwaway merge/rebase rehearsals

- [ ] Rehearse current #194 + clean #196 candidate in disposable evidence branch/state.
- [ ] Rehearse resulting tree + frozen #197.
- [ ] Record textual conflicts.
- [ ] Record semantic conflicts.
- [ ] Record migration ordering conflicts.
- [ ] Record `backend/server.js` conflicts.
- [ ] Record `web/src/App.tsx` conflicts without editing active Seller path.
- [ ] Record duplicate routers/services/events/migrations/schema/type/routes/authority conflicts.
- [ ] Document semantic resolution rule for every conflict.
- [ ] Run relevant checks against rehearsal result where automation permits.
- [ ] Delete/close rehearsal authority afterward; rehearsal is evidence only.

# Phase 12 — Seller Join Contract

- [ ] Define canonical dependencies Seller must consume: Auth, identity, ownership, Passport, Trust, Evidence, publication, Communications, Intelligence, lifecycle/events.
- [ ] Explicitly prohibit second ownership/trust/Passport/comms/analytics/evidence/publication/security authority.
- [ ] Produce finite Seller Join Verification Battery.
- [ ] Include current #200 Seller exclusion/obligation map.
- [ ] Include full UI/UAT contract already governed by Seller convergence docs without changing Seller code here.

# Phase 13 — Production-readiness package, no production changes

## Migration readiness
- [ ] Ordered migration inventory.
- [ ] Staging assumptions.
- [ ] Production assumptions.
- [ ] Unrecorded migration list.
- [ ] Preflight commands.
- [ ] Lock-risk notes.
- [ ] Maintenance-window requirements.
- [ ] Abort/rollback points.
- [ ] Post-migration verification queries.

## Runtime configuration
- [ ] Inventory required variables/providers.
- [ ] Classify present/missing/stale/unverified/owner-action-required without printing values.

## Deployment
- [ ] Frontend provenance contract.
- [ ] Backend provenance contract.
- [ ] Health endpoints.
- [ ] Expected build SHA.
- [ ] Rollback candidate.
- [ ] Migration/deploy ordering.
- [ ] Fail-closed behavior for missing schema/config.

## Observability
- [ ] Correlation IDs.
- [ ] Audit logs.
- [ ] Error telemetry.
- [ ] Health checks.
- [ ] Event/outbox visibility.
- [ ] Failure diagnostics.
- [ ] Migration diagnostics.

## Security
- [ ] Anonymous access.
- [ ] RLS.
- [ ] Service-role grants.
- [ ] Default privileges.
- [ ] Tenant boundaries.
- [ ] Direct-table write grants.
- [ ] Private signing material.
- [ ] Auditability.
- [ ] Destructive foreign keys.

# Phase 14 — Full non-Seller hardening battery

- [ ] Backend full suite.
- [ ] Web full suite.
- [ ] Typecheck.
- [ ] Lint regression.
- [ ] Production build.
- [ ] Secret scan.
- [ ] Migration verification.
- [ ] Real PGlite/PostgreSQL proofs.
- [ ] Issue #101.
- [ ] Issue #158.
- [ ] Communications.
- [ ] Navigation.
- [ ] Referral.
- [ ] Diaspora.
- [ ] Vehicle Passport.
- [ ] Trust/Evidence.
- [ ] Intelligence.
- [ ] Service Network independent tests.
- [ ] Marketplace buyer/discovery regressions that do not modify Seller behavior.
- [ ] Zero unexplained failures.
- [ ] Every skip documented.

# Phase 15 — Pre-Seller hardening receipt

- [ ] Source main SHA.
- [ ] Source #194 SHA.
- [ ] Hardened branch SHA.
- [ ] Clean #196 candidate SHA.
- [ ] Frozen #197 SHA.
- [ ] Test counts.
- [ ] Mutation results.
- [ ] Migration rehearsal evidence.
- [ ] Merge rehearsal evidence.
- [ ] Seller exclusion boundary.
- [ ] Seller join obligations.
- [ ] Residual risks.
- [ ] Production-readiness status.
- [ ] State: **FINAL SELLER INTEGRATION NOT YET CERTIFIED.**
- [ ] State: **FINAL #194 RECEIPT NOT YET AUTHORIZED.**
- [ ] State: **#197 FINAL REBASE NOT YET PERFORMED.**
- [ ] State: **PRODUCTION NOT ACTIVATED.**

# Phase 16 — Seller Join Gate

- [ ] Commit/push all proper non-Seller artifacts.
- [ ] Verify exact remote SHAs.
- [ ] Verify no unintended Seller diff.
- [ ] Verify no `main` change.
- [ ] Verify no production change.
- [ ] Stop with next trigger: **FINAL SELLER CANDIDATE READY.**

# Phase 17 — Predefined final join sequence (future trigger only)

This phase is deliberately **not executable until the active Seller remediation is declared final**.

- [ ] Final Seller candidate ready.
- [ ] Merge/rebase final Seller candidate (currently expected from PR #200 or successor) into hardened #194 branch — **not main**.
- [ ] Run Seller Join Verification Battery.
- [ ] Run full exact-head certification.
- [ ] Resolve final #194 review findings.
- [ ] Produce V16 receipt.
- [ ] Certify receipt head.
- [ ] Ready + approval + merge #194.
- [ ] Update/merge clean #196.
- [ ] Perform one final #197 rebase onto merged #194 + #196.
- [ ] Close #194-sensitive obligations.
- [ ] Full #197 certification.
- [ ] Merge #197.
- [ ] Integrated `main` certification.
- [ ] Owner-controlled production gates.

## Historical four-item Seller handoff roll call

These four actions were already completed before this cycle and are not to be repeated against stale PR numbers:

- [x] Historical #198 was integrated into #194's branch, not `main`.
- [x] Temporary #199 probe was closed/unmerged.
- [x] #194 was re-fetched and its resulting head became `43204beeec40123b0cce0c457aded6d0f733c4bc`.
- [x] Seller feature work then stopped on that historical lane; current remediation moved to PR #200.

The future final Seller join must use the **actual final active Seller candidate**, not re-run historical #198.

---

# Completion handoff format

At Phase 16 provide exactly one consolidated receipt:

- **NON-SELLER HARDENING:** PASS/FAIL
- **#194 non-Seller gaps:** closed / remaining
- **#196:** clean candidate SHA
- **#197:** frozen hardened SHA + future rebase conflict map
- **merge rehearsal:** PASS/FAIL
- **migration rehearsal:** PASS/FAIL
- **production-readiness:** ready / blocked + exact reasons
- **Seller join obligations:** exact finite list
- **next trigger:** FINAL SELLER CANDIDATE
