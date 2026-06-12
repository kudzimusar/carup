# Diaspora Workbook Backend Hardening - Phase 1I

## Scope

Phase 1I hardens the already-built Diaspora workbook backend before any UI shell,
retry execution, rollback execution, or live import phase begins.

This phase is backend-only. It does not introduce a new product workflow.

## Services Reviewed

- `backend/routes/diasporaWorkbookRoutes.js`
- `backend/services/diaspora/diasporaWorkbookReviewService.js`
- `backend/services/diaspora/diasporaWorkbookImportPlanningService.js`
- `backend/services/diaspora/diasporaWorkbookImportExecutionService.js`
- `backend/services/diaspora/diasporaWorkbookImportAuditService.js`
- `backend/services/diaspora/diasporaWorkbookOperatorConsoleService.js`
- `backend/services/diaspora/diasporaWorkbookMetadataUtils.js`

## Endpoint Families Reviewed

- Workbook template and dry-run routes
- Import batch list, detail, rows, and summary routes
- Import planning route
- Draft execution route
- Execution audit, execution rows, failed rows, and retry-plan routes
- Operator dashboard, operator summary, next-action, notes, and hold routes
- Disabled import/export/Drive routes

## Access-Control Guarantees

- Workbook routes remain protected by the existing `authorizeRole` middleware.
- Service methods require an authenticated `userContext`.
- Batch access continues to be checked through existing review access rules.
- Inaccessible and missing batches return safe not-found errors.
- Reviewer/admin access follows the existing trusted role conventions.
- Normal users cannot read batches outside their accessible user or tenant scope.

## Batch-State Guarantees

- `CANCELLED` batches cannot execute draft imports.
- `IMPORTED_DRAFTS` batches cannot execute draft imports again.
- `IMPORTING_DRAFTS` batches are treated as already in progress.
- `FAILED_DRAFT_IMPORT` batches expose retry-plan visibility only.
- `PARTIALLY_IMPORTED_DRAFTS` batches expose retry-plan visibility only.
- `READY_FOR_REVIEW` batches can execute drafts only when validation is clean and no operator hold is active.
- Held batches fail execution with `WORKBOOK_BATCH_ON_OPERATOR_HOLD`.

## Metadata Safety Guarantees

Phase 1I adds defensive normalization for workbook batch metadata:

- malformed `metadata` becomes an empty object for workbook service reads/writes;
- malformed `operatorHold` becomes inactive rather than crashing summary/action checks;
- malformed `operatorNotes` becomes an empty internal notes list;
- malformed `statusTimeline` becomes an empty timeline;
- malformed row `import_result` becomes an empty result object.

These guards prevent malformed JSON values from breaking audit summaries, operator
summaries, hold checks, note appends, or retry-plan generation.

## Idempotency Guarantees

- Rows with `target_record_id` remain non-retryable.
- Rows with a successful prior execution remain non-retryable.
- Duplicate-risk rows remain non-retryable and require operator review.
- Failed safe draft rows without a target record may appear in the retry plan.
- The retry plan remains read-only and does not execute anything.

## Error-Handling Guarantees

- Missing and inaccessible batches return safe not-found errors.
- Held batch execution keeps the stable error code `WORKBOOK_BATCH_ON_OPERATOR_HOLD`.
- Workbook service database errors avoid surfacing raw Supabase error messages.
- Database error details are limited to safe table, operation, and error-code context.

## Observability Notes

No new logging was added in Phase 1I. Existing service responses already expose safe
batch IDs, statuses, action codes, and retry/audit classifications. Raw workbook
payloads, document contents, OAuth tokens, service-role keys, and other secrets are
not logged by this phase.

## Safety Boundaries

- No AI execution.
- No Drive/OAuth.
- No live import.
- No retry execution.
- No rollback execution.
- No stock overwrite.
- No payment release.
- No compliance approval.
- No document auto-verification.
- No shipment delivery or release automation.
- No automatic reputation creation.
- No production Supabase touch.
- No schema migration.
- No frontend UI.

## Known Limitations

- Retry remains planning visibility only.
- Rollback remains planning visibility only.
- Operator console endpoints are backend-only; no UI was added.
- Live import into final trade tables remains blocked.
- Metadata normalization does not repair historical malformed metadata in the database; it only makes service reads/writes safe.

## Future Phase 2 Readiness Gates

Before Phase 2A UI or any execution expansion:

- confirm Phase 1I hardening tests remain green;
- confirm production deployment checks are healthy;
- confirm staging failures are not code failures;
- add UI only after an explicit handoff approval;
- design retry execution separately with idempotency keys and operator approval;
- design rollback execution separately with draft-record reversal rules;
- keep AI execution, Drive/OAuth, stock changes, payments, compliance, documents, shipments, and reputation behind separate approval gates.
