# OC-NATIVE-LR1 — Build / Runtime Decision v1

## Decision

Keep the current Expo SDK 54 / React Native 0.81.5 product baseline and enable React Native New Architecture explicitly.

This is the smallest bounded route to an installable native build. No SDK migration is combined with the UX work.

## Proven compatibility basis

Current repository package set:

- Expo SDK 54
- React Native 0.81.5
- React Native Reanimated ~4.1.1
- react-native-worklets 0.5.1
- @shopify/flash-list 2.0.2
- React 19.1

The app previously set `newArchEnabled:false`.

Current upstream compatibility authorities state:

- Expo SDK 54 supports New Architecture and is the last Expo SDK where legacy architecture can still be disabled.
- Expo Go supports New Architecture only.
- Reanimated 4.x requires New Architecture; the Expo SDK 54-compatible line is Reanimated 4.1.x with worklets 0.5.1.
- FlashList v2 requires React Native New Architecture.

Therefore the bounded fix is:

`mobile/app.json → expo.newArchEnabled:true`

rather than a major SDK upgrade or a Reanimated / FlashList downgrade.

## EAS / installable path

`mobile/eas.json` defines three non-production profiles:

### android-device

- internal distribution
- APK output
- intended for a controlled physical Android or emulator
- no production store submission

### ios-simulator

- internal simulator build
- `ios.simulator:true`
- useful for exact-head simulator certification without claiming physical-iPhone evidence

### ios-device

- internal iOS distribution
- requires Apple signing / registered-device provisioning through the owner's Expo / Apple accounts
- this is an owner credential/signing gate; the repository does not invent or bypass it

The profiles intentionally do not use `developmentClient:true`, because `expo-dev-client` is not currently a dependency and adding it would require a broader package-lock change outside this native lane. Preview/internal binaries can still provide an installable product-like checkpoint.

## Backend environment

The mobile runtime requires `EXPO_PUBLIC_API_URL`.

For certification it must point to the approved immutable CarUp staging backend deployment, not production and not a localhost URL on a physical device.

No staging or production URL is hard-coded into source.

## Rollback

The architecture switch is isolated. If an exact-head native build proves an incompatible dependency or runtime regression:

1. do not weaken product tests;
2. revert only the dedicated New Architecture build commit;
3. record the incompatible dependency and version;
4. decide separately between dependency remediation and SDK migration.

Do not silently mix an SDK upgrade into OC-NATIVE-LR1.

## Remaining certification gate

Repository configuration establishes the build path but does not itself prove a physical installation. Required evidence remains:

- successful exact-head Android APK build + controlled physical Android install where infrastructure permits;
- exact-head iOS Simulator build;
- physical iPhone internal build only after Apple/Expo signing and registered-device authority are available.

A simulator must never be labelled as a physical iPhone.
