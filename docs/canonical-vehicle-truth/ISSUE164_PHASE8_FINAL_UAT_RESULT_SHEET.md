# Issue #164 Phase 8 — FINAL 32-step physical UAT result sheet

> **Clean sheet. No PASS inherited from the first run.**
>
> The first physical UAT (14 PASS / 18 FAIL) was executed against `main`'s backend, not the candidate
> — see Addendum A of `ISSUE164_PHASE8_PHYSICAL_UAT_REMEDIATION_HANDOFF.md`. Its results are historical
> evidence only. Every step below was re-observed on the certified candidate in a real browser.

## Run header

| | |
|---|---|
| **Exact candidate SHA** | `de7088cdb360efac95c96b24ece13b8663be469e` |
| **Frontend preview** | `https://carup-staging-git-integration-canonical-vehicle-tr-7bafc7-11-11.vercel.app` |
| **Backend preview** | `https://carup-backend-staging-git-integration-canonical-ve-df06b3-11-11.vercel.app` |
| **Frontend candidate SHA (live)** | `de7088cdb360efac95c96b24ece13b8663be469e` |
| **Backend `/api/health` SHA (live)** | `de7088cdb360efac95c96b24ece13b8663be469e` |
| **SHA equality** | **EQUAL** — receipt `evidence/issue164-phase8-provenance-receipt-2f7e257a.txt` re-run live at `de7088cd` |
| **Browser/network provenance** | Every observed API call went to `…df06b3-11-11.vercel.app`. **Zero** requests to stable `carup-backend-staging.vercel.app` — proven by `browser_network_requests` (`/api/health`, `/api/marketplace/nav-coverage`, `/api/marketplace/listings`, `/api/features/effective`, `/api/security/csrf-token`, `/api/analytics/navigation`) |
| **Canonical staging** | `eoyenigwevnxwwhyhaer` |
| **Executed by** | Playwright browser automation, real page loads and real interactions |
| **Start / End (UTC)** | 2026-08-24 08:17 → 08:40 |
| **Evidence location** | `docs/canonical-vehicle-truth/evidence/uat-final/` |

## Result

| | |
|---|---|
### Run 1 — candidate `de7088cd` (first clean-start execution)

| | |
|---|---|
| **PASS** | **15** / 32 |
| **FAIL** | **4** / 32 — Steps 1, 8, 30, 31 |
| **BLOCKED** | **13** / 32 |
| **Overall** | **NOT A RELEASE PASS** — 4 step-level defects PLUS a P0 security leak (D0) found during adjudication |

> **Correction.** An earlier revision of this block read "16 PASS / 3 FAIL". That was an arithmetic
> error in the summary only — the 32 numbered rows below always recorded four failures (1, 8, 30, 31).
> The counts here are now machine-derived from those rows. The rows are the record; the summary was
> wrong and is corrected rather than quietly re-stated.

### Run 2 — candidate `24b647fd` (re-test of the remediated steps)

| | |
|---|---|
| **PASS** | **18** / 32 |
| **FAIL** | **1** / 32 — Step 1 only (**D1, owner decision pending — deliberately not implemented**) |
| **BLOCKED** | **13** / 32 |
| **Overall** | **NOT YET A RELEASE PASS** — the 13 authenticated steps still require an owner-provided session, and Step 1 awaits an owner policy decision |

**32/32 is still NOT claimed.** Steps 8, 30 and 31 were physically re-observed as PASS on the
remediated candidate; D0 was re-verified closed against the live route. Thirteen steps remain
unexercised because no authenticated Golden session is reachable from the automation browser, and no
session was fabricated, minted, or forged to work around that.

---

## Golden A — unauthenticated Buyer

| # | Persona | Surface | Expected | Observed | Result | Evidence |
|---:|---|---|---|---|:---:|---|
| 1 | Anon buyer | `/` Landing | Featured cars load; **no** Verified badge and no `Trust NN` on any card — only governed tags | 9 cards loaded, no `Trust NN` on any card. **But the Subaru card renders pill badges "Duty Cleared" and "Zimra Verified"**, derived from `marketplace_tags`, while the SAME response's canonical trust block states `unbacked_legacy_claims: 3` and *"The stored 'zimra_verified' flag … is not supported by any authoritative record and **is not published**"* | **FAIL** | `uat-step01-02-landing.png` |
| 2 | Anon buyer | `/` Landing card | 2019 Toyota Hilux · USD 21,500 · Bulawayo, Bulawayo Metropolitan, Zimbabwe · first two governed tags | Exactly that. Badges *Evidence Available*, *One Owner* (API also returns `private_sale`; Landing slices to 2 — correct) | **PASS** | `uat-step01-02-landing.png` |
| 3 | Anon buyer | Landing search | Typing `Hilux` + submit → `/marketplace?q=Hilux`, query preserved | Physically typed into `[data-testid="home-buy-search"]` and pressed Enter → `/marketplace?q=Hilux` | **PASS** | `uat-step04-05-marketplace-goldenA.png` |
| 4 | Anon buyer | `/marketplace?q=Hilux` | Same identity/price/currency/location; no filler chips; no invented seller | `2019 Toyota Hilux · $21,500 · Bulawayo, Bulawayo Metropolitan, Zimbabwe`; chips `78,450 km / Manual / Diesel` (all recorded); `Plate status unknown`; **"Seller not disclosed"**; **"Trust assessment shown on the vehicle passport"** (no card-level score); 1 vehicle found | **PASS** | `uat-step04-05-marketplace-goldenA.png` |
| 5 | Anon buyer | Landing ↔ Marketplace | Identical identity, price, currency, location, primary image | Identical on all five. Primary image both surfaces: `…/vehicle-images/CARUPGLDNA0000001/golden-exterior-front.png`, natural 960×640, `complete: true` | **PASS** | `uat-step01-02-landing.png`, `uat-step04-05-marketplace-goldenA.png` |
| 6 | Anon buyer | `/marketplace/CARUPGLDNA0000001` | Trust **60** · moderate · low · `trust-decision-1.0.0` · limitations listed | `trust-score-badge` = **"60 Moderate trust"**; *Evaluated*, *Low confidence*, `trust-decision-1.0.0`; limitations rendered ("No live government/partner source is connected…", 5 more) | **PASS** | `uat-step06-11-goldenA-detail.png` |
| 7 | Anon buyer | Detail | Same score and version for this VIN; no second numeric authority | `trust-score-badge` **60**, `sidebar-trust` **"CarUp Trust Score: 60"**, marketplace card defers to passport. No `Sign in to view trust`, no `+N Trust`, no `Trust assessment unavailable` | **PASS** | `uat-step06-11-goldenA-detail.png` |
| 8 | Anon buyer | Detail — media vs evidence | **5** listing photos; **4** verified documents in a separate section | Media correct: 5 `listing-media-thumb`, gallery `1 / 5`, all canonical Supabase URLs. **Evidence wrong:** passport returns `verified_evidence {state:"none", items:[], unpublishable_count:4}`. Page prints *"No verified evidence has been published for this vehicle"* **and, immediately after,** *"4 reviewed item(s) could not be displayed because the stored file address is unusable."* DB ground truth: all 4 rows `verification_status=verified`, `verified_by NOT NULL` | **FAIL** | `uat-step06-11-goldenA-detail.png` |
| 9 | Anon buyer | Detail — registration | Governed value or *not recorded* — never a bare `ZW`/`CVR` | `Reg. Country: Not recorded`, `Reg. Authority: Not recorded`. The `CVR` string appears only as a labelled source row (*"CVR — Registration & ownership — Not yet checked"*), not as a value | **PASS** | `uat-step06-11-goldenA-detail.png` |
| 10 | Anon buyer | Detail — seller block | Only what the seller published; no fabricated phone; action disabled | `Seller Information — Not shown publicly`; **"No contact number published"**; `seller-contact-unavailable` and `call-disabled` present; Call/WhatsApp disabled | **PASS** | `uat-step06-11-goldenA-detail.png` |
| 11 | Anon buyer | Public API payloads | No `owner_id`, `tenant_id`, `current_seller_id` | In-browser `fetch` (credentials omitted) of passport, listings, listing detail (A and B): **zero** occurrences of all three keys in every payload. Golden B listing correctly **404**, passport **200** | **PASS** | in-browser network capture, `uat-step06-11-goldenA-detail.png` |

