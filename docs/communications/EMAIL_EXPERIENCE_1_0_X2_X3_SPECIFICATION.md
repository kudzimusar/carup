# Email Experience 1.0 — X2/X3 specification

**Status:** specification only. `EMAIL_EXPERIENCE_X0_COMPLETE_WRITE_LANE_BLOCKED`.
**Base:** `main@940c2235`. Frozen owner values in `EMAIL_EXPERIENCE_1_0_OWNER_IDENTITY_FREEZE.md` are authoritative.

---

# PART 0 — Corrections to previously accepted documents

Live re-verification found four claims in the accepted X0 documents that are wrong or stale. Correcting them
here rather than leaving them to mislead the implementation.

### 0.1 Four of the eleven "Vehicle Truth contract surfaces" do not exist on `main`

`publicVehicleProjection.js`, `canonicalTrustService.js`, `vehicleFactResolver.js` and
`passportLookupPolicy.js` exist **only** on `integration/canonical-vehicle-truth-closure` (PR #165, unmerged —
confirmed by `git merge-base --is-ancestor`). The dependency register presents all eleven as current surfaces
to delta-review; four are surfaces that will *arrive*. On `main` today the real projection authority is
`backend/utils/vehicleStatus.js:68`.

**Consequence: R3 and R5 cannot be built or certified until PR #165 merges.** The register's binding rule
("read vehicle/trust data through these canonical services") is currently unsatisfiable, and building R5
against any other source would risk inventing Trust Score values.

### 0.2 `NOTIFICATION_POLICIES` is the real gate on what can become email

`communicationNotificationService.js:5-107` holds **nine** entries, and it alone decides whether a product
event becomes email. No SafeTrade, listing, passport, trust, referral, garage, parts or logistics event
appears in it. **Plan §22's target catalogue is ~90% unproducible today.** Plan §27 X5 ("map every live
Email-producing event") is therefore a much smaller job than the catalogue implies — and enabling catalogue
entries without a producer is explicitly forbidden.

### 0.3 Policy-driven email cannot address its own recipient — a live defect

`queueFromDomainEvent` writes `payload: { event_type, safe_payload }` with **no `email` key** (`:200`). The
worker reads the address only from `notification.payload` (`communicationDeliveryWorker.js:100-116`) and
`ResendEmailAdapter` hard-fails `recipient_missing` (`providerAdapters.js:338-339`). Address enrichment from
`users.email` exists **only** in `resolveFallbackRoute` (`communicationCanonicalNotificationService.js:276-289`)
— i.e. after a primary failure.

Conversation email (`queueExistingMessage`) is the exception; it does set `payload.email`.

**This must be fixed before any new family ships**, or every policy-driven template fails its first attempt
and succeeds only via fallback. It is a pre-existing defect, not one this programme introduces.

### 0.4 Outbound reply-token minting is still unwired

`EmailReplyTokenService.issue()` and `buildReplyToAddress()` have **no production caller**. Email 1.0 fixed the
*inbound* path and certified it with a **manually minted** token; the outbound half was never wired. So no
email today carries a `conversation+<token>@mail.carup.dev` Reply-To by itself.

Recorded plainly because the Email 1.0 receipts could be read as implying the round trip is fully automatic.
It is not: inbound is proven, outbound minting is a gap R3 must close.

---

# PART 1 — X2/X3 implementation blueprint

## 1.1 Module tree — `backend/services/communication/emailExperience/`

Plan §21.2 proposes nested `layouts/` + `components/`. That would be the first 4-level directory under
`backend/services/`; reconciled to a **flat** `emailExperience/` directory matching the existing `adapters/`
convention.

