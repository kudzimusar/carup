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

  throw new ValidationError(
    'Workbook import execution is intentionally disabled in Phase 1C. Dry-run results are persisted for review, but live trade-table writes remain disabled until import mapping is approved.',
    dryRun,
  );
}

export async function exportDiasporaWorkbook() {
  throw new ValidationError('Workbook export is deferred until the workbook export/template generation phase.');
}

export async function saveDiasporaWorkbookToDrive() {
  throw new ValidationError('Drive save is deferred until the Drive integration phase.');
}
