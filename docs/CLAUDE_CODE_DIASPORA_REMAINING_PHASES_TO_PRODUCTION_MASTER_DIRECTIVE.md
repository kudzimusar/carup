# Claude Code Master Directive — CarUp Diaspora Trade OS Remaining Phases to Production

> **Canonical repository path:** `docs/CLAUDE_CODE_DIASPORA_REMAINING_PHASES_TO_PRODUCTION_MASTER_DIRECTIVE.md`
>
> **Directive branch link:** `https://github.com/kudzimusar/carup/blob/docs/claude-diaspora-remaining-phases-production-directive/docs/CLAUDE_CODE_DIASPORA_REMAINING_PHASES_TO_PRODUCTION_MASTER_DIRECTIVE.md`
>
> **Permanent main link after merge:** `https://github.com/kudzimusar/carup/blob/main/docs/CLAUDE_CODE_DIASPORA_REMAINING_PHASES_TO_PRODUCTION_MASTER_DIRECTIVE.md`
>
> **Repository:** `https://github.com/kudzimusar/carup`

---

## 1. Repository-First Directive Rule

This document establishes the execution rule for this program and future large CarUp feature programs:

1. The full implementation contract must live in the repository under `docs/`.
2. Chat instructions are only launchers and must point to the repository directive.
3. Agents must read the repository directive in full before changing code.
4. Every material assumption, security rule, status transition, schema requirement, test gate, external dependency, stop condition, and final acceptance criterion must be written in the repository directive.
5. Long-running agents must maintain repository progress and handoff documents so another agent can resume without reconstructing context from chat history.
6. No agent may claim completion based only on a short chat prompt, green build, mocked UI, or local test summary.
7. The repository directive is canonical when the chat launcher and implementation behavior differ.
8. The directive must remain accessible by branch link during implementation and by main-branch link after merge.

This rule is mandatory for the remaining Diaspora Trade OS program.

---

## 2. Mandate

You are Claude Code orchestrating multiple agents to complete the remaining CarUp Diaspora Trade OS implementation in one sustained program.

The program must cover:

- completion and release-readiness of the existing Phases 3–7 work;
- the unfinished full workbook/XLSX contract;
- live Google Drive activation architecture and truthful external activation handling;
- **Phase 8 — Subscription Gate**;
- **Phase 9 — SafeTrade**;
- **Phase 10 — Trade Graph Intelligence**;
- complete cross-phase security, test, staging, release, and production-readiness gates.

The goal is not to create disconnected dashboards or speculative documents. The goal is to produce a coherent, database-backed, tenant-safe, auditable, test-proven operating system that can move through controlled production release.

Do not merge any production PR without explicit user approval. Do not touch production Supabase without explicit release authorization.

---

## 3. Product North Star

CarUp must become the operating system for diaspora vehicle and auto-parts trade.

The finished system must allow:

- buyers to request vehicles and parts;
- suppliers to publish verified, export-ready stock;
- sellers to quote against buyer demand;
- stock to move only through an immutable ledger;
- shared container capacity to be reserved safely;
- workbook users to work online and offline without losing data integrity;
- subscriptions to control feature access and usage limits;
- SafeTrade to coordinate payment, compliance, shipment, dispute, and delivery gates;
- trade relationships to form a queryable graph;
- AI to explain, recommend, and prepare actions without bypassing authorization;
- every critical operation to be authenticated, role-authorized, tenant-scoped, idempotent, auditable, and reversible where the lifecycle permits.

A successful program must preserve this goal across every agent and milestone.

---

## 4. Verified Starting Position

Before implementation, verify repository truth. The latest known state at the time this directive was created is:

### Main

- Current known `main` SHA: `c25b09499a01c21da566ddea2e4ca331fd5e0b77`.
- Phase 2C JSON workbook intake and dry-run UI is already on main.

### Existing Phases 3–7 program

- Draft PR: `#81`
- PR URL: `https://github.com/kudzimusar/carup/pull/81`
- Branch: `claude/diaspora-phases-3-7-program`
- Latest known head: `9959274e3564ff624b0e876d81e9cbea2b2d92fa`
- PR remains draft and unmerged.
- Phase 3–7 feature breadth is implemented.
- Atomic stock, quote acceptance, and container approval RPCs are implemented.
- Explicit Phase 3–7 route authorization is implemented.
- Critical/best-effort audit classification is implemented.
- OAuth state expiry and replay protection are implemented.
- CI workflow exists and has passed core jobs.
- Phase 7 is correctly classified as scaffold/mock-complete; live Google operations remain unimplemented.

### Known unresolved gates from PR #81

- Real H9 staging concurrency/smoke evidence must be confirmed from logs, not inferred from a green skipped job.
- H10 final readiness and formal review remain incomplete.
- PR #81 must be reviewed and merged before its production release.
- A pre-existing production database credential leak in historical scripts must be remediated before production launch.
- Production Supabase remains forbidden without explicit release authorization.

### Existing staging project

```text
eoyenigwevnxwwhyhaer
```

### Forbidden production project until explicit release authorization

```text
vhmnajoeicasaigiophh
```

### Existing unrelated local state

- `stash@{0}` is unrelated and must remain unapplied/unpopped.
- Known untracked `*.exit` and `*.txt` artifacts must remain unstaged.
- Navigation Intelligence, Vehicle Evidence, Mobile Identity, and PartSentry remain separate workstreams.

Agents must re-verify all of the above before acting.

---

## 5. Program Scope

### 5.1 Mandatory scope

This program includes:

1. **Release Gate R0 — Finish Phases 3–7 H9/H10 and merge-readiness**
2. **Completion Track W — Full XLSX workbook import/export contract**
3. **Completion Track D — Live Google Drive provider implementation or explicit activation-ready boundary**
4. **Phase 8 — Subscription Gate**
5. **Phase 9 — SafeTrade**
6. **Phase 10 — Trade Graph Intelligence**
7. **Production Readiness Gate P — security, data, observability, release, rollback, and smoke validation**

### 5.2 Explicitly outside automatic activation

Do not automatically:

- move real money;
- release real escrow;
- approve real compliance;
- mark real customs clearance;
- mark real delivery;
- write real reputation outcomes;
- activate real Google OAuth credentials;
- mutate production Supabase;
- merge a production PR.

The code, state machines, provider interfaces, manual gates, sandbox adapters, and tests may be completed. Live external activation requires explicit user approval and credentials.

### 5.3 Workstream isolation

Do not modify:

- Navigation Intelligence;
- Vehicle Evidence;
- Mobile Identity;
- PartSentry;
- unrelated marketplace redesigns;
- unrelated mobile work;
- unrelated Vercel projects;
- unrelated historical stashes.

---

## 6. Session Control: `/goal` and `/loop`

### 6.1 Goal

Set the session goal exactly when the environment supports `/goal`:

