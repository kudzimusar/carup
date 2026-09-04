# Seller Join Boundary and Contract

**Status:** live for the non-Seller hardening cycle.
**Purpose:** let non-Seller hardening proceed concurrently with an independently owned
Seller remediation lane, without either lane editing the other's files, and define exactly
how the finished Seller candidate joins the hardened platform.

---

## 1. Authorities this boundary was drawn against

Every SHA below was re-fetched and independently verified at the start of this cycle. No
figure here is carried over from an earlier session.

| Ref | Branch | SHA | State |
|---|---|---|---|
| `main` | `main` | `ba208963d863654157335189c60f587cbe330041` | — |
| PR #194 | `integration/vehicle-passport-v16-cert` | `43204beeec40123b0cce0c457aded6d0f733c4bc` | open, Draft, base `main` |
| PR #196 | `docs/service-network-foundation-1-0-plan` | `30728299e9e60b1c1d51b3eff8363db080edf22f` | open, Ready, base `main` |
| PR #197 | `feat/service-network-foundation-1-0` | `5683b74edaaa86a01c55005839b8f092aea8fccb` | open, Draft, base `main` |
| Hardening lane | `hardening/non-seller-convergence` | branched from `43204bee` | this cycle |

### The active Seller lane is PR #200, not PR #198

PR #198 (`fix/seller-uat-account-handoff-194`) **merged into #194 on 2026-08-30T03:29:48Z**
and its head is now identical to #194's head. It is history, not the current Seller product.

The live Seller remediation is **PR #200 — `fix/seller-uat-convergence-final-194`**, Draft,
based on `integration/vehicle-passport-v16-cert`. Its head advanced during this cycle
(17 files → 24 files while hardening was in progress), which is direct evidence that another
agent owns it right now.

`43204bee` therefore does **not** represent final Seller truth, and this cycle never treats
it as such.

---

## 2. The exclusion boundary

### 2.1 HARD exclusion — files the other agent is actively editing

Derived from the live diff of PR #200. **Not read-only-by-convention: untouchable.** A
non-Seller fix that appears to need one of these is recorded as a join obligation instead.

```
.github/workflows/seller-exact-head-staging-uat.yml
backend/services/marketplace/listingSummaryService.js
docs/seller/SELLER_MARKETPLACE_PARITY_MATRIX.md
docs/seller/SELLER_UAT_CONVERGENCE_EXECUTION_PLAN.md
tests/agents/38-seller-staging-browser-golden.spec.ts
tests/agents/seller-uat-automation-cleanup.mjs
web/src/App.tsx
web/src/components/dashboard/WorkspaceHeader.tsx
web/src/components/intelligence/MarketplacePulse.tsx
web/src/components/layout/DashboardLayout.tsx
web/src/components/marketplace/MarketplaceListingCard.tsx
web/src/components/sell/SellerIntentRouter.tsx
web/src/config/featureRegistry.ts
web/src/pages/GuestSell.tsx
web/src/pages/Landing.tsx
web/src/pages/Marketplace.tsx
web/src/pages/auth/LoginErrorAlert.tsx
web/src/pages/auth/Register.tsx
web/src/pages/dashboard/owner/EvidenceVault.tsx
web/src/pages/dashboard/owner/MyGarage.tsx
web/src/pages/dashboard/owner/MyListings.tsx
web/src/pages/dashboard/owner/OwnerDashboard.tsx
web/src/pages/dashboard/owner/SellVehicle.tsx
web/src/pages/dashboard/owner/VehicleProfile.tsx
```

This list is a snapshot. **Re-derive it before any future edit** with
`gh pr diff 200 --name-only`; it grows as the Seller lane works.

Three entries are load-bearing beyond Seller and will be the real join friction:
`web/src/App.tsx` (routing), `web/src/config/featureRegistry.ts` (feature/route registry),
and `web/src/components/layout/DashboardLayout.tsx` (shell). Any non-Seller change that
would touch them is deferred by design — see the obligations register.

### 2.2 DOMAIN exclusion — Seller behaviour that must not be redesigned

Settled in #194 via the merged #198. May be **read and tested**; may not be redesigned by
this cycle.

