# Claude Code Master Execution Directive — CarUp Diaspora Trade OS Phases 3–7

> **Canonical repository path:** `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md`
>
> **Main-branch link after merge:** `https://github.com/kudzimusar/carup/blob/main/docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md`
>
> **Directive branch link before merge:** `https://github.com/kudzimusar/carup/blob/docs/claude-diaspora-phases-3-7-master-directive/docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md`

---

## 1. Mandate

You are Claude Code working only on the **CarUp Diaspora Trade OS** inside repository:

```text
https://github.com/kudzimusar/carup
```

Your long-session objective is to implement the original system-plan work from **Phase 3 through Phase 7** without losing the product goal, mixing unrelated workstreams, weakening trust controls, or pretending unavailable integrations are complete.

The five target phases are:

1. **Phase 3 — Online Stock and Supply Documents**
2. **Phase 4 — Buyer Orders and Reverse RFQ**
3. **Phase 5 — AI Command Hardening**
4. **Phase 6 — Container Co-Loading**
5. **Phase 7 — Drive Integrations**

This is a sustained execution program, not a request for a speculative architecture memo. Inspect the current code, implement production-shaped increments, test them, commit milestone-by-milestone, maintain a progress ledger, and open a reviewable PR. Do not merge without explicit user approval.

---

## 2. Product North Star

CarUp is not merely a spreadsheet uploader or generic vehicle marketplace.

The target is:

> **CarUp is the operating system for diaspora vehicle and auto-parts trade.**

The system must enable:

- diaspora buyers to request parts or vehicles;
- sellers and suppliers to publish verifiable export-ready stock;
- buyers to receive competing quotations;
- stock to change only through an immutable ledger;
- shared container capacity to be reserved safely;
- documents, payments, compliance and shipment state to remain traceable;
- AI to prepare and route controlled actions without bypassing permissions;
- users to retain portable copies of trade documents in their own cloud storage;
- every critical action to remain authenticated, authorized, tenant-scoped, auditable and idempotent.

Do not optimize for a demo that merely renders screens. Optimize for a coherent operating system whose frontend, backend, persistence, security and tests agree.

---

## 3. Current Verified Baseline

Before beginning, verify repository truth yourself. The known starting position is:

- Phase 2C was squash-merged to `main` through PR `#78`.
- Phase 2C merge commit: `3ac2ff23a60f545bbafed8d4d256277209f3adf9`.
- Phase 2C provides guarded JSON workbook intake and dry-run UI.
- Phase 2C does **not** provide binary XLSX parsing or generation.
- All four Vercel environments passed for the Phase 2C merge commit.
- The existing workbook backend includes validation, persisted batches, row diagnostics, review, import planning, controlled draft execution, audit/recovery visibility and operator-console APIs.
- Production Supabase has not been authorized for mutation by this directive.
- `stash@{0}` is unrelated work and must remain unapplied/unpopped.
- Navigation Intelligence belongs to Antigravity and is outside this directive.
- Vehicle Evidence, Mobile Identity and PartSentry are separate workstreams.

The current handoff document may still describe Phase 2C as “in progress.” Reconcile that documentation as the first documentation correction, without changing unrelated workstream history.

Read these documents before implementation:

```text
docs/CARUP_DIASPORA_TRADE_OS_SYSTEM_PLAN.md
docs/CARUP_WORKSTREAM_SEPARATION_AND_HANDOFF.md
docs/DIASPORA_WORKBOOK_DRY_RUN_UI.md
docs/DIASPORA_WORKBOOK_OPERATOR_CONSOLE_UI.md
```

Also inspect all existing diaspora routes, services, constants, migrations, tests and frontend surfaces before designing new files.

---

## 4. Session Control: `/goal` and `/loop`

Use the environment’s `/goal` and `/loop` facilities when available. If those commands are not available, preserve the same behavior manually.

### 4.1 Session Goal

Set the session goal to the following:

```text
/goal Complete CarUp Diaspora Trade OS Phases 3–7 as one controlled long-session program: implement online stock and supply documents, buyer orders and Reverse RFQ, AI command hardening, container co-loading, and Google Drive integration; preserve tenant isolation, stock-ledger integrity, approval gates, auditability and current workstream separation; create milestone commits and focused tests; open a reviewable PR; do not merge or touch production Supabase without explicit approval.
```

### 4.2 Execution Loop

Use a continuous loop equivalent to:

```text
/loop For the active milestone: inspect existing code and schema; update the progress ledger; implement the smallest complete vertical slice; run focused backend, type, frontend and E2E checks; fix only failures caused by this milestone; commit the milestone; reassess dependencies and risks; continue to the next milestone. Stop only for a genuine external blocker requiring secrets, paid infrastructure, production database approval, destructive migration approval, or user policy approval.
```

Do not repeatedly ask the user for decisions already resolved by this directive. Continue independently across routine engineering choices. Stop and report only when a blocker cannot safely be resolved from repository truth.

---

## 5. Delivery Model

### 5.1 One Long Session, Controlled Milestones

