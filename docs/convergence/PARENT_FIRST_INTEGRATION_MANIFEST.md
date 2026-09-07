# Parent-first integration manifest — #208 O2, #197 Service Network, #209 GMO

**CURRENT INSPECTION — READ ONLY. No merge, retarget, parent-branch write, `main` write or production action is authorised by this document, and none was performed.**

This refresh supersedes the **current-readiness conclusions** of the earlier snapshot while preserving that snapshot as historical evidence in Git at `5bc3c96eaba410d98478ec2f8208d378029d0b2f`. The earlier measurement was correct for the heads it named. The important change since then is that **#208 advanced by two commits; #209 did not absorb them.**

## 0. Exact current inspection heads

| lane | PR | branch | exact inspected head | base | PR commits | files | diff |
|---|---|---|---|---|---:|---:|---:|
| O2 People & Compliance | **#208** | `feat/operations-o2-people-compliance` | `7fe1f821b3ccc07c7c356c76de0c821674406635` | `main` | 41 | 140 | +20,806 / −717 |
| Service Network Foundation | **#197** | `feat/service-network-foundation-1-0` | `c23f012c4399f472eb6a9cae89b67fcc15a4ed40` | `main` | 45 | 165 | +27,636 / −340 |
| Garage & Mechanic Onboarding | **#209** | `feat/garage-mechanic-onboarding-1-0` | `a563fc156519903f40a32ed8c4532013a06bb9d7` | `main` | 135 | 369 | +64,428 / −1,154 |

`main` is still `bb9d9900c700873ca57df0ac18a1a5c01f77711a` and is the merge-base of #208 and #197. All three PRs remain **OPEN, DRAFT, UNMERGED and mergeable** at inspection time.

> **Self-reference note.** The commit that updates this manifest is documentation-only, so the branch head after this file is written will necessarily be one commit newer than the inspected `a563fc15`. The ancestry/product findings below are measured against `a563fc15`; the governance correction changes no runtime, schema, harness, migration or workflow file.

---

## 1. What changed since the previous parent-first snapshot

The previous snapshot measured O2 at `71b81d74dc55d36a15f74b4e77170e3438991f85`, Service Network at `c23f012c…`, and GMO before the final documentation-only commits. At those heads, both parent tips were literal ancestors of #209.

That statement is **no longer true for current #208**.

Current graph facts:

```text
#197 c23f012c  → #209 a563fc15     ancestor: YES
#208 7fe1f821  → #209 a563fc15     ancestor: NO
merge-base(current #208, #209)     71b81d74dc55d36a15f74b4e77170e3438991f85
#209 vs current #208               ahead 96, behind 2
current #208 vs current #197       merge-base = main; 41 O2 commits vs 45 SN commits
```

So #209 still contains **all current Service Network** and the **39-commit O2 snapshot** that ended at `71b81d74`, but it does **not** contain O2's newest two commits.

Using the current PR commit counts and proven ancestry:

```text
current SN commits beyond main                      45
O2 snapshot already inside #209                    39
#209-only history at inspected a563fc15             51
                                                   ---
current #209 PR commits                            135

current O2 commits beyond main                     41
current SN commits beyond main                     45
                                                   ---
current parent union                               86
```

The original product-focused GMO delta at the earlier convergence point was **49 commits**. Two later #209-only commits were documentation: the parent-first inspection receipt and the invalid owner-acceptance status commit. This governance correction adds one more documentation-only commit. Do not confuse the resulting history count with additional product implementation.

**Current integration consequence:** after current #208 and #197 are present in `main`, #209 cannot simply be treated as already containing both exact parent tips. The two newer O2 commits must be semantically reconciled into the GMO integration candidate first, then the affected gates must be re-certified at that exact post-parent head.

---

## 2. The two new O2 commits and their exact surface

Compared with the O2 snapshot already inside #209 (`71b81d74`), current #208 adds exactly **two commits** touching six files:

1. `backend/routes/identityVerificationAdminRoutes.js` — owner-UAT closure of the identity decision step-up requirement. #209 already independently carries the same **SENSITIVE** step-up behaviour through GMO convergence; preserve the semantic gate and reconcile comments/provenance rather than blindly choosing a side.
2. `backend/services/passport/passportOwnershipTransferService.js` — governed RPC refusals translated to truthful 4xx outcomes instead of generic database 500s. This later O2 correction is not in #209's old O2 snapshot and must be carried forward.
3. `backend/tests/o2-owner-uat-closure.test.js` — ten owner-UAT closure guards; carry forward.
4. `docs/features/o2/CARUP_OPERATIONS_O2_OWNER_UAT_RESULT.md` — owner-UAT receipt; carry forward as parent evidence.
5. `docs/features/o2/CARUP_OPERATIONS_O2_PROGRESS.md` — current O2 status; carry forward as parent evidence.
6. `web/src/components/workbook/WorkbookWorkspace.tsx` — mobile overflow fix at the owner-UAT boundary; carry forward.

These additions do **not** reopen GMO's frozen authority decisions. They are parent-lane advancement that the eventual GMO integration candidate must inherit.

---

## 3. Dependency matrix — unchanged in authority, changed in exact heads

| programme | current head | depends on sibling lane? | owns | integration requirement |
|---|---|---|---|---|
| **O2 #208** | `7fe1f821` | no Service Network dependency proven | identity lifecycle/assurance, operations authorization, dealer onboarding, workbook, O2 owner-UAT closures | parent; may land before SN by governance preference |
| **SN #197** | `c23f012c` | no O2 dependency proven | garage directory/profile, Service Case, Work Order/assignment, Service Record, Service Link, service projections | parent; current tip is already an ancestor of #209 |
| **GMO #209** | inspected `a563fc15` + docs-only governance correction | **BOTH** | garage application/evidence/review/activation, founding membership, invitation/revocation, OCR provider convergence | **must land last**; must first inherit current #208's two newer commits |

