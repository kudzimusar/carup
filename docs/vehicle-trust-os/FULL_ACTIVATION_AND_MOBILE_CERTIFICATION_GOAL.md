# Vehicle Trust OS — Full Activation and Mobile Certification

**Canonical reference:** `docs/vehicle-trust-os/FULL_ACTIVATION_AND_MOBILE_CERTIFICATION_GOAL.md`

**Starting point:** Vehicle Trust OS Differentiated MVP v1 is live on `main`. This document governs the next continuous delivery cycle.

/goal

Complete all internally controllable engineering required for:

1. live-capable ZIMRA, CVR, ZINARA, VID and CID connections;
2. licensed-insurer integration;
3. regulated-lender integration;
4. regulated real-money escrow integration;
5. Android and iOS physical-device certification of the native offline evidence workflow.

The result must be one coherent Vehicle Trust system using the existing vehicle passport, evidence provenance, OCR, fraud controls, dealer compliance, publication governance, eligibility framework, escrow state machine, Partner API, audit history, RLS and feature flags.

A missing contract, credential, institution endpoint, legal approval, regulated provider or physical iOS device may remain as a clearly named external activation gate. It must not be used to defer architecture, database work, provider contracts, APIs, operator workflows, simulators, security controls, documentation, staging deployment or automated tests.

/loop

Run continuously:

`DISCOVER → DESIGN → IMPLEMENT → MIGRATE → TEST → FIX → RETEST → COMMIT → PUSH → DEPLOY STAGING → UAT → FIX → REPEAT`

Use parallel agents where safe. Do not stop after planning, scaffolding, one provider or one test suite. Stop only for a genuine external dependency, a P0/P1 rollback decision, or the final owner-approved merge/production gate.

## Delivery rules

- Branch from current `main`.
- Preserve all live MVP behavior and fail-closed production defaults.
- Extend existing services and schemas; avoid broad rewrites.
- Use Supabase staging first. Production changes require a separate approved cutover.
- Agent workflow: branch → implement → test → commit → push → PR → staging evidence → stop before merge unless explicitly approved.
- Never store provider credentials, database passwords, webhook secrets or tokens in Git, application tables, logs or PR text.
- Never label sandbox, manual, partner-file, unavailable or no-record results as official clearance.

## Common provider platform

Create or harden a shared provider framework covering government sources, insurers, lenders and escrow providers.

Required capabilities:

- provider registry and activation status;
- capability type and jurisdiction;
- modes: not configured, contract pending, credential pending, sandbox, partner file, manual, pilot live, live, degraded, unavailable, suspended;
- versioned request/response contracts;
- secure credential references;
- correlation and idempotency keys;
- consent references where required;
- retries, timeout, rate limit, circuit breaker and dead-letter handling;
- signed webhooks and replay prevention;
- provider health and incident state;
- scheduled reconciliation;
- immutable request, result and activation history;
- global and provider kill switches;
- admin provider-health console;
- deterministic simulators for success, mismatch, no record, high risk, unavailable, timeout, rate limit, malformed payload, invalid signature, duplicate webhook and outage.

## Government sources

For ZIMRA, CVR, ZINARA, VID and CID:

1. create a provider dossier documenting verified transport options, required agreements, identifiers, expected fields, privacy/legal constraints, contacts and unresolved questions;
2. implement the best approved transport: official API, partner API, signed webhook, secure batch/file import or controlled manual verification;
3. map all responses into the existing source-verification contract;
4. preserve immutable provenance and mode labels;
5. feed identity conflicts and high-risk results into fraud/review/publication gates;
6. expose only safe buyer and Partner API projections;
7. add operator screens for health, imports, manual reviews, errors, suspension and emergency disable;
8. add contract, route, RLS, redaction and end-to-end tests.

Minimum semantics:

- ZIMRA: import/customs reference, declared identity, import date, duty/status category and mismatches where permitted.
- CVR: registration status, registered identity and privacy-safe ownership-verification state.
- ZINARA: licence status, expiry, identity match and permitted status category.
- VID: inspection/fitness status, test/expiry dates, result category and identity mismatch.
- CID: stolen/reported-interest status, query time, permitted reference, confidence and strict access logging.

Do not invent endpoints, permissions, credentials or provider facts.

## Insurance

Build a production-ready insurer onboarding and execution workflow:

- licensed-provider profile, products, regions, contract status and credential references;
- consent versioning and minimum-data projection;
- synchronous and asynchronous eligibility/quote states;
- eligible, conditional, manual review, declined, unavailable, expired and failed outcomes;
- provider references, conditions and validity;
- policy verification/expiry/cancellation only where supplied by the insurer;
- signed webhooks, replay protection, retries and reconciliation;
- admin support and provider-health workflows;
- strict separation of public vehicle facts from private underwriting data;
- provider simulator, contract tests and pilot activation checklist.

Never claim that a policy has been issued without confirmed provider evidence.

## Finance

Build a production-ready lender workflow:

- regulated-lender profile, products, eligibility rules, consent and retention terms;
- applicant consent and minimum approved data projection;
- trust, evidence, fraud, publication and dealer gate snapshots;
- potentially eligible, conditional, manual review, declined, unavailable, expired and failed states;
- asynchronous updates, provider references and decision validity;
- webhook security, retries and reconciliation;
- applicant deletion/retention controls;
- no applicant, affordability, income or credit data in public passport or general Partner API summaries;
- lender simulator, contract tests and pilot activation checklist.

