import { ValidationError } from '../../utils/errors.js';
import { validateDiasporaWorkbookDryRun } from './diasporaWorkbookValidationService.js';

export function runDiasporaWorkbookDryRun(payload = {}, userContext = {}) {
  return validateDiasporaWorkbookDryRun(payload, userContext);
}

export async function importDiasporaWorkbook(payload = {}, userContext = {}) {
  const dryRun = validateDiasporaWorkbookDryRun(payload, userContext);
  if (!dryRun.canImport) {
    throw new ValidationError('Workbook import blocked by dry-run validation errors.', dryRun);
  }

  throw new ValidationError(
    'Workbook import execution is intentionally disabled in Phase 1A. Use dry-run until schema gap review and write mapping are approved.',
    dryRun,
  );
}

export async function exportDiasporaWorkbook() {
  throw new ValidationError('Workbook export is deferred until Phase 1B after dry-run validation is proven.');
}

export async function saveDiasporaWorkbookToDrive() {
  throw new ValidationError('Drive save is deferred until the Drive integration phase.');
}
