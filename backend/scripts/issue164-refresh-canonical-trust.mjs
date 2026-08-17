#!/usr/bin/env node
/**
 * Issue #164 — materialize the canonical Trust position.
 *
 * WHY THIS EXISTS. Every public surface now reads the canonical cache and nothing recomputes on
 * read, which is what makes one VIN yield one score everywhere. The consequence is that a vehicle
 * has no published score until something WRITES that cache. Evidence review refreshes a vehicle as
 * its facts change (vehiclesRoutes evidence verify/reject), but existing vehicles were scored
 * before the canonical model existed and carry an unversioned legacy number that is correctly
 * refused. This script is the backfill, and the periodic re-materializer.
 *
 * It is a WRITER, so it is guarded like one:
 *   - the target must positively identify canonical staging; "not production" is not sufficient;
 *   - --dry-run reports what would be written without writing;
 *   - it writes ONLY through refreshCanonicalTrust, the single canonical writer, so every score it
 *     lands is stamped with the rules and instant that produced it.
 *
 * It never fabricates: a vehicle whose decision is not a stamped, current-version evaluation is
 * reported as skipped, and its cache is left empty rather than filled with a plausible number.
 *
 * Usage:
 *   DIASPORA_STAGING_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node backend/scripts/issue164-refresh-canonical-trust.mjs [--dry-run] [--limit=N] [--vin=VIN]
 *
 * Exit codes: 0 completed · 1 completed with failures · 2 BLOCKED (target not identified)
 */
import { supabase } from '../db/supabase.js';
import { refreshCanonicalTrust } from '../services/trustDecision/canonicalTrustService.js';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');

const blocked = (message) => { console.error(`BLOCKED: ${message}`); process.exit(2); };
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const dryRun = process.argv.includes('--dry-run');

function assertCanonicalStaging() {
  // Identify the target the SAME way every other guarded script in this programme does, and refuse
  // anything that is not positively recognised.
  const candidates = [process.env.DIASPORA_STAGING_DATABASE_URL, process.env.SUPABASE_URL].filter(Boolean);
  if (!candidates.length) blocked('neither DIASPORA_STAGING_DATABASE_URL nor SUPABASE_URL is set');
  for (const value of candidates) {
    if (value.includes(FORBIDDEN_PROD_REF)) blocked('target references the forbidden production project');
  }
  if (!candidates.some((value) => value.includes(STAGING_REF))) {
    blocked(`target does not positively identify canonical staging ${STAGING_REF}`);
  }
}

async function main() {
  assertCanonicalStaging();

  const singleVin = arg('vin');
  const limit = Number(arg('limit')) || 500;

  let query = supabase.from('vehicles').select('vin').order('created_at', { ascending: true }).limit(limit);
  if (singleVin) query = supabase.from('vehicles').select('vin').eq('vin', singleVin);

  const { data, error } = await query;
  if (error) blocked(`could not read vehicles: ${error.message}`);

  const vins = (data || []).map((row) => row.vin).filter(Boolean);
  const summary = { target: STAGING_REF, dryRun, considered: vins.length, written: 0, skipped: 0, failed: 0, skips: {} };

  for (const vin of vins) {
    try {
      const result = await refreshCanonicalTrust(vin, { dryRun });
      if (result.written || (dryRun && result.patch)) summary.written += 1;
      else {
        summary.skipped += 1;
        const reason = result.reason || 'unknown';
        summary.skips[reason] = (summary.skips[reason] || 0) + 1;
      }
    } catch (err) {
      summary.failed += 1;
      console.error(`  refresh failed for ${vin}: ${err.message}`);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary.failed ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`BLOCKED: ${err.message}`);
  process.exit(2);
});