## Golden A — authenticated Owner

> **Run 4 (2026-08-25) — EXECUTED.** The owner typed the Golden A password directly into the
> Playwright-controlled Chrome profile (`ms-playwright-mcp/mcp-chrome-ff5022f`); the earlier attempt
> had landed in the owner's personal Chrome, which was never read. The session was proved against the
> **paired** backend before any step was graded: `GET /api/auth/me` → **200**,
> `id: golden-a-owner-stg`, role `owner`. Per the standing boundary, **no session was fabricated,
> minted, or forged via `x-user-id`, and no `password_hash` was read or changed.**
>
> **Pairing proof:** preview frontend `4389b459e06ed82a…` == paired backend `build.commit_sha`
> `4389b459e06ed82a…` (branch `integration/canonical-vehicle-truth-closure`, env `preview`), while the
> shared staging backend is a *different* SHA (`87033020`, `main`, env `production`) — so stray traffic
> is detectable rather than silent. **Zero requests reached the shared backend** on every page
> (`performance.getEntriesByType('resource')` sweep: paired 8–14, shared **0**).

| # | Persona | Surface | Expected | Observed | Result | Evidence |
|---:|---|---|---|---|:---:|---|
| 12 | Golden A owner | Owner Dashboard | Real bell count; never a confident `0` on a failed read | Bell = **1** (`owner-notification-count`); DB ground truth 1 unread. `/api/notifications/me` → **200**, so the count is *measured*, not an or-zero default | **PASS** | `step12-14-goldenA-dashboard.png` |
| 13 | Golden A owner | *Needs your attention* | No "awaiting assessment" for evaluated Golden A | *"1 unread notification — Recent activity on your vehicles and conversations."* Neither *"awaiting assessment"* nor *"no completed trust assessment"* appears | **PASS** | `step12-14-goldenA-dashboard.png` |
| 14 | Golden A owner | Wallet / Trust Index tiles | *Not available*; no fabricated balance or trend | Wallet USD **and** ZiG: *"Not available — No wallet established for this account"*; Trust Index *"Not calculated — Verification pending"*; *"Valuation history is not available for your account yet."* Escrows `$0 / 0 active` is a **measured** zero — `/api/safepay/list` **200** and DB has 0 rows | **PASS** | `step12-14-goldenA-dashboard.png` |
| 15 | Golden A owner | My Garage | Asking Price, stated mileage, real media, **counts not false zeros** | Asking Price `$21,500` ✓ (DB 21500), `78,450 km` ✓, and every count matches DB exactly: 4 verified documents / 0 services / 1 part / 1 policy. **But media is absent: `listing-image-placeholder`, *"Image unavailable"*, zero `<img>` — while 5 published images exist** (`listing_images`=5, all canonical `vehicle-images` URLs, rendered fine on the public page). **D5** | **FAIL** | `step15-goldenA-garage-image-unavailable.png` |
| 16 | Golden A owner | `/dashboard/garage/CARUPGLDNA0000001` | No valuation language; header image is real listing media | No valuation term present (`valuation`, `estimated value`, `market value`, `appraisal`, `book value`, `trade-in` all absent). Header image is real listing media: `…/vehicle-images/CARUPGLDNA0000001/golden-exterior-front.png`, loaded at 960px | **PASS** | `step16-19-goldenA-garage-detail.png` |
| 17 | Golden A owner | Specs / purchase date | Recorded or *Not recorded*; `Purchased` must not be `created_at` | *"Purchased — Not recorded"*. `created_at` is 8/24/2026 and is **not** published as the purchase date | **PASS** | `step16-19-goldenA-garage-detail.png` |
| 18 | Golden A owner | Service / parts history | Parts and services must not double-count one PartSentry row | *"Total Services 0 / Total Parts 1"* — the single `partsentry_logs` row is counted **once**, as a part. Staging has no service table at all, so 0 is correct | **PASS** | `step16-19-goldenA-garage-detail.png` |
| 19 | Golden A owner | Owner Trust vs public Trust | Identical **60** / same version | Owner: `60 / 100` · Moderate trust · Low confidence · `trust-decision-1.0.0`. Public passport `trustReport`: score 60, band moderate, state evaluated, confidence low, version `trust-decision-1.0.0`. **Identical** | **PASS** | `step16-19-goldenA-garage-detail.png` |
| 20 | Golden A owner | Owner top-bar search | `Hilux` → `/search?q=Hilux`; also narrow viewport (OBS-14) | Desktop (1280): typed `Hilux` into `owner-topbar-search` → navigated to **`/search?q=Hilux`**. Narrow (390): `owner-topbar-search-mobile` visible (36×36) → `/search`, typed `Hilux` → **1 result** (2019 Toyota Hilux, $21,500, 78,450 km), no horizontal overflow | **PASS** | `step20-goldenA-search-hilux.png`, `obs14-goldenA-narrow-search.png` |

## Golden B — unauthenticated Buyer

