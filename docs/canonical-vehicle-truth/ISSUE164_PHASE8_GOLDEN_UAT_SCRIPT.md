# Issue #164 Phase 8 — Golden Vehicle physical UAT script (§12)

Click-by-click UAT for the two Golden Reference Vehicles, as an **unauthenticated Buyer** and an
**authenticated Owner**. The purpose is not to admire the pages: it is to prove that for one VIN every
surface publishes the *same governed fact*, and that Golden B's genuine gaps stay gaps.

Every expected value below was **read from canonical staging** (`eoyenigwevnxwwhyhaer`) and from the
live deployment — they are measured, not assumed.

## 0. Where to test — use the PR preview, not the staging alias

This was verified, not guessed:

| Surface | Serves | Use for UAT? |
|---|---|---|
| `https://carup-staging-git-integration-canonical-vehicle-tr-7bafc7-11-11.vercel.app` | **certified head** `3e7ca25c65…` | ✅ **yes** |
| `https://carup-backend-staging-git-integration-canonical-ve-df06b3-11-11.vercel.app` | certified head — `/api/health` returns `commit_sha: 3e7ca25c65cc08b10ba9c97944cab184176c5655`, verified | ✅ its API |
| `https://staging.carup.dev` / `api-staging.carup.dev` | `main` = `87033020` (**pre-Phase-8**) | ❌ no |

> If a newer commit is pushed, take the current preview URL from PR #165's **Vercel – carup-staging**
> check, and confirm the head with
> `curl -s <backend-preview>/api/health | grep commit_sha`.

## 1. Fixture state — already provisioned, no bootstrap needed

Verified on canonical staging: **8** Golden users, **2** Golden vehicles, **5** evidence rows, **7**
listing images. The Phase 7 `sequence` run left the fixture in place.

| | **Golden A** `CARUPGLDNA0000001` | **Golden B** `CARUPGLDNB0000002` |
|---|---|---|
| Vehicle | Toyota Hilux 2019 | Nissan NP200 2017 |
| Price | **USD 21,500** (`operator_recorded`) | USD 9,800 (`operator_recorded`) |
| Location | **Bulawayo, Bulawayo Metropolitan, Zimbabwe** (`operator_recorded`) | Gweru, Midlands, Zimbabwe |
| Publication | **published** | **draft** — must not appear publicly |
| Trust | **60** · band `moderate` · confidence `low` · `trust-decision-1.0.0` | **50** · band `moderate` · confidence `low` · `trust-decision-1.0.0` |
| Evidence | 4 rows, **all verified** (registration, police clearance, inspection, insurance) | 1 row, **pending** (registration) — `verified_by` null |
| Listing images | 5 | 2 |
| Owner / seller | `golden-a-owner-stg` | `golden-b-owner-stg` |

**Why those scores are correct** (and reproducible from the inputs): completeness contributes up to
+50 and a complete identity +10. Golden A meets all 5 blocking requirements → 100% → 50 + 10 = **60**.
Golden B meets 4 of 5 (its ownership document is still pending) → 80% → 40 + 10 = **50**.

> **Golden B is legitimately *evaluated*, not "not evaluated".** An earlier draft of this script said
> otherwise and was wrong. B having a real, low, low-confidence score derived from partial evidence is
> the correct behaviour — the honesty requirement is that its **document stays pending**, it **stays
> unpublished**, and nothing renders as a green verification.

## 2. Prerequisite — provision the UAT credential (one password, typed once)

The Golden accounts exist but have **no credential** (`password_hash` is null for all four), so login
is currently impossible by design. Provision it like this:

```bash
node backend/scripts/issue164-golden-uat-hash.mjs --out=/tmp/golden-uat.hash
```

You will be prompted twice for a password of **at least 12 characters**. Input is hidden — it is never
echoed, never passed as an argument, and therefore **never enters shell history or `ps`**. The command
writes only a one-way scrypt hash (mode `0600`); the plaintext is never stored or transmitted.

