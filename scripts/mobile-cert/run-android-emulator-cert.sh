#!/usr/bin/env bash
#
# run-android-emulator-cert.sh — Android device/emulator certification driver for the
# Vehicle Trust OS native offline evidence workflow (canonical §132-154).
#
# HONESTY CONTRACT:
#   This script NEVER fabricates device results. It:
#     1. locates the Android SDK (adb + emulator);
#     2. uses an already-connected device if present, else boots an available AVD;
#     3. if NEITHER exists, exits with a clear NO_DEVICE external-gate message (exit 3);
#     4. when a device IS available, captures the real device_model/os_version via `adb`,
#        runs the RUNNABLE logic/store/migration certification harnesses, and prints the exact
#        on-device commands for the interactive checks (camera, permission dialogs, process
#        kill/restart) that a human/instrumented run must still perform.
#
# It does NOT mark the interactive on-device checks as passed — those are reported by a real run.
#
# Usage:
#   scripts/mobile-cert/run-android-emulator-cert.sh                 # auto-detect device/AVD
#   scripts/mobile-cert/run-android-emulator-cert.sh --avd <name>    # boot a specific AVD
#   scripts/mobile-cert/run-android-emulator-cert.sh --no-boot       # only use a connected device
#
# Exit codes: 0 = device available, automated harnesses ran; 2 = harness failure; 3 = NO_DEVICE gate.

set -uo pipefail

# ---------------------------------------------------------------------------------------------
# Resolve repo root + Android SDK tooling
# ---------------------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ANDROID_SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ADB="$(command -v adb || echo "${ANDROID_SDK}/platform-tools/adb")"
EMULATOR="${ANDROID_SDK}/emulator/emulator"

BOOT_ALLOWED=1
TARGET_AVD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --avd) TARGET_AVD="${2:-}"; shift 2 ;;
    --no-boot) BOOT_ALLOWED=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

log()  { printf '  %s\n' "$*"; }
head() { printf '\n=== %s ===\n' "$*"; }

head "Android Mobile Certification — environment"
log "repo root : ${REPO_ROOT}"
log "android sdk: ${ANDROID_SDK}"
log "adb       : ${ADB}"
log "emulator  : ${EMULATOR}"

if [[ ! -x "${ADB}" && ! -f "${ADB}" ]]; then
  echo ""
  echo "NO_DEVICE — external gate: adb not found. Install Android platform-tools." >&2
  echo "Certification cannot proceed on this machine without the Android SDK." >&2
  exit 3
fi

# ---------------------------------------------------------------------------------------------
# 1) Is a device/emulator already connected?
# ---------------------------------------------------------------------------------------------
connected_serial() {
  "${ADB}" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}'
}

SERIAL="$(connected_serial)"

