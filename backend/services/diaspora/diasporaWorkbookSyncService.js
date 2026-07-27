import { ValidationError } from '../../utils/errors.js';
import { validateDiasporaWorkbookDryRun } from './diasporaWorkbookValidationService.js';
import { persistDiasporaWorkbookDryRun } from './diasporaWorkbookPersistenceService.js';

export function runDiasporaWorkbookDryRun(payload = {}, userContext = {}) {
  return validateDiasporaWorkbookDryRun(payload, userContext);
}

export async function runAndPersistDiasporaWorkbookDryRun(payload = {}, userContext = {}, options = {}) {
  const dryRun = validateDiasporaWorkbookDryRun(payload, userContext);
  const persistence = await persistDiasporaWorkbookDryRun(payload, dryRun, userContext, options);

  return {
    ...dryRun,
    persistence,
  };
}

export async function importDiasporaWorkbook(payload = {}, userContext = {}) {
  const dryRun = validateDiasporaWorkbookDryRun(payload, userContext);
  if (!dryRun.canImport) {
    throw new ValidationError('Workbook import blocked by dry-run validation errors.', dryRun);
  }

  // Deliberately still refused — but the reason has changed, and the old message is now misleading.
  // Confirmed import is implemented (Deliverable B, Issue #127); it is simply not reachable through
  // this un-confirmed entry point, because a legitimate import must be bound to a checksum, a
  // dry-run revision, an expiry and an idempotency key. See
  // backend/services/diaspora/workbook/diasporaWorkbookConfirmedImportService.js.
  throw new ValidationError(
    'Direct workbook import is not permitted. Run a dry run, review the preview, then confirm it — '
    + 'POST /workbook/import-batches/:id/confirm followed by /execute. Confirmation binds the import '
    + 'to the exact workbook you reviewed, so an edited file cannot be imported by an old approval.',
    { ...dryRun, errorCode: 'CONFIRMATION_REQUIRED' },
  );
}

export async function exportDiasporaWorkbook() {
  throw new ValidationError('Workbook export is deferred until the workbook export/template generation phase.');
}

export async function saveDiasporaWorkbookToDrive() {
  throw new ValidationError('Drive save is deferred until the Drive integration phase.');
}