Work in one sustained Claude Code session, but do not produce one unstructured mass of changes.

Create a dedicated program branch from current `origin/main`:

```text
claude/diaspora-phases-3-7-program
```

Use milestone commits:

```text
feat: add diaspora stock ledger and supply documents
feat: add diaspora buyer orders and reverse rfq
feat: harden diaspora ai command workflow
feat: add diaspora container co-loading marketplace
feat: add diaspora google drive integration

test: complete diaspora phases 3 to 7 acceptance coverage
docs: complete diaspora phases 3 to 7 handoff
```

A milestone may require more than one commit if necessary, but each commit must be coherent, tested and limited to the active phase.

Open a **draft PR early** after the branch and discovery baseline are established. Keep the PR draft until all accepted milestone gates pass. Do not merge it.

### 5.2 Progress Ledger

Create and maintain:

```text
docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md
```

For each milestone record:

- objective;
- repository findings;
- schema findings;
- files changed;
- migration status;
- endpoints added or extended;
- frontend routes added;
- tests run;
- test results;
- known limitations;
- blockers;
- commit SHA;
- next milestone.

Update the ledger after every milestone commit. It is the durable session memory and must allow another agent to resume without guessing.

### 5.3 PR Policy

At completion:

- push the program branch;
- keep the PR focused on Diaspora Trade OS only;
- include milestone summaries and test evidence;
- include migrations but do not apply them to production;
- include environment-variable requirements without secrets;
- include screenshots or Playwright artifacts where practical;
- stop before merge.

---

## 6. Absolute Workstream Boundaries

Do not modify or resume:

- Navigation Intelligence;
- Vehicle Evidence;
- Mobile Identity Verification;
- PartSentry Governance;
- unrelated marketplace redesigns;
- unrelated mobile UI work;
- unrelated deployment configuration.

Do not apply, pop, drop or rewrite `stash@{0}`.

Do not stage known unrelated untracked artifacts such as `*.exit`, temporary diff files or test-output text files.

Do not delete unrelated documentation, especially:

```text
NAVIGATION_INTELLIGENCE.md
MILESTONE_EXECUTION_PROTOCOL.md
```

If current `main` advances while you work, rebase carefully and prove that no unrelated deletion or overwrite occurred.

---

## 7. Non-Negotiable Safety Rules

These rules apply across Phases 3–7.

### 7.1 Database and Environment

- Do not mutate production Supabase.
- Do not run destructive SQL against any shared environment.
- Repository migration files may be created after schema discovery.
- Apply migrations only to an explicitly authorized development/staging environment.
- Never hardcode generated IDs in migrations.
- Preserve backwards compatibility where existing APIs are already consumed.

### 7.2 Tenant and User Isolation

Every protected operation must enforce:

- authenticated user;
- allowed role;
- tenant/profile ownership;
- participant membership where relevant;
- row-level or service-level access control;
- no cross-tenant leakage in list, detail, mutation or search endpoints.

### 7.3 Stock Integrity

Never overwrite stock totals directly.

All stock movement must occur through ledger actions such as:

- `ADD`
- `REMOVE`
- `RESERVE`
- `RELEASE_RESERVATION`
- `DAMAGE`
- `RETURN`
- `TRANSFER`
- `ADJUST_WITH_APPROVAL`

The available quantity must be derived from ledger state or transactionally maintained from ledger events. A user, import, AI command or admin must not bypass the ledger.

### 7.4 AI Integrity

AI must never directly mutate stock, payment, compliance, document verification, shipment completion or reputation records.

AI may:

- parse intent;
- extract entities;
- calculate confidence;
- create draft actions;
- request confirmation;
- route approval requests;
- invoke an existing authorized domain service only after the required gate is satisfied.

### 7.5 Container Integrity

Container reservations must be transactionally checked against:

- volume;
- weight where available;
- reservation status;
- concurrent reservations;
- cancellation/release behavior.

Overfilled containers must be rejected server-side even when frontend validation passes.

### 7.6 Drive Security

Never commit OAuth credentials, access tokens, refresh tokens or real user file IDs.

Drive integration must:

- use environment variables;
- encrypt or securely store tokens through the project’s approved secret/storage pattern;
- minimize requested scopes;
- handle revocation;
- avoid logging tokens;
- store only necessary metadata;
- use a mockable provider abstraction for tests.

### 7.7 High-Risk Operations Outside This Program

Do not implement automatic:

- payment release;
- escrow release;
- compliance approval;
- document verification;
- shipment delivery completion;
- reputation creation;
- customs clearance override.

Those belong to later SafeTrade, subscription and trade-graph phases. Interfaces may be prepared, but no automatic execution is authorized.

---

## 8. Initial Discovery Gate

Before Phase 3 implementation, perform a focused discovery audit.

Inspect:

```text
backend/routes/diasporaRoutes.js
backend/routes/diasporaWorkbookRoutes.js
backend/constants/diaspora/*
backend/services/diaspora/*
backend/middleware/authMiddleware.js
backend/middleware/*audit*
backend/services/payment/*
backend/services/storage/*
backend/services/document-intelligence/*
database/migrations/*
web/src/pages/diaspora/*
web/src/hooks/useCarUpApi.ts
web/src/types/index.ts
web/src/config/featureRegistry.ts
web/e2e/*diaspora*
```

Determine:

- which required tables already exist;
- which fields and relationships already exist;
- whether stock, ledger, supply-document, RFQ, AI-command, container and drive tables exist;
- current role and tenant model;
- current subscription/entitlement utilities;
- current audit logger and correlation ID model;
- current storage/upload abstractions;
- current status enums and lifecycle rules;
- current test harnesses and mocking patterns.

Create:

```text
docs/DIASPORA_PHASES_3_TO_7_DISCOVERY.md
```

The discovery document must include:

- confirmed reusable surfaces;
- schema gaps;
- route gaps;
- security gaps;
- migration plan;
- phase dependency map;
- explicit non-goals;
- recommended implementation order.

Do not turn discovery into a multi-day pause. Use it to guide implementation immediately.

---

# PHASE 3 — ONLINE STOCK AND SUPPLY DOCUMENTS

## 9. Phase 3 Objective

Deliver a seller-facing, ledger-backed stock operating surface and active supply-document flow.

A seller or supplier must be able to:

- create draft stock;
- record stock through ledger movements;
- update descriptive metadata without rewriting quantity;
- attach evidence or document references;
- declare compatibility;
- declare packaging, dimensions and origin;
- prepare export readiness;
- create and publish a supply document through controlled status changes;
- view quantity history and audit history.

## 10. Phase 3 Domain Model

Reuse existing tables when sufficient. Otherwise propose repository migrations for the minimum required structures.

Likely structures:

### 10.1 Stock Item or Batch

Required concepts:

- ID;
- tenant ID;
- seller trade profile ID;
- part or vehicle reference;
- SKU or external reference;
- description;
- make/model/year/engine compatibility;
- OEM and aftermarket numbers;
- condition;
- origin country/city;
- warehouse/location;
- price and currency;
- packaging;
- dimensions and weight;
- export readiness;
- verification status;
- publication status;
- valid-until date;
- created/updated actor and timestamps.

### 10.2 Stock Ledger

Required concepts:

- ledger entry ID;
- tenant ID;
- stock item ID;
- action type;
- quantity delta;
- reservation/order reference;
- source/import/AI command reference;
- reason;
- approval metadata where required;
- idempotency key;
- actor;
- timestamp;
- immutable audit metadata.

### 10.3 Supply Document

Required concepts:

- supply document ID;
- seller profile;
- linked stock items or batch;
- publication status;
- verification state;
- export readiness;
- validity window;
- document/evidence links;
- quote terms;
- audit fields.

## 11. Phase 3 Services

Add or extend services with clear transaction boundaries, such as:

```text
backend/services/diaspora/diasporaStockLedgerService.js
backend/services/diaspora/diasporaStockService.js
backend/services/diaspora/diasporaSupplyDocumentService.js
```

Required capabilities:

- create draft stock item;
- list/detail stock with tenant scoping;
- append ledger movement;
- calculate available/reserved/total quantities;
- prevent negative availability;
- reserve against order/RFQ;
- release reservation;
- damage/return/transfer actions;
- idempotent movement submission;
- create/update draft supply document;
- publish only when required fields and permissions pass;
- unpublish/expire through controlled transitions;
- audit every mutation.

## 12. Phase 3 API

Use existing diaspora routing conventions. Suggested endpoints may include:

```text
GET    /api/diaspora/stock
POST   /api/diaspora/stock
GET    /api/diaspora/stock/:id
PATCH  /api/diaspora/stock/:id
GET    /api/diaspora/stock/:id/ledger
POST   /api/diaspora/stock/:id/ledger
POST   /api/diaspora/stock/:id/reserve
POST   /api/diaspora/stock/:id/release-reservation

GET    /api/diaspora/supply-documents
POST   /api/diaspora/supply-documents
GET    /api/diaspora/supply-documents/:id
PATCH  /api/diaspora/supply-documents/:id
POST   /api/diaspora/supply-documents/:id/publish
POST   /api/diaspora/supply-documents/:id/unpublish
```

Do not duplicate existing routes. Align names and payload shapes with repository conventions discovered at runtime.

## 13. Phase 3 Frontend

Create or extend guarded seller surfaces, likely:

```text
DiasporaStockManager
DiasporaStockEditor
DiasporaStockLedger
DiasporaSellerSupplyDocuments
DiasporaSupplyDocumentEditor
DiasporaStockPassport
```

Required UI behavior:

- role-aware navigation;
- list/filter/search stock;
- create/edit descriptive stock fields;
- dedicated ledger actions instead of quantity overwrite;
- stock totals and reservation state;
- supply document drafting and publication;
- loading, empty, validation and API-error states;
- no controls for unauthorized roles;
- explicit audit/history visibility;
- mobile-responsive layout.

