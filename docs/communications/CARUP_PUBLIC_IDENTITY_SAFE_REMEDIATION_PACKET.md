# CarUp public identity — safe remediation patch packet

**Status:** patch planning only. Zero source mutated, zero PR, zero infrastructure change.
**Audit basis:** `CARUP_PUBLIC_IDENTITY_RECONCILIATION_PLAN.md` (do not re-audit).
**Coordinates verified at:** `origin/main@940c2235`.

---

## 0. Frozen owner dispositions

```text
REGISTRATION_NUMBER_14838_2025 = UNVERIFIED_DO_NOT_PUBLISH
PATENT_ASSERTION               = UNVERIFIED_DO_NOT_PUBLISH
GOVERNING_LAW                  = DO_NOT_CHANGE_AS_IDENTITY_CLEANUP · LEGAL_REVIEW_REQUIRED
PUBLIC_CANONICAL_PRIVACY       = https://carup.dev/privacy
PUBLIC_CANONICAL_TERMS         = https://carup.dev/terms
BACKEND_LEGAL_ENDPOINT_POLICY  = must not remain a competing public legal contract;
                                 redirect to canonical, or serve the identical reviewed body
COMPANY   = CarUp Technologies      (no suffix, ever)
DESCRIPTOR= Automotive Intelligence & Trust Network
TAGLINE   = Know the car. Trust the journey.
LOCATION  = HQ: Tokyo, Japan · Regional Offices: Harare, Zimbabwe
REGISTERED_LEGAL_ADDRESS = UNSET
LEADERSHIP= S.K Musarurwa — Co-Founder & Head of Development   (NEVER "CEO")
            Kingston Musarurwa — Founder / COO
```

## 0.1 Scope boundary the implementer must not cross

> **Institutional surfaces only.** `web/src/data/mockData.ts`, `web/src/pages/auth/Login.tsx` demo logins,
> `dashboard/**` sample records and `VehicleDetail.tsx` seller fallbacks contain demo names and phone numbers
> **by design** — they are product fixtures, not company identity claims.
>
> **Do not strip them.** Ripping demo data out of the marketplace would break the product demo while fixing
> nothing institutional. This packet touches a demo value **only** where it is presented as CarUp's own
> corporate contact — which is exactly two places: `PrivacyPolicy.tsx:950` and `PressKit.tsx:827`.

---

# WAVE A — P1 institutional truth (fabricated leadership)

No legal review. No dependency. Highest priority: CarUp is publishing four fictional executives now.

### A1 · About page leadership array

| | |
|---|---|
| **FILE** | `web/src/pages/About.tsx:12-17` |
| **CURRENT** | `const team = [{ name: 'Tendai Moyo', role: 'Founder & CEO', avatar: '/images/avatars/owner-1.jpg' }, { 'Sarah Chikomo', 'Head of Product', owner-2.jpg }, { 'James Ncube', 'CTO', dealer-1.jpg }, { 'Ayesha Khan', 'Head of Operations', mechanic-1.jpg }]` |
| **TARGET** | Delete the array. Replace with the approved two-person, **text-only** constant (below). |
| **CLASSIFICATION** | `REMOVE_DEMO_DATA` |
| **WHY** | `Tendai Moyo` is seeded user `u1` (`backend/db/database.js:279`) and the avatar is that user's demo image, reused as a mock seller avatar. The title contradicts the approved one. |
| **RISK** | Low — deletion only. Medium reputational risk if *not* done. |
| **TEST** | `no-fabricated-identity.test` |
| **DEPENDENCY** | none |

**Approved replacement (text-only, no photos, no biographies):**

```tsx
const leadership = [
  { name: 'S.K Musarurwa', role: 'Co-Founder & Head of Development' },
  { name: 'Kingston Musarurwa', role: 'Founder / COO' },
]
```

### A2 · Leadership section rendering

| | |
|---|---|
| **FILE** | `web/src/pages/About.tsx:81` + its rendering block |
| **CURRENT** | `<h2>Leadership Team</h2>` rendering avatar cards from `team` |
| **TARGET** | `<h2>Leadership</h2>`, rendering **restrained text-only cards**: name, then role. **No `<img>`.** |
| **CLASSIFICATION** | `REMOVE_DEMO_DATA` |
| **RISK** | Low |
| **ACCESSIBILITY** | Removing `<img>` removes the alt-text obligation; heading order must stay logical (`h1` → `h2`); cards must be a semantic list, not divs conveying order by position; contrast ≥ WCAG AA on name and role. |
| **TEST** | `no-demo-avatars.test`, `leadership-title.test` |

