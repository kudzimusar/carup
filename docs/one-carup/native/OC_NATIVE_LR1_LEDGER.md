# OC-NATIVE-LR1 — Cumulative Native Ledger

**Programme start authority:** `40621751d4b74c59324fe6601aa5ddbdc7769b08`
**Branch:** `feat/oc-native01-product-foundation`
**Draft PR:** #223
**Lane:** native iOS / Android only
**Product candidate before evidence-only closure docs:** `ef20035c9ee85b94257ab8bee8cfa44f2c882e54`
**Product-candidate divergence from programme start:** 109 ahead / 0 behind
**Product-candidate changed files:** 58
**Write-scope audit:** PASS — every changed file is under `mobile/**` or `docs/one-carup/native/**`.

> This ledger distinguishes implementation from certification. Source-level guards and GitHub checks are recorded only for the exact SHA they actually exercised. Device, simulator, EAS build and fresh exact-head mobile test/typecheck evidence are not inferred from code shape.

## OC-NATIVE-00 — exact recustody / baseline

### Starting / ending authority

- Start: `40621751d4b74c59324fe6601aa5ddbdc7769b08`
- Branch created directly from that SHA: `feat/oc-native01-product-foundation`
- Draft PR created: #223, base `fix/oc5r-real-runtime-source-closure`
- No merge, production promotion, web-branch write or force-push was performed.

### Baseline recorded

- Expo SDK 54 / React Native 0.81.5 / Expo Router 6 / React 19.1.
- Start configuration: `newArchEnabled:false`, `supportsTablet:false`.
- Existing native routes included the dashboard/home, Marketplace, Garage, Communications, Referral, SafePay, Vehicle Detail and authentication / verification journeys.
- The old tab presentation was role-mutating and could expose Dashboard, Marketplace, Garage, Messages and More rather than one stable consumer shell.
- The exact start authority carried prior mobile certification evidence from PC01-J-R1. That evidence is retained as **baseline-only** and is not claimed as LR1 exact-head evidence.

### Baseline device/build issue

SDK 54 plus the installed Reanimated 4 / Worklets / FlashList dependency set made `newArchEnabled:false` unsuitable for a real current native build. This was isolated for OC-NATIVE-10 instead of being mixed silently into screen work.

---

## Amendment A1

OC-NATIVE-LR1-A1 is incorporated as programme authority. Mandatory execution order:

`00 → 01 → 01A → 01B → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10`.

The core product screens are not treated as visually/capture-system complete unless 01A and 01B are present.

---

## OC-NATIVE-01 / 01A — native design direction + visual grammar

### Construction authority

- Start: `40621751d4b74c59324fe6601aa5ddbdc7769b08`
- Initial 01A convergence through: `b64f2fc3a6fe5f3f723bf2f7e8c99cb58c6f67ea`

### Files introduced

- `mobile/theme/tokens.ts`
- `mobile/components/ui/NativePrimitives.tsx`
- `mobile/tests/native-design-system.test.ts`
- `docs/one-carup/native/DESIGN_SYSTEM_V1.md`

### Implemented

- Semantic navy / amber brand palette with light and dark themes.
- Amber is a signal, not a warning colour or wallpaper.
- Primary amber actions use a dark foreground instead of the legacy low-contrast white/orange treatment.
- Semantic typography: Display, Title Large, Title, Headline, Body, Body Emphasis, Label, Metadata, Price Large, Price Compact and Button.
- Small coherent spacing, radius and motion scales.
- 48dp practical touch-target floor in the new primitive layer.
- OS font scaling remains enabled; no global `allowFontScaling={false}` suppression.
- Shared primitives:
  - Screen
  - SectionHeader
  - Button / IconButton
  - SearchField
  - FilterChip / StatusPill
  - TrustSignal
  - EmptyState / Skeleton / Notice
  - Price
  - Field
  - StickyActionBar

### Source guards

`native-design-system.test.ts` checks semantic tokens, the primitive set, touch-target floor and avoidance of tiny type in the new primitive layer.

