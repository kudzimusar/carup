# OC-NATIVE-LR1 — Native Product Foundation / Owner Checkpoint Report

**Repository:** `kudzimusar/carup`  
**Programme start:** `40621751d4b74c59324fe6601aa5ddbdc7769b08`  
**Branch:** `feat/oc-native01-product-foundation`  
**Draft PR:** #223  
**Product candidate:** `ef20035c9ee85b94257ab8bee8cfa44f2c882e54`  
**Candidate shape before evidence-only closure docs:** 109 ahead / 0 behind, 58 changed files  
**Scope:** native iOS / Android only

This report is deliberately fail-closed. It records implemented product state separately from test, visual, build and physical-device evidence.

## A. Custody

- Frozen programme start: `40621751d4b74c59324fe6601aa5ddbdc7769b08`.
- Dedicated branch created from that SHA.
- Draft PR #223 remains open, unmerged and based on the frozen source branch.
- Product candidate: `ef20035c9ee85b94257ab8bee8cfa44f2c882e54`.
- Product implementation commits from start: 109.
- Changed files at product candidate: 58.
- Scope audit: all changed files are in `mobile/**` or `docs/one-carup/native/**`.
- No web, backend, shared, database, Supabase or workflow file was modified.
- No production access or deployment was used.
- No fixture vehicle was duplicated or published.

## B. Design system

Implemented in the native codebase:

- semantic light/dark navy + amber palette;
- amber primary action with dark foreground;
- semantic typography and scalable text;
- 4pt-based spacing;
- consistent radii;
- 48dp practical touch-target floor;
- restrained motion tokens;
- shared Screen, Button, SearchField, FilterChip, StatusPill, TrustSignal, EmptyState, Skeleton, Price, Field, Notice and StickyActionBar primitives;
- reusable capture / OCR / media components.

Legacy inline styles remain on untouched historical screens, but the LR1 core surfaces now use the shared native grammar rather than creating another independent visual system.

## C. Navigation

### Before

The bottom navigation could mutate by role and expose Dashboard, Marketplace, Garage, Messages and More.

### LR1

The permanent consumer shell is:

`Home | Market | Inbox | Account`

This shell does not mutate when the user's role changes.

### Workflow placement

- Sell: Home and Account → Selling.
- Verify identity: Account → Verification.
- Check a car: Home.
- My Garage: Account and owner Home state.
- Saved cars: Market → Saved.
- SafePay: Account, only when feature access allows it.
- Referrals: Account, only when feature access allows it.
- Professional workspaces: Account only when an actual native capability exists.

Underlying route authorization and feature governance remain intact.

## D. Six-screen core vertical slice

| Screen | Guest / new | Buyer / owner | Seller | Data source | Empty / failure | Dominant action |
|---|---|---|---|---|---|---|
| Home | Public search + current Marketplace + quick actions | Adds My Garage and unread Inbox only when real state exists | Adds actual published owned listing and new seller-inquiry attention | Marketplace, owner vehicles, Communications, seller-scoped inquiries | No published cars / network failure shown explicitly | Find a car |
| Market Search | Public | Public + Saved entry when signed-in personal account | Same public discovery | Marketplace listings + shared vehicle taxonomy | Current no-supply / network state | Search make, model or keyword |
| Search Results | Public list/search/filter | Adds server-backed save/unsave and Saved view | Same public discovery | Marketplace list / saved-list API | No match / network state | Choose a vehicle |
| Vehicle Detail | Public listing | Same, plus owner Passport fallback when signed-in owner follows an unlisted owned VIN | Same public truth for published listing | Public listing detail / owner Passport | No current public record, retry/back | Message seller |
| Sell Start | Sign-in prompt | Start VIN/chassis or continue owned vehicle | Same governed draft workflow | Owner vehicles + existing seller draft endpoints | Validation / API failure | Start or continue listing |
| My Garage | Protected | Owned vehicles, real media, publication state, Passport, mileage, service history | Owner relationship remains the same; selling state is shown from vehicle publication truth | Owner vehicles + owner service history | No owned vehicles / API failure | Manage an owned vehicle |

### Shell companions

- Inbox is the canonical native conversation surface.
- Account is the plain-language entry to personal and currently available professional capabilities.

## E. Trust / Vehicle Passport

Trust authority was not moved into native UI.

Vehicle Detail renders the public Trust projection progressively. It can show an evaluated score/band only when the backend reports an evaluated canonical Trust state. When evidence-basis fields exist it can explain evidence-backed facts, connected sources and items requiring attention. Known limitations are surfaced.

The page also states what the Trust evaluation is not: it is not a government registry, title deed or guarantee of future condition.

Unknown, unavailable or stale Trust state is not converted to verified.

Owner-only unlisted vehicles can open the owner's Vehicle Passport rather than failing as though absence from Marketplace meant absence from CarUp.

## F. Communications

### Canonical conversation

CarUp Inbox / thread remains the conversation record. Native now includes:

- thread list;
- unread state;
- conversation detail;
- vehicle / subject context when returned;
- persisted read receipt;
- in-app message composer.

### Provider roles

| Provider | Native role in LR1 |
|---|---|
| CarUp / in-app | Canonical conversation and message composition |
| WhatsApp | Listing share, delivery preference, and real transport label when supplied |
| Telegram | Delivery preference and real transport label when supplied |
| Email | Delivery preference and transport label |
| Push | Device notification preference / transport label |

No raw seller telephone number is exposed. WhatsApp is not treated as the system of record. A generic provider icon is not shown unless the actual channel is known.

The Vehicle Detail secondary WhatsApp action is **Share listing on WhatsApp**, not an invented seller-chat bridge.

