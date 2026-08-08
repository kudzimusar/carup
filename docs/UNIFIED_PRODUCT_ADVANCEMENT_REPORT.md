# CarUp Unified Product Advancement Report

**Date:** 2026-08-08
**Baseline:** PR #138 reunification head `5934fbd` (on `main` @ `f313fae` + reunification)
**Branch:** `integration/unified-product-advancement`
**Method:** four-seam product audit (buyer/seller, trust spine, navigation/admin/comms, diaspora/mobile) → Product Integration Gap Matrix → parallel implementation lanes → adversarial verification.

> Companion documents: the full per-seam gap matrices live in the audit section below;
> `docs/PROJECT_REUNIFICATION_REPORT.md` remains the record of what was unified and why.

---

## 1. The Product Integration Gap Matrix (audit summary)

Four read-only audits classified every step of the eight core journeys against the code
actually wired on the baseline. Headline counts: **10 P0-class defects, ~20 actionable P1s**,
and two stale-premise discoveries (the navbar mega-menus and the Diaspora Trade Graph UI
*already exist* and are registry-driven — contrary to standing docs).

### P0s found (all addressed in this pass)

| # | Defect | Where |
|---|---|---|
| 1 | Every listing was **publicly visible the instant it was created**: `publication_status` existed but no code advanced it and the public read path never filtered on it — directly contradicting the seller-facing completeness gate | marketplace read path |
| 2 | **Unauthenticated vehicle image upload** to the public bucket under any VIN prefix | `mediaRouter` |
| 3 | **Unauthenticated reservation endpoint** with client-supplied buyer id (UI hardcoded `'u1'`) — any anonymous caller could mass-reserve the marketplace | `server.js` |
| 4 | **PartSentry silent data loss**: insert errors were never checked — a failed log still mutated the odometer and emitted a ghost event | `partsentryService` |
| 5 | Owner PartSentry page: **403-dead against a mechanic-only route while faking success** with a fabricated "blockchain hash"; mock ledger; invalid enum values | owner UI |
| 6 | Mechanic ServiceLogs: **every insert failed** (lowercase enums vs DB CHECK) behind mock seeds | mechanic UI |
| 7 | **Four admin/government pages unreachable** for their own roles (routed but unregistered → bounced to login), two of them linked from AdminDashboard quick actions | navigation boundary |
| 8 | **The domain-event outbox was never drained on Vercel** — in serverless production, every inquiry/escrow/finance event sat `pending` forever: zero notifications, zero threads | event fabric |
| 9 | `/search` ("Verify Vehicle or Part History") — **pure mock data in production**, four navigation entries land on it | buyer UI |
| 10 | Local ops hazard: `backend/.env` points at the **production** database — a plain `npm run dev` writes to production (flagged, not changed; owner decision) | environment |

The full matrices (per journey step, with classifications WORKS COMPLETELY → MISSING BUT
REQUIRED / EXTERNALLY GATED / PENDING-PR137 and file:line evidence) are preserved in the PR
description trail; items already fixed by open PR #137 were classified PENDING-PR137 and
deliberately **not** re-implemented here.

---

## 2. What became functional

Real capabilities that did not work before this pass:

- **A seller/dealer can now actually control marketplace visibility.** The publication
  lifecycle is enforced end-to-end: drafts are invisible to buyers; `POST
  /api/vehicles/:vin/publish` refuses (naming the exact blocking gaps) until the
  deterministic completeness evaluator passes; MyListings and dealer Inventory show the
  lifecycle state and carry Publish/Unpublish controls. A visibility-preserving backfill
  migration (`20260808140000`) promotes everything publicly visible today so deployment
  hides nothing retroactively.
- **Dealers can create inventory.** The only creation flow was registry-locked to owners
  while dealer CTAs pointed at it; dealers are now admitted (the backend already stamped
  `tenant_id` for dealer creates).
