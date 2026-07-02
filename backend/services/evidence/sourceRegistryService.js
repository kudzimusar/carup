/**
 * Source registry service — Milestone 1 (master plan §5.2 / §5.6 / §15 allowlist).
 *
 * The base `evidence_sources` table holds restricted columns (contact_reference,
 * credential_reference) and is service_role only. Public consumers must only ever
 * receive the allowlisted summary. `toPublicSource()` is the single serialization
 * boundary — restricted columns are stripped here so they cannot leak (master plan §2.4).
 */

const TABLE = 'evidence_sources';

/** Allowlist of columns safe for public / cross-tenant exposure. */
export const PUBLIC_SOURCE_FIELDS = Object.freeze([
  'id', 'code', 'display_name', 'source_type', 'organization', 'country',
  'verification_status', 'trust_tier', 'permitted_evidence_classes', 'active',
]);

export function toPublicSource(row) {
  if (!row) return null;
  const out = {};
  for (const f of PUBLIC_SOURCE_FIELDS) out[f] = row[f] ?? null;
  return out;
}

/** List active sources, public-safe. */
export async function listPublicSources(supabase) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('active', true);
  if (error) throw new Error(`source list failed: ${error.message}`);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.map(toPublicSource);
}

export async function getSourceByCode(supabase, code) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('code', code).single();
  if (error) return null;
  return data || null;
}

/**
 * Validate that a source is permitted to supply evidence of a given class
 * (master plan §5.2 permitted_evidence_classes). Returns { ok, reason }.
 */
export function sourcePermitsClass(sourceRow, evidenceClass) {
  if (!sourceRow) return { ok: false, reason: 'unknown_source' };
  if (sourceRow.active === false) return { ok: false, reason: 'source_inactive' };
  const permitted = sourceRow.permitted_evidence_classes || [];
  if (permitted.length && !permitted.includes(evidenceClass)) {
    return { ok: false, reason: 'class_not_permitted_for_source' };
  }
  return { ok: true, reason: null };
}

export default { PUBLIC_SOURCE_FIELDS, toPublicSource, listPublicSources, getSourceByCode, sourcePermitsClass };
