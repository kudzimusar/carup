/**
 * Confirmed workbook import — UI feature flag (fail closed).
 *
 * VITE_DIASPORA_WORKBOOK_IMPORT_UI_ENABLED gates the frontend only. Distinct from the backend, which
 * refuses an unconfirmed import regardless, and from the entitlement gate
 * (`diaspora.workbook.bulk_import`) that decides whether a tenant may import at all. Turning this on
 * cannot widen what anyone is permitted to do — only whether they see the page.
 *
 * Read at call time and optional-chained so a Node context with no import.meta.env fails closed.
 */
export function workbookImportUiEnabled(): boolean {
  return import.meta.env?.VITE_DIASPORA_WORKBOOK_IMPORT_UI_ENABLED === 'true'
}