## Real-money escrow

Extend the existing escrow state machine for a regulated provider:

- provider onboarding, jurisdiction, KYC/KYB requirements, currency, limits, fees and settlement terms;
- buyer, seller, dealer, listing and vehicle binding;
- idempotent transaction creation;
- funding, inspection, release, payout, cancellation, dispute, refund and reconciliation states;
- signed webhook and replay controls;
- immutable state transitions;
- transaction caps, pilot allowlist and kill switch;
- dual control for sensitive manual release/refund actions where required;
- reconciliation ledger and unmatched-event queue;
- explicit sandbox/live separation.

No real funds may move until the provider, contracts, KYC/AML process, settlement/reconciliation process and production credentials are approved.

## Native mobile physical-device certification

Validate release-grade builds, not only development clients.

Required coverage:

- at least two supported Android versions, including a lower-resource device;
- at least one supported iPhone/iOS combination;
- camera and file selection;
- multi-page evidence, rotation, glare, blur, large files and unsupported formats;
- permission denial/recovery;
- app-private storage;
- offline queue persistence after process termination/restart;
- background/foreground behavior;
- network loss during upload, retry and partial recovery;
- idempotency and duplicate prevention;
- low storage and low memory;
- account/tenant isolation and logout cleanup;
- slow, intermittent and offline networks;
- privacy-safe telemetry;
- exact device/OS matrix, results, defects, screenshots/traces and limitations.

If physical iOS hardware or signing access is unavailable, finish all code and simulator work and record that one exact external certification gate. Do not claim physical iOS certification passed.

## Database, storage and security

Create additive, reversible migrations as needed for:

- provider registry and contract versions;
- request attempts, provider health and incidents;
- consent records;
- insurer/lender/escrow configuration and decisions;
- KYC/KYB states;
- reconciliation jobs and mismatches;
- activation/suspension history;
- mobile certification runs, devices and results.

Every migration must include Up/Down markers, indexed foreign keys, tenant ownership, RLS, least-privilege grants, idempotency/uniqueness constraints and append-only guards for decisions or money-related history.

Use private Supabase Storage buckets for batch files, reconciliation artifacts, KYC/KYB documents, dispute evidence and certification artifacts. Require signed short-lived access, tenant/provider scoping, checksums, type/size controls and retention policies.

Verify credential rotation, webhook rotation, SSRF protection, outbound endpoint allowlisting, schema validation, payload limits, redaction, RLS, storage policies, rate limits, secret scans and incident runbooks.

## Integrated acceptance journey

Create one deterministic deployed-staging journey proving:

1. all source and financial provider configurations can be onboarded without exposing secrets;
2. mobile captures evidence offline and uploads exactly once after reconnect;
3. OCR/provenance complete;
4. source adapters return mixed match, unavailable, mismatch and high-risk results with honest labels;
5. conflicts create fraud and human review;
6. dealer and publication gates work;
7. insurer returns conditional eligibility;
8. lender returns manual review;
9. escrow creates a provider-test transaction and follows signed events;
10. reconciliation succeeds and a mismatch enters review;
11. buyer and partner responses are correctly redacted;
12. cross-user and cross-tenant access fail;
13. append-only audit is complete;
14. provider kill switches stop new calls without corrupting history;
15. no simulator value appears as live official data.

Run full backend, web, Partner API, mobile, migration, RLS, storage, webhook, reconciliation, Playwright, type, build, lint and secret-scan suites. Add load/resilience tests for rate limits, concurrent idempotency, webhook bursts, outages, queue backlogs, large uploads and recovery.

## Required repository artifacts

Store deliverables under:

- `docs/vehicle-trust-os/providers/`
- `docs/vehicle-trust-os/mobile-certification/`
- `docs/vehicle-trust-os/security/`
- `docs/vehicle-trust-os/release/`

Required documents:

- provider architecture and onboarding runbook;
- separate ZIMRA/CVR/ZINARA/VID/CID dossiers;
- insurer, lender and escrow activation packages;
- OpenAPI/contract updates;
- migration and RLS/storage matrices;
- threat model and incident runbooks;
- webhook/reconciliation runbook;
- mobile certification plan and final report;
- integrated UAT report;
- final activation-readiness and rollback report.

## Completion classification

For every provider report exactly one state:

- `ENGINEERING_COMPLETE_AND_LIVE`
- `ENGINEERING_COMPLETE_PILOT_READY`
- `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED`
- `ENGINEERING_COMPLETE_CREDENTIAL_REQUIRED`
- `INCOMPLETE_SPECIFIC_DEFECT`

The final PR must include the final SHA, migrations and hashes, provider matrix, device matrix, exact test totals, staging evidence, defects fixed, P0/P1 count, external gates, kill switches and rollback plan.

Final status must be exactly one:

`VEHICLE TRUST OS FULL ACTIVATION ENGINEERING COMPLETE — STAGING GREEN; EXTERNAL PROVIDER ACTIVATIONS CLEARLY GATED`

or

`VEHICLE TRUST OS FULL ACTIVATION BLOCKED — SPECIFIC INTERNAL ENGINEERING DEFECTS REMAIN`
