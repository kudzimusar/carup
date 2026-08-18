# Email Experience & Design System 1.0 — owner identity freeze (B1 / B2 / B3)

**Status:** OWNER-APPROVED AND AUTHORITATIVE. Frozen 2026-08-18.
**Programme state:** still `EMAIL_EXPERIENCE_X0_COMPLETE_WRITE_LANE_BLOCKED` — these values are recorded for
resumption; X2 does not begin until the active writable lane closes and PR #166 is canonized.

These values **supersede every identity string currently in the repository**. Where they conflict with
legacy or demo content, these win and the legacy content is wrong.

---

## B1 — Brand identity

```text
CORPORATE_DESCRIPTOR = Automotive Intelligence & Trust Network
CONSUMER_TAGLINE     = Know the car. Trust the journey.
```

Note for the renderer: the descriptor contains a literal `&`. It **must** be HTML-escaped as `&amp;` in every
HTML context and left as `&` in plain text. This is a real defect source — an unescaped `&` followed by a word
can be parsed as an entity by some clients.

The shorter `CarUp Automotive Intelligence` currently shipping in `authEmailTemplates.js:101` is now
**superseded** and must be replaced by the approved descriptor when X2 migrates that footer.

---

## B2 — Leadership identity

```text
LEADERSHIP_DISPLAY_NAME             = S.K Musarurwa
LEADERSHIP_PUBLIC_TITLE             = Co-Founder & Head of Development
LEADERSHIP_REPLY_TO                 = info@carup.dev
LEADERSHIP_HEADSHOT_APPROVED        = NO
LEADERSHIP_SIGNATURE_ASSET_APPROVED = NO
```

### Customer-facing rendering is title case, not the raw input

The owner supplied `S.K MUSARURWA` / `CO-FOUNDER & HEAD OF DEVELOPMENT` in caps. **Customer-facing rendering
must use the approved cased forms above.** Storing or emitting the all-caps form would reproduce exactly the
`Welcome MUSARURWA SHADRECK` raw-database-formatting leak that plan §7.1 explicitly forbids.

### The title is NOT CEO — this is a binding constraint

> **S.K Musarurwa must not be described as CEO anywhere, in any template, preview, fixture, subject line,
> sender display name or documentation, unless separately authorized.**

The approved title is **Co-Founder & Head of Development**.

### Canonical plan amendment — "CEO Welcome" is generalized

Per plan §37 (plan-change governance) this is an **owner-approved amendment** to PR #166 and must be reflected
when that plan is canonized:

| Plan reference | Was | Becomes |
|---|---|---|
| §23 reference template **R1** | CEO Welcome | **Leadership Welcome / Founder Welcome** |
| §22.2 catalogue key | `ceo_welcome` | `leadership_welcome` |
| §15.2 "Required first leadership template" | CEO Welcome | Leadership Welcome |
| §15.3 signature block sample | `Chief Executive Officer` | `Co-Founder & Head of Development` |
| §5.2 field names | `CEO_DISPLAY_NAME`, `CEO_PUBLIC_TITLE` | `LEADERSHIP_DISPLAY_NAME`, `LEADERSHIP_PUBLIC_TITLE` |

Plan §8.6's rule still applies unchanged: leadership identity is used **selectively**, and must never sign
password resets, OTPs, routine receipts, routine conversation notifications, price alerts or every newsletter.

### Reply-To is a certified, deliverable mailbox

`info@carup.dev` is one of the seven `@carup.dev` aliases physically certified in E7 (delivered, forwarding to
the owner-verified destination). Plan §6.2 "human sender honesty" is therefore satisfiable: a named human
sender with a real monitored reply path. If replies are handled by the CarUp team rather than personally, the
template must say so.

### No leadership imagery is approved

Headshot and signature assets are both **NO**. The signature block renders as **text only**. No placeholder,
stock or demo image may be substituted — plan §31 permits fixture placeholders in previews only, and they must
be visibly non-production.

---

## B3 — Legal / public footer identity