```text
/goal Complete the remaining CarUp Diaspora Trade OS program from the current Phases 3–7 draft through production readiness: finish H9/H10 release proof; implement truthful XLSX workbook import/export; implement or activation-harden live Google Drive; implement Phase 8 subscription entitlements and quotas; implement Phase 9 SafeTrade payment/compliance/shipment/dispute gates without unauthorized real-money automation; implement Phase 10 Trade Graph Intelligence with explainable AI-ready queries; enforce tenant isolation, atomicity, idempotency, audit, privacy, and provider boundaries; run independent CI, staging integration, adversarial security review, migration validation, and production release rehearsal; maintain milestone commits and durable progress docs; do not stop for routine engineering work; do not merge or touch production without explicit approval.
```

### 6.2 Loop

Set the execution loop exactly when the environment supports `/loop`:

```text
/loop For the active program milestone: read the canonical directive and progress ledger; inspect current code, schema, tests, and external boundaries; assign non-overlapping work to specialist agents; implement the smallest complete database-to-API-to-UI vertical slice; add authorization, tenant, idempotency, rollback, failure, concurrency, accessibility, and E2E tests; run focused checks; reconcile shared files through the integration agent; commit and push; update progress, risk, and handoff documents; reassess dependencies; continue to the next milestone. Stop only for explicit production authorization, real-money provider activation, live OAuth credentials, destructive migration approval, paid external infrastructure, or an unresolved product/security decision that cannot be inferred safely.
```

If `/goal` or `/loop` do not exist, reproduce the same behavior manually and do not stop between routine subtasks.

---

## 7. Multi-Agent Operating Model

Use multiple agents, but maintain one integration owner.

### 7.1 Agent roles

#### Agent A — Program Integrator

Owns:

- branch strategy;
- shared-file integration;
- conflict resolution;
- migration ordering;
- final CI and release gates;
- PR body and progress ledger;
- status accuracy.

Only Agent A may merge changes into the program branch.

#### Agent B — Release Gate and Security

Owns:

- PR #81 H9/H10 verification;
- credential incident remediation plan;
- authorization review;
- secret scanning;
- CI gates;
- production readiness checklist.

#### Agent C — Workbook/XLSX and Drive

Owns:

- XLSX parsing/generation;
- template preservation;
- workbook export;
- Drive provider implementation;
- OAuth/token-vault integration boundaries;
- workbook-to-Drive flow.

#### Agent D — Phase 8 Entitlements

Owns:

- subscription plans;
- entitlements;
- quotas;
- usage metering;
- billing-provider abstraction;
- entitlement UI and tests.

#### Agent E — Phase 9 SafeTrade

Owns:

- transaction assurance state machine;
- payment milestones;
- compliance/shipment gates;
- dispute flow;
- delivery confirmation;
- manual review controls;
- sandbox payment-provider integration.

#### Agent F — Phase 10 Trade Graph

Owns:

- graph event model;
- edge derivation;
- snapshots/materialized views;
- explainable graph queries;
- intelligence dashboards;
- AI-ready read interfaces.

#### Agent G — Frontend, Accessibility, and E2E

Owns:

- route/page integration;
- responsive UI;
- accessibility;
- error/loading/empty states;
- Playwright and contract tests;
- visual regression evidence where practical.

### 7.2 Shared-file ownership

The following files are integration-owned and must not be edited concurrently by specialist agents:

```text
backend/routes/diasporaRoutes.js
web/src/App.tsx
web/src/config/featureRegistry.ts
web/src/hooks/useCarUpApi.ts
web/src/types/index.ts
package.json
package-lock.json
.github/workflows/*
docs/DIASPORA_REMAINING_PHASES_PROGRESS.md
docs/CARUP_WORKSTREAM_SEPARATION_AND_HANDOFF.md
```

Specialist agents should provide isolated commits or patches. Agent A integrates shared files serially.

### 7.3 Worktrees and branches

Use worktrees or isolated branches per agent. Suggested names:

```text
claude/diaspora-r0-release-gates
claude/diaspora-workbook-drive-completion
claude/diaspora-phase8-entitlements
claude/diaspora-phase9-safetrade
claude/diaspora-phase10-trade-graph
claude/diaspora-e2e-production-readiness
```

Do not let agents commit directly to `main`.

---

## 8. Program Branch and PR Strategy

### 8.1 If PR #81 is still unmerged

Create the new program branch from the latest PR #81 head:

```text
claude/diaspora-phases-8-10-production-program
```

Open a **stacked draft PR** targeting:

```text
claude/diaspora-phases-3-7-program
```

This allows the remaining program to proceed without waiting for PR #81 to merge.

After PR #81 is approved and merged:

1. fetch latest main;
2. rebase or merge main carefully;
3. prove no unrelated changes were lost;
4. retarget the stacked PR to `main`;
5. rerun all acceptance checks.

### 8.2 If PR #81 is already merged

Create the program branch from current `origin/main` and open a draft PR to `main`.

### 8.3 PR policy

- Open the draft PR after discovery and baseline documents are committed.
- Keep milestone commits coherent.
- Push after each verified milestone.
- Do not merge automatically.
- Stop before final merge and production migration activation.

---

## 9. Durable Program Documents

Create and maintain:

```text
docs/DIASPORA_REMAINING_PHASES_DISCOVERY.md
docs/DIASPORA_REMAINING_PHASES_PROGRESS.md
docs/DIASPORA_REMAINING_PHASES_RISK_REGISTER.md
docs/DIASPORA_PRODUCTION_READINESS_MATRIX.md
docs/DIASPORA_PRODUCTION_RELEASE_RUNBOOK.md
docs/DIASPORA_PRODUCTION_ROLLBACK_RUNBOOK.md
```

The progress ledger must record for every milestone:

- objective;
- assigned agent;
- repository findings;
- schema findings;
- files changed;
- migrations;
- routes;
- UI routes;
- security decisions;
- tests;
- CI run IDs;
- staging evidence;
- known limitations;
- blockers;
- commit SHA;
- next milestone.

No agent may rely on hidden chat memory for program state.

---

# RELEASE GATE R0 — COMPLETE PHASES 3–7 RELEASE READINESS

## 10. R0 Objective

Before treating Phases 3–7 as a stable dependency, prove their hardening and release state.

## 10.1 Required verification

Confirm from actual logs and database evidence:

- H9 staging stock concurrency test ran rather than skipped;
- H9 concurrent quote acceptance test ran;
- H9 concurrent container approval test ran;
- cleanup completed;
- service-role RPC grants are applied;
- staging migration history matches repository migration sources;
- CI run is green;
- Vercel preview is green;
- no unresolved review threads remain;
- PR #81 documentation reflects the true state.

## 10.2 Green-but-skipped rule

A job that exits zero because secrets are unavailable is not integration proof.

Record separately:

- `PASSED`;
- `FAILED`;
- `SKIPPED — SECRET UNAVAILABLE`;
- `NOT RUN`.

Never collapse these states into one green status.