> If the owner prefers **no** leadership section until biography and photo assets are approved, omitting it
> entirely is also compliant. Both options are safe; only the current fabricated version is not.

### A3 · PressKit fabricated quote

| | |
|---|---|
| **FILE** | `web/src/pages/PressKit.tsx:54` |
| **CURRENT** | press release quoting `"…" said Tendai Moyo, Founder and CEO of CarUp` |
| **TARGET** | **Delete the attributed quote sentence.** Keep the surrounding release body. |
| **CLASSIFICATION** | `REMOVE_DEMO_DATA` |
| **WHY** | Fabricated attribution in a document journalists are told to quote. |
| **RISK** | Low to apply. **High if left** — this is a press-facing false statement. |
| **TEST** | `no-fabricated-identity.test` |

### A4 · PressKit named media contacts

| | |
|---|---|
| **FILE** | `web/src/pages/PressKit.tsx:818-828` |
| **CURRENT** | `Rudo Mutasa` (`rudo.mutasa@carup.co.zw`, `+263 772 400 121`), `Chipo Sibanda` (`chipo.sibanda@carup.co.zw`, `+263 773 345 678`), both with a live "Online / Direct" indicator |
| **TARGET** | Delete both people. Replace with a single functional block: **CarUp Press Office — `press@carup.dev`**. No phone. No status indicator. |
| **CLASSIFICATION** | `REMOVE_DEMO_DATA` + `CANONICAL_CONTACT_CORRECTION` |
| **WHY** | Unverified individuals; one phone is demo seed data; the "Online" dot asserts availability that does not exist. |
| **RISK** | Low |
| **TEST** | `no-fabricated-identity.test`, `no-demo-seed-leakage.test`, `contact-domain.test` |

---

# WAVE B — domain & contact convergence

All are `CANONICAL_CONTACT_CORRECTION` unless marked. **Never fabricate personal `@carup.dev` mailboxes.**

| # | FILE | CURRENT | TARGET | CLASS | RISK |
|---|---|---|---|---|---|
| B1 | `web/src/pages/PrivacyPolicy.tsx:937` | `dpo@carup.co.zw` | `dpo@carup.dev` | **LEGAL_REVIEW_REQUIRED** — statutory DPO contact | high |
| B2 | `web/src/pages/PrivacyPolicy.tsx:938` | `legal@carup.co.zw` | `legal@carup.dev` | **LEGAL_REVIEW_REQUIRED** | high |
| B3 | `web/src/pages/TermsOfService.tsx:553` | `legal@carup.co.zw` | `legal@carup.dev` | **LEGAL_REVIEW_REQUIRED** | high |
| B4 | `web/src/pages/TermsOfService.tsx:564` | `support@carup.co.zw` | `support@carup.dev` | `CANONICAL_CONTACT_CORRECTION` | med |
| B5 | `backend/server.js:1653` | `privacy@carup.co.zw or legal@carup.co.zw` | `privacy@carup.dev or legal@carup.dev` | **LEGAL_REVIEW_REQUIRED** | high |
| B6 | `backend/server.js:1678` | `legal@carup.co.zw or support@carup.co.zw` | `legal@carup.dev or support@carup.dev` | **LEGAL_REVIEW_REQUIRED** | high |
| B7 | `backend/server.js:1691` | `privacy@carup.co.zw or legal@carup.co.zw` | `privacy@carup.dev or legal@carup.dev` | **LEGAL_REVIEW_REQUIRED** — this URL is typically registered with Meta for data-deletion compliance | high |
| B8 | `backend/server.js:1629` | `legal@carup.co.zw` in footer | `legal@carup.dev` | see **F5** (same line as entity) | high |
| B9 | `web/src/components/layout/Footer.tsx:88` | `info@carup.co.zw` | `info@carup.dev` | `SAFE_IDENTITY_CORRECTION` | low — every page |
| B10 | `web/src/pages/Contact.tsx:55` | `info@carup.co.zw` | `info@carup.dev` | `SAFE_IDENTITY_CORRECTION` | low |
| B11 | `web/src/pages/HelpCenter.tsx:600` | `support@carup.co.zw` | `support@carup.dev` | `SAFE_IDENTITY_CORRECTION` | low |
| B12 | `web/src/pages/PressKit.tsx:149` | `press@carup.co.zw` in copy-to-clipboard block | `press@carup.dev` | `SAFE_IDENTITY_CORRECTION` | low |
| B13 | `web/src/pages/PressKit.tsx:820, :826` | `rudo.mutasa@`, `chipo.sibanda@` | `press@carup.dev` — deleted with the people in **A4** | `REMOVE_DEMO_DATA` | low |
| B14 | `web/src/pages/Careers.tsx:715` | `placeholder="e.g. tendai@carup.co.zw"` | `placeholder="e.g. name@example.com"`; use `info@carup.dev` where a real Careers contact is needed | `REMOVE_DEMO_DATA` | low |

