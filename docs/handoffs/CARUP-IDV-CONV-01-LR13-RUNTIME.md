# CARUP-IDV-CONV-01-LR13-LIVE-REVIEW-RUNTIME-AND-OWNER-CERTIFICATION-CANDIDATE-01

Issue #261. Existing review vehicle [draft PR #276](https://github.com/kudzimusar/carup/pull/276). Recommendation **REMEDIATE before release**.

LR13 continues frozen LR12 `b6ea55faccac8f31c7671187adb70563d7b0f6b9` (tree `5e55bd1327e5e373e0334b47d3e0e80df0ea018b`) on accepted main `f269ec0369211228689e1d2bd4a13da42b707585`. The LR12 reconstructed ancestry and historical evidence remain documented in [the LR12 handoff](CARUP-IDV-CONV-01-LR12-LIVE-REVIEW.md). The PR readback and test bundle provide the exact LR13 head, tree and parent.

## Changes and certification

| Gate | Result and evidence |
| --- | --- |
| R1 and S01 | **PASS** for implementation and local/isolated verification. The old issuance path could fall back to a process-local counter. The new additive migration claims one of fifteen attempts per authenticated reviewer in a shared 15-minute PostgreSQL window before checking the password. It checks valid, unexpired sessions and reviewer roles, bounds rows to one per reviewer and denies direct access to the counter. An unavailable claim authority returns 503. A denied claim returns 429. Existing proof binding, expiry and single-use SQL remain the credential authority. |
| R2 and S02 | **PASS** on disposable PostgreSQL 16.15 (Homebrew), with pgcrypto 1.3 and uuid-ossp 1.1. On the final rerun separate backend PIDs 62242 and 62243 exercised real transactions. The migration harness replayed the seven candidate migrations. Proof consumption returned one winner, the attempt budget admitted 15 of 20 cross-session requests, revoked-session claims failed, and a fresh window admitted a valid session. Independent submission and confirmation races, applicant correction versus reviewer action, two reviewers contesting one revision, rollback of injected audit/outbox failures, idempotent replay and self-review denial passed. Decision, applicant association and audit updates were refused. |
| R3 browser and API | **PASS** for the isolated, synthetic-provider workflow. The web production bundle, actual CarUp identity routers, password verification, CSRF and protected PostgreSQL persistence were active. Fixture login and private storage used the same disposable database, with separate applicant/reviewer accounts and no outbound OCR call. The Node HTTP journey created, uploaded, confirmed, requested resubmission, re-uploaded, reconfirmed and approved one same-ID case. In a second case Chrome displayed original and corrected fields separately, opened private evidence, saved a resubmission, and returned to the right queue. The applicant loaded the exact instruction from PostgreSQL at `/kyc`. The stored browser decision had one authoritative audit, one pending event and two attached media objects. Storage-provider behavior, actual OCR and live delivery remain **NOT_TESTED**. |
| R4 Android | **BLOCKED**. Expo prebuild passed with Java 17 and the existing New Architecture configuration. Both Gradle invocations reached startup without creating an APK. The available AVD exited 132 during startup and ADB listed no device. An installable debug artifact and actual device UAT remain open with the Native specialist. |
| R4 iOS | **BLOCKED**. CoreSimulatorService disconnected and `xcrun simctl list devices booted` exited 1. No eligible iOS device run was available. |
| R5 and R7 | **PASS** for tested keyboard and responsive behavior and selected recovery. Enter submits all three password forms. A stale decision clears the prior private case view and requests a new unlock. An uncertain response keeps the same idempotency key and asks for a fresh password. Chrome reviewer and applicant views passed horizontal overflow checks at 360×800, 390×844, 768×1024, 1280×800 and 1920×1080. Dedicated automated tests verified lost-response retry and stale-case recovery. Full screen-reader and stress testing remain **NOT_TESTED**. |
| R6 CI | **BLOCKED** for remote CI. Local commands are independently replayable. The branch keeps deployment disabled and publication uses the existing CI skip marker. Dedicated D6 governance is outside this change and no shared-secret workflow was dispatched. |
| R8 retention | **BLOCKED** for policy approval. Direction B requires Owner/counsel decisions below. Current database grants and cascades were inventoried non-destructively. |
| R9 independent review and Owner UAT | **BLOCKED** pending independent exact-head assessment and Owner acceptance. Both journeys can be reproduced locally. Reviewer `@11-eleven-skm` owns source-security assessment, the Owner owns UAT and release decisions, and the moderator owns any isolated CI authorization. |