## 10.3 Credential incident

Before public production:

- identify all committed production database credentials;
- rotate affected credentials;
- replace hardcoded values with environment variables;
- purge secrets from Git history using an approved procedure;
- force collaborators to refresh clones if history is rewritten;
- verify no deployment still uses revoked credentials;
- document incident closure;
- expand secret scanning to include the remediated paths.

Do not expose secret values in logs or reports.

## 10.4 R0 Definition of Done

R0 is complete only when PR #81 is either:

- merged with all required evidence; or
- explicitly accepted as a reviewed dependency for the stacked program branch.

No production activation occurs in R0 without approval.

---

# COMPLETION TRACK W — FULL XLSX WORKBOOK CONTRACT

## 11. Objective

Complete the original workbook vision beyond JSON-only intake.

Users must be able to:

- download role-appropriate `.xlsx` templates;
- edit offline;
- upload `.xlsx` files;
- preserve IDs, validations, and protected reference data;
- run dry-run validation;
- review accepted/rejected/warning rows;
- confirm an authorized import;
- export current database state to `.xlsx`;
- save supported exports to Drive when Drive is activated.

## 12. Dependency decision

Inspect current dependencies first. Select an actively maintained XLSX library only when necessary.

The dependency must support:

- reading and writing XLSX;
- multiple sheets;
- dates and numeric cells;
- formulas or preserved formula text where relevant;
- data validation where feasible;
- cell protection and hidden reference sheets where feasible;
- streaming or bounded-memory processing for large files;
- acceptable license and security posture.

Document the dependency decision and alternatives.

## 13. Template types

At minimum provide:

- buyer request/order template;
- seller stock template;
- supplier supply-document template;
- enterprise combined template;
- container reservation template where consistent with product policy.

Templates must include:

- schema version;
- template type;
- generated-at timestamp;
- tenant/user context where safe;
- required columns;
- stable field keys;
- human-readable help text;
- validation lists;
- protected reference sheets;
- status allowlists;
- currency/date/quantity formats;
- example rows clearly marked as examples;
- import instructions;
- privacy warning;
- unique row identifiers where required.

## 14. Upload and parsing

Implement bounded upload handling:

- MIME and extension validation;
- maximum size;
- maximum sheet count;
- maximum row count;
- maximum cell count;
- zip-bomb protections where supported;
- formula injection protection on exports;
- safe filename normalization;
- malware-scan hook;
- timeout and memory limits;
- deterministic date parsing;
- duplicate row detection;
- schema version compatibility;
- unknown-sheet handling;
- missing-sheet handling;
- cell-level diagnostics.

Never trust spreadsheet formulas or macros.

Reject `.xlsm` unless a deliberate safe policy is implemented.

## 15. Dry-run and import

Reuse the existing batch/row diagnostic framework.

Dry-run must show:

- accepted rows;
- rejected rows;
- warning rows;
- duplicates;
- invalid statuses;
- invalid dates;
- invalid quantities;
- missing references;
- permission conflicts;
- entitlement conflicts;
- actions requiring confirmation;
- actions requiring reviewer approval;
- proposed ledger effects;
- proposed order/quote/container effects.

Import must:

- require current user confirmation;
- revalidate authorization and entitlement;
- revalidate current database state;
- use idempotency keys;
- use atomic domain services/RPCs;
- never directly overwrite stock;
- never bypass SafeTrade or compliance gates;
- record import and audit results;
- support safe retry planning;
- provide rollback planning where reversible.

## 16. Export

Export current online state into role-appropriate workbooks.

Requirements:

- export only authorized data;
- redact private fields;
- preserve stable IDs needed for round-trip updates;
- escape formula-leading strings;
- include export timestamp and schema version;
- include read-only audit/reference sheets where appropriate;
- chunk or stream large exports;
- log export event;
- support Drive save after provider activation.

## 17. Workbook tests

Tests must cover:

- generated workbook opens successfully;
- expected sheets and columns exist;
- validation lists exist where supported;
- protected sheets are configured where supported;
- round-trip export/import preserves identifiers;
- invalid workbook type rejected;
- oversized workbook rejected;
- unknown schema version rejected or migrated explicitly;
- duplicate rows detected;
- formula injection neutralized;
- unauthorized template denied;
- entitlement limits enforced;
- dry-run writes no live records;
- confirmed import uses domain services;
- retry is idempotent;
- JSON Phase 2C regression remains green.

---

# COMPLETION TRACK D — LIVE GOOGLE DRIVE

## 18. Objective

Move from scaffold/mock-complete to a secure, truthful Google Drive integration, or establish a production-disabled activation-ready boundary when credentials are unavailable.

## 19. Provider implementation

Implement through the provider abstraction:

- authorization URL;
- code exchange;
- access-token refresh;
- revocation;
- root and child folder creation;
- file upload;
- file update;
- metadata retrieval;
- download/export where authorized;
- provider error normalization;
- rate-limit/retry handling;
- revoked-token recovery.

## 20. Credential storage

Do not store plaintext access or refresh tokens in application tables.

Use the project's approved secret-vault or encrypted credential mechanism.

If no approved mechanism exists:

- create an interface and activation blocker;
- fail closed in production;
- document the security decision required;
- do not invent weak encryption with a hardcoded key.

## 21. OAuth security

Preserve and test:

- signed state;
- user and tenant binding;
- issued-at and expiry;
- one-time nonce;
- replay rejection;
- production state secret requirement;
- minimum `drive.file` scope;
- no tokens in logs, URLs beyond provider callback requirements, frontend state, or API responses.

Add PKCE if compatible with the chosen server-side OAuth design.

## 22. Folder and ownership model

Use the approved structure:

```text
CarUp Trade/
  Buyer Orders/
  Seller Stock/
  Import Documents/
  Export Documents/
  Invoices/
  Bills of Lading/
  Compliance/
  Payment Proof/
  Completed Orders/
```

Every file metadata record must bind to:

- user;
- tenant;
- provider connection;
- linked entity type;
- linked entity ID;
- checksum;
- sync status;
- last synced timestamp;
- audit event.

## 23. Drive activation states

UI and API must distinguish:

- disabled;
- not configured;
- configured but not connected;
- connected;
- expired;
- revoked;
- error;
- mock/test only;
- live provider active.

No mock URL may be emitted in production.

## 24. Drive tests

Tests must cover:

- minimum scopes;
- state expiry;
- state replay;
- cross-user callback rejection;
- token redaction;
- revoked access;
- refresh path;
- upload idempotency;
- folder reuse;
- file metadata tenant isolation;
- provider 429 retry policy;
- provider error sanitization;
- disconnect cleanup;
- production mock prohibition;
- workbook export-to-Drive flow;
- live sandbox E2E when credentials are explicitly provided.

---

# PHASE 8 — SUBSCRIPTION GATE

## 25. Phase 8 Objective