| File | State | Reason |
|---|---|---|
| `emailBrandTokens.js` | **CREATE** | canonical §5.4 tokens; `authEmailTemplates.js` `BRAND` becomes a re-export so the `#C2410C` contract survives |
| `emailBrandIdentity.js` | **CREATE** | frozen B1/B2/B3 values as configurable fields, empty-not-invented; nothing else may hardcode identity |
| `emailMarkup.js` | **CREATE** | the single escaping boundary (`escapeHtml`, opt-in `safeHtml()`, `escapeAttr`); replaces five duplicate escapers |
| `recipientPresentation.js` | **CREATE** | plan §7.1 central name resolver |
| `canonicalEmailLinks.js` | **CREATE** | typed link builder over `config/canonicalWebOrigin.js`; refuses unrouted paths |
| `emailSenderPersona.js` | **CREATE** | §6 persona matrix onto existing env vars; no new sending domains |
| `emailFooters.js` | **CREATE** | three §10.4 families; identity blocks conditional, never partial |
| `emailComponents.js` | **CREATE** | preheader, masthead, button, panel, divider, badge, message/vehicle card |
| `emailLayouts.js` | **CREATE** | six §8 family layouts over one shell |
| `emailTextRenderer.js` | **CREATE** | first-class plain text from the same node tree |
| `emailMediaPolicy.js` | **CREATE** | per-family media rules; wordmark fallback while `LOGO_ARTWORK=MISSING` |
| `emailContentPolicy.js` | **CREATE** | §14.5 forbidden copy, §16 minimization, §26.1 auto-fail — callable from renderer and tests |
| `emailTemplateRegistry.js` | **CREATE** | in-code registry reconciled against `communication_templates` |
| `renderEmail.js` | **CREATE** | the one module the worker imports: `renderEmailForNotification(notification, deps) -> {subject, html, text, provenance}` |

**MODIFY:** `communicationDeliveryWorker.js` (insertion point), `authEmailTemplates.js` (evolve),
`adapters/providerAdapters.js` (retire `resolveAuthHtml`, Brevo double-footer guard, persona-aware from),
`communicationServiceFactory.js` (inject renderer), `communicationGovernedTemplateService.js` +
`communicationTemplateService.js` (escaping defect, §1.4), `communicationCampaignService.js` (use central name
resolver), `.env.example` + `backend/env.example`.

**MODIFY — deferred:** `web/vercel.json` (`/email-assets/`), `web/src/App.tsx` (`/support`, `/security`).

**RETAIN:** `config/canonicalWebOrigin.js`, `marketingUnsubscribeService.js`, `emailStakeholderMatrix.js`,
`emailProviderQuota.js` — each is already the sole authority for its concern.

**DEPRECATE:** `resolveAuthHtml()` in `providerAdapters.js` — render-at-send indirection replaced by the
shared renderer; and the four duplicate `escapeHtml` implementations.

## 1.2 The insertion point

`communicationDeliveryWorker.js:112-116` builds `content: { subject, body, data }`. The renderer plugs in
exactly here, adding `html` and an improved `text`.

**It must be failure-tolerant in precisely the way `resolveAuthHtml` already is
(`providerAdapters.js:102-112`).** A render fault must degrade to today's text-only behaviour, never block a
P0 security email. This is why the worker is the **last** file modified in the implementation order.

## 1.3 Auth migration — equivalence, not byte-equality

`authEmailTemplates.js` `layout()` decomposes into the shared shell/masthead/button/panel/footer while the
three auth templates keep rendering **equivalently**.

Byte-equality is impossible: the B1 freeze supersedes the footer string at `authEmailTemplates.js:101`
(`CarUp Automotive Intelligence` → `Automotive Intelligence & Trust Network`). So equivalence is proven by a
**golden fixture plus an enumerated allowed-diff manifest** — every diff must be listed and justified, and any
unlisted diff fails the test.

## 1.4 Two live plain-text defects the parity work must fix

1. `communicationGovernedTemplateService.js:12-14` **HTML-escapes variables into the plain-text body**.
2. Brevo re-escapes that same text at `providerAdapters.js:91`, so `&` becomes a literal `&amp;amp;`.

Directly hostile to the frozen descriptor **Automotive Intelligence & Trust Network**, which would render as
`Automotive Intelligence &amp;amp; Trust Network`. Escaping must become context-aware: HTML-escape for HTML,
identity for text.

## 1.5 Registry — no new table needed