# ---------------------------------------------------------------------------------------------
# 2) If not, try to boot an AVD (unless --no-boot)
# ---------------------------------------------------------------------------------------------
if [[ -z "${SERIAL}" && "${BOOT_ALLOWED}" -eq 1 ]]; then
  if [[ ! -f "${EMULATOR}" ]]; then
    echo ""
    echo "NO_DEVICE — external gate: no connected device and emulator binary not found at ${EMULATOR}." >&2
    exit 3
  fi

  AVDS="$("${EMULATOR}" -list-avds 2>/dev/null)"
  if [[ -z "${AVDS}" ]]; then
    echo ""
    echo "NO_DEVICE — external gate: no Android device connected and NO AVD is configured."
    echo "  (emulator -list-avds returned empty)."
    echo ""
    echo "To create an AVD (requires a system image download — an external/network gate here):"
    echo "  sdkmanager 'system-images;android-34;google_apis;arm64-v8a'"
    echo "  avdmanager create avd -n cert_pixel6a_api34 -k 'system-images;android-34;google_apis;arm64-v8a' -d pixel_6a"
    echo ""
    echo "Then re-run:  $0 --avd cert_pixel6a_api34"
    echo ""
    echo "Physical-device Android certification is therefore BLOCKED on this machine (recorded as an"
    echo "external gate in docs/vehicle-trust-os/mobile-certification/MOBILE_CERTIFICATION_REPORT.md)."
    exit 3
  fi

  BOOT_AVD="${TARGET_AVD:-$(printf '%s\n' "${AVDS}" | head -n1)}"
  head "Booting AVD: ${BOOT_AVD}"
  "${EMULATOR}" -avd "${BOOT_AVD}" -no-snapshot -no-boot-anim -netdelay none -netspeed full >/dev/null 2>&1 &
  EMU_PID=$!
  log "emulator pid: ${EMU_PID} — waiting for device..."
  "${ADB}" wait-for-device
  # Wait for full boot (sys.boot_completed=1), up to ~120s.
  for _ in $(seq 1 60); do
    if [[ "$("${ADB}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then break; fi
    sleep 2
  done
  SERIAL="$(connected_serial)"
fi

if [[ -z "${SERIAL}" ]]; then
  echo ""
  echo "NO_DEVICE — external gate: no device became available (none connected; boot not possible/disabled)." >&2
  exit 3
fi

# ---------------------------------------------------------------------------------------------
# 3) A device IS available — capture REAL device facts (never fabricated)
# ---------------------------------------------------------------------------------------------
head "Device available: ${SERIAL}"
DEVICE_MODEL="$("${ADB}" -s "${SERIAL}" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
ANDROID_REL="$("${ADB}" -s "${SERIAL}" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')"
API_LEVEL="$("${ADB}" -s "${SERIAL}" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')"
IS_EMU="$("${ADB}" -s "${SERIAL}" shell getprop ro.build.characteristics 2>/dev/null | tr -d '\r')"
log "device_model : ${DEVICE_MODEL:-unknown}"
log "os_version   : Android ${ANDROID_REL:-?} (API ${API_LEVEL:-?})"
log "characteristics: ${IS_EMU:-unknown}"

# ---------------------------------------------------------------------------------------------
# 4) Run the RUNNABLE (device-independent) certification harnesses — these are real results.
# ---------------------------------------------------------------------------------------------
HARNESS_RC=0
head "Automated certification harnesses (logic/store/drain/migration — real)"

log "-> mobile offline-resilience (npx tsx)"
( cd "${REPO_ROOT}/mobile" && npx --no-install tsx tests/certification/offline-resilience.test.ts ) || HARNESS_RC=2

log "-> mobile large-and-edgecases (npx tsx)"
( cd "${REPO_ROOT}/mobile" && npx --no-install tsx tests/certification/large-and-edgecases.test.ts ) || HARNESS_RC=2

log "-> backend certification service (node --test)"
( cd "${REPO_ROOT}" && node --test backend/tests/mobile-certification.test.js ) || HARNESS_RC=2

log "-> migration Up/Down/re-Up + immutability (PGlite)"
( cd "${REPO_ROOT}" && node database/test/mobile_certification_migration_check.mjs ) || HARNESS_RC=2

# ---------------------------------------------------------------------------------------------
# 5) Document the INTERACTIVE on-device checks that still require a real/instrumented run.
#     These are NOT auto-passed here — they are commands for a human/CI device run.
# ---------------------------------------------------------------------------------------------
head "Interactive on-device checks (NOT auto-passed — run against ${SERIAL})"
cat <<EOF
  # Build + install a RELEASE build (not a dev client):
  ( cd ${REPO_ROOT}/mobile && npx expo run:android --variant release --device ${SERIAL} )

  # Camera + file selection ......... capture odometer/damage photos and a PDF via the picker
  # Multi-page / rotation / glare ... capture a 3-page registration doc; rotate; low-light
  # Permission denial/recovery ...... deny camera, re-request, grant
  #   adb -s ${SERIAL} shell pm revoke <app.id> android.permission.CAMERA
  # App-private storage ............. confirm captures live under the app sandbox
  #   adb -s ${SERIAL} shell run-as <app.id> ls -la files
  # Offline queue persist + RESTART:
  #   adb -s ${SERIAL} shell svc data disable; adb -s ${SERIAL} shell svc wifi disable  # go offline
  #   ...capture N items...
  #   adb -s ${SERIAL} shell am force-stop <app.id>   # kill the process
  #   adb -s ${SERIAL} shell am start -n <app.id>/.MainActivity  # relaunch -> queue must rehydrate
  #   adb -s ${SERIAL} shell svc data enable; adb -s ${SERIAL} shell svc wifi enable   # reconnect
  #   ...verify exactly-once upload + duplicate prevention against staging...
  # Background/foreground ........... send to background mid-upload; resume
  # Network loss during upload ...... toggle radios mid-drain; verify retry + partial recovery
  # Low storage / low memory ........ adb shell to fill storage; observe queued item retained
  # Account/tenant isolation ........ log in as A, capture; logout; log in as B -> no A items
  # Logout cleanup .................. logout -> queue + blobs cleared (run-as ls shows none)
  # Privacy-safe telemetry .......... confirm no PII/image bytes in emitted analytics

  # Record each outcome via the backend service, e.g.:
  #   recordRun({platform:'android', device_model:'${DEVICE_MODEL:-<model>}', os_version:'Android ${ANDROID_REL:-<v>}', build_type:'release'})
  #   recordResult(runId, {check_key:'offline_queue_persist_restart', result:'pass'|'fail'|'skip', evidence_ref:'mobile-cert/<run>/<file>'})
EOF

head "Result"
if [[ "${HARNESS_RC}" -eq 0 ]]; then
  log "AUTOMATED harnesses: PASS. Interactive on-device checks: PENDING a real/instrumented run (not auto-passed)."
  log "Device facts captured: ${DEVICE_MODEL:-unknown} / Android ${ANDROID_REL:-?}."
  exit 0
else
  log "AUTOMATED harnesses: FAILED (see output above)."
  exit 2
fi