Every protected Diaspora Trade operation must enforce the user's subscription plan, entitlement, quota, and current subscription state in addition to authentication, role, tenant, and ownership.

## 26. Discovery requirements

Before schema changes, inspect:

- existing subscription tables;
- payment/billing services;
- plan/product definitions;
- webhook handlers;
- feature registry;
- user/tenant models;
- existing entitlement utilities;
- existing marketplace monetization logic;
- current provider configuration.

Do not create duplicate subscription systems when reusable infrastructure exists.

## 27. Plan model

Support a configurable plan catalog. Initial conceptual plans may include:

### Free / Explorer

- browse limited public listings;
- limited buyer requests;
- no bulk workbook import;
- no seller publication;
- no API access;
- no Drive sync;
- no advanced AI execution.

### Diaspora Buyer

- buyer requests;
- RFQ participation;
- quote comparison;
- order passport;
- limited workbook download/upload;
- container reservation;
- SafeTrade participation when available.

### Seller / Supplier

- stock manager;
- supply documents;
- quote responses;
- seller workbook;
- inventory limits;
- export readiness;
- Drive sync when included.

### Trade Pro

- higher quotas;
- buyer and seller capabilities;
- AI command center;
- advanced exports;
- multiple users or locations where defined;
- priority support hooks.

### Enterprise Partner

- tenant administration;
- bulk import/export;
- API access;
- high quotas;
- multiple workspaces;
- audit export;
- custom integrations;
- service-account controls where approved.

Plan names and prices must be configuration-driven, not hardcoded throughout the codebase.

## 28. Subscription lifecycle

Support states such as:

- trialing;
- active;
- past_due;
- grace_period;
- paused;
- cancelled;
- expired;
- incomplete;
- suspended.

Define exact behavior for every state.

No frontend-only access decisions.

## 29. Entitlement model

Create a canonical entitlement registry.

Example feature keys:

```text
diaspora.workbook.download
diaspora.workbook.upload
diaspora.workbook.bulk_import
diaspora.stock.create
diaspora.stock.publish
diaspora.stock.max_items
diaspora.rfq.create
diaspora.rfq.respond
diaspora.rfq.max_open
diaspora.ai.parse
diaspora.ai.execute_medium
diaspora.container.reserve
diaspora.container.manage
diaspora.drive.connect
diaspora.drive.export
diaspora.api.access
diaspora.audit.export
diaspora.safetrade.create
diaspora.graph.advanced
```

An entitlement may be:

- boolean;
- integer quota;
- date-limited;
- tenant-wide;
- user-specific;
- feature-flag dependent.

## 30. Usage metering and quotas

Meter operations such as:

- active stock items;
- open RFQs;
- monthly workbook imports;
- monthly exports;
- AI commands;
- Drive uploads;
- API calls;
- active team members;
- stored document volume;
- container reservations.

Requirements:

- atomic quota consumption;
- idempotency;
- billing-period boundaries;
- no double counting on retry;
- safe rollback when the domain operation fails;
- tenant and user attribution;
- auditability;
- usage display in UI.

## 31. Entitlement service

Create or extend:

```text
backend/services/diaspora/diasporaEntitlementService.js
```

Required functions:

- resolve current subscription;
- resolve effective entitlements;
- check feature;
- check quota;
- reserve usage atomically;
- commit/release usage reservation;
- explain denial;
- support admin override with audit;
- support cached reads without stale authorization risk.

Every protected Phase 2–10 operation must call the entitlement layer server-side.

## 32. Billing provider abstraction

Do not couple domain code directly to one billing provider.

Create an adapter for:

- checkout/session creation;
- customer portal;
- subscription sync;
- webhook verification;
- invoice/payment state;
- cancellation;
- plan change;
- trial handling.

If no live provider is approved, implement a sandbox/manual provider and keep production billing activation disabled.

## 33. Phase 8 API

Suggested capabilities:

```text
GET  /api/diaspora/subscription/plans
GET  /api/diaspora/subscription/status
GET  /api/diaspora/subscription/entitlements
GET  /api/diaspora/subscription/usage
POST /api/diaspora/subscription/checkout
POST /api/diaspora/subscription/portal
POST /api/diaspora/subscription/change-plan
POST /api/diaspora/subscription/cancel
POST /api/diaspora/subscription/webhook
```

Provider webhooks must:

- verify signatures;
- be idempotent;
- preserve event history;
- reject stale/replayed events;
- map provider states to canonical states;
- never trust client-submitted subscription status.

## 34. Phase 8 frontend

Create or extend:

- plan comparison;
- current subscription status;
- usage and quota dashboard;
- upgrade/downgrade flow;
- billing portal action;
- grace/past-due warnings;
- feature-lock explanations;
- enterprise-contact path;
- admin entitlement override visibility;
- accessible disabled states.

Do not hide server-denied operations without explaining the required plan.

## 35. Phase 8 tests

Prove:

- free user blocked from seller stock creation;
- free user blocked from bulk workbook import;
- buyer plan can create buyer RFQ but cannot publish seller stock;
- seller plan can publish stock and quote but cannot use enterprise API;
- Trade Pro receives configured higher quotas;
- enterprise plan receives bulk/API entitlement;
- expired/cancelled/past-due behavior matches policy;
- quota consumption is atomic and idempotent;
- failed domain action does not consume quota permanently;
- webhook signature and replay protections work;
- cross-tenant subscription leakage is impossible;
- admin override is audited;
- frontend displays accurate denial and usage state.

## 36. Phase 8 Definition of Done

Phase 8 is complete when every Diaspora feature has a documented entitlement, server enforcement, quota behavior, tests, UI explanation, and provider-independent subscription state.

Live billing is production-ready only after approved provider credentials and webhook E2E verification.

---

# PHASE 9 — SAFETRADE

## 37. Phase 9 Objective

Implement CarUp SafeTrade as a rule-driven trade assurance layer connecting:

- verified participants;
- verified stock;
- quote terms;
- payment milestones;
- compliance state;
- documents;
- shipment milestones;
- disputes;
- delivery confirmation;
- reputation eligibility.

SafeTrade must never release money merely because a frontend button was clicked.

## 38. SafeTrade transaction model

Create a canonical SafeTrade transaction linked to:

- buyer order;
- accepted quote;
- buyer;
- seller;
- tenant;
- stock reservation;
- payment milestones;
- compliance reviews;
- shipment/container records;
- required documents;
- dispute state;
- delivery confirmation;
- audit timeline.

## 39. State machine

Define explicit states, for example:

```text
DRAFT
ELIGIBILITY_PENDING
AWAITING_BUYER_COMMITMENT
AWAITING_SELLER_COMMITMENT
PAYMENT_PENDING
PAYMENT_HELD
DOCUMENTS_PENDING
COMPLIANCE_REVIEW
READY_FOR_SHIPMENT
IN_TRANSIT
ARRIVED
DELIVERY_CONFIRMATION_PENDING
COMPLETED
DISPUTED
SUSPENDED
CANCELLED
REFUND_PENDING
REFUNDED
```

