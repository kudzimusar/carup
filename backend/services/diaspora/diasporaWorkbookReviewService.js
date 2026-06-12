import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { WORKBOOK_IMPORT_STATUSES } from '../../constants/diaspora/diasporaWorkbookImportStatuses.js';
import { normalizeWorkbookBatchMetadata } from './diasporaWorkbookMetadataUtils.js';

const PLATFORM_REVIEW_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'government_reviewer', 'reviewer']);

async function defaultSupabaseClient() {
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}

function normalizeLimit(value, fallback = 50, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function actorId(userContext = {}) {
  return userContext.id || userContext.userId;
}

function isReviewer(userContext = {}) {
  return PLATFORM_REVIEW_ROLES.has(String(userContext.platformRole || userContext.baseRole || userContext.role || '').toLowerCase());
}

function assertAuthenticated(userContext = {}) {
  if (!actorId(userContext)) {
    throw new ValidationError('Workbook import review requires an authenticated user context.');
  }
}

function canAccessBatch(batch = {}, userContext = {}) {
  const userId = actorId(userContext);
  if (!batch || !userId) return false;
  if (isReviewer(userContext)) return true;
  if (batch.uploaded_by === userId || batch.created_by === userId || batch.updated_by === userId) return true;
  return Boolean(userContext.tenantId && batch.tenant_id === userContext.tenantId);
}

function assertBatchAccess(batch, userContext) {
  if (!batch || batch.deleted_at || !canAccessBatch(batch, userContext)) {
    throw new NotFoundError('Diaspora workbook import batch not found.');
  }
}

function applyAccessScope(query, userContext = {}) {
  if (isReviewer(userContext)) return query;

  const userId = actorId(userContext);
  const filters = [
    `uploaded_by.eq.${userId}`,
    `created_by.eq.${userId}`,
    `updated_by.eq.${userId}`,
  ];

  if (userContext.tenantId) filters.unshift(`tenant_id.eq.${userContext.tenantId}`);
  return query.or(filters.join(','));
}

function applyOptionalBatchFilters(query, filters = {}) {
  let scoped = query;
  if (filters.status) scoped = scoped.eq('import_status', String(filters.status).toUpperCase());
  if (filters.templateType) scoped = scoped.eq('template_type', filters.templateType);
  return scoped;
}

function applyOptionalRowFilters(query, filters = {}) {
  let scoped = query;
  if (filters.validationStatus) scoped = scoped.eq('validation_status', String(filters.validationStatus).toUpperCase());
  if (filters.sheetName) scoped = scoped.eq('sheet_name', String(filters.sheetName).toUpperCase());
  return scoped;
}

function incrementGroupCount(groups, key) {
  const normalizedKey = key || 'UNSPECIFIED';
  groups[normalizedKey] = (groups[normalizedKey] || 0) + 1;
}

function groupRows(rows = [], column) {
  return rows.reduce((groups, row) => {
    incrementGroupCount(groups, row[column]);
    return groups;
  }, {});
}

function safeDatabaseDetails(table, operation, error = {}) {
  return {
    table,
    operation,
    errorCode: error.code || null,
  };
}

export async function listDiasporaWorkbookImportBatches(filters = {}, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  const client = options.supabaseClient || await defaultSupabaseClient();
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);

  let query = client
    .from('diaspora_workbook_import_batches')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  query = applyAccessScope(query, userContext);
  query = applyOptionalBatchFilters(query, filters);

  const { data, error } = await query;
  if (error) throw new DatabaseError('Failed to list workbook import batches.', safeDatabaseDetails('diaspora_workbook_import_batches', 'select', error));

  const rows = (data || []).filter((batch) => canAccessBatch(batch, userContext));
  return {
    data: rows,
    pagination: { limit, offset, count: rows.length },
  };
}

export async function getDiasporaWorkbookImportBatch(batchId, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  if (!batchId) throw new ValidationError('Workbook import batch id is required.');

  const client = options.supabaseClient || await defaultSupabaseClient();
  const { data, error } = await client
    .from('diaspora_workbook_import_batches')
    .select('*')
    .eq('id', batchId)
    .is('deleted_at', null)
    .single();

  if (error || !data) throw new NotFoundError('Diaspora workbook import batch not found.');
  assertBatchAccess(data, userContext);
  return data;
}