### Demo phone removal — institutional surfaces only

| # | FILE | CURRENT | TARGET | CLASS | RISK |
|---|---|---|---|---|---|
| B15 | `web/src/pages/PrivacyPolicy.tsx:950` | `+263 773 345 678` on the DPO contact card | **Remove the phone line.** No approved number exists. | **LEGAL_REVIEW_REQUIRED** — statutory contact | **high — demo seed data published as a regulatory contact** |
| B16 | `web/src/pages/PressKit.tsx:827` | `+263 773 345 678` | removed with **A4** | `REMOVE_DEMO_DATA` | low |
| B17 | `web/src/pages/PrivacyPolicy.tsx:949` · `Footer.tsx:84` · `Contact.tsx:48` · `HelpCenter.tsx:592` · `PressKit.tsx:149` | `+263 242 700 000`, `+263 242 755 889`, `+263 772 400 121` | **Omit** — none approved | `SAFE_IDENTITY_CORRECTION` | low |

> `TrustSafety.tsx:538` and `Careers.tsx:729` use the demo number as a **form placeholder**. Lower risk, but
> change to a neutral pattern so the seed value stops propagating.

---

# WAVE C — canonical domain defect

| | |
|---|---|
| **FILE** | `backend/services/referral/referralMarketingSeoService.js:84` |
| **CURRENT** | `return String(input.base_url \|\| process.env.CARUP_PUBLIC_URL \|\| 'https://carup.app').replace(/\/+$/, '');` |
| **TARGET** | Fallback becomes `'https://carup.dev'`. `CARUP_PUBLIC_URL` declared in `.env.example` and `backend/env.example`. |
| **CLASSIFICATION** | `CANONICAL_LINK_CORRECTION` |
| **WHY** | **CarUp does not own `carup.app`.** This fallback drives every generated `canonical_url`, `canonical_tag`, `clean_url`, `tracked_url` and `structured_metadata.url` — and every referral link shared to WhatsApp, Telegram, Facebook and Instagram. `CARUP_PUBLIC_URL` is not in either env example, so the fallback is the live default. |
| **RISK** | **High if left** — customers receive links to a domain CarUp cannot serve. Low to fix. |
| **TEST** | `no-unowned-domain.test` — fails on any `carup.app` **or** `*.vercel.app` in a generated public link |
| **DEPENDENCY** | none |

**Additional hardening:** the generator emits canonical URLs for `/referrals/local/*`, `/referrals/import/*`,
`/referrals/faq/*`, `/referrals/proof/*` (`:136-142`) — **none of which are routes** in `web/src/App.tsx`.
Fixing the host makes those links point at a real domain and a nonexistent page. Either build the routes or
suppress canonical emission until they exist. Recorded so the domain fix is not mistaken for a complete fix.

---

# WAVE D — brand copy convergence

