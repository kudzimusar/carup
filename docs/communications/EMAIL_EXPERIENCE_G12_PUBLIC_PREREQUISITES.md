# G12 — public routes, the Email asset contract, and one canonical public origin

Part of CarUp Email Experience & Design System 1.0. Closes the public prerequisites Email now
depends on, **before** G6/R2.

## Why this had to come first

G2 gated `/support` and `/security` because they did not exist. `web/vercel.json` rewrote every
unmatched path to `index.html`, so an unrouted path answered **HTTP 200 with the application shell** —
a soft 404 no status check can detect and no 404 monitoring can ever fire on. An Email footer linking
those routes would have looked healthy to every automated check and led a customer nowhere.

## A/B. Two real routes, not aliases

`/support` and `/security` are their own routes with their own page components, wired through the
existing `MainLayout`. Deliberately **not** aliases to `/help` and `/trust`: Email footers say
"Support" and "Security" by name, and a link whose label and destination disagree is the small
dishonesty an Email footer cannot afford.

They are also distinct from each other in subject. `/trust` is about the product — how CarUp verifies
what it publishes about a vehicle. `/security` is about the customer's account and the messages they
receive, which is a different question asked by a different person in a different moment, usually a
worried one.

**Nothing was invented.** `/support` promises no telephone line, no 24/7 cover, no opening hours, no
SLA, no live chat, no ticket queue and no named staff. `/security` asserts no certification, no
SOC/ISO claim, no bug bounty, no hotline, no guaranteed response time, no insurance and no
law-enforcement partnership. On a security page an unearned assurance is not marketing overreach — it
is the thing that persuades someone to trust a message they should have questioned. Tests `C1`–`C3`
assert those absences, and assert the pages are substantial so they cannot pass by rendering nothing.

`questions@carup.dev` appears as the certified shared human channel and says in the copy that it is
**not a replacement for** `support@carup.dev`.

## 5. Page identity

No metadata utility existed — `document.title` was not set anywhere in the application, so every
route said the same thing in a browser tab. `web/src/lib/usePageMetadata.ts` is the smallest
reusable mechanism: title, description and canonical link, set after hydration.

The canonical href is always `https://carup.dev`, never `window.location.origin` — a preview
deployment must never publish itself as the canonical address of a CarUp page (`B4`).

This is **not** a claim to solve SSR, prerendering, crawler-specific OG previews or social preview
architecture. The application remains a Vite SPA and a crawler that does not execute JavaScript still
sees the shell. It fixes the identity of the page a human actually lands on from an Email.

## 6. Soft-404 testing, done the right way

Acceptance is router-and-DOM based, not status-code based: after hydration the expected component is
mounted, its unique `<h1>` is present, the title and canonical link are correct, and
`/no-such-carup-route-g12` renders NotFound while rendering **neither** Support nor Security. The
NotFound stand-in is deliberately unmistakable so "rendered nothing" cannot pass as "rendered 404".

## 7/8. Email link activation, after the routes existed

`canonicalEmailLinks.js` flipped `support` and `security` to `available: true` — only after the
router had them.

| | production | governed staging |
|---|---|---|
| `/support` | `https://carup.dev/support` | `https://staging.carup.dev/support` |
| `/security` | `https://carup.dev/security` | `https://staging.carup.dev/security` |

Never `*.vercel.app`, never `carup.app`, never a caller-supplied host (`C3`).

`C4` reads `web/src/App.tsx` directly and asserts **availability matches the real router** for every
declared route. That is the consistency check the SPA rewrite makes impossible to do over HTTP, and
it is what stops a future route being marked available before it is built.

Footers: the transactional family now carries a real Support link; the security family stays
restrained and does not invite a support round trip; each real link appears at most once per footer;
and the G3 marketing contract is untouched — exactly one `data-carup-unsubscribe` block, one
unsubscribe URL in each part, and no accidental second preference control (`D1`–`D4`).

## 9/10/11. The `/email-assets/` contract

`web/public/email-assets/manifest.json` gives the namespace a real, certifiable static object without
inventing artwork. It records truthfully that `logo_artwork`, `leadership_headshot` and
`leadership_signature` are all `null`, and that the wordmark mode is `text`.

`web/vercel.json` now excludes the namespace from the catch-all:

```json
{ "rewrites": [{ "source": "/((?!email-assets/).*)", "destination": "/index.html" }] }
```

Proven against the **real built output** over real HTTP:

| request | result |
|---|---|
| `GET /email-assets/manifest.json` | `200`, `application/json`, contract marker present, **not** the SPA shell |
| `GET /email-assets/no-such-g12.png` | `404`, **not** the SPA shell |
| `/`, `/support`, `/security`, `/marketplace`, an unknown path | `200` SPA shell — ordinary routing unaffected |