```text
LEGAL_ENTITY_NAME    = CarUp Technologies
CORPORATE_DESCRIPTOR = Automotive Intelligence & Trust Network
HEADQUARTERS         = Tokyo, Japan
REGIONAL_OFFICES     = Harare, Zimbabwe
CONSUMER_TAGLINE     = Know the car. Trust the journey.
```

Approved footer identity block:

```text
CarUp Technologies
Automotive Intelligence & Trust Network

HQ: Tokyo, Japan
Regional Offices: Harare, Zimbabwe

Know the car. Trust the journey.
```

Record exactly as given: the entity is **`CarUp Technologies`** — *not* `CarUp Technologies Ltd`,
*not* `CarUp Automotive Intelligence Private Limited`, *not* `(Pvt) Ltd`, *not* `CarUp (Pvt) Ltd`. No suffix
may be added.

The registration number `14838/2025` asserted at `TermsOfService.tsx:571` was **not** approved and must not be
used.

---

## Superseded legacy content — still forbidden

The owner reaffirmed: do not use any contradictory legal entity name, address, phone number, leadership name
or image from legacy/demo repository content. The A2 forbidden list in
`EMAIL_EXPERIENCE_1_0_IMPLEMENTATION_DEPENDENCIES.md` stands, and is now reinforced by approved replacements:

| Legacy content | Status |
|---|---|
| `About.tsx:12-17` "Tendai Moyo — Founder & CEO" + 3 others | **FORBIDDEN** — demo seed data; superseded by B2 |
| `PressKit.tsx:818-828` "Rudo Mutasa", "Chipo Sibanda" | **FORBIDDEN** — unverified; one phone is demo seed data |
| 4 contradictory entity names | **FORBIDDEN** — superseded by `CarUp Technologies` |
| `123 Samora Machel Ave` / `Office 402, Batanai Gardens` | **FORBIDDEN** — superseded by Tokyo HQ / Harare regional |
| All three shipped phone numbers | **FORBIDDEN** — none approved; one is demo seed data |
| Registration Number `14838/2025` | **FORBIDDEN** — not approved |
| `CarUp Automotive Intelligence` (email footer) | **SUPERSEDED** by the approved descriptor |

---

## B3 addendum — canonical public URLs FROZEN (owner clarification, 2026-08-18)

```text
PRIVACY_URL  = https://carup.dev/privacy
TERMS_URL    = https://carup.dev/terms
SUPPORT_URL  = https://carup.dev/support
SECURITY_URL = https://carup.dev/security
```

These are the canonical destinations for every footer family. This also settles the previously open
"Security footer link destination" question: it is `SECURITY_URL`, **not** `/trust`.

### Two of the four routes do not exist yet — and HTTP 200 will not tell you that

Verified live against `web/src/App.tsx` and `carup.dev`:

```text
/privacy    DEFINED in App.tsx      carup.dev/privacy    200   real page
/terms      DEFINED in App.tsx      carup.dev/terms      200   real page
/support    NOT DEFINED             carup.dev/support    200   <- SPA shell, not a page
/security   NOT DEFINED             carup.dev/security   200   <- SPA shell, not a page
```

This is the **same `web/vercel.json` `/(.*)` → `/index.html` rewrite** documented for assets in dependency
register §A4, now biting footer links. A missing route is indistinguishable from a real one by status code.

**Release requirement:** `/support` and `/security` must be implemented before any template carrying those
links reaches a customer. Any link-checking test for email footers must assert on **rendered page identity**
(a known marker in the response body), never on HTTP status.

The `api.carup.dev/privacy-policy|/terms` legal surface is **not** canonical for email. It remains divergent
in content and entity name and should be reconciled or retired as separate product work.

---

## `@carup.co.zw` migration — AUTHORIZED (owner clarification, 2026-08-18)

```text
MIGRATE_SHIPPED_CARUP_CO_ZW_CONTACTS = YES
```

**Deliberate functional mapping when the implementation lane opens. NOT a blind global text replacement.**

