/**
 * Tenant-scoped, database-sourced XLSX export.
 *
 * Non-privileged callers with a tenant are constrained by tenant_id. Non-privileged callers without
 * a tenant are constrained by the ownership columns that actually exist on each backing table.
 * The table-specific contract prevents PostgREST from compiling predicates that reference columns
 * absent from that table.
 */
import { ValidationError } from '../../../utils/errors.js';
import {
  getXlsxTemplate,
  listSupportedXlsxTemplateTypes,
} from '../../../constants/diaspora/diasporaWorkbookTemplates.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  normalizeId,
} from '../diasporaAuthorization.js';
import { resolveClient } from '../diasporaServiceUtils.js';
import { writeDiasporaAudit } from '../diasporaAuditService.js';
import { exportWorkbook } from './diasporaWorkbookXlsxService.js';
import { requireFeature } from '../diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../../constants/diaspora/diasporaEntitlements.js';
import { sha256Checksum } from './diasporaWorkbookUploadSecurity.js';

/**
 * Exact ownership columns used by the original authorization model, intersected with each table's
 * authoritative schema. Do not add role/participant columns here without a separate authorization
 * review: this map is deliberately narrow and must not broaden who may export a row.
 */
export const DB_EXPORT_OWNER_COLUMNS_BY_TABLE = Object.freeze({
  diaspora_trade_profiles: Object.freeze(['created_by', 'user_id']),
  diaspora_import_orders: Object.freeze(['created_by', 'buyer_id']),
  diaspora_import_quotes: Object.freeze(['created_by']),
  diaspora_trade_documents: Object.freeze(['created_by']),
  diaspora_container_shipments: Object.freeze(['created_by']),
  diaspora_cargo_reservations: Object.freeze(['created_by', 'buyer_id']),
  diaspora_shipments: Object.freeze(['created_by']),
  diaspora_compliance_reviews: Object.freeze(['created_by']),
  diaspora_payment_milestones: Object.freeze(['created_by']),
  diaspora_reputation_records: Object.freeze(['created_by']),
});

export const DB_EXPORT_OWNER_COLUMNS = Object.freeze(
  [...new Set(Object.values(DB_EXPORT_OWNER_COLUMNS_BY_TABLE).flat())],
);

const EMPTY_OWNER_COLUMNS = Object.freeze([]);

export function getDbExportOwnerColumns(table) {
  return DB_EXPORT_OWNER_COLUMNS_BY_TABLE[String(table || '')] || EMPTY_OWNER_COLUMNS;
}

