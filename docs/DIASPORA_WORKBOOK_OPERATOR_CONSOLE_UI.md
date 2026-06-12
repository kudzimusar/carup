# Diaspora Workbook Operator Console UI

Phase 2A adds a frontend shell for the Diaspora Trade OS workbook operator console.

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
- Selected batch summary
- Import plan summary
- Draft execution audit summary
- Retry plan read-only summary
- Next action indicators
- Blocked action indicators
- Operator notes
- Operator hold controls

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
