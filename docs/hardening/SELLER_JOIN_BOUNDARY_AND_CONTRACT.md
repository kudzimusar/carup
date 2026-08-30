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

Files changed by `hardening/non-seller-convergence`:

```
.gitignore
backend/services/blockchain/blockchainService.js
backend/services/eventBus/listeners.js
backend/services/finance/financeService.js
backend/services/insurance/insuranceService.js
backend/services/partsentry/partsentryService.js
backend/services/security/securityService.js
backend/tests/helpers/issue158LedgerHarness.mjs
backend/tests/issue-158-boundary-upgrade-postgres.test.js
backend/tests/issue-158-terminal-operation-identity.test.js
database/migrations/20260830010000_issue158_ledger_operation_identity.sql
docs/hardening/**
web/src/pages/dashboard/mechanic/PartsTracking.test.tsx
web/src/pages/dashboard/mechanic/PartsTracking.tsx
```

Set intersection against §2.1 and §2.2 is **empty**, verified mechanically:

```sh
comm -12 <(gh pr diff 200 --name-only | sort) <(git diff --name-only 43204bee..HEAD | sort)
```

---

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

Additional obligations discovered by the cross-system authority audit are appended to this
register in the hardening receipt rather than duplicated here.

---

## 4. Seller Join Contract

### 4.1 Seller MUST consume, never re-implement

| Concern | Canonical authority Seller must use |
|---|---|
| Authentication / session | the custom backend auth (**not** Supabase Auth — `auth.users` is empty by design) |
| Identity | the canonical user/identity service |
| Ownership | the canonical ownership/transfer authority (`20260828203000_passport_ownership_transfer_authority`) — seller identity is `current_seller_id`, never `owner_id` |
| Vehicle Passport | the canonical passport projection |
| Trust | `canonicalTrustService` — the single trust authority |
| Evidence | the canonical evidence authority and its taxonomy |
| Marketplace publication | the canonical publication authority |
| Communications | the canonical communications routing + outbound transport |
| Intelligence | the canonical activity ledger and rollups — observation only |
| Lifecycle / events | `blockchainService.addEvent` and the existing event/outbox architecture |

### 4.2 Seller MUST NOT introduce

- a second ownership model;
- a second trust score authority, or any client-supplied trust value;
- a second Passport lifecycle;
- a second communication transport, or a direct provider call;
- a second analytics writer;
- a duplicate evidence authority;
- alternate listing publication semantics;
- client-owned security decisions;
- a second ledger writer. **Any Seller ledger write goes through `addEvent` and must
  supply a durable `operationId`** from state Seller has already committed. See §4.3.

### 4.3 The ledger contract Seller inherits from this cycle

`addEvent(vin, eventType, payload, signature, { operationId })` now requires a **durable
operation identity** for any write that lands on the terminal instant, and records one
whenever the caller has one.

Durable means: derived from state the caller has **already committed**, so a fresh retry
recomputes it and a genuinely new invocation cannot. A value minted inside the write path
(`randomUUID()`, `Date.now()`) is not an identity and is explicitly rejected.

Namespaced form: `<namespace>:<durable-id>`, e.g. `partsentry_log:4711`.
Existing namespaces: `partsentry_log`, `insurance_policy`, `finance_application`,
`stolen_alert`, `stolen_clear`, `reservation_recorded`, `escrow_initiated`.

Seller must claim its own namespace(s) and must not reuse another domain's.

---

## 5. Seller Join Verification Battery

Run in this order as soon as the final Seller candidate is merged into the hardened #194.
Every item is executable; none is a review opinion.

### 5.1 Seller behaviour

| # | Check | Command / evidence |
|---|---|---|
| B1 | Seller unit + contract suites green | `cd web && npx vitest run src/pages/SellFlow* src/pages/Seller* src/lib/guestSellDraft*` |
| B2 | Seller backend contracts green | `node --test backend/tests/seller-*.test.js backend/tests/auth-registration-profile.test.js` |
| B3 | Seller Golden staging UAT | `.github/workflows/seller-exact-head-staging-uat.yml` at the joined head |
| B4 | Registration/profile staging gate | `.github/workflows/seller-registration-profile-staging.yml` |

### 5.2 Invariants Seller must preserve in the rest of the platform

| # | Invariant | How it is proven |
|---|---|---|
| B5 | **One route per path.** No duplicate registration after both lanes' `App.tsx` edits merge. | `routeAccess.advancement.test.ts`, `RegistryRouteBoundary.test.tsx`, plus a grep for duplicate `path=` literals |
| B6 | **Registry/manifest agree.** | `featureManifest.drift.test.ts` |
| B7 | **One trust authority.** No Seller path writes a trust score. | `grep -rn "trust_score" backend/services` → writes only via `canonicalTrustService` |
| B8 | **One ownership authority.** | no Seller `.from('vehicles').update` touching ownership columns |
| B9 | **One ledger writer, with durable identity.** | `node --test backend/tests/issue-158-terminal-operation-identity.test.js` — includes a source contract asserting every stakeholder writer binds a durable identity; extend its writer table with Seller's |
| B10 | **Terminal ledger invariants intact.** | `node --test backend/tests/issue-158-*.test.js` — 24 checks, incl. 3 mutation kills |
| B11 | **Unknown is not zero.** No Seller surface renders an unread value as a measured zero. | the `parts-not-yet-counted` pattern; assert each Seller tile is absent before its read settles |
| B12 | **No second communication transport.** | `grep -rn "nodemailer\|twilio\|whatsapp" backend/services` outside the canonical communications service |
| B13 | **No duplicate analytics writer.** | `grep -rn "activity_ledger\|analytics_events" backend/services` — one writer |
| B14 | **Migration integrity.** Seller's migrations carry `-- +migrate Up`, use unused version names and never edit a published migration. | `node --test backend/tests/migration-integrity*.test.js` + `git diff origin/main -- database/migrations/` shows only additions |
| B15 | **Tenant isolation.** No Seller query drops `tenant_id` scoping. | `node --test backend/tests/db-compat-legacy-scopes.test.js` |
| B16 | **Full non-Seller battery still green at the joined head.** | the §14 battery in the hardening receipt, re-run unchanged |

### 5.3 Determinism gate

B5–B16 must pass **three consecutive times** on the joined head. This cycle closed a real
flake by fixing its cause (`PartsTracking` rendered measured zeros before its read settled,
so `findByTestId` could resolve against the pre-read paint). A single green run would not
have caught it; three would.

---

## 6. Status

- **FINAL SELLER INTEGRATION NOT YET CERTIFIED.**
- **FINAL #194 RECEIPT NOT YET AUTHORIZED.**
- **#197 FINAL REBASE NOT YET PERFORMED.**
- **PRODUCTION NOT ACTIVATED.**

Next trigger: **FINAL SELLER CANDIDATE READY.**
