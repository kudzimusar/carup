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
| **Overall** | **NOT A RELEASE PASS** — 3 step-level defects PLUS a P0 security leak (D0) found during adjudication; 13 steps require an authenticated session |

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