```
backend/routes/authRecoveryRoutes.js
backend/services/auth/registrationProfileService.js
backend/services/auth/authEmailService.js
backend/scripts/seller-registration-profile-staging.mjs
backend/tests/auth-registration-profile.test.js
backend/tests/seller-*.test.js
database/migrations/20260829123000_user_registration_profiles.sql
docs/seller/**
.github/workflows/seller-*.yml
web/src/lib/guestSellDraft*
web/src/pages/SellFlow*, web/src/pages/Seller*
web/src/components/sell/**
```

Seller-independent Marketplace **buyer/discovery** contracts remain testable, because they
are consumed by Seller rather than owned by it.

### 2.3 Proof of non-interference for this cycle

Files changed by this lane relative to the #194 authority `43204bee`:

```
.gitignore
backend/env.example
backend/middleware/authMiddleware.js
backend/server.js                                    <- see the note below
backend/services/blockchain/blockchainKeyCustodyService.js
backend/services/blockchain/blockchainService.js
backend/services/diaspora/diasporaOwnershipHandoffService.js
backend/services/document-intelligence/documentIntelligenceRouter.js
backend/services/eventBus/listeners.js
backend/services/finance/financeService.js
backend/services/insurance/insuranceService.js
backend/services/partsentry/partsentryService.js
backend/services/security/securityService.js
backend/tests/helpers/issue158LedgerHarness.mjs
backend/tests/issue-158-boundary-upgrade-postgres.test.js
backend/tests/issue-158-private-key-custody.test.js
backend/tests/issue-158-terminal-operation-identity.test.js
backend/tests/non-seller-authority-hardening.test.js
backend/tests/passport-v16-postgres-authorities.test.js
database/migrations/20260830060000_issue158_terminal_operation_identity.sql
database/scripts/issue158_private_key_custody_finalize.sql
docs/convergence/NON_SELLER_CONVERGENCE_HARDENING_EXECUTION_LEDGER.md
docs/hardening/**
web/src/pages/dashboard/mechanic/PartsTracking.test.tsx
web/src/pages/dashboard/mechanic/PartsTracking.tsx
```

