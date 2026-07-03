# Vehicle Trust OS — Native Mobile Certification Report

Program: Vehicle Trust OS — Full Activation. Branch: `plan/vehicle-trust-full-activation`.
Plan: `MOBILE_CERTIFICATION_PLAN.md`. Canonical §132–154, §167, §169, §171.

**Honesty statement:** this report separates what **actually ran** (automated logic/store/drain/
migration/backend harnesses — real, reproducible results) from what is **SKIPPED/BLOCKED** behind an
external hardware gate (physical Android device / configured emulator, and iOS hardware+signing).
**No physical-device certification is claimed. No simulator/logic result is presented as an on-device
result.**

Machine reality (verified at report time):
- `adb` present (`/usr/local/bin/adb`) and Android `emulator` binary present
  (`~/Library/Android/sdk/emulator`).
- `emulator -list-avds` → **empty** (no AVD configured). `adb devices` → **no device attached**.
- No iOS hardware, no Apple signing identity.
- Result: on-device / emulator certification **cannot run here** — recorded below as an external gate.

---

## 1. What RAN — automated harnesses (real results)

| Harness | Command | Result |
|---------|---------|--------|
| Backend certification service | `node --test backend/tests/mobile-certification.test.js` | **10 pass / 0 fail** |
| Mobile offline resilience (store+drain) | `npx tsx mobile/tests/certification/offline-resilience.test.ts` | **7 checks pass** |
| Mobile large payload + edge cases | `npx tsx mobile/tests/certification/large-and-edgecases.test.ts` | **7 checks pass** |
| Migration Up/Down/re-Up + immutability (PGlite) | `node database/test/mobile_certification_migration_check.mjs` | **PASS (14/14 assertions)** |

**Total automated: 10 (node:test) + 7 + 7 (tsx) + 14 (migration assertions) = 38 assertions/checks, 0 failures.**

### 1a. Backend service (`backend/tests/mobile-certification.test.js`) — 10/10
recordRun create + CHECK validation; recordResult append; **results append-only** (no update/delete
export; repeated append accumulates; DB-layer mutation rejected); getRunMatrix aggregation + platform
filter; **RLS-shape** (reads gated to admin/government/service_role, others rejected); evidence_ref
Storage-path-only enforcement; deriveStatus precedence.

### 1b. Mobile offline resilience — 7/7 (exercises the REAL store + drain)
`offline capture enqueue+persist`, `process-restart rehydrate`, `reconnect drain exactly-once + idempotency
key`, `duplicate prevention (same capture → one drain)`, `failed upload kept for backoff retry then drains`,
`account/tenant isolation`, `logout cleanup (queue + blobs + durable index)`.

### 1c. Mobile large payload + edge cases — 7/7
`large within-budget admitted+queued+drains`, `unsupported format rejected (never enqueued)`,
`oversize rejected (too_large)`, `empty capture rejected`, `MIME fallback from extension`,
`multi-page ordering (out-of-order → pageOrder sequence)`, `low-storage (full durable store) never drops
the capture — stays queued and still drains`.

### 1d. Migration (`20260703170000_mobile_certification.sql`) — 14/14 assertions
both tables created; RLS enabled on both; `results.run_id` FK is `ON DELETE RESTRICT`; two append-only
triggers; **UPDATE blocked**; **DELETE blocked**; run delete restricted while results exist; bad
platform/build_type/status/result all rejected by CHECK; Down drops both tables; re-Up recreates both.
SHA-256 of migration file: `f3d76bb4fec0196c474d36adfbea1a169a6f5eb6e5a92f7b2ce1a98696675aea`.

---

## 2. What is SKIPPED / BLOCKED — external gates (NOT claimed passed)