| # | FILE | CURRENT | TARGET | CLASS |
|---|---|---|---|---|
| D1 | `PressKit.tsx:289` | `"Building the Decentralized Trust Ledger for Africa's Roads"` labelled **Tagline** | `Know the car. Trust the journey.` | **REPLACE_TAGLINE** — highest priority; press are told to reuse it |
| D2 | `web/index.html:6` | `CarUp - Zimbabwe's Automotive Intelligence Platform` | `CarUp — Automotive Intelligence & Trust Network` | REPLACE_TAGLINE |
| D3 | `Footer.tsx:79` | `Zimbabwe's verified automotive marketplace…` | descriptor + tagline | REPLACE_TAGLINE |
| D4 | `Landing.tsx:155` | `Verified automotive marketplace for Zimbabwe` | descriptor | REPLACE_TAGLINE |
| D5 | `Landing.tsx:157` | `Find Verified Cars. Sell With Confidence.` (H1) | **KEEP_AS_EDITORIAL_COPY** — a marketing headline, not a corporate descriptor; owner may add the tagline beneath |
| D6 | `Landing.tsx:159` | mission subhead | **KEEP_AS_EDITORIAL_COPY** |
| D7 | `About.tsx:27` | `Zimbabwe's **first** comprehensive… **blockchain verification**…` | **REMOVE_UNSUPPORTED_CLAIM** — drop "first" (unverified superlative) and "blockchain verification" (capability claim) |
| D8 | `About.tsx:25` | `Building Zimbabwe's Automotive Future` | KEEP_AS_EDITORIAL_COPY (market focus, see Wave G) |
| D9 | `PressKit.tsx:1027` | `…All brand marks, **patents**…` | **REMOVE_UNSUPPORTED_CLAIM** — `PATENT_ASSERTION=UNVERIFIED_DO_NOT_PUBLISH` |
| D10 | `PressKit.tsx:1079` | `Published by CarUp Public Relations Department, Harare Office.` | `Published by CarUp Technologies.` | REMOVE_UNSUPPORTED_CLAIM (unapproved org unit) |
| D11 | `TermsOfService.tsx:89`, `PressKit.tsx:177/52/168`, `Careers.tsx:288`, `Register.tsx:98`, `APIDocs.tsx:756`, `HelpCenter.tsx:316` | "Zimbabwe's premier/first…" | descriptor | REPLACE_TAGLINE |
| D12 | `backend/server.js:1714` | `Zimbabwe's AI-native Automotive Trust Operating System Gateway` | descriptor | REPLACE_TAGLINE — machine-readable, unauthenticated |

**Do not erase long-form mission copy** merely because wording differs from the descriptor. D5, D6 and D8 are
deliberately retained.

---

# WAVE E — `/support` and `/security` routes

**HTTP 200 is not acceptance.** The catch-all rewrite returns 200 with a byte-identical shell for every path.

### Support contract
Page identity/heading · general account help · marketplace help · vehicle/Passport help · SafeTrade/import
help · `support@carup.dev` · **`questions@carup.dev` only after its routing is physically certified** · **no
fake live-chat or telephone capability**.

### Security contract
Official CarUp domains (`carup.dev`, `mail.carup.dev`, `marketing.carup.dev`) · phishing guidance ·
password/OTP safety · **what CarUp will never ask for** · `security@carup.dev` · how to report suspicious
communication · canonical metadata.

### Files
`web/src/App.tsx` (two routes) · `web/src/pages/Support.tsx` **CREATE** · `web/src/pages/Security.tsx`
**CREATE** · `web/src/config/featureRegistry.ts` + `navigationManifest.ts` (registration, matching the
existing convention).

### Acceptance — all five must pass

```text
1. the Route exists in web/src/App.tsx and resolves to the component
2. body contains data-testid="page-support" | "page-security"
3. body contains the page's unique heading string
4. ETag !== the SPA-shell ETag, captured LIVE at test time from a known-nonexistent
   path (e.g. /__does-not-exist__). Never hardcode the hash — it changes each deploy.
5. canonical metadata resolves to https://carup.dev/{support,security}
```

Criterion 4 carries the weight: without it a typo'd route passes forever.

---

# WAVE F — safe legal identity correction

**Not authorization to rewrite legal content.** Each patch must show enough surrounding text to prove
jurisdiction, obligations, retention, liability, definitions and rights are untouched.