Do not use these exact values blindly if existing statuses should be reused. Produce a reviewed transition table.

Every transition must define:

- source states;
- target state;
- actor roles;
- required entitlements;
- required verification;
- payment conditions;
- document conditions;
- compliance conditions;
- shipment conditions;
- dispute restrictions;
- audit event;
- notification event;
- idempotency behavior;
- rollback/remediation behavior.

## 40. Eligibility engine

Before SafeTrade activation, verify:

- authenticated buyer;
- authenticated seller;
- active subscription entitlements;
- verified identities according to policy;
- accepted quote;
- valid stock reservation;
- required stock verification;
- required documents;
- no sanctions/suspension flags;
- supported currency/country/provider;
- no active conflicting SafeTrade transaction.

Return explainable blockers.

## 41. Payment milestones

Support configurable milestones such as:

- buyer commitment/deposit;
- seller procurement readiness;
- export-document approval;
- container loading;
- shipment departure;
- border/customs event;
- delivery confirmation;
- final release.

Each milestone must have:

- amount or percentage;
- currency;
- payer;
- payee;
- due trigger;
- release trigger;
- hold reason;
- evidence/document requirements;
- status;
- provider reference;
- idempotency key;
- audit trail.

Validate that milestone totals match transaction totals within currency precision rules.

## 42. Payment provider abstraction

Create a provider interface supporting:

- create payment intent;
- authorize/hold;
- capture/release;
- refund;
- partial refund where supported;
- cancel;
- retrieve status;
- verify webhook;
- reconcile event.

Use a sandbox/fake provider for tests.

Real money operations require:

- approved provider;
- credentials;
- legal/compliance decision;
- currency/country support;
- webhook verification;
- authorized E2E;
- explicit production activation.

Until then, production release actions must fail closed or require manual external confirmation without falsely claiming escrow.

## 43. Release policy engine

A release decision must evaluate current authoritative state.

Examples:

- payment exists and is held;
- required compliance checks approved;
- required documents verified;
- stock/vehicle evidence valid;
- shipment milestone reached;
- no active dispute;
- no fraud/security hold;
- actor authorized;
- entitlement active;
- provider event reconciled;
- idempotency key unused.

The engine must return:

- eligible boolean;
- blockers;
- evidence references;
- policy version;
- evaluated timestamp.

High-risk release must require reviewer/admin approval even when automated conditions pass, unless future policy explicitly authorizes automation.

## 44. Compliance and document gates

Integrate with existing compliance/document services.

Do not duplicate verification state.

Requirements:

- required-document matrix by transaction type;
- expired-document detection;
- rejected/flagged document blocks;
- government/compliance review state;
- reviewer identity;
- evidence timestamps;
- no client-side override;
- policy-version tracking.

## 45. Shipment gates

Integrate container and shipment events.

Do not treat booking closure as delivery.

Distinguish:

- reserved;
- booked;
- loaded;
- departed;
- arrived;
- customs/border;
- out for delivery;
- delivered;
- buyer confirmed;
- disputed delivery.

Every event must carry source and evidence.

## 46. Dispute flow

Support:

- dispute creation;
- reason/category;
- linked transaction/milestone;
- evidence uploads;
- participant statements;
- reviewer assignment;
- status timeline;
- temporary payment hold;
- proposed resolution;
- approval;
- refund/release/cancellation outcome;
- appeal or reopen policy where approved;
- audit and notifications.

Tenant and participant privacy is mandatory.

## 47. Delivery confirmation and reputation eligibility

Delivery confirmation may include:

- buyer confirmation;
- signed delivery proof;
- courier/shipment evidence;
- timeout/escalation policy;
- dispute window.

Do not automatically create reputation merely from a status field.

Produce a reputation-eligibility event only after:

- transaction completion;
- dispute window handling;
- no fraud hold;
- participant eligibility.

Phase 10 or existing reputation services may consume this event.

## 48. SafeTrade API

Suggested capabilities:

```text
GET  /api/diaspora/safetrade
POST /api/diaspora/safetrade
GET  /api/diaspora/safetrade/:id
GET  /api/diaspora/safetrade/:id/timeline
GET  /api/diaspora/safetrade/:id/eligibility
POST /api/diaspora/safetrade/:id/commit
POST /api/diaspora/safetrade/:id/milestones
POST /api/diaspora/safetrade/:id/evaluate-release
POST /api/diaspora/safetrade/:id/request-release
POST /api/diaspora/safetrade/:id/approve-release
POST /api/diaspora/safetrade/:id/cancel
POST /api/diaspora/safetrade/:id/disputes
GET  /api/diaspora/safetrade/:id/disputes
POST /api/diaspora/disputes/:id/evidence
POST /api/diaspora/disputes/:id/resolve
POST /api/diaspora/safetrade/payment-webhook
```

Exact routes must follow repository conventions and avoid duplication.

## 49. SafeTrade frontend

Create or extend:

- SafeTrade dashboard;
- transaction detail;
- eligibility blockers;
- payment milestone timeline;
- compliance/document checklist;
- shipment timeline;
- release-request review;
- dispute center;
- evidence upload;
- delivery confirmation;
- manual-review queue;
- clear sandbox/not-live payment labels.

## 50. SafeTrade tests

Prove:

- unverified participant blocked;
- missing entitlement blocked;
- missing payment blocked;
- unpaid milestone blocks release;
- flagged compliance blocks release;
- missing document blocks release;
- active dispute blocks release;
- shipment stage insufficient blocks release;
- eligible transaction may request release;
- unauthorized actor cannot approve release;
- duplicate provider webhook is idempotent;
- duplicate release request is idempotent;
- provider failure leaves consistent state;
- audit failure rolls back critical transition;
- cross-tenant access denied;
- evidence private URLs protected;
- dispute hold works;
- refund/release sandbox behavior works;
- no real-money provider called without activation flag;
- no automatic reputation record written prematurely.

## 51. Phase 9 Definition of Done

Phase 9 is code-complete when SafeTrade state, policy evaluation, milestones, compliance/shipment gates, disputes, manual approvals, sandbox provider, audit, and UI are fully tested.

It is live-financial-production-ready only after legal/provider approval, credentials, sandbox certification, webhook E2E, reconciliation testing, and explicit production activation.

---

# PHASE 10 — TRADE GRAPH INTELLIGENCE

## 52. Phase 10 Objective

Build a queryable, explainable trade graph connecting the entities and events of the Diaspora Trade OS.

The graph must support operational intelligence without becoming a second source of truth.

Relational domain tables remain authoritative. Graph data is derived and rebuildable.

## 53. Graph entities

Include relevant nodes such as:

- user;
- tenant;
- trade profile;
- buyer;
- seller;
- stock item;
- supply document;
- buyer order;
- RFQ;
- quote;
- accepted quote;
- SafeTrade transaction;
- payment milestone;
- document;
- compliance review;
- container;
- reservation;
- shipment;
- dispute;
- delivery;
- reputation event;
- Drive file metadata;
- AI command;
- workbook batch.

