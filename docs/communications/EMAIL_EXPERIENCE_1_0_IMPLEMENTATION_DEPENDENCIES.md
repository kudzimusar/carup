# Email Experience & Design System 1.0 — required implementation dependencies

**Status:** `EMAIL_EXPERIENCE_X0_COMPLETE_WRITE_LANE_BLOCKED`
**X0 evidence:** `87db689a` — `docs/communications/EMAIL_EXPERIENCE_1_0_X0_INVENTORY.md` (retained, do not discard)
**Blocked by:** PR #165 (Canonical Vehicle Truth Closure) is the declared single writable programme lane;
PR #166 (Email Experience canonical plan) is not yet canonized into `main`.

This register exists so the X0 discoveries survive the wait. Every item below is a **precondition or a
constraint on X2+**, not a suggestion. Nothing here may be quietly dropped when implementation resumes.

---

## A. Hard blockers — implementation cannot be correct without these

### A1. Owner identity gates B1/B2/B3 — RESOLVED 2026-08-18

**Superseded by `EMAIL_EXPERIENCE_1_0_OWNER_IDENTITY_FREEZE.md`, which is authoritative.** Summary:

| Gate | Status |
|---|---|
| **B1** | **FROZEN** — descriptor `Automotive Intelligence & Trust Network`, tagline `Know the car. Trust the journey.` |
| **B2** | **FROZEN** — `S.K Musarurwa`, **`Co-Founder & Head of Development`** (explicitly **NOT CEO**), reply-to `info@carup.dev`, no headshot, no signature asset. R1 is renamed **Leadership Welcome**. |
| **B3** | **FROZEN** — `CarUp Technologies`, Tokyo HQ / Harare regional, tagline, and all four canonical public URLs (`/privacy`, `/terms`, `/support`, `/security`). **OPEN** — registered legal address is `DEFERRED_UNTIL_VERIFIED`; social links omitted. |

Read the freeze document before using any identity value. Two constraints carry the highest defect risk:
the title must never render as CEO, and the customer-facing name is title case (`S.K Musarurwa`), never the
supplied all-caps form.

### A2. FORBIDDEN identity sources — never read these

> **These are not authoritative. Do not use them anywhere, in any template, preview or fixture.**

```text
web/src/pages/About.tsx:12-17     "Tendai Moyo — Founder & CEO" and the other three named people.
                                  PROVEN demo data: same name as seeded user u1
                                  (backend/db/database.js:279) and the same stock avatar
                                  (/images/avatars/owner-1.jpg), reused as a mock seller avatar.
web/src/pages/PressKit.tsx:818-828 "Rudo Mutasa", "Chipo Sibanda" — unverified; one listed phone is
                                  byte-identical to demo seed data.
TermsOfService.tsx / PrivacyPolicy.tsx / PressKit.tsx / backend/server.js
                                  FOUR contradictory legal entity names, TWO contradictory postal
                                  addresses, and a statutory DPO phone that is demo seed data.
```

An agent that trusted `About.tsx` would sign a real customer email with a fictional persona. That is an
automatic-fail condition under plan §26.1 ("invented legal/leadership identity").

### A3. No CarUp logo artwork exists

Verified against the full tracked-image list **and** git history across all branches: there is no logo, mark
or wordmark file anywhere. Only `web/public/favicon.svg` (24×24) exists; `favicon.ico` is a byte-identical
copy mis-named. Every other "logo" is composed at runtime in JSX from a Lucide glyph plus CSS gradient and
**cannot be referenced from an email**.

Until an asset exists, the masthead must fall back to the existing text wordmark (`Car` + orange `Up`), which
plan §11.6 permits — but a real asset is required before production rollout.

### A4. `/email-assets/` needs an explicit serving contract

`web/vercel.json` rewrites `/(.*)` → `/index.html`. **A missing asset URL returns HTTP 200 with the SPA HTML
body, not a 404.** Consequences that must be designed around:

1. Email images would break **silently** in recipients' inboxes.
2. Any 404-based asset monitoring is defeated — it can never fire.
3. Asset existence must be verified by **content-type**, never by status code.

The `/email-assets/` namespace requires an explicit non-rewritten route before any template references an image.

---

## B. Contract dependencies on PR #165 — re-verify ALL of these at X0 refresh

PR #165 (`integration/canonical-vehicle-truth-closure`, 69 files) rewrites precisely the surfaces the email
vehicle/trust components consume. **The X0 refresh must re-read each of these before X2 begins**, because the
shape of the email vehicle card, trust badge and passport components depends on them.

| Contract surface | Email consumer |
|---|---|
| `backend/utils/publicVehicleProjection.js` | **what vehicle data may appear in an email at all** — governs Family C/M vehicle cards |
| `backend/services/trustDecision/canonicalTrustService.js` | Trust Score value + provenance — Family V core, R5 |
| `backend/services/trustDecision/trustDecisionService.js` | trust decision semantics |
| `backend/services/marketplace/marketplaceTrustSummaryService.js` | trust badge / verification indicator |
| `backend/services/marketplace/listingSummaryService.js` | vehicle card summary fields |
| `backend/services/marketplace/marketplaceListingDetailService.js` | listing detail for conversation context |
| `backend/services/marketplace/marketplaceListingEligibility.js` | whether a listing may be shown |
| `backend/services/evidence/vehicleFactResolver.js` | evidence checkmarks — Family V |
| `backend/utils/passportLookupPolicy.js` | Vehicle Passport exposure policy — R5 |
| `backend/utils/vehicleStatus.js` | listing status badge |
| seller/location canonicalization (`issue164-phase4-seller-location.test.js`) | vehicle card seller + location fields |

