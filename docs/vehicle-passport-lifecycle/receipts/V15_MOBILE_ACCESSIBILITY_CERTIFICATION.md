# V15 — Mobile, Low-Bandwidth and Accessibility Parity

**Date:** 2026-08-28
**Phase:** V15 — Mobile, Offline/Low-Bandwidth and Accessibility Parity
**Status:** PASS — EXACT-HEAD FOUNDATION CERTIFIED

## Shared-file reconciliation

The active Seller PR #182 does not modify:

- `web/src/pages/dashboard/owner/VehicleProfile.tsx`;
- `web/src/pages/dashboard/owner/VehicleProfile.claims.test.tsx`;
- `web/src/components/VehicleLifeStageTimeline.tsx`.

V15 therefore hardens the existing owner Passport without entering Seller-owned Marketplace/Vehicle Detail files.

## Files

Modified:

- `web/src/pages/dashboard/owner/VehicleProfile.tsx`
- `.github/workflows/vehicle-passport-foundation-ci.yml`

Added:

- `web/src/pages/dashboard/owner/VehicleProfile.passport-v15.test.tsx`

## Compact/mobile behavior

The owner Passport now provides:

- compact two-column tab navigation, expanding at larger breakpoints;
- minimum touch-target height on critical tab/upload/retry actions;
- horizontal, keyboard-focusable parts history when compact;
- responsive evidence header/actions;
- compact title sizing;
- lazy evidence-image loading;
- existing lazy canonical listing image loading.

No offline mutation queue is introduced. Evidence/owner mutations still require a successful governed online operation.

## Failure-state honesty

A failed Passport request now renders an accessible error state with retry.

A failed evidence read is explicitly different from an empty evidence set:

**Evidence records could not be loaded. This is not a statement that no evidence exists.**

A genuine empty set says only:

**No evidence records available to CarUp. This does not prove that no evidence exists.**

## Accessibility

- main landmark + labelled H1;
- loading uses `role=status` + screen-reader text;
- failure uses `role=alert`;
- reduced-motion disables the loading/ledger animations;
- Trust section is labelled;
- parts table has caption, column scopes and keyboard-scroll region;
- status/visibility badges carry text labels, not color alone;
- evidence previews have descriptive alt text.

Radix Tabs retain their keyboard semantics.

## Regression coverage

V15 adds rendered tests for:

- loading announcement;
- failed-load retry;
- evidence-failure vs empty-set distinction;
- conservative empty-state language;
- named keyboard-addressable tabs;
- compact/accessibility primitives;
- text-labelled status semantics.

Passport CI also reruns:

- the existing owner claim-badge truth tests;
- the existing native mobile certification service suite.

## Exact-head certification

Certified head:

- exact head: `3bd9da4aa62878acec0c8d81f225bc034e8abb5e`
- Vehicle Passport Foundation CI run: `33168703856` — **PASS**
- Passport V1–V15 cumulative contracts — PASS
- V15 rendered compact/accessibility tests — PASS
- existing owner claim-truth regression suite — PASS
- native mobile certification contract — PASS
- canonical V14/source verification, Communications, Trust, governance, evidence, lookup, service and PartSentry guards — PASS
- syntax/diff hygiene — PASS

Two gate defects were fixed without weakening product behavior:

1. Vitest was initially launched from repo root, bypassing the web workspace Vite alias configuration. The gate now runs from `web/`.
2. The Radix Tabs fixture used a bare click. Existing repository tests prove Radix activates on mouse-down/focus in jsdom; V15 now uses the same interaction.

## Phase decision

**V15 PASS. V16 AUTHORIZED.**