- **A mechanic can log real service work.** ServiceLogs submits DB-valid actions, surfaces
  real errors, loads the real ledger; work orders persist `customer_name`/`mechanic_id`,
  resolve the customer from the vehicle, and can now be completed/cancelled (new PATCH).
  The `mechanic_work_orders`/`mechanic_parts` split-schema conflict (two divergent legacy
  CREATE TABLEs) is converged by migration `20260808150000`, proven over both legacy shapes
  in PGlite.
- **An owner can log parts against their own vehicle** — the route now admits
  owner/dealer/admin with an ownership/tenant scope check, and the page shows the real
  public ledger instead of a static array with a fabricated success path.
- **Admins can reach FraudQueue, DealerCompliance and GovernanceReviewQueue** (and
  government its governance queue) — previously bounced to login by the access boundary.
- **Product events now reach users.** Verification decisions, listing moderation outcomes,
  finance approve/decline and evidence review decisions emit engine-routed notifications
  (policies + templates), and the outbox actually drains in serverless via
  `GET|POST /api/internal/events/process` (worker-secret guarded) + a `backend/vercel.json`
  cron. Buyer-inquiry → notification + thread creation, which existed but could never fire
  on Vercel, is now live-capable.
- **`/search` is real.** Identifier-looking queries attempt a passport lookup and deep-link
  to the live listing; everything else searches real marketplace listings. No fabricated
  inventory remains reachable there.
- **Dealer Leads is honest.** The page reads real marketplace inquiries (tenant-scoped via
  the same service the owner card uses) and mounts SellerInquiriesCard on both Leads and
  DealerDashboard; the phantom `dealer_leads` table read is gone.
- **Mobile communications is governed.** The one governed tab without a
  `NativeFeatureBoundary` is wrapped (boundary audit 21/21), the dangling drawer featureId
  is fixed, and the boundary audit + three more quarantined mobile suites now run in CI.

## 3. What was connected

Previously isolated domains now feeding each other:

- Completeness gate → seller UI → publish endpoint → public read path (one lifecycle,
  no contradiction between what the seller is told and what buyers see).
- Evidence review decisions → notification fabric → submitter (via the new
  `evidenceReviewNotifier` bridge wired into the verify/reject handlers).
- Identity verification decisions / listing moderation / finance status → the same
  notification fabric (previously: audit rows only, user told nothing).
- Marketplace inquiries → dealer surfaces (Leads/DealerDashboard) — the tenant-scoped
  seller-inquiry service existed but was mounted only on the owner page.
- Mechanic work orders → owner Service History (field-name and status-case mismatches fixed;
  the two previously divergent "service history" sources now render coherently).
- The event outbox → an actual drain path in the deployment platform's execution model.

## 4. What was repaired

- Media-upload, reservation and PartSentry authorization (P0s above), with session-derived
  identity everywhere a client-supplied id was previously trusted.
- Mechanic evidence review was reading pending evidence **across all tenants**; tenant scope
  now applies to dealer and mechanic alike.
- The dead "Upload documents" CTA out of the completeness panel (linked a nonexistent
  route) now lands on the real garage profile and auto-opens the uploader.
- Diaspora truthfulness: the workbook page no longer renders the stale "XLSX not available"
  claim (the template endpoint exists; the flag is corrected backend-side and the download
  link renders when ready); effective entitlements are displayed instead of being fetched
  and discarded; Drive-page copy corrected.
- MechanicDashboard fabrications (fake approvals queue, fake weekly stats, hardcoded
  branding/badges) replaced with real work-order-derived data and honest empty states.
- Marketplace compare route registered (was falling through the ungoverned public fallback).
- Dead event subscriptions retired behind a new emitter-coverage CI gate so notification
  wiring can no longer silently rot.

## 5. Verification

PLACEHOLDER-VERIFICATION

## 6. What still prevents full CarUp completion

**Engineering remaining (next passes, in rough priority):**
- Reservation domain model: a real `reservations` table with expiry/release (the endpoint is
  now authenticated but still flips a status with no lifecycle; `Reserved` remains listed).
- Seller-authored listing content: description/city/features columns are still silently
  dropped on create (`vehicles` has no columns for them); listing edit endpoint + UI.
