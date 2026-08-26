# Email Experience & Design System 1.0 — X0 reconciliation and inventory

**Branch:** `feat/email-experience-design-system-1-0` (from `main@940c2235`)
**Canonical plan:** PR #166 `docs/communications/CARUP_EMAIL_EXPERIENCE_DESIGN_SYSTEM_1_0_CANONICAL_PLAN.md`
**Date:** 2026-08-18
**Method:** five parallel read-only lanes over live `main`, live staging schema, and live URLs.

---

## 1. Email 1.0 foundation — intact

```text
staging runtime revision parity   PASS (940c2235 on BOTH runtimes)
CARUP                             canonical consent/template authority   intact
RESEND                            security/transactional/conversational/service   intact
BREVO                             marketing only, fail-closed on classification   intact
production Communications         INACTIVE
api.carup.dev                     DNS-only          DNSSEC disabled
```

Nothing in this programme needs to reopen transport.

## 2. The core defect, precisely located

There is exactly **one** email code path:

```text
CommunicationDeliveryWorker.deliverNotification
  -> adapterRegistry.get('email')
  -> EmailTransportRouter  -> ResendEmailAdapter | BrevoMarketingAdapter
```

The worker builds `content: { subject: notification.title, body: notification.message, data: notification.payload }`
and **never sets `content.html`** (`communicationDeliveryWorker.js:112-116`). No producer anywhere writes
`payload.html`. So `emailHtml()` (`providerAdapters.js:60-62`) is dead for the queue path.

Consequence — only two kinds of email carry HTML today:

| Path | HTML today |
|---|---|
| Auth/security | branded, rendered lazily **inside the adapter** from `payload.auth_template_key` (`providerAdapters.js:357`) |
| Marketing | synthesised from the plain text purely so an unsubscribe anchor exists (`providerAdapters.js:472`) |
| **Everything else** | **bare `text/plain`** — no branding, no logo, no CTA, no footer, no preference control |

That "everything else" includes marketplace inquiries, escrow/SafePay updates, finance status,
conversation/thread messages, admin replies and campaign sends. This is the gap the plan exists to close,
and it is a **single, well-defined insertion point** — good news for the migration.

Because rendering happens at send time inside the adapter, **delivered HTML is never persisted**.

## 3. Template registry — reusable, as the plan requires

`public.communication_templates` (24 rows) + `communication_template_versions` (27 rows) is a real governed
registry and **is** the runtime path. Per plan §28.1 it can host the §21.5 registry **without** a competing
database: 6 of 14 fields already have columns and two `jsonb` columns are free.

Missing and needing a small metadata extension: `family`, `sender_persona`, `provider_transport`,
`consent_requirement`, `regulated_data_policy`, `footer_family`, `media_policy`,
`leadership_identity_required`, plus renderer/brand version.

Governance defects found:

- 22 of 27 version rows are `approval_status='approved'` with **`approved_by` AND `approved_at` both NULL**.
- Auth email content **already diverges** between code and registry — the three `auth_*` DB rows carry
  different plain-text bodies than `authEmailTemplates.js` renders.
- Five template keys referenced by runtime code are **not registered**; the governed resolver fails closed
  with a 409.
- 11 registered "capability" templates have **zero code producers** (registry rows only).

## 4. Preference model — 2 of 11 plan categories exist

`communication_preferences` has exactly two consent booleans: `transactional_enabled` and an
undifferentiated `marketing_enabled`. `communication_suppressions.scope` is a 3-value CHECK
(`marketing|transactional|all`) with no per-category value. Nine of the plan's §13 categories have no
representation. Email 1.0's consent authority is intact and must remain authoritative.

## 5. Renderer — evolvable, as plan §21.1 requires

`authEmailTemplates.js` (199 lines) is genuinely good work: 600px fluid shell, WCAG-AA action colour
(`#C2410C`, ~5.2:1), `role="presentation"` tables, `lang`, `title`, hidden preheader, copyable link fallback.
**Its `BRAND` tokens already match the plan's §5.4 canonical tokens exactly** — the plan was written from
this file.

But it is a closed island: `layout()` is module-private with 8 fixed slots, **four of which interpolate raw
HTML**, and it has no recipient-name slot, no plain-text producer, no asset concept, no dark-mode handling,
one hard-coded footer and no sender-persona notion.

> **Security note carried into X2:** those four raw-HTML slots are safe today only because every caller is a
> trusted literal. The moment vehicle titles, participant names and message excerpts flow in (Families C/T/V/M),
> unescaped interpolation becomes an HTML-injection vector. Escaping is a release requirement, not a nicety.

Sender identity supports exactly **two** display names (auth vs everything-else on Resend, one global on
Brevo). The plan's 10-persona matrix is not expressible today.

There is **no central recipient-name resolver**, and live `public.users` has exactly one name column
(`name`) — no `first_name`/`display_name`/`preferred_name`, no profiles table. Two competing ad-hoc
derivations exist. "Hello undefined" is unreachable today only because **no live template greets anyone at all**.

## 6. Brand assets — nothing usable exists

There is **no CarUp logo artwork anywhere in the repository** — no raster or vector logo, mark or wordmark,
verified against the full tracked-file image list and git history across all branches.