`communication_templates.metadata` plus the two genuinely unread jsonb columns
(`communication_template_versions.cta_definitions`, `legal_footer_rules`) carry all ten metadata fields. The
unused `communication_brand_assets` table — which already has an `authorized BOOLEAN DEFAULT FALSE` gate — is
the right home for the §11 media policy.

One additive migration; no competing template database (plan §28.1 satisfied).

## 1.6 Brevo double-footer guard

Once the worker sets `content.html` for marketing, `providerAdapters.js:472` will append a **second**
unsubscribe footer. A guard is required — and it **must never make the E7-certified refusal at `:439-447`
optional**. The refusal (no unsubscribe URL → refuse to send) is a certified control; the guard only prevents
duplicate rendering when the renderer already supplied the footer.

## 1.7 Resend send-side provenance — required before any R1–R5 certification

`BrevoMarketingAdapter` returns six `providerMetadata` flags; **`ResendEmailAdapter` returns none**
(`providerAdapters.js:370-375`). Five of six reference templates route to Resend.

E7's durable lesson was "provenance instead of inference" — it was implemented for one adapter only. Until
Resend records what it put on the wire, the honest status for R1–R5 is
`LEVEL_C: OBSERVED, PROVENANCE_UNAVAILABLE`, not PASS.

**Required:** extend `ResendEmailAdapter.send` to return `renderer_version`, `template_key`,
`template_version`, `footer_family`, `sender_persona`, `html_part_sent`, `text_part_sent`,
`cta_href_canonical`, `reply_to_set`, `leadership_identity_rendered` — plus a Level A test asserting it, which
is exactly the regression whose absence let the original defect ship.

## 1.8 Implementation order

Unchanged from the resumption packet, with one insertion: **step 0 — fix the recipient-address defect (§0.3)**,
because every policy-driven template depends on it.

---

# PART 2 — Six reference templates: content contracts

**Reality check first.** Only **R2** has a complete live end-to-end flow. R3 has a live trigger but unwired
outbound reply tokens. R1 has no producer. R4 and R6 have no live triggering flow. R5's data mostly arrives
with PR #165.

A template may be *built and previewed* ahead of its producer, but **must not be enabled** without one
(plan §3, §26.1).

Common to all six — sender `From` domain stays on verified domains (§6.1); footer identity uses only frozen
values; postal-address block renders **conditionally** and never partially; no social links.

## R1 — Leadership Welcome *(was "CEO Welcome" — renamed by owner amendment)*

| Field | Value |
|---|---|
| Purpose | introduce mission and human leadership after safe activation (plan §9.2) |
| Producer | **NONE — `POST /api/auth/register` sends no email at all** |
| Sender persona | `CarUp` / leadership; **never** "CEO" |
| From display | `S.K Musarurwa at CarUp` |
| Reply-To | `info@carup.dev` (frozen; `kudzie@` only on separate approval) |
| Classification | service (Resend) — **not** marketing |
| Subject | `Welcome to CarUp — why we built it` |
| Preheader | must add information, not repeat the subject |
| Recipient vars | `recipientPresentationName` only |
| Required data | recipient name-or-fallback; nothing else |
| Optional data | role, **only if** a real role exists — public registration forces `owner` (`server.js:1331`), so role branching must not be implied |
| CTA | one primary onboarding action to a real authenticated surface |
| Footer family | transactional/service |
| Signature | text only — headshot and signature assets are `NO` |
| Empty state | no name → `Welcome to CarUp.` |
| Minimization | no account data beyond the greeting |

**Must not** claim role-specific onboarding paths that do not exist, or carry marketing offers.

## R2 — Password Reset *(the only fully live flow)*

| Field | Value |
|---|---|
| Producer | `POST /api/auth/forgot-password` → `authRecoveryRoutes.js` — **live and physically certified** |
| Sender persona | CarUp Security |
| From display | `CarUp Security` (`RESEND_AUTH_FROM_EMAIL`) |
| Reply-To | none — automated; the email says so |
| Subject | `Reset your CarUp password` |
| Required data | one-time action URL on a canonical origin |
| CTA | `Reset password` (single action, plan §8.1) |
| Footer family | **security** — `security@carup.dev`, `support@carup.dev`, Privacy/Security/Support |
| Plain text | carries full meaning already; parity must not regress |
| Empty state | no greeting needed — today it greets nobody, which is safe |
| Minimization | never echo the email address back as confirmation of existence |

