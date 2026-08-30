# Seller UAT Remediation — Baseline Defect Ledger

**Authority:** `docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md`  
**Baseline branch:** `integration/vehicle-passport-v16-cert` / Draft PR #194  
**Baseline exact head:** `106f76509ae1d1d10a3c4a26b4f93f7993d55027`  
**Captured:** 2026-08-30  
**Rule:** this ledger records the finite baseline defect set. A defect is not closed merely because later code exists; closure must be evidenced in the master tracker.

| ID | Defect / observation | Baseline evidence | Master phase |
|---|---|---|---|
| SELL-UAT-001 | Historical Seller account `buynsellpvtltd@gmail.com` cannot complete the expected login continuity path. | Owner UAT report; credential/account mutation prohibited until Phase D diagnosis. | D |
| SELL-UAT-002 | Historical verification email was not received / delivery truth has not been proven end-to-end. | Owner UAT report; current preview health reports Communications BLOCKED for several provider/worker settings, so auth-email delivery must be tested separately rather than inferred. | D |
| SELL-UAT-003 | Human UAT Hilux `UAT20260828SELL01` has no persisted listing gallery. | Exact-head Passport projection: `listing_media.state=none`, `items=[]`. | F/G/K/L |
| SELL-UAT-004 | Home hero/live vehicle media can become blank or misleading when public inventory media is missing/bad. | Owner UAT report; downstream Seller publication feeds Home. | P |
| SELL-UAT-005 | Marketplace Vehicle Detail/gallery can present blank/missing media for Seller-created inventory. | Owner UAT report + UAT specimen has no persisted listing media. | G/K/L |
| SELL-UAT-006 | Home “Eight useful next moves” conceptual media was coupled too closely to live listing media and regressed when vehicle imagery failed. | Owner UAT report. | P |
| SELL-UAT-007 | Automated Golden Seller Hiluxes leaked into human staging Marketplace inventory. | Historical Golden Seller run behavior; current baseline Marketplace inventory must be reconciled by source in Phase C. | C |
| SELL-UAT-008 | Marketplace inventory count semantics were ambiguous; owner observed 13 while the current exact-head public endpoint reports 9 published listings. | Exact-head `GET /api/marketplace/listings`: `total=9` on 2026-08-30. | C |
| SELL-UAT-009 | “Featured” semantics were unclear and could imply editorial/quality selection when the implementation was effectively newest/live inventory. | Owner UAT report. | C/P |
| SELL-UAT-010 | Legacy/non-canonical Trust presentation created a misleading 60/100 concern. | UAT specimen exact-head Passport: canonical `trustReport.evaluation_state=not_evaluated`, score/band null; stored legacy score is explicitly not published. | M |
| SELL-UAT-011 | Global Sell did not consistently resolve the required three-way intent before entering Seller Studio. | Owner UAT report; prior #202 implementation is candidate evidence only until reconciled. | E |
| SELL-UAT-012 | Owner Dashboard remains visually/structurally legacy relative to current CarUp design law. | Owner UAT report. | O |
| SELL-UAT-013 | My Garage and Evidence Vault navigation semantics were coupled/double-active. | Owner UAT report; prior #202 fix is candidate evidence only until reconciled. | E |
| SELL-UAT-014 | Previous “Golden Seller PASS” used a reduced integration lifecycle and therefore did not satisfy the full human-facing Golden journey. | Historical certification review; master Phase S now prohibits API/seed/media/Communications/Intelligence shortcuts. | S |
| SELL-UAT-015 | Communications proof was weakened to inquiry-row/inbox presence rather than an actual Seller conversation projection. | Historical Golden-test review. | Q/S |
| SELL-UAT-016 | Intelligence proof was weakened by accepting “unavailable” instead of proving the known Seller event was instrumented and readable. | Historical Golden-test review. | N/S |
| SELL-UAT-017 | Full publish → unpublish → republish → sold → Passport persistence lifecycle was not previously certified through the intended UI. | Historical Golden-test review. | R/S |
| SELL-UAT-018 | Responsive certification omitted an explicit narrow/tablet gate. | Historical plan review; root `DESIGN.md` requires responsive behavior beyond desktop/mobile. | T/S |
| SELL-UAT-019 | Seller-redesign-specific accessibility has not been re-certified after the intended convergence changes. | Historical plan review. | T |
| SELL-UAT-020 | Buyer Preview and public Marketplace Vehicle Detail are not yet proven to be one shared presentation architecture with mode-specific actions. | Historical parity review. | K/L |

## Baseline exact-head provenance

- Frontend branch alias: `https://carup-staging-git-integration-vehicle-passport-v16-cert-11-11.vercel.app`
- Frontend deployment: `dpl_758ugDwdTKYNQuUyCcXWeg5XeR6E` — READY
- Frontend `/carup-provenance.json`: `commit_sha=106f76509ae1d1d10a3c4a26b4f93f7993d55027`, `unpaired=false`
- Backend branch alias: `https://carup-backend-staging-git-integration-vehicle-pass-35ac1d-11-11.vercel.app`
- Backend deployment: `dpl_2exP3xuQNVZk7eNFqq2FX85BqvjM` — READY
- Backend `/api/health`: `build.commit_sha=106f76509ae1d1d10a3c4a26b4f93f7993d55027`, Supabase healthy, outbox backlog 0
- Public Marketplace: `GET /api/marketplace/listings` → `total=9`, ranking requested/applied `newest`

## Protected human UAT specimen

Read-only exact-head proof for `UAT20260828SELL01`:

- 2021 Toyota Hilux
- USD 23,000
- 45,000 km
- Diesel / Automatic / AWD / Pickup
- Seller-stated condition: New
- `publication_status=draft`
- listing media: none
- canonical Trust: `not_evaluated` (score/band null)
- current Seller display: `CarUp  UAT Seller 29A`
- location: Harare / Harare Metropolitan
- Vehicle Passport lifecycle remains present

The specimen is not to be published, deleted, overwritten, or converted into automation data during remediation.

## Protected account procedure

Until Phase D completes diagnosis for `buynsellpvtltd@gmail.com`:

1. do not delete/recreate/merge the account;
2. do not reset or mutate credentials merely to make UAT pass;
3. perform read-only account/session/profile/ownership diagnosis first;
4. preserve existing vehicle/listing/ownership relationships;
5. keep public authentication errors opaque while internal diagnosis distinguishes account/credential state where authorized;
6. require explicit owner approval for any credential mutation that is not already a normal self-service recovery action;
7. use the governed password/email verification recovery path once its delivery semantics are proven.

