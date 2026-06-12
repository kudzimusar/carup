# Diaspora Workbook Operator Console API — Phase 1H

This document covers the backend API design, status engine, and administrative controls implemented in Phase 1H to support the future operator review console interface.

## Scope & Purpose
The Operator Console API provides administrative visibility, risk analysis, internal notes, and administrative execution guards for uploaded workbook import batches. It is designed around a strict read-only boundary for target trade tables, permitting mutations only to the workbook batch metadata structure.

---

## 1. Endpoints List

All endpoints are mounted under `/api/diaspora` (for example, `/api/diaspora/workbook/operator-dashboard`) and require authenticated user contexts via the `authorizeRole` middleware.

| HTTP Method | Route Path | Access Scope / Roles | Description |
| :--- | :--- | :--- | :--- |
| **GET** | `/workbook/operator-dashboard` | Owner, Tenant Admin, Reviewer | Retrieve a paginated list of batches with totals and risk markers |
| **GET** | `/workbook/import-batches/:id/operator-summary` | Owner, Tenant Admin, Reviewer | Retrieve batch details, plan, audit summary, retry plan, and notes |
| **GET** | `/workbook/import-batches/:id/next-actions` | Owner, Tenant Admin, Reviewer | Retrieve safe allowed and forbidden operator actions |
| **POST** | `/workbook/import-batches/:id/operator-notes` | Owner, Tenant Admin, Reviewer | Append an internal operator note to the batch |
| **POST** | `/workbook/import-batches/:id/operator-hold` | Owner, Tenant Admin, Reviewer | Place an administrative hold on the batch |
| **DELETE** | `/workbook/import-batches/:id/operator-hold` | Owner, Tenant Admin, Reviewer | Remove the administrative hold from the batch |

---

## 2. Dashboard Payload Details

`GET /api/diaspora/workbook/operator-dashboard` returns a paginated list of items matching the following shape:

```json
{
  "items": [
    {
      "batchId": "uuid-batch-id",
      "templateType": "enterprise",
      "importStatus": "READY_FOR_REVIEW",
      "uploadedBy": "uuid-user-id",
      "tenantId": "uuid-tenant-id",
      "createdAt": "2026-06-11T23:00:00.000Z",
      "updatedAt": "2026-06-11T23:30:00.000Z",
      "totalRows": 12,
      "acceptedRows": 10,
      "warningRows": 2,
      "rejectedRows": 0,
      "errorCount": 0,
      "warningCount": 2,
      "draftImportExecuted": false,
      "liveImportExecuted": false,
      "aiExecuted": false,
      "needsReview": true,
      "hasFailures": false,
      "hasRetryableRows": false,
      "hasBlockedRows": false,
      "held": false,
      "holdReason": null,
      "nextRecommendedAction": "EXECUTE_DRAFTS",
      "riskLevel": "LOW",
      "summaryBadges": [
        "HAS_WARNINGS",
        "READY_FOR_REVIEW",
        "READY_FOR_DRAFT_EXECUTION"
      ]
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "count": 1
  },
  "totals": {
    "totalBatches": 1,
    "readyForReview": 1,
    "draftsImported": 0,
    "failedDraftImports": 0,
    "cancelled": 0,
    "held": 0
  }
}
```

### Dashboard Summary Badges
The console computes badges dynamically based on the state of the batch and its row diagnostics:
* `HAS_REJECTED_ROWS`: Batch contains rows with rejected validation status.
* `HAS_WARNINGS`: Batch contains rows with warning validation status.
* `READY_FOR_REVIEW`: Batch import status is `READY_FOR_REVIEW`.
* `READY_FOR_DRAFT_EXECUTION`: Status is `READY_FOR_REVIEW` with zero errors, zero rejected rows, and is not held.
* `DRAFTS_IMPORTED`: Batch status is `IMPORTED_DRAFTS` or `PARTIALLY_IMPORTED_DRAFTS`.
* `HAS_FAILED_DRAFT_ROWS`: Batch status is `FAILED_DRAFT_IMPORT` or `PARTIALLY_IMPORTED_DRAFTS`.
* `RETRY_REVIEW_NEEDED`: Batch contains failed but retryable draft import rows.
* `HELD_BY_OPERATOR`: Batch has an active operator hold.
* `BLOCKED`: Batch import status is `BLOCKED`.
* `AI_DRAFTS_PRESENT`: Batch contains rows under the `AI_COMMAND_CENTER` sheet.
* `REVIEW_ONLY_ROWS_PRESENT`: Batch contains rows with a `REVIEW_ONLY` action type.