## 14. Phase 3 Tests and Acceptance

Backend tests must prove:

- seller can access own stock;
- seller cannot access another tenant’s stock;
- quantity cannot be directly overwritten;
- ledger entries calculate quantity correctly;
- duplicate idempotency keys do not duplicate movements;
- reservation cannot exceed availability;
- release restores availability;
- negative quantity is rejected;
- publication is blocked when required fields are missing;
- audit metadata is written.

Frontend/E2E tests must prove:

- authorized seller can open stock manager;
- unauthorized roles are denied;
- stock can be drafted;
- ledger action updates displayed totals;
- direct quantity input is absent;
- supply document can be drafted;
- publish is blocked until valid;
- error/loading/empty states render.

### Phase 3 Definition of Done

Phase 3 is complete only when the seller stock flow is database-backed, ledger-enforced, tenant-safe, visible in UI and covered by focused tests. A mock-only UI is not complete.

---

# PHASE 4 — BUYER ORDERS AND REVERSE RFQ

## 15. Phase 4 Objective

Deliver buyer demand documents, seller RFQ responses and controlled quote selection.

A buyer must be able to:

- create a parts or vehicle request;
- declare destination, urgency, budget and compatibility requirements;
- attach required document references;
- publish or submit the request to eligible sellers;
- receive seller quotes;
- compare quotes;
- accept one quote through a controlled transition;
- view an Order Passport timeline.

A seller must be able to:

- discover eligible RFQs;
- respond with a quote;
- reference verified or available stock;
- declare price, currency, validity, delivery estimate and shipping terms;
- revise or withdraw a draft quote;
- see acceptance/rejection status.

## 16. Phase 4 Domain Model

Reuse existing diaspora import order and quote structures where possible.

Ensure the model supports:

- buyer order/request document;
- line items;
- part/vehicle compatibility data;
- destination and delivery requirements;
- budget and currency;
- urgency;
- RFQ publication state;
- seller eligibility;
- quote response;
- quote comparison attributes;
- accepted quote reference;
- audit trail;
- participant access.

Do not introduce parallel duplicate order tables if current `diaspora_import_orders` and `diaspora_import_quotes` can be safely extended.

## 17. Phase 4 Matching

Build deterministic matching first.

Matching should consider available repository data such as:

- requested make/model/year/engine;
- OEM/aftermarket part number;
- condition;
- quantity;
- seller location;
- export readiness;
- available stock;
- destination;
- price/currency where appropriate;
- seller verification/reputation where already available.

The matching service must return explainable reasons, not an opaque AI-only score.

Suggested service:

```text
backend/services/diaspora/diasporaDemandSupplyMatchingService.js
```

## 18. Phase 4 API

Suggested capabilities:

```text
GET    /api/diaspora/buyer-orders
POST   /api/diaspora/buyer-orders
GET    /api/diaspora/buyer-orders/:id
PATCH  /api/diaspora/buyer-orders/:id
POST   /api/diaspora/buyer-orders/:id/publish-rfq
GET    /api/diaspora/buyer-orders/:id/matches
GET    /api/diaspora/rfqs
POST   /api/diaspora/buyer-orders/:id/quotes
PATCH  /api/diaspora/quotes/:id
POST   /api/diaspora/quotes/:id/submit
POST   /api/diaspora/buyer-orders/:id/accept-quote
```

Acceptance must be transactional and idempotent. Accepting one quote must not silently accept multiple quotes.

## 19. Phase 4 Frontend

Create or extend:

```text
DiasporaBuyerOrders
DiasporaBuyerOrderEditor
DiasporaReverseRfqMarketplace
DiasporaQuoteEditor
DiasporaQuoteComparison
DiasporaOrderPassport
```

Required UI:

- buyer order list and editor;
- RFQ publish state;
- matched seller/supply cards with reasons;
- seller RFQ queue;
- quote editor;
- quote comparison table;
- controlled quote acceptance;
- read-only order timeline/passport;
- role/tenant access boundaries;
- loading, empty and error states.

Do not expose payment release, compliance approval or automatic shipment creation.

## 20. Phase 4 Tests and Acceptance

Backend tests must prove:

- buyer accesses own orders only;
- seller sees only eligible/published RFQs;
- draft orders are not publicly visible;
- matching excludes unavailable stock;
- quote response is tenant/role constrained;
- duplicate submission is idempotent;
- one quote can be accepted;
- competing quotes are rejected or remain unaccepted according to the defined state machine;
- participant access is enforced;
- audit events are written.

Frontend/E2E tests must prove:

- buyer creates and publishes RFQ;
- seller sees RFQ and submits quote;
- buyer compares quotes;
- buyer accepts a quote;
- unauthorized users are denied;
- order passport renders state history;
- no payment-release control is present.

### Phase 4 Definition of Done

Phase 4 is complete when buyer demand can be created, published, matched and quoted through real backend state, and a buyer can safely accept one quote with full access control and audit coverage.

---

# PHASE 5 — AI COMMAND HARDENING

