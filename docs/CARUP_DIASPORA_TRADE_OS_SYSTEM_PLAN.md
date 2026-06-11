# CarUp Diaspora Trade OS System Plan

## 1. Purpose

This document aggregates the strategic, product, workbook, backend, Supabase, AI, subscription, cloud-drive, security, and agent implementation plan for turning CarUp's diaspora capability into a full **Diaspora Trade Operating System**.

The goal is not simply to let users upload a spreadsheet. The goal is to make CarUp the operating layer for diaspora vehicle and auto-parts trade:

- diaspora buyers request vehicles, parts, quotes, shipping, customs support, and delivery;
- diaspora sellers and suppliers upload stock, publish supply documents, respond to demand, and reserve container space;
- subscribed members manage stock and orders online or offline;
- the workbook becomes an offline mirror/staging document;
- the website becomes the live operational system;
- AI text and voice commands update stock and orders through safe validation, approval, and audit flows;
- cloud-drive integrations give members ownership and portability over their documents;
- security, subscriptions, authorization, audit, and row-level access rules protect each member's data.

## 2. Current CarUp Foundation

CarUp already has a real diaspora backend foundation.

Confirmed repo surfaces:

- `backend/routes/diasporaRoutes.js`
- `backend/constants/diaspora/diasporaStatuses.js`
- diaspora services under `backend/services/diaspora/*`
- document intelligence service usage inside diaspora document OCR flow
- existing auth middleware and reviewer role boundaries

Confirmed backend domains:

- import orders
- import quotes
- trade profiles
- trade documents
- document extraction and OCR
- container shipments
- cargo reservations
- shipments and shipment timelines
- compliance reviews
- government document footprint
- payment milestones
- reputation records
- notification preferences
- audit logs

Confirmed Supabase staging tables:

- `diaspora_import_orders`
- `diaspora_import_quotes`
- `diaspora_trade_profiles`
- `diaspora_trade_documents`
- `diaspora_trade_document_extractions`
- `diaspora_trade_document_verifications`
- `diaspora_container_shipments`
- `diaspora_cargo_reservations`
- `diaspora_shipments`
- `diaspora_shipment_stage_events`
- `diaspora_compliance_reviews`
- `diaspora_payment_milestones`
- `diaspora_reputation_records`
- `diaspora_import_audit_log`
- `diaspora_import_order_participants`
- `diaspora_notification_preferences`

## 3. Product North Star

CarUp should become a vertical diaspora auto-trade platform, not a generic marketplace.

Generic commerce platforms solve product listing, inventory, payments, and fulfilment. CarUp must solve the harder vertical problem:

- part and vehicle compatibility;
- stock authenticity;
- buyer and seller trust;
- export readiness;
- import readiness;
- document verification;
- customs and duty readiness;
- container capacity and co-loading;
- escrow and milestone payments;
- shipment visibility;
- dispute handling;
- trade reputation;
- AI-assisted stock and order operations.

The winning positioning:

> CarUp is the operating system for diaspora vehicle and auto-parts trade.

## 4. Three Operating Modes

### 4.1 Online Account Mode

Subscribed members log into CarUp and manage stock, orders, supplier quotes, buyer requests, documents, container reservations, payments, compliance, and reputation directly from their accounts.

### 4.2 Offline Workbook Mode

Members download a workbook from CarUp, fill it offline, and upload it back. The backend validates the workbook through a dry-run parser before any write is accepted.

### 4.3 AI Command Mode

Members use text or voice commands such as:

- `Add 12 Honda Fit GD1 shocks to Japan stock.`
- `Reserve 2 Toyota Hiace 1KD injectors for order DIO-0008.`
- `Create an export order for 8 Nissan Caravan parts to Harare.`
- `Generate a quote for this Mazda Bongo buyer request.`

AI must never write directly to stock or operational records. It must create a validated command draft, require confirmation or approval where needed, then write through ledgered services.

## 5. Buyer and Seller Model

### 5.1 Diaspora Buyer

A diaspora buyer can:

