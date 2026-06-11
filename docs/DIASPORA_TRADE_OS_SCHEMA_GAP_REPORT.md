# CarUp Diaspora Trade OS Schema Gap Report

## Scope

Phase 1B prepares the database for safe workbook uploads, stock import/export records, AI command drafts, and future Drive-linked documents.

This phase does not turn workbook dry-run into live import execution. It creates the persistence and audit foundations needed before live imports are enabled.

## Supabase target inspected

Target inspected: `carup-staging` / `eoyenigwevnxwwhyhaer`.

The staging project is active and healthy.

## Existing diaspora tables confirmed

The current staging schema already contains the core Diaspora Trade bounded context:

- `diaspora_cargo_reservations`
- `diaspora_compliance_reviews`
- `diaspora_container_shipments`
- `diaspora_import_audit_log`
- `diaspora_import_order_participants`
- `diaspora_import_orders`
- `diaspora_import_quotes`
- `diaspora_notification_preferences`
- `diaspora_payment_milestones`
- `diaspora_reputation_records`
- `diaspora_shipment_stage_events`
- `diaspora_shipments`
- `diaspora_trade_document_extractions`
- `diaspora_trade_document_verifications`
- `diaspora_trade_documents`
- `diaspora_trade_profiles`

These tables cover import orders, quotes, profiles, documents, OCR/extractions, containers, reservations, shipments, compliance, payments, reputation, notifications, participants, and audit.

## Missing Phase 1B foundation tables

The following tables were not present in staging and are required for the next safe layer:

- `diaspora_workbook_import_batches`
- `diaspora_workbook_import_rows`
- `diaspora_stock_items`
- `diaspora_stock_ledger`
- `diaspora_supply_documents`
- `diaspora_order_documents`
- `diaspora_ai_commands`
- `diaspora_drive_connections`
- `diaspora_drive_files`

## Why these tables are needed

### Workbook import batches and rows

Offline workbooks cannot be written directly into live trade tables. Each upload needs an audit envelope and row-by-row diagnostics.

Required capabilities:

- store uploader and tenant context
- store template type
- store dry-run output
- store accepted/rejected/warning row counts
- store row-level validation errors
- support idempotency
- prepare rollback strategy
- prevent blind writes

### Stock items and stock ledger

Users must manage stock online and offline, but stock totals must not be overwritten directly. A stock item table holds the current stock snapshot, while a ledger table records every action.

Required ledger actions:

- add stock
- remove stock
- reserve stock
- release reservation
- sell stock
- mark damaged
- return stock
- transfer location
- adjustment with approval

### Supply documents and order documents

The system plan requires Active Supply Documents for sellers and Active Order Documents for buyers.

Supply documents represent export-ready seller stock batches. Order documents represent buyer demand before or alongside live import orders.

### AI commands

AI text/voice commands need persistence before execution. Commands must store intent, confidence, risk level, approval state, execution state, target entity, extracted entities, and errors.

High-risk commands must never bypass approval.

### Drive connections and drive files

Future Drive integration needs metadata tables for user-owned file links, sync state, revocation state, and linked CarUp entities. This phase stores metadata only. Full OAuth/sync implementation is deferred.

## Security requirements

Every new table must have Row Level Security enabled.

Access model:

- platform admins may access all rows
- row creators may access their own rows
- tenant members may access tenant rows
- Drive connection rows are user-owned and should not be visible to other tenant members by default
- no public read/write policies

## Migration recommendation

Create a Phase 1B migration with:

1. helper functions for current user, platform admin, tenant membership, and generic row access
2. nine foundation tables
3. indexes for import lookup, stock lookup, AI command status, and drive file links
4. updated-at triggers
5. strict RLS policies
6. comments documenting table purpose

## Deferred items

The following should not be implemented in this phase:

- live workbook import execution into all diaspora tables
- Google Drive OAuth flow
- OneDrive integration
- AI voice transcription service
- stock passport UI
- order passport UI
- SafeTrade release automation
- Trade Graph intelligence

## Next implementation step

Apply the Phase 1B migration to staging first, verify advisors, then wire services to write workbook batch and row records after dry-run validation.
