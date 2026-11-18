# LR12 Live Review custody and handoff

Issue #261. Review branch `feat/carup-idv-live-review-lr12`. Disposition **REMEDIATE before release**. The evidence package identifies the final commit and tree.

## Source custody

The original LR08/LR09 local Git commit objects were unavailable. This candidate reconstructs preserved, checksum-verified source evidence on a newly verified Git history. The new commits have different identities and require independent source-security certification.

| Source | New or retained commit | Verified tree |
| --- | --- | --- |
| Accepted main | `f269ec0369211228689e1d2bd4a13da42b707585` | `5ea8634c1f28720660a02b3d4566b7e998f9a2bd` |
| Reconstructed LR08 | `a31a255cd154edd3cdea00c5df5a5073756b9476` | `4100b755d4308479f16ad2d108dba4962d3344a8` |
| Reconstructed LR09 | `6c438db98ace468d1573b1340bd09c6c49a0247e` | `8667cc1f6be73ac02486ed04834d2db06c1a6885` |
| S02 | `84049c05894976f3f9a50ef4ce358234e86ace88` | `586070f3cec0a88bdb90c146f673aeca555bf7a0` |
| S01 | `8c0f8913d5748dc1684c2ad3f16b612f40a3a56e` | `29f0cb3313240e18db4afc84dc57af45e5648a3b` |
| Live Review workflow | `734349c60377ddb17a54761b1ce03ecb4e33742b` | `c4cee372eb27f0b39d2bd8e56fcb15e5af4a3796` |

LR08 archive SHA-256 `5956a473c27187f0af0baa23e8ff47fb8be7b65400e892cf1d221ef846dd0988`. LR09 archive SHA-256 `c7c6de3556c3fecccf95ab6faa91f0b52a86fd3ffab5dc5fb7290098825abbbf`. Both archive manifests were verified. The combined accepted-main-to-reconstructed-LR09 binary diff matches the retained full patch byte for byte. The historical LR08 archive approval stands. The historical LR09 security disposition remains REMEDIATE until independent review of the new source.

## Runtime and workflow

- The queue uses the existing server-side phase/status filter, newest-first ordering, an explicit refresh and 30-second refresh when visible and outside a case. It exposes case reference and operational status. The workbench retrieves sensitive detail on demand.
- The master plan identifies Identity as a protected review area and requires step-up in reviewer flows. OD-16 remains a broader policy decision. LR12 protects private detail, each evidence side, all decisions and internal notes while keeping a minimized queue available to authenticated platform reviewers. Independent review must confirm that scope and password freshness policy.
- Step-up uses the existing account password and server-validated session. Each random, hashed, two-minute proof is scoped to a reviewer, session, case and operation. Atomic use, expiry and session revocation are checked in SQL. Issuance uses the existing per-account rate limiter with failure closure on store I/O errors. Cross-instance rate-limit store configuration and function/role grants still require exact-environment validation.
- Existing preview operations audit each successful disclosure and use a 180-second signed URL. The client clears previews when leaving the case or recording a decision. The ordinary queue and applicant API never return a storage path.
- The S02 migration prevents mutation of recorded decisions, session ownership and verification audits. It revokes decision UPDATE grants, preserves insert-time independence, and does not change deletion paths or retention. Policy direction B still needs legal and Owner approval before any execution.
- The decision workbench honors available actions, uses explicit reasons and distinct applicant messages, and submits the displayed case revision. A stable key retries an unchanged action. A persisted decision receipt replaces the prior snapshot and distinguishes queued delivery from receipt by the applicant. The transactional outbox is unchanged.
- `/kyc` reads the authenticated applicant's own latest verification session. Expo continues using the same server session, outcome refresh and re-entry. Escalation describes specialist review. Verified status requires an authoritative backend decision. OCR and liveness provider gates remain off.
- For RX-05 use this route, `verificationAdminApi.ts`, the authoritative assessment and reason menu, and the proof/decision contract. Do not prefetch media or replicate the decision rules in the presentation layer.

## J1–J12 current evidence