### Disposition

**IMPLEMENTED / awaiting runtime visual certification.**

---

## OC-NATIVE-01B — capture / OCR / media interaction system

### Construction authority

- Start after 01A.
- Primary 01B convergence through: `60d9f2b086c48d4711e692224b598e6773e8b32c`
- Later bounded source refinements include `d39bdbee4e02caea89b04d708af7da42c67b70f4`.

### Core files

- `mobile/utils/captureState.ts`
- `mobile/components/capture/CaptureSystem.tsx`
- `mobile/components/media/NativeMedia.tsx`
- `mobile/utils/camera.ts`
- identity verification screens under `mobile/app/(auth)/verification/**`
- `mobile/utils/verificationApi.ts`
- `mobile/tests/capture-system.test.ts`
- `mobile/tests/native-customer-language-guard.test.ts`
- `docs/one-carup/native/CAPTURE_OCR_MEDIA_SYSTEM_V1.md`

### Implemented

Truthful customer states distinguish:

`CAPTURED → UPLOADING → UPLOADED → OCR_READING → OCR_EXTRACTED → USER_CONFIRMED → NEEDS_REVIEW / UNDER_REVIEW → DOMAIN_VERIFIED`

with separate `RETRY_REQUIRED`, `REJECTED` and `NETWORK_FAILED` states.

Capture now provides:

- explicit permission states;
- operating-system camera launch;
- real captured-photo preview;
- Retake / Use photo;
- private evidence thumbnails;
- truthful upload / reading states;
- no fake live-viewfinder quality claims;
- no fake “aligned / sharp / document detected” measurement;
- EXIF disabled on capture;
- separate public vehicle media and private evidence media;
- explicit development liveness non-authority.

Verification processing now separates upload, OCR observation and the final identity decision. OCR extraction never becomes approval merely because fields were read.

### Governing authority preserved

**Document Intelligence observes. Domain authorities decide.**

### Disposition

**IMPLEMENTED / awaiting exact-head runtime camera and device certification.**

---

## OC-NATIVE-02 — stable native information architecture + shell

### Construction authority

- Initial shell convergence: `578fc2aac34f2aae71a6abf1ecc74439008ac69f` → `a1a7a7af1e966a0c02dac5e97642acc169ce4efe`
- Governance-refresh refinement: `fd753f7a541f93fb1b3a19590d931594ad33826d`

### Before

Role-dependent presentation could replace primary tabs and expose dashboard-oriented navigation.

### After

The global consumer shell is fixed to:

1. Home
2. Market
3. Inbox
4. Account

Legacy workflow routes remain reachable but hidden from the bottom bar:

- Garage
- SafePay
- Referrals
- legacy Communications route
- More

The underlying feature-governance store is still refreshed. Route authorization remains in place; only the customer-facing shell stopped mutating.

### Workflow locations

- Sell: Home + Account / Selling.
- Verify identity: Account / Verification.
- Check a car: Home.
- My Garage: Account and owner Home personalization.
- Saved cars: Market / Saved.
- SafePay and Referrals: Account when current feature access permits.
- Professional workspaces: Account only when a real native capability is available; they do not replace the shell.

### Disposition

**IMPLEMENTED / source shape locked by `native-shell.test.ts`.**

---

## OC-NATIVE-03 — Home

### Construction and refinement

Primary Home reconstruction began at `bdbe9a5b76c31f3c355aa2300a5f867926ef869d`. Later product refinements include high-value make chips, real service-directory rendering, owner media context and seller attention state. Product-candidate Home authority is included in `ef20035c9ee85b94257ab8bee8cfa44f2c882e54`.

### Guest / new user

Dominant intent:

**Find your next car**

Home provides:

- search make / model / keyword;
- Toyota / Nissan / Honda discovery chips;
- Fresh on CarUp from the current Marketplace API;
- real vehicle cards when published inventory exists;
- truthful no-supply / network states;
- subordinate Sell a car / Check a car / Find a garage actions.

