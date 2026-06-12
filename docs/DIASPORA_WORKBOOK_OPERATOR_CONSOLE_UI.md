# Diaspora Workbook Operator Console UI

Phase 2A added a frontend shell for the Diaspora Trade OS workbook operator console.
Phase 2B stabilizes that shell with safer navigation discoverability, explicit loading/empty/error states, defensive API-state rendering, and read-only guardrail indicators.

## Route

- `/admin/diaspora/workbooks`

The route is available to authenticated reviewer/operator roles only:

- `admin`
- `platform_admin`
- `super_admin`
- `government`
- `government_reviewer`
- `reviewer`

## API Consumption

The UI consumes the existing Phase 1H backend operator APIs:

- `GET /api/diaspora/workbook/operator-dashboard`
- `GET /api/diaspora/workbook/import-batches/:id/operator-summary`
- `GET /api/diaspora/workbook/import-batches/:id/next-actions`
- `POST /api/diaspora/workbook/import-batches/:id/operator-notes`
- `POST /api/diaspora/workbook/import-batches/:id/operator-hold`
- `DELETE /api/diaspora/workbook/import-batches/:id/operator-hold`

## Console Panels

- Dashboard batch list and filters
- Dashboard loading, empty, and error states
- Dashboard reset filters control
- Selected batch summary
- Selected batch loading and error states
- Import plan summary
- Draft execution audit summary
- Retry plan read-only summary
- Next action indicators
- Blocked action indicators
- Operator notes
- Operator hold controls

## Navigation

The console is discoverable from guarded admin/government dashboard sidebar navigation as `Workbook Console`.

It is not exposed in public navigation or normal buyer/seller navigation.

## Phase 2B Guardrail Indicators

The UI renders these read-only blocked indicators:

- Live import is not available.
- Retry execution is not available.
- Rollback execution is not available.
- AI execution is not available.
- Drive/OAuth is not available.

These indicators are labels only. They are not buttons and do not call execution endpoints.

## API-State Handling

Phase 2B keeps the console resilient when optional backend fields are missing or malformed:

- Dashboard items and totals fall back safely.
- Missing summaries, audit data, retry plans, notes, warnings, and next actions render empty-state copy instead of crashing.
- Unknown action names are labelized as read-only indicators.
- Active holds with no reason show a safe fallback.
- Note, hold, and clear-hold success paths refresh both the dashboard and selected batch summary.
- Note and hold controls prevent repeat submission while requests are in flight.

## Explicit Non-Goals

This UI does not add or expose controls for:

- AI execution
- Google Drive/OAuth
- Live workbook import execution
- Retry execution
- Rollback execution
- Stock quantity overwrite
- Payment release
- Compliance approval
- Document auto-verification
- Shipment delivery, release, or completion automation
- Reputation automation
- Production Supabase changes

## Safety Notes

The forbidden action panel renders blocked actions as read-only indicators, not buttons. In particular, the UI does not call `execute-drafts`, retry, rollback, AI, payment, stock overwrite, compliance approval, document verification, shipment release, or live import endpoints.