**Highest-risk migration.** P0, physically certified, anti-enumeration guaranteed. Equivalence is proven by
golden fixture + allowed-diff manifest (§1.3). No marketing content, ever.

## R3 — Marketplace Conversation

| Field | Value |
|---|---|
| Producer | live trigger exists; **outbound reply-token minting is unwired (§0.4)** |
| Sender persona | CarUp Conversations / CarUp Marketplace |
| Reply-To | `conversation+<opaque>@mail.carup.dev` — **requires wiring `EmailReplyTokenService.issue()`** |
| Subject | names the counterparty and the vehicle where safe |
| Required data | thread, participant display name, bounded message excerpt |
| Optional data | vehicle card — **blocked on PR #165** (`publicVehicleProjection.js` absent) |
| CTA | `View conversation` + reply-by-email |
| Footer family | transactional/service |
| Minimization | regulated workflows (finance, insurance, government, trust) get **no** detail in the body |
| Empty states | no vehicle image → branded placeholder (asset absent today); no display name → role-based label |

**Escaping is critical here** — participant names, vehicle titles and message excerpts are user-controlled and
enter the four raw-HTML slots.

## R4 — SafeTrade Transaction Confirmation

| Field | Value |
|---|---|
| Producer | **no general-marketplace SafeTrade exists.** The 16-state machine is an overlay on the **diaspora import-order** DAG only, behind `DIASPORA_SAFETRADE_ENABLED` (default **OFF**) |
| Money movement | `SAFETRADE_APPROVED_LIVE_PROVIDERS` is an **empty frozen array**; every money edge carries a `liveGate` |
| Sender persona | CarUp SafeTrade |
| Subject | states the actual state reached — never invented |
| Required data | reference, current state, next step |
| CTA | `Review SafeTrade transaction` → authenticated surface |
| Footer family | transactional/service |
| Minimization | no amounts/credit/identity detail beyond what the state requires |

**Binding:** R4 may only express states that exist in the live machine, must be scoped to diaspora import
orders, and **must not imply real money has moved** while providers are empty and gates closed. Specifying it
against a general marketplace escrow would invent a product.

## R5 — Vehicle Passport / Trust Update

| Field | Value |
|---|---|
| Producer | **none in `NOTIFICATION_POLICIES`**; trust/passport data arrives with PR #165 |
| Sender persona | CarUp Vehicle Passport |
| Required data | vehicle identity + at least one **canonical, current** evidence fact |
| Trust Score | only via `canonicalTrustService` once it lands — **never re-derived, never invented** |
| Before/after | plan §8.4 shows `86 → 91`; **no Trust Score history exists today** — omit unless a real history source lands |
| CTA | `View Vehicle Passport` |
| Footer family | transactional/service |
| Empty states | no score yet → omit the metric entirely rather than render `0` or `—` |

**Blocked until PR #165.** Its two marquee claims (score movement, "passport verified") are unbacked today.

## R6 — CarUp Weekly / Weekly Car Highlights

| Field | Value |
|---|---|
| Producer | **none.** No weekly job (`web/vercel.json` has no `crons`), and `carup_weekly` / `weekly_car_highlights` are not among the 24 registered template keys |
| Curation | **no curation capability exists.** No saved searches, no watchlists, no price-drop detection. `recommendationService.js:7-52` is VIN-anchored item similarity taking **no user input** |
| Sender persona | CarUp Weekly |
| Transport | **Brevo only** |
| Required | masthead, editorial structure, meaningful content, visible unsubscribe, `List-Unsubscribe` + one-click, reason-received |
| Manage preferences | **no preference centre exists** — the link must be omitted rather than pointed at a missing page |
| Footer family | marketing/editorial; postal block conditional |

**Binding:** R6 must not imply personalization CarUp cannot compute — no "based on your saved search", no
"price drop on a car you follow". Plan §8.5's rule ("must not be a list of notification records with a logo on
top") stands, but the first version can only be **editorially curated by a human**, not algorithmically
personalized.