## 21. Phase 5 Objective

Implement a controlled AI command workflow that converts text commands into auditable draft actions without allowing AI to bypass domain rules.

Voice support may use an existing transcription service if repository infrastructure already exists. If not, implement the text command pipeline and a transcription-provider interface, and record live voice transcription as an external dependency rather than faking it.

## 22. Phase 5 Command Pipeline

Implement the following pipeline:

1. receive text command or transcription;
2. normalize command;
3. classify intent;
4. extract entities;
5. match stock, orders, profiles, parts or vehicles;
6. calculate confidence;
7. check duplicate-command risk;
8. check authentication and tenant;
9. check role and entitlement hook;
10. check business rules;
11. classify risk tier;
12. create draft action;
13. request confirmation or reviewer approval;
14. execute only through an existing domain service after approval;
15. write an immutable audit event;
16. expose status in UI.

## 23. Phase 5 Risk Tiers

### Low Risk — Draft Creation Only

Examples:

- create draft buyer request;
- create draft supplier stock;
- attach internal note;
- classify document;
- prepare quote draft.

Low risk may automatically create a draft, never a published/final record.

### Medium Risk — User Confirmation Required

Examples:

- publish supply document;
- reserve stock;
- submit quote;
- create payment milestone draft;
- reserve container space.

### High Risk — Reviewer/Admin Approval Required

Examples:

- verify profile;
- mark document verified;
- approve compliance;
- release escrow;
- mark shipment delivered;
- override stock ledger;
- cancel paid order;
- change customs state.

For this program, high-risk commands must remain queued/blocked. Do not implement automatic high-risk execution.

## 24. Phase 5 Services and API

Likely services:

```text
backend/services/diaspora/diasporaAiCommandService.js
backend/services/diaspora/diasporaAiIntentParser.js
backend/services/diaspora/diasporaAiApprovalService.js
```

Required capabilities:

- deterministic fallback parser for tests;
- optional provider adapter for external LLM parsing;
- structured command schema;
- confidence score;
- entity candidates and ambiguity reporting;
- duplicate fingerprint/idempotency;
- risk classification;
- draft-action payload;
- approval state machine;
- audit log;
- execution adapter that calls domain services only.

Suggested endpoints:

```text
POST   /api/diaspora/ai-commands/parse
POST   /api/diaspora/ai-commands
GET    /api/diaspora/ai-commands
GET    /api/diaspora/ai-commands/:id
POST   /api/diaspora/ai-commands/:id/confirm
POST   /api/diaspora/ai-commands/:id/approve
POST   /api/diaspora/ai-commands/:id/reject
POST   /api/diaspora/ai-commands/:id/execute
```

Execution endpoint must re-check current permissions, risk, approval and business rules. Never trust stale parse-time authorization.

## 25. Phase 5 Frontend

Create or extend:

```text
DiasporaAiCommandCenter
DiasporaAiCommandReview
DiasporaAiApprovalQueue
```

Required UI:

- text command input;
- optional voice-input availability status;
- parsed intent and entities;
- confidence indicator;
- ambiguity warnings;
- risk tier;
- proposed draft action;
- confirmation for medium risk;
- reviewer queue for high risk;
- execution/audit timeline;
- clear blocked-state explanations.

Do not display a successful execution state unless a domain service actually completed the permitted action.

## 26. Phase 5 Tests and Acceptance

Tests must cover:

- low-risk command creates only a draft;
- medium-risk command cannot execute before confirmation;
- high-risk command cannot execute without reviewer approval and remains blocked under this directive;
- duplicate command fingerprint prevents duplicate action;
- low confidence creates review-needed state;
- ambiguous entity prevents execution;
- unauthorized role cannot confirm/approve;
- tenant isolation;
- execution re-validates permissions;
- AI cannot directly update stock totals;
- AI cannot release payment or approve compliance;
- audit event exists for parse, confirm, approve/reject and execute attempts.

### Phase 5 Definition of Done

Phase 5 is complete when text commands can be parsed into structured, confidence-scored, duplicate-safe draft actions with confirmation/approval gates and audit history. Live high-risk automation is not required and must remain blocked.

---

# PHASE 6 — CONTAINER CO-LOADING

## 27. Phase 6 Objective

Deliver a shared-container marketplace where eligible buyers and sellers can reserve capacity safely.

Core capabilities:

- list open containers;
- view route, departure window and available capacity;
- request cargo reservation;
- approve or reject reservation;
- calculate used and available volume;
- calculate weight where data exists;
- prevent overfill;
- release capacity when reservation is rejected/cancelled;
- mark ready-to-close and full states;
- link reservations to orders and shipments;
- show participant-specific documents and charges without cross-user leakage.

## 28. Phase 6 Capacity Rules

Implement server-side parity with the initial formulas:

```text
USED_VOLUME = sum(approved reservation estimated_volume)
AVAILABLE_VOLUME = total_capacity_volume - used_capacity_volume
FILL_PERCENT = used_capacity_volume / total_capacity_volume
READY_TO_CLOSE = fill_percent >= 0.90
FULL = fill_percent >= 0.98
```