| # | Persona | Surface | Expected | Observed | Result | Evidence |
|---:|---|---|---|---|:---:|---|
| 21 | Anon buyer | Marketplace search | **Must NOT appear** — it is draft | Physically typed `CARUPGLDNB0000002` into `[data-testid="marketplace-search-input"]` → **"0 vehicles found / No matching vehicles found"**, zero result links | **PASS** | `uat-step21-goldenB-absent-search.png` |
| 22 | Anon buyer | `/marketplace/CARUPGLDNB0000002` | Passport renders but not as a published listing; Reserve disabled with explanation | Passport rendered; no published-listing claim; **Reserve Vehicle `disabled=true`, `aria-disabled=true`**; `reserve-unavailable`: *"SafePay escrow is opened by CarUp once a verified inquiry confirms the seller, so it cannot be started from this page."* Listing API 404 | **PASS** | `uat-step22-24-goldenB-passport.png` |
| 23 | Anon buyer | Golden B Trust | **50** · evaluated · moderate · low · `trust-decision-1.0.0` | `trust-score-badge` = **"50 Moderate trust"**, `trust-score-value` = **50**, *Evaluated*, *Low confidence*, `trust-decision-1.0.0` | **PASS** | `uat-step22-24-goldenB-passport.png` |
| 24 | Anon buyer | Golden B evidence & gallery | Both empty/withheld; pending document NOT public; absence never a clean bill of health | 0 media thumbs, *"No photos are published for this listing. That is a statement about what this page publishes, and about nothing else. Nothing follows from it about what the seller did."*; evidence empty; **no "pending" text anywhere public**; **no** unpublishable sentence (correct — B's only doc is genuinely pending) | **PASS** | `uat-step22-24-goldenB-passport.png` |

## Golden B — authenticated Owner

> **Run 4 (2026-08-25) — EXECUTED.** Golden A was signed out first (token cleared; `localStorage` back to `carup_nav_cohort` only), then the owner entered the Golden B password in the same automation profile. Session proved against the **paired** backend before grading: `GET /api/auth/me` → **200**, `id: golden-b-owner-stg`, role `owner`. Zero requests reached the shared staging backend.

| # | Persona | Surface | Expected | Observed | Result | Evidence |
|---:|---|---|---|---|:---:|---|
| 25 | Golden B owner | *Needs your attention* | Real outstanding work; must not say "no completed trust assessment" | Neither *"no completed trust assessment"* nor *"awaiting assessment"* appears. Trust is published as `50 / 100 · Moderate trust`, matching the governed value. *"Notifications 0 new"* is a **measured** zero (DB: 0 unread for this recipient) | **PASS** | `step25-goldenB-dashboard.png` |
| 26 | Golden B owner | My Garage → Golden B | Recorded status or *Status not recorded*; no invented "Active" | `vehicle-status-CARUPGLDNB0000002` = **`available`** — the literal recorded `vehicles.status`, not an invented *"Active"*. All four counts are true zeros: 0 verified documents (the one evidence row is `pending`), 0 services, 0 policies, 0 parts | **PASS** | `step26-goldenB-garage.png` |
| 27 | Golden B owner | `/dashboard/garage/CARUPGLDNB0000002` | Pending evidence shows as pending; no valuation, no stock image, no fabricated date | *"Registration Document — 8/24/2026 — **pending**"* ✓. No valuation term. Header image is real Supabase media (`…/vehicle-images/CARUPGLDNB0000002/golden-exterior-front.png`, loaded 960px) — no stock/Unsplash/placeholder host. *"Purchased — Not recorded"*, no fabricated date | **PASS** | `step27-28-goldenB-publish-refused-silently.png` |
| 28 | Golden B owner | Attempt to publish | Refused, naming the blocking requirement; stays draft | Physically clicked `publish-toggle-CARUPGLDNB0000002`. **Refused** — `POST /api/vehicles/…/publish` → **400**; listing **stays `draft`** (re-read from DB). The API names the requirement exactly: `pending_gaps:[{ownership_document, "Ownership / Registration Document"}]`, `pending_review`, `completeness_percent: 80`. **The UI surfaces it too:** a `sonner` toast reading *"Not publishable yet. Awaiting CarUp verification: Ownership / Registration Document. Nothing more is needed from you until that review completes."* — measured visible at `top:24 left:900 356×112`, present across 33 consecutive 100 ms samples from t=2.8 s to t=6.1 s after the click | **PASS** | in-browser DOM capture; `step27-28-goldenB-publish-refused-silently.png` |

## Cross-cutting

| # | Persona | Surface | Expected | Observed | Result | Evidence |
|---:|---|---|---|---|:---:|---|
| 29 | Anon | `/dealers`, `/garages`, `/insurance` | Explicit verified-only empty states; no invented companies | All three: *"No verified {dealers/garages/insurance providers} listed yet … None has been published yet, so this directory is empty rather than showing unverified entries."* No company names present | **PASS** | `uat-step29a-dealers.png`, `uat-step29c-insurance.png` |
| 30 | Anon | `/press`, `/blog` | No fabricated integrations/personnel/metrics/partnerships/seeded comments; **surfaces live and visually intact** | Governance clean (no ZINARA integration claim, no partnership, no funding round, no fake counts, no seeded comments, no invented author personas, role emails only, *"We do not publish a response time we cannot commit to"*, *"No press releases published yet"*). **But raw escape sequences render as literal visible text:** `/press` → `Zimbabwe\'s`, `CarUp’s`; `/blog` → `CarUp’s`, `—` | **FAIL** | `uat-step30a-press.png` |
| 31 | Anon | UI search for "blockchain" | Product surfaces say **CarUp audit ledger** | `/privacy` physically renders **`SECTION_ID: BLOCKCHAIN_TRUST_LEDGER`** and **"PartSentry Blockchain Hashing — Allows historical part updates and odometer metrics to be cryptographically hashed onto the public registry ledger."** The repo's own code comment states part authenticity is tracked by "CarUp audit ledger, **not a public blockchain**" | **FAIL** | `uat-step31-privacy-blockchain.png` |
| 32 | Anon | Local Storage | No key asserting reservation/escrow/payment/transaction state | Only `carup_nav_cohort`. No cookies. `sessionStorage` holds Vercel toolbar internals only (`__vtkb-hide-key`, `vc-mfe-session-cleared`, `vc-dt-src`) | **PASS** | in-browser storage dump |

## Responsive / accessibility (OBS)

| Item | Expected | Observed | Result | Evidence |
|---|---|---|:---:|---|
| OBS-02 | Detail price/action panel does not obstruct content while scrolling | At 390×844 the only `sticky`/`fixed` element is the site header (384×65, 7.6% of viewport). No obstructing action panel | **PASS** | `uat-obs06-obs-overflow-mobile-detail.png` |
| OBS-06 | Disabled Call/WhatsApp/Reserve **legible** and clearly disabled | All three `disabled=true` + `aria-disabled=true`. Rendered white text on the panel's `linear-gradient(rgb(15,23,41) → rgb(24,37,67))` ≈ **8.9:1** contrast — legible. *(An initial computed-style reading of 1.03 was a measurement artifact: `backgroundColor` does not capture a `background-image` gradient. Corrected by physical screenshot + gradient inspection.)* | **PASS** | `uat-obs06-obs-overflow-mobile-detail.png` |
| OBS-14 | Owner search available on a narrow viewport | At 390×844 the desktop field is hidden and `owner-topbar-search-mobile` is visible (36×36); it opens `/search`, and typing `Hilux` returned 1 correct result with no horizontal overflow | **PASS** | `obs14-goldenA-narrow-search.png` |
| OBS-16 | My Listings mobile: CTA inside card, no horizontal overflow | At 390×844: `scrollWidth` 384 ≤ 390 (no overflow), zero elements extending past the viewport, and both CTAs (*View listing*, *Unpublish*) measured **inside** their card bounds | **PASS** | `obs16-goldenA-listings-mobile.png` |
| **OBS-20 (new)** | Public Detail must not overflow horizontally on mobile | At 390×844, `documentElement.scrollWidth = 448` → **58px horizontal overflow**, reproduced on a fresh load; 171 elements exceed the viewport. Root cause isolated to the `plate-advisory-withheld` block (`flex items-center`, width 432 at left 16) — a flexbox `min-width:auto` overflow needing `min-w-0` on the text child. All other containers correctly measure 384 | **FAIL** | `uat-obs06-obs-overflow-mobile-detail.png` |

## Non-regression invariants — status on this run

| # | Invariant | Status |
|---:|---|:---:|
| 1 | Golden B absent from public Marketplace while draft | **HOLDS** (Step 21) |
| 2 | Golden B Passport renders without becoming a published listing | **HOLDS** (Step 22) |
| 3 | Golden B pending document withheld publicly | **HOLDS** (Step 24) |
| 4 | Golden B draft listing media withheld publicly | **HOLDS** (Step 24) |
| 5 | Reserve for B cannot initiate a transaction | **HOLDS** (Step 22) |
| 6 | Publication gate rejects B and leaves it draft | **NOT RE-OBSERVED** (Step 28 blocked) |
| 7 | No fabricated seller phone; Call disabled | **HOLDS** (Step 10) |
| 8 | No bare `ZW`/`CVR` registration fallback | **HOLDS** (Step 9) |
| 9 | Listing media and verified evidence remain distinct | **HOLDS** structurally, but evidence side is defective (Step 8) |
| 10 | Directories keep honest verified-only empty states | **HOLDS** (Step 29) |
| 11 | No `blockchain` wording on product surfaces | **VIOLATED** (Step 31) |
| 12 | Local Storage asserts no transaction truth | **HOLDS** (Step 32) |
| 13 | Landing and owner search preserve query intent | **PARTIAL** — Landing holds (Step 3); owner search blocked (Step 20) |
| 14 | Wallet/value tiles invent no balance or trend | **NOT RE-OBSERVED** (Step 14 blocked) |
| 15 | No stock image substituted where media unavailable | **HOLDS** — Landing showed honest "Image unavailable" on 3 non-Golden cards |

---

## The three defects

### D1 — Step 1: public verification badges published from claims the trust authority withholds

One API response simultaneously asserts, for VIN `JF1GPAL60J9UAT303`:

- `marketplace_tags: [… "duty_cleared", "zimra_verified", "cid_clear" …]` → rendered as public pill badges, and
- `known_limitations: ["The stored 'zimra_verified' flag … is not supported by any authoritative record and is not published.", …]`, `unbacked_legacy_claims: 3`.

Both cannot be true. Independent adversarial review — including a lens tasked specifically with
*refuting* the finding — returned **GENUINE_DEFECT, high confidence**. Mechanically:
`listingSummaryService.js:505-507` derives the three tags from ungated truthiness reads
(`boolValue(vehicle?.duty_paid)` …), sitting between neighbours that **are** provenance-gated.
`trustPermissionService.js:18` classifies `zimra_verified`/`cid_clear` as **GOVERNMENT_APPROVAL_FACTS**
— the repo's own write governance says only a government authority may assert them.
`marketplaceTrustSummaryService.js:35-37` converts the slugs into affirmative institutional prose.

Golden A is unaffected (its tags are `evidence_available`/`one_owner`/`private_sale`), so this does not
alter the Golden verdict — but Step 1 governs **every** card on the surface, and the surface publishes
an unbacked government-approval claim to anonymous visitors.

**Aggravating findings from the adversarial review:**

- **No legitimate writer exists for any of the three flags.** `duty_paid: true` has zero writers (only
  `false` at `server.js:2272`); `zimra_verified` has zero writers repo-wide; and `police_verified: true`
  is written only by `securityService.js:53`, where it means *"was reported stolen, then recovered"* —
  the **inverse** of the "Police (CID) clearance on record" badge it renders. A public trust badge is
  being produced from a flag whose only writer means the opposite.
- **The Phase 8 invariant suite is structurally blind to this.** `INV-2`'s `findBareClaims` walks only
  `LISTING_CLAIM_BLOCKS` keys, and `marketplace_tags` is a flat `string[]` — so the suite cannot see it.
- **It falsifies a Phase 8 claim of record**: `ISSUE164_PHASE8_SURFACE_CONVERGENCE.md:21` states Landing
  renders "governed tags only".

**Scope — this is carried-forward, not branch-introduced.** The skeptic lens conceded the point but
established that this predates PR #165 and is Issue #164's own **unexecuted `FACT_MODEL` M4**. Phase 4
(commit `1b2e453b`) provenance-gated `plate_verified`, `dealer_verified` and `private_sale` in this very
function and left these three on raw `boolValue()` three lines away. It is in Issue #164's remit by
name, but it is not a regression this branch caused.

**Blast radius if fixed now — this is the material decision.** All six governed facts resolve to
`unknown` for all 16 staging vehicles, so gating them removes `duty_cleared`/`zimra_verified`/`cid_clear`
from essentially **every** listing, changing the Landing hero and grid, Marketplace cards, detail/passport
`trust_badges` and `public_badge_copy`, compare/recommendations, the free-text search corpus, and the
`?tag=` filter and its facet list. `marketplace-listing-summary.test.js:442-450` currently asserts these
tags **must be present** and would need rewriting. The list path does not resolve facts per VIN, so the
gate must ride the cached canonical record and fail closed. That is a wide, late change to a closure PR —
and it is why this needs an explicit owner decision rather than an autonomous fix.

### D2 — Step 8: four verified evidence documents publish as "none"

`vehicleMediaProjection.js:803` rejects a row via `isPublishableMediaUrl(row.file_url)`;
`classifyMediaUrl` (`:521-533`) returns `null` for a **path-relative** value. It inspects **only**
`file_url` — never `storage_bucket` or `file_path`.

Cluster C (commit `fdc9953a`, on this branch) moved evidence from
`https://evidence.carup-staging.test/…` (absolute) into the private `ocr-documents` bucket with a
relative path — the correct canonical contract for private PII documents. That correct change made all
four verified rows fail a **URL-shape** test and become `unpublishable`. So this branch introduced the
regression, and the public surface now states something false: four human-reviewed, verified documents
are reported as *"No verified evidence has been published for this vehicle."*

**Adjudicated GENUINE_DEFECT (high) after a split review.** A skeptic lens argued NOT_A_DEFECT on the
grounds that `empty_statement` says *"published"*, not *"exists"*, and that the sibling sentence does
disclose existence. That argument fails on its own strongest ground: **`state` is a machine-readable
enum on a public API**, and in this contract's own vocabulary `none` means *"we looked and found
nothing"* (as against `not_loaded` = *"we did not look"*). The true state — *"we looked, found four
governed facts, and refused them on string shape"* — is inexpressible, so it is **misfiled as absence**.
Careful prose in a sibling field cannot rescue a false enum. The code's own comment at
`vehicleMediaProjection.js:804-805` states the requirement verbatim — *"the block cannot pass 'we could
not publish it' off as 'this vehicle has no verified evidence'"* — which is exactly what it does. And
`server.js:1318` already ships `evidenceVault` with four rows stamped `verification_status:"verified"`
to the same anonymous caller **in the same response body**, so the passport contradicts itself
internally.

**The obvious fix is the wrong fix — do NOT mint signed URLs.** `vehiclesRoutes.js:218-220`
(`evidenceDefaultVisibility()`) returns **`restricted`** for every document evidence type
(registration, insurance, police clearance, ownership transfer). Production never defaults these to
`public_safe`; the **fixture hardcodes it** (`goldenVehicleFixture.js:273`) with a justification comment
that is incorrect. **No reviewer ever cleared these documents for public display**, so signing them
would enshrine a fixture bug as the public contract and hand anonymous callers PII.

**Correct shape: publish the _fact_, withhold the _file_** — `state:"published"`, 4 items,
`unpublishable_count:0`, each item carrying `evidence_type`, `verification_status`, `visibility_level`,
`verified_at`, `mime_type`, `file_size`, and `file_url: null` with
`file_availability:"withheld_private"`. No signed URL, no `storage_bucket`, no `file_path`, no byte
leaves the server. Golden B (single `pending` row) stays correctly withheld under this shape.

A contributing frontend defect prints both sentences at once: `VehicleDetail.tsx:1931-1992` is a
three-way ternary that picks exactly one state, but `:1994-1999` is a **separate, unguarded** `&&` on
`unpublishable_count > 0` rendered after it.

Golden B is correctly unaffected — its single document is genuinely `pending`, so its empty state is
true and no unpublishable sentence appears. Any fix must preserve that.

### D3 — Steps 30 & 31: content defects on public pages

- **Escape-sequence corruption** (Step 30): `PressKit.tsx:185` (`Zimbabwe\'s`), `PressKit.tsx:768`
  (`CarUp’s`), `Blog.tsx:659` (`CarUp’s`, `—`). These are **JSX text children**, where
  backslash escapes are not interpreted and render literally. (The `\'` occurrences in `mockData.ts`,
  `About.tsx`, `HelpCenter.tsx` are inside quoted JS strings — valid escapes, not defects.)
- **`blockchain` wording** (Step 31): `PrivacyPolicy.tsx:513` and `:812` render visible "blockchain"
  text, and `:812` asserts a cryptographic-hashing capability onto a "public registry ledger" that the
  codebase elsewhere explicitly disclaims.

### D0 — **P0 SECURITY: anonymous callers get raw evidence rows and working signed URLs to private PDFs**

Found while adjudicating D2, then **physically confirmed end to end against the paired preview**. This
is the most serious finding of the run and was not covered by any of the 32 steps.

`GET /api/vehicles/CARUPGLDNA0000001/evidence` — **no authentication, VIN only** (a VIN is printed on
every windscreen):

```
HTTP 200 · 4 rows · 54 keys per row  (the entire raw DB row)
```

Leaked in the clear to an anonymous caller:

- `plate_number`, `normalized_plate_number`, `chassis_number`, `engine_number` — **the exact
  identifiers the passport deliberately withholds** ("Chassis No. Not shown publicly", "Engine No. Not
  shown publicly", `identity-plate-withheld`);
- `uploaded_by`, `verified_by`, `tenant_id`, `verification_notes`, `file_path`, `storage_bucket`;
- **a working signed URL into the private `ocr-documents` bucket.**

The signed URL was fetched anonymously and returned the document:

```
HTTP 200 · content-type: application/pdf · 1121 bytes · magic %PDF-1.4
control (same object, no token): HTTP 400   ← the bucket IS correctly private
```

So the bucket is configured correctly; **the API itself mints the capability**. On a real vehicle these
PDFs are registration papers, police clearance and insurance — carrying owner name, residential
address, national ID and policy numbers — and nothing in this codebase redacts PDF interiors. A signed
URL is a shareable bearer token for its full TTL.

Per the review, the route also trusts a bare `x-user-id` header without `isUserIdFallbackAllowed()`
(`vehiclesRoutes.js:382`) and bypasses `toPublicEvidence`/`PUBLIC_EVIDENCE_FIELDS` entirely
(`vehiclesRoutes.js:453`, signing at `:532`).

**One thing does hold:** Golden B returned `rows: 0` — its `pending` document is **not** leaked, so
invariant 3 survives even here.

This is a pre-existing route, not introduced by this branch, but it is live on the candidate and it
defeats the passport's entire withholding posture. It should be fixed before merge and is arguably a
staging-security matter independent of Issue #164.

### Secondary observation — not scored

`/blog`'s "Zimbabwean Auto Reference Index" states third-party regulatory operational facts without a
cited source ("Pre-clearance processing takes 24-48h at Beitbridge", "Integrated with ANPR digital
transponders"). These are **not** claimed CarUp integrations, so Step 30's literal criterion is not
breached, but they sit close to the Cluster G sourcing rule and are flagged for adjudication rather
than silently accepted.

---

## What must happen next

1. **D0 first — it is a P0.** Route anonymous responses through `toPublicEvidence`, gate the
   `generateSecureReadUrl` call at `vehiclesRoutes.js:532` on authorisation, and gate the `x-user-id`
   fallback at `:382` behind `isUserIdFallbackAllowed()`. Physically re-verify that an anonymous
   `GET /api/vehicles/:vin/evidence` returns neither chassis/engine/plate nor any signed URL.
2. **Owner action required** — provide an authenticated Golden A and Golden B session (or run Steps
   12–20 / 25–28 directly). Thirteen steps and invariants 6 and 14 cannot be certified without it.
3. **Fix D2 and D3 on PR #165.** D2's fix is *publish the fact, withhold the file* — explicitly **not**
   signed URLs. Also correct the fixture's hardcoded `public_safe` (`goldenVehicleFixture.js:273`),
   which contradicts production's `restricted` default. Each fix needs a regression test that **fails
   on the current behaviour** (mutation-proved), not merely passes after.
4. **D1 needs an owner decision** before any code moves — it is carried-forward, not branch-introduced,
   and the fix has wide blast radius (see D1).
5. A new SHA forces full recertification: local gates → exact-head CI → fresh Codex → paired
   provenance → affected re-test → **complete 32-step UAT again**.
6. Do **not** merge. Do **not** revoke the Golden credentials yet — they are needed for the blocked
   steps and for the re-run.

---

# D1 — DECISION BRIEF (no code changed; owner decision required)

## The conflict, in one response body

For `JF1GPAL60J9UAT303`, `GET /api/marketplace/listings` returns **both**:

```
marketplace_tags: [ "duty_cleared", "zimra_verified", "cid_clear", … ]   → rendered as public pill badges
trust.known_limitations: [ "The stored 'zimra_verified' flag … is not supported by any
                            authoritative record and is not published.", … ]
trust.evidence_basis.unbacked_legacy_claims: 3
```

## What makes this more than a cosmetic inconsistency

1. **No legitimate writer exists for any of the three flags.** `duty_paid: true` has zero writers
   (only `false`, `server.js:2272`); `zimra_verified` has zero writers repo-wide; `police_verified: true`
   is written **only** by `securityService.js:53`, where it records *"was reported stolen, then
   recovered"* — the **inverse** of the "Police (CID) clearance on record" badge it renders.
2. **The repo's own governance disagrees with the surface.** `trustPermissionService.js:18` classifies
   `zimra_verified`/`cid_clear` as `GOVERNMENT_APPROVAL_FACTS` — only a government authority may
   assert them. `marketplaceTrustSummaryService.js:35-37` turns the slugs into affirmative
   institutional prose and ranks them 2nd/3rd.
3. **The Phase 8 invariant suite cannot see it.** `INV-2`'s `findBareClaims` walks
   `LISTING_CLAIM_BLOCKS` keys; `marketplace_tags` is a flat `string[]`.
4. **It falsifies a Phase 8 claim of record** — `ISSUE164_PHASE8_SURFACE_CONVERGENCE.md:21` states
   Landing renders "governed tags only".
5. Phase 4 (`1b2e453b`) provenance-gated `plate_verified`, `dealer_verified` and `private_sale` **in
   this same function** and left these three on raw `boolValue()` three lines away.

## What it is not

- **Not branch-introduced.** It predates PR #165 and is Issue #164's own unexecuted `FACT_MODEL` M4.
- **Not a Golden A/B defect.** Golden A's tags are `evidence_available` / `one_owner` / `private_sale`,
  all correct. The Golden verdict is unaffected either way.

## Options

### Option 1 — Fix now, inside PR #165

Gate the three tags on the publication decision the response already carries.

- *Where*: `listingSummaryService.js:505-507` (tags) **and** `:652-654` (the same three as flat
  booleans, or the claim leaks by a second route). `canonicalTrustService` publishes a **structured**
  list of unpublishable legacy columns — never parse the prose sentence. Fail closed when no canonical
  record is available, matching `plate_verified` at `:503`.
- *Test debt*: `marketplace-listing-summary.test.js:442-450` currently asserts these tags **must be
  present** and inverts. The negative/positive-twin precedent already exists at `:478-490`.
- *Blast radius*: all six governed facts resolve to `unknown` for all 16 staging vehicles, so the
  badges disappear from **essentially every listing** — Landing hero and grid, Marketplace cards,
  passport `trust_badges` / `public_badge_copy`, compare/recommendations, the free-text search corpus,
  and the `?tag=` filter **and its facet list**. Requires a fresh 32-step UAT.
- *Cost*: highest. *Benefit*: the public surface stops asserting government approval nothing can back.

### Option 2 — Scope to a follow-up; close #164 on D0/D2/D3

- *Cost*: lowest; keeps this PR's blast radius to what the UAT actually exercised.
- *Risk carried*: the surface keeps publishing an unbacked government-approval badge, including one
  whose only writer means the opposite. Must be logged as a known open defect, not silently deferred.

### Option 3 — Narrow interim: suppress only the three GOVERNMENT_APPROVAL_FACTS tags

Suppress `duty_cleared`, `zimra_verified`, `cid_clear` unconditionally (they have **no** legitimate
writer, so nothing true is lost), and leave `fresh_import` / `safe_pay_ready` / `inspection_ready`
alone. No trust-record plumbing, no fail-closed logic, no new coupling.

- *Cost*: small and mechanical. *Benefit*: removes the false institutional claim immediately.
- *Trade-off*: not the full M4 provenance model — a later real ZIMRA/CID integration still needs
  Option 1's gating before those badges could return.

## Recommendation

**Option 3 now, Option 1 as the tracked M4 follow-up** — if the owner wants the false claim off the
public surface without a wide, late change to a closure PR. Because these three flags have no
legitimate writer, suppressing them removes only claims the platform cannot substantiate, which makes
the change far narrower than the full provenance gate while closing the actual misstatement.

**Nothing in D1 has been changed. Awaiting the owner's decision.**

---

# RUN 2 — physical re-test on the remediated candidate `24b647fd`

Provenance re-confirmed before the run: frontend SHA == backend `/api/health` SHA ==
`24b647fd541d68f5edddc022cb5975894107fa1b`, **EQUAL**, zero calls to the stable staging backend.

## D0 — re-verified closed against the live route

| Probe | Before | After |
|---|---|---|
| anonymous `GET /api/vehicles/CARUPGLDNA0000001/evidence` | 200, 4 rows × **54 keys** | 200, 4 rows × **29 keys** |
| `plate_number`, `chassis_number`, `engine_number`, `uploaded_by`, `verified_by`, `tenant_id`, `verification_notes`, `file_path`, `storage_bucket` | **all present** | **none present** |
| signed URL into `ocr-documents` | **present, served `%PDF-1.4`** | **absent** |
| `x-user-id: golden-b-owner-stg` on Golden B | **1 row — the PENDING document + signed URL** | **0 rows** |
| `x-tenant-id: any-tenant` | (escalation path present in code) | no widening, no signing |

Each item now reports `file_url: null`, `file_availability: "withheld_private"`.

## Re-tested steps

| # | Step | Run 1 | Run 2 | Observed on `24b647fd` | Evidence |
|---:|---|:---:|:---:|---|---|
| 8 | Media vs evidence | **FAIL** | **PASS** | Passport: `state: published`, **4 items**, `unpublishable_count: 0`. Page renders **4** `verified-evidence-item` — Registration document, Police clearance document, Inspection photo, Insurance document — each with `verified-evidence-file-withheld` ("CarUp reviewed this document and is not publishing the file itself"). No empty state, **no contradiction**, no `ocr-documents` or `token=` in the block. Media stays separate: 5 thumbs, gallery `1 / 5` | `uat-retest-step08-evidence-published.png` |
| 30 | `/press`, `/blog` | **FAIL** | **PASS** | Zero escape leaks on both. `CarUp’s communications team` and `Zimbabwe’s automotive landscape` render as real typography; `/blog` renders `CarUp’s editorial desk` and the em-dash correctly. "No press releases published yet" and the no-SLA statement retained; no fake counts | `uat-retest-step30-blog.png` |
| 31 | "blockchain" wording | **FAIL** | **PASS** | `/privacy` renders **0** occurrences of "blockchain"; no "public registry ledger" claim; heading now "4. CarUp Audit Ledger Disclosure" with "not published to any external or public network" | — |
| 1 | Landing badges | **FAIL** | **FAIL** | Unchanged **by design** — "Zimra Verified" / "Duty Cleared" still render. D1 is not implemented pending the owner decision (see the D1 decision brief above) | `uat-step01-02-landing.png` |

## Non-regression re-confirmed on `24b647fd`

- **Golden A**: Trust `60 Moderate trust`, `trust-decision-1.0.0`, location `Bulawayo, Bulawayo
  Metropolitan, Zimbabwe`, `No contact number published`, `Reg. Country Not recorded`, 5 media thumbs,
  gallery `1 / 5`, primary image 960×640 from canonical storage, **no `Trust NN` on any card**.
- **Golden B**: **0** evidence items, honest empty statement, **`pending` still not leaked anywhere
  public**, 0 media thumbs, Trust `50 Moderate trust`, Reserve `disabled` + `aria-disabled` with the
  SafePay explanation.
- **Local Storage**: `carup_nav_cohort` only.

## The client was the second half of D2

Worth recording because backend-only verification would have missed it. After the server was fixed and
the passport correctly returned `state: published` with 4 items, **the page still rendered "No verified
evidence has been published for this vehicle."** `readVerifiedEvidenceBlock` re-derives the verdict
client-side, and `classifyMediaUrl(null)` returns `null` — so a deliberately withheld document was
counted unpublishable and dropped, reproducing D2 exactly one layer out.

Only physically re-testing the deployed page caught it. A green backend test and a correct API
response were both true and both insufficient.

## Method note — two gates that were not what they appeared

1. **Backend suite CWD.** Run from `backend/`, the suite reports failures that do not exist; CI runs
   `node --test backend/tests/*.test.js` from the repo root. An earlier run showed 8 failures of which
   **7 were pure CWD artifacts**.
2. **Web typecheck project.** CI runs `npx tsc --noEmit --project web/tsconfig.app.json`. A bare
   `npx tsc --noEmit` from `web/` resolves a different project and passed while CI failed on a real
   `TS2352`. **The bare form is not the gate.**

## What still stands between this and a release pass

1. **Step 1 / D1** — owner policy decision (three options in the decision brief above).
2. **13 authenticated steps** — owner-provided Golden A and Golden B sessions.
3. `main` carries the same D0 exposure and needs expedited protected-`main` remediation.

---

# RUN 3 — after the Codex round and the owner's two decisions (`efe7e3ee`)

Provenance re-confirmed: frontend SHA == backend `/api/health` SHA == `efe7e3ee`, **EQUAL**, zero calls
to the stable staging backend. Exact-head CI green.

## Step 1 — now PASS

Owner decision: **D1 Option 3** — suppress `duty_cleared`, `zimra_verified` and `cid_clear`
unconditionally, because no legitimate writer exists for any of them.

Physically observed on the Landing page:

| Claim | Before | After |
|---|---|---|
| "Zimra Verified" | rendered | **absent** |
| "Duty Cleared" | rendered | **absent** |
| "CID Clear" | rendered (filter chip) | **absent** |
| "Police Checked" | rendered (Marketplace card) | **absent** |
| `Trust NN` on any card | 0 | **0** |
| *Fresh Import*, *Low Mileage*, *Evidence Available* | present | **present** |
| Golden A card | 2019 Toyota Hilux · USD 21,500 · Bulawayo · Evidence Available / One Owner · image 960×640 | **unchanged** |

**Four publication routes existed, not one** — which is why the first backend-only pass looked
complete and was not:

1. the `marketplace_tags` array (backend);
2. the flat booleans on the summary (backend);
3. the Landing `popular-search-chip` filter suggestions (frontend);
4. `Marketplace.tsx` deriving labels **directly from the raw columns**, bypassing the tag array.

Route 4 carried the sharper half: `police_verified → "Police Checked"`. That column's only writer
records *"was reported stolen, then recovered"*, so the label asserted a clean police check on the
strength of a theft report. A hardcoded `"ZIMRA Duty Cleared"` printed on every row of the bank
LendingQueue — with no data behind it whatsoever — was removed in the same pass.

The tag names remain in the vocabulary so a future `FACT_MODEL` M4 provenance gate has something to
re-enable. A legacy boolean alone must never suffice.

## D0 — the second door, found by review and closed

Independent review after the first D0 fix found `GET /api/vehicles/:vin/evidence/timeline`: an
anonymous sibling route doing `select('*')` whose only sanitation was `delete metadata.ai_analysis`.
Confirmed live on the supposedly-fixed head — the D0 fix was bypassable by appending seven characters
to the URL.

| Probe | Before | After (`efe7e3ee`) |
|---|---|---|
| `/evidence/timeline` evidence rows | 4 × **54 keys** | 4 × **29 keys** |
| `uploaded_by`, `verified_by`, `file_path`, `storage_bucket`, identity columns | present with values | **none present** |
| `timeline[].details.uploadedBy` | `"golden-a-owner-stg"` | **absent** |
| `ocr-documents` / `token=` anywhere | present | **absent** |

The `timeline[]` array leaked **independently** of `evidence[]`: `evidenceToTimelineItem` sets `desc`
to the reviewer's free text (`verification_notes`), `details.uploadedBy` to an internal identity, and
carries `metadata` (holding `ai_ready.vehicle_identity`: vin, plate, chassis, engine) onto the event.

## Codex adjudication — six findings

| Finding | Codex | Verified | Outcome |
|---|:---:|:---:|---|
| Evidence timeline unsanitised | P1 | **P0** | fixed |
| Signed path not bound to the authorized vehicle | P1 | P1 | fixed |
| Passport `evidenceVault` leaks the private locator | P2 | P2 | fixed (broader than reported — `file_url` **is** the path) |
| AI summary not validated as a scalar | P2 | P2 | fixed |
| `/privacy` still claims a public ledger | P2 | P2 | fixed |
| Client fallback drops withheld evidence | P2 | — | **NOT VALID** |

**NOT VALID, with evidence:** `resolveMediaBlock` returns the canonical block whenever it is non-null
and not `not_loaded`, and `server.js:1315` always spreads `vehicleMedia` onto the passport body — so
the fallback is never selected against this server. Its transport (`evidenceVault` via
`PUBLIC_EVIDENCE_FIELDS`) also carries no `file_availability` for a withheld branch to match. No
change made; recorded rather than silently skipped.

## Running tally — Run 3 (`efe7e3ee`)

| | |
|---|---|
| **PASS** | **19** / 32 |
| **FAIL** | **0** / 32 |
| **BLOCKED** | **13** / 32 — the authenticated steps |

All four originally-failing steps (1, 8, 30, 31) now pass on physical re-observation. **32/32 is still
not claimed:** thirteen steps have never been exercised, and no session was fabricated to change that.

---

# Run 4 — candidate `4389b459` — the authenticated steps, finally executed

**Date:** 2026-08-25 · **Preview:** `carup-maz9q7js7-11-11.vercel.app` ·
**Paired backend:** `carup-backend-staging-git-integration-canonical-ve-df06b3-11-11.vercel.app`

`efe7e3ee → 4389b459` is **documentation only** (this result sheet plus one screenshot; no product
code changed), so Run 3's 19 passes describe the same code under test and are carried forward rather
than re-run.

## Final tally — all 32 steps exercised

| | |
|---|---|
| **PASS** | **31** / 32 |
| **FAIL** | **1** / 32 — Step **15** |
| **BLOCKED** | **0** / 32 |
| **Overall** | **NOT A RELEASE PASS** — one genuine product defect (D5), plus **D4**, a fabricated verification claim found while grading Step 27 |

> **Correction — Step 28 was my measurement error, not a defect.** It was first recorded FAIL on the
> grounds that the refusal was silent. It is not: the toast renders correctly with the blocking
> requirement named. I had clicked in one tool call and polled in a *separate* one, so my observation
> window opened after the toast's ~4 s lifetime had already elapsed — the software was right and the
> instrument was wrong. Re-measured inside a single uninterrupted window, the toast is present and
> visible for 3.3 s of continuous sampling. **D6 is withdrawn**; no code was changed for it.

The thirteen blocked steps resolved to **12 PASS / 1 FAIL**. Nothing was carried over on trust: each
was physically executed in a real browser against a session the owner authenticated personally.

## How the session boundary was honoured

The first attempt failed for an honest reason worth recording: Playwright drives its own Chrome
profile (`ms-playwright-mcp/mcp-chrome-ff5022f`), so the owner's sign-in landed in their personal
Chrome and the automation browser was still anonymous. That was detected, not papered over — three
independent checks agreed (`/dashboard` → `/login`, the paired backend returning
`401 {"error":"Unauthorized. No active user context."}` on a credentialed request, and a single-tab
listing). **No session was fabricated, minted, or forged via `x-user-id`; no `password_hash` was read
or changed; no cookies were imported from the owner's own profile.** The owner then typed each
password directly into the automation window.

## Environment integrity

| Check | Result |
|---|---|
| Frontend SHA (`/carup-provenance.json`) | `4389b459e06ed82a724598e3f676d23ab6ca623e` |
| Paired backend `build.commit_sha` | `4389b459e06ed82a724598e3f676d23ab6ca623e` — **exact match** |
| Shared staging backend | `87033020` (`main`, env `production`) — a **different** SHA, so stray traffic is detectable |
| Requests to the shared backend | **0** on every page (resource-timing sweep; paired 8–14 per page) |
| Golden A identity | `/api/auth/me` → 200, `golden-a-owner-stg`, role `owner` |
| Golden B identity | `/api/auth/me` → 200, `golden-b-owner-stg`, role `owner` |

## New findings from Run 4

### D4 — hard-coded verification badges (**P1, governance**)

`web/src/pages/dashboard/owner/VehicleProfile.tsx:339–352` renders three claim badges with **no data
binding whatsoever**:

```jsx
<Badge className="bg-green-50 text-green-700"><CheckCircle /> Logbook Verified</Badge>
<Badge className="bg-blue-50 text-blue-700"><Shield /> Insurance Active</Badge>
<Badge className="bg-purple-50 text-purple-700"><Star /> PartSentry Active</Badge>
{passportData?.chainVerification?.verified && (<Badge>… Ledger Synced</Badge>)}
```

Only `Ledger Synced` is conditional. On **Golden B** — whose logbook is `pending`, with **no**
insurance record and **no** PartSentry log — the page asserts, in green with a checkmark, *"Logbook
Verified"*.

This is the exact failure mode Issue #164 exists to eliminate, and it is rendered **directly beneath**
the governed trust block this programme added, which on the same screen states *"No governed vehicle
fact is backed by an authoritative record."* One card makes both claims at once.

**Pre-existing on `main` (lines 179–185), not introduced here** — but #165 rewrote this very file
(+209/−58) to canonicalize its trust surface and left the fabricated badges standing.

### D5 — the owner cannot see their own published media (Step 15)

`/api/vehicles/me` is `select('*')` on `vehicles`, and media lives in `listing_images`, so the owner
list payload carries **no media keys at all** (`mediaKeys: []`). The client then correctly renders
`listing-image-placeholder` / *"Image unavailable"* — the client is not at fault.

Measured on the same vehicle at the same moment, the public endpoint returns `listing_media.state =
"published"` with **5** items and `primary_image_state: "first_published"`. So the public sees five
photos and the owner is told the image is unavailable. Reproduced on **My Garage**, **My Listings**
and the **owner dashboard**, for both Golden A (5 images) and Golden B (2 images).

Pre-existing, not a #165 regression — but the same family of defect as the false counts that #165's
Cluster D fixed on this very surface, and an inversion of the governing rule: *an existing governed
fact must never publish as absent.*

### D6 — WITHDRAWN. Not a defect; my instrument was wrong

Originally raised as "the server is right and silent". The server *is* right — `POST /publish` → 400,
the listing stays `draft`, and the body names the blocker exactly. The claim that nothing reached the
user was **false**.

A `sonner` toast renders with precisely the right sentence:

> *"Not publishable yet. Awaiting CarUp verification: Ownership / Registration Document. Nothing more
> is needed from you until that review completes."*

Re-measured inside a single uninterrupted browser window: it appears ~2.77 s after the click (the
request round-trip), is measured **visible** at `top:24 left:900 356×112`, and is present across 33
consecutive 100 ms samples from t=2.8 s to t=6.1 s.

**Why the first measurement was wrong.** I clicked in one tool call and polled in a *separate* one.
Several seconds pass between tool calls, so my observation window opened after the toast's ~4 s
lifetime had already elapsed. A negative result from an instrument that was not looking during the
event is not evidence of absence. `MyListings.tsx:87` already had
`toast.error(describePublicationRefusal(e))`, and `describePublicationRefusal` already read
`pending_gaps` — the code was correct the whole time.

**No code was changed for D6.** Recorded here rather than quietly dropped, because the FAIL is in the
committed record at `a3e13bfe` and a reader deserves to know it was retracted and why.

### D7 — evidence count disagrees with the evidence list (observation)

Golden A's garage card badge reads *"4 verified documents"* (correct — DB has four `verified` rows:
`inspection_photo`, `insurance_document`, `police_clearance_document`, `registration_document`), but
the vehicle page's *Evidence & Media* section renders only **three**; `inspection_photo` is omitted.
The count and the list disagree on the same screen.

## What Run 4 does not change

Steps 15 and 28 are **product defects on an unmerged branch** — nothing is in production. D4 is P1 and
pre-existing; D5, D6 and D7 are P2. None is a security issue, and none alters the two frozen security
hotfixes (#175, #176), which are unaffected by this run.

---

# Run 4 remediation — the closure candidate

Owner closure scope: **D4 + D5**, plus D7 only if it fell out mechanically. It did not (see below).
**D6 was withdrawn** — it was my measurement error, not a defect, and no code was changed for it.

## D4 — claim badges now render only when a governed fact supports them

`web/src/pages/dashboard/owner/VehicleProfile.tsx`

Each badge is bound to the narrowest fact that can honestly support it, read from the definition the
rest of the platform already uses:

| Badge | Governed fact it now requires |
|---|---|
| `Logbook Verified` | a `registration_document` / `ownership_transfer_document` whose `verification_status` is in `('verified','confirmed','approved')` — the same set `ownerGarageCounts` counts |
| `Insurance Active` | a timeline insurance event carrying `details.active === true`, i.e. `insurance_records.active` — the same column `ownerGarageCounts` filters on |
| `PartSentry Active` | at least one `partsentry:`-prefixed timeline row — the same rows that produce the parts history and the parts count |

`Ledger Synced` was already conditional and is unchanged.

**No badge has a "false" rendering.** An unsupported claim is simply not made, because *"not verified"*
and *"verified false"* are different facts and only the first is known.

To make `Insurance Active` answerable at all, `backend/services/trustGraph/trustGraphService.js` now
selects `active` and carries `active: e.active === true` on the insurance event. Strict `=== true`, so
a null never reads as active. An unauthorised caller never sees it — the public `details` allow-list
does not include `active`, so this adds nothing to the public passport.

## D5 — the owner sees their own published media

`/api/vehicles/me` is `select('*')` on `vehicles`, and `vehicles` **has no media column**; the photos
live in `listing_images`. Every owner surface read `vehicle.image_url`, got `undefined`, and rendered
the "Image unavailable" placeholder.

- `backend/server.js` — new `ownerListingMedia(vins)` batches `listing_images` for the owner's VINs
  and builds each block with **`toListingMediaBlock`**, the *same* function the public listing uses.
  The semantics are imported, never restated, so the two surfaces cannot drift on what "published"
  means. `/api/vehicles/me` now publishes `listing_media` per vehicle.
- A **failed read passes `null`**, which is `not_loaded` — never `[]`, which would be `none`. A broken
  query can never again be published to an owner as an absence of their own photographs.
- `web/src/lib/listingMedia.ts` — one selection helper (`primaryListingImageUrl`), so My Garage, My
  Listings, the dashboard row and the detail header all choose the same photograph. `VehicleProfile`
  previously derived this inline; it now uses the shared helper.

Invariant met: **published listing media == media visible on governed owner surfaces**, subject only
to access policy. No stock imagery; no placeholder where real canonical media exists.

## D7 — not fixed here, by rule

It needs a product-policy decision (*is a verified `inspection_photo` a "document"?*), and the
canonical classification cannot settle it: `evidence_class_taxonomy` holds 59 rows, but only **1 of
20** `vehicle_evidence` rows has `evidence_class` populated. Choosing a definition today would be
inventing the policy. Recorded with exact counts in
[`ISSUE164_D7_FOLLOWUP_EVIDENCE_DOCUMENT_CLASSIFICATION.md`](./ISSUE164_D7_FOLLOWUP_EVIDENCE_DOCUMENT_CLASSIFICATION.md).

## Regression tests

`web/src/pages/dashboard/owner/VehicleProfile.claims.test.tsx` (6) — including the **Golden-B negative
case**: pending logbook, no insurance, no parts ⇒ none of the three badges renders. Plus `active:false`,
a missing `active`, and a rejected logbook. A source-level guard asserts the **producer** — that each
badge sits behind its condition — so a future unconditional badge fails even without a render.

**Mutation-proved:** restoring the unconditional `Logbook Verified` badge fails 3 tests (the Golden-B
case, the rejected-logbook case, and the source guard). Reverted; 6/6 green.

`backend/tests/issue164-owner-listing-media.test.js` (6) — the endpoint attaches the block; the owner
path imports the public builder rather than restating it and does not re-derive primacy or ordering;
a failed read yields `not_loaded`, never `none`; and `null`/`undefined`/`[]` map to the correct states.

`web/src/lib/listingMedia.test.ts` (9) — primacy, fallback ordering, blank URLs, malformed input, and
`not_loaded` never being reported as `none`.

---

# Run 5 — the release receipt — candidate `41d942a8`

**Date:** 2026-08-25 · **Result: 32 PASS / 0 FAIL / 0 BLOCKED**

This is a **complete 32-step re-run against the exact remediated head**, not a patch of the two rows
that failed in Run 4. Every step was physically executed in a real browser on the paired preview.

## Environment integrity

| Check | Result |
|---|---|
| UAT origin | `carup-git-integration-canonical-vehicle-truth-closure-11-11.vercel.app` (stable branch alias) |
| Frontend SHA (`/carup-provenance.json`) | `41d942a88b25f9372c598a346d1486dfc455b400` |
| Paired backend `build.commit_sha` | `41d942a88b25f9372c598a346d1486dfc455b400` — **exact match** |
| Shared staging backend | `87033020` (`main`, env `production`) — a **different** SHA, so stray traffic is detectable |
| Calls to the shared backend | **0** on every page measured (resource-timing sweep) |
| Golden A identity | `/api/auth/me` → 200, `golden-a-owner-stg`, role `owner` |
| Golden B identity | `/api/auth/me` → 200, `golden-b-owner-stg`, role `owner` |

Both sessions were created by the owner typing each password directly into the automation Chrome
profile. **No session was fabricated, minted, or forged via `x-user-id`; no `password_hash` was read
or changed; no cookies were imported from the owner's own browser.**

## The two Run-4 failures, re-tested physically

### D4 — Golden B no longer claims what it cannot support

The decisive negative case. On `CARUPGLDNB0000002` — logbook `pending`, no insurance record, no
PartSentry log:

| Badge | Before | Now |
|---|---|---|
| `Logbook Verified` | rendered, green, with a checkmark | **absent** |
| `Insurance Active` | rendered, blue | **absent** |
| `PartSentry Active` | rendered, purple | **absent** |
| `Ledger Synced` | conditional | still conditional, still rendering |

The strings themselves are gone from the page, not merely the test ids. On **Golden A**, where a
verified registration document, an active policy and a PartSentry log all exist, all three render —
so the binding is proven in both directions rather than just switched off.

### D5 — the owner sees their own photographs

`/api/vehicles/me` now returns `listing_media: { state: "published", items: 5, unpublishable_count: 0 }`
for Golden A. Measured on every owner surface:

| Surface | Before | Now |
|---|---|---|
| Owner dashboard row | "Image unavailable" | real `golden-exterior-front.png`, loaded, **0 placeholders** |
| My Garage card | "Image unavailable" | real image at 960 px, **0 placeholders** |
| My Listings row | "Image unavailable" | real image, **0 placeholders** |

Golden B (2 images) renders its real photograph too. Counts remain exact — 4 verified documents /
0 services / 1 part / 1 policy for Golden A, all zeros for Golden B.

### Step 28 — corrected, and it passes

Re-measured inside a single uninterrupted window: **42 consecutive samples** of a visible toast from
t=1.9 s to t=6.1 s reading *"Not publishable yet. Awaiting CarUp verification: Ownership /
Registration Document. Nothing more is needed from you until that review completes."* The listing
stays `draft`, re-read from the database after the attempt. See the D6 withdrawal above.

## All 32 steps

| Group | Steps | Result |
|---|---|:--:|
| Golden A — anonymous buyer | 1–11 | **11 PASS** |
| Golden A — authenticated owner | 12–20 | **9 PASS** |
| Golden B — anonymous buyer | 21–24 | **4 PASS** |
| Golden B — authenticated owner | 25–28 | **4 PASS** |
| Cross-cutting | 29–32 | **4 PASS** |
| Responsive (OBS-14, OBS-16) | — | **2 PASS** |

Selected physical observations on this candidate: 5 media thumbs with gallery `1 / 5` and **4**
verified evidence items in a separate section; `Reg. Country` / `Reg. Authority` both *Not recorded*;
`Seller Information — Not shown publicly` with Call/WhatsApp disabled; **zero** `owner_id` /
`tenant_id` / `current_seller_id` and zero value-leaks across five public payloads; Golden B absent
from marketplace search (`0 vehicles found`) with its listing **404** while its passport renders trust
**50** and never leaks the word `pending`; `/press` and `/blog` free of literal escape sequences,
entities and mojibake while correct typography is present; **zero** occurrences of "blockchain" across
five product surfaces; local storage carries only `carup_nav_cohort`.

## Gates on this exact head

| Gate | Result |
|---|---|
| Backend suite (repo root, CI-parity env) | **4233 pass / 0 fail / 12 skipped** |
| Web typecheck `--project web/tsconfig.app.json` | clean |
| CR-1 secret scan | clean (1960 tracked files) |
| `git diff --check` | clean |
| Lint | unchanged vs documented baseline (CI runs `npm run lint \|\| true`) |
| GitHub CI on `41d942a8` | **17 pass, 4 skipping, 0 failures** |
| Exact-head Codex review | **landed** — one P2, adjudicated non-blocking (see below) |

## Exact-head Codex review — landed, one P2

Codex reviewed `41d942a88b` at 2026-08-25T02:40:09Z and raised **one** fresh finding: **P2 — "Clear
prior vehicle facts before loading a new VIN"** (`VehicleProfile.tsx:266`). An in-place `/dashboard/
garage/:id` change does not unmount the component, so `passportData` and `evidenceList` can briefly
describe *different* vehicles while their two requests resolve independently — allowing a badge from
the previous vehicle to render beside the new one.

**Owner adjudication: real, P2, non-blocking** under the frozen closure rule. After the frozen final
run, newly discovered non-P0/P1 findings are follow-up work rather than an extension of Issue #164.
**No executable `#165` code was changed for it**, and the final UAT was not reopened. Recorded in
[`ISSUE164_D8_FOLLOWUP_VEHICLE_SCOPED_STATE_RESET.md`](./ISSUE164_D8_FOLLOWUP_VEHICLE_SCOPED_STATE_RESET.md).

**A note on how I reported this.** I previously stated the Codex review had not arrived. It had —
posted as a PR *review* with an inline comment, while I was querying only issue comments. The review
existed before I said it did not; the owner checked GitHub directly and corrected me.

An older Codex **P1** ("Bind signed paths to the authorized vehicle", `vehiclesRoutes.js:629`, raised
against `b7fb5a25`) still shows as an open thread because GitHub carries `commit_id` forward to the
head and nobody resolved it. It is **already fixed** on this candidate: `vehiclesRoutes.js:338-350`
binds the locator to the authorized VIN's prefix, refuses traversal and absolute paths outright, and
treats the bucket as a server decision rather than a caller assertion.

## Outstanding

- **D7** remains an open follow-up by owner decision.
- **Golden credentials are still live** — revocation is deliberately held until merge so that any
  re-test remains possible without another owner login.