It does not render a mission essay, role switcher, architecture copy or synthetic inventory.

### Authenticated owner / buyer

Only when current data exists:

- first owned vehicle / Your Garage;
- current unread CarUp conversation count;
- published seller listing when the owned vehicle is actually published;
- new seller-inquiry attention count from the seller-scoped Marketplace inquiry endpoint.

Empty personalized panels are not rendered merely to fill the page.

### Seller

Seller state is derived from an owned vehicle whose publication state is actually `published`, then resolved through the public listing contract. No view/save/message analytics are fabricated.

### Supporting quick routes

- `/check-car` is separate from Marketplace search and clearly states its current public-record limitation.
- `/find-garage` consumes real published service-provider listings and renders no demo garage.

### Disposition

**IMPLEMENTED / visual-device evidence pending.**

---

## OC-NATIVE-04 — Marketplace Search + Results

### Construction and refinement

Initial Market / results convergence: `570c268d40033e6a0c686edaed4028aaec6d92ed` → `824b637f07997fc7fac9b1667d084402ff49436d`.

Saved-discovery convergence: `2f198d5a5982abec3ab63da9e73a22857a386072` → `adfe004d031feeab2155c98635c86f05b8c1da5a`.

### Implemented

- Search leads with make / model / keyword.
- Canonical shared vehicle taxonomy is consumed rather than duplicated.
- Results use FlashList.
- 1-column phone and 2-column expanded-width behavior.
- Current filters and result count.
- Pull to refresh.
- Contextual loading, network-error and zero-result states.
- Vehicle card hierarchy: real image → vehicle → price → core facts → evidence-backed Trust signal → location / seller.
- Authenticated saved discovery uses the existing canonical Marketplace saved-listing API.
- Save/unsave is explicit and 48dp; no local-only shadow saved store was introduced.

### Disposition

**IMPLEMENTED / fresh exact-head interaction testing pending.**

---

## OC-NATIVE-05 — Vehicle Detail

### Construction authority

Primary redesign commit: `11fec3f456833656146711ddaf3193377fa29334`, with later accessibility/language fixes.

### Implemented

Progressive disclosure:

1. real published vehicle image;
2. identity / price / mileage / core facts;
3. seller / location / reservation;
4. Vehicle Passport & Trust;
5. evidence signals and known limitations;
6. safety information.

Trust rendering only uses the canonical public Trust projection. Unknown or unavailable is not converted to verified.

For evaluated Trust, the page can explain:

- the current evaluation/band;
- evidence-backed fact count when the public evidence basis supplies it;
- connected source count when supplied;
- adverse/attention count when supplied;
- evaluated date;
- known limitations;
- what the Trust evaluation does **not** claim.

For an authenticated owner whose vehicle is not publicly listed, the page falls back to the owner Vehicle Passport rather than presenting a public-listing 404 as ownership truth.

### Actions

Primary sticky action: **Message seller**.

The action creates the Marketplace inquiry / CarUp conversation path. It does not expose the seller phone number.

WhatsApp is currently implemented as **Share listing on WhatsApp** through the Communications share route. It is intentionally not misrepresented as the canonical conversation.

### Disposition

**IMPLEMENTED / runtime communication and device evidence pending.**

---

## OC-NATIVE-06 — Sell Start

### Construction authority

`1e25da2e48ba9824d590dc1f3bf6b803f527e863` → `cf476fc1a079e67128ed1145e25a728b5ea4740a`, with later customer-language refinements.

### Implemented

- Native start / resume rather than a port of the web seller dashboard.
- Signed-in personal account gate.
- Start with VIN / chassis identity.
- Resume from a currently owned vehicle.
- Vehicle facts / price / currency / location / description.
- Existing seller APIs persist the draft.
- Saving is explicitly a **draft**, not publication.
- No unproven “list in 3 minutes” claim.

### Disposition

**IMPLEMENTED / exact-head staging seller UAT pending.**

---

## OC-NATIVE-07 — My Garage

### Construction and refinement