## 54. Graph edges

Examples:

```text
BUYER_CREATED_ORDER
ORDER_REQUESTS_PART
SELLER_OWNS_STOCK
STOCK_MATCHES_ORDER
SELLER_SUBMITTED_QUOTE
ORDER_ACCEPTED_QUOTE
QUOTE_CREATED_SAFETRADE
SAFETRADE_HAS_MILESTONE
SAFETRADE_REQUIRES_DOCUMENT
DOCUMENT_VERIFIED_BY
ORDER_RESERVED_STOCK
ORDER_RESERVED_CONTAINER_SPACE
CONTAINER_CARRIES_ORDER
SHIPMENT_ADVANCED_TO_STAGE
DISPUTE_BLOCKS_RELEASE
DELIVERY_ELIGIBLE_FOR_REPUTATION
AI_COMMAND_PROPOSED_ACTION
WORKBOOK_BATCH_CREATED_RECORD
DRIVE_FILE_LINKS_ENTITY
```

Every edge must have:

- source node;
- target node;
- edge type;
- tenant;
- source event/reference;
- created timestamp;
- validity/current state;
- confidence when derived;
- policy/version metadata where relevant.

## 55. Event-driven derivation

Derive graph updates from domain events/outbox records.

Requirements:

- idempotent event consumption;
- replay support;
- dead-letter/error visibility;
- no lost events;
- rebuild command;
- versioned projection;
- tenant partitioning;
- audit correlation;
- no direct graph mutation by frontend or AI.

If the existing event bus/outbox can be reused, extend it rather than creating a second event system.

## 56. Storage decision

Inspect current Postgres capabilities before adding a graph database.

Preferred initial implementation:

- Postgres node/edge tables or derived views;
- indexed tenant/source/target/type columns;
- recursive CTEs where appropriate;
- materialized summaries for expensive dashboards;
- rebuildable snapshots.

A separate graph database requires explicit architecture approval, operational ownership, cost review, security review, and synchronization design.

## 57. Graph queries

Provide explainable queries such as:

- why was this seller matched to this order?;
- which stock can satisfy this demand?;
- what blocks this SafeTrade release?;
- which documents support this transaction?;
- which orders are exposed to the same risky supplier?;
- which containers are close to viable departure?;
- which stock is dead or repeatedly requested?;
- which buyers frequently request the same part?;
- which shipments or disputes affect seller performance?;
- what is the complete order-to-delivery path?;
- what actions were proposed by AI versus executed by users?;
- which records originated from a workbook import?;
- which entities lack required evidence?;

Every answer must include source references and reasons.

## 58. Intelligence services

Create or extend:

```text
backend/services/diaspora/diasporaTradeGraphService.js
backend/services/diaspora/diasporaTradeGraphProjectionService.js
backend/services/diaspora/diasporaTradeIntelligenceService.js
```

Capabilities:

- project event;
- rebuild tenant graph;
- query neighborhood;
- query transaction path;
- generate blocker summary;
- generate match explanation;
- calculate operational aggregates;
- provide AI-ready structured context;
- redact unauthorized/private nodes and edges.

## 59. AI boundary

AI may read authorized graph summaries and produce explanations or recommendations.

AI must not:

- create authoritative graph edges directly;
- change domain state;
- release payments;
- approve compliance;
- verify documents;
- complete shipments;
- create reputation outcomes.

AI output must reference graph evidence and confidence.

## 60. Graph API

Suggested capabilities:

```text
GET  /api/diaspora/trade-graph/entities/:type/:id
GET  /api/diaspora/trade-graph/entities/:type/:id/neighbors
GET  /api/diaspora/trade-graph/orders/:id/path
GET  /api/diaspora/trade-graph/orders/:id/blockers
GET  /api/diaspora/trade-graph/orders/:id/match-explanation
GET  /api/diaspora/trade-graph/containers/opportunities
GET  /api/diaspora/trade-graph/stock/demand-signals
GET  /api/diaspora/trade-graph/risk/exposure
POST /api/diaspora/trade-graph/rebuild
```

Rebuild must be admin-only, tenant-scoped, rate-limited, and auditable.

## 61. Graph frontend

Create or extend:

- trade intelligence dashboard;
- order relationship timeline;
- blocker panel;
- match explanation panel;
- container opportunity panel;
- demand signal panel;
- risk exposure panel;
- evidence/source drawer;
- freshness indicator;
- rebuild status for admins;
- accessible non-visual representation of graph relationships.

Do not require a complex canvas visualization to make the feature usable.

## 62. Graph tests

Prove:

- projection idempotency;
- event replay produces same graph;
- tenant isolation;
- deleted/revoked relationships handled;
- rebuild correctness;
- path query correctness;
- blocker explanation references authoritative records;
- match explanation deterministic for same inputs;
- stale projection indicated;
- unauthorized nodes redacted;
- AI context excludes private data;
- no graph write bypasses domain event source;
- large-tenant query performance within defined budgets;
- materialized summary refresh correctness;
- Phase 3–9 events generate expected nodes/edges.

## 63. Phase 10 Definition of Done

Phase 10 is complete when graph projections are rebuildable, tenant-safe, event-driven, explainable, queryable through API and UI, and covered by correctness and performance tests.

---

# CROSS-PHASE SECURITY AND QUALITY

## 64. Authentication and authorization

Every protected request must enforce:

- valid session;
- trusted server-derived role;
- tenant membership;
- ownership/participant relationship;
- subscription entitlement;
- quota availability;
- current lifecycle state;
- approval requirements;
- provider activation state.

Frontend guards are not security boundaries.

## 65. RLS and service-role boundaries

- Add RLS policies consistent with existing conventions.
- Restrict RPC execution to intended backend/service roles.
- Avoid broad `PUBLIC` grants.
- Set safe function `search_path`.
- Review `SECURITY DEFINER` carefully.
- Validate tenant inside functions.
- Run Supabase security advisors after staging changes.

## 66. Critical audit

Critical transitions must fail atomically when their required audit record cannot be written.

Critical examples include:

- quota consumption tied to domain action;
- SafeTrade release request/approval;
- payment/refund event reconciliation;
- compliance gate override;
- dispute resolution;
- graph rebuild request;
- production provider connection changes.

Best-effort telemetry must be named clearly and never described as guaranteed audit.

## 67. Idempotency

Require idempotency for:

- workbook imports;
- quota consumption;
- billing webhooks;
- payment-provider webhooks;
- SafeTrade creation;
- milestone payment actions;
- release/refund requests;
- dispute resolution;
- Drive upload/export;
- graph event projection;
- graph rebuild jobs.

Conflicting reuse of one key must be rejected.

## 68. Privacy and redaction

Review:

- PII;
- identity documents;
- payment references;
- addresses;
- private file paths;
- Drive metadata;
- graph edges revealing relationships;
- audit payloads;
- AI context.

Return only the minimum necessary information.

## 69. Upload security

For workbooks, evidence, dispute files, and documents:

- MIME verification;
- extension allowlist;
- size limits;
- signed URLs;
- malware scan hook;
- checksum;
- private storage;
- short-lived download URLs;
- authorization on every retrieval;
- no raw storage path exposure.

## 70. Rate limiting and abuse

Add or verify limits for:

- login/session;
- workbook upload;
- AI parse/execute;
- RFQ creation;
- quote spam;
- subscription checkout;
- payment webhooks;
- dispute creation;
- Drive sync;
- graph queries and rebuild.

## 71. Accessibility and responsiveness

All new UI must include:

- keyboard operation;
- accessible labels;
- error association;
- focus management;
- status announcements;
- mobile/tablet support;
- loading/empty/error states;
- no color-only meaning;
- reduced-motion handling where relevant.

---

# DATABASE AND MIGRATION PROGRAM

## 72. Migration rules

For every migration:

1. inspect current staging schema;
2. avoid duplicate structures;
3. use additive/backwards-compatible design where possible;
4. add indexes for tenant and lifecycle queries;
5. define constraints;
6. define RLS;
7. define grants;
8. provide down/remediation notes;
9. add tests/static validation;
10. apply only to authorized staging;
11. run advisors;
12. record migration version;
13. do not apply to production until release approval.

## 73. Expected schema areas

Potential additions or extensions:

- subscription plans;
- subscriptions;
- entitlements;
- usage meters/reservations;
- provider events;
- SafeTrade transactions;
- SafeTrade milestones;
- release evaluations;
- disputes;
- dispute evidence;
- payment provider events;
- OAuth credential references;
- workbook export jobs;
- graph nodes;
- graph edges;
- graph projection checkpoints;
- graph snapshots;
- intelligence summaries.

Do not create all structures blindly. Reuse existing tables where semantically correct.

---

# TESTING AND CI

## 74. Required test layers

### Unit/pure logic

- entitlement resolution;
- quota calculations;
- SafeTrade policy evaluation;
- milestone amount validation;
- graph projection rules;
- workbook mapping;
- provider error mapping.

### Service tests

- tenant/ownership;
- state transitions;
- idempotency;
- audit behavior;
- provider boundaries;
- cross-service rollback.

### Route tests

- explicit role allowlists;
- spoofed role rejection;
- subscription denial;
- quota denial;
- webhook authentication;
- error shape.

### Database integration

- atomic quota use;
- webhook replay;
- SafeTrade critical transitions;
- graph event idempotency;
- concurrent release/approval attempts;
- RLS and RPC grants.

### Playwright

Add focused specs for:

```text
subscriptions and quotas
workbook XLSX
live/disabled Drive states
SafeTrade transaction flow
SafeTrade dispute flow
Trade Graph dashboard
Phase 2C regression
Phases 3–7 regression
```

### Performance

Test:

- large workbook parse/export;
- quota checks under load;
- graph neighborhood/path queries;
- event projection backlog;
- SafeTrade dashboard queries;
- webhook bursts.

## 75. CI workflows

Extend or add workflows that independently run:

- dependency install;
- secret scan;
- backend tests;
- TypeScript;
- route validation;
- Playwright;
- build;
- migration sanity;
- SQL/RPC static checks;
- staging integration when secrets exist;
- dependency/license/security audit;
- graph performance smoke;
- workbook round-trip tests.

Skipped secret-dependent jobs must be visibly marked as skipped, not passed.

---

# PRODUCTION READINESS GATE P

## 76. Security gate

Before production:

- credential incident closed;
- secrets rotated;
- history remediated;
- secret scanning expanded;
- security advisors reviewed;
- RLS reviewed;
- RPC grants verified;
- rate limits verified;
- CSRF/CORS/session boundaries verified;
- upload security verified;
- penetration/adversarial review completed;
- no unresolved high-severity finding.

## 77. Data gate

- production migration plan reviewed;
- backup confirmed;
- restore rehearsal completed;
- migration ordering documented;
- rollback/remediation documented;
- data-retention policy documented;
- test data excluded;
- reconciliation queries prepared;
- post-migration verification prepared.

## 78. External provider gate

For each provider, record:

- sandbox/live state;
- credentials owner;
- webhook endpoint;
- signature verification;
- retry/reconciliation;
- rate limits;
- legal/compliance approval;
- failure mode;
- disable switch;
- monitoring.

Providers may include:

- billing;
- payment/escrow;
- Google Drive;
- email/SMS/WhatsApp where used;
- malware scanning;
- OCR/AI.

## 79. Observability gate

Implement/verify:

- structured logs;
- correlation IDs;
- error tracking;
- metrics;
- audit monitoring;
- webhook failure alerts;
- quota anomalies;
- payment reconciliation alerts;
- graph projection lag;
- Drive sync failures;
- database health;
- deployment health;
- dashboards and runbooks.

## 80. Release environments

Use ordered promotion:

1. local/test;
2. CI;
3. staging database;
4. staging frontend/backend;
5. closed pilot;
6. production migration;
7. production deploy;
8. smoke test;
9. monitored rollout;
10. rollback if gates fail.

## 81. Feature flags

Launch separately where appropriate:

- XLSX import/export;
- live Drive;
- subscription enforcement;
- SafeTrade sandbox;
- SafeTrade live payment;
- Trade Graph dashboards;
- AI graph insights.

Default high-risk external actions to disabled.

## 82. Production smoke tests

After explicit production release authorization, verify:

- authentication;
- tenant isolation;
- plan/entitlement resolution;
- quota consumption;
- workbook template download;
- workbook dry-run;
- stock ledger;
- RFQ/quote acceptance;
- AI high-risk block;
- container capacity;
- SafeTrade eligibility;
- payment provider disabled or sandbox/live as approved;
- Drive disabled or live as approved;
- graph projection/query;
- audit events;
- monitoring alerts;
- rollback readiness.

Use synthetic test accounts and clean up.

---

## 83. Milestone Order

Execute in this order while parallelizing safe independent work:

### Wave 0 — Baseline

- read directive;
- verify branches/PRs;
- create discovery/progress/risk docs;
- open stacked draft PR;
- assign agent ownership.

### Wave 1 — Dependency closure

Parallel:

- R0 H9/H10 evidence and credential containment;
- XLSX discovery/prototype;
- Drive credential architecture;
- Phase 8 schema/entitlement discovery;
- Phase 9 state-machine design;
- Phase 10 graph event/storage design.

### Wave 2 — Foundation

- Phase 8 entitlement service and schema first;
- XLSX service and tests;
- Drive fail-closed/live provider implementation;
- SafeTrade schema/state machine behind disabled feature flag;
- graph projection schema behind disabled feature flag.

