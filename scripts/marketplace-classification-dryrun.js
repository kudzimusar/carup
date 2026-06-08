#!/usr/bin/env node
/**
 * Marketplace classification DRY-RUN (Navigation Intelligence — backfill readiness).
 *
 * READ-ONLY. Performs ONLY SELECTs (no INSERT/UPDATE/DELETE/DDL, no data writes). It shows what a
 * SAFE marketplace classification backfill WOULD do, before any data is changed.
 *
 * Outputs (kept in scratch/, which is untracked — NOT committed):
 *   - scratch/marketplace-classification-dryrun.json   (machine-readable)
 *   - scratch/marketplace-classification-dryrun.md      (human-readable summary)
 *
 * Usage: node scripts/marketplace-classification-dryrun.js
 */
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const { supabase } = await import('../backend/db/supabase.js')
const { listMarketplaceListings } = await import('../backend/services/marketplace/listingSummaryService.js')
const {
  classifyVehicleConditionCandidate,
  partsentryCheckedStatus,
  NAV_PROMOTION_THRESHOLD,
} = await import('../backend/services/marketplace/marketplaceClassificationRules.js')

let isPublicVehicleStatus
try { ({ isPublicVehicleStatus } = await import('../backend/utils/vehicleStatus.js')) } catch { /* fallback below */ }
const PUBLIC_STATUS = new Set(['available', 'reserved', 'active'])
const isPublic = (status) => (isPublicVehicleStatus ? isPublicVehicleStatus(status) : PUBLIC_STATUS.has(String(status || '').toLowerCase()))

const CONDITION_TARGETS = ['brand_new', 'recently_imported', 'locally_used', 'second_hand']
const TAG_TARGETS = ['passport_verified', 'partsentry_checked', 'dealer_verified']
const AUTO_TARGETS = ['locally_used', 'recently_imported'] // the only ones the dry-run may propose

async function currentCoverage() {
  const cov = {}
  try { cov.all = (await listMarketplaceListings(supabase, { limit: 100 })).total } catch (e) { cov.all = `ERR:${e.message}` }
  for (const c of CONDITION_TARGETS) {
    try { cov[`category:${c}`] = (await listMarketplaceListings(supabase, { category: c, limit: 100 })).total } catch (e) { cov[`category:${c}`] = `ERR:${e.message}` }
  }
  for (const t of TAG_TARGETS) {
    try { cov[`tag:${t}`] = (await listMarketplaceListings(supabase, { tag: t, limit: 100 })).total } catch (e) { cov[`tag:${t}`] = `ERR:${e.message}` }
  }
  return cov
}

async function fetchVehicles() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('vin, status, vehicle_condition_category, import_source, registration_country, year, mileage, current_seller_type, passport_verified, owner_id, tenant_id')
  if (error) throw new Error(`vehicles select failed: ${error.message}`)
  return data || []
}

async function fetchPartsentryByVin() {
  const map = new Map()
  try {
    const { data, error } = await supabase
      .from('partsentry_logs')
      .select('vin, verification_status, part_verification_status, public_card_eligible, suspicion_status, mechanic_id')
    if (error) { console.warn('partsentry_logs select skipped:', error.message); return { map, total: 0, error: error.message } }
    for (const row of data || []) {
      if (!row.vin) continue
      if (!map.has(row.vin)) map.set(row.vin, [])
      map.get(row.vin).push(row)
    }
    return { map, total: (data || []).length }
  } catch (e) { return { map, total: 0, error: e.message } }
}

