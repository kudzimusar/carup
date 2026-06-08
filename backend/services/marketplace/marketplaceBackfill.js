/**
 * Marketplace classification backfill — PURE logic (no DB, no side effects).
 *
 * Decides, per vehicle + approved allowlist entry, whether a SAFE condition-category backfill may be
 * applied. Used by scripts/marketplace-classification-backfill.js (the CLI does the I/O). Kept pure
 * so it is fully unit-testable without a database.
 *
 * Safety invariants enforced here:
 *  - Only `locally_used` and `recently_imported` may ever be written (SAFE_BACKFILL_CATEGORIES).
 *  - Governed categories/tags (brand_new, second_hand, passport_verified, partsentry_checked) are
 *    HARD-REJECTED even if an allowlist asks for them.
 *  - A row is only eligible when it is currently `unknown`, the merged classification rules
 *    independently propose a category, and that proposal MATCHES the approved category.
 *  - `recently_imported` is only ever applied when explicitly approved in the allowlist (its entry
 *    must carry category 'recently_imported'); the allowlist cannot override the rules.
 *  - Seed/demo/integration FIXTURE rows are hard-rejected (getFixtureExclusion), even if allowlisted.
 */
import { classifyVehicleConditionCandidate, getFixtureExclusion } from './marketplaceClassificationRules.js'

/** The ONLY categories this backfill may write. Everything else is governed/manual. */
export const SAFE_BACKFILL_CATEGORIES = new Set(['locally_used', 'recently_imported'])

/** Categories/tags that must NEVER be written by this backfill (hard reject). */
export const FORBIDDEN_BACKFILL_TARGETS = new Set([
  'brand_new', 'second_hand', 'certified_dealer',
  'passport_verified', 'partsentry_checked',
])

/** Parse CLI argv (already sliced past `node script`). */
export function parseBackfillArgs(argv = []) {
  const args = { apply: false, allowlistPath: null, revertPath: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--allowlist') args.allowlistPath = argv[++i] ?? null
    else if (a === '--revert') args.revertPath = argv[++i] ?? null
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

/** Validate args; throw a clear error if invalid. An approved allowlist is required for a forward run. */
export function validateBackfillArgs(args) {
  if (args.revertPath) return
  if (!args.allowlistPath) {
    throw new Error('an approved --allowlist <file> is required (refusing to run without one)')
  }
}

/** Parse allowlist file content -> normalized [{vin, category}]. Accepts a JSON array or {approved:[...]}. */
export function parseAllowlist(content) {
  let data
  try { data = JSON.parse(content) } catch (e) { throw new Error(`allowlist is not valid JSON: ${e.message}`) }
  const list = Array.isArray(data) ? data : Array.isArray(data?.approved) ? data.approved : null
  if (!list) throw new Error('allowlist must be a JSON array of {vin, category} or { "approved": [...] }')
  return list.map((e, i) => {
    if (!e || typeof e.vin !== 'string' || !e.vin.trim()) throw new Error(`allowlist[${i}] missing "vin"`)
    if (typeof e.category !== 'string' || !e.category.trim()) throw new Error(`allowlist[${i}] missing "category"`)
    return { vin: e.vin.trim(), category: e.category.trim().toLowerCase() }
  })
}

/**
 * PURE decision for one vehicle given its approved allowlist entry.
 * @returns {{ vin, action:'apply'|'skip', current, proposed, approved, reason, source_fields }}
 */
export function evaluateBackfillRow(vehicle, allowlistEntry) {
  const vin = allowlistEntry?.vin ?? vehicle?.vin ?? null
  const approved = allowlistEntry?.category ?? null
  const base = {
    vin,
    current: String(vehicle?.vehicle_condition_category ?? 'unknown').toLowerCase(),
    approved,
    source_fields: {
      import_source: vehicle?.import_source ?? null,
      registration_country: vehicle?.registration_country ?? null,
    },
  }

  if (!vehicle) return { ...base, action: 'skip', proposed: null, reason: 'vehicle_not_found' }

  // Hard reject governed/forbidden targets, even if asked for.
  if (FORBIDDEN_BACKFILL_TARGETS.has(approved)) {
    return { ...base, action: 'skip', proposed: null, reason: `forbidden_governed_target(${approved})` }
  }
  // Only the safe set may be written.
  if (!SAFE_BACKFILL_CATEGORIES.has(approved)) {
    return { ...base, action: 'skip', proposed: null, reason: `unsafe_category_not_allowed(${approved})` }
  }
  // Must currently be unknown.
  if (base.current !== 'unknown') {
    return { ...base, action: 'skip', proposed: null, reason: `not_unknown(current=${base.current})` }
  }
  // Seed/demo/integration fixtures can NEVER be written, even if allowlisted (defense-in-depth).
  const fixtureReason = getFixtureExclusion(vehicle)
  if (fixtureReason) {
    return { ...base, action: 'skip', proposed: null, reason: `fixture_excluded(${fixtureReason})` }
  }
  // The merged rules must independently propose a category (this is what excludes poisoned/test rows).
  const ruled = classifyVehicleConditionCandidate(vehicle)
  if (!ruled.included || !ruled.proposed) {
    return { ...base, action: 'skip', proposed: null, reason: `rule_excluded(${ruled.reason})` }
  }
  // The rule's proposal must MATCH the approved category — the allowlist cannot override the rules.
  if (ruled.proposed !== approved) {
    return { ...base, action: 'skip', proposed: ruled.proposed, reason: `rule_mismatch(rule=${ruled.proposed},approved=${approved})` }
  }
  return { ...base, action: 'apply', proposed: ruled.proposed, reason: ruled.reason }
}

/** Build an immutable audit entry for one evaluated row. */
export function buildAuditEntry(evald, { applied, actor, timestamp }) {
  return {
    vin: evald.vin,
    field: 'vehicle_condition_category',
    old: evald.current,
    new: evald.proposed,
    approved: evald.approved,
    reason: evald.reason,
    applied: Boolean(applied),
    actor: actor ?? null,
    timestamp: timestamp ?? null,
  }
}

/** Build a rollback entry that restores this row to its pre-backfill value (always `unknown`). */
export function buildRevertEntry(evald) {
  return { vin: evald.vin, field: 'vehicle_condition_category', restore_to: evald.current }
}