Also enforce:

- `used_volume <= total_volume`;
- weight capacity if available;
- pending reservations do not consume approved capacity unless the product explicitly chooses a temporary hold model;
- cancellation/rejection releases capacity;
- concurrent approvals cannot overfill the container;
- decimal precision is consistent;
- zero/negative capacity is invalid.

## 29. Phase 6 Services and API

Reuse existing `diaspora_container_shipments` and `diaspora_cargo_reservations` when sufficient.

Likely service:

```text
backend/services/diaspora/diasporaContainerMarketplaceService.js
```

Suggested endpoints:

```text
GET    /api/diaspora/containers
POST   /api/diaspora/containers
GET    /api/diaspora/containers/:id
PATCH  /api/diaspora/containers/:id
GET    /api/diaspora/containers/:id/capacity
POST   /api/diaspora/containers/:id/reservations
GET    /api/diaspora/containers/:id/reservations
POST   /api/diaspora/reservations/:id/approve
POST   /api/diaspora/reservations/:id/reject
POST   /api/diaspora/reservations/:id/cancel
POST   /api/diaspora/containers/:id/close-booking
```

Closing a container must not imply shipment delivery, customs clearance or payment release.

## 30. Phase 6 Frontend

Create or extend:

```text
DiasporaContainerMarketplace
DiasporaContainerDetail
DiasporaCargoReservationEditor
DiasporaContainerOperatorPanel
```

Required UI:

- open-container cards;
- origin/destination/departure window;
- used/available CBM;
- fill percentage and status;
- reservation form;
- buyer/seller linked order selection;
- operator approval queue;
- ready-to-close/full indicators;
- no overfill controls;
- participant-safe details;
- loading, empty and error states.

## 31. Phase 6 Tests and Acceptance

Tests must prove:

- approved reservations calculate capacity;
- pending/rejected/cancelled behavior is correct;
- exact 90% becomes ready to close;
- exact 98% becomes full;
- overfill is rejected;
- concurrent approval cannot overfill;
- unauthorized actor cannot approve;
- user cannot view another participant’s private data;
- closing booking does not complete shipment;
- frontend shows correct capacity/status;
- frontend prevents obvious invalid requests while backend remains authoritative.

### Phase 6 Definition of Done

Phase 6 is complete when shared capacity can be listed, requested, approved and safely constrained by server-side capacity rules with UI and concurrency-aware tests.

---

# PHASE 7 — GOOGLE DRIVE INTEGRATION

## 32. Phase 7 Objective

Implement a secure, provider-abstracted Google Drive integration for user-owned trade documents and exports.

Google Drive is first. OneDrive must be represented by a provider interface but does not need a live implementation in this phase.

Do not claim Drive is production-ready without real OAuth credentials and an authorized end-to-end test. The code may be complete behind a feature flag with mocks while the live credential step remains documented.

## 33. Phase 7 Provider Architecture

Create a provider abstraction such as:

```text
backend/services/diaspora/drive/driveProvider.js
backend/services/diaspora/drive/googleDriveProvider.js
backend/services/diaspora/diasporaDriveSyncService.js
```

Required interface capabilities:

- build authorization URL;
- exchange authorization code;
- refresh access token;
- revoke/disconnect;
- create or locate approved folder structure;
- upload file;
- update file;
- download/read metadata where authorized;
- list linked files;
- handle provider errors and revoked access.

## 34. Phase 7 Data and Security

Store only necessary connection and file metadata, including:

- tenant/user ID;
- provider;
- provider account identifier where allowed;
- encrypted token reference or approved encrypted fields;
- scopes;
- expiry;
- revoked/disconnected state;
- drive file ID;
- file URL;
- checksum;
- linked order/stock/document ID;
- sync status;
- last synced timestamp;
- error status without secret leakage.

Do not store plaintext tokens in logs, browser state or public API responses.

Use a folder model equivalent to:

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

## 35. Phase 7 Scope Reality

Phase 2C currently supports JSON workbook intake, not real XLSX generation.

Therefore:

- do not fake an XLSX export;
- Drive upload may support existing user documents and truthful JSON/report exports that the system can actually generate;
- if a verified XLSX export implementation is added as a necessary dependency, isolate it clearly, add an approved dependency, test it and document it;
- otherwise record binary workbook export as a known prerequisite for full workbook-to-Drive parity.

The Drive feature must not block completion of honest document upload and metadata-linking flows.

## 36. Phase 7 API

Suggested endpoints:

```text
GET    /api/diaspora/drive/status
GET    /api/diaspora/drive/google/authorize
GET    /api/diaspora/drive/google/callback
POST   /api/diaspora/drive/disconnect
GET    /api/diaspora/drive/files
POST   /api/diaspora/drive/upload
POST   /api/diaspora/drive/export
POST   /api/diaspora/drive/sync
```

OAuth callback must validate state and bind the connection to the authenticated initiating user/tenant.

## 37. Phase 7 Frontend

