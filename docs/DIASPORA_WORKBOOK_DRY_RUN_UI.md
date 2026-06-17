# Diaspora Workbook Dry-Run UI

Phase 2C adds a frontend intake surface for workbook dry-runs while matching the backend contract that exists today.

## Route

- `/admin/diaspora/workbooks/new`

The route is available to authenticated workbook operator roles:

- `admin`
- `platform_admin`
- `super_admin`
- `government`
- `government_reviewer`
- `reviewer`

## Backend Endpoints Consumed

- `GET /api/diaspora/workbook/template-schema`
- `GET /api/diaspora/workbook/download-template`
- `POST /api/diaspora/workbook/dry-run`

## Scope

The UI supports:

- Template type selection
- Template schema preview
- JSON workbook file intake
- JSON paste/edit intake
- Local structural JSON parsing
- Dry-run submission
- Validation result rendering
- Persisted batch confirmation
- Navigation back to the workbook operator console

## JSON-Only Intake

Phase 2C does not add XLSX parsing. Operators can provide workbook data as JSON only.

Accepted shapes:

```json
{
  "sheets": {
    "TRADE_PROFILES": [],
    "DIASPORA_IMPORT_ORDERS": []
  }
}
```

```json
{
  "workbook": {
    "TRADE_PROFILES": [],
    "DIASPORA_IMPORT_ORDERS": []
  }
}
```

Before submission, the UI normalizes either shape into:

```json
{
  "sheets": {}
}
```

The browser rejects invalid JSON, root arrays, missing `sheets`/`workbook` objects, non-object sheet containers, non-array sheet values, empty input, and non-JSON file types.

## Dry-Run Payload

The UI sends:

```json
{
  "templateType": "enterprise",
  "idempotencyKey": "client-generated-uuid",
  "source": {
    "filename": null,
    "mimeType": "application/json",
    "sizeBytes": 1234
  },
  "sheets": {}
}
```

Raw files are never sent to the backend.

## Template Download Limitation

`GET /api/diaspora/workbook/download-template` currently returns schema JSON and `downloadReady: false`.

The UI displays that binary XLSX template download is unavailable and does not render a fake download action.

## Persistence Behavior

`POST /api/diaspora/workbook/dry-run` validates the workbook JSON and persists:

- A workbook import batch record
- Row diagnostic records

The dry-run persists data for operator review only. It does not write to live trade tables.

## Validation Result Behavior

The result view shows:

- Dry-run ID
- Persisted batch ID
- Template type
- `canImport`
- Total, accepted, warning, rejected, error, and warning counts
- Persistence status
- Import status
- Sheet summaries
- Error findings
- Warning findings

The UI distinguishes validated-for-review batches from batches blocked by validation errors and from live import execution.

## Explicit Non-Goals

Phase 2C does not add:

- XLSX parsing
- Binary template generation
- Live trade-table writes
- Execute-drafts controls
- Retry execution
- Rollback execution
- AI execution
- Drive/OAuth
- Production Supabase changes
- Backend dry-run behavior changes

## Future XLSX Recommendation

A future XLSX phase should add an approved parser/generator dependency, explicit backend binary upload handling, binary template generation, and end-to-end tests before presenting XLSX as supported.
