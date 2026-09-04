# CarUp public brand & identity reconciliation plan

**Status:** READ-ONLY plan. No source mutated, no PR, no infrastructure change.
**Audited at:** `origin/main@940c2235` (branch is docs-only ahead).
**Purpose:** one exact remediation plan so a later writable lane needs no second audit.

---

## 0. Authoritative truth

```text
Brand                CarUp
Company              CarUp Technologies          (NO suffix — not Ltd, Pvt, Private Limited)
Descriptor           Automotive Intelligence & Trust Network
Tagline              Know the car. Trust the journey.
Location             HQ: Tokyo, Japan  ·  Regional Offices: Harare, Zimbabwe
Registered address   UNVERIFIED / DEFERRED — never invent
Leadership (public)  S.K Musarurwa — Co-Founder & Head of Development     NEVER "CEO"
Owner-supplied       Kingston Musarurwa — Founder / COO                   NOT yet a published surface
Canonical routes     https://carup.dev/{privacy,terms,support,security}
Contacts             support@ security@ privacy@ legal@ dpo@ info@ press@ carup.dev  (certified)
Staff aliases        kudzie@ king@ questions@ carup.dev  (routing PENDING — publish nowhere yet)
```

### Classification legend

| Code | Meaning |
|---|---|
| **SIC** | `SAFE_IDENTITY_CORRECTION` — swap a name/contact/descriptor. No legal meaning changes. |
| **LCR** | `LEGAL_CONTENT_REVIEW_REQUIRED` — touches an obligation, a contracting party or a regulatory claim. **Do not edit without legal input.** |
| **RDD** | `REMOVE_DEMO_DATA` — fabricated or seeded content that must be deleted, not corrected. |
| **CLC** | `CANONICAL_LINK_CORRECTION` — a URL/domain/route pointing at the wrong or a nonexistent destination. |

---

## 1. Headline findings

1. **Six** contradictory legal entity names ship — and **two pages contradict themselves**: `TermsOfService.tsx` says one entity at :191 and a different one at :571; `PrivacyPolicy.tsx` says one at :320 and another at :925.
2. **Zero of the eight certified `@carup.dev` addresses appear on any customer surface.** All 15 published contacts are `@carup.co.zw`, including the regulated DPO, privacy and legal contacts.
3. **The approved tagline appears nowhere.** The only string labelled "Tagline" is Africa-scoped and sits on the page journalists are told to quote from.
4. **`referralMarketingSeoService.js:84` hardcodes `https://carup.app`** as its base-URL fallback — a domain CarUp does not own — driving every generated canonical tag and every shared referral link.
5. **No machine-readable identity exists at all**: no JSON-LD, no OpenGraph, no description, no `robots.txt`, no `sitemap.xml`.
6. **Legal content ships twice** at different URLs with different bodies and different entity footers.

---

## 2. Occurrence inventory

### 2.1 Legal entity name — 6 competing values

| File:line | Current | Replacement | Class | Risk |
|---|---|---|---|---|
| `web/src/components/layout/Footer.tsx:125` | `© 2026 CarUp Zimbabwe. All rights reserved.` | `© 2026 CarUp Technologies. All rights reserved.` | **SIC** | low — but highest reach (every public page) |
| `web/src/pages/PressKit.tsx:285` | `CarUp (Pvt) Ltd` (labelled "Company Name") | `CarUp Technologies` | **SIC** | med — journalists quote this |
| `web/src/pages/PressKit.tsx:1027` | `© 2026 CarUp (Pvt) Ltd. All brand marks, patents…` | `© 2026 CarUp Technologies.` | **LCR** | **high — also asserts patent ownership** |
| `web/src/pages/TermsOfService.tsx:191` | `owned and operated by CarUp Automotive Intelligence Private Limited, a registered entity under the laws of the Republic of Zimbabwe` | entity → `CarUp Technologies`; **jurisdiction clause is LCR** | **LCR** | **high — contracting party** |
| `web/src/pages/TermsOfService.tsx:571` | `CarUp Automotive Intelligence (Pvt) Ltd. Registration Number: 14838/2025.` | `CarUp Technologies`; **registration number: remove or verify** | **LCR** | **high — unverified reg. number** |
| `web/src/pages/PrivacyPolicy.tsx:320` | `operated by CarUp Automotive Technologies Ltd` | `CarUp Technologies` | **LCR** | **high — names the data controller** |
| `web/src/pages/PrivacyPolicy.tsx:925` | `CarUp Technologies Ltd` | `CarUp Technologies` (drop `Ltd`) | **LCR** | high — controller identity block |
| `backend/server.js:1629` | `<footer>CarUp Automotive Intelligence Private Limited - legal@carup.co.zw</footer>` | `CarUp Technologies` + `legal@carup.dev` | **LCR** | high — indexed legal pages |
| `web/src/pages/Careers.tsx:638, :785` | `CarUp Zimbabwe` | `CarUp` (brand, not entity) | **SIC** | low |
| `web/src/pages/PressKit.tsx:1079` | `Published by CarUp Public Relations Department, Harare Office.` | remove the org-unit claim, or `CarUp Technologies` | **SIC** | med — asserts an unapproved org unit |