---

## 3. Next-Action Engine Matrix

The next-action engine maps batch states to permitted (`allowed`), forbidden (`forbidden`), and warning states to prevent invalid or high-risk actions.

### Action Engine Rules Matrix

| Batch State | Active Hold | Validation Failures | Allowed Actions | Forbidden Actions | Next Recommended Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **VALIDATED** | No | No | `MARK_READY_FOR_REVIEW`, `PLACE_HOLD`, `CANCEL_BATCH`, `VIEW_DRY_RUN` | `EXECUTE_DRAFTS`, `EXECUTE_LIVE_IMPORT`, `EXECUTE_AI` | `MARK_READY_FOR_REVIEW` |
| **VALIDATED** | No | Yes | `PLACE_HOLD`, `CANCEL_BATCH`, `VIEW_DRY_RUN` | `MARK_READY_FOR_REVIEW`, `EXECUTE_DRAFTS` | `VIEW_ROWS` |
| **READY_FOR_REVIEW** | No | No | `EXECUTE_DRAFTS`, `PLACE_HOLD`, `CANCEL_BATCH` | `EXECUTE_LIVE_IMPORT`, `RETRY_DRAFT_IMPORT` | `EXECUTE_DRAFTS` |
| **READY_FOR_REVIEW** | Yes | No | `CLEAR_HOLD`, `CANCEL_BATCH` | `EXECUTE_DRAFTS` | `CLEAR_HOLD` |
| **IMPORTED_DRAFTS** | - | - | `VIEW_EXECUTION_AUDIT` | `EXECUTE_DRAFTS`, `CANCEL_BATCH` | `VIEW_EXECUTION_AUDIT` |
| **FAILED_DRAFT_IMPORT** | - | - | `VIEW_EXECUTION_AUDIT`, `VIEW_RETRY_PLAN` | `EXECUTE_DRAFTS`, `RETRY_DRAFT_IMPORT` (Phase 1H) | `VIEW_RETRY_PLAN` (if retryable rows present) |

### Forbidden Actions (Always Blocked)
The following actions are always returned in the `forbiddenActions` list as they represent functionality beyond Phase 1H scope:
* `EXECUTE_LIVE_IMPORT`
* `EXECUTE_AI`
* `RELEASE_PAYMENT`
* `APPROVE_COMPLIANCE`
* `VERIFY_DOCUMENT`
* `OVERWRITE_STOCK`
* `ROLLBACK_DRAFTS`
* `RETRY_DRAFT_IMPORT`

---

## 4. Operator Notes Schema

Notes are saved inside `metadata.operatorNotes` on the batch record. Note text presence is verified, and notes are capped at a maximum length of 2000 characters.

```json
{
  "id": "uuid-note-id",
  "note": "Note text content entered by operator",
  "createdAt": "2026-06-11T23:25:00.000Z",
  "createdBy": "uuid-user-id",
  "role": "reviewer",
  "visibility": "internal",
  "phase": "1H"
}
```

---

## 5. Operator Hold Schema & Guard

### Hold Metadata Shape
Holds are stored directly in `metadata.operatorHold` on the batch record:

```json
{
  "active": true,
  "reason": "Holding for manual document check",
  "placedAt": "2026-06-11T23:26:00.000Z",
  "placedBy": "uuid-user-id",
  "role": "reviewer",
  "phase": "1H"
}
```

When cleared, `active` is set to `false`, and `clearedAt`/`clearedBy` properties are appended.

### Execution Guard Check
Inside the draft import execution layer (`backend/services/diaspora/diasporaWorkbookImportExecutionService.js`), before any row processing occurs, the execution assertion check enforces:

```javascript
if (batch.metadata?.operatorHold?.active === true) {
  throw new ValidationError('WORKBOOK_BATCH_ON_OPERATOR_HOLD', {
    batchId: batch.id,
    importStatus: status,
    errorCode: 'WORKBOOK_BATCH_ON_OPERATOR_HOLD',
  });
}
```

Executing a draft import on a held batch returns a `400 Bad Request` with the error payload.

---

## 6. Phase 2 Recommendations

1. **Retry Engine Integration**: In Phase 2, connect `RETRY_DRAFT_IMPORT` using the retry plan built by the audit service, enabling selective row execution.
2. **Rollback Orchestrator**: Introduce automated draft reversal (`ROLLBACK_DRAFTS`) in case of partial import execution.
3. **Live Import Transition**: Once drafts are approved, implement the live transition flow to write official records to target trade tables, update stock quantities, and adjust compliance states.
