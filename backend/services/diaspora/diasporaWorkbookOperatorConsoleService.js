import crypto from 'crypto';
import { WORKBOOK_IMPORT_ACTION_TYPES } from '../../constants/diaspora/diasporaWorkbookImportMap.js';
import { WORKBOOK_IMPORT_STATUSES } from '../../constants/diaspora/diasporaWorkbookImportStatuses.js';
import { DatabaseError, ValidationError, NotFoundError } from '../../utils/errors.js';
import { buildWorkbookImportPlan } from './diasporaWorkbookImportPlanningService.js';
import { getDiasporaWorkbookDraftImportAudit } from './diasporaWorkbookImportAuditService.js';
import {
  getDiasporaWorkbookImportBatch,
  listDiasporaWorkbookImportRows,
  listDiasporaWorkbookImportBatches,
} from './diasporaWorkbookReviewService.js';
import {
  normalizeOperatorHold,
  normalizeOperatorNotes,
  normalizeStatusTimeline,
  normalizeWorkbookBatchMetadata,
} from './diasporaWorkbookMetadataUtils.js';

async function defaultSupabaseClient() {
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}

function actorId(userContext = {}) {
  return userContext.id || userContext.userId || null;
}

function assertAuthenticated(userContext = {}) {
  if (!actorId(userContext)) {
    throw new ValidationError('Operator console action requires an authenticated user context.');
  }
}

function normalizeBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
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

function safeDatabaseDetails(table, operation, error = {}) {
  return {
    table,
    operation,
    errorCode: error.code || null,
  };
}

