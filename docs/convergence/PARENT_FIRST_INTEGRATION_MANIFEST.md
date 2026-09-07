# Parent-first integration manifest — #208 O2, #197 Service Network, #209 GMO

**Inspection only. No merge is authorised by this document, and none was performed.**

Measured at:

| lane | PR | branch | exact head | base | files | diff |
|---|---|---|---|---|---|---|
| O2 People & Compliance | **#208** | `feat/operations-o2-people-compliance` | `71b81d74dc55d36a15f74b4e77170e3438991f85` | `main` | 138 | +20 387 / −713 |
| Service Network Foundation | **#197** | `feat/service-network-foundation-1-0` | `c23f012c4399f472eb6a9cae89b67fcc15a4ed40` | `main` | 165 | +27 636 / −340 |
| Garage & Mechanic Onboarding | **#209** | `feat/garage-mechanic-onboarding-1-0` | `cfecc9eaae55cd83a402d595de1d6e9b8b70724b` | `main` | 368 | +64 256 / −1 154 |

`main` = `bb9d9900c700873ca57df0ac18a1a5c01f77711a`. All three share that exact merge-base.

---

## 1. The finding that changes the shape of the work

**#209 already contains both parents in full, by ancestry — not by copying.**

```
git merge-base --is-ancestor 71b81d74 cfecc9ea   → true   (#208 tip is an ancestor of #209)
git merge-base --is-ancestor c23f012c cfecc9ea   → true   (#197 tip is an ancestor of #209)

commits beyond main:   O2 1991   SN 1471   GMO 2085
O2 ∪ SN                                    2036
GMO-only (in #209, in neither parent)        49
                                          -----
                                     2036 + 49 = 2085  ✔ exact
```

Every one of O2's 1 991 commits and every one of SN's 1 471 commits is *literally* in #209.
**#209 is precisely `O2 ∪ SN ∪ 49 GMO commits`**, with nothing else and nothing missing.

Consequence: there is **no textual reconciliation to do between #209 and its parents**. Once both
land in `main`, `main…#209` collapses to those 49 commits. The 368-file diff is not GMO's work; it
is the two parents being counted against a `main` that does not yet contain them.

---

## 2. Dependency matrix — proven from code, not assumed

| programme | head | base | depends on | owns | overlaps | must land |
|---|---|---|---|---|---|---|
| **O2 #208** | `71b81d74` | `main` | **nothing in these lanes** | identity lifecycle & assurance, authentication assurance/step-up, operations authorization, dealer onboarding, biometrics (ARCH), workbook | 9 registration files with SN | **first or second — free** |
| **SN #197** | `c23f012c` | `main` | **nothing in these lanes** | garage directory/profile, Service Case, Work Order + assignment, Service Record, service links, tenant garage identity | the same 9 registration files with O2 | **first or second — free** |
| **GMO #209** | `cfecc9ea` | `main` | **BOTH** (proven below) | garage application, evidence, review, activation, founding membership, invitation, revocation, OCR provider boundary | 25 files with one or both parents | **last, necessarily** |

### The parents are mutually independent

`git grep` across #197 for any import of `identity|operations|auth/authentication` → **none**.
`git grep` across #208 for any import of `serviceNetwork` → **none**.

So **O2-before-SN is not forced by dependency.** The governance expectation of O2 → SN → GMO is
correct for GMO, but between the two parents the order is free; whoever merges *second* simply
reconciles the nine shared registration files. Choosing O2 first remains sensible (it is the smaller
diff and owns the identity primitives everything else eventually reads), but it should be recorded
as a **preference, not a constraint**.

### GMO depends on both — from imports, not from narrative

```
GMO → O2   garageReviewService.js    → services/identity/identityAssuranceService.js
           garageReviewRoutes.js     → services/operations/operationsAuthorizationService.js
           garageReviewRoutes.js     → services/auth/authenticationAssuranceService.js
GMO → SN   garageApplicationService  → services/serviceNetwork/garageDirectoryService.js
           garageInvitationService   → services/serviceNetwork/serviceLinkService.js
```

