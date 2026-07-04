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
import { exportWorkbook } from './diasporaWorkbookXlsxService.js';

// Owner columns consulted when a non-privileged caller has no tenant context. A row is "owned" if
// any of these DB columns equals the caller id. Kept intentionally narrow to avoid over-granting.
const OWNER_COLUMNS = Object.freeze(['created_by', 'user_id', 'buyer_id']);

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
 * Build a tenant-scoped, database-sourced .xlsx workbook for the given template.
 *
 * @param {string} templateType  buyer | seller | supplier | enterprise | container_reservation
 * @param {object} userContext   authenticated caller context (id, tenantId, platformRole, ...)
 * @param {object} [options]     { supabaseClient, redactFields, now }
 * @returns {Promise<Buffer>}    the .xlsx bytes (from the reused exportWorkbook engine)
 */
export async function exportWorkbookFromDatabase(templateType, userContext, options = {}) {
  const context = requireUserContext(userContext);
  const template = requireTemplate(templateType);
  const client = await resolveClient(options);
  const privileged = isPlatformAdmin(context) || isPlatformReviewer(context);

  const rowsBySheet = {};

  for (const sheetDef of template.sheets) {
    // Sheets without a backing table (e.g. AI_COMMAND_CENTER) are staging surfaces — never DB-sourced.
    if (!sheetDef.apiTable) {
      rowsBySheet[sheetDef.name] = [];
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

    rowsBySheet[sheetDef.name] = dbRows.map((row) => projectRow(row, sheetDef));
  }

  const redactFields = [...buildRedactSet(options.redactFields)];
  return exportWorkbook(templateType, rowsBySheet, {
    redactFields,
    context: { now: options.now == null ? new Date().toISOString() : options.now },
  });
}

export const DB_EXPORT_OWNER_COLUMNS = OWNER_COLUMNS;
export const DB_EXPORT_ALWAYS_REDACT_HEADERS = ALWAYS_REDACT_HEADERS;