The focused exact-source regression count is **157 backend, 50 web and 53 mobile**, with a successful production web build, mobile TypeScript and embedded PostgreSQL compatibility suite. Existing escrow header-count failure is outside this implementation and stays with the native navigation lane. Warm loopback measurements, 20 serial samples per route, were 2.9 ms median and 3.9 ms p95 for the reviewer queue, 2.8 ms median and 3.2 ms p95 for applicant status. These are small-fixture API wall times. Production throughput and browser paint metrics remain unmeasured.

## PostgreSQL privileges and technical retention decisions

The named local `service_role` has no BYPASSRLS attribute. A dedicated NOLOGIN, non-superuser fixture role inherited its exact grants plus BYPASSRLS on the test run. No existing role was altered. The web fixture's SQL adapter connected as the owner of its fresh database. Actual production deployment role/ownership parity and real storage authorizations require independent validation. The budget RPC is SECURITY DEFINER with fixed `pg_catalog` search path and service-role execute only. The prior decision primitive had no direct execute grant to service role. `anon` and `authenticated` had no direct access to the audited identity tables or protected RPCs.

| Category | Decision required under direction B |
| --- | --- |
| Original media and abandoned uploads | Define private-object lifetime, grace period for unattached/replaced objects, matching between row and object deletion, proof of cleanup and hold overrides. A foreign-key cascade does not delete a storage object. |
| Derived OCR and applicant declarations | Define purpose, access and retention for machine observations, provenance and corrected values across resubmissions. Session deletion cascades to both. |
| Case and reviewer decisions | Define reviewed and abandoned case retention, erasure conditions and hold/approval rules. Service role retains DELETE on cases and decisions. Case deletion cascades into the decision and evidence records. |
| Authoritative audit | Define tamper- and deletion-resistant retention and permitted erasure proof. UPDATE protections do not revoke the existing service-role DELETE grant. |
| Notification outbox | Approve event payload minimization and retention for queued, delivered and exhausted records. Existing application outbox is unchanged. |
| Backups and recovery | Approve retention and restoration rules that preserve holds and prevent erased media or declarations from being restored to ordinary access. |

No customer identity data, passwords, session tokens or signed URLs belong in review evidence. All examples use synthetic records. No retention job or policy deletion was exercised.

## Owner preview

Create a new local PostgreSQL database named `carup_idv_test_*` from a clean template. Limit database access to the local operator. The runtime needs the existing `anon`, `authenticated` and `service_role` names. With a local service role that lacks BYPASSRLS, the operator can create a temporary NOLOGIN, non-superuser BYPASSRLS role named exactly `<database>_service` that inherits `service_role`. Existing role attributes and other databases need no changes. Set `CARUP_IDV_TEST_SERVICE_ROLE` to that exact fixture role.

From repository root, with the locked dependencies installed:

```bash
export CARUP_IDV_TEST_DISPOSABLE=yes
export CARUP_IDV_TEST_DATABASE_URL=postgresql://127.0.0.1:5432/carup_idv_test_your_run
bash backend/tests/integration/identity-confirmation-postgres.sh
VITE_API_URL=http://127.0.0.1:5074/api npm run build --workspace=web
export CARUP_IDV_TEST_PASSWORD="$(openssl rand -hex 20)"
node backend/tests/integration/identity-postgres-web-preview.mjs
```

Use the same temporary password in a second shell, passed privately, and run:

```bash
node backend/tests/integration/identity-postgres-web-journey.mjs --prepare-browser
```

Sign in at `http://127.0.0.1:5074/login?returnTo=%2Fadmin%2Fverification` as `reviewer@lr13.example.invalid`. Open the case ID printed by the journey command, complete password step-up, preview the front fixture and choose a reason and applicant message for resubmission. Sign out and sign in as `applicant@lr13.example.invalid` at `/kyc` to see the persisted result. The same journey script without `--prepare-browser` runs a separate complete resubmission-to-approval sequence. The test server binds only to loopback and uses a fixture OCR response, a real PostgreSQL-backed storage fixture and no live notifications.

## RX-05 interface and publication

Kimi's shell uses `/admin/verification` and `web/src/lib/verificationAdminApi.ts`. Queue access is authenticated and returns minimized summaries. Opening private detail, a preview side or a decision requires a separate scoped step-up proof. Do not prefetch evidence. Render server-authorized actions, use the displayed revision with a stable idempotency key, and keep the applicant message separate from the private note. Support password entry, request in progress, proof expiry, attempt budget exhausted, preview unavailable, stale case, uncertain response, saved receipt and queued delivery. The applicant view consumes the authenticated own-case status.

Before rollout, apply the additive shared-budget migration on the separately authorized target, verify effective roles and function ownership, and route all reviewer instances through the new path together. A mixed rollout leaves older instances using the legacy per-process budget. Quiesce review traffic during a rollback that would otherwise reintroduce that fallback. Production, shared staging, native/Owner approval and independent security certification are separate gates.