> **Sequencing rule:** the four **LCR** entity corrections on Terms and Privacy are the *same* one-word swap, but they sit inside the contracting-party and data-controller clauses. They must land as a single reviewed change, not piecemeal.

### 2.2 Descriptor and tagline

| File:line | Current | Replacement | Class |
|---|---|---|---|
| `web/index.html:6` | `CarUp - Zimbabwe's Automotive Intelligence Platform` | `CarUp — Automotive Intelligence & Trust Network` | **SIC** |
| `web/src/components/layout/Footer.tsx:79` | `Zimbabwe's verified automotive marketplace…` | descriptor + tagline | **SIC** |
| `web/src/pages/Landing.tsx:155` | `Verified automotive marketplace for Zimbabwe` | descriptor | **SIC** |
| `web/src/pages/Landing.tsx:157` | `Find Verified Cars. Sell With Confidence.` (H1) | owner call — see §8 | **SIC** |
| `web/src/pages/PressKit.tsx:289` | `"Building the Decentralized Trust Ledger for Africa's Roads"` labelled **Tagline** | `Know the car. Trust the journey.` | **SIC** — highest-priority tagline fix |
| `web/src/pages/About.tsx:25, :27` | `Building Zimbabwe's Automotive Future`; `Zimbabwe's first… blockchain verification` | descriptor; **drop "first" and "blockchain"** | **LCR** — unverified superlative + capability claim |
| `TermsOfService.tsx:89`, `PressKit.tsx:177/52/168`, `Careers.tsx:288`, `Register.tsx:98`, `APIDocs.tsx:756`, `HelpCenter.tsx:316` | various "Zimbabwe's premier/first…" | descriptor | **SIC** |
| `backend/server.js:1714` | `Zimbabwe's AI-native Automotive Trust Operating System Gateway` | descriptor | **SIC** — machine-readable, unauthenticated |

### 2.3 Leadership — P1 `INSTITUTIONAL_TRUTH` defect

| File:line | Current | Action | Class |
|---|---|---|---|
| `web/src/pages/About.tsx:12-17` | four people: `Tendai Moyo — Founder & CEO`, `Sarah Chikomo`, `James Ncube`, `Ayesha Khan`, all with demo avatars | **DELETE the array** | **RDD** |
| `web/src/pages/About.tsx:81` | `<h2>Leadership Team</h2>` + rendering block | **DELETE the section** | **RDD** |
| `web/src/pages/PressKit.tsx:818-828` | `Rudo Mutasa`, `Chipo Sibanda` with `@carup.co.zw` addresses and a live "Online / Direct" dot | **DELETE the named contacts**; replace with `press@carup.dev` | **RDD** |
| `web/src/pages/PressKit.tsx:54` | press-release quote attributed to `Tendai Moyo, Founder and CEO` | **DELETE the attributed quote** | **RDD** |

**Replacement contract for About leadership:**

```text
IF owner supplies an approved leadership surface:
    render EXACTLY:  S.K Musarurwa — Co-Founder & Head of Development
    no photo (none approved) · no biography (none approved) · no email
    Kingston Musarurwa — Founder / COO is OWNER_SUPPLIED_IDENTITY and is
    NOT yet approved for publication; omit until separately authorized.
ELSE (default):
    OMIT the leadership section entirely.
```

Never: a demo avatar, a seeded-user name, an invented executive, a placeholder personal email, or the title CEO.