| # | FILE | CURRENT | TARGET | CLASS |
|---|---|---|---|---|
| F1 | `TermsOfService.tsx:191` | `The Platform is owned and operated by **CarUp Automotive Intelligence Private Limited**, a registered entity under the laws of the Republic of Zimbabwe.` | entity → `CarUp Technologies`. **The jurisdiction clause after the comma is `LEGAL_TEXT_UNCHANGED` — do not touch.** | `SAFE_IDENTITY_CORRECTION` + **LEGAL_REVIEW_REQUIRED** (contracting party) |
| F2 | `TermsOfService.tsx:571` | `CarUp Automotive Intelligence (Pvt) Ltd. **Registration Number: 14838/2025.**` | entity → `CarUp Technologies`; **delete the registration number** | `SAFE_IDENTITY_CORRECTION` + **REMOVE_UNVERIFIED** |
| F3 | `PrivacyPolicy.tsx:320` | `operated by **CarUp Automotive Technologies Ltd**` | `CarUp Technologies` | **LEGAL_REVIEW_REQUIRED** — names the data controller |
| F4 | `PrivacyPolicy.tsx:925` | `**CarUp Technologies Ltd**` | `CarUp Technologies` (drop `Ltd`) | **LEGAL_REVIEW_REQUIRED** |
| F5 | `backend/server.js:1629` | `<footer>CarUp Automotive Intelligence Private Limited - legal@carup.co.zw</footer>` | `<footer>CarUp Technologies - legal@carup.dev</footer>` | `SAFE_IDENTITY_CORRECTION` + `CANONICAL_CONTACT_CORRECTION` |
| F6 | `Footer.tsx:125` | `© 2026 CarUp Zimbabwe. All rights reserved.` | `© 2026 CarUp Technologies. All rights reserved.` | `SAFE_IDENTITY_CORRECTION` |
| F7 | `PressKit.tsx:285` | `CarUp (Pvt) Ltd` (labelled "Company Name") | `CarUp Technologies` | `SAFE_IDENTITY_CORRECTION` |
| F8 | `PressKit.tsx:1027` | `© 2026 CarUp (Pvt) Ltd…` | `© 2026 CarUp Technologies.` (+ D9 patent removal) | `SAFE_IDENTITY_CORRECTION` |
| F9 | `Careers.tsx:638, :785` | `CarUp Zimbabwe` | `CarUp` | `SAFE_IDENTITY_CORRECTION` |

> **F1–F4 must land as ONE reviewed change set.** They are the same one-word swap, but they sit inside the
> contracting-party and data-controller clauses. Splitting them leaves the pages self-contradictory mid-flight.

**Backend legal endpoint policy (owner-frozen):** after reconciliation, `backend/server.js`
`/privacy-policy`, `/terms`, `/data-deletion` must **redirect** to the canonical `carup.dev` routes, or serve
the **identical reviewed body**. They must not remain a competing contract. Sequence after F1–F4.

---

# WAVE G — public location convergence

Three concepts the implementer must keep distinct:

```text
COMPANY_LOCATION         HQ: Tokyo, Japan · Regional Offices: Harare, Zimbabwe
TARGET_MARKET            Zimbabwe — legitimate product-market copy, KEEP
LEGAL_REGISTERED_ADDRESS UNSET — never invent
```

| # | FILE | CURRENT | TARGET | CLASS |
|---|---|---|---|---|
| G1 | `Contact.tsx:62` · `PrivacyPolicy.tsx:926` · `TermsOfService.tsx:573` · `HelpCenter.tsx:608` | `123 Samora Machel Ave, Harare` presented as HQ / "Physical Headquarters" | `HQ: Tokyo, Japan · Regional Offices: Harare, Zimbabwe`. **No street address.** | `SAFE_IDENTITY_CORRECTION`; Privacy/Terms also **LEGAL_REVIEW_REQUIRED** |
| G2 | `PressKit.tsx:149` | `Office 402, Batanai Gardens, Jason Moyo Ave, Harare` | same | `SAFE_IDENTITY_CORRECTION` |
| G3 | `PressKit.tsx:52` | dateline `HARARE, ZIMBABWE —` | acceptable if the release genuinely originated there; otherwise drop the dateline | KEEP_AS_EDITORIAL_COPY |
| G4 | `About.tsx:25`, `Careers.tsx:288`, `Landing.tsx:155` | "Zimbabwe's…" as **market** framing | **KEEP** — market focus, not headquarters | KEEP_AS_EDITORIAL_COPY |
| G5 | `web/index.html:6`, `backend/server.js:1714` | "Zimbabwe's…" possessivising the **company** | replace with the descriptor | `SAFE_IDENTITY_CORRECTION` |