and Act 6b drives SN's own routes end to end: `/api/service-cases`, `/api/service-cases/:id/accept`,
`/api/service-cases/:id/work-order`, `/api/service-work-orders/:id/assign|status|records`,
`/api/garage/queue|mechanics|profile|profile/publish`.

---

## 3. Migrations — the schema states the order by itself

No filename collisions between any two lanes. Migrations apply in filename order, and the three
lanes are chronologically disjoint:

| lane | migrations | range |
|---|---|---|
| O2 #208 | 6 | `20260903200000_identity_lifecycle_events` … `20260904090000_workbook_store_scope_loosening` |
| SN #197 | 8 | `20260904120000_service_network_s1_garage_identity` … `20260904190000_service_network_o5_thread_type` |
| GMO #209 | 6 | `20260906090000_garage_applications` … `20260906220000_tenant_users_role_catalogue` |

**GMO's six migrations are the whole of its schema:**
`garage_applications`, `garage_application_evidence`, `garage_business_activation` (the
`activate_garage_application` function), `garage_invitations`, `garage_onboarding_rls`,
`tenant_users_role_catalogue`.

Worth stating precisely: GMO's migrations reference only `tenants`, `tenant_users`, `users` and its
own tables — **all pre-existing in `main`**. So GMO's *schema* is independent of both parents even
though its *runtime* is not. Migration order is therefore safe in any sequence; only the code needs
the parents.

---

## 4. The genuine #209 delta — 49 commits, 100 files

75 files are touched **only** by GMO and by neither parent. 25 are shared and need semantic
reconciliation (§5).

| area | count | what |
|---|---|---|
| backend services | 7 | `services/garageOnboarding/*` — application, evidence, review, activation, membership, invitation, context |
| backend routes | 4 | garage onboarding, review, invitation, membership |
| OCR provider boundary | 5 | `ai/ocrVisionProvider.js`, `ai/CloudflareVisionClient.js`, `ai/GeminiClient.js`, `identity/documentClassifier.js`, `middleware/authMiddleware.js` |
| migrations | 6 | as above |
| backend tests | 12 | `gmo-1…7`, Qwen convergence, identity review contract, Cloudflare boundary, classifier, Gemini parser |
| web | 17 | GarageSetup/Evidence/Team, GarageApplications, JoinGarage, GarageContextSwitcher, StepUpPrompt, DealerCompliance step-up, libs + tests |
| UAT harnesses | 8 | `gmo-4-activation-race`, `gmo-8-*`, `lib/documentVisionReadiness` |
| docs | 15 | GMO receipts 1–8, lane reconciliation, evidence, convergence manifest, O2 resilience follow-up |
| workflows | 1 | `gmo-8-qwen-classification.yml` (manual dispatch only) |

**That is what #209 becomes once its parents land: ~49 commits over ~100 files, of which 75 are new
files nobody else touches.**

---

## 5. Semantic reconciliation register — the 25 shared files

Nine of these are shared by **all three** lanes and are the real integration surface. None may be
resolved with a blind `ours`/`theirs`; each is an append-a-registration file where every lane adds
its own entries.

