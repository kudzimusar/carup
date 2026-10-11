# OC-NATIVE-LR1 — Cumulative Native Ledger

**Programme start authority:** `40621751d4b74c59324fe6601aa5ddbdc7769b08`  
**Branch:** `feat/oc-native01-product-foundation`  
**Draft PR:** #223  
**Lane:** native iOS / Android only  
**Write scope:** `mobile/**`, `docs/one-carup/native/**`

## OC-NATIVE-00 — recustody / baseline

- Dedicated native branch created directly from exact programme start SHA `40621751d4b74c59324fe6601aa5ddbdc7769b08`.
- No web, backend, database, Supabase, shared-contract or workflow source is in this lane.
- Starting native stack: Expo SDK 54, React Native 0.81.5, Expo Router 6, React 19.1, `newArchEnabled:false`, `supportsTablet:false`.
- Existing application routes at start: dashboard/home, Marketplace, Garage, Communications, Referral, SafePay, Vehicle Detail, login/register/biometric and the identity-verification flow.
- Existing tab presentation at start was role/governance-driven and could surface Dashboard, Marketplace, Garage, Messages and More instead of a stable consumer shell.
- Exact starting commit carries prior certification evidence in `docs/one-carup/OC5R_PC01_J_R1_OWNER_USABILITY_CONVERGENCE.md`: mobile vitest 6 files / 66 tests, 18/18 standalone scripts and `tsc --noEmit` clean at its native code head. This is inherited baseline evidence only; LR1 still requires fresh exact-head certification.
- Known installable-build blocker inherited from start: SDK 54 has `newArchEnabled:false` while Reanimated 4 and FlashList 2 require New Architecture. Expo Go works because its SDK 54 runtime uses New Architecture. Dev-client/EAS/release compatibility is isolated to OC-NATIVE-10.

## Amendment A1

OC-NATIVE-LR1-A1 is incorporated as controlling programme detail. Mandatory order:

`00 → 01 → 01A → 01B → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10`.

Core-screen work is not accepted until 01A visual grammar and 01B capture/OCR/media gates are satisfied.

## OC-NATIVE-01 / 01A — visual grammar

### Starting SHA

`40621751d4b74c59324fe6601aa5ddbdc7769b08`

### Implemented

- Semantic navy/amber palette with explicit light/dark themes.
- Accessible amber primary treatment uses navy foreground, not white-on-amber.
- Semantic typography, spacing, radius, motion and touch-target tokens.
- Shared primitives for screen, section header, buttons, icon buttons, search, filter chips, status, trust/evidence, empty states, skeletons, price, notices, fields and sticky actions.
- System font scaling remains enabled; no global font-scale suppression.
- Touch-target floor is 48dp in the new primitive layer.
- Amber is a brand signal, not a universal warning/state colour.

### Test/evidence

`mobile/tests/native-design-system.test.ts` guards semantic tokens, required primitives and the 48dp floor.

### Exit-gate status

Foundation primitives exist. Later 01A/01B convergence commits must ensure every touched customer screen uses the shared grammar rather than adding parallel hard-coded systems.
