import { ValidationError } from '../../utils/errors.js';
import { validateDiasporaWorkbookDryRun } from './diasporaWorkbookValidationService.js';
import { persistDiasporaWorkbookDryRun } from './diasporaWorkbookPersistenceService.js';
import { resolveClient } from './diasporaServiceUtils.js';
// Enforcement via the GUARD (no-op while DIASPORA_SUBSCRIPTION_ENFORCEMENT is off, which is default).
import { requireFeature } from './diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../constants/diaspora/diasporaEntitlements.js';

export function runDiasporaWorkbookDryRun(payload = {}, userContext = {}) {
  return validateDiasporaWorkbookDryRun(payload, userContext);
}

/**
 * The single upload funnel: BOTH upload routes (JSON dry-run and base64 .xlsx dry-run) come through
 * here, so this is the one place diaspora.workbook.upload needs gating. Gating the two routes
 * separately would be two chances to forget.
 *
 * The validation runs first and is deliberately NOT gated: telling a user their workbook is malformed
 * costs nothing and is more useful than a plan error. What is gated is PERSISTING it.
 */
export async function runAndPersistDiasporaWorkbookDryRun(payload = {}, userContext = {}, options = {}) {
  const dryRun = validateDiasporaWorkbookDryRun(payload, userContext);

  const client = await resolveClient(options);
  await requireFeature(client, {
    tenantId: userContext.tenantId || null,
    userId: userContext.id || userContext.userId || null,
    featureKey: FEATURE_KEYS.WORKBOOK_UPLOAD,
  });

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