- Service-history API convergence: `ffbecf78931133a1c1cd39c30bd492fc74afc473`
- Main owner-first rebuild: `ca6d7392fb64086f3107d84a9625a5ac18d44b61`
- Owner media / publication / Trust projection refinement: `fc9de24c792cda431e5c6e437113c8073fe0a297` → `5aae85e19435abda3a05bc4fc0384489e0e54aa3`

### Implemented

My Garage is now the owner's vehicle space, not the professional garage-operator product.

Cards consume real owner API fields for:

- vehicle identity;
- owner listing media;
- publication state;
- recorded mileage;
- Vehicle Passport entry;
- canonical Trust band when evaluated;
- recorded listing price when present.

Service history consumes the current owner service-history contract.

Odometer evidence uses:

capture → preview → durable local upload queue → governed evidence upload → OCR candidate → review state.

The photo is previewed before upload; offline failure keeps it queued rather than fabricating a server-side save.

### Kingston / Serena

No fixture was duplicated and no publication mutation was performed. The existing owner data remains the intended UAT target if the staging account supplies it.

### Disposition

**IMPLEMENTED / authenticated staging and physical-camera UAT pending.**

---

## OC-NATIVE-08 — personalization + Inbox / channel bridge

### Construction and refinement

Initial Communications / Account convergence: `1ff70a4512f008e7f148b960bbdf711995e2e65b` → `2c2321a3d360408e1e552b83a755b5f54c5d152a`.

Later provider-contract, governance, seller-state and inquiry-attention refinements culminate in product candidate `ef20035c9ee85b94257ab8bee8cfa44f2c882e54`.

### CarUp Inbox

- permanent shell destination;
- guest sign-in state;
- owner conversation list;
- canonical conversation detail screen;
- vehicle/subject context where returned;
- persisted read receipt;
- native in-app message composer;
- unread status;
- real transport indicator when a message/thread identifies WhatsApp, Telegram, Email, Push or CarUp.

### Provider distinction

- **Canonical conversation:** CarUp Inbox / thread.
- **Transport:** provider label on the current communication when supplied.
- **WhatsApp:** listing share and delivery preference; no raw seller-number bypass.
- **Telegram:** delivery preference and real transport label when supplied.
- **Email:** delivery preference / transport.
- **Push:** delivery preference / device notification.
- **Share action:** separate from conversation identity.

### Personalization

Home changes only from authoritative current state:

- signed-in owner and actual owned vehicles;
- current unread communications;
- actual public listing attached to a published owned vehicle;
- actual seller-scoped new inquiries.

No predictive recommendations or fabricated activity counts were introduced.

### Disposition

**IMPLEMENTED / exact-head end-to-end provider UAT pending.**

---

## OC-NATIVE-09 — accessibility / adaptive / low-network / performance foundation

### Construction authority

Main convergence runs from `fc45f6d1f56a8b3e79c516362259ec8965f3dc0e` through the subsequent 09 refinements, including performance instrumentation and current customer-language guards.

### Accessibility

Implemented / statically guarded:

- 48dp practical touch-target rule on new shared controls;
- screen-reader labels and states on principal controls;
- no global font-scaling disable;
- semantic selected state beyond colour;
- explicit errors / live-region support where applicable;
- safe-area-aware sticky action area;
- no 390×844 hard-coded screen layout in the core LR1 screens;
- customer language guard excludes internal architecture terminology from core surfaces.

Runtime still required for:

- large Dynamic Type reachability;
- VoiceOver / TalkBack reading order;
- actual keyboard avoidance on device;
- reduced-motion behavior of any runtime/platform transitions.

### Adaptive behavior

- phone-first.
- Marketplace results and My Garage use `useWindowDimensions`.
- expanded phone / foldable-like widths receive multi-column presentation.
- iPad remains intentionally disabled through `supportsTablet:false`.

### Low-network / offline

- Marketplace and owner reads show truthful network errors and retry.
- Odometer evidence is capture-first and can remain durably queued.
- No timeout/failure is replaced with fake Marketplace data.
- No full offline CarUp truth cache was introduced.