---

# PART 3 — Preview fixture definitions

Deterministic, obviously synthetic, and never introducing new demo identities into customer-facing code.
Fixtures live in test/preview scope only.

**Naming:** all fixture people use the reserved form `Fixture <Role>` (e.g. `Fixture Buyer`); all fixture
vehicles use plate/VIN prefix `FIXTURE-`; all fixture addresses use `@fixture.invalid` (RFC 6761 reserved, can
never receive mail). This makes a leaked fixture obvious and inert.

Seven fixture sets per template:

| Set | Purpose |
|---|---|
| `normal` | all optional data present |
| `minimal` | only required data; every optional field absent |
| `long` | 60-char name, 90-char vehicle title, long price/location strings — proves wrapping |
| `mobile` | rendered at 320px — proves no horizontal scroll |
| `no-images` | images blocked — proves comprehension survives (plan §19) |
| `unknown-facts` | vehicle with no Trust Score, no evidence, no image — proves omission not `—`/`0` |
| `regulated` | a regulated workflow — proves the body carries **no** detail, only a secure-review CTA |

**Forbidden in fixtures:** any name from `About.tsx` or `PressKit.tsx`; any real `@carup.co.zw` or
`@carup.dev` address; any real one-time auth, reply or unsubscribe token (plan §24); any real Trust Score.

---

# PART 4 — Email asset contract

**No logo exists. This contract does not fabricate one.**

## 4.1 The SPA fallback is worse than documented

Live measurement: `/`, `/privacy`, `/security`, `/support`, a missing PNG, and
`/email-assets/brand/logo.png` **all** return HTTP 200, `content-type: text/html`, and the **byte-identical
ETag `"29f36dd70410a589a3805fc731176b6c"`**.

That ETag is the detection mechanism. Status codes are useless; content-type and ETag are decisive.

## 4.2 Serving contract

`web/vercel.json` must gain an explicit rule so `/email-assets/*` is **not** swallowed by the `/(.*)` rewrite —
a real 404 for a missing asset, and correct image content-types for a present one.

## 4.3 Asset requirements

| Item | Requirement |
|---|---|
| Formats | PNG (broad client support); no SVG in email |
| Logo | horizontal lockup, ~180×40 CSS px, **2× source** (360×80) |
| Naming | `email-assets/brand/logo-light.png`, `logo-dark.png`, `mark.png`, `wordmark.png` |
| Dimensions | width/height always declared to prevent layout shift |
| Alt text | `CarUp` for the lockup; empty `alt=""` for decorative |
| Fallback | text wordmark `Car` + orange `Up` — email must be recognizable with images off (§11.6) |
| Cache | long-lived immutable with a versioned path; Gmail proxies and caches aggressively |
| Forbidden | hotlinking third-party images; embedding private vehicle evidence as publicly retrievable images |

## 4.4 Required tests

1. `GET /email-assets/<missing>.png` → **not** `content-type: text/html`, and **not** the SPA ETag.
2. `GET /email-assets/<present>.png` → an image content-type.
3. Renderer test: with media policy unsatisfied, the masthead emits the **text wordmark**, never a broken
   `<img>`.

---

# PART 5 — `/support` and `/security` page contracts

Both are frozen canonical URLs. Neither exists. Both currently return the SPA shell with HTTP 200.

## 5.1 `/security` must contain

Official CarUp domains (`carup.dev`, `mail.carup.dev`, `marketing.carup.dev`); phishing guidance; the explicit
statement that **CarUp will never ask for a password or recovery code by email**; how CarUp communicates
(which senders are legitimate); `security@carup.dev`; how to report suspicious communication.

## 5.2 `/support` must contain

General help; account help; marketplace help; transaction/SafeTrade help; vehicle/Passport help;
`support@carup.dev`; `questions@carup.dev` where a general non-support question is appropriate.

## 5.3 Rendered-page identity assertions

Certification must **never** accept HTTP 200 as proof. Each page carries a stable DOM marker, e.g.
`data-testid="page-security"` / `data-testid="page-support"`, and the test asserts:

1. the marker is present in the response body; **and**
2. the response ETag is **not** `"29f36dd70410a589a3805fc731176b6c"` (the SPA shell); **and**
3. a known unique heading string is present.

The same three-part assertion applies to every footer link target.

---

# PART 6 — Certification matrix

## 6.1 Levels

- **Level A — deterministic renderer tests** (CI): subject, preheader, personalization fallback, HTML
  escaping, canonical URL enforcement, footer family, sender persona, classification/provider contract,
  unsubscribe presence for marketing, regulated minimization, plain-text parity, no `undefined`/`null`, media
  fallback.
- **Level B — structural render** (Playwright, ~95% automatable via `page.setContent`; no dev server needed):
  600/640 desktop, 320–390 mobile, images disabled, dark mode, long name, no name, long vehicle model, missing
  media, long price/location, CTA wrapping, footer wrapping.
- **Level C — real inbox** (human): Gmail web **mandatory**, Gmail mobile **mandatory**, Outlook web
  **mandatory before production**, Apple Mail recommended.

## 6.2 CI wiring — a named trap

`ci.yml:80` runs `backend/tests/*.test.js`, so new suites are picked up automatically. But
**`communication-command-center-ci.yml` uses an explicit file list** (lines 34-49). Every new Email Experience
suite **must be appended there**, or plan §33's "Communications CI covers design-system tests" is satisfied on
paper while the job never runs them.

Level B needs a **new Playwright job** — Communications CI has none today. It must not call `page.goto('/')`
(no `webServer` is configured), only `setContent`.

**Live probes stay out of PR CI** — staging parity, real sends, asset content-type and route-identity probes
are certification steps, following the precedent already settled in Email 1.0 E9.

## 6.3 The ≥90/100 gate as a checklist

Pre-scoring gate — any single automatic-fail (plan §26.1) fails the template regardless of score: missing
unsubscribe for marketing; broken CTA; non-canonical origin; marketing via the wrong provider; regulated data
exposed; missing plain-text meaning; inaccessible essential text; raw debug variables; invented
legal/leadership identity; fake support contact; a template implying a capability that does not exist.

Then score the nine rubric areas (15/15/10/10/15/10/10/10/5), each area ticked against explicit criteria
rather than impression.

**Two gates encoding Email 1.0's hard-won lessons:**

1. A template may **not** be marked `CERTIFIED` on any combination of `provider_status`, webhook lifecycle
   events or delivery-attempt rows. Only Level C rows carry a visual PASS, each naming a screenshot and a human
   observer. `delivered` with no Level C is `NOT CERTIFIED — delivery proven, rendering unproven`.
2. Every Level C claim needs staging runtime parity PASS at the certification SHA across **both** runtimes,
   **plus** send-side provenance from the adapter. A Playwright or preview screenshot may never be filed as
   Level C evidence. The distinguishing question: *does the evidence come from the sender, or from the code we
   believe the sender was running?*

Gate 2 is **unsatisfiable for R1–R5 today** — see §1.7.

## 6.4 Gate B4 screenshots

Per template: Gmail web desktop, Gmail mobile, Outlook web, images-disabled, dark mode — plus one batch view
of all six together, since the §23 acceptance rule ("same company, different purposes") is a batch judgement
that cannot be scored template-by-template.

---

# PART 7 — Open owner questions

1. **Scoring rule:** plan §26 as written is a pure sum, so a template could lose all 10 accessibility points
   and still score 90. Confirm pure-sum, or add a per-area floor (which would be a plan amendment).
2. **Certification inbox:** is `eleven.eleven.testing@gmail.com` still authorized for real staging sends?
3. **Outlook web account** availability — without one, B5 production rollout cannot be certified.
4. **Dark-mode bar:** "sanity" (legible, CTA contrast holds) or pixel fidelity?
5. **22 template-version rows** are `approved` with `approved_by` and `approved_at` NULL — fix, or accept in
   writing? Any receipt citing `template_version` inherits this.
6. **`kudzie@` as leadership Reply-To** — B2 freezes `info@`; confirm whether to switch.