export async function listDiasporaWorkbookImportRows(batchId, filters = {}, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  const client = options.supabaseClient || await defaultSupabaseClient();
  await getDiasporaWorkbookImportBatch(batchId, userContext, { supabaseClient: client });

  const limit = normalizeLimit(filters.limit, 100, 500);
  const offset = normalizeOffset(filters.offset);
  let query = client
    .from('diaspora_workbook_import_rows')
    .select('*')
    .eq('batch_id', batchId)
    .is('deleted_at', null)
    .order('sheet_name', { ascending: true })
    .order('workbook_row_number', { ascending: true })
    .range(offset, offset + limit - 1);

  query = applyOptionalRowFilters(query, filters);

  const { data, error } = await query;
  if (error) throw new DatabaseError('Failed to list workbook import rows.', safeDatabaseDetails('diaspora_workbook_import_rows', 'select', error));

  return {
    data: data || [],
    pagination: { limit, offset, count: (data || []).length },
  };
}

export async function getWorkbookImportBatchSummary(batchId, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  const client = options.supabaseClient || await defaultSupabaseClient();
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, { supabaseClient: client });

  const { data, error } = await client
    .from('diaspora_workbook_import_rows')
    .select('sheet_name,validation_status,target_table,action_type')
    .eq('batch_id', batch.id)
    .is('deleted_at', null);

  if (error) throw new DatabaseError('Failed to summarize workbook import rows.', safeDatabaseDetails('diaspora_workbook_import_rows', 'select', error));

  const rows = data || [];
  const rowsByValidationStatus = groupRows(rows, 'validation_status');

  return {
    batchId: batch.id,
    importStatus: batch.import_status,
    templateType: batch.template_type,
    totalRows: Number(batch.total_rows || rows.length || 0),
    acceptedRows: Number(batch.accepted_rows || rowsByValidationStatus.ACCEPTED || 0),
    warningRows: Number(rowsByValidationStatus.WARNING || 0),
    rejectedRows: Number(batch.rejected_rows || rowsByValidationStatus.REJECTED || 0),
    errorCount: Number(batch.error_count || 0),
    warningCount: Number(batch.warning_count || rowsByValidationStatus.WARNING || 0),
    rowsBySheet: groupRows(rows, 'sheet_name'),
    rowsByValidationStatus,
    rowsByTargetTable: groupRows(rows, 'target_table'),
    rowsByActionType: groupRows(rows, 'action_type'),
  };
}

function assertCanCancel(batch) {
  if (batch.import_status === WORKBOOK_IMPORT_STATUSES.CANCELLED) return;
  if ([
    WORKBOOK_IMPORT_STATUSES.IMPORTING_DRAFTS,
    WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS,
    WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS,
  ].includes(batch.import_status)) {
    throw new ValidationError('Workbook import batch cannot be cancelled after import execution has started.', {
      batchId: batch.id,
      importStatus: batch.import_status,
    });
  }
}

function assertCanMarkReady(batch) {
  if (batch.import_status === WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW) return;
  if (batch.import_status === WORKBOOK_IMPORT_STATUSES.CANCELLED) {
    throw new ValidationError('Cancelled workbook import batches cannot be marked ready for review.', {
      batchId: batch.id,
      importStatus: batch.import_status,
    });
  }
  if (Number(batch.rejected_rows || 0) > 0 || Number(batch.error_count || 0) > 0) {
    throw new ValidationError('Workbook import batch has rejected rows or errors and cannot be marked ready for review.', {
      batchId: batch.id,
      rejectedRows: batch.rejected_rows,
      errorCount: batch.error_count,
    });
  }
}

async function updateBatchReviewStatus(batchId, nextStatus, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  const client = options.supabaseClient || await defaultSupabaseClient();
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, { supabaseClient: client });
  const userId = actorId(userContext);

  if (nextStatus === WORKBOOK_IMPORT_STATUSES.CANCELLED) assertCanCancel(batch);
  if (nextStatus === WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW) assertCanMarkReady(batch);

  const metadata = {
    ...normalizeWorkbookBatchMetadata(batch.metadata),
    phase: '1D',
    reviewAction: nextStatus === WORKBOOK_IMPORT_STATUSES.CANCELLED ? 'cancelled' : 'marked_ready_for_review',
    reviewActionAt: new Date().toISOString(),
    reviewActionBy: userId,
    liveImportExecuted: false,
  };

  const { data, error } = await client
    .from('diaspora_workbook_import_batches')
    .update({
      import_status: nextStatus,
      metadata,
      updated_by: userId,
    })
    .eq('id', batch.id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to update workbook import batch review status.', safeDatabaseDetails('diaspora_workbook_import_batches', 'update', error));
  return {
    data,
    liveImportExecuted: false,
  };
}

export function cancelDiasporaWorkbookImportBatch(batchId, userContext = {}, options = {}) {
  return updateBatchReviewStatus(batchId, WORKBOOK_IMPORT_STATUSES.CANCELLED, userContext, options);
}

export function markDiasporaWorkbookImportBatchReady(batchId, userContext = {}, options = {}) {
  return updateBatchReviewStatus(batchId, WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW, userContext, options);
}