| file | O2 | SN | GMO | reconciliation rule |
|---|---|---|---|---|
| `backend/server.js` | ✓ | ✓ | ✓ | **union of route mounts.** Each lane imports its own routers and mounts them; keep every import and every `app.use`. GMO additionally adds the `documentVision` health block. |
| `web/src/App.tsx` | ✓ | ✓ | ✓ | union of routes |
| `web/src/config/featureRegistry.ts` | ✓ | ✓ | ✓ | union of feature entries; the navigation-gate test counts them, so the count assertions must be re-derived after merge |
| `shared/navigation/feature-manifest.json` | ✓ | ✓ | ✓ | union of manifest entries |
| `web/src/hooks/useCarUpApi.ts` | ✓ | ✓ | ✓ | union of hooks — **destructure, never take the aggregate** (known render-loop hazard) |
| `backend/services/communication/communicationEventListeners.js` | ✓ | ✓ | ✓ | union of listeners |
| `backend/services/communication/communicationNotificationService.js` | ✓ | ✓ | ✓ | union of notification types |
| `web/preview-backend-pairing.json` · `preview-frontend-pairing.json` | ✓ | ✓ | ✓ | **one entry per branch.** Keep all; they are per-branch keys, not a shared value |
| `backend/routes/serviceCaseRoutes.js`, `serviceRecordRoutes.js`, `serviceWorkOrderRoutes.js`, `garageDirectoryRoutes.js`, `garageQueueRoutes.js` | | ✓ | ✓ | SN owns the files; GMO's only change is `authorizeTenantRole` (the opt-in tenant gate). **Take SN's file and re-apply the opt-in gate**, which is GMO-5's security closure |
| `backend/services/identity/verificationSessionService.js` | ✓ | | ✓ | O2 owns it; GMO adds the extraction-trust decoupling and the classifier injection seam |
| `backend/services/document-intelligence/documentIntelligenceService.js` | ✓ | | ✓ | O2 owns it; GMO converges extraction onto the OCR boundary |
| `backend/routes/identityVerificationAdminRoutes.js` | ✓ | | ✓ | O2 owns it; GMO adds the sensitive-action step-up on the decision route |
| `backend/services/operations/operationsAuthorizationService.js` | ✓ | | ✓ | O2 owns it; GMO consumes it |
| `backend/tests/o2-x7-integrated-certification.test.js` | ✓ | | ✓ | **X7-4 lane guard.** Its convergence-manifest resolution is now tree-derived; once both parents are in `main` the lane declaration becomes unnecessary and the guard should be re-pointed at the post-merge reality |
| `backend/tests/service-network-authority-boundaries.test.js` | | ✓ | ✓ | SN's enumerated tenancy-write invariant; GMO adds `activate_garage_application` as a permitted writer |
| `backend/tests/o2-x4-biometric-consent.test.js` | ✓ | | ✓ | O2 owns it |
| `tests/agents/27-feature-registry-navigation-map.spec.ts`, `web/src/__tests__/designContract.test.ts`, `web/src/hooks/garageSideRoutes.test.ts` | | ✓ | ✓ | count/shape assertions that must be re-derived after each merge |
| `docs/garage-mechanic-onboarding/…CANONICAL_PLAN.md` | | ✓ | ✓ | GMO owns it; SN created the stub |

---

## 6. Canonical integration order

1. **#208 O2** — no dependency on either sibling; smallest surface; owns the identity primitives.
2. **#197 Service Network** — no dependency on O2 either, so this is a *preference*. Reconcile the
   nine shared registration files against a `main` that now contains O2; re-derive the
   feature-registry and navigation count assertions; re-run SN's certification at that exact head.
3. **#209 GMO** — after both. Its `main…HEAD` collapses to the 49 commits above; re-apply the two
   GMO edits to SN-owned route files (the `authorizeTenantRole` opt-in) and the three to O2-owned
   identity files; re-derive counts; re-certify at the post-parent exact head.
4. Only then request Product Owner merge authorisation for #209.

### Gates that must be re-run after each step

`o2-x7-integrated-certification` (X7-4 lane guard — see §5), `service-network-authority-boundaries`,
`gmo-1…7`, `gmo-qwen-ocr-convergence`, `o2-identity-review-contract`, the navigation/feature-registry
count gates, the migration-integrity gate, and the full backend + web suites at each exact head.

---

## 7. What this inspection did not do

No merge, no PR retarget, no push to `main`, no production action. #197, #208 and #209 are untouched
and remain Draft.