### Wave 3 — Phase 8 vertical slices

- plans/status;
- entitlements;
- quotas;
- provider/webhook abstraction;
- frontend;
- tests;
- staging proof.

### Wave 4 — Phase 9 vertical slices

- eligibility;
- transaction creation;
- milestones;
- compliance/document gates;
- shipment gates;
- release evaluation;
- disputes;
- provider sandbox;
- frontend;
- tests;
- staging proof.

### Wave 5 — Phase 10 vertical slices

- events/projection;
- rebuild;
- path/blocker/match queries;
- intelligence summaries;
- frontend;
- AI-ready read context;
- tests;
- performance proof.

### Wave 6 — Integration

- XLSX + entitlements;
- Drive + XLSX;
- entitlements across Phases 2–10;
- SafeTrade + orders/quotes/stock/container/documents;
- graph projections from all phases;
- end-to-end regression;
- adversarial review.

### Wave 7 — Release readiness

- CI green;
- staging green;
- provider activation matrix;
- production runbooks;
- final handoff;
- stop before merge/production authorization.

---

## 84. Recommended Commit Structure

Use coherent milestone commits, for example:

```text
docs: establish remaining diaspora program baseline
fix: complete diaspora phases 3 to 7 release evidence
feat: add diaspora xlsx workbook contract
feat: implement diaspora google drive provider
feat: add diaspora subscription entitlement foundation
feat: enforce diaspora feature entitlements and quotas
feat: add diaspora billing provider abstraction
feat: add diaspora safetrade transaction foundation
feat: add diaspora safetrade milestones and release policy
feat: add diaspora dispute and delivery flows
feat: add diaspora trade graph projection
feat: add diaspora trade graph intelligence api
feat: add diaspora intelligence dashboards
test: add diaspora remaining phases integration coverage
ci: add diaspora production readiness gates
docs: complete diaspora production readiness handoff
```

Do not squash milestone history until final review policy is decided.

---

## 85. Stop Conditions

Do not stop for ordinary code decisions, test failures caused by current work, or routine refactors.

Stop and report only when:

- production database mutation requires authorization;
- real-money provider activation requires legal/credential approval;
- Google OAuth credentials or vault approval are required;
- destructive migration is unavoidable;
- paid infrastructure must be purchased;
- a policy decision materially changes money, liability, identity, privacy, or compliance;
- safe tenant isolation cannot be established;
- a high-severity security issue cannot be safely resolved;
- unrelated mainline changes create an irreconcilable conflict.

When one track is blocked, continue all independent tracks.

---

## 86. Final Acceptance Criteria

The remaining program is implementation-complete only when:

### Previous phases

- PR #81 dependency is reviewed/merged or formally accepted;
- H9/H10 evidence is recorded;
- credential incident is closed before production.

### Workbook/Drive

- XLSX templates generate and round-trip safely;
- XLSX dry-run/import/export is tested;
- Drive is live-sandbox verified or production-disabled with explicit activation blocker;
- no token leakage;
- export-to-Drive works when activated.

### Phase 8

- every protected feature has an entitlement;
- quotas are atomic/idempotent;
- subscription lifecycle is enforced;
- billing events are verified/idempotent;
- UI explains access and usage.

### Phase 9

- SafeTrade state machine and policy engine exist;
- payment/compliance/document/shipment gates work;
- disputes work;
- critical transitions audit atomically;
- sandbox provider works;
- real-money actions remain disabled until approved.

### Phase 10

- graph is event-derived and rebuildable;
- tenant isolation holds;
- path/blocker/match queries are explainable;
- dashboards work;
- AI reads only authorized structured context;
- performance budgets pass.

### Production readiness

- CI independently passes;
- staging integration passes;
- security review passes;
- migrations/advisors reviewed;
- monitoring/runbooks exist;
- production release rehearsal passes;
- no unresolved high-severity issue;
- final PR remains unmerged until explicit user approval.

---

## 87. Final Report Format

Report exactly:

1. Program branch
2. Draft PR number and URL
3. Base branch/SHA
4. Final head SHA
5. PR #81 dependency state
6. R0 H9/H10 evidence
7. Credential incident state
8. XLSX implementation state
9. XLSX dependency and security review
10. Workbook round-trip results
11. Drive provider state
12. OAuth/token-vault state
13. Phase 8 completion state
14. Plan catalog
15. Entitlement registry
16. Quota/metering evidence
17. Billing provider state
18. Phase 8 tests
19. Phase 9 completion state
20. SafeTrade state machine
21. Payment provider state
22. Release-policy evidence
23. Compliance/document/shipment gate evidence
24. Dispute evidence
25. Phase 9 tests
26. Phase 10 completion state
27. Graph storage/projection design
28. Projection/rebuild evidence
29. Query/intelligence evidence
30. Performance results
31. Phase 10 tests
32. Migrations created
33. Migrations applied to staging
34. Production migrations applied or not
35. Supabase advisors
36. CI workflow/run IDs
37. Backend test totals
38. TypeScript result
39. Route-validation result
40. Playwright result
41. Build result
42. Security/adversarial review
43. Secret scan result
44. Staging smoke result
45. Production rehearsal result
46. Environment variables/secrets required
47. Dependencies added
48. Feature flags
49. Known limitations
50. External blockers
51. Unrelated workstreams untouched
52. stash@{0} untouched
53. Untracked artifacts excluded
54. Review-thread state
55. Whether PR is merge-ready
56. Recommended rollout sequence
57. Exact user approvals still required

---

## 88. Claude Code Start Instruction

After reading this full directive, begin with:

```text
Read docs/CLAUDE_CODE_DIASPORA_REMAINING_PHASES_TO_PRODUCTION_MASTER_DIRECTIVE.md in full before changing code.

Set the /goal exactly as written in Section 6.1.
Set the /loop exactly as written in Section 6.2.
Verify current main, PR #81, staging migration state, CI state, and unrelated local files.
Create the durable discovery, progress, risk, readiness, release, and rollback documents.
Assign specialist agents using the ownership model in Section 7.
If PR #81 is unmerged, create a stacked program branch and draft PR from its latest head; otherwise branch from current main.
Execute Waves 0 through 7 without stopping for routine work.
Keep external/high-risk actions feature-flagged and fail-closed.
Do not merge and do not touch production Supabase without explicit user approval.
Stop only at the external approval boundaries defined in Section 85 or after the complete final report is ready.
```

---

## 89. Final Principle

The remaining program is not complete when the pages render.

It is complete when:

- access is commercially and technically controlled;
- money and release decisions are policy-driven;
- graph intelligence is explainable and derived from authoritative events;
- workbooks round-trip safely;
- Drive is secure and truthful;
- database state is atomic;
- tenant boundaries hold;
- failures are recoverable;
- independent CI and staging evidence exist;
- production release can be executed and rolled back from documented runbooks.

Optimize for the integrity of the complete trade operating system, not the speed of declaring completion.