The only brand-mark artifact is `web/public/favicon.svg` (24×24, orange→amber gradient, white Lucide-style car
silhouette); `favicon.ico` is a byte-identical copy mis-named `.ico`. Everywhere else the "logo" is composed at
runtime in JSX from a Lucide `<Car/>` glyph in a CSS gradient square plus the text `Car` + orange `Up`.

Product orange is `hsl(25 95% 53%)` ≈ `#F97316` — the value the plan §5.4 correctly says must **not** carry
white body text (~2.9:1). The email system's `#C2410C` remains the accessible CTA.

### A real technical trap for the asset layer

`web/vercel.json` rewrites `/(.*)` → `/index.html`. A **missing** asset URL therefore returns **HTTP 200 with
the SPA HTML body**, not a 404. Email images would silently break *and* defeat any 404-based monitoring. The
`/email-assets/` namespace in plan §11.3 must be created with an explicit non-rewritten route, and asset
existence must be verified by content-type, never by status code.

## 7. Public identity — the most consequential finding

Shipped copy asserts a substantial public identity, and **almost none of it is usable**.

### CEO identity is fabricated demo data — Gate B2 is fully blocked

`web/src/pages/About.tsx:13` publishes `Tendai Moyo — Founder & CEO`, live at `https://carup.dev/about`.
It must **not** be used, on three independent proofs:

1. `Tendai Moyo` is the exact name of **seeded demo vehicle-owner user `u1`** (`backend/db/database.js:279`).
2. The "headshot" `/images/avatars/owner-1.jpg` is that same demo user's avatar, also used as a mock seller
   avatar (`web/src/data/mockData.ts:282`). The "CTO" uses `dealer-1.jpg`; "Head of Operations" uses
   `mechanic-1.jpg`.
3. `tendai@carup.co.zw` appears as a throwaway form placeholder (`web/src/pages/Careers.tsx:715`).

An agent that trusted this page would have shipped a real customer email signed by a fictional persona. This is
precisely the failure plan §5.2 forbids.

### Legal identity is internally contradictory — Gate B3 blocked

Four entity names ship, two of them contradicting each other **on the same Terms page**:

```text
CarUp Automotive Intelligence Private Limited   backend/server.js:1629, TermsOfService.tsx:191
CarUp Automotive Intelligence (Pvt) Ltd         TermsOfService.tsx:571  (+ Reg. No. 14838/2025)
CarUp (Pvt) Ltd                                 PressKit.tsx:285, :1027
CarUp Technologies Ltd                          PrivacyPolicy.tsx:920   ("Physical Headquarters")
```

Two contradictory postal addresses ship, and the phone on the **statutory DPO contact card**
(`PrivacyPolicy.tsx:950`) is byte-identical to demo seed data.

### Descriptor/tagline unfrozen — Gate B1 blocked

Five inconsistent brand lines ship. The plan's provisional `Automotive Intelligence & Trust Network` returns
**zero** repo hits. The only string labelled "Tagline" (`PressKit.tsx:289`, Africa-scoped) contradicts the
Zimbabwe-scoped positioning everywhere else. Live email already uses the shorter **`CarUp Automotive Intelligence`**.

### Social links — correctly modelled already

`navigationManifest.ts:561-565` defines four platforms as `state:'planned'` with **no URLs**, and `Footer.tsx`
renders them as an accessible disabled span. **The email footer should copy this precedent: omit rather than
fabricate.**

### Contact-domain contradiction

Twelve shipped `@carup.co.zw` addresses remain in legal/contact copy on a domain that **does not resolve**,
while the seven `@carup.dev` aliases are certified deliverable. If email footers adopt `@carup.dev` while the
website keeps `@carup.co.zw`, CarUp advertises two contact domains for the same purpose — an anti-phishing
regression against plan §17, because a recipient cannot cross-check.

Also: there is **no `/security` and no `/support` route** (only `/help` and `/trust`), so the §10.4 security
footer's "Security" link has no destination; and a **duplicate legal surface** exists —
`carup.dev/privacy|/terms` and `api.carup.dev/privacy-policy|/terms` serve **different content with different
entity names**.

---

## 8. Gap matrix against the plan

| Plan area | State | Blocking? |
|---|---|---|
| §21 shared renderer/components | auth-only island; single clean insertion point | no — X2 can start |
| §21.5 template registry | reusable; needs 8 metadata fields | no |
| §7.1 name resolver | absent; one `name` column to work from | no |
| §10.4 footers | structure buildable; **content** needs B1/B3 | partially |
| §11 media/assets | **no logo exists**; `/email-assets/` needs a non-rewritten route | **yes** |
| §8.6 / §15 Family L, R1 CEO Welcome | identity fabricated | **yes — B2** |
| §8.5 marketing footer legal block | entity/address contradictory | **yes — B3** |
| §13 preference categories | 2 of 11 exist | no — later phase |
| §22 target catalogue | most entries have **no live product flow** | must not be enabled |

## 9. What proceeds without the gates

X2 (shared renderer, layouts, components, name resolver, canonical links, footer *structure*, text renderer,
registry metadata) is fully unblocked and starts now, with a **configurable identity layer** whose values are
left empty rather than invented — exactly as plan §27 X1 permits.

Blocked pending owner: the CEO Welcome reference template (B2), any footer that asserts legal entity or postal
address (B3), the frozen descriptor/tagline (B1), and the logo asset.