function pct(n, d) { return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a' }

async function main() {
  const generatedNote = 'NB: timestamp intentionally omitted (deterministic, read-only).'
  const coverage = await currentCoverage()
  const allVehicles = await fetchVehicles()
  const publicVehicles = allVehicles.filter(v => isPublic(v.status))
  const { map: peByVin, total: peTotal, error: peError } = await fetchPartsentryByVin()

  // current vehicle_condition_category distribution (public)
  const conditionDist = {}
  for (const v of publicVehicles) {
    const k = String(v.vehicle_condition_category ?? 'NULL').toLowerCase()
    conditionDist[k] = (conditionDist[k] || 0) + 1
  }

  // Apply classification rules to public, currently-unknown vehicles.
  const proposals = { locally_used: [], recently_imported: [] }
  const excluded = []
  for (const v of publicVehicles) {
    const c = classifyVehicleConditionCandidate(v)
    const row = {
      vin: v.vin,
      current_category: c.current,
      proposed_category: c.proposed,
      source_fields: { import_source: v.import_source ?? null, registration_country: v.registration_country ?? null, year: v.year ?? null, mileage: v.mileage ?? null, current_seller_type: v.current_seller_type ?? null },
      reason: c.reason,
      confidence: c.confidence,
      risk: c.risk,
      included: c.included,
    }
    if (c.included && proposals[c.proposed]) proposals[c.proposed].push(row)
    else excluded.push(row)
  }

  // Governed-only tag assessments (never auto-proposed).
  const passportCurrent = publicVehicles.filter(v => v.passport_verified === true).length
  let partsentryEligibleVins = 0
  for (const v of publicVehicles) {
    const st = partsentryCheckedStatus(peByVin.get(v.vin) || [])
    if (st.isChecked) partsentryEligibleVins += 1
  }

  // Excluded-reason histogram
  const excludedReasons = {}
  for (const r of excluded) {
    const key = String(r.reason).replace(/\(.*$/, '').trim() // collapse parametrized reasons
    excludedReasons[key] = (excludedReasons[key] || 0) + 1
  }

  const projectedByTarget = {
    brand_new: { auto: 0, governedOnly: true },
    recently_imported: { auto: proposals.recently_imported.length, governedOnly: false },
    locally_used: { auto: proposals.locally_used.length, governedOnly: false },
    second_hand: { auto: 0, governedOnly: true },
    passport_verified: { auto: 0, governedOnly: true, current: passportCurrent },
    partsentry_checked: { auto: 0, governedOnly: true, current: partsentryEligibleVins },
  }

  function recommendation(target) {
    const isTag = ['passport_verified', 'partsentry_checked'].includes(target)
    const isGovernedCat = ['brand_new', 'second_hand'].includes(target)
    if (isTag || isGovernedCat) return 'GOVERNED-ONLY'
    const projected = projectedByTarget[target].auto
    return projected >= NAV_PROMOTION_THRESHOLD ? 'WIRE-after-approved-backfill' : 'DEFER'
  }

  const beforeAfter = {}
  for (const target of [...CONDITION_TARGETS, 'passport_verified', 'partsentry_checked']) {
    const isTag = ['passport_verified', 'partsentry_checked'].includes(target)
    const current = isTag ? coverage[`tag:${target}`] : coverage[`category:${target}`]
    const auto = projectedByTarget[target]?.auto ?? 0
    const projected = AUTO_TARGETS.includes(target) ? (Number(current) || 0) + auto : current
    beforeAfter[target] = {
      current,
      projected_after_safe_backfill: AUTO_TARGETS.includes(target) ? projected : `${current} (no auto backfill)`,
      passes_threshold: AUTO_TARGETS.includes(target) ? (Number(projected) >= NAV_PROMOTION_THRESHOLD) : false,
      recommendation: recommendation(target),
    }
  }

  const report = {
    note: generatedNote,
    db_writes: false,
    threshold: NAV_PROMOTION_THRESHOLD,
    totals: { vehicles_total: allVehicles.length, vehicles_public: publicVehicles.length, partsentry_logs_total: peTotal, partsentry_error: peError || null },
    current_coverage: coverage,
    current_condition_distribution_public: conditionDist,
    projected_auto_candidates: {
      locally_used: proposals.locally_used.length,
      recently_imported: proposals.recently_imported.length,
    },
    governed_only_counts: {
      brand_new: { current: coverage['category:brand_new'], auto: 0, note: 'never auto-classified' },
      second_hand: { current: coverage['category:second_hand'], auto: 0, note: 'never auto-classified' },
      passport_verified: { current: coverage['tag:passport_verified'], eligible_now: passportCurrent, auto: 0, note: 'governed approval + verified evidence' },
      partsentry_checked: { current: coverage['tag:partsentry_checked'], eligible_now: partsentryEligibleVins, auto: 0, note: 'verified PartSentry review + public-card eligible' },
    },
    before_after: beforeAfter,
    row_level: { proposed: proposals, excluded },
    excluded_reason_histogram: excludedReasons,
    summary: {
      safe_to_backfill_later: AUTO_TARGETS.filter(t => projectedByTarget[t].auto >= NAV_PROMOTION_THRESHOLD),
      thin_borderline: AUTO_TARGETS.filter(t => projectedByTarget[t].auto > 0 && projectedByTarget[t].auto < NAV_PROMOTION_THRESHOLD),
      governed_only: ['brand_new', 'second_hand', 'passport_verified', 'partsentry_checked'],
      never_inferred: ['passport_verified', 'partsentry_checked', 'brand_new', 'second_hand'],
    },
  }

  // ---- write outputs to scratch/ ----
  const outDir = path.resolve(process.cwd(), 'scratch')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'marketplace-classification-dryrun.json'), JSON.stringify(report, null, 2))

  const md = renderMarkdown(report)
  fs.writeFileSync(path.join(outDir, 'marketplace-classification-dryrun.md'), md)

  // ---- stdout summary (for PR) ----
  console.log('=== MARKETPLACE CLASSIFICATION DRY-RUN (read-only, NO DB writes) ===')
  console.log(`vehicles: ${report.totals.vehicles_total} total, ${report.totals.vehicles_public} public`)
  console.log('current condition distribution (public):', JSON.stringify(conditionDist))
  console.log('current coverage:', JSON.stringify(coverage))
  console.log('projected AUTO candidates -> locally_used:', proposals.locally_used.length, '| recently_imported:', proposals.recently_imported.length)
  console.log('governed-only (never auto) -> brand_new, second_hand, passport_verified(', passportCurrent, 'eligible), partsentry_checked(', partsentryEligibleVins, 'eligible)')
  console.log('excluded reasons:', JSON.stringify(excludedReasons))
  console.log('before/after + recommendation:')
  for (const [t, ba] of Object.entries(beforeAfter)) {
    console.log(`  ${t}: current=${ba.current} -> projected=${ba.projected_after_safe_backfill} | passes>=${NAV_PROMOTION_THRESHOLD}=${ba.passes_threshold} | ${ba.recommendation}`)
  }
  console.log('outputs: scratch/marketplace-classification-dryrun.json + .md')
  process.exit(0)
}

