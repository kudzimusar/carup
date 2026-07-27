import { WORKBOOK_SHEETS, getRequiredSheetsForTemplate, normalizeWorkbookTemplateType } from '../../constants/diaspora/diasporaWorkbookSchema.js';
import { DatabaseError, ValidationError } from '../../utils/errors.js';

const ROW_INSERT_CHUNK_SIZE = 500;

function normalizeHeader(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeRow(row = {}) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), value]));
}

function isBlankRow(row) {
  if (!row || typeof row !== 'object') return true;
  return Object.values(row).every((value) => normalizeCell(value) === '');
}

function parseSheetsPayload(payload = {}) {
  const sheets = payload.sheets || payload.workbook || payload;
  return sheets && typeof sheets === 'object' && !Array.isArray(sheets) ? sheets : {};
}

// `options` carries values the CALLER computed rather than the client supplying — notably the
// .xlsx upload route, which hashes the raw bytes itself and passes sourceChecksum/sourceFilename.
// Those were previously ignored here, so every workbook uploaded as .xlsx persisted with
// checksum_sha256 = NULL and could never be confirmed: POST /confirm refuses a batch with no
// recorded checksum (BATCH_CHECKSUM_MISSING). A server-computed checksum is more trustworthy than
// a client-declared one, so it wins.
function sourceMetadata(payload = {}, options = {}) {
  const source = payload.source || payload.file || payload.workbookFile || {};
  return {
    source_filename: options.sourceFilename || source.filename || source.name || payload.sourceFilename || null,
    source_mime_type: source.mimeType || source.mimetype || payload.sourceMimeType || null,
    source_file_size_bytes: source.sizeBytes || source.size || payload.sourceFileSizeBytes || null,
    source_storage_path: source.storagePath || payload.sourceStoragePath || null,
    source_drive_file_id: source.driveFileId || payload.sourceDriveFileId || null,
    checksum_sha256: options.sourceChecksum || source.checksumSha256 || source.sha256 || payload.checksumSha256 || null,
  };
}

function errorKey(finding) {
  return `${finding.sheetName || ''}:${Number(finding.rowIndex || 0)}`;
}

function findingsByRow(findings = []) {
  return findings.reduce((acc, finding) => {
    const key = errorKey(finding);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(finding);
    return acc;
  }, new Map());
}

export function buildWorkbookRowDiagnostics(payload = {}, dryRun = {}) {
  const templateType = normalizeWorkbookTemplateType(dryRun.templateType || payload.templateType);
  const sheets = parseSheetsPayload(payload);
  const errors = findingsByRow(dryRun.errors || []);
  const warnings = findingsByRow(dryRun.warnings || []);
  const diagnostics = [];

  for (const sheetName of getRequiredSheetsForTemplate(templateType)) {
    const definition = WORKBOOK_SHEETS[sheetName];
    const rawRows = Array.isArray(sheets[sheetName]) ? sheets[sheetName] : [];
    const rows = rawRows.map(normalizeRow).filter((row) => !isBlankRow(row));

    rows.forEach((row, index) => {
      const rowIndex = index + 2;
      const key = `${sheetName}:${rowIndex}`;
      const rowErrors = errors.get(key) || [];
      const rowWarnings = warnings.get(key) || [];
      const validationStatus = rowErrors.length > 0 ? 'REJECTED' : rowWarnings.length > 0 ? 'WARNING' : 'ACCEPTED';

      diagnostics.push({
        sheetName,
        workbookRowNumber: rowIndex,
        workbookRecordId: normalizeCell(row[definition.primaryKey]) || null,
        targetTable: definition.apiTable || null,
        actionType: validationStatus === 'REJECTED' ? 'ERROR' : 'UPSERT_DRAFT',
        rowPayload: row,
        normalizedPayload: row,
        validationStatus,
        validationErrors: rowErrors,
        validationWarnings: rowWarnings,
      });
    });
  }

  return diagnostics;
}

async function defaultSupabaseClient() {
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}