export async function getDiasporaWorkbookOperatorDashboard(filters = {}, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  
  // Reuse existing scoping from listDiasporaWorkbookImportBatches
  const allBatchesResult = await listDiasporaWorkbookImportBatches({ limit: 1000, offset: 0 }, userContext, options);
  const batches = allBatchesResult.data || [];
  
  // Calculate Totals before filtering (but scoped to the user context)
  const totals = {
    totalBatches: batches.length,
    readyForReview: batches.filter((b) => b.import_status === WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW).length,
    draftsImported: batches.filter((b) => [
      WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS,
      WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS
    ].includes(b.import_status)).length,
    failedDraftImports: batches.filter((b) => b.import_status === WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT).length,
    cancelled: batches.filter((b) => b.import_status === WORKBOOK_IMPORT_STATUSES.CANCELLED).length,
    held: batches.filter((b) => normalizeOperatorHold(normalizeWorkbookBatchMetadata(b.metadata))?.active === true).length,
  };

  // Perform filtering
  let filtered = [...batches];

  if (filters.status) {
    const statusUpper = String(filters.status).toUpperCase();
    filtered = filtered.filter((b) => b.import_status === statusUpper);
  }

  if (filters.templateType) {
    filtered = filtered.filter((b) => b.template_type === filters.templateType);
  }

  const heldFilter = normalizeBoolean(filters.held);
  if (heldFilter !== null) {
    filtered = filtered.filter((b) => Boolean(normalizeOperatorHold(normalizeWorkbookBatchMetadata(b.metadata))?.active) === heldFilter);
  }

  if (filters.uploadedBy) {
    filtered = filtered.filter((b) => b.uploaded_by === filters.uploadedBy);
  }

  if (filters.tenantId) {
    filtered = filtered.filter((b) => b.tenant_id === filters.tenantId);
  }

  // Calculate detailed row properties lazily per batch
  const items = [];
  for (const batch of filtered) {
    const metadata = normalizeWorkbookBatchMetadata(batch.metadata);
    const operatorHold = normalizeOperatorHold(metadata);
    const rowsResult = await listDiasporaWorkbookImportRows(batch.id, { limit: 1000 }, userContext, options);
    const rows = rowsResult.data || [];
    const plan = buildWorkbookImportPlan(batch, rows, userContext);
    
    let auditSummary = null;
    let retryPlan = null;
    let hasFailures = false;
    let hasRetryableRows = false;
    let hasBlockedRows = false;
    let hasAiDrafts = rows.some((r) => r.sheet_name === 'AI_COMMAND_CENTER');
    let hasReviewOnly = rows.some((r) => r.action_type === 'REVIEW_ONLY' || r.actionType === 'REVIEW_ONLY');

    const draftExecuted = Boolean(metadata.draftImportExecuted);
    const isFailedStatus = batch.import_status === WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT;
    const isPartialStatus = batch.import_status === WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS;
    
    if (draftExecuted || isFailedStatus || isPartialStatus) {
      try {
        auditSummary = await getDiasporaWorkbookDraftImportAudit(batch.id, userContext, options);
        retryPlan = auditSummary.retryPlan || null;
        hasFailures = (auditSummary.totals?.failedRows || 0) > 0;
        hasRetryableRows = (auditSummary.totals?.retryableRows || 0) > 0;
        hasBlockedRows = (auditSummary.totals?.blockedRows || 0) > 0;
      } catch (e) {
        // Fallback if audit loading fails
      }
    }

    const needsReview = [
      WORKBOOK_IMPORT_STATUSES.VALIDATED,
      WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW
    ].includes(batch.import_status) || hasRetryableRows;

    // Filter items in-memory based on row-level filters
    const filterNeedsReview = normalizeBoolean(filters.needsReview);
    if (filterNeedsReview !== null && needsReview !== filterNeedsReview) continue;

    const filterHasFailures = normalizeBoolean(filters.hasFailures);
    if (filterHasFailures !== null && hasFailures !== filterHasFailures) continue;

    const filterHasRetryable = normalizeBoolean(filters.hasRetryableRows);
    if (filterHasRetryable !== null && hasRetryableRows !== filterHasRetryable) continue;

    // Next Actions Check
    const nextActionRes = getBatchNextActions(batch, plan, hasFailures, hasRetryableRows);
    
    // Badges construction
    const summaryBadges = [];
    if (Number(batch.rejected_rows || 0) > 0) summaryBadges.push('HAS_REJECTED_ROWS');
    if (Number(batch.warning_count || 0) > 0) summaryBadges.push('HAS_WARNINGS');
    if (batch.import_status === WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW) summaryBadges.push('READY_FOR_REVIEW');
    
    const isExecutable = batch.import_status === WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW &&
      Number(batch.rejected_rows || 0) === 0 &&
      Number(batch.error_count || 0) === 0 &&
      operatorHold?.active !== true;
    if (isExecutable) summaryBadges.push('READY_FOR_DRAFT_EXECUTION');
    
    if ([WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS, WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS].includes(batch.import_status)) {
      summaryBadges.push('DRAFTS_IMPORTED');
    }
    if ([WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT, WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS].includes(batch.import_status)) {
      summaryBadges.push('HAS_FAILED_DRAFT_ROWS');
    }
    if (hasRetryableRows && (isFailedStatus || isPartialStatus)) {
      summaryBadges.push('RETRY_REVIEW_NEEDED');
    }
    if (operatorHold?.active === true) {
      summaryBadges.push('HELD_BY_OPERATOR');
    }
    if (batch.import_status === WORKBOOK_IMPORT_STATUSES.BLOCKED) {
      summaryBadges.push('BLOCKED');
    }
    if (hasAiDrafts) {
      summaryBadges.push('AI_DRAFTS_PRESENT');
    }
    if (hasReviewOnly) {
      summaryBadges.push('REVIEW_ONLY_ROWS_PRESENT');
    }

    items.push({
      batchId: batch.id,
      templateType: batch.template_type,
      importStatus: batch.import_status,
      uploadedBy: batch.uploaded_by,
      tenantId: batch.tenant_id,
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
      totalRows: Number(batch.total_rows || 0),
      acceptedRows: Number(batch.accepted_rows || 0),
      warningRows: Number(batch.warning_count || 0),
      rejectedRows: Number(batch.rejected_rows || 0),
      errorCount: Number(batch.error_count || 0),
      warningCount: Number(batch.warning_count || 0),
      draftImportExecuted: draftExecuted,
      liveImportExecuted: Boolean(metadata.liveImportExecuted),
      aiExecuted: Boolean(metadata.aiExecuted),
      needsReview,
      hasFailures,
      hasRetryableRows,
      hasBlockedRows,
      held: operatorHold?.active === true,
      holdReason: operatorHold?.reason || null,
      nextRecommendedAction: nextActionRes.nextRecommendedAction,
      riskLevel: hasFailures || operatorHold?.active === true ? 'HIGH' : 'LOW',
      summaryBadges,
    });
  }

  // Apply Pagination
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const paginatedItems = items.slice(offset, offset + limit);

  return {
    items: paginatedItems,
    pagination: {
      limit,
      offset,
      count: items.length,
    },
    totals,
  };
}

