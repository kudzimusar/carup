# OC-NATIVE-LR1 — Native Product Foundation / Owner Checkpoint Report

**Repository:** `kudzimusar/carup`
**Programme start:** `40621751d4b74c59324fe6601aa5ddbdc7769b08`
**Branch:** `feat/oc-native01-product-foundation`
**Draft PR:** #223
**R1 exact product candidate:** `d344f54513c934b89d00324f399ddb08432c5714`
**R1 candidate source scope:** 63 changed files from programme start, all within authorized native/docs paths
**Scope:** native iOS / Android only

This report is deliberately fail-closed. It records implemented product state separately from test, visual, build and physical-device evidence.

## A. Custody

- Frozen programme start: `40621751d4b74c59324fe6601aa5ddbdc7769b08`.
- Dedicated branch created from that SHA.
- Draft PR #223 remains open, unmerged and based on the frozen source branch.
- R1 exact product candidate: `d344f54513c934b89d00324f399ddb08432c5714`.
- At the R1 product candidate, 63 files differ from programme start and all remain inside authorized `mobile/**` or `docs/one-carup/native/**`.
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

**OC-NATIVE REMEDIATE — PROVEN DEVICE/RUNTIME DEFECT**


---

# OC-NATIVE-LR1-R1 certification update

## Camera-viewfinder closure

The first R1 product gap is closed at product candidate `d344f54513c934b89d00324f399ddb08432c5714`.

The former operating-system camera handoff has been replaced by a reusable Expo Camera viewfinder inside CarUp for:

- document front/back;
- selfie;
- odometer evidence.

It provides the real live feed, CarUp header/back treatment, capture guide, neutral instructions, shutter, rear-camera flash, permission/request/settings states, actual captured preview, Retake and Use photo.

No blur, glare, edge, face, document or liveness detection is claimed.

The Identity backend exposes no extracted-field confirmation/correction mutation, so the app does not invent one. Identity renders extracted values read-only and does not mark them `USER_CONFIRMED`.

**OC-NATIVE-01B COMPLETE**

## Exact product-candidate test receipt

Environment:

- SHA: `d344f54513c934b89d00324f399ddb08432c5714`
- Node: `v22.22.2`
- Expo: `54.0.37`
- React Native: `0.81.5`
- Expo Camera: `17.0.10`
- New Architecture: enabled

| Command | Result | Pass | Fail | Skip/cancel | Wall duration |
|---|---:|---:|---:|---:|---:|
| `npm test --workspace=mobile` | PASS | 6 files / 66 tests | 0 | 0 | 1.856 s |
| `npm run test:native --workspace=mobile` | PASS | 19 chained native guards | 0 | 0 | 5.716 s |
| `npm run test:static --workspace=mobile` | PASS | 5 chained scripts; verification smoke 59/59 | 0 | 0 | 3.409 s |
| `cd mobile && npx tsc --noEmit --pretty false` | PASS | typecheck | 0 | 0 | 5.682 s |
| `cd mobile && npx expo install --check` | PASS | SDK dependency check | 0 | 0 | 1.023 s |
| offline-resilience certification | PASS | 7 checks | 0 | 0 | 0.702 s |
| large/edge-case certification | PASS | 7 checks | 0 | 0 | 0.652 s |
| Android Expo prebuild | PASS | native project generation | 0 | 0 | 0.947 s |
| iOS Expo prebuild | PASS | native project generation | 0 | 0 | 1.266 s |
| Android Expo JS export | PASS | bundle/export | 0 | 0 | 56.286 s |
| iOS Expo JS export | PASS | bundle/export | 0 | 0 | 53.122 s |

`git diff --check` from programme start to the R1 product candidate also passes.

## Expo Doctor

`npx expo-doctor` passed 16 of 18 checks.

The two findings are the inherited custom monorepo Metro resolver configuration and separate root-web/mobile React versions. Both platform prebuilds and both platform JS exports pass. No native runtime failure has proved that replacing the accepted Metro custody is warranted inside this bounded R1 task.

## Immutable staging pairing

The certification backend is pinned to:

- native candidate: `d344f54513c934b89d00324f399ddb08432c5714`;
- backend deployment: `dpl_9Q85zjgdKkVGBqXW8WB7aHV6HogC`;
- immutable backend URL: `https://carup-backend-staging-9ahbpkp2a-11-11.vercel.app`;
- backend source SHA: `40621751d4b74c59324fe6601aa5ddbdc7769b08`;
- Supabase project: `eoyenigwevnxwwhyhaer`;
- health: UP;
- database project consistency: true;
- external sends: disabled;
- communications outbound kill switch: active.

No production database or production communications path was used.

## Exact proven install-chain defect

A clean exact-candidate install fails before native build:

`npm ci --ignore-scripts`

Result:

- EXIT: 1
- duration: 0.933 s
- exact reason: `Missing: expo-camera@17.0.10 from lock file`.

The new camera dependency lives in workspace file `mobile/package.json`, while npm workspace custody requires the repository root `package-lock.json` to be refreshed.

GitHub Actions independently reproduces the same defect:

- workflow: OC-5R REL-03A Source Certification
- run: `38136590487`
- failing step: **Install dependencies**
- error: missing `expo-camera@17.0.10` from the lock file.

R1 is not authorized to modify root `package-lock.json`.

A sandbox-only lock refresh was performed without committing it. It changes only root `package-lock.json` (21 insertions / 12 deletions), records `expo-camera@17.0.10`, and makes `npm ci` pass in 20.113 s. The lock was then reverted.

This proves both the defect and the smallest deterministic remediation.

## Build attempts

EAS CLI `24.12.1` was invoked with the immutable staging API pairing.

- Android `android-device`: build command attempted; stopped at Expo authentication.
- iOS `ios-simulator`: build command attempted; stopped at Expo authentication.
- iOS `ios-device`: build command attempted; stopped at Expo authentication.

The execution environment reports **Not logged in** and no `EXPO_TOKEN`.

This run therefore did not reach Apple signing, provisioning or device registration, and none of those are claimed as the current blocker.

The available Linux execution environment also has:

- no Java;
- no Android SDK;
- no ADB/emulator;
- no Xcode.

Therefore it cannot perform the missing Android/iOS runtime screenshots locally.

## Runtime evidence still not certified

The following remain unclaimed:

- compact iPhone Simulator visual pass;
- Android emulator/device visual pass;
- expanded Android/foldable-width runtime;
- live camera on simulator/device;
- VoiceOver / TalkBack;
- runtime large-text and keyboard behavior;
- degraded-network UI timings;
- Android APK installation;
- physical Android run;
- iOS Simulator installable build;
- physical iPhone build/install.

The source and offline queue guards passed, but they are not relabelled as physical evidence.

## Required remediation authority

Before installable-device certification can resume, authorize the smallest repository custody change:

1. refresh root `package-lock.json` for `mobile/package.json` → `expo-camera@17.0.10`;
2. rerun exact-head clean install and source certification;
3. provide an authenticated Expo/EAS execution context (logged-in EAS session or appropriate `EXPO_TOKEN`) for remote Android/iOS builds.

Only after the build reaches Apple signing should any Apple signing/device-registration action be classified.

## R1 disposition

The camera product remediation and every certification step executable without crossing current source/account/device authority have been completed.

The programme is not owner-checkpoint ready because the committed workspace dependency graph cannot clean-install under the current authorized source, and installable EAS builds cannot start without Expo authentication.

**OC-NATIVE REMEDIATE — PROVEN DEVICE/RUNTIME DEFECT**