Then tell the assistant the file is ready. The hash is applied to exactly the four synthetic
`@carup-staging.test` accounts, and revoked the same way after UAT. The hash is produced by the same
governed `hashPassword` the registration path uses, so it authenticates through the real, unmodified
login route — no bypass, no weakened check.

**Accounts** (all synthetic):

| Role | Email |
|---|---|
| Golden A Owner | `golden-a-owner-stg@carup-staging.test` |
| Golden A Buyer | `golden-a-buyer-stg@carup-staging.test` |
| Golden B Owner | `golden-b-owner-stg@carup-staging.test` |
| Golden B Buyer | `golden-b-buyer-stg@carup-staging.test` |

---

## 3. Golden A — unauthenticated Buyer

Use a **private/incognito window** (no session).

| # | Step | Expected result |
|---|---|---|
| 1 | Open `/` (Landing) | Featured cars load from live published listings. **No** green "Verified" badge and **no** `Trust NN` number on any card — only governed tags. While loading it says *"Loading featured listings…"*; a failed read says *"unavailable… not an empty marketplace"* — never a false "no listings". |
| 2 | Find Golden A's card; note make/model/year, price, location | Expect **2019 Toyota Hilux**, **USD 21,500**, **Bulawayo, Bulawayo Metropolitan, Zimbabwe**. The Landing card renders only the **first two** governed tags (`Landing.tsx` slices to 2), so expect *Evidence Available* and *One Owner* — the API also returns `private_sale`, and its absence from the card is correct, not a defect. These values were read back from the live certified deployment. |
| 3 | Type `Hilux` in the Landing search, submit | Navigates to `/marketplace?q=Hilux` — **the query is preserved**. |
| 4 | In Marketplace, locate `CARUPGLDNA0000001` | Same identity/price/currency/location as step 2. Spec chips appear only where recorded — no `0 km`, no *Auto*, no *Petrol* filler. Seller shows a governed label or *Seller not disclosed* — never *CarUp Dealer*/*Private seller*. |
| 5 | Compare Landing (step 2) to Marketplace (step 4) | **Identical** identity, price, currency, location, primary image. *(Invariant 13)* |
| 6 | Open the vehicle → Detail / Passport | Trust panel shows **60**, band *moderate*, confidence *low*, version `trust-decision-1.0.0`, with known limitations listed. |
| 7 | Compare that Trust to anything shown elsewhere for this VIN | Same score **60** and same version everywhere. *(Invariant 1)* |
| 8 | Compare the photo gallery with the evidence/documents section | **5** listing photos as media; **4** verified documents as evidence, in a separate section. No listing photo presented as verified evidence. *(Invariants 5, 6)* |
| 9 | Check Reg. Country / Reg. Authority | A governed, provenance-backed value or *not recorded* — never a bare `ZW` / `CVR` default. |
| 10 | Check the seller block | Only what the seller published. No number published → *No contact number published*, action disabled. No fabricated phone. |
| 11 | DevTools → Network → the marketplace/vehicle API responses | No `owner_id`, `tenant_id` or `current_seller_id` in any public payload. *(Invariant 3)* |

## 4. Golden A — authenticated Owner

Sign in at `/login` as `golden-a-owner-stg@carup-staging.test`.

| # | Step | Expected result |
|---|---|---|
| 12 | Owner Dashboard loads | Notification bell shows the real count from `/notifications/me`; on a failed read an amber *unavailable* dot — never a confident `0`. |
| 13 | *Needs your attention* rail | Reflects only real outstanding state. Golden A's trust **is** evaluated, so no "awaiting assessment" item for it. Absent entirely if nothing is outstanding. |
| 14 | Wallet / Trust Index / value-trend tiles | Read *Not available* — no fabricated balance, score or trend. |
| 15 | **My Garage** | Golden A shows **Asking Price** (not "Current Value"), stated mileage, trust bar only because a score exists. Image is real listing media or a neutral placeholder — never a stock car. |
| 16 | Open `/dashboard/garage/CARUPGLDNA0000001` | **No "AI Valuation", no "Current Value", no "Depreciation", no "Market range", no "Confidence 92%"** — CarUp publishes no valuation. Summary shows *Recorded Price* only. The header image is a real listing photo (from the canonical `listing_media`), not "Image unavailable". |
| 17 | Check specs on that page | Mileage/colour/engine/purchase date each show the recorded value or *Not recorded* — no `Unknown`, no `0`, no today's date. |
| 18 | Check service/parts history | Garage and manufacturer show the recorded value or *not recorded* — no invented garage name, no blanket `OEM`. |
| 19 | Compare owner-side Trust to the public Detail Trust (step 6) | Identical **60** / same version. *(Invariant 1)* |
| 20 | Owner top-bar search: type `Hilux`, submit | Navigates to `/search?q=Hilux` — intent preserved. |

## 5. Golden B — unauthenticated Buyer

Private/incognito window again.

| # | Step | Expected result |
|---|---|---|
| 21 | Search Marketplace for `CARUPGLDNB0000002` | **Must NOT appear** — it is `draft` because its ownership document is pending. *(Invariant 9)* — pre-verified against the live API: the public listing read returns Golden A and excludes Golden B. |
| 22 | Navigate directly to `/marketplace/CARUPGLDNB0000002` | Not-found/unavailable, or a page with **no** verified claims. It must not render as a published, verified listing. |
| 23 | If Trust is shown | **50**, band *moderate*, confidence *low* — a real, low, derived score. **Not** a green badge, and not a fabricated *verified*. A low score from partial evidence is the honest result. |
| 24 | Check evidence/documents | The registration document shows **pending** (not verified). Missing items read as missing. Absence never renders as a clean bill of health. *(Invariant 11)* |

## 6. Golden B — authenticated Owner

Sign in as `golden-b-owner-stg@carup-staging.test`.

| # | Step | Expected result |
|---|---|---|
| 25 | Owner Dashboard → *Needs your attention* | Golden B's document is pending, so its listing is not publishable — the rail should reflect real outstanding work, not an invented item. |
| 26 | My Garage → Golden B | Status shows the recorded value or *Status not recorded* — no invented "Active" + green shield. |
| 27 | Open `/dashboard/garage/CARUPGLDNB0000002` | Pending evidence shows as pending. No valuation, no stock image, no fabricated dates. |
| 28 | Attempt to publish / list Golden B | Refused, naming the blocking requirement (ownership document not verified) — the gate is real. |

## 7. Cross-cutting checks

| # | Step | Expected result |
|---|---|---|
| 29 | Visit `/dealers`, `/garages`, `/insurance` | Each shows an explicit **"No verified … listed yet"** empty state. No invented companies; no real company shown as a CarUp-verified partner. |
| 30 | Visit `/press` and `/blog` | No fabricated ZINARA integration, insurer partnership or funding-round announcements. |
| 31 | Search the UI for "blockchain" | Product surfaces say **CarUp audit ledger**. |
| 32 | DevTools → Application → Local Storage | No key asserting reservation/escrow/payment/transaction state. Only auth/session, nav cohort, guest favourites. *(Invariant 8)* |

## 8. Recording the result

For each numbered step record **PASS/FAIL + a screenshot**. Any FAIL is an evidenced defect: report the
step number, the VIN, the surface, and what was shown instead. Remediation is then narrow and
re-certified at exact head — no step is waived.

**Do not mark UAT PASS without physical evidence.** Absence of a screenshot is not a pass.

## 9. After UAT

The temporary Golden credentials are revoked (`password_hash` set back to null on all four accounts),
returning them to unusable. Delete `/tmp/golden-uat.hash`.