async function insertRowsInChunks(client, rows) {
  for (let index = 0; index < rows.length; index += ROW_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + ROW_INSERT_CHUNK_SIZE);
    const { error } = await client.from('diaspora_workbook_import_rows').insert(chunk);
    if (error) throw new DatabaseError(`Failed to persist workbook row diagnostics: ${error.message}`, error);
  }
}

function countDiagnosticsByStatus(diagnostics, status) {
  return diagnostics.filter((diagnostic) => diagnostic.validationStatus === status).length;
}

export async function persistDiasporaWorkbookDryRun(payload = {}, dryRun = {}, userContext = {}, options = {}) {
  const uploadedBy = userContext.id || userContext.userId;
  if (!uploadedBy) {
    throw new ValidationError('Cannot persist workbook dry-run without an authenticated user context.');
  }

  const client = options.supabaseClient || await defaultSupabaseClient();
  const tenantId = userContext.tenantId || null;
  const idempotencyKey = payload.idempotencyKey || payload.idempotency_key || dryRun.dryRunId;
  const source = sourceMetadata(payload, options);
  const diagnostics = buildWorkbookRowDiagnostics(payload, dryRun);
  const acceptedRows = countDiagnosticsByStatus(diagnostics, 'ACCEPTED');
  const warningRows = countDiagnosticsByStatus(diagnostics, 'WARNING');
  const rejectedRows = countDiagnosticsByStatus(diagnostics, 'REJECTED');

  const batchPayload = {
    tenant_id: tenantId,
    uploaded_by: uploadedBy,
    template_type: dryRun.templateType || normalizeWorkbookTemplateType(payload.templateType),
    ...source,
    idempotency_key: idempotencyKey,
    dry_run_result: {
      dryRunId: dryRun.dryRunId,
      dryRunOnly: dryRun.dryRunOnly,
      wroteToDatabase: dryRun.wroteToDatabase,
      canImport: dryRun.canImport,
      totals: dryRun.totals,
      summaries: dryRun.summaries,
      errors: dryRun.errors,
      warnings: dryRun.warnings,
    },
    total_rows: diagnostics.length,
    accepted_rows: acceptedRows,
    rejected_rows: rejectedRows,
    warning_count: dryRun.totals?.warningCount || warningRows,
    error_count: dryRun.totals?.errorCount || 0,
    import_status: dryRun.canImport ? 'VALIDATED' : 'BLOCKED',
    rollback_status: 'NOT_REQUIRED',
    metadata: {
      phase: '1C',
      persistedFrom: 'workbook_dry_run',
      dryRunId: dryRun.dryRunId,
      requestId: options.req?.headers?.['x-request-id'] || options.req?.headers?.['x-correlation-id'] || null,
    },
    created_by: uploadedBy,
    updated_by: uploadedBy,
  };

  const { data: batch, error: batchError } = await client
    .from('diaspora_workbook_import_batches')
    .insert(batchPayload)
    .select()
    .single();

  if (batchError) {
    throw new DatabaseError(`Failed to persist workbook dry-run batch: ${batchError.message}`, batchError);
  }

  const rowPayloads = diagnostics.map((diagnostic) => ({
    tenant_id: tenantId,
    batch_id: batch.id,
    sheet_name: diagnostic.sheetName,
    workbook_row_number: diagnostic.workbookRowNumber,
    workbook_record_id: diagnostic.workbookRecordId,
    target_table: diagnostic.targetTable,
    target_record_id: null,
    action_type: diagnostic.actionType,
    row_payload: diagnostic.rowPayload,
    normalized_payload: diagnostic.normalizedPayload,
    validation_status: diagnostic.validationStatus,
    validation_errors: diagnostic.validationErrors,
    validation_warnings: diagnostic.validationWarnings,
    import_result: {},
    metadata: {
      phase: '1C',
      dryRunId: dryRun.dryRunId,
    },
    created_by: uploadedBy,
    updated_by: uploadedBy,
  }));

  await insertRowsInChunks(client, rowPayloads);

  return {
    batchId: batch.id,
    rowDiagnosticsPersisted: rowPayloads.length,
    acceptedRows,
    warningRows,
    rejectedRows,
    importStatus: batch.import_status,
    persisted: true,
  };
}