- create part requests;
- create vehicle import requests;
- download buyer templates;
- upload completed workbook requests;
- attach documents;
- review quotes;
- pay milestones;
- track container and shipment status;
- save records to cloud drive;
- rate sellers and logistics partners.

### 5.2 Diaspora Seller / Supplier

A seller or supplier can:

- upload stock;
- publish verified supply documents;
- download seller templates;
- respond to RFQs;
- submit quotes;
- reserve stock;
- attach invoices and export documents;
- join container bookings;
- sync records with cloud drive;
- build reputation.

### 5.3 Admin / Reviewer / Government / Compliance Actor

A privileged reviewer can:

- verify trade profiles;
- verify trade documents;
- run or review OCR;
- approve or flag compliance reviews;
- approve suspicious or high-risk actions;
- review audit logs;
- manage release gates.

## 6. Workbook Strategy

The workbook is not the source of truth once uploaded. The source of truth is the CarUp database. The workbook is:

1. an offline input template;
2. an export/reporting format;
3. a bulk-edit surface;
4. an AI-command staging layer;
5. a portable business document;
6. a bridge for users who are not always online.

### 6.1 Downloadable Templates

CarUp should provide three template types:

#### Buyer Template

Purpose: allow diaspora buyers to request vehicles or parts offline.

Required sheets:

- `BUYER_REQUESTS`
- `BUYER_DOCUMENTS`
- `PAYMENT_PREFERENCES`
- `DELIVERY_DETAILS`
- `AI_COMMAND_CENTER`

#### Seller / Supplier Template

Purpose: allow sellers to upload stock and export-ready supply.

Required sheets:

- `SELLER_STOCK`
- `STOCK_COMPATIBILITY`
- `SUPPLIER_QUOTES`
- `EXPORT_READINESS`
- `PACKAGING_AND_DIMENSIONS`
- `AI_COMMAND_CENTER`

#### Enterprise Master Template

Purpose: allow enterprise partners, admins, and Universal Motors-type operators to manage full trade operations.

Required sheets:

- `TRADE_PROFILES`
- `DIASPORA_IMPORT_ORDERS`
- `IMPORT_QUOTES`
- `TRADE_DOCUMENTS`
- `CONTAINER_SHIPMENTS`
- `CARGO_RESERVATIONS`
- `SHIPMENTS`
- `COMPLIANCE_REVIEWS`
- `PAYMENT_MILESTONES`
- `REPUTATION_RECORDS`
- `AI_COMMAND_CENTER`
- `API_FIELD_MAPPING`
- `REF_STATUS_LISTS`
- `DIASPORA_DASHBOARD`

## 7. Online Stock and Order Editors

The website must not only download/upload workbooks. It must let subscribed users edit their active stock and active orders online.

### 7.1 Active Supply Document

Created by sellers. It represents export-ready stock.

Fields should include:

- stock batch ID;
- seller trade profile ID;
- part or vehicle reference;
- quantity;
- condition;
- OEM/aftermarket numbers;
- photos/documents;
- origin country and city;
- warehouse location;
- packaging and dimensions;
- price and currency;
- export readiness;
- valid-until date;
- verification status;
- publication status;
- stock passport link.

### 7.2 Active Order Document

Created by buyers. It represents a demand/order document.

Fields should include:

- import order ID;
- buyer trade profile ID;
- requested stock or vehicle;
- destination;
- urgency;
- budget;
- documents required;
- matched seller quotes;
- accepted quote;
- payment milestones;
- compliance status;
- container reservation;
- shipment tracking;
- order passport link.

## 8. Stock Passport and Order Passport

### 8.1 Stock Passport

Every uploaded stock item or batch should have a Stock Passport.

It should show:

- seller identity;
- stock source;
- part/vehicle compatibility;
- condition;
- photos and evidence;
- price history;
- quantity history;
- export readiness;
- customs category;
- verification status;
- dispute history;
- AI confidence score;
- audit trail.

### 8.2 Order Passport

Every buyer request should have an Order Passport.

It should show:

- buyer profile;
- requested items;
- matched sellers;
- quotes;
- accepted quote;
- documents;
- payments;
- container reservation;
- shipment timeline;
- customs/compliance;
- delivery state;
- dispute state;
- reputation outcome;
- audit trail.

## 9. AI Command Engine

AI should be treated as a controlled workflow executor, not a free-form editor.

### 9.1 Required AI Pipeline

1. receive text or voice command;
2. transcribe voice if applicable;
3. classify intent;
4. extract entities;
5. match entities to known stock, parts, vehicles, profiles, and orders;
6. calculate confidence score;
7. check subscription entitlement;
8. check role permission;
9. check business rules;
10. check duplicate command risk;
11. create draft action;
12. request confirmation or approval;
13. execute through service layer;
14. write audit event;
15. update dashboard and workbook export state.

### 9.2 AI Risk Tiers

#### Low Risk

Can become draft actions automatically:

- create draft buyer request;
- create draft supplier stock;
- attach note;
- classify document;
- prepare quote draft.

#### Medium Risk

Needs user confirmation:

- publish supply document;
- reserve stock;
- submit quote;
- create payment milestone;
- reserve container space.

#### High Risk

Needs reviewer/admin approval:

- verify profile;
- mark document verified;
- approve compliance;
- release escrow;
- mark shipment delivered;
- override stock ledger;
- cancel paid order;
- change customs clearance state.

## 10. Subscription and Entitlement Model

Diaspora trade features must be subscription-gated.

### 10.1 Plans

#### Diaspora Buyer Member

- create buyer requests;
- download buyer workbook;
- upload documents;
- track import orders;
- use limited AI assistant;
- save records to cloud drive.

#### Seller / Supplier Member

- upload stock;
- download seller workbook;
- respond to RFQs;
- publish supply documents;
- manage export-ready stock;
- use seller AI assistant.

#### Trade Pro Member

- bulk workbook upload;
- bulk workbook export;
- drive sync;
- multi-user team access;
- container reservations;
- priority verification;
- advanced analytics.

#### Enterprise Partner

- API access;
- branch/location management;
- staff roles;
- custom templates;
- advanced dashboard;
- dedicated trade operations workflows.

### 10.2 Entitlement Checks

Every protected operation must check:

- authenticated user;
- active subscription;
- allowed plan feature;
- role permission;
- tenant/profile ownership;
- operation risk level;
- approval requirement.

## 11. Cloud Drive Integrations

The feature should support user-owned document storage.

Initial targets:

- Google Drive;
- Microsoft OneDrive;
- Dropbox later;
- iCloud later only if product demand supports it.

### 11.1 Drive Folder Model

When connected, CarUp can create or request access to a user-approved folder structure:

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

### 11.2 Drive Security Rules

CarUp should store:

- provider name;
- drive file ID;
- file URL;
- checksum/hash;
- file owner;
- permission scope;
- linked order/profile/document ID;
- last sync state;
- revoked state.

CarUp should not assume permanent access. Revocation must be handled gracefully.

## 12. Trade Graph Intelligence

CarUp should build a connected trade graph:

```text
Buyer
→ Trade Profile
→ Order
→ Requested Part / Vehicle
→ Seller Stock
→ Seller Profile
→ Quote
→ Payment Milestone
→ Document
→ Container Reservation
→ Container
→ Shipment
→ Compliance Review
→ Delivery
→ Reputation
```

This graph lets AI answer:

- which seller is safest;
- which order is blocked by documents;
- which container should close;
- which stock should be exported first;
- which buyer is at payment risk;
- which supplier has high dispute risk;
- which route gives the best landed margin;
- which stock is dead stock;
- which demand clusters deserve procurement.

## 13. Reverse RFQ Marketplace

CarUp should support buyer-driven demand.

A buyer can post:

> Need 20 Honda Fit GD1 front shocks delivered to Harare.

Sellers can compete with quotes. AI compares:

- price;
- landed cost;
- supplier reputation;
- stock verification;
- shipping speed;
- container availability;
- payment risk;
- dispute risk.

