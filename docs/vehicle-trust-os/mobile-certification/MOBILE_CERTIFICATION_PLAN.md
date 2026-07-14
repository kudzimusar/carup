# Vehicle Trust OS — Native Mobile Certification Plan

Scope: certify **release-grade native builds** (not only development clients) of the native offline
evidence capture/upload workflow — the durable upload queue in `mobile/store/uploadQueueStore.ts`,
its pure logic (`mobile/utils/uploadQueueLogic.js`), the drain worker (`mobile/utils/uploadQueueDrain.ts`),
the capture-admission gate (`mobile/utils/evidenceCapturePolicy.ts`), and the backend evidence
idempotency guard (`backend/services/evidence/uploadIdempotency.js`).

Canonical requirement: `docs/vehicle-trust-os/FULL_ACTIVATION_AND_MOBILE_CERTIFICATION_GOAL.md` §132–154.

Results of executing this plan on the current machine are recorded in `MOBILE_CERTIFICATION_REPORT.md`.

---

## 1. Device / OS matrix (target)

| # | Platform | Device (class) | OS version | Build type | Rationale | Status on this machine |
|---|----------|----------------|-----------|-----------|-----------|------------------------|
| A1 | Android | Pixel 6a (mid-range reference) | Android 14 (API 34) | release | primary supported Android | **BLOCKED — external gate** (no AVD/device) |
| A2 | Android | Galaxy A14 / low-RAM class (**lower-resource**) | Android 13 (API 33) | release | §138 lower-resource device | **BLOCKED — external gate** |
| A3 | Android | Emulator (google_apis, arm64) | Android 14 (API 34) | release | CI-reproducible smoke | **BLOCKED — no AVD configured** |
| I1 | iOS | iPhone 13 (or newer) | iOS 17.x | release | §139 one supported iPhone/iOS | **BLOCKED — external hardware/signing gate** |

§138 requires **at least two Android versions incl. a lower-resource device** (A1 + A2). §139 requires
**at least one iPhone/iOS combination** (I1). §154: if iOS hardware/signing is unavailable, complete all
code + simulator work and record the single external gate — do **not** claim iOS physical certification.

The **logic/store/drain/migration** layers (below, C-prefixed) are certified **now**, device-independently,
via automated harnesses. The **device-interactive** layers (D-prefixed) require a booted emulator or
physical device.

---

## 2. Certification checks (every item in §136–152)

### Automated, device-independent (runs now — real results)

| Check key | §Ref | What it proves | Harness |
|-----------|------|----------------|---------|
| `offline_capture_enqueue_persist` | 144 | offline capture is queued AND durably persisted (adapter received the row) | offline-resilience |
| `offline_queue_persist_restart` | 144 | queue survives a simulated **process termination/restart** (rehydrate from durable storage) | offline-resilience |
| `reconnect_drain_exactly_once` | 146,147 | on reconnect, drain uploads **exactly once** and sends the idempotency key | offline-resilience |
| `idempotency_dedupe` | 147 | the **same capture** enqueued twice drains once (duplicate prevention) | offline-resilience |
| `failed_upload_retry_kept` | 146 | a failed upload is kept (not lost) and drains after backoff — partial recovery | offline-resilience |
| `account_tenant_isolation` | 149 | account B never sees account A's queued captures | offline-resilience |
| `logout_cleanup` | 143,149 | logout wipes the queue + purges persisted blobs + empties the durable index | offline-resilience |
| `large_payload_within_budget` | 141 | a large (≈25 MB) but in-budget capture is admitted, queued and drains | large-and-edgecases |
| `unsupported_format_rejected` | 141 | an unsupported MIME is refused at the gate and never enqueued | large-and-edgecases |
| `oversize_rejected` | 141 | a capture over the size budget is rejected (`too_large`) | large-and-edgecases |
| `empty_capture_rejected` | 141 | a 0-byte / aborted capture is rejected | large-and-edgecases |
| `mime_fallback_from_extension` | 140,141 | MIME falls back to file extension; unknown/textual refused | large-and-edgecases |
| `multipage_ordering` | 141 | pages captured out of order upload in `pageOrder` sequence | large-and-edgecases |
| `low_storage_retained` | 148 | a full durable store (quota) never drops the capture — stays queued, still drains | large-and-edgecases |
| `backend_record_run` | 167 | certification run persisted with CHECK-validated columns | backend node:test |
| `backend_record_result_append_only` | 167,169 | results are append-only (no update/delete path; DB trigger blocks mutation) | backend node:test |
| `backend_run_matrix` | 152,167 | per-run counts + program summary + derived status aggregation | backend node:test |
| `backend_rls_shape` | 169 | reads gated to admin/government/service_role (RLS parity) | backend node:test |
| `backend_evidence_ref_storage_only` | 171 | `evidence_ref` must be a Storage path, never a URL/inline bytes | backend node:test |
| `migration_up_down_reup` | 169 | additive+reversible migration applies Up/Down/re-Up | PGlite harness |
| `migration_append_only_trigger` | 169 | `mobile_certification_results` UPDATE **and** DELETE both blocked | PGlite harness |
| `migration_fk_restrict` | 169 | `results.run_id` FK is `ON DELETE RESTRICT` (indexed) | PGlite harness |
| `migration_rls_enabled` | 169 | RLS enabled on both certification tables | PGlite harness |