export async function getDiasporaWorkbookOperatorBatchSummary(batchId, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, options);
  const metadata = normalizeWorkbookBatchMetadata(batch.metadata);
  const operatorHold = normalizeOperatorHold(metadata);
  const rowsResult = await listDiasporaWorkbookImportRows(batch.id, { limit: 1000 }, userContext, options);
  const rows = rowsResult.data || [];
  
  const plan = buildWorkbookImportPlan(batch, rows, userContext);
  
  let audit = null;
  let retryPlan = null;
  let hasFailures = false;
  let hasRetryableRows = false;
  
  const draftExecuted = Boolean(metadata.draftImportExecuted);
  const isFailedStatus = batch.import_status === WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT;
  const isPartialStatus = batch.import_status === WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS;
  
  if (draftExecuted || isFailedStatus || isPartialStatus) {
    try {
      audit = await getDiasporaWorkbookDraftImportAudit(batch.id, userContext, options);
      retryPlan = audit.retryPlan || null;
      hasFailures = (audit.totals?.failedRows || 0) > 0;
      hasRetryableRows = (audit.totals?.retryableRows || 0) > 0;
    } catch (e) {
      // Fallback
    }
  }

  const nextActionRes = getBatchNextActions(batch, plan, hasFailures, hasRetryableRows);
  
  return {
    batch: {
      id: batch.id,
      importStatus: batch.import_status,
      templateType: batch.template_type,
      totalRows: batch.total_rows,
      acceptedRows: batch.accepted_rows,
      rejectedRows: batch.rejected_rows,
      warningCount: batch.warning_count,
      errorCount: batch.error_count,
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
      metadata,
    },
    plan,
    audit,
    retryPlan,
    operator: {
      held: operatorHold?.active === true,
      holdReason: operatorHold?.reason || null,
      notes: normalizeOperatorNotes(metadata),
      nextActions: nextActionRes.allowed,
      forbiddenActions: nextActionRes.forbidden,
      warnings: nextActionRes.warnings,
      statusTimeline: normalizeStatusTimeline(metadata),
    },
  };
}

export async function getDiasporaWorkbookOperatorNextActions(batchId, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, options);
  const metadata = normalizeWorkbookBatchMetadata(batch.metadata);
  const rowsResult = await listDiasporaWorkbookImportRows(batch.id, { limit: 1000 }, userContext, options);
  const rows = rowsResult.data || [];
  
  const plan = buildWorkbookImportPlan(batch, rows, userContext);
  
  let hasFailures = false;
  let hasRetryableRows = false;
  
  const draftExecuted = Boolean(metadata.draftImportExecuted);
  const isFailedStatus = batch.import_status === WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT;
  const isPartialStatus = batch.import_status === WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS;
  
  if (draftExecuted || isFailedStatus || isPartialStatus) {
    try {
      const audit = await getDiasporaWorkbookDraftImportAudit(batch.id, userContext, options);
      hasFailures = (audit.totals?.failedRows || 0) > 0;
      hasRetryableRows = (audit.totals?.retryableRows || 0) > 0;
    } catch (e) {
      // Fallback
    }
  }

  return getBatchNextActions(batch, plan, hasFailures, hasRetryableRows);
}

export async function addDiasporaWorkbookOperatorNote(batchId, notePayload = {}, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  
  const noteText = String(notePayload.note || '').trim();
  if (!noteText) throw new ValidationError('Operator note text is required.');
  if (noteText.length > 2000) throw new ValidationError('Operator note must not exceed 2000 characters.');

  const client = options.supabaseClient || await defaultSupabaseClient();
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, { supabaseClient: client });
  const userId = actorId(userContext);
  
  const metadata = normalizeWorkbookBatchMetadata(batch.metadata);
  const notes = normalizeOperatorNotes(metadata);
  
  const newNote = {
    id: crypto.randomUUID(),
    note: noteText,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    role: userContext.role || 'operator',
    visibility: 'internal',
    phase: '1H',
  };
  
  notes.push(newNote);
  metadata.operatorNotes = notes;

  const { data, error } = await client
    .from('diaspora_workbook_import_batches')
    .update({ metadata, updated_by: userId })
    .eq('id', batch.id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to save operator note.', safeDatabaseDetails('diaspora_workbook_import_batches', 'update', error));
  return {
    data,
    note: newNote,
  };
}

export async function setDiasporaWorkbookOperatorHold(batchId, holdPayload = {}, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  
  const reason = String(holdPayload.reason || '').trim();
  if (!reason) throw new ValidationError('Hold reason is required.');

  const client = options.supabaseClient || await defaultSupabaseClient();
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, { supabaseClient: client });
  const userId = actorId(userContext);
  
  const metadata = normalizeWorkbookBatchMetadata(batch.metadata);
  metadata.operatorHold = {
    active: true,
    reason,
    placedAt: new Date().toISOString(),
    placedBy: userId,
    role: userContext.role || 'operator',
    phase: '1H',
  };

  const { data, error } = await client
    .from('diaspora_workbook_import_batches')
    .update({ metadata, updated_by: userId })
    .eq('id', batch.id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to set operator hold.', safeDatabaseDetails('diaspora_workbook_import_batches', 'update', error));
  return data;
}

