# CarUp Email Experience — six reference visual prototypes

**Status: `B4_VISUAL_PREVIEW_CANDIDATE`** — design-only. **This is not B4 certification.**

These are standalone HTML prototypes. They are **not imported by runtime code**, add **no dependency**, and
**do not imply any runtime functionality exists**. Nothing here has been sent to any inbox.

Rendered with the repo's existing Playwright (no new package). Fixtures are synthetic: `Fixture Buyer`,
`Fixture Seller`, `FIXTURE-*` references.

## Files

| # | Prototype | Desktop | Mobile |
|---|---|---|---|
| R1 | `r1-leadership-welcome.html` | `screenshots/r1-desktop.png` | `screenshots/r1-mobile.png` |
| R2 | `r2-password-reset.html` | `screenshots/r2-desktop.png` | `screenshots/r2-mobile.png` |
| R3 | `r3-marketplace-conversation.html` | `screenshots/r3-desktop.png` | `screenshots/r3-mobile.png` |
| R4 | `r4-safetrade-transaction.html` | `screenshots/r4-desktop.png` | `screenshots/r4-mobile.png` |
| R5 | `r5-vehicle-trust-update.html` | `screenshots/r5-desktop.png` | `screenshots/r5-mobile.png` |
| R6 | `r6-carup-weekly.html` | `screenshots/r6-desktop.png` | `screenshots/r6-mobile.png` |

Desktop rendered at a 700px viewport (600px body; 640px for R6). Mobile at 375px.

## Shared brand DNA vs family character

One company: the `Car`+orange`Up` wordmark, the same ink/slate/muted type ramp, the same `#C2410C` CTA, the
same footer structure and descriptor, the same card and panel geometry.

Different jobs: **R1 and R6 use an ink masthead** (leadership and editorial feel authored); **R2, R3, R4, R5
use a light masthead with a family label and orange rule** (system mail feels operational). R2 is deliberately
the most restrained; R6 is the most expressive.

## Self-scores

Owner rule applied: **≥90 overall AND ≥8/10 accessibility AND zero automatic fails.**

| Area (weight) | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---:|---:|---:|---:|---:|---:|
| Brand recognition (15) | 15 | 14 | 14 | 14 | 14 | 15 |
| Visual hierarchy (15) | 15 | 15 | 14 | 14 | 14 | 14 |
| Purpose clarity (10) | 10 | 10 | 10 | 10 | 10 | 10 |
| Primary action (10) | 9 | 10 | 9 | 9 | 9 | 9 |
| Trust / credibility (15) | 14 | 15 | 14 | 15 | 14 | 13 |
| Contact / legal / preference (10) | 9 | 9 | 9 | 9 | 9 | 9 |
| Media / context (10) | 7 | 7 | 6 | 7 | 6 | **5** |
| Accessibility / mobile (10) | 9 | 10 | 9 | 9 | 9 | 9 |
| Deliverability-conscious (5) | 5 | 5 | 5 | 5 | 5 | 4 |
| **Total** | **93** | **95** | **90** | **92** | **90** | **88** |

**R6 scores 88 and does not pass.** Not inflating it: an editorial product whose every image slot is a
placeholder cannot honestly score as a finished weekly. Media and deliverability are where it loses — a
publication that is all type reads as a memo, and the image-to-text balance is not what a real issue would be.
Everything structural about R6 is right; it needs photography, not redesign.

Accessibility ≥8/10 on all six. Zero automatic fails on all six.

## Defect found and fixed

`r5-mobile` overflowed horizontally at 375px: `Evidence&nbsp;backed` could not wrap, forcing the two metric
cards past the viewport. Fixed (non-breaking space removed, type stepped down, gutters evened) and re-rendered.
All twelve now report `hOverflow=false`.

Also inspected: long recipient name, images-unavailable (every image slot is already a CSS placeholder, so the
images-disabled case *is* the rendered case), narrow wrapping, CTA wrapping, footer readability.

## Design decisions needing owner judgement

1. **No photography anywhere.** Every vehicle image is a branded CSS placeholder reading "Vehicle image
   unavailable". This was deliberate — no asset contract exists, and fabricating car photos would invent
   inventory. It proves images-disabled resilience, but it is why R6 scores 88. **R6 cannot reach 90 without
   real vehicle photography**, and that is an asset decision, not a design one.
2. **Trust is shown qualitatively, not numerically.** R5 shows "Evidence backed" and an item count, never a
   Trust Score. No canonical score source exists until PR #165, and inventing `86 → 91` for a prototype would
   set an expectation the runtime cannot meet.
3. **R4 states plainly that no payment has been requested or taken**, and uses "Documents under review". Given
   `SAFETRADE_APPROVED_LIVE_PROVIDERS` is empty, I made the absence of money movement *explicit* rather than
   silent. Confirm that tone is right — it is more cautious than most transactional mail.
4. **R1 invites a reply** ("reply to this email — it reaches our team, and I read what comes through"). That
   is honest only if `info@carup.dev` is genuinely monitored. Confirm, or I will soften it.
5. **R3's reply-by-email promise is prototype-only.** Outbound reply-token minting is unwired, so the visual
   promise is ahead of the runtime. Annotated here rather than in the email, since the email would be truthful
   once G5 lands.
6. **No postal address** in any footer, per `DEFERRED_UNTIL_VERIFIED`. This is the 1-point loss on
   contact/legal across all six, and it caps R6's marketing footer until resolved.
7. **The masthead is a text wordmark.** It looks intentional rather than unfinished, but a real logo asset
   would lift brand recognition, particularly on R6.

## What these prototypes deliberately do not do

No CEO title anywhere · no headshot or signature image · no social links · no invented legal address · no
Trust Score value · no saved-search, watchlist, price-drop or "recommended for you" personalization · no
settled-money language in R4 · no VIN, chassis, engine or owner identifiers · exactly one unsubscribe block in
R6 and none in the other five.