## 14. Container Co-Loading Marketplace

Many diaspora buyers cannot fill a full container. CarUp should let multiple buyers and sellers share container space.

Core capabilities:

- open container booking;
- reserve CBM and weight;
- approve/reject cargo reservations;
- allocate freight cost;
- close booking when full;
- track loading;
- track shipment;
- split documents and charges per order.

Formulas and backend parity:

```text
USED_VOLUME = sum(approved reservation estimated_volume)
AVAILABLE_VOLUME = total_capacity_volume - used_capacity_volume
FILL_PERCENT = used_capacity_volume / total_capacity_volume
READY_TO_CLOSE = fill_percent >= 90%
FULL = fill_percent >= 98%
```

## 15. SafeTrade

CarUp should create a diaspora auto-trade assurance layer called SafeTrade.

SafeTrade should combine:

- verified buyer;
- verified seller;
- verified stock;
- verified documents;
- escrow or milestone payment;
- quote terms;
- container/shipment milestones;
- compliance approval;
- dispute handling;
- delivery confirmation;
- reputation update.

Payment release should depend on rules, not manual trust.

## 16. Security and Hardening

### 16.1 User Isolation

A user must never access another user's stock, orders, documents, drive files, or payments unless explicitly authorized through role, tenant, team, or participant membership.

### 16.2 Required Controls

- authentication;
- role authorization;
- subscription entitlement;
- tenant isolation;
- row-level security;
- server-side validation;
- workbook dry-run validation;
- audit logging;
- immutable stock ledger;
- document access control;
- signed URLs for private files;
- virus/malware scanning for uploads where available;
- OCR file size limits;
- AI confidence gates;
- approval queues;
- rate limiting;
- CSRF protection;
- idempotency keys for imports;
- duplicate workbook row detection;
- rollback-safe imports.

### 16.3 Stock Safety Rule

No user or AI process should overwrite stock totals directly.

Stock must be changed through ledger actions:

- add stock;
- remove stock;
- reserve stock;
- release reserved stock;
- mark damaged;
- mark returned;
- transfer location;
- adjustment with approval.

## 17. Workbook Import/Export Contract

### 17.1 Download

Users can download templates based on subscription and role.

### 17.2 Offline Edit

Users can edit offline. Required data validation lists and IDs must remain intact.

### 17.3 Upload

Upload must run dry-run validation first.

Dry-run output must show:

- rows accepted;
- rows rejected;
- warnings;
- duplicate IDs;
- invalid statuses;
- missing references;
- invalid dates;
- invalid quantities;
- permission conflicts;
- subscription conflicts;
- actions requiring approval.

### 17.4 Import

Only after user confirmation and server validation can records be written to database tables.

### 17.5 Export

Users can export current online data back into workbook format and optionally save it to connected cloud drive.

## 18. Backend Implementation Plan

### 18.1 New Routes

Create:

- `backend/routes/diasporaWorkbookRoutes.js`

Endpoints:

- `GET /api/diaspora/workbook/template-schema`
- `GET /api/diaspora/workbook/download-template`
- `POST /api/diaspora/workbook/dry-run`
- `POST /api/diaspora/workbook/import`
- `POST /api/diaspora/workbook/export`
- `POST /api/diaspora/workbook/save-to-drive`

### 18.2 New Services

Create:

- `backend/services/diaspora/diasporaWorkbookTemplateService.js`
- `backend/services/diaspora/diasporaWorkbookValidationService.js`
- `backend/services/diaspora/diasporaWorkbookSyncService.js`
- `backend/services/diaspora/diasporaAiCommandService.js`
- `backend/services/diaspora/diasporaStockLedgerService.js`
- `backend/services/diaspora/diasporaEntitlementService.js`
- `backend/services/diaspora/diasporaDriveSyncService.js`
- `backend/services/diaspora/diasporaTradeGraphService.js`

### 18.3 New or Extended Data Structures

Confirm whether existing tables are sufficient. If not, propose migrations for:

- stock items;
- stock ledger;
- supply documents;
- order documents;
- AI commands;
- cloud drive connections;
- workbook import batches;
- workbook import rows;
- subscription entitlements;
- trade graph snapshots.

Do not add migrations until schema design is reviewed.

## 19. Frontend Implementation Plan

Create or extend dashboard surfaces:

- `DiasporaTradeDashboard`
- `DiasporaStockManager`
- `DiasporaBuyerOrders`
- `DiasporaSellerSupplyDocuments`
- `DiasporaWorkbookCenter`
- `DiasporaAiCommandCenter`
- `DiasporaDriveConnections`
- `DiasporaContainerMarketplace`
- `DiasporaOrderPassport`
- `DiasporaStockPassport`
- `DiasporaComplianceQueue`
- `DiasporaPaymentMilestones`
- `DiasporaReputationPanel`

## 20. Agent Implementation Directive

Agents must implement incrementally.

### Phase 1: Planning and Verification

- Verify current diaspora routes.
- Verify Supabase staging schema.
- Verify subscription/payment service availability.
- Verify storage service and document intelligence flow.
- Produce schema gap report.

### Phase 2: Workbook Center

- Add template schema endpoint.
- Add template download endpoint.
- Add workbook dry-run endpoint.
- Add workbook import batch model if missing.
- Add tests proving dry-run writes nothing.

### Phase 3: Online Stock and Supply Documents

- Add seller stock editor.
- Add active supply document flow.
- Add stock ledger service.
- Prevent direct stock overwrite.

### Phase 4: Buyer Orders and Reverse RFQ

- Add buyer request editor.
- Add active order document flow.
- Match buyer demand against seller supply.
- Allow seller quote responses.

### Phase 5: AI Command Hardening

- Add command parsing contract.
- Add confidence score and duplicate guard.
- Add approval queue.
- Add audit logging.
- Add tests for low, medium, and high-risk commands.

### Phase 6: Container Co-Loading

- Add container marketplace UI.
- Add reservation capacity rules.
- Mirror workbook formulas server-side.
- Add tests for full/overfilled containers.

### Phase 7: Drive Integrations

- Start with Google Drive.
- Add provider abstraction for OneDrive later.
- Store only necessary file metadata and tokens securely.
- Support save/export/upload flows.

### Phase 8: Subscription Gate

- Add entitlement checks to every diaspora trade feature.
- Test free users are blocked.
- Test subscribed buyers and sellers get correct access.
- Test enterprise users get bulk/API features.

### Phase 9: SafeTrade

- Connect escrow/payment milestones to compliance and shipment states.
- Block release when payment or compliance is incomplete.
- Add dispute flow.

### Phase 10: Trade Graph Intelligence

- Build derived graph summaries.
- Expose AI-ready graph queries.
- Add dashboard intelligence.

## 21. Required Tests

Backend:

```bash
npm test -- diaspora
npm test -- workbook
npm test -- subscription
npm test -- ai-command
npx tsc --noEmit
```

Frontend:

```bash
npm run build
npx playwright test diaspora
npx playwright test workbook
npx playwright test subscriptions
```

Security tests:

- user cannot access another user's stock;
- unsubscribed user cannot download trade workbook;
- unsubscribed user cannot upload stock;
- AI command cannot bypass authorization;
- dry-run writes zero database records;
- invalid workbook statuses are rejected;
- overfilled containers are rejected;
- flagged compliance blocks release;
- unpaid milestones block release;
- drive token revocation is handled;
- duplicate workbook rows are idempotent or rejected safely.

## 22. Immediate Next Move

The next implementation should not be a large all-in-one PR.

Recommended next PR:

> Phase 1A: Diaspora Workbook Center and Dry-Run Validation

Scope:

- route registration;
- template schema endpoint;
- dry-run endpoint;
- workbook status constants;
- validation service;
- tests proving no writes occur;
- docs updated with this plan.

Do not implement AI, Drive, and subscriptions in the same PR. Those are follow-up hardening phases.
