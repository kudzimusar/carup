# Issue #164 Phase 8 — Golden Vehicle physical UAT script (§12)

Click-by-click UAT for the two Golden Reference Vehicles, as an **unauthenticated Buyer** and an
**authenticated Owner**. The purpose is not to admire the pages: it is to prove that for one VIN every
surface publishes the *same governed fact*, and that Golden B's genuine gaps stay gaps.

- **Golden A** — `CARUPGLDNA0000001` (complete / healthy — should have earned an evaluated Trust result)
- **Golden B** — `CARUPGLDNB0000002` (deliberately incomplete — must stay pending/unknown)

## 0. Prerequisites (owner action)

**a. The Golden fixture must be present on staging.** If `mode=sequence` cleanup ran last, re-seed:

> Actions → **Issue 164 Phase 7 Golden Vehicles (staging)** → Run workflow → `mode=bootstrap`

**b. Provision the UAT credential** (staging-only, reversible, never committed). Pick a password of at
least 12 characters — it is never stored in the repo, never printed, and never appears in any receipt:

```bash
# from the repo root, with the staging env loaded (SUPABASE_URL must be the eoyenigwevnxwwhyhaer host)
GOLDEN_UAT_PASSWORD='<choose-a-strong-password>' \
  node backend/scripts/issue164-golden-uat-auth.mjs --mode=grant

# confirm (reports only WHETHER a credential is set — never the credential)
node backend/scripts/issue164-golden-uat-auth.mjs --mode=status
```

When UAT is finished, revoke it again:

```bash
node backend/scripts/issue164-golden-uat-auth.mjs --mode=revoke
```

**c. Surfaces.** Canonical staging is `https://staging.carup.dev` (frontend) with
`https://api-staging.carup.dev` (backend). To test the *Phase 8* code specifically, use the Vercel
preview deployment for PR #165 (`Vercel – carup-staging` check on the PR) — the canonical staging alias
only serves Phase 8 once the branch is deployed there.

**Accounts** (all synthetic, `@carup-staging.test`):

| Role | Email |
|---|---|
| Golden A Owner | `golden-a-owner-stg@carup-staging.test` |
| Golden A Buyer | `golden-a-buyer-stg@carup-staging.test` |
| Golden B Owner | `golden-b-owner-stg@carup-staging.test` |
| Golden B Buyer | `golden-b-buyer-stg@carup-staging.test` |

---

## 1. Golden A — unauthenticated Buyer

Use a **private/incognito window** (no session).

| # | Step | Expected result |
|---|---|---|
| 1 | Open `/` (Landing) | Featured cars load from live published listings. **No** green "Verified" badge and **no** `Trust NN` number on any card. Cards show only governed tags (e.g. *Evidence Available*). |
| 2 | Note Golden A's card facts if present: make/model/year, price + currency, location | Record them — step 5 compares. Price shows a currency or says *Price not recorded*; it never shows a bare `$` amount with an assumed USD. |
| 3 | Type `Hilux` in the Landing search and submit | Navigates to `/marketplace?q=Hilux` — **the query is preserved**, not discarded. |
| 4 | In Marketplace, locate `CARUPGLDNA0000001` | Card shows identity, price+currency, location, governed tags. Spec chips (mileage / transmission / fuel) appear **only** where recorded — no `0 km`, no *Auto*, no *Petrol* filler. Seller shows the governed label or *Seller not disclosed* — never *CarUp Dealer* / *Private seller*. |
| 5 | Compare the Marketplace card to what Landing showed (step 2) | **Identical** identity, price, currency, location, and primary image. *(Invariant 13)* |
| 6 | Open the vehicle → Vehicle Detail / Passport | Trust panel shows the canonical assessment: a score **only** in the `evaluated` state, with its band, calculation version and known limitations. Golden A should be evaluated. |
| 7 | Check the Trust number against any shown elsewhere for this VIN | Same score, same version everywhere. *(Invariant 1)* |
| 8 | Inspect the photo gallery vs the evidence/documents section | Listing photos appear as **listing media**; verified documents appear separately as **evidence**. No listing photo is presented as verified evidence. *(Invariants 5, 6)* |
| 9 | Check identity fields (Reg. Country / Reg. Authority) | Either a governed, provenance-backed value or *not recorded* — never a bare `ZW` / `CVR` default. |
| 10 | Check the seller block | Contact shows only what the seller published. If no number is published: *No contact number published*, with the action disabled. No fabricated phone. |
| 11 | Open DevTools → Network → the vehicle/marketplace API responses | No `owner_id`, `tenant_id`, or `current_seller_id` in any public payload. *(Invariant 3)* |