export function buildDbExportOwnerPredicate(table, ownerId) {
  const columns = getDbExportOwnerColumns(table);
  if (columns.length === 0) return null;
  const safeOwnerId = String(ownerId || '').replace(/[(),"]/g, '');
  if (!safeOwnerId) return null;
  return columns.map((column) => `${column}.eq.${safeOwnerId}`).join(',');
}

export const MAX_EXPORT_ROWS_PER_SHEET = 10000;
const EXPORT_FILTER_KEYS = Object.freeze(['createdFrom', 'createdTo']);

const ALWAYS_REDACT_HEADERS = Object.freeze([
  'STORAGE_PATH',
  'PRIVATE_STORAGE_PATH',
  'DRIVE_FILE_ID',
  'EXTRACTED_ID_NUMBER',
  'EXTRACTED_NAME',
  'EXTRACTED_CHASSIS_NUMBER',
  'RECEIVER_NAME',
  'RECEIVER_PHONE',
]);
const ALWAYS_REDACT_SET = new Set(ALWAYS_REDACT_HEADERS);
const COLUMN_ALIASES = Object.freeze({});

function requireTemplate(templateType) {
  const template = getXlsxTemplate(templateType);
  if (!template) {
    throw new ValidationError(`Unsupported workbook template type "${templateType}".`, {
      code: 'UNSUPPORTED_TEMPLATE_TYPE',
      templateType,
      supported: listSupportedXlsxTemplateTypes(),
    });
  }
  return template;
}

function isRowVisibleToCaller(row, context, ownerColumns) {
  if (context.tenantId) return normalizeId(row.tenant_id) === context.tenantId;
  return ownerColumns.some((column) => normalizeId(row[column]) === context.id);
}

function projectRow(row, sheetDef) {
  const projected = {};
  for (const column of sheetDef.columns) {
    const header = column.header;
    if (ALWAYS_REDACT_SET.has(header)) continue;
    if (header === sheetDef.primaryKey) {
      projected[header] = row.id == null ? '' : row.id;
      continue;
    }
    const dbColumn = COLUMN_ALIASES[header] || header.toLowerCase();
    const value = row[dbColumn];
    projected[header] = value == null ? '' : value;
  }
  return projected;
}

function buildRedactSet(extraRedactFields) {
  const set = new Set(ALWAYS_REDACT_HEADERS);
  if (Array.isArray(extraRedactFields)) {
    for (const field of extraRedactFields) {
      if (typeof field === 'string' && field.trim() !== '') set.add(field.trim());
    }
  }
  return set;
}

function normalizeExportFilters(filters) {
  const normalized = { createdFrom: null, createdTo: null };
  if (filters == null) return normalized;
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new ValidationError('Export filters must be an object with createdFrom/createdTo.', {
      code: 'INVALID_EXPORT_FILTER',
      allowed: EXPORT_FILTER_KEYS,
    });
  }

  const unknownKeys = Object.keys(filters).filter((key) => !EXPORT_FILTER_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new ValidationError(`Unsupported export filter field(s): ${unknownKeys.join(', ')}.`, {
      code: 'INVALID_EXPORT_FILTER',
      unknownKeys,
      allowed: EXPORT_FILTER_KEYS,
    });
  }

  for (const key of EXPORT_FILTER_KEYS) {
    const value = filters[key];
    if (value == null || value === '') continue;
    const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(timestamp)) {
      throw new ValidationError(`Export filter "${key}" must be an ISO-8601 date string.`, {
        code: 'INVALID_EXPORT_FILTER',
        field: key,
      });
    }
    normalized[key] = new Date(timestamp).toISOString();
  }

  if (
    normalized.createdFrom
    && normalized.createdTo
    && Date.parse(normalized.createdFrom) > Date.parse(normalized.createdTo)
  ) {
    throw new ValidationError('Export filter createdFrom must not be after createdTo.', {
      code: 'INVALID_EXPORT_FILTER',
      createdFrom: normalized.createdFrom,
      createdTo: normalized.createdTo,
    });
  }
  return normalized;
}

function isRowWithinCreatedWindow(row, filters) {
  if (!filters.createdFrom && !filters.createdTo) return true;
  const createdAt = Date.parse(row?.created_at);
  if (!Number.isFinite(createdAt)) return false;
  if (filters.createdFrom && createdAt < Date.parse(filters.createdFrom)) return false;
  if (filters.createdTo && createdAt > Date.parse(filters.createdTo)) return false;
  return true;
}

function resolveRowCeiling(maxRowsPerSheet) {
  if (Number.isInteger(maxRowsPerSheet) && maxRowsPerSheet > 0) return maxRowsPerSheet;
  return MAX_EXPORT_ROWS_PER_SHEET;
}