### 2.4 Contacts — all 15 published addresses are on a non-resolving domain

| Legacy | Replacement | Class | Priority |
|---|---|---|---|
| `privacy@carup.co.zw` | `privacy@carup.dev` | **LCR** | **1 — regulated** |
| `dpo@carup.co.zw` | `dpo@carup.dev` | **LCR** | **1 — regulated** |
| `legal@carup.co.zw` | `legal@carup.dev` | **LCR** | **1 — regulated** |
| `support@carup.co.zw` | `support@carup.dev` | **SIC** | 2 |
| `info@carup.co.zw` | `info@carup.dev` | **SIC** | 2 |
| `press@carup.co.zw` | `press@carup.dev` | **SIC** | 2 |
| `rudo.mutasa@carup.co.zw` | `press@carup.dev` | **RDD** | 2 — address maps; the *person* is deleted per §2.3 |
| `chipo.sibanda@carup.co.zw` | `press@carup.dev` | **RDD** | 2 — same |
| `tendai@carup.co.zw` (`Careers.tsx:715` placeholder) | remove persona; `info@carup.dev` where a generic Careers contact is needed | **RDD** | 2 |

Backend legal pages carry three more (`server.js:1653, 1678, 1691`) — all **LCR**, priority 1.

**Never fabricate personal `@carup.dev` mailboxes.** `kudzie@`, `king@`, `questions@` are approved but **routing is pending**, so they must not be published anywhere yet.

### 2.5 Phone numbers and addresses

| Current | Action | Class |
|---|---|---|
| `+263 773 345 678` (`PrivacyPolicy.tsx:950` DPO card; `PressKit.tsx` contact) | **DELETE — it is demo seed data** from `backend/db/database.js:279`, published on a statutory contact card | **RDD** |
| `+263 242 700 000` (Footer, Contact, HelpCenter, Privacy) | no approved number exists → **omit** | **SIC** |
| `+263 242 755 889`, `+263 772 400 121` (PressKit) | omit | **SIC** |
| `123 Samora Machel Ave, Harare` (Contact, Privacy, Terms, HelpCenter) | replace with `HQ: Tokyo, Japan · Regional Offices: Harare, Zimbabwe`; **never invent a street address** | **LCR** on Privacy/Terms, **SIC** elsewhere |
| `Office 402, Batanai Gardens, Jason Moyo Ave, Harare` (PressKit) | same | **SIC** |

### 2.6 Routes and canonical links

| Item | Current | Action | Class |
|---|---|---|---|
| `/support` | **no route**; SPA rewrite returns 200 | **build the page** — §3 | **CLC** |
| `/security` | **no route**; SPA rewrite returns 200 | **build the page** — §3 | **CLC** |
| `/privacy`, `/terms` | exist in `App.tsx:258-259` | keep as canonical | — |
| `backend/server.js` `/privacy-policy`, `/terms`, `/data-deletion` | duplicate legal text, different entity footer | pick one canonical pair; redirect or de-index the other | **LCR** |
| `referralMarketingSeoService.js:84` | fallback `https://carup.app` — **not an owned domain** | `https://carup.dev`; declare `CARUP_PUBLIC_URL` in `.env.example` | **CLC** — high |
| `referralMarketingSeoService.js:136-142` | canonical URLs for `/referrals/*` paths that have no routes | do not publish until routes exist | **CLC** |
| `web/vercel.json` vs root `vercel.json` | two configs, different rewrite destinations | reconcile before adding headers/redirects | **CLC** |
| `robots.txt`, `sitemap.xml` | absent — return HTML 200 | create both | **CLC** |

### 2.7 Social

`navigationManifest.ts:561-565` models four platforms as `state:'planned'` with **no URLs**, rendered as an accessible disabled span. **This is correct — leave it.** No approved social URLs exist; omit rather than fabricate.

---

## 3. `/support` and `/security` — page contracts and acceptance

### Content

**`/security`** — official CarUp domains (`carup.dev`, `mail.carup.dev`, `marketing.carup.dev`); the explicit statement that **CarUp will never ask for a password or recovery code by email**; how CarUp communicates and which senders are legitimate; `security@carup.dev`; how to report suspicious communication.