## 2. Golden A — authenticated Owner

Sign in at `/login` as `golden-a-owner-stg@carup-staging.test` with the password from step 0b.

| # | Step | Expected result |
|---|---|---|
| 12 | After login, land on the Owner Dashboard | Header greets the owner. The **notification bell** shows the real count from `/notifications/me`; if the read fails it shows an amber *unavailable* dot — never a confident `0`. |
| 13 | Look at *Needs your attention* (if present) | Items reflect real outstanding state only (no vehicles / trust not yet evaluated / unread notifications). If nothing is outstanding the rail is absent. |
| 14 | Check the wallet / Trust Index / value-trend tiles | These read *Not available* (no such data source) — **not** a fabricated balance, score or trend. |
| 15 | Open **My Garage** | Golden A appears with its **Asking Price** (not "Current Value"), stated mileage, and a trust bar **only** if a score exists. Image is real listing media or a neutral placeholder — never a stock car. |
| 16 | Open Golden A's per-VIN page (`/dashboard/garage/CARUPGLDNA0000001`) | **No "AI Valuation" card, no "Current Value", no "Depreciation", no "Market range", no "Confidence 92%"** — CarUp publishes no valuation. Summary shows *Recorded Price* only. |
| 17 | Check specs on that page | Mileage/colour/engine/purchase date each show the recorded value or *Not recorded* — no `Unknown`, no `0`, no today's date. |
| 18 | Check the service/parts history | Garage and manufacturer show the recorded value or *not recorded* — no invented garage name, no blanket `OEM`. |
| 19 | Compare the owner-side Trust to the public Detail Trust (step 6) | Identical score/version — one materialised position. *(Invariant 1)* |
| 20 | Use the owner top-bar search (type e.g. `Hilux`, submit) | Navigates to `/search?q=Hilux` — intent preserved. |

## 3. Golden B — unauthenticated Buyer

Private/incognito window again.

| # | Step | Expected result |
|---|---|---|
| 21 | Search Marketplace for `CARUPGLDNB0000002` | **Golden B must NOT appear in the public marketplace** — its ownership document is pending, so it is not publishable and stays `draft`. *(Invariant 9)* |
| 22 | Navigate directly to `/marketplace/CARUPGLDNB0000002` | Either not-found/unavailable, or a page with **no** verified claims. It must not render as a published, verified listing. |
| 23 | If any Trust is shown | *Not evaluated* / insufficient evidence — **never** a fabricated green badge, and never a number implying assessment. *(Invariants 4, 11)* |
| 24 | Check any evidence/document display | The registration document shows **pending**, not verified. Missing items read as missing. Absence never renders as a clean bill of health. |

## 4. Golden B — authenticated Owner

Sign in as `golden-b-owner-stg@carup-staging.test`.

| # | Step | Expected result |
|---|---|---|
| 25 | Owner Dashboard → *Needs your attention* | Should surface that Golden B has **no completed trust assessment** (canonical claim, not a raw column). |
| 26 | My Garage → Golden B | Status shows the recorded value or *Status not recorded* — no invented "Active" + green shield. Trust bar absent (no score). |
| 27 | Open Golden B's per-VIN page | Pending evidence shows as pending. No valuation, no stock image, no fabricated dates. |
| 28 | Attempt to publish / list Golden B | Refused with the blocking requirement named (ownership document not verified) — the gate is real. |

## 5. Cross-cutting checks (either vehicle)

| # | Step | Expected result |
|---|---|---|
| 29 | Visit `/dealers`, `/garages`, `/insurance` directories | Each shows an explicit **"No verified … listed yet"** empty state. No invented companies, no real company presented as a CarUp-verified partner. |
| 30 | Visit `/press` and `/blog` | No fabricated ZINARA integration, insurer partnership or funding-round announcements. |
| 31 | Search the UI for "blockchain" | Product surfaces say **CarUp audit ledger**, not "blockchain"/"tamper-proof". |
| 32 | DevTools → Application → Local Storage | No key asserting reservation/escrow/payment/transaction state. Only auth/session, nav cohort and guest favourites. *(Invariant 8)* |

## 6. Recording the result

For each numbered step record **PASS/FAIL + a screenshot**. Any FAIL is an evidenced defect: report the
step number, the VIN, the surface, and what was shown instead. Remediation is then narrow and
re-certified at exact head — no UAT step is waived.

**Do not mark UAT PASS without physical evidence.** Absence of a screenshot is not a pass.
