# Diaspora Workbook Draft Import Audit and Recovery

Phase 1G adds read-only audit and recovery visibility for Phase 1F draft imports.
It does not broaden workbook import execution.

## Scope

Operators can inspect a persisted workbook batch and see which rows were executed,
skipped, failed, blocked, already executed, pending, not plannable, or at duplicate
execution risk.

The database remains the source of truth. The workbook remains an offline input,
review, and staging surface.

## Endpoints

- `GET /api/diaspora/workbook/import-batches/:id/execution-audit`
- `GET /api/diaspora/workbook/import-batches/:id/execution-rows`
- `GET /api/diaspora/workbook/import-batches/:id/failed-execution-rows`
- `GET /api/diaspora/workbook/import-batches/:id/retry-plan`

All endpoints use the existing workbook review access rules. They read only workbook
batch and row diagnostics and do not write live trade records.

## Retry Policy

Phase 1G only reports a retry plan. It does not execute retries.

Rows are retryable only when:

- the batch is `PARTIALLY_IMPORTED_DRAFTS` or `FAILED_DRAFT_IMPORT`
- the row has no `target_record_id`
- the row is failed or pending
- the row is still plannable
- the planned action is draft-safe
- the row is not review-only, ledger-required, blocked, rejected, or error-marked

Rows are non-retryable when they already produced a target record, succeeded before,
are blocked by the plan, are rejected/error rows, target review-only behavior, touch
stock ledger or stock totals, or would approve compliance/payment/document/shipment
or reputation state.

## Rollback Limitation

Rollback execution is not implemented in Phase 1G.

Audit responses include:

- `canRollback: false`
- `rollbackAvailable: false`
- `rollbackReason: ROLLBACK_ENGINE_NOT_IMPLEMENTED_PHASE_1G`

Rows with a created draft target record are marked as manual review rollback
candidates only. Phase 1G never deletes or reverses created draft records.

## Operator Workflow

1. Open the execution audit for a reviewed workbook batch.
2. Inspect `createdTargetRecords` for draft records created from workbook rows.
3. Inspect failed, skipped, blocked, duplicate-risk, and pending rows.
4. Review the read-only retry plan.
5. Escalate duplicate-risk and rollback candidates to manual review.

## Safety Boundaries

- No AI execution.
- No Drive OAuth or Drive sync.
- No frontend UI.
- No retry execution.
- No rollback execution.
- No stock quantity overwrite.
- No payment release.
- No compliance approval.
- No document verification.
- No shipment release, delivery, or completion.
- No automatic reputation creation.
- No production Supabase changes.
- No schema migration in Phase 1G.

## Phase 1H Recommendations

Phase 1H should define an operator-approved retry execution workflow, explicit
idempotency keys per target table, rollback design for draft-only records, and a UI
for reviewing audit status before any retry or rollback is allowed.