function renderMarkdown(r) {
  const L = []
  L.push('# Marketplace Classification Dry-Run (read-only)')
  L.push('')
  L.push('> **No database writes.** SELECT-only. Shows what a *safe* classification backfill WOULD do.')
  L.push('')
  L.push(`- Vehicles: **${r.totals.vehicles_total}** total, **${r.totals.vehicles_public}** public`)
  L.push(`- PartSentry logs: **${r.totals.partsentry_logs_total}**`)
  L.push(`- Nav promotion threshold: **>= ${r.threshold}** live listings`)
  L.push('')
  L.push('## 1. Current coverage')
  L.push('```json')
  L.push(JSON.stringify(r.current_coverage, null, 2))
  L.push('```')
  L.push(`Current public \`vehicle_condition_category\` distribution: \`${JSON.stringify(r.current_condition_distribution_public)}\``)
  L.push('')
  L.push('## 2. Projected automatic candidates (SAFE bucket)')
  L.push(`- \`locally_used\`: **${r.projected_auto_candidates.locally_used}**`)
  L.push(`- \`recently_imported\`: **${r.projected_auto_candidates.recently_imported}**`)
  L.push('')
  L.push('## 3. Governed-only (never auto-inferred)')
  for (const [k, v] of Object.entries(r.governed_only_counts)) {
    L.push(`- \`${k}\`: current=${v.current}, auto=0 — ${v.note}`)
  }
  L.push('')
  L.push('## 4. Before / after + recommendation')
  L.push('| target | current | projected (safe backfill) | passes threshold | recommendation |')
  L.push('|---|---|---|---|---|')
  for (const [t, ba] of Object.entries(r.before_after)) {
    L.push(`| ${t} | ${ba.current} | ${ba.projected_after_safe_backfill} | ${ba.passes_threshold} | ${ba.recommendation} |`)
  }
  L.push('')
  L.push('## 5. Excluded rows — reasons')
  L.push('```json')
  L.push(JSON.stringify(r.excluded_reason_histogram, null, 2))
  L.push('```')
  L.push('')
  L.push('## 6. Summary recommendation')
  L.push(`- **Safe to backfill later (>= ${r.threshold}):** ${JSON.stringify(r.summary.safe_to_backfill_later)}`)
  L.push(`- **Thin / borderline (< ${r.threshold}):** ${JSON.stringify(r.summary.thin_borderline)}`)
  L.push(`- **Governed-only:** ${JSON.stringify(r.summary.governed_only)}`)
  L.push(`- **Never inferred:** ${JSON.stringify(r.summary.never_inferred)}`)
  L.push('')
  L.push('Row-level proposed/excluded detail is in the JSON output.')
  return L.join('\n')
}

main().catch(e => { console.error('DRYRUN_ERROR', e.message); process.exit(1) })
