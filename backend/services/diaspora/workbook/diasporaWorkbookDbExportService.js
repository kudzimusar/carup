/**
 * Tenant-scoped, DATABASE-sourced XLSX export (Completion Track W).
 *
 * The sibling engine (diasporaWorkbookXlsxService.exportWorkbook) turns a normalized
 * `{ sheetName -> rows[] }` payload into .xlsx bytes but takes those rows verbatim from its
 * caller (today: the request body). This service builds that same normalized payload FROM THE
 * DATABASE, applying tenant/ownership authorization on every sheet BEFORE handing the rows to the
 * unchanged engine. It never forks exportWorkbook — it only sources and scopes the rows.
 *
 * Authorization model (the headline requirement — a tenant-A caller must NEVER receive tenant-B rows):
 *   - a trusted platform admin/reviewer (server-derived platformRole only) may export across tenants;
 *   - any other caller WITH a tenantId is restricted to rows whose tenant_id equals that tenantId;
 *   - any other caller WITHOUT a tenantId is restricted to rows they created/own (created_by/user_id/
 *     buyer_id === their id); a sheet with no owned rows yields an EMPTY sheet rather than leaking.
 * The tenant/owner predicate is applied BOTH as a query filter (matching the diasporaStockService
 * pattern) AND re-applied in JS after the fetch, so isolation holds even if the underlying client
 * ignores or mis-handles a filter (defense in depth — never trust the query alone).
 *
 * PII / secret handling: only columns that are template headers are ever projected, so raw storage
 * columns that are not template headers can never leak. Columns that ARE headers but carry storage
 * pointers or identity PII (storage paths, drive file id, extracted passport/id/chassis, receiver
 * phone) are always redacted and their raw values are never even projected into the payload.
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
// Enforcement via the GUARD (no-op while DIASPORA_SUBSCRIPTION_ENFORCEMENT is off, which is default).
import { requireFeature } from '../diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../../constants/diaspora/diasporaEntitlements.js';
import { sha256Checksum } from './diasporaWorkbookUploadSecurity.js';

// Owner columns consulted when a non-privileged caller has no tenant context. A row is "owned" if
// any of these DB columns equals the caller id. Kept intentionally narrow to avoid over-granting.
const OWNER_COLUMNS = Object.freeze(['created_by', 'user_id', 'buyer_id']);

// Hard per-sheet row ceiling for a database-sourced export. Exceeding it fails LOUDLY
// (EXPORT_ROW_LIMIT_EXCEEDED) rather than silently truncating — the caller must narrow the
// created-date filters instead of receiving a file that looks complete but is not.
export const MAX_EXPORT_ROWS_PER_SHEET = 10000;

// The ONLY filter keys a caller may supply. Anything else (especially anything row-shaped) is
// rejected outright: this endpoint is database-sourced and never accepts data from its caller.
const EXPORT_FILTER_KEYS = Object.freeze(['createdFrom', 'createdTo']);

// Header columns that must never emit a raw value regardless of the caller. Storage pointers and
// identity PII are always redacted (rendered '[REDACTED]' by the engine) and never projected.
const ALWAYS_REDACT_HEADERS = Object.freeze([
  'STORAGE_PATH',
  'PRIVATE_STORAGE_PATH',
  'DRIVE_FILE_ID',
  'EXTRACTED_ID_NUMBER',
  'EXTRACTED_NAME',
  'EXTRACTED_CHASSIS_NUMBER',
  // Receiver contact PII on cargo reservations — redact name AND phone consistently.
  'RECEIVER_NAME',
  'RECEIVER_PHONE',
]);
const ALWAYS_REDACT_SET = new Set(ALWAYS_REDACT_HEADERS);

// Optional overrides for the rare case where a template HEADER does not map to `header.toLowerCase()`
// as its DB column. Empty today (the schema headers map 1:1 to their lower_snake columns); the map
// exists so a future divergence is a one-line addition rather than a projection rewrite.
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

/**
 * Is this DB row visible to a NON-privileged caller? Tenant callers see their whole tenant; a caller
 * with no tenant sees only rows they created/own. Privileged callers never reach here.
 */