**Rule:** the email design system MUST read vehicle/trust data through these canonical services. It must not
re-derive trust or re-project vehicle fields itself, and it must not surface any field the public projection
excludes. Plan §16 data minimization and §8.4 "trust claims generated from canonical, current evidence" both
depend on this.

---

## C. Design constraints carried forward from X0

### C1. Single HTML insertion point

`CommunicationDeliveryWorker.deliverNotification` builds
`content: { subject, body, data }` and never sets `content.html`
(`communicationDeliveryWorker.js:112-116`). This is the **one** place the shared renderer plugs in. Auth HTML is
currently rendered lazily *inside* the Resend adapter from `payload.auth_template_key`
(`providerAdapters.js:357`); that indirection should be replaced by the shared renderer, not duplicated.

Delivered HTML is currently **never persisted** — worth revisiting for template provenance (plan §28.3).

### C2. Escaping is a release requirement, not a nicety

`authEmailTemplates.js` `layout()` interpolates **raw HTML** in four of its eight slots (`intro`, `body`,
`securityNote`, `footerNote`). That is safe today only because every caller passes a trusted literal. The
moment vehicle titles, participant display names, garage names and message excerpts flow in (Families C/T/V/M),
those slots become an HTML-injection vector. Plan §7.2 requires escaping; X2 must make the escaping boundary
explicit and enforced by test.

### C3. Recipient name resolver has exactly one field to work with

Live `public.users` has a single `name` column — no `first_name`, `display_name` or `preferred_name`, and no
profiles table. Two competing ad-hoc derivations already exist. The central resolver (plan §7.1) must produce a
safe result from that one field, and "Hello undefined" is currently unreachable only because **no live template
greets anyone at all** — that changes the moment greetings are introduced.

### C4. Template registry is reusable — extend, don't replace

`communication_templates` + `communication_template_versions` **is** the runtime path and can host the plan's
§21.5 registry (plan §28.1). Needs ~8 metadata fields: `family`, `sender_persona`, `provider_transport`,
`consent_requirement`, `regulated_data_policy`, `footer_family`, `media_policy`,
`leadership_identity_required`, plus renderer/brand version. Two free `jsonb` columns exist.

Pre-existing governance defects to fix or explicitly accept:

- 22 of 27 version rows are `approval_status='approved'` with `approved_by` **and** `approved_at` NULL;
- auth email content already **diverges** between code and the registry rows;
- five template keys referenced by code are unregistered — the governed resolver 409s on them;
- 11 registered templates have zero code producers.

### C5. Sender persona matrix is not expressible today

Only two display names exist (auth vs everything-else on Resend; one global on Brevo). The plan's 10-persona
matrix (§6) needs a persona layer. Constraint §6.1: prefer already-verified domains — do **not** create new
sending domains for display-name variety.

### C6. Preference model covers 2 of 11 plan categories

`communication_preferences` has only `transactional_enabled` and an undifferentiated `marketing_enabled`;
`communication_suppressions.scope` is a 3-value CHECK. Plan §13's category model is a later-phase schema
change, and Email 1.0's consent authority must remain authoritative throughout.

### C7. Contact-domain migration — AUTHORIZED; two sub-items remain

`MIGRATE_SHIPPED_CARUP_CO_ZW_CONTACTS=YES` (owner, 2026-08-18) — **deliberate functional mapping, never a
blind global replace**. 18 occurrences across 9 addresses; 15 map 1:1 onto certified aliases, and the four
regulated channels (`privacy@`, `dpo@`, `legal@`, `security@`) sequence first.

**Three occurrences cannot be functionally mapped** because they are personal, not functional:
`rudo.mutasa@` and `chipo.sibanda@` (`PressKit.tsx:818-828`, unverified individuals with no `@carup.dev`
mailbox) and `tendai@` (`Careers.tsx:715`, a form placeholder tied to the forbidden demo identity). Mapping
them would fabricate mailboxes that bounce. They still need the person-by-person owner decision.

Canonical URLs are now frozen (see the freeze document), which resolves the security-footer destination:
`https://carup.dev/security`. **But `/support` and `/security` are not implemented**, and the SPA rewrite
returns HTTP 200 for both — so footer link checks must assert on rendered page identity, never status code,
and those routes must exist before the templates carrying them reach a customer.

`api.carup.dev/privacy-policy|/terms` is **not** canonical for email and remains divergent — separate work.

### C8. Social links — follow the existing precedent

`navigationManifest.ts:561-565` models all four platforms as `state:'planned'` with no URLs, rendered as an
accessible disabled span. The email footer must **omit rather than fabricate**. Do not add social links until
genuinely approved.

---

## D. Resumption checklist

When PR #165 closes and PR #166 is canonized:

1. Re-fetch `main`; rebase this branch onto the new `main`.
2. **Refresh X0 for deltas only** — re-read every contract surface in section **B** and record what changed.
3. Re-run the staging runtime parity guard against the new `main` before any certification claim.
4. Confirm gates **B1/B2/B3** are answered; if not, build only what does not assert identity.
5. Re-confirm the forbidden sources in **A2** are still forbidden (and check whether `About.tsx` was corrected).
6. Only then begin X2.

## E. Current lane status

```text
branch            feat/email-experience-design-system-1-0
contents          documentation only — 2 files, zero Email source mutated
PR                NONE — deliberately not opened, so no second write lane exists
X0 receipt        87db689a retained
writable lane     PR #165 (Canonical Vehicle Truth Closure) — not this branch
```
