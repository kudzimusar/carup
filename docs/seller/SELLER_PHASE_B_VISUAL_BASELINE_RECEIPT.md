# Seller Phase B Visual Baseline Receipt

**Master authority:** `docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md`  
**Exact audit head / deployed runtime:** `cba7071a6d28f0972a87eb2ce79deba3334ac042`  
**Frozen pre-remediation product ancestor:** `106f76509ae1d1d10a3c4a26b4f93f7993d55027`  
**Workflow:** Seller Phase B Baseline Visual Audit  
**Run:** `33307316382`  
**Job:** `99246029931`  
**Artifact:** `9730920923` — `seller-phase-b-baseline-33307316382-1`  
**Artifact digest:** `sha256:e1d605dc88784c1422bca5699a975fc82c90c919393b258d86c678eb043157b3`  
**Result:** PASS — 39 requested visual captures preserved

## What was captured

Thirteen required Seller/downstream surfaces were captured at each of:

- desktop Chromium — 1440×1000
- narrow/tablet Chromium — 1024×900
- mobile Chromium — 390×844

Surfaces:

1. Home
2. Marketplace
3. rich reference Vehicle Detail (`CARUPGLDNA0000001`)
4. public/guest Sell
5. Owner Dashboard
6. My Garage
7. Evidence Vault baseline state
8. My Listings
9. authenticated Seller Studio
10. Seller-created draft Buyer Preview / Vehicle Detail (`UAT20260828SELL01`)
11. Communications Seller surface
12. Seller Intelligence baseline surface
13. Verify / Passport entry for the Seller-created vehicle

The artifact includes `manifest.json`, 39 PNG screenshots and the Playwright result.

## Baseline findings deliberately preserved

This receipt is evidence of the **before** state. It does not clear the product defects below.

- **Garage/Evidence navigation defect reproduced on all three viewports:** `/dashboard/garage` produced `activeSidebarDestinations=2`. The baseline registry gives My Garage and Evidence Vault the same route.
- **Owner Dashboard remains legacy:** card-heavy shell with Marketplace Pulse/Suggested next steps/loading blocks and older wallet/trust presentation.
- **My Garage remains legacy/sparse:** generic “Add New Vehicle” card for the synthetic owner rather than the target vehicle-story workspace.
- **Authenticated Seller Studio is still the legacy four-stage “Register Your Vehicle” form**, not yet the target convergence shell.
- **Seller draft buyer-preview route does not present the rich reference Marketplace composition** for `UAT20260828SELL01`; this remains a Phase K/L defect.
- **Seller Intelligence baseline is the Gutu AI records screen**, not the required KPI/time-series/funnel Seller cockpit.
- **Communications renders a real in-app conversations surface**, but the baseline has no conversation for the synthetic owner; Phase Q still requires inquiry→thread proof.
- **Verify/Passport entry exists**, but its baseline loading/presentation behavior remains to be evaluated during redesign/certification.
- Home/Marketplace/reference detail/public Sell are preserved as downstream visual comparison points.

## Evidence integrity

- Frontend and backend provenance both reported exact SHA `cba7071...` before capture.
- All requested routes returned non-5xx content.
- The audit **did not create, publish, unpublish, sell, delete or modify any vehicle**.
- The only staging mutation was rotating the password of the dedicated synthetic account `uat.buyer@carup-staging.test` so authenticated read-only screenshots could be captured.
- `buynsellpvtltd@gmail.com` was not touched.
- `UAT20260828SELL01` was not mutated.
- No API setup substituted for a product acceptance journey; this workflow is a Phase B forensic evidence collector only.

## Phase B disposition

- B1.1–B1.13: visual baseline captured at all three required viewport classes.
- B2.1–B2.27: separately completed in `SELLER_MARKETPLACE_BASELINE_PARITY_AUDIT.md`.
- Phase B may be rolled complete as an **audit gate only**.
- No remediation phase C–W is implied complete by this receipt.