The distinction: *"built for Zimbabwe"* is a true market statement and stays. *"Zimbabwe's Automotive
Intelligence Platform"* possessivises the company and conflicts with a Tokyo HQ.

---

# WAVE H — SEO / machine identity

## H1 · `SAFE_METADATA_CORRECTIONS_NOW`

| Item | Action |
|---|---|
| `web/index.html` `<title>` | `CarUp — Automotive Intelligence & Trust Network` |
| `<meta name="description">` | add one approved sentence |
| `backend/server.js:1602` title | align separator and descriptor |
| Referral canonical host | Wave C |
| `robots.txt`, `sitemap.xml` | create; **exclude `/support` and `/security` until Wave E lands** |
| JSON-LD `Organization` | `name: CarUp Technologies`, `description`, `url: https://carup.dev`, `contactPoint` → certified aliases |
| JSON-LD **must omit** | `address`, `streetAddress`, `postalCode`, `telephone`, `taxID`, `founder`, `sameAs`, and `LocalBusiness` (which effectively expects an address) |
| `og:image` | **blocked** — no share card, no approved logo. Adding it would reference a nonexistent file. |

## H2 · `SOCIAL_PREVIEW_ARCHITECTURE_LATER`

The app is client-rendered Vite with no SSR. **Adding React Helmet does not solve OpenGraph** — WhatsApp,
Facebook, X, LinkedIn, Slack and search crawlers read the raw 13-line shell served for all 123 routes. Helmet
fixes in-browser tab titles only. Do not ship it and declare previews solved.

| Option | Invasiveness | Fit |
|---|---|---|
| **1. Build-time prerender** of selected routes | medium — adds a build plugin, no runtime change | good for a fixed set of public routes |
| **2. Edge HTML/meta injection** (Vercel middleware) | medium-high — new runtime layer on every request | most flexible; highest operational surface |
| **3. Selected-route static output** | **lowest** — emit real HTML for ~12 public routes at build; SPA keeps the rest | **RECOMMENDED** |

**Recommendation: option 3.** It fits the existing Vite/Vercel setup, needs no runtime layer, and covers
exactly the pages that matter for previews and search — `/`, `/about`, `/privacy`, `/terms`, `/support`,
`/security`, `/help`, `/trust`, `/press`, `/careers`, `/contact`, `/marketplace`. It also **removes the
catch-all soft-404 problem for those paths**, which is the same defect Wave E's ETag test exists to catch.
**Do not implement now** — it is an architecture change requiring its own lane.

---

# WAVE I — test & certification pack

| Test | Asserts |
|---|---|
| `no-fabricated-identity.test` | zero `Tendai Moyo` / `Sarah Chikomo` / `James Ncube` / `Ayesha Khan` / `Rudo Mutasa` / `Chipo Sibanda` on institutional surfaces (`About`, `PressKit`, legal pages, `Footer`, `Contact`) — **`mockData.ts` and `dashboard/**` explicitly excluded** |
| `no-demo-avatars.test` | no `/images/avatars/*` referenced from institutional pages |
| `contact-domain.test` | zero `@carup.co.zw` in `web/src` institutional pages and `backend/server.js` legal pages |
| `no-demo-seed-leakage.test` | `+263 773 345 678` absent from `PrivacyPolicy` and `PressKit` |
| `no-unowned-domain.test` | zero `carup.app`; zero `*.vercel.app` in customer-visible or generated links |
| `leadership-title.test` | `S.K Musarurwa` never within 100 chars of `CEO`; `Chief Executive` absent |
| `descriptor-tagline.test` | approved tagline present at designated surfaces; no "Zimbabwe's premier/first" |
| `single-legal-entity.test` | only `CarUp Technologies`; zero `Ltd` / `(Pvt) Ltd` / `Private Limited` / `Automotive Technologies Ltd` / `CarUp Zimbabwe` |
| `no-unverified-claims.test` | no `14838/2025`; no `patents` assertion |
| `governing-law-unchanged.test` | `TermsOfService.tsx:191` jurisdiction substring byte-identical to a frozen snapshot |
| `route-identity.test` | the five-part Wave E assertion for `/privacy`, `/terms`, `/support`, `/security` |
| `location-semantics.test` | no street address anywhere; `Tokyo` and `Harare` appear with the approved HQ/regional framing |
| `structured-data.test` | JSON-LD has `CarUp Technologies` and **omits** `address`, `telephone`, `sameAs`, `founder` |