export async function exportWorkbookFromDatabase(templateType, userContext, options = {}) {
  const context = requireUserContext(userContext);
  const template = requireTemplate(templateType);
  const filters = normalizeExportFilters(options.filters);
  const maxRowsPerSheet = resolveRowCeiling(options.maxRowsPerSheet);
  const client = await resolveClient(options);
  const privileged = isPlatformAdmin(context) || isPlatformReviewer(context);

  await requireFeature(client, {
    tenantId: context.tenantId || null,
    userId: context.id,
    featureKey: FEATURE_KEYS.AUDIT_EXPORT,
  });

  const rowsBySheet = {};
  const rowCounts = {};

  for (const sheetDef of template.sheets) {
    if (!sheetDef.apiTable) {
      rowsBySheet[sheetDef.name] = [];
      rowCounts[sheetDef.name] = 0;
      continue;
    }

    const ownerColumns = getDbExportOwnerColumns(sheetDef.apiTable);

    // An unmapped table must never become an unbounded query for an untenanted ordinary caller.
    if (!privileged && !context.tenantId && ownerColumns.length === 0) {
      rowsBySheet[sheetDef.name] = [];
      rowCounts[sheetDef.name] = 0;
      continue;
    }

    let query = client.from(sheetDef.apiTable).select('*').is('deleted_at', null);

    if (!privileged) {
      if (context.tenantId) {
        query = query.eq('tenant_id', context.tenantId);
      } else {
        const predicate = buildDbExportOwnerPredicate(sheetDef.apiTable, context.id);
        if (!predicate) {
          rowsBySheet[sheetDef.name] = [];
          rowCounts[sheetDef.name] = 0;
          continue;
        }
        query = query.or(predicate);
      }
    }

    if (filters.createdFrom) query = query.gte('created_at', filters.createdFrom);
    if (filters.createdTo) query = query.lte('created_at', filters.createdTo);

    const { data, error } = await query;
    if (error) {
      throw new ValidationError(`Failed to export ${sheetDef.apiTable}: ${error.message}`, {
        code: 'DB_EXPORT_QUERY_FAILED',
        table: sheetDef.apiTable,
      });
    }

    let dbRows = Array.isArray(data) ? data : [];
    if (!privileged) {
      dbRows = dbRows.filter((row) => isRowVisibleToCaller(row, context, ownerColumns));
    }
    dbRows = dbRows.filter((row) => isRowWithinCreatedWindow(row, filters));

    if (dbRows.length > maxRowsPerSheet) {
      throw new ValidationError(
        `Sheet "${sheetDef.name}" has ${dbRows.length} rows after filters; the export ceiling is `
          + `${maxRowsPerSheet}. Narrow createdFrom/createdTo and retry.`,
        {
          code: 'EXPORT_ROW_LIMIT_EXCEEDED',
          sheet: sheetDef.name,
          count: dbRows.length,
          limit: maxRowsPerSheet,
        },
      );
    }

    rowsBySheet[sheetDef.name] = dbRows.map((row) => projectRow(row, sheetDef));
    rowCounts[sheetDef.name] = dbRows.length;
  }

  const redactedHeaders = [...buildRedactSet(options.redactFields)].sort();
  const buffer = await exportWorkbook(templateType, rowsBySheet, {
    redactFields: redactedHeaders,
    context: { now: options.now == null ? new Date().toISOString() : options.now },
  });

  const totalRows = Object.values(rowCounts).reduce((sum, count) => sum + count, 0);
  const checksum = sha256Checksum(buffer);
  const meta = {
    templateType: template.templateType,
    rowCounts,
    totalRows,
    checksum,
    filters,
    redactedHeaders,
  };

  try {
    await writeDiasporaAudit({
      actorId: context.id,
      tenantId: context.tenantId ?? null,
      action: 'WORKBOOK_DB_EXPORTED',
      resourceType: 'diaspora_workbook_export',
      resourceId: checksum,
      metadata: {
        templateType: template.templateType,
        filters,
        rowCounts,
        totalRows,
        redactedHeaders,
      },
      req: options.req ?? null,
    });
  } catch (err) {
    console.warn(`⚠️ Workbook DB export audit write skipped: ${err.message}`);
  }

  return { buffer, meta };
}

export const DB_EXPORT_ALWAYS_REDACT_HEADERS = ALWAYS_REDACT_HEADERS;