Create or extend:

```text
DiasporaDriveConnections
DiasporaDriveFilePickerOrLinker
DiasporaDriveSyncStatus
```

Required UI:

- connection status;
- connect Google Drive action when feature enabled;
- exact scopes explanation;
- disconnected/revoked/error states;
- linked file list;
- upload/save action only for supported artifacts;
- sync status and last sync;
- disconnect action;
- no token display;
- truthful limitation copy for unavailable XLSX export.

## 38. Phase 7 Tests and Acceptance

Use mocked provider tests and route tests. Never require real secrets in CI.

Tests must prove:

- authorization URL uses minimum expected scopes;
- OAuth state is generated and validated;
- invalid state is rejected;
- token material is not returned to frontend;
- revoked token produces disconnected/reconnect state;
- tenant/user cannot access another connection;
- upload uses approved folder/link metadata;
- provider errors are sanitized;
- disconnect revokes or invalidates local connection safely;
- feature-disabled state is safe;
- UI shows honest connection and limitation states.

### Phase 7 Definition of Done

Phase 7 is code-complete when Google Drive integration is provider-abstracted, secure, testable with mocks, tenant-safe and exposed through truthful UI. Live production readiness additionally requires user-supplied Google OAuth credentials and an explicitly authorized end-to-end verification.

---

## 39. Cross-Phase Architecture Requirements

### 39.1 Status and Lifecycle Consistency

Centralize lifecycle constants. Avoid duplicated string literals across route, service, database and UI layers.

Every state transition must define:

- allowed source states;
- allowed target state;
- actor roles;
- required data;
- audit event;
- idempotency behavior;
- failure response.

### 39.2 Error Contract

Use existing centralized error handling.

Do not expose raw database errors, token errors or provider stack traces.

Frontend must receive stable error shapes and render actionable copy.

### 39.3 Audit and Correlation

Every mutation should include or propagate:

- request/correlation ID;
- actor ID;
- tenant ID;
- domain entity ID;
- action;
- before/after or event metadata where appropriate;
- timestamp;
- source such as UI, workbook or AI command.

### 39.4 Idempotency

Use idempotency keys for:

- stock movements;
- quote submission;
- quote acceptance;
- AI execution;
- container reservation/approval;
- Drive upload/sync where retries may duplicate files.

### 39.5 Feature Registry and Navigation

Register routes through existing feature/navigation conventions. Ensure:

- guarded roles are explicit;
- public navigation does not expose privileged surfaces;
- buyer and seller navigation differs appropriately;
- route validation tests are updated;
- mobile/tablet layouts remain usable.

### 39.6 Backwards Compatibility

Do not break:

- Phase 2C workbook dry-run UI;
- workbook operator console;
- existing diaspora import order/document/shipment flows;
- unrelated marketplace and evidence routes.

Add regression tests when extending shared surfaces.

---

## 40. Phase 8–10 Boundary

The original plan continues beyond Phase 7:

- Phase 8 — Subscription Gate;
- Phase 9 — SafeTrade;
- Phase 10 — Trade Graph Intelligence.

Those phases are **not** part of this directive.

However:

- call an existing entitlement service if one already exists;
- add explicit entitlement hooks/interfaces where required;
- do not invent a full subscription billing system here;
- do not release escrow or automate compliance;
- do not build broad AI graph intelligence;
- document deferred dependencies clearly.

A Phase 3–7 implementation must remain compatible with later Phase 8–10 work.

---

## 41. Testing Program

Use the repository’s actual commands after inspecting package scripts. At minimum run focused checks after every milestone and broader checks before the final PR is marked ready.

### 41.1 Backend

Add focused Node tests for each service and route. Cover:

- authorization;
- tenant isolation;
- validation;
- state transitions;
- idempotency;
- concurrency-sensitive behavior;
- sanitized errors;
- audit calls;
- provider mocks.

### 41.2 Type and Unit Tests

Run applicable commands such as:

```bash
npx tsc --noEmit --project web/tsconfig.app.json
npx vitest run web/src/config/featureRegistry.route-validation.test.ts
```

### 41.3 Playwright

Add focused E2E specs such as:

```text
web/e2e/diaspora-stock-supply.spec.ts
web/e2e/diaspora-reverse-rfq.spec.ts
web/e2e/diaspora-ai-command-center.spec.ts
web/e2e/diaspora-container-marketplace.spec.ts
web/e2e/diaspora-drive-connections.spec.ts
```

Mock backend responses only where the existing E2E framework does so. Maintain at least one contract-level path that proves request payloads and role boundaries.

### 41.4 Build

Run:

```bash
git diff --check
npm run build
```

The existing Vite chunk-size warning is not itself a failure, but do not materially worsen bundle size without documenting it.

### 41.5 Final Regression

Before marking the draft PR ready, run:

- all new backend diaspora tests;
- all new focused Playwright specs;
- existing workbook dry-run spec;
- existing workbook operator-console spec;
- route validation;
- TypeScript;
- production web build.