Live enumeration on `main` — 18 occurrences across 9 distinct addresses:

| Shipped address | Count | Mapping |
|---|---:|---|
| `legal@carup.co.zw` | 6 | → `legal@carup.dev` |
| `support@carup.co.zw` | 3 | → `support@carup.dev` |
| `privacy@carup.co.zw` | 2 | → `privacy@carup.dev` |
| `info@carup.co.zw` | 2 | → `info@carup.dev` |
| `press@carup.co.zw` | 1 | → `press@carup.dev` |
| `dpo@carup.co.zw` | 1 | → `dpo@carup.dev` |

Those 15 occurrences map 1:1 onto certified aliases, and the four regulated channels
(`privacy@`, `dpo@`, `legal@`, `security@`) should be sequenced first.

### Three occurrences CANNOT be functionally mapped — they are personal, not functional

| Shipped address | Where | Why it is out of scope for this mapping |
|---|---|---|
| `rudo.mutasa@carup.co.zw` | `PressKit.tsx:818-828` | personal address of an **unverified** individual; no such `@carup.dev` mailbox exists and none of the seven aliases is personal |
| `chipo.sibanda@carup.co.zw` | `PressKit.tsx:818-828` | same; her listed phone is demo seed data |
| `tendai@carup.co.zw` | `Careers.tsx:715` | form **placeholder** tied to the forbidden demo identity (§A2) — should be removed or replaced with a non-personal example, not migrated |

A functional mapping has nothing to map these onto. They still require the person-by-person owner decision
already recorded in the X0 inventory. Migrating them to invented `@carup.dev` personal addresses would
fabricate mailboxes that do not exist and would bounce.

---

## Residual items still OPEN

Owner-confirmed status labels:

```text
REGISTERED_LEGAL_ADDRESS               DEFERRED_UNTIL_VERIFIED
LOGO_ARTWORK                           MISSING
WEBSITE_BRAND_IDENTITY_RECONCILIATION  REQUIRED
B4 reference-template visual approval  NOT_STARTED
B5 production rollout                  NOT_STARTED
```

Implementation consequences to carry into X2/X3:

1. **`REGISTERED_LEGAL_ADDRESS=DEFERRED_UNTIL_VERIFIED`** — the marketing/editorial footer (§10.4) must be
   built so the postal-address block is **structurally present but conditionally rendered**, emitting nothing
   when unset. It must never emit a partial or placeholder address. This is a gating item for Family M / R6
   production rollout, not for building the footer.
2. **`LOGO_ARTWORK=MISSING`** — masthead falls back to the text wordmark (`Car` + orange `Up`), which plan
   §11.6 permits. The `/email-assets/` contract (§A4) must still be established before any template references
   an image.
3. **`WEBSITE_BRAND_IDENTITY_RECONCILIATION=REQUIRED`** — the website still carries the superseded entity
   names, Zimbabwe-only positioning, the fabricated `About.tsx` leadership team, and `@carup.co.zw` contacts.
   Until reconciled, email states things the website contradicts, which weakens the §17 anti-phishing
   cross-check. Tracked as required, sequenced separately from email implementation.
4. **`APPROVED_SOCIAL_URLS`** — none supplied; footers **omit** social links entirely, consistent with the
   existing `state:'planned'` precedent. No fabrication.

---

## Gate status after this freeze

```text
B1  Brand identity        FROZEN — descriptor + tagline
B2  Leadership identity   FROZEN — name, title (NOT CEO), reply-to; no imagery
B3  Legal/footer identity FROZEN — entity, locations, tagline, and all four canonical public URLs
                          OPEN  — registered legal address (DEFERRED_UNTIL_VERIFIED); social links omitted
B4  Reference-template visual approval   NOT_STARTED — requires X3
B5  Production rollout                   NOT_STARTED — separate owner programme

carup.co.zw contact migration            AUTHORIZED — deliberate functional mapping, not blind replace
logo artwork                             MISSING
website brand identity reconciliation    REQUIRED
```