The earlier dependency proof remains valid: O2 and Service Network are mutually independent at the programme boundary; GMO imports authority from both. Thus **O2 → SN → GMO remains the preferred parent-first order**, while O2-vs-SN ordering is a governance preference rather than a runtime dependency. GMO last is the hard requirement.

---

## 4. Migrations — no new collision introduced

The migration picture is unchanged by #208's two owner-UAT closure commits: they add **no migrations**.

| lane | migrations | range |
|---|---:|---|
| O2 #208 | 6 | `20260903200000_identity_lifecycle_events` … `20260904090000_workbook_store_scope_loosening` |
| SN #197 | 8 | `20260904120000_service_network_s1_garage_identity` … `20260904190000_service_network_o5_thread_type` |
| GMO #209 | 6 | `20260906090000_garage_applications` … `20260906220000_tenant_users_role_catalogue` |

No filename collision was introduced. GMO's six migrations remain `garage_applications`, `garage_application_evidence`, `garage_business_activation`, `garage_invitations`, `garage_onboarding_rls`, and `tenant_users_role_catalogue`.

---

## 5. Semantic reconciliation register

The prior register remains load-bearing. Never resolve these with blind `ours` / `theirs`:

| surface | reconciliation rule |
|---|---|
| `backend/server.js` | union of all route mounts; keep GMO `documentVision` health provenance |
| `web/src/App.tsx` | union of routes |
| `web/src/config/featureRegistry.ts` + `shared/navigation/feature-manifest.json` | union entries; re-derive count/shape assertions |
| `web/src/hooks/useCarUpApi.ts` | union hooks; preserve destructured consumption pattern |
| Communications listeners/notification service | union event registrations; drop neither parent |
| preview frontend/backend pairing maps | keep one branch-specific entry per lane; fail closed if absent |
| SN-owned service/garage route files | take current SN behaviour and preserve GMO's **opt-in tenant-membership authorization**; never globally widen tenant role into platform role |
| `backend/services/identity/verificationSessionService.js` | preserve O2 authority plus GMO extraction/classification independence and classifier seam |
| `backend/services/document-intelligence/documentIntelligenceService.js` | preserve O2 authority and GMO OCR-provider boundary convergence |
| `backend/routes/identityVerificationAdminRoutes.js` | preserve current O2 owner-UAT step-up and GMO's same SENSITIVE decision gate; reconcile semantically |
| `backend/services/operations/operationsAuthorizationService.js` | O2 owns; GMO consumes |
| `backend/tests/service-network-authority-boundaries.test.js` | preserve SN tenancy-writer invariant and GMO `activate_garage_application` permitted writer |
| navigation/design/count gates | re-derive against the actual post-parent tree; do not pin stale counts |

**Late-O2 carry-forward surface:** additionally preserve the new ownership-transfer error semantics, owner-UAT closure test/receipts, and workbook mobile fix listed in §2.

---

## 6. Certification after parent-first reconciliation

Current exact-head CI being green is necessary but is not a substitute for post-parent certification. Once #208 and #197 are integrated and #209 has reconciled the two late O2 commits, rerun at the **new exact candidate head**:

- O2 integrated/owner-UAT closure guards affected by the parent update;
- Service Network authority-boundary guards;
- GMO-1 … GMO-7 focused tests;
- `gmo-qwen-ocr-convergence` and `o2-identity-review-contract` without spending another live-provider call unless separately necessary/authorised;
- navigation/feature-registry/design count gates;
- real-PostgreSQL migration/integrity harnesses;
- full backend and web suites, typecheck, lint and build;
- exact-head GitHub CI and paired staging provenance;
- physical browser / database readback only for journey portions invalidated by an actual runtime change.

The **8-way activation race was executed and remains immutable GMO-4 evidence**. The standalone race harness is retained at `scripts/uat/gmo-4-activation-race.mjs`; it is not currently an automatically invoked step in the generic PR `ci.yml`, so do not claim that every PR CI reruns it. If activation authority is touched during reconciliation, rerun the real race before recertifying activation.

The live Qwen provider proof is also immutable evidence for the certified product tree. The provider-consumption workflow is manual-dispatch only by design. Do not repeat it merely because documentation or parent ancestry moved.

---

## 7. Current integration decision

**Not ready to merge #209 merely because GMO is technically complete.** The next integration action, once the Product Owner separately authorises merges, is still parent-first:

1. integrate current **#208 O2**;
2. integrate current **#197 Service Network**, semantically reconciling shared registration surfaces and re-certifying that exact head;
3. reconcile **#209 GMO** on top of both, including #208's two late commits;
4. re-certify the affected GMO/O2/SN boundary at the exact post-parent head;
5. only then seek explicit Product Owner merge authorisation for #209.

This document **does not grant** owner acceptance of GMO, merge authorisation for any PR, production promotion, or live-provider spend.

---

## 8. Historical snapshot provenance

The earlier full parent-first inspection remains available verbatim in Git at commit `5bc3c96eaba410d98478ec2f8208d378029d0b2f`. Its key historical measurement was:

- O2 head `71b81d74` — literal ancestor of the then-current #209 tree;
- Service Network head `c23f012c` — literal ancestor;
- parent union + original GMO implementation delta = full #209 history at that time;
- original GMO product-focused delta: 49 commits / roughly 100 files / 75 files unique to GMO;
- O2 and SN mutually independent; GMO depends on both;
- no merge performed.

Those statements are retained as chronology. **The only conclusion superseded by this refresh is the claim that #209 contains the exact current #208 tip in full. It does not.**