**Intersection with §2.1 (the ACTIVE Seller lane, PR #200): EMPTY.** Verified mechanically:

```sh
comm -12 <(gh pr diff 200 --name-only | sort) <(git diff --name-only 43204bee..HEAD | sort)
```

**Intersection with §2.2 (the Seller DOMAIN list): one file, `backend/server.js`** — and the
raw set-intersection overstates it, so state it plainly rather than let it read as a breach.

`backend/server.js` appears in the merged PR #198's diff, which is why it lands in the domain
list mechanically. It is **not** in PR #200 (`gh pr diff 200 --name-only | grep -c
backend/server.js` → `0`), so no agent is editing it. It is also the application's shared
entry point, touched by every lane; treating it as Seller-owned would freeze the whole
backend. §2.2 therefore names Seller *behaviour* files explicitly and does not list it.

The three changes made to it are all non-Seller, and none touches a Seller route or handler:

1. import `authorizeSessionRole` alongside the existing auth imports;
2. gate the `/api/verification` router mount (a trust/registry surface, not a Seller one);
3. add boot-time validation for three production secrets.

## 3. Seller join obligations register

Items this cycle deliberately did **not** resolve because resolving them would have meant
editing a Seller-owned file or pre-empting a Seller decision. Each must be reconciled when
Seller joins.

| ID | File / contract | Current assumption | Required final behaviour | Verifying test | Why it must wait |
|---|---|---|---|---|---|
| SJO-1 | `web/src/App.tsx` | Route table is whatever #200 lands. | Exactly one route per path; no duplicate `/sell*` or owner-dashboard registrations after the join. | `web/src/lib/routeAccess.advancement.test.ts`, `web/src/components/routing/RegistryRouteBoundary.test.tsx` | Both lanes' route edits land in one file; a pre-merge edit guarantees a conflict and can silently drop a Seller route. |
| SJO-2 | `web/src/config/featureRegistry.ts` | Registry is whatever #200 lands. | Registry and manifest agree; no orphaned or duplicated feature ids. | `web/src/config/featureManifest.drift.test.ts` | Same file, both lanes; the drift test is only meaningful against the joined registry. |
| SJO-3 | `web/src/components/layout/DashboardLayout.tsx`, `web/src/components/dashboard/WorkspaceHeader.tsx` | Shell/nav is whatever #200 lands. | One shell, one nav authority; owner and mechanic surfaces share it. | `web/src/components/layout/dashboardSidebar.visibility.test.ts` | Actively edited by the Seller lane this cycle. |
| SJO-4 | `backend/services/marketplace/listingSummaryService.js` | Seller lane is changing listing summary shape. | Buyer/discovery projection stays truthful: no unrecorded field rendered as a measured value. | `web/src/lib/marketplacePresentation.test.ts`, `web/src/lib/sellerListingPreview.media.test.tsx` | The summary contract is being rewritten inside #200. |
| SJO-5 | `web/src/pages/dashboard/owner/*` | Owner surfaces are Seller-owned this cycle. | The "unknown is not zero" rule proven for mechanic PartsTracking must hold on every owner tile too. | new sibling of `PartsTracking.test.tsx` per surface | Six of these files are in the hard-exclusion set; fixing them now would collide. See §5.2. |
| SJO-6 | `web/src/pages/SellFlow.identification.test.tsx` **(reproduced: fails 2 of 3 saturated full-suite runs, always the same test)** | Three tests wait on **real wall-clock timers**: `waitFor(..., { timeout: 3000 })` against a real debounce, plus a literal `await new Promise(r => setTimeout(r, 700))`. | Deterministic timing — fake timers, or a seam that resolves the identification check without a wall-clock wait. | the same three tests, run three times under load | Latent load-sensitivity, not a demonstrated CI flake: it did **not** fail in CI, only under the artificial CPU saturation this cycle produced, where the 3000 ms budget was exceeded. The suite-wide `asyncUtilTimeout` raised for the non-Seller flakes does **not** help here, because these three tests carry their own explicit caps and a literal sleep. Seller-owned, and the Seller lane may be rewriting these very tests as part of UAT convergence — so it is recorded, not edited. |
| SJO-7 | `web/src/pages/SellFlow*`, `web/src/pages/Seller*` | Not audited for the "unknown is not zero" rule. | Same rule as SJO-5. | per-surface | Domain-excluded; testing them is fine, redesigning them is not. |

Additional obligations discovered by the cross-system authority audit are appended to this
register in the hardening receipt rather than duplicated here.

---

## 3.1 Seller join obligations — DISPOSITION (V16 convergence)

Closed against the actual joined head, not against intent. Every row carries an executable
verifier; none was closed by inspection alone.

| ID | Disposition | Evidence |
|---|---|---|
| SJO-1 | **CLOSED** | `App.tsx` carries 119 `path=` literals with ZERO duplicates. `routeAccess.advancement.test.ts` + `RegistryRouteBoundary.test.tsx` green. No orphaned or duplicated Seller/owner route survived the join. |
| SJO-2 | **CLOSED** | `featureManifest.drift.test.ts` green; the registry carries no duplicate feature id. The Seller lane adds exactly ONE entry versus main — `owner.intelligence`, placements `['dashboard_sidebar','user_menu']`, roles `['owner']` — so `roleItemCounts['owner']` moves 20 → 21 and no other role moves. Recomputed from the live registry in `tests/agents/27-feature-registry-navigation-map.spec.ts`, never hand-added. |
| SJO-3 | **CLOSED** | `dashboardSidebar.visibility.test.ts` green. One shell, one nav authority; owner and mechanic surfaces share it. |
| SJO-4 | **CLOSED** | Two truthfulness defects found on the joined projection and fixed: (a) `AllInPricePanel` substituted `'USD'` for a currency the SAME payload reports as not recorded — re-creating one layer out exactly the fabrication `marketplacePricingService` removed. The shared `MarketplacePricingSummary` type was missing `currency_state`/`currency_source`/`estimate_denomination`, which is WHY the panel fell back to a default; the declaration now matches the authority. (b) `VehicleHistoryObligationsSections` rendered an UNREAD disclosures block as "the seller has not answered this question" — attributing CarUp's own read failure to the seller. Verifiers: `AllInPricePanel.test.tsx` (6, incl. anti-vacuity that a RECORDED currency still prints and that a stateless legacy payload does not regress) and `VehicleHistoryObligationsSections.test.tsx` (15). |
| SJO-5 | **CLOSED** | The Notifications card on `OwnerDashboard` rendered a measured "0 new" beside an empty list both BEFORE the read settled and AFTER it failed, while the same file already gated `unreadNotifications` on `notificationsState`. Now three distinct states. Verifier: `OwnerDashboard.truthfulness.test.tsx` — 4 new cases including the anti-vacuity that a SUCCESSFUL empty read still says zero, because a measured zero is correct. |
| SJO-6 | **CLOSED** | The recorded flake is gone at its cause, not hidden. `SellFlow.identification.test.tsx` waited on the WALL CLOCK — three `waitFor(..., { timeout: 3000 })` against a real 400 ms debounce plus a literal 700 ms sleep. Real time is now removed: `vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout'] })` fakes ONLY the timers, and the debounce is advanced deterministically. No budget was raised and no retry was added. 8/8, green on three consecutive runs. |
| SJO-7 | **CLOSED** | `identifySellerVehicle` asked `isTransportFailure(error)` and DEFAULTED TO FALSE, so any error whose message did not match a network-ish word became `no_carup_record` — and that state's copy tells the seller "CarUp holds no Passport for this VIN yet. Continuing will start one." A 500/503/401/429, or any failure whose body supplied its own message, therefore invited a DUPLICATE Vehicle Passport off a server fault. Inverted to fail closed: only a positive not-found (status 404, or a 404/not-found message when no status is present) produces `no_carup_record`. Verifier: `sellerVehicleIdentification.test.ts` — 4 new cases incl. status-wins-over-message and an anti-vacuity twin. |

### R27 — disposed, not left ambiguous

**CLOSED**, and source/test resolvable rather than provider-gated: the publicly visible
claim→event→repair chain comes from `vehicle_evidence` class mapping, `vehicles.seller_*_disclosure`
and `partsentry_logs`; `insurance_records` is privileged-only and reports
`source_states.insurance_registry = 'unavailable'` publicly, so no insurer feed is required.
Verifier: `backend/tests/r27-durable-history-survives-commerce.test.js` — 9/9. The provider-gated
`[~]` items (M16–M18, R22–R26, R28) keep their qualifications unchanged; none was upgraded.

### What the independent audit added

A 47-agent read-only audit of the joined head, with every finding handed to three adversarial
verifiers instructed to REFUTE it, produced **four surviving findings** beyond the SJO rows above.
All four are fixed; the four findings it raised against surfaces already corrected during the same
cycle were REFUTED by verifiers reading current source, which is independent confirmation those
fixes landed.

| Finding | Fix |
|---|---|
| `listingSummaryService.js:939` — a FAILED `vehicle_evidence` / `partsentry_logs` read published as a governed all-clear | `{ ok, rows }` discriminator; `buildTrustSummary` fails closed to `'unavailable'`; `TrustSummaryPanel` renders "Not checked". See the CLOSED entry in `AUTHORITY_AUDIT_REGISTER.md`. Verifier: `marketplace-trust-inputs-unreadable.test.js` (8). |
| `SellerIntelligence.tsx:362` — a failed owned-vehicles read rendered an empty comparison table, reading as "you have no listings" | the vehicles read is now tracked separately from the pulse read; unread and empty are distinct messages. |
| `VehicleProfile.tsx:546` — every governed insurance record printed a blank provider and a bare `"$/year"` with no figure | the renderer read `ir.provider`/`ir.premium`, which the passport-timeline mapper never sets; it set `insurer`. The `as unknown as InsuranceRecord[]` cast that let that shape through is removed and the type made honest, so the compiler now checks the mapper. |
| `SellerDocumentAutofillNotice.tsx:27` — a failed OCR health read was written as an empty successful result, rendering "Coming soon on this preview" | a distinct `readFailed` state; the measured negative still renders. |

Verifier for the last three: `web/src/pages/dashboard/owner/ownerSurfaces.truthStates.test.tsx` (9).

One methodological note worth keeping: the verification ran CONCURRENTLY with the fixes, so four
findings show as "refuted" purely because the verifiers read source that had already been corrected.
A refuted verdict in that window means "not present now", not "was never real" — each of those four
was confirmed against the original source before it was changed.
