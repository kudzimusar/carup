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
| **PASS** | **16** / 32 |
| **FAIL** | **3** / 32 |
| **BLOCKED** | **13** / 32 |
| **Overall** | **NOT A RELEASE PASS** — 3 genuine defects; 13 steps require an authenticated session |

**32/32 is NOT claimed.** Three genuine defects were physically observed and reproduced. Thirteen
steps could not be exercised because no authenticated Golden session is reachable from the automation
browser, and no session was fabricated, minted, or forged to work around that.

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

> **No authenticated Golden session is reachable from the automation browser.** `/dashboard`
> physically redirected to `/login?returnTo=%2Fdashboard`; `localStorage` held only `carup_nav_cohort`;
> no cookies. The owner's proven login lives in the owner's own browser, not this one. Per the standing
> boundary, **no session was fabricated, minted, forged via `x-user-id`, and no `password_hash` was
> read or changed.** These are **BLOCKED**, neither PASS nor FAIL.

| # | Persona | Surface | Expected | Observed | Result | Evidence |
|---:|---|---|---|---|:---:|---|
| 12 | Golden A owner | Owner Dashboard | Real bell count; never a confident `0` on a failed read | Not exercised — no session | **BLOCKED** | `/dashboard` → `/login?returnTo=%2Fdashboard` |
| 13 | Golden A owner | *Needs your attention* | No "awaiting assessment" for evaluated Golden A | Not exercised — no session | **BLOCKED** | as above |
| 14 | Golden A owner | Wallet / Trust Index tiles | *Not available*; no fabricated balance or trend | Not exercised — no session | **BLOCKED** | as above |
| 15 | Golden A owner | My Garage | Asking Price, stated mileage, real media, **counts not false zeros** | Not exercised — no session | **BLOCKED** | as above |
| 16 | Golden A owner | `/dashboard/garage/CARUPGLDNA0000001` | No valuation language; header image is real listing media | Not exercised — no session | **BLOCKED** | as above |
| 17 | Golden A owner | Specs / purchase date | Recorded or *Not recorded*; `Purchased` must not be `created_at` | Not exercised — no session | **BLOCKED** | as above |
| 18 | Golden A owner | Service / parts history | Parts and services must not double-count one PartSentry row | Not exercised — no session | **BLOCKED** | as above |
| 19 | Golden A owner | Owner Trust vs public Trust | Identical **60** / same version | Not exercised — no session | **BLOCKED** | as above |
| 20 | Golden A owner | Owner top-bar search | `Hilux` → `/search?q=Hilux`; also narrow viewport (OBS-14) | Not exercised — no session | **BLOCKED** | as above |

## Golden B — unauthenticated Buyer

| # | Persona | Surface | Expected | Observed | Result | Evidence |
|---:|---|---|---|---|:---:|---|
| 21 | Anon buyer | Marketplace search | **Must NOT appear** — it is draft | Physically typed `CARUPGLDNB0000002` into `[data-testid="marketplace-search-input"]` → **"0 vehicles found / No matching vehicles found"**, zero result links | **PASS** | `uat-step21-goldenB-absent-search.png` |
| 22 | Anon buyer | `/marketplace/CARUPGLDNB0000002` | Passport renders but not as a published listing; Reserve disabled with explanation | Passport rendered; no published-listing claim; **Reserve Vehicle `disabled=true`, `aria-disabled=true`**; `reserve-unavailable`: *"SafePay escrow is opened by CarUp once a verified inquiry confirms the seller, so it cannot be started from this page."* Listing API 404 | **PASS** | `uat-step22-24-goldenB-passport.png` |
| 23 | Anon buyer | Golden B Trust | **50** · evaluated · moderate · low · `trust-decision-1.0.0` | `trust-score-badge` = **"50 Moderate trust"**, `trust-score-value` = **50**, *Evaluated*, *Low confidence*, `trust-decision-1.0.0` | **PASS** | `uat-step22-24-goldenB-passport.png` |
| 24 | Anon buyer | Golden B evidence & gallery | Both empty/withheld; pending document NOT public; absence never a clean bill of health | 0 media thumbs, *"No photos are published for this listing. That is a statement about what this page publishes, and about nothing else. Nothing follows from it about what the seller did."*; evidence empty; **no "pending" text anywhere public**; **no** unpublishable sentence (correct — B's only doc is genuinely pending) | **PASS** | `uat-step22-24-goldenB-passport.png` |

## Golden B — authenticated Owner

> Same boundary as Steps 12–20. **BLOCKED — AUTHENTICATED GOLDEN-B SESSION REQUIRED.**

| # | Persona | Surface | Expected | Observed | Result | Evidence |
|---:|---|---|---|---|:---:|---|
| 25 | Golden B owner | *Needs your attention* | Real outstanding work; must not say "no completed trust assessment" | Not exercised — no session | **BLOCKED** | `/dashboard` → `/login` |
| 26 | Golden B owner | My Garage → Golden B | Recorded status or *Status not recorded*; no invented "Active" | Not exercised — no session | **BLOCKED** | as above |
| 27 | Golden B owner | `/dashboard/garage/CARUPGLDNB0000002` | Pending evidence shows as pending; no valuation, no stock image, no fabricated date | Not exercised — no session | **BLOCKED** | as above |
| 28 | Golden B owner | Attempt to publish | Refused, naming the blocking requirement; stays draft | Not exercised — no session | **BLOCKED** | as above |

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
| OBS-14 | Owner search available on a narrow viewport | Owner surface — no session | **BLOCKED** | — |
| OBS-16 | My Listings mobile: CTA inside card, no horizontal overflow | Owner surface — no session | **BLOCKED** | — |
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

`generateSecureReadUrl` exists (`storageService.js:116`), and a reviewer verified live that an existing
path already issues 1-hour signed URLs to anonymous callers.

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

### Secondary observation — not scored

`/blog`'s "Zimbabwean Auto Reference Index" states third-party regulatory operational facts without a
cited source ("Pre-clearance processing takes 24-48h at Beitbridge", "Integrated with ANPR digital
transponders"). These are **not** claimed CarUp integrations, so Step 30's literal criterion is not
breached, but they sit close to the Cluster G sourcing rule and are flagged for adjudication rather
than silently accepted.

---

## What must happen next

1. **Owner action required** — provide an authenticated Golden A and Golden B session (or run Steps
   12–20 / 25–28 directly). Thirteen steps and invariants 6 and 14 cannot be certified without it.
2. **Fix D1, D2, D3 on PR #165 only.** Each fix needs a regression test that **fails on the current
   behaviour** (mutation-proved), not merely passes after.
3. A new SHA forces full recertification: local gates → exact-head CI → fresh Codex → paired
   provenance → affected re-test → **complete 32-step UAT again**.
4. Do **not** merge. Do not revoke the Golden credentials yet — they are needed for the blocked steps
   and for the re-run.
