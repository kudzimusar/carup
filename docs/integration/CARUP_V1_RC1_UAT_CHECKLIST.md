# CarUp v1 RC1 — Product Owner UAT Checklist

**Branch:** `release/carup-v1-rc1`
**Draft PR:** #76
**Frontend preview:** `https://carup-staging-git-release-carup-v1-rc1-pay-pass-project.vercel.app`

Use this checklist to test the integrated release candidate as one system.

## 1. Marketplace URL intelligence

### A. Under USD 5,000

Open:

`/marketplace?maxPrice=5000`

Expected:

- Price filter is active.
- At least the controlled USD 4,500 Honda Fit can qualify before public eligibility filtering.
- No card above USD 5,000 appears.
- Refresh preserves the filter.

Result: PASS / FAIL

### B. Under USD 10,000

Open:

`/marketplace?maxPrice=10000`

Expected:

- Price filter is active.
- No visible card exceeds USD 10,000.
- Refresh preserves the filter.

Result: PASS / FAIL

### C. Trust sort

Open:

`/marketplace?sort=trust`

Expected:

- Trust sort is visibly selected.
- Higher trust scores appear before lower scores.
- Refresh preserves the sort.

Result: PASS / FAIL

### D. Toyota search

Open:

`/marketplace?q=Toyota`

Expected:

- Search state shows Toyota.
- Every visible result matches Toyota.
- Refresh preserves the search.

Result: PASS / FAIL

### E. Locally Used

Open:

`/marketplace?category=locally_used`

Expected:

- Locally Used is active.
- Only eligible locally-used records appear.
- Refresh preserves the category.

Result: PASS / FAIL

## 2. Navigation

Test desktop and mobile navigation.

Expected:

- Buy menu opens.
- Marketplace links use canonical routes.
- Parts opens `/marketplace/parts`.
- Services opens `/marketplace/services`.
- Locally Used uses the coverage-gated route when active.
- No broken legacy route appears.

Result: PASS / FAIL

## 3. Marketplace cards

Expected:

- Cards come from the staging API rather than legacy mock fallback.
- Price, make, model, year, and trust information are coherent.
- No `owner_id` or `tenant_id` is visible.
- Empty results show an honest empty state.
- Clicking a card opens a real detail page.

Result: PASS / FAIL

## 4. Listing detail

Expected:

- Trust summary is backend supplied.
- No trust badge is invented by the frontend.
- Pricing and safety information render.
- Suppressed or unapproved PartSentry claims do not appear publicly.
- Inquiry controls are available.

Result: PASS / FAIL

## 5. Inquiry flow

Test one normal vehicle inquiry and one inspection request.

Expected:

- Guest contact validation works.
- Submission succeeds.
- A confirmation is shown.
- Seller-side inquiry visibility works when logged in as the listing owner.
- No shipment/container private data is stored for normal marketplace inquiries.

Result: PASS / FAIL

## 6. Referral capture

Open a Marketplace route with:

`?ref=CARUP-UAT&campaign=RC1`

Submit an inquiry.

Expected:

- Referral and campaign attribution are attached to the inquiry.
- Marketplace does not mint a reward directly.

Result: PASS / FAIL

## 7. Saved vehicles

Expected:

- Guest save uses browser-local state.
- Authenticated save persists through the server.
- Refresh retains saved state for authenticated users.
- One account cannot see another account's saved vehicles.

Result: PASS / FAIL

## 8. Compare

Expected:

- Select two to four listings.
- Comparison route opens.
- Vehicle and trust information is aligned correctly.
- Comparison does not expose private seller identifiers.

Result: PASS / FAIL

## 9. Owner dashboard

Expected:

- My Listings loads.
- Listing status is truthful.
- Marketplace inquiries for owned listings appear.
- Unrelated sellers' inquiries do not appear.

Result: PASS / FAIL

## 10. Admin moderation

Expected:

- Only authorized platform admin access succeeds.
- Approve, suppress, reject, request evidence, flag, and clear-risk actions are present.
- Required reasons are enforced.
- Suppressed and flagged listings remain inspectable by admin.
- Audit behavior remains intact.

Result: PASS / FAIL

## 11. Parts and Services

Expected:

- `/marketplace/parts` loads without a broken route.
- `/marketplace/services` loads without a broken route.
- Empty inventory uses a governed onboarding state.
- Verified Parts claims appear only when governed and approved.

Result: PASS / FAIL

## 12. Diaspora safety

Submit an import or container-space inquiry.

Expected:

- A lightweight inquiry is created.
- Shipment/container operational details are not persisted in Marketplace metadata.
- No unauthorized shipment record is exposed.

Result: PASS / FAIL

## 13. Responsive behavior

Test desktop, tablet, and phone widths.

Expected:

- Navigation remains usable.
- Filter controls remain accessible.
- Cards and chips do not overflow.
- No horizontal page scrolling.

Result: PASS / FAIL

## 14. Final UAT decision

Record:

- Total tests passed:
- Total tests failed:
- Blocking defects:
- Non-blocking defects:
- Screenshots attached:
- Product Owner recommendation: APPROVE FOR FINAL REVIEW / REMEDIATE / DEFER

Do not merge PR #76 from this checklist alone. Final review requires all blocking defects resolved and an explicit merge authorization.