function isRowVisibleToCaller(row, context) {
  if (context.tenantId) {
    return normalizeId(row.tenant_id) === context.tenantId;
  }
  return OWNER_COLUMNS.some((column) => normalizeId(row[column]) === context.id);
}

/** Project a lower_snake DB row into the HEADER-keyed shape the export engine consumes. */
function projectRow(row, sheetDef) {
  const projected = {};
  for (const column of sheetDef.columns) {
    const header = column.header;
    // Sensitive headers are redacted by the engine; never project the raw value into the payload.
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

/**
 * Validate and canonicalize the SAFE export filters. Only `createdFrom`/`createdTo` are accepted
 * and each must be an ISO-8601 date string; anything else — unknown keys (e.g. row payloads),
 * non-object filters, unparseable dates, an inverted range — throws INVALID_EXPORT_FILTER.
 * Returns `{ createdFrom, createdTo }` as canonical ISO strings (null when not supplied).
 */
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
    normalized.createdFrom &&
    normalized.createdTo &&
    Date.parse(normalized.createdFrom) > Date.parse(normalized.createdTo)
  ) {
    throw new ValidationError('Export filter createdFrom must not be after createdTo.', {
      code: 'INVALID_EXPORT_FILTER',
      createdFrom: normalized.createdFrom,
      createdTo: normalized.createdTo,
    });
  }

  return normalized;
}

/**
 * JS re-application of the created-date window (defense in depth — mirrors the tenant re-check).
 * When a bound is active, a row whose created_at is missing or unparseable is EXCLUDED: we cannot
 * prove it is inside the requested window, so it must not ride along.
 */
function isRowWithinCreatedWindow(row, filters) {
  if (!filters.createdFrom && !filters.createdTo) return true;
  const createdAt = Date.parse(row?.created_at);
  if (!Number.isFinite(createdAt)) return false;
  if (filters.createdFrom && createdAt < Date.parse(filters.createdFrom)) return false;
  if (filters.createdTo && createdAt > Date.parse(filters.createdTo)) return false;
  return true;
}

/** Resolve the per-sheet row ceiling; `options.maxRowsPerSheet` exists for tests only. */
function resolveRowCeiling(maxRowsPerSheet) {
  if (Number.isInteger(maxRowsPerSheet) && maxRowsPerSheet > 0) return maxRowsPerSheet;
  return MAX_EXPORT_ROWS_PER_SHEET;
}

/**
 * Build a tenant-scoped, database-sourced .xlsx workbook for the given template.
 *
 * @param {string} templateType  buyer | seller | supplier | enterprise | container_reservation
 * @param {object} userContext   authenticated caller context (id, tenantId, platformRole, ...)
 * @param {object} [options]     { supabaseClient, redactFields, now, filters, req, maxRowsPerSheet }
 *                               - filters: { createdFrom?, createdTo? } ISO date strings (SAFE
 *                                 filters only — never data rows). Invalid -> INVALID_EXPORT_FILTER.
 *                               - req: the Express request, used ONLY for the audit row (ip/UA).
 *                               - maxRowsPerSheet: test-only ceiling override (default 10000).
 * @returns {Promise<{buffer: Buffer, meta: object}>}
 *   buffer — the .xlsx bytes (from the reused exportWorkbook engine);
 *   meta   — { templateType, rowCounts, totalRows, checksum, filters, redactedHeaders } where
 *            checksum is the sha256 hex of `buffer` (also the audit resourceId).
 * @throws ValidationError EXPORT_ROW_LIMIT_EXCEEDED when any sheet's post-filter row count exceeds
 *   the ceiling — no silent truncation; the caller must narrow createdFrom/createdTo.
 */