`governing-law-unchanged.test` is the safety net that lets identity edits land near legal text without anyone
silently altering an obligation.

---

# Execution order, files, blockers, rollback

## Order

```text
A  fabricated leadership          no dependency · no legal review · do first
C  carup.app canonical fix        no dependency · customers receive dead links today
E  /support + /security routes    blocks every email footer family
B(9-14,17) non-regulated contacts safe bulk
D  brand copy                     safe bulk (D7/D9 remove unverified claims)
G  location                       after D so descriptor and location land together
B(1-8,15) regulated contacts      LEGAL REVIEW — with F
F1-F4 legal entity                LEGAL REVIEW — ONE change set, with regulated contacts
F5-F9 non-legal entity            safe
BACKEND_LEGAL_ENDPOINT            after F1-F4
H1 safe metadata                  last of the safe work
H2 preview architecture           SEPARATE LANE — not this packet
```

## Likely changed files

```text
web/src/pages/About.tsx  PressKit.tsx  PrivacyPolicy.tsx  TermsOfService.tsx
                         Careers.tsx  Contact.tsx  HelpCenter.tsx  Landing.tsx
                         TrustSafety.tsx  APIDocs.tsx  auth/Register.tsx
web/src/components/layout/Footer.tsx
web/src/App.tsx  web/src/pages/Support.tsx (new)  web/src/pages/Security.tsx (new)
web/src/config/featureRegistry.ts  navigationManifest.ts
web/index.html  web/public/robots.txt (new)  sitemap.xml (new)
backend/server.js
backend/services/referral/referralMarketingSeoService.js
.env.example  backend/env.example
backend/tests/ or web/e2e/ — the Wave I suite
```

## Owner / legal blockers

1. **Legal review** for F1–F4 and B1–B3, B5–B7, B15 (regulated contacts and controller/contracting party).
2. **Governing law** — flagged, unchanged, external review.
3. **Registration number** and **patent assertion** — frozen as do-not-publish; removal is safe, restoration needs verification.
4. **`REGISTERED_LEGAL_ADDRESS`** still unset — blocks JSON-LD `address` and the marketing footer.
5. **Public phone number** — none approved; all are being removed rather than replaced.
6. **`questions@carup.dev`** — cannot be published until routing is certified.
7. **Approved logo / share card** — blocks `og:image`.
8. **Kingston Musarurwa publication** — confirm the About page may name him now.

## Rollback

Every wave is independently revertible; none changes data or infrastructure.

- **A, B, D, F, G** — pure copy edits; `git revert` restores exactly.
- **C** — reverting restores the `carup.app` fallback, which is worse; prefer fixing forward.
- **E** — new files plus two routes; reverting removes the pages but **re-breaks every email footer link**, so it must be reverted *with* any dependent email work.
- **H1** — additive metadata; safe to revert.

No wave requires a data migration, so no rollback needs a backfill.

---

# Definition of Done

- [ ] Zero fabricated executive identities on any institutional surface.
- [ ] Zero demo avatars on institutional surfaces.
- [ ] Zero customer-facing `@carup.co.zw`, except any deliberately retained with a documented reason.
- [ ] Zero `carup.app` in any generated or published URL.
- [ ] `S.K Musarurwa` never rendered as CEO.
- [ ] Approved tagline present at every designated surface.
- [ ] `/support` and `/security` pass the **five-part** assertion — not HTTP 200.
- [ ] Privacy and Terms both present `CarUp Technologies`, consistently, with no suffix.
- [ ] No registration number and no patent assertion published.
- [ ] **Governing-law clause byte-identical** to its pre-remediation snapshot.
- [ ] Location distinguishes Tokyo HQ from Harare regional office; market copy retained.
- [ ] Canonical URLs resolve to `carup.dev`.
- [ ] No invented postal address, social link or telephone number.
- [ ] All Wave I tests green in CI.
- [ ] Every `LEGAL_REVIEW_REQUIRED` item reviewed or explicitly deferred in writing.

---

CARUP_PUBLIC_IDENTITY_SAFE_REMEDIATION_PACKET_COMPLETE
READY_FOR_EXECUTION_WHEN_SINGLE_WRITE_LANE_OPENS