- Trust-fact request UI and PartSentry public-card review UI (backends complete; without
  them `passport_verified` and `partsentry_checked` badges can never truthfully activate —
  Issues #31/#32).
- 7C identity verification → listing badge bridge (`identity_status` is still a hardcoded
  literal in the trust summary; needs a `users.identity_verified` column set on approval).
- Work orders / PartSentry into the trust graph timeline + vehicle history report
  (currently evidence-only), and trust-score recompute on PartSentry/trust-fact writes.
- Diaspora UI coverage: ~31% of diaspora endpoints have no UI path (workbook batch
  drill-down/recovery, xlsx upload round-trip UI, SafeTrade case creation/milestone
  definition, container seeding, reputation, scheduler observability).
- Role/tenant portal-options contract (`GET /api/account/portal-options`) so PR #137's
  fail-closed role switcher can reopen; tenant selection UI; server-side logout.
- `/settings` page + route; communications for the six non-owner roles (both need one-line
  App.tsx additions sequenced after PR #137).
- Mobile parity: saved listings, seller create/listings surfaces, owner passport screen
  (garage rows currently open the buyer view), web SafePay escrow page (mobile-only today).

**Security remaining:** Issue #101 (~27 production tables RLS-off — still the multi-tenancy
gate), Issue #77, EB-5 password re-rotation, `backend/.env` → production hazard (owner
decision on local-env policy).

**Owner acceptance:** PR #138 (reunification), this PR, PR #137's credentialed staging
retest, PR #123 (Referral Stage-5 receipt), the two-production-databases identity ruling.

**External-provider/legal:** unchanged from the reunification report §8 — EB-2/3/4, VTOS
provider contracts, device certification, Vercel deploy quota. Note: the new per-minute
event-drain cron will not deploy on a Hobby Vercel plan (documented; pg_cron fallback
pattern exists in `20260626120000_communication_supabase_cron.sql`).

**Future product expansion:** per the roadmap docs (SafePay settlement, logistics, rich
analytics, AI negotiation, native diaspora).

## 7. Current product state (what each actor can actually do now)

- **Buyer:** browse/filter real listings → detail with passport, trust summary, evidence
  gallery, history report → save (server-backed) → compare → inquire (rate-limited,
  notification+thread capable) → reserve (authenticated). `/search` verifies real
  identifiers. Drafts and pre-publication vehicles are invisible.
- **Private seller:** create a listing (gated media upload) → see completeness + blocking
  gaps → upload evidence via the working CTA → publish/unpublish deliberately → see
  publication + availability state → receive inquiries → mark sold.
- **Dealer:** everything the seller can, tenant-stamped, plus inventory management and a
  real Leads surface fed by marketplace inquiries.
- **Mechanic:** create/complete work orders that persist customer + mechanic identity →
  log DB-valid service/parts events that genuinely persist (failures surface) → parts
  inventory. (VIN-lookup surface and evidence-attach UI remain on the roadmap.)
- **Owner:** garage → per-vehicle passport with evidence upload → service history that
  matches what mechanics actually wrote → PartSentry ledger (real reads, scoped writes) →
  publication control of their listing.
- **Admin/Government:** all queues reachable (fraud, dealer compliance, governance,
  verification case management, evidence, trust facts, moderation with seller notification,
  comms command center).
- **Diaspora user:** unchanged core journeys (profile→order→documents→RFQ→containers→
  shipments, test-mode billing, flag-gated SafeTrade/TradeGraph) with truthful workbook/
  entitlement surfaces; notifications become deliverable once the outbox drain deploys.
- **Mobile user:** governed tabs (all five surfaces now bounded), marketplace + inquiry,
  garage + odometer OCR + durable offline evidence queue, 7C verification flow, referral
  wallet, escrow advance, communications (now governed).

## 8. Canonical continuation

Work continues from `integration/unified-product-advancement` → PR → owner review; after
merge, `main` is again the single canonical state. Lane branches (`lane/*`) are merged and
disposable; no new worktrees were left behind (the four lane worktrees were Workflow-managed
and auto-cleaned).