| Journey | Evidence |
| --- | --- |
| J1 Create, upload and enter review | Embedded SQL and actual workflow services with synthetic OCR/storage. Browser opened the synthetic HTTP fixture queue. |
| J2 Non-document | Backend classification/decision tests verify extraction refusal and no approval. |
| J3 Quarantine | Backend policy checks and browser renders untrusted OCR as unverified. Real provider accuracy was outside authority. |
| J4 Corrections | Embedded database stores original observation and separate revised declaration and returns both in private review. |
| J5 Approve | Embedded database records approval and the same applicant's status advances to verified. Browser approval interaction covered by component tests. |
| J6 Resubmission | Chrome passed reviewer reauthentication, resubmission, queue movement and exact applicant message. Embedded SQL proves replacement uploads and reconfirmation on the same case. |
| J7 Rejection and escalation | Backend decision policy/route tests and native/web status assertions. Live device journey remains pending. |
| J8 Competition and replay | Embedded stale interleaving and atomic replay passed. Real separate connections blocked. |
| J9 Authorization boundaries | Actual HTTP routes with fixture store, and embedded SQL checks, cover no/expired session, wrong actor/case/operation, self-review, proof replay and applicant separation. |
| J10 Infrastructure failure | Embedded rollback and worker redelivery tests. Private-preview HTTP failure covered with synthetic storage. |
| J11 Native recovery | Native TypeScript, Vitest, request mapping and recovery script passed. Device runtime remains blocked. |
| J12 Retention | Existing cascade and private storage dependency remain separate from decision/audit immutability. Direction B requires approved rules for images, derived evidence, audit, outbox and backups. No deletion ran. |

Chrome used the production web bundle and identity routes with a loopback-only synthetic login, storage and database fixture. It verified keyboard opening, password dialog focus, front evidence preview, separate internal/applicant text, saved receipt and account status at 390 px. After correcting overflow, page and case dialog had no measured horizontal overflow at 360, 390, 768, 1280 or 1920 px. This is focused responsive and keyboard evidence. Full accessibility and load testing are pending.

## Reproduce on isolated infrastructure

1. Verify bundle/checksums and check out the exact candidate. Run `npm ci` with the tracked lockfile. No external provider credentials are needed for synthetic tests.
2. For the synthetic browser preview use the attached `browser-fixture.mjs`. Copy it to `backend/tests/.lr12-local-browser-fixture.mjs` and from repo root run `VITE_API_URL=http://127.0.0.1:5001/api npm run build --workspace=web` and `node backend/tests/.lr12-local-browser-fixture.mjs`. Open `http://127.0.0.1:5001/login?returnTo=%2Fadmin%2Fverification` and use the synthetic reviewer credentials declared in the fixture. In a separate signed-in applicant session, open `/kyc`. Use the fixture only on localhost and discard it after the test.
3. For actual PostgreSQL use a new disposable loopback database named `carup_idv_test_*`, with the roles and extensions listed in `backend/tests/integration/identity-confirmation-postgres.sh`. Set `CARUP_IDV_TEST_DISPOSABLE=yes` and the test-only `CARUP_IDV_TEST_DATABASE_URL`, then run that script. It applies the selected schema, checks grants, and invokes the independent-connection reviewer and proof tests. Local `initdb` failed at shared-memory allocation in this environment. Use a permitted PostgreSQL host independently of the native build.
4. For native UAT use locked dependencies, Java 17, compatible Android SDK and network access to Maven repositories. Generate and build the new-architecture Android debug app in an isolated build checkout. Install it on a test device and connect only to local synthetic CarUp. Check app relaunch, session expiry, camera permissions and recovery. iOS requires a separate device or permitted CoreSimulator.
5. For eventual cutover preserve the LR09 reviewer maintenance window. Apply both additive LR12 migrations before serving LR12 identity traffic. Quiesce old reviewer traffic before revoking the legacy RPC from any still-active LR07 or earlier instance. Verify current reviewer and applicant session clients, proof route/RPC, grants and private preview audit. Roll back by keeping review routes paused or returning to the last independently approved security-compatible build. Do not restore the non-atomic RPC or bypass step-up to reopen operations.

The isolated branch disables Vercel Git deployments in all three candidate configuration roots. The publication commit opts out of GitHub push/PR workflows. Runtime checks and releases require a separately authorized isolated execution context.

## Independent review

Review S01/S02 on the exact new head. Confirm role grants and function ownership on real PostgreSQL, atomic proof use, reviewer independence, error confidentiality, the authoritative audit/outbox transaction and coordinated cutover. Confirm the source reconstruction receipt and the new code diff. Return `ACCEPT / REMEDIATE / BLOCK` for exact-head source/security review. Device, retention and production authority remain distinct gates.

The inherited escrow tab-header assertion remains assigned to the existing Native Navigation / Phase 7C stability lane. Its script failure stays visible until that lane's corrected contract converges.
