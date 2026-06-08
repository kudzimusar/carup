#!/usr/bin/env node
/**
 * Marketplace classification BACKFILL (Navigation Intelligence).
 *
 * SAFE BY DEFAULT:
 *  - Runs in DRY-RUN unless `--apply` is passed. Dry-run performs only SELECTs.
 *  - Requires an approved `--allowlist <file>` (JSON array of {vin, category}).
 *  - Writes ONLY `vehicle_condition_category`, ONLY to `locally_used` / `recently_imported`,
 *    ONLY for rows in the allowlist that are still `unknown` AND independently proposed by the
 *    merged classification rules (poisoned/test rows are skipped). Governed targets are rejected.
 *  - Every write is double-guarded (`.eq('vehicle_condition_category','unknown')`), audited, and a
 *    rollback file is produced.
 *
 * Usage:
 *   node scripts/marketplace-classification-backfill.js --allowlist scratch/approved-allowlist.json
 *   node scripts/marketplace-classification-backfill.js --allowlist scratch/approved-allowlist.json --apply
 *   node scripts/marketplace-classification-backfill.js --revert scratch/backfill-revert-<stamp>.json [--apply]
 *
 * See docs/CARUP_MARKETPLACE_CLASSIFICATION_BACKFILL_RUNBOOK.md
 */
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const {
  parseBackfillArgs, validateBackfillArgs, parseAllowlist,
  evaluateBackfillRow, buildAuditEntry, buildRevertEntry,
} = await import('../backend/services/marketplace/marketplaceBackfill.js')

const USAGE = `marketplace-classification-backfill
  --allowlist <file>   approved JSON allowlist: [{ "vin": "...", "category": "locally_used" }, ...]
  --apply              REQUIRED to write to the database (otherwise DRY-RUN, read-only)
  --revert <file>      revert a prior run using its backfill-revert-*.json (use with --apply to write)
  -h, --help           show this help`

function nowIso() { return new Date().toISOString() }

async function main() {
  const args = parseBackfillArgs(process.argv.slice(2))
  if (args.help) { console.log(USAGE); process.exit(0) }
  try { validateBackfillArgs(args) } catch (e) { console.error('ARG ERROR:', e.message); console.log('\n' + USAGE); process.exit(2) }

  const { supabase } = await import('../backend/db/supabase.js')
  const outDir = path.resolve(process.cwd(), 'scratch'); fs.mkdirSync(outDir, { recursive: true })
  const stamp = nowIso().replace(/[:.]/g, '-')

  if (args.revertPath) return runRevert(args, supabase, stamp)

  const allowlist = parseAllowlist(fs.readFileSync(args.allowlistPath, 'utf8'))
  const vins = allowlist.map(e => e.vin)
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('vin, vehicle_condition_category, import_source, registration_country')
    .in('vin', vins)
  if (error) { console.error('vehicles fetch failed:', error.message); process.exit(1) }
  const byVin = new Map((vehicles || []).map(v => [v.vin, v]))

  const toApply = [], skipped = []
  for (const entry of allowlist) {
    const evald = evaluateBackfillRow(byVin.get(entry.vin), entry)
    ;(evald.action === 'apply' ? toApply : skipped).push(evald)
  }

  const mode = args.apply ? 'APPLY' : 'DRY-RUN'
  const actor = process.env.USER || 'backfill-script'
  const audit = [], revert = []
  let applied = 0

  for (const evald of toApply) {
    if (args.apply) {
      const { data, error: uerr } = await supabase
        .from('vehicles')
        .update({ vehicle_condition_category: evald.proposed })
        .eq('vin', evald.vin)
        .eq('vehicle_condition_category', 'unknown') // DB-level unknown-only guard
        .select('vin')
      if (uerr) { skipped.push({ ...evald, action: 'skip', reason: `update_error(${uerr.message})` }); continue }
      if (!data || data.length === 0) { skipped.push({ ...evald, action: 'skip', reason: 'unknown_guard_no_row_updated' }); continue }
      applied++
      audit.push(buildAuditEntry(evald, { applied: true, actor, timestamp: nowIso() }))
      revert.push(buildRevertEntry(evald))
    } else {
      audit.push(buildAuditEntry(evald, { applied: false, actor, timestamp: nowIso() }))
      revert.push(buildRevertEntry(evald))
    }
  }

  const diff = toApply.map(e => ({ vin: e.vin, change: `${e.current} -> ${e.proposed}`, approved: e.approved, reason: e.reason, source_fields: e.source_fields }))
  const auditFile = path.join(outDir, `backfill-audit-${stamp}.json`)
  const revertFile = path.join(outDir, `backfill-revert-${stamp}.json`)
  fs.writeFileSync(auditFile, JSON.stringify({ mode, db_writes: args.apply, allowlist_size: allowlist.length, applied: args.apply ? applied : 0, would_apply: toApply.length, skipped: skipped.length, actor, timestamp: nowIso(), entries: audit }, null, 2))
  fs.writeFileSync(revertFile, JSON.stringify({ created_for: mode, timestamp: nowIso(), revert }, null, 2))

  console.log(`=== MARKETPLACE CLASSIFICATION BACKFILL [${mode}] ===`)
  console.log(args.apply ? '*** --apply set: DATABASE WRITES PERFORMED ***' : 'DRY-RUN: no database writes. Pass --apply to write (after approval).')
  console.log(`allowlist: ${allowlist.length} | ${args.apply ? 'applied' : 'would-apply'}: ${args.apply ? applied : toApply.length} | skipped: ${skipped.length}`)
  console.log('--- before/after diff ---')
  for (const d of diff) console.log(`  ${d.vin}: ${d.change}  [approved=${d.approved}]  ${d.reason}`)
  if (!diff.length) console.log('  (none)')
  console.log('--- skipped (with reasons) ---')
  for (const s of skipped) console.log(`  ${s.vin}: ${s.reason}`)
  if (!skipped.length) console.log('  (none)')
  console.log(`audit:  ${path.relative(process.cwd(), auditFile)}`)
  console.log(`revert: ${path.relative(process.cwd(), revertFile)}`)
  process.exit(0)
}

async function runRevert(args, supabase, stamp) {
  const parsed = JSON.parse(fs.readFileSync(args.revertPath, 'utf8'))
  const entries = Array.isArray(parsed) ? parsed : (parsed.revert || [])
  const mode = args.apply ? 'REVERT-APPLY' : 'REVERT-DRY-RUN'
  let reverted = 0; const done = []
  for (const e of entries) {
    if (!e || !e.vin) continue
    if (args.apply) {
      const { data, error } = await supabase
        .from('vehicles')
        .update({ vehicle_condition_category: e.restore_to || 'unknown' })
        .eq('vin', e.vin)
        .select('vin')
      if (error) { console.error(`revert ${e.vin} failed:`, error.message); continue }
      if (data && data.length) { reverted++; done.push(e.vin) }
    } else { done.push(e.vin) }
  }
  console.log(`=== BACKFILL REVERT [${mode}] ===`)
  console.log(args.apply ? `reverted ${reverted} rows to their prior value` : `DRY-RUN: would revert ${done.length} rows. Pass --apply to write.`)
  for (const v of done) console.log(`  ${v}`)
  process.exit(0)
}

main().catch(e => { console.error('BACKFILL_ERROR', e.message); process.exit(1) })