## G. Personalization

Home changes only from current data:

1. authenticated owner state;
2. owned vehicles actually returned by the owner API;
3. current unread CarUp threads;
4. a public listing only when an owned vehicle is actually published and resolves through the public listing contract;
5. current seller-scoped inquiries with status `new`.

No recommendation model, fake recent search, fake message count, fake listing views or demo vehicle is used to make Home look populated.

## H. Accessibility

Implemented / statically guarded:

- system font scaling retained;
- 48dp practical minimum for new primary controls;
- screen-reader labels on core actions;
- semantic selected/disabled/busy state on relevant controls;
- error copy and live-region support in form/capture primitives;
- selected filter state does not depend on colour alone;
- safe-area-aware sticky actions;
- no fixed 390×844 core layout;
- no global font-scaling suppression.

Still requiring runtime certification:

- VoiceOver reading order;
- TalkBack reading order;
- large Dynamic Type reachability;
- keyboard avoidance/forms on actual devices;
- reduced-motion behavior where the platform applies transition animation.

## I. Adaptive behavior

Phone remains the launch target.

Implemented:

- single-column compact phone presentation;
- results / My Garage use window dimensions instead of a 390px hard-code;
- expanded phone / foldable-like width can use two columns;
- safe areas are respected by shell and sticky actions.

Tablet product support remains intentionally separate:

`supportsTablet:false`

No iPad support is claimed.

## J. Performance / low-network

Instrumentation now exists for:

- cold start → usable UI;
- warm resume;
- Marketplace request latency;
- owner vehicle / service-history request latency;
- response Content-Length where supplied;
- public image dimensions;
- queued odometer-upload event.

The instrumentation is in-memory and intentionally excludes VINs, user IDs, OCR values, media URLs and private paths.

Low-network behavior is explicit on Marketplace and owner reads. Odometer capture queues evidence durably when upload cannot complete.

### Before / after measurements

**Not certified yet.** No exact-head device run has collected reliable before/after runtime figures for the final candidate. Numbers are therefore not invented in this report.

## K. Build / runtime

### Source configuration

- Expo SDK: 54
- React Native: 0.81.5
- New Architecture: enabled
- Tablet support: disabled
- SDK major upgrade: not performed

### EAS profiles prepared

- Android internal APK
- iOS Simulator internal build
- iOS physical-device internal build

### Evidence status

| Target | Status |
|---|---|
| Android source configuration | Prepared |
| Android physical install | **Not yet evidenced** |
| iOS Simulator build/run | **Not yet evidenced** |
| Physical iPhone | **Not yet evidenced** |
| Apple signing / registered device | Owner / account gate if not already configured |

A physical iPhone is not claimed from simulator evidence.

## L. Native handoff blockers

No backend/shared-contract change is currently proven necessary to implement the LR1 vertical slice.

The remaining blockers are certification gates:

1. Fresh exact-head `mobile` Vitest run.
2. Fresh exact-head `npm run test:native`.
3. Fresh exact-head `npm run test:static`.
4. Fresh exact-head `npx tsc --noEmit`.
5. Compact iPhone Simulator screenshots for the core six screens plus Inbox / Account.
6. Representative Android screenshots.
7. Expanded Android / foldable-like-width screenshots.
8. Degraded-network interaction evidence.
9. Exact-head Android APK / physical Android installation.
10. Exact-head iOS Simulator build.
11. Apple signing + device provisioning if required for the physical-iPhone build.
12. An approved immutable staging API deployment URL injected into the build used for UAT.

The current PR's frozen non-main base does not trigger the repository's main-targeted native/navigation certification workflow. LR1 write authority forbids editing workflows merely to produce a green run.

## M. Owner itinerary — 25 minutes after installable builds exist

**0–3 min — cold launch / shell**

Open as guest. Confirm the first screen is clearly Home, not a dashboard. Verify the four permanent tabs read Home, Market, Inbox, Account. Increase system text size once and confirm primary actions remain reachable.

**3–7 min — Home / Marketplace**

Search for a real make/model/keyword. Open one real published vehicle if staging has one. If staging has none, confirm the empty state says that clearly rather than showing demo inventory. Move between Home and Market and confirm the shell never changes.

**7–11 min — Results / saved cars**

Apply a make filter. On an authenticated personal account, save one real listing and open Market → Saved. Remove it again. Confirm price is visually dominant and no card contains a paragraph or unsupported Verified badge.

**11–16 min — Vehicle Detail / communications**

Open Vehicle Detail. Inspect the image, price, facts, seller/location, Trust and limitations. Tap Message seller and verify the CarUp path. Open Inbox and the resulting/available thread. If WhatsApp share is available, confirm it shares the listing rather than exposing a seller number.

**16–20 min — Sell Start**

Open Sell a car. Start with a real controlled vehicle identity or resume an existing owned vehicle. Save a draft. Confirm the app does not say the vehicle is published merely because the draft was saved.

**20–24 min — My Garage / capture**

Open My Garage. Confirm the real owned vehicle appears once, with its current media and publication state. Open Vehicle Passport. Start an odometer photo: deny camera once, retry, capture, review the real photo and test the offline/queued wording if network throttling is available.

**24–25 min — final usability judgment**

Return to Home. Decide whether the app feels like one product rather than a set of backend dashboards. Record only specific issues: unclear decision, cramped text, missing visual hierarchy, unreachable action, misleading status or slow state.

## Checkpoint disposition

The product foundation and vertical slice are implemented, but exact-head test, visual, installable-build and physical-device evidence are still missing. The checkpoint cannot be self-accepted.

**OC-NATIVE REMEDIATION BLOCKED — EXACT BLOCKERS RECORDED**