### Performance instrumentation

Privacy-safe in-memory instrumentation records:

- cold start → usable shell;
- warm resume;
- Marketplace request duration and content-length header when supplied;
- owner vehicle/service-history request duration;
- public image dimensions;
- queued odometer-upload event.

It does not record VINs, IDs, OCR values, media URLs or private file paths.

**No before/after runtime numbers are claimed yet.** Those require exact-head device execution.

### Source audit at product candidate

A connector-side scan of the core LR1 customer files found:

- no listed prohibited architecture/customer phrases;
- no numeric `minHeight` below 48 in the core files;
- no hard-coded 390×844 layout;
- no font-scaling disable marker.

This is source inspection, not a substitute for runtime accessibility testing.

### Disposition

**IMPLEMENTED FOUNDATION / runtime accessibility, network-throttle and performance evidence pending.**

---

## OC-NATIVE-10 — installable build path + native certification

### Construction authority

`8f2ec4248bbe3bbd98971429e8fc45ae2ddf8d1a` → `ed74a5839e45654ea4b692151ea6460fa54fb106`.

### Decision

The bounded route is:

- remain on Expo SDK 54;
- remain on React Native 0.81.5;
- enable New Architecture;
- do not hide an SDK migration inside the UX programme;
- do not add Expo dev-client merely to satisfy this checkpoint;
- retain `supportsTablet:false`.

### Build profiles

`mobile/eas.json` contains:

- `android-device`: internal distribution, APK;
- `ios-simulator`: simulator build;
- `ios-device`: internal iOS distribution.

### Certification status

Configuration is present, but **no exact-head EAS build, Android APK install, iOS simulator build or physical-iPhone build is claimed in this ledger.**

iOS physical internal distribution requires Apple signing / device provisioning. If those credentials or registrations are not already available to the build service, that is an owner gate under the programme stop conditions.

### Disposition

**BUILD PATH PREPARED / installable-device certification outstanding.**

---

## Source / CI evidence custody

### Evidence that exists

At earlier LR1 head `da35bba1e7dce316cf2aeaac32ddcc17541c1a41`:

- OC-5R REL-03A Source Certification run `38131307831`: SUCCESS.
- Communication Command Center CI run `38131307770`: SUCCESS for its unit and PostgreSQL jobs.

These runs do not certify the later LR1 head and do not run the complete mobile LR1 test matrix.

### Evidence still required at final candidate

Fresh exact-head execution of:

- mobile Vitest;
- `npm run test:native`;
- `npm run test:static`;
- `npx tsc --noEmit`;
- navigation/auth/Marketplace/Vehicle Detail/Garage/Communications guards;
- exact-head compact iPhone simulator visual capture;
- exact-head representative Android visual capture;
- exact-head expanded Android / adaptive-width capture;
- degraded-network runtime evidence;
- Android installable APK + physical device evidence;
- iOS simulator installable build evidence;
- physical iPhone evidence where signing permits.

The current PR base does not trigger the repository's main-targeted Navigation Intelligence workflow, and workflow files are outside LR1 write authority. Therefore this lane does not create a new workflow merely to manufacture a green badge.

---

## Current defects / blockers

No shared/backend/product-authority change has been proven necessary for the six-screen implementation.

Outstanding blockers are **certification/runtime gates**, not permission to rewrite domain authority:

1. fresh exact-head mobile test + typecheck execution;
2. exact-head native visual evidence on required sizes;
3. Android EAS/APK install and physical-device run;
4. iOS simulator EAS build/run;
5. Apple signing / registered-device action if needed for a physical iPhone build;
6. exact immutable staging API endpoint supplied to the installable build for controlled UAT.

---

## Current programme disposition

Product implementation has reached the intended LR1 vertical slice and build-path preparation. The programme is **not yet entitled to claim OWNER USABILITY CHECKPOINT READY** because the required exact-head test, visual and installable-device evidence has not been produced.

The final checkpoint report must therefore remain fail-closed until those gates are satisfied.