Do not spend the program fixing unrelated baseline failures. Record them separately with proof that they pre-existed and do not intersect changed files.

---

## 42. Migration Policy

For every proposed migration:

1. inspect existing schema and migration history;
2. avoid duplicate tables/columns;
3. use additive, backwards-compatible changes where possible;
4. add indexes for tenant and relationship queries;
5. add constraints for lifecycle and quantity integrity where safe;
6. add RLS/policy design consistent with project conventions;
7. include rollback or remediation notes;
8. add repository tests or validation scripts;
9. do not apply to production;
10. list required staging deployment steps in the PR.

When schema uncertainty remains, stop that specific migration and continue with independent work rather than guessing destructive SQL.

---

## 43. External Dependency and Secret Policy

You may add a dependency only when:

- the repository lacks the capability;
- the dependency is actively maintained and appropriate;
- license/security implications are acceptable;
- it is isolated behind an adapter where practical;
- lockfile changes are intentional;
- tests prove the use case.

Never commit:

- Google client secret;
- OAuth refresh token;
- Supabase service-role key;
- production webhook secret;
- real user document or personal data.

Document required environment variables in `.env.example` or the project’s existing configuration documentation without real values.

---

## 44. Stop Conditions

Stop the long-session loop and report when any of the following occurs:

- production database mutation would be required;
- a destructive migration is unavoidable;
- real OAuth credentials are required for the next step;
- a paid external service must be provisioned;
- repository truth contradicts a core assumption and safe resolution is unclear;
- unrelated branches or workstreams would need to be overwritten;
- security tests reveal an unresolved cross-tenant leak;
- a required domain rule cannot be implemented without product-owner choice.

When stopped, provide:

- exact blocker;
- affected phase;
- completed work;
- safe options;
- recommended option;
- files/commits involved;
- whether the branch remains testable.

Do not abandon independent milestones because one later phase is blocked.

---

## 45. Final Acceptance Gate

The program is ready for user review only when:

- Phase 3 stock is ledger-backed and tenant-safe;
- Phase 3 supply documents have controlled publication;
- Phase 4 buyer orders and RFQs operate through real APIs;
- Phase 4 quote acceptance is transactional/idempotent;
- Phase 5 AI creates controlled draft actions with risk gates;
- Phase 5 high-risk automatic execution remains blocked;
- Phase 6 capacity rules reject overfill server-side;
- Phase 6 UI and operator controls are tested;
- Phase 7 provider abstraction and mocked Google Drive flows pass;
- tokens/secrets are never exposed;
- Phase 2C regressions pass;
- documentation and progress ledger are current;
- no unrelated files or workstreams are present;
- the PR is open and unmerged.

If a phase is only partially complete because of a legitimate external dependency, label it accurately as **code-complete pending external activation** or **blocked**, never “complete.”

---

## 46. Final Report Format

At the end of the long session, report exactly:

1. Program branch
2. Draft/final PR number and URL
3. Current head SHA
4. Main SHA used as base
5. Phase 3 completion state
6. Phase 3 files, routes, schema and tests
7. Phase 4 completion state
8. Phase 4 files, routes, schema and tests
9. Phase 5 completion state
10. Phase 5 files, routes, schema and tests
11. Phase 6 completion state
12. Phase 6 files, routes, schema and tests
13. Phase 7 completion state
14. Phase 7 files, routes, schema and tests
15. Migration files created
16. Migrations applied anywhere
17. Production Supabase touched or not
18. Dependencies added
19. Environment variables required
20. Security controls implemented
21. Tenant isolation evidence
22. Idempotency evidence
23. Audit evidence
24. Focused backend test results
25. TypeScript result
26. Route-validation result
27. Playwright results
28. Build result
29. Existing regression results
30. Known limitations
31. External blockers
32. Deferred Phase 8–10 work
33. Whether stash@{0} remained untouched
34. Whether unrelated untracked files were excluded
35. Whether unrelated workstreams were untouched
36. Whether PR remains unmerged
37. Recommended review and merge sequence

---

## 47. Start Command for Claude Code

After reading this complete document, begin with:

```text
Read docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md in full.

Set the /goal exactly as defined in Section 4.1.
Start the /loop exactly as defined in Section 4.2.
Verify current main and Phase 2C merge state.
Create the program branch and progress/discovery documents.
Open a draft PR after the baseline commit.
Then execute Phase 3 through Phase 7 sequentially, using the acceptance gates in this directive.
Do not merge, do not touch production Supabase, and do not mix unrelated workstreams.
```

---

## 48. Final Reminder

The purpose of this long session is not to maximize changed-file count. It is to move CarUp materially closer to the complete Diaspora Trade Operating System while preserving trust.

Always prefer:

- real vertical slices over mock dashboards;
- ledgered operations over direct overwrites;
- explicit state machines over ambiguous status changes;
- server authority over frontend assumptions;
- explainable matching over opaque scoring;
- draft/approval workflows over unchecked AI execution;
- tenant isolation over convenience;
- honest limitation reporting over false completion.