Without the exclusion, a missing image would answer 200 with `index.html`: an asset that "exists" to
every status check, renders as nothing in an inbox, and can never trip monitoring.

## 12. Email media policy

`emailExperience/emailMediaPolicy.js` states the truth rather than the aspiration:

```text
logo artwork          UNAVAILABLE   (none exists in the repository or its history)
wordmark              TEXT          (the approved Email v1 identity)
leadership headshot   UNAVAILABLE
leadership signature  UNAVAILABLE
```

`favicon.svg` is a 24×24 site icon and is **not** promoted into a logo (`F2`). `emailAssetUrl()`
returns `null` for anything unapproved, unknown or absent (`F4`) — including path-traversal-shaped
input — and `F5` proves an approved asset **does** produce a durable canonical URL, so `F4` is not
passing vacuously. `F6` asserts no rendered Email emits an `/email-assets/` URL or an `<img>` tag at
all, because nothing is approved for rendering yet.

The refusal is the point: without it a renderer would emit `/email-assets/logo.png` the moment the
directory existed, and every customer would receive a broken image.

## 13/14. The `carup.app` defect is closed

`referralMarketingSeoService.js` fell back to `https://carup.app` — not CarUp's canonical public
origin — and honoured `input.base_url` **verbatim**, so a caller could put any host into a durable,
forwardable marketing link.

It now delegates to `canonicalWebOrigin.js`, the existing single authority. No second configuration
system, and deliberately **no revived `CARUP_PUBLIC_URL`**: one public-link authority is the point.

| supplied `base_url` | published origin |
|---|---|
| *(none)* | `https://carup.dev` |
| `https://carup.app` | `https://carup.dev` |
| `https://evil.example.com` | `https://carup.dev` |
| `https://carup.dev.evil.example.com` | `https://carup.dev` — a lookalike is a suffix, not an origin |
| `https://carup-web-git-preview.vercel.app` | `https://carup.dev` |
| `https://staging.carup.dev` | `https://staging.carup.dev` — honoured, because it is canonical |

`G1`, `G5` and `G6` drive the **real** `draftAsset` generator, not the resolver in isolation.

## Mutants — nine, all killed

| # | Mutant | Killed |
|---|---|---|
| 1 | leave `canonicalEmailLinks` availability false | 5 |
| 2 | mark a link available without a route | 1 |
| 3 | restore the `carup.app` fallback | 3 |
| 4 | honour an arbitrary `input.base_url` | 2 |
| 5 | serve missing `/email-assets/*` through `index.html` | 1 |
| 6 | promote favicon into the official Email logo | 3 |
| 7 | emit a URL for any asset key | 4 |
| 8 | render `/security` as Trust & Safety | 5 |
| 9 | canonical URL from the deployment host | 3 |

## Regression

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| Baseline (G5 head `cddcb393`) | 4498 | 4477 | 0 | 21 |
| With G12 | 4521 | 4500 | 0 | 21 |

Delta exactly +23 — the new backend prerequisites suite. Web: 106 files / 1104 tests, 0 fail
(including 12 new route tests). Web TypeScript clean. Lint baseline gate: `NET_NEW_ERRORS=0`,
`NET_NEW_WARNINGS=0`. Communications/Email/auth: 589 pass. Referral suites: 190 pass.

## Existing tests reclassified

Two referral tests passed `base_url: 'https://carup.test'` — an arbitrary external host — and
asserted the generated public URL started with it. They **encoded the defect**: a caller-supplied
host published verbatim in a durable link. The fixture now uses the governed staging origin, which
keeps the assertion meaningful (a canonical origin IS honoured) while the rejection of a
non-canonical host is proven separately. Every other assertion is unchanged.

G2's `P15` asserted `/support` and `/security` were NOT linked. That was true while they were
unrouted; the same **rule** now produces the opposite expectation, and the rule itself moved to `C4`,
which reads the real router.

## G5 deferred findings — recorded, untouched

| | |
|---|---|
| **G5-D1** | `email_reply_tokens.version` DEFAULTs to 1 while the service mints v2. Requires a governed DB migration decision before production G5 activation. |
| **G5-D2** | Inbound `permanentReasons` omits the `bound_participant_*` permanent reasons. Requires inbound retry-classification closure before staging/production inbound certification. |
| **G5-D3** | `idx_email_reply_tokens_hash` duplicates the UNIQUE `token_hash` index. Schema hygiene for a future migration. |

None were altered in G12.

## Not done

No preview deployment was created — G12 is source and local-build evidence only, and nothing here
claims deployed certification. `PRODUCTION_COMMUNICATIONS=INACTIVE` throughout: no deploy, no DNS, no
Cloudflare change, no provider allocation change. Global navigation was not redesigned; direct
addressability is what Email needs and is what G12 delivers.