export async function exportWorkbookFromDatabase(templateType, userContext, options = {}) {
  const context = requireUserContext(userContext);
  const template = requireTemplate(templateType);
  const filters = normalizeExportFilters(options.filters);
  const maxRowsPerSheet = resolveRowCeiling(options.maxRowsPerSheet);
  const client = await resolveClient(options);
  const privileged = isPlatformAdmin(context) || isPlatformReviewer(context);

  // Gate bulk data extraction on diaspora.audit.export. This is a whole-tenant export of live trade
  // data, which the plan catalog places at trade_pro ("bulk workbook import/export") — not the free
  // blank-template download, which is a different key. Gated BEFORE any query runs, so a denied caller
  // never causes the read load.
  await requireFeature(client, {
    tenantId: context.tenantId || null,
    userId: context.id,
    featureKey: FEATURE_KEYS.AUDIT_EXPORT,
  });

  const rowsBySheet = {};
  const rowCounts = {};

  for (const sheetDef of template.sheets) {
    // Sheets without a backing table (e.g. AI_COMMAND_CENTER) are staging surfaces — never DB-sourced.
    if (!sheetDef.apiTable) {
      rowsBySheet[sheetDef.name] = [];
      rowCounts[sheetDef.name] = 0;
      continue;
    }

    let query = client.from(sheetDef.apiTable).select('*').is('deleted_at', null);

    // Query-level scoping (mirrors diasporaStockService.listStockItems). Privileged callers span
    // tenants; a tenant caller is pinned to their tenant. A non-privileged caller with NO tenant is
    // bounded at the query level to rows they own via an OR across the owner columns, so we never
    // pull an entire multi-tenant table into memory just to owner-filter in JS (a cost/DoS concern).
    // The JS re-check below still runs as defense-in-depth (and covers the in-memory mock whose
    // .or() is a no-op), so correctness never depends on the query filter alone.
    if (!privileged) {
      if (context.tenantId) {
        query = query.eq('tenant_id', context.tenantId);
      } else {
        const ownerId = String(context.id).replace(/[(),"]/g, '');
        query = query.or(OWNER_COLUMNS.map((column) => `${column}.eq.${ownerId}`).join(','));
      }
    }

    // Query-level created-date window (safe filters only; re-applied in JS below).
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

    // Defense in depth: re-apply the tenant/owner predicate in JS. A tenant-A caller can never
    // receive a tenant-B row even if the query filter were ignored by the underlying client.
    if (!privileged) {
      dbRows = dbRows.filter((row) => isRowVisibleToCaller(row, context));
    }

    // Defense in depth: re-apply the created-date window in JS as well.
    dbRows = dbRows.filter((row) => isRowWithinCreatedWindow(row, filters));

    // Hard ceiling — fail loudly instead of silently truncating an "export" that looks complete.
    if (dbRows.length > maxRowsPerSheet) {
      throw new ValidationError(
        `Sheet "${sheetDef.name}" has ${dbRows.length} rows after filters; the export ceiling is ` +
          `${maxRowsPerSheet}. Narrow createdFrom/createdTo and retry.`,
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

  // Export audit (best-effort, mirroring queueDiasporaNotification's defensive convention): the
  // file was already authorized and built, so an audit-sink outage must not fail the download.
  // Metadata carries ONLY template/filter/count/redaction facts — never row data or PII values.
  try {
    await writeDiasporaAudit({
      actorId: context.id,
      tenantId: context.tenantId ?? null,
      action: 'WORKBOOK_DB_EXPORTED',
      resourceType: 'diaspora_workbook_export',
      resourceId: checksum,
      metadata: { templateType: template.templateType, filters, rowCounts, totalRows, redactedHeaders },
      req: options.req ?? null,
    });
  } catch (err) {
    console.warn(`⚠️ Workbook DB export audit write skipped: ${err.message}`);
  }

  return { buffer, meta };
}

export const DB_EXPORT_OWNER_COLUMNS = OWNER_COLUMNS;
export const DB_EXPORT_ALWAYS_REDACT_HEADERS = ALWAYS_REDACT_HEADERS;