### Device-interactive (requires emulator/physical device — driven by the script)

| Check key | §Ref | What it proves | How |
|-----------|------|----------------|-----|
| `camera_and_file_selection` | 140 | camera capture + document/file picker | manual/instrumented on device |
| `rotation_glare_blur` | 141 | rotation, glare, blur tolerance | manual on device |
| `permission_denial_recovery` | 142 | deny camera → re-request → grant | `adb ... pm revoke`, then in-app |
| `app_private_storage` | 143 | captures live in the app sandbox | `adb run-as <id> ls files` |
| `background_foreground` | 145 | background/foreground during upload | `adb am` / home + resume |
| `network_loss_partial_recovery` | 146 | radio toggles mid-drain; retry + partial recovery | `adb svc data/wifi` |
| `low_memory_pressure` | 148 | low-memory kill + relaunch | `adb shell am send-trim-memory` |
| `slow_intermittent_offline_networks` | 150 | slow/intermittent/offline | emulator `-netdelay/-netspeed`, `svc` |
| `privacy_safe_telemetry` | 151 | no PII/image bytes in analytics | inspect emitted telemetry |
| `release_build_only` | 134 | a **release** (not dev-client) build | `expo run:android --variant release` |

Each device-interactive outcome is recorded via the backend service:
`recordRun({platform, device_model, os_version, build_type:'release'})` then
`recordResult(runId, {check_key, result:'pass'|'fail'|'skip', evidence_ref:'mobile-cert/<run>/<file>'})`.
Screenshots/traces go to a **private** Supabase Storage bucket; `evidence_ref` stores the path only
(§171: signed short-lived access, tenant/provider scoping, checksums, type/size controls, retention).

---

## 3. Evidence persistence model (§167, §171)

- `mobile_certification_runs` — one row per (platform, device_model, os_version, build_type) attempt;
  mutable only for the status lifecycle `pending → running → passed/failed/blocked` + completion.
- `mobile_certification_results` — **append-only** per-check ledger (immutable audit evidence),
  guarded by the `governance_block_mutation()` trigger (UPDATE + DELETE blocked). FK to runs is
  `ON DELETE RESTRICT` and indexed. RLS: service_role writes; admin/government read; no anon.
- `evidence_ref` is a **private Storage path only** — never a URL, never bytes (enforced by the service
  `normalizeEvidenceRef`).

Migration: `database/migrations/20260703170000_mobile_certification.sql` (additive, reversible, Up/Down
markers, indexed FKs, tenant ownership, RLS, least-privilege grants, append-only guard).

---

## 4. How to run

```bash
# Automated (device-independent) certification — real results:
cd mobile && npx tsx tests/certification/offline-resilience.test.ts
cd mobile && npx tsx tests/certification/large-and-edgecases.test.ts
node --test backend/tests/mobile-certification.test.js
node database/test/mobile_certification_migration_check.mjs

# Android device/emulator driver (boots an AVD if present; else NO_DEVICE external gate):
scripts/mobile-cert/run-android-emulator-cert.sh            # auto-detect
scripts/mobile-cert/run-android-emulator-cert.sh --avd <name>
```

## 5. Exit / completion classification

- Automated logic/store/drain/migration/backend layers → certified when all harnesses pass.
- Physical Android (A1/A2) and emulator (A3) → require a device/AVD; **blocked as an external gate**
  on any machine without one (this machine has none).
- iOS (I1) → `ENGINEERING_COMPLETE_EXTERNAL_HARDWARE_REQUIRED` — code + logic complete; physical
  iOS certification requires Apple hardware + signing (external gate). **Never** claimed as passed.
