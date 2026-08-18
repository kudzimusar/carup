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

## Residual items still open — flagged, not blocking

These were not covered by the freeze. None prevents X2 foundation work; each is noted so it is not discovered
late.

1. **No street-level postal address.** B3 gives city-level only (Tokyo, Japan / Harare, Zimbabwe). Plan §10.4
   and §5.3 anticipate a postal address for marketing footers, which bulk-sender and CAN-SPAM-style policy
   generally expects on promotional mail. Security, transactional and service families are unaffected. A
   decision is needed before **marketing/editorial** production rollout (Family M, R6 CarUp Weekly) — either a
   full postal address, or an explicit owner decision to ship city-level only and accept the deliverability
   position.
2. **`PRIVACY_URL` / `TERMS_URL` / `SUPPORT_URL` not nominated.** Two divergent legal surfaces still exist —
   `carup.dev/privacy|/terms` and `api.carup.dev/privacy-policy|/terms` — with *different content and
   different entity names*. Both now also conflict with `CarUp Technologies`.
3. **`APPROVED_SOCIAL_URLS` not supplied** → footers **omit** social links, consistent with the existing
   `state:'planned'` precedent. No fabrication.
4. **Security footer's "Security" link destination** still unresolved — no `/security` route exists; `/trust`
   is the nearest live page.
5. **`@carup.co.zw` → `@carup.dev` copy migration** still unauthorized. Twelve shipped addresses remain on a
   non-resolving domain; the anti-phishing cross-check concern in dependency register §C7 stands.
6. **HQ relocation is a wider-product fact.** Tokyo HQ contradicts the Zimbabwe-only positioning across
   `index.html`, `Landing.tsx`, `About.tsx` and both legal surfaces. Email will now state something the
   website does not. Reconciling the site is outside this programme, but the divergence is real and worth an
   owner decision.
7. **Logo artwork still absent** (dependency register §A3). Unchanged by this freeze; masthead falls back to
   the text wordmark until an asset exists.

---

## Gate status after this freeze

```text
B1  Brand identity        FROZEN — descriptor + tagline approved
B2  Leadership identity   FROZEN — name, title (NOT CEO), reply-to; no imagery
B3  Legal/footer identity FROZEN for entity + locations + tagline
                          OPEN for postal address, canonical legal URLs, social (omit)
B4  Reference-template visual approval   PENDING — requires X3
B5  Production rollout                   PENDING — separate owner programme
```