| Layer | Target | State | Exact gate |
|-------|--------|-------|-----------|
| Physical Android device | Pixel 6a / Android 14 (A1), low-resource Galaxy A14 / Android 13 (A2) | **BLOCKED** | No physical Android device attached to this machine. |
| Android emulator | google_apis arm64, Android 14 (A3) | **BLOCKED** | `emulator -list-avds` empty — **no AVD configured**; creating one needs a system-image download (network/SDK gate). |
| iOS physical device | iPhone 13 / iOS 17.x (I1) | **BLOCKED — EXTERNAL HARDWARE+SIGNING GATE** | No Apple hardware and no signing identity on this machine. Per §154, code + logic complete; **iOS physical certification is NOT claimed passed.** |

The interactive on-device checks that these gates block (camera + file selection, rotation/glare/blur,
permission denial/recovery, app-private storage, real OS process kill/restart durability,
background/foreground, live network-loss/retry/partial-recovery, low-memory pressure,
slow/intermittent/offline radios, privacy-safe telemetry, **release-build install**) are enumerated with
exact `adb`/Expo commands in `MOBILE_CERTIFICATION_PLAN.md` §2 and printed by the driver script.

### Emulator driver evidence
`scripts/mobile-cert/run-android-emulator-cert.sh` → exit **3** with:
`NO_DEVICE — external gate: no Android device connected and NO AVD is configured.`
The script does **not** fabricate device results; when a device/AVD becomes available it captures the real
`device_model`/`os_version` via `adb getprop`, runs the automated harnesses, and prints the interactive
command set for a human/CI run (which then records outcomes via the backend service).

---

## 3. Honest device matrix

| # | Platform | Device | OS | Build | Exercised as | Verdict |
|---|----------|--------|----|-------|--------------|---------|
| A1 | Android | Pixel 6a (mid) | Android 14 | release | — | BLOCKED (no device) |
| A2 | Android | Galaxy A14 (low-resource) | Android 13 | release | — | BLOCKED (no device) |
| A3 | Android | Emulator google_apis | Android 14 | release | — | BLOCKED (no AVD) |
| I1 | iOS | iPhone 13 | iOS 17.x | release | — | BLOCKED (external hardware+signing gate) |
| — | **Logic/store/drain** | node/tsx (this machine) | Node 20.20.2 | n/a | **7 + 7 tsx checks** | **PASS** |
| — | **Backend evidence store** | node:test (this machine) | Node 20.20.2 | n/a | **10 tests** | **PASS** |
| — | **DB migration** | PGlite (PG 17.5 WASM) | n/a | n/a | **14 assertions** | **PASS** |

**Platforms actually exercised on hardware/emulator: NONE.** Platforms exercised as certified logic/store/
drain/migration/backend: the Node/tsx/PGlite layers above.

---

## 4. Completion classification

- Native offline evidence **logic/store/drain/capture-gate + backend evidence store + migration**:
  **ENGINEERING_COMPLETE** (all automated harnesses green, reproducible on this machine).
- **Android physical + emulator certification**: `ENGINEERING_COMPLETE_EXTERNAL_DEVICE_REQUIRED` —
  code + driver + check matrix complete; needs a physical device or a configured AVD (external gate).
- **iOS physical certification**: `ENGINEERING_COMPLETE_EXTERNAL_HARDWARE_REQUIRED` — needs Apple
  hardware + signing (external gate). **Not claimed passed.**

## 5. Defects

P0/P1 found during automated certification: **0**. One test expectation was corrected during
authoring (unknown-extension capture returns `missing_mime` rather than `unsupported_format`; both are
refusals — the capture is never enqueued); the capture-admission policy behaves correctly.

## 6. Reproduce

```bash
node --test backend/tests/mobile-certification.test.js
cd mobile && npx tsx tests/certification/offline-resilience.test.ts && npx tsx tests/certification/large-and-edgecases.test.ts
node database/test/mobile_certification_migration_check.mjs
scripts/mobile-cert/run-android-emulator-cert.sh   # exits 3 (NO_DEVICE) on a machine with no device/AVD
```