export async function clearDiasporaWorkbookOperatorHold(batchId, userContext = {}, options = {}) {
  assertAuthenticated(userContext);

  const client = options.supabaseClient || await defaultSupabaseClient();
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, { supabaseClient: client });
  const userId = actorId(userContext);
  
  const metadata = normalizeWorkbookBatchMetadata(batch.metadata);
  const hold = normalizeOperatorHold(metadata) || {};
  
  metadata.operatorHold = {
    ...hold,
    active: false,
    clearedAt: new Date().toISOString(),
    clearedBy: userId,
  };

  const { data, error } = await client
    .from('diaspora_workbook_import_batches')
    .update({ metadata, updated_by: userId })
    .eq('id', batch.id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to clear operator hold.', safeDatabaseDetails('diaspora_workbook_import_batches', 'update', error));
  return data;
}

// Private helper to evaluate batch next actions
function getBatchNextActions(batch = {}, plan = {}, hasFailures = false, hasRetryableRows = false) {
  const status = batch.import_status;
  const metadata = normalizeWorkbookBatchMetadata(batch.metadata);
  const isHeld = normalizeOperatorHold(metadata)?.active === true;
  const hasRejectedOrErrors = Number(batch.rejected_rows || 0) > 0 || Number(batch.error_count || 0) > 0;

  const allowed = [
    'VIEW_DRY_RUN',
    'VIEW_ROWS',
    'ADD_OPERATOR_NOTE'
  ];
  
  const forbidden = [
    'EXECUTE_LIVE_IMPORT',
    'EXECUTE_AI',
    'RELEASE_PAYMENT',
    'APPROVE_COMPLIANCE',
    'VERIFY_DOCUMENT',
    'OVERWRITE_STOCK',
    'ROLLBACK_DRAFTS',
    'RETRY_DRAFT_IMPORT'
  ];

  const warnings = [];
  let nextRecommendedAction = 'VIEW_ROWS';

  if (status !== WORKBOOK_IMPORT_STATUSES.CANCELLED && 
      ![WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS, WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS].includes(status)) {
    allowed.push('CANCEL_BATCH');
  }

  // VIEW_IMPORT_PLAN
  if ([WORKBOOK_IMPORT_STATUSES.VALIDATED, WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW].includes(status)) {
    allowed.push('VIEW_IMPORT_PLAN');
  }

  // VIEW_EXECUTION_AUDIT
  const draftExecuted = Boolean(metadata.draftImportExecuted);
  if (draftExecuted || [WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS, WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS, WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT].includes(status)) {
    allowed.push('VIEW_EXECUTION_AUDIT');
  }

  // VIEW_RETRY_PLAN
  if ([WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS, WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT].includes(status)) {
    allowed.push('VIEW_RETRY_PLAN');
  }

  // MARK_READY_FOR_REVIEW
  if (status === WORKBOOK_IMPORT_STATUSES.VALIDATED) {
    if (!hasRejectedOrErrors) {
      allowed.push('MARK_READY_FOR_REVIEW');
      nextRecommendedAction = 'MARK_READY_FOR_REVIEW';
    } else {
      warnings.push('Batch has rejected rows or validation errors and cannot be marked ready for review.');
    }
  }

  // EXECUTE_DRAFTS
  if (status === WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW) {
    if (isHeld) {
      warnings.push('Batch is on operator hold and cannot execute draft imports.');
    } else if (hasRejectedOrErrors) {
      warnings.push('Batch has rejected rows or validation errors and cannot execute drafts.');
    } else {
      allowed.push('EXECUTE_DRAFTS');
      nextRecommendedAction = 'EXECUTE_DRAFTS';
    }
  }

  // PLACE / CLEAR HOLD
  if (isHeld) {
    allowed.push('CLEAR_HOLD');
    nextRecommendedAction = 'CLEAR_HOLD';
  } else {
    allowed.push('PLACE_HOLD');
  }

  if (status === WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS) {
    nextRecommendedAction = 'VIEW_EXECUTION_AUDIT';
  }
  if (status === WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS || status === WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT) {
    nextRecommendedAction = hasRetryableRows ? 'VIEW_RETRY_PLAN' : 'VIEW_EXECUTION_AUDIT';
  }

  return {
    allowed,
    forbidden,
    warnings,
    nextRecommendedAction,
  };
}