**`/support`** — general help; account help; marketplace help; transaction/SafeTrade help; vehicle/Passport help; `support@carup.dev`; `questions@carup.dev` **only once its routing exists**.

### Acceptance criteria — HTTP 200 proves nothing

The SPA rewrite returns 200 with a **byte-identical ETag** for every nonexistent path. A test must assert **all four**:

```text
1. content-type is text/html                            (necessary, not sufficient)
2. body contains the page's stable marker               data-testid="page-security" | "page-support"
3. body contains the page's unique heading string
4. ETag !== the SPA-shell ETag
   (capture it live from a known-nonexistent path such as /__does-not-exist__ at test time —
    do not hardcode the hash, it changes on every deploy)
```

Criterion 4 is the load-bearing one: without it, a typo'd route passes forever.

---

## 4. Legal surfaces — how to correct identity without touching obligations

The implementation agent must be able to fix identity drift **without** rewriting legal meaning.

| Change type | Examples | Who may do it |
|---|---|---|
| **SIC** | entity name in a copyright line; descriptor; support contact | implementation agent |
| **CLC** | `carup.co.zw` → `carup.dev` on a non-regulated page; `carup.app` → `carup.dev` | implementation agent |
| **RDD** | delete fabricated leadership; delete demo phone number | implementation agent |
| **LCR** | contracting party (Terms:191); data controller (Privacy:320/925); registration number (Terms:571); jurisdiction clause; regulated contact (privacy@/dpo@/legal@); patent assertion (PressKit:1027) | **legal review first** |

**Rule:** an LCR item may have its *identity string* corrected only as part of a reviewed change set. Nobody rewrites an obligation, a jurisdiction, a right or a retention period as a side effect of a name swap.

---

## 5. SEO / structured data

Nothing machine-readable exists today. What must converge:

| Item | Requirement |
|---|---|
| `<title>` | `CarUp — Automotive Intelligence & Trust Network` |
| `<meta name="description">` | one approved sentence; currently absent everywhere except the backend legal pages |
| OpenGraph / Twitter | `og:site_name = CarUp` · `og:title` · `og:description` · `og:url` on canonical routes only |
| `og:image` | **blocked** — no share-card asset and no approved logo exist |
| JSON-LD `Organization` | `name: CarUp Technologies`, `description`, `url: https://carup.dev`, `contactPoint` → certified aliases |
| JSON-LD — **must omit** | `address`, `streetAddress`, `postalCode`, `telephone`, `taxID`, `founder`, `sameAs`, and `LocalBusiness` (which effectively expects an address) |
| `robots.txt` / `sitemap.xml` | create; exclude `/support` and `/security` until they exist |
| `theme-color`, manifest | **owner input needed** — a manifest authors `name`/`short_name`/`description`, which are identity claims |

> **Architectural constraint:** the app is a client-rendered Vite SPA with no SSR or prerender. Adding `react-helmet` fixes browser tab titles but **not** link previews or search snippets — crawlers read the raw 13-line shell served for all 123 routes. A credible fix needs build-time per-route HTML, edge meta injection, or prerendering. Scope accordingly, or ship metadata no scraper will ever see.

**Mobile store identity is partly immutable:** `com.carup.mobile` is fixed after first submission and matches no owned domain. `mobile/app.json` declares no description, icon or splash. Store metadata is a separate approval surface — flag to owner, do not fill in.

---

## 6. Sequencing

| Wave | Contents | Rationale |
|---|---|---|
| **W1** | Delete fabricated leadership (About §2.3) and the demo phone number | **P1 institutional-truth defect** — CarUp is publishing fictional executives right now. Pure deletion, no legal review, no dependency. |
| **W2** | Build `/support` and `/security` with the §3 assertions | Every email footer family links these; nothing else in Email Experience can ship first. |
| **W3** | Regulated contacts (`privacy@`, `dpo@`, `legal@`) → `carup.dev` — **LCR, reviewed together** | Statutory contact channels currently point at a non-resolving domain. |
| **W4** | Remaining contacts, descriptor, tagline, entity name in non-legal surfaces | Bulk **SIC**; safe once W3 has settled the regulated wording. |
| **W5** | Entity name in Terms and Privacy — **LCR, single reviewed change set** | Contracting party and data controller; must not be split. |
| **W6** | `carup.app` → `carup.dev` in the referral SEO service; declare `CARUP_PUBLIC_URL`; reconcile the two `vercel.json` files | Fixes shared referral links pointing at an unowned domain. |
| **W7** | Duplicate legal surface: choose canonical, redirect/de-index the other | Depends on W5 so both copies carry the same entity. |
| **W8** | SEO: title, description, JSON-LD Organization, robots, sitemap | Last — asserts identity machine-readably, so everything human-readable must already be correct. |

