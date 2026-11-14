# CarUp Native Mobile Certification Gate

**Status:** NORMATIVE ADDENDUM to `POST_REUNIFICATION_DUAL_LANE_PRODUCT_ADVANCEMENT_AND_CARUP_DESIGN_SYSTEM_EXECUTION_PLAN.md`

This addendum closes the native-mobile certification gap identified during review of PR #181. Playwright mobile browser projects certify responsive web behavior; they do **not** prove the Expo/React Native application.

## 1. Governing rule

No Lane B completion claim may say **mobile parity** unless the native Expo application has separately passed the native gate below.

If native execution is intentionally deferred, the release wording MUST be limited to **responsive web parity** and the native gap must remain explicitly open.

## 2. Required native scope

The native Marketplace journey must consume the same canonical Marketplace and Vehicle Truth/Trust contracts as web and must cover, where the backend capability exists:

- Marketplace discovery;
- free-text search;
- make and vehicle facet filtering;
- image-led result cards;
- listing detail;
- evaluated / not-evaluated / unavailable Trust states without fabricating a score;
- Vehicle Passport entry point;
- save / unsave;
- compare or an explicitly documented native deferral if the shared product capability is not yet exposed natively;
- share;
- inquiry creation;
- transition into the canonical conversation experience;
- reservation / transaction-readiness state where enabled;
- native navigation and deep-link behavior;
- loading, empty, error and offline/degraded states;
- touch target and accessibility behavior;
- camera/document/media affordances where the specific flow uses them.

Native code MUST NOT calculate its own Trust score, infer reservation state, expose private vehicle identifiers, or consume legacy `/api/vehicles` data in place of canonical Marketplace projections.

## 3. Automated gate

Before native Marketplace is certified, require at minimum:

1. Expo / React Native TypeScript clean;
2. native unit/component tests green;
3. Marketplace mobile API contract tests green;
4. navigation / deep-link tests green;
5. regression tests proving `trust_score` may be null and that `not_evaluated` is not rendered as zero;
6. save / inquiry / share / reservation contract tests for each capability actually shipped;
7. no hardcoded localhost or dev-user fallback enabled in staging/release configuration.

## 4. Physical device or emulator gate

At least one iOS-family and one Android-family execution surface must be exercised before broad beta. A simulator/emulator is acceptable for the controlled-test gate if physical devices are unavailable, but one physical-device pass is required before public launch.

Required UAT matrix:

- iPhone-class viewport/device;
- Android Pixel-class viewport/device;
- cold launch;
- signed-out browse;
- signed-in buyer journey;
- deep link to Marketplace listing;
- search/filter;
- open detail;
- inspect Trust/Passport;
- save;
- share;
- inquiry -> conversation;
- reservation where enabled;
- back navigation and state restoration;
- network failure/retry;
- app background/foreground resume.

## 5. Visual gate

Playwright screenshots remain authoritative for responsive web only.

Native visual review must use native screenshots from the simulator/emulator/device at representative states:

- default Marketplace;
- active filters;
- image/no-image card;
- evaluated Trust;
- not-evaluated Trust;
- listing detail;
- inquiry/conversation transition;
- empty state;
- error state.

The reference design language remains **Precision Automotive Commerce + Evidence-Led Trust Intelligence**, but native layout may differ where platform ergonomics require it.

## 6. Completion language

Permitted:

> Responsive web Marketplace certified; native Marketplace remains a separate gate.

or, after this addendum passes:

> Marketplace certified across responsive web and native mobile.

Forbidden:

> Mobile parity complete

when only Playwright's browser-emulated mobile project has run.

## 7. Relationship to the two-lane model

This native gate belongs to **Lane B**. It does not create a third source-write lane.

If native changes and web changes must proceed concurrently, they remain in the same Marketplace Reliability + Reference UX branch/PR unless the integrator explicitly serializes a temporary sub-branch that is merged back into Lane B before review.

## 8. Beta threshold

For the first controlled external tester cohort, responsive web can be admitted independently if native is explicitly excluded from the invitation. If native testers are invited, this gate is mandatory before invitations are sent.