---

## 7. Tests

| Test | Asserts |
|---|---|
| `no-fabricated-identity.test` | no `Tendai Moyo` / `Sarah Chikomo` / `James Ncube` / `Ayesha Khan` / `Rudo Mutasa` / `Chipo Sibanda` in `web/src` |
| `single-legal-entity.test` | `CarUp Technologies` is the only entity string; zero hits for the six legacy variants and for `Ltd`/`Pvt`/`Private Limited` after it |
| `no-demo-seed-leakage.test` | `+263 773 345 678` appears nowhere customer-visible |
| `contact-domain.test` | zero `@carup.co.zw` in `web/src` and `backend/server.js` public pages |
| `canonical-route-identity.test` | the four-part assertion of §3 for `/privacy`, `/terms`, `/support`, `/security` |
| `no-unowned-domain.test` | zero `carup.app` and zero `*.vercel.app` in customer-visible strings |
| `descriptor-tagline.test` | approved descriptor and tagline present; no "Zimbabwe's premier/first" superlatives |
| `no-invented-address.test` | no street address; no registration number unless verified |
| `structured-data.test` | JSON-LD contains `CarUp Technologies` and **omits** `address`, `telephone`, `sameAs`, `founder` |
| `leadership-title.test` | `S.K Musarurwa` never adjacent to `CEO`; `Kingston Musarurwa` absent from published surfaces until authorized |

---

## 8. Requires owner or legal input

1. **Registration number `14838/2025`** — verify or delete. Currently published once, unverified.
2. **Jurisdiction clause** (`Terms:191`, "laws of the Republic of Zimbabwe") — does a Tokyo HQ change the governing law? **Legal question, not an identity swap.**
3. **Patent assertion** (`PressKit:1027`, "brand marks, patents") — verify or delete.
4. **"Zimbabwe's first"** and **"blockchain verification"** (`About:27`) — unverified superlative and capability claim.
5. **Landing H1** `Find Verified Cars. Sell With Confidence.` — keep as marketing headline alongside the tagline, or replace?
6. **Which legal pair is canonical** — SPA `/privacy` + `/terms`, or backend `/privacy-policy` + `/terms`?
7. **Registered legal address** — still `DEFERRED_UNTIL_VERIFIED`; blocks the marketing footer and JSON-LD `address`.
8. **Public phone number** — none approved; currently three, one of them demo data.
9. **Kingston Musarurwa publication** — owner-supplied, not yet an approved published surface.
10. **Mobile store metadata** — `com.carup.mobile` is immutable post-publish; no description or icon declared.
11. **`questions@carup.dev` publication** — blocked until routing exists.

---

## 9. Definition of Done

- [ ] Zero fabricated leadership identities anywhere customer-visible.
- [ ] Exactly **one** legal entity string — `CarUp Technologies`, no suffix.
- [ ] Zero `@carup.co.zw` on any customer surface; all regulated contacts on certified aliases.
- [ ] Zero demo-seed values (names, avatars, phone numbers) published.
- [ ] No invented street address, registration number, phone number or social link.
- [ ] `/support` and `/security` exist and pass the **four-part** identity assertion — not merely HTTP 200.
- [ ] One canonical legal surface; the duplicate redirected or de-indexed.
- [ ] Approved descriptor and tagline present; competing descriptors removed.
- [ ] No unowned domain (`carup.app`) in any generated or published link.
- [ ] JSON-LD `Organization` asserts only approved fields and omits the deferred ones.
- [ ] All §7 tests green in CI.
- [ ] Every **LCR** item either legally reviewed or explicitly deferred in writing.
- [ ] `S.K Musarurwa` never rendered as CEO, anywhere.

---

CARUP_PUBLIC_IDENTITY_RECONCILIATION_PLAN_COMPLETE
READY_FOR_LATER_SINGLE_LANE_REMEDIATION
