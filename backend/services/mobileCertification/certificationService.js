/**
 * Native Mobile Certification service — Full Activation (canonical §132-154, §167).
 *
 * Persists the evidence produced when a release-grade native build is certified against a
 * physical device / emulator: one `mobile_certification_runs` row per (platform, device, OS,
 * build), and an APPEND-ONLY `mobile_certification_results` ledger of per-check outcomes.
 *
 * Design constraints mirrored from the migration + program invariants:
 *   - results are append-only: this service only ever INSERTs results — it exposes NO update
 *     or delete path, and the DB `governance_block_mutation()` trigger blocks mutation at the
 *     database layer too (belt + braces).
 *   - evidence_ref is a Supabase Storage PATH ONLY (private bucket). We reject anything that
 *     looks like a public URL or inline bytes so screenshots/traces are never leaked through
 *     this control-plane column.
 *   - reads are admin/government/service scoped, mirroring the RLS policy shape so the service
 *     API and the database policy agree ("RLS-shape").
 *
 * Uses the shared Supabase client so it works against the real project AND the in-memory mock
 * used by the test-suite (no new infra needed to exercise it).
 */
import { supabase } from '../../db/supabase.js';

export const PLATFORMS = new Set(['android', 'ios']);
export const BUILD_TYPES = new Set(['debug', 'release']);
export const RUN_STATUSES = new Set(['pending', 'running', 'passed', 'failed', 'blocked']);
export const RESULT_VALUES = new Set(['pass', 'fail', 'skip']);

/** Roles allowed to READ certification evidence — mirrors the migration's admin-read RLS. */
const READ_ROLES = new Set(['admin', 'government', 'service_role']);

/**
 * Guard reads to the same roles the RLS policy permits. Keeping this in the service means the
 * API refuses a non-admin caller even where the caller bypasses Postgres RLS (e.g. a service
 * using the service-role key on behalf of a user). Throws on an unauthorized actor.
 */
export function assertCanReadCertification(actor = {}) {
  const role = actor && actor.role;
  if (!READ_ROLES.has(role)) {
    const err = new Error('forbidden: certification evidence is admin/government read-only');
    err.code = 'FORBIDDEN';
    throw err;
  }
}

/**
 * Validate an evidence_ref is a private Storage PATH — not a URL, not inline bytes. Returns the
 * trimmed path, or null when absent. Throws on a URL/data-URI so we never persist a leaky ref.
 */
export function normalizeEvidenceRef(ref) {
  if (ref == null || ref === '') return null;
  const s = String(ref).trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^data:/i.test(s)) {
    throw new Error('evidence_ref must be a Supabase Storage path, not a URL or inline data');
  }
  if (s.length > 512) throw new Error('evidence_ref too long (max 512 chars)');
  return s;
}

/**
 * Create a certification run. Fail-closed validation on the CHECK-constrained columns so a bad
 * platform/build/status is rejected in the service the same way the DB would reject it.
 *
 * @param {{platform:string, device_model:string, os_version:string, build_type:string,
 *          status?:string, tenant_id?:string|null, started_at?:string|null}} input
 * @returns {Promise<object>} the created run row (with id)
 */
export async function recordRun(input = {}) {
  if (!PLATFORMS.has(input.platform)) throw new Error(`invalid platform: ${input.platform}`);
  if (!input.device_model) throw new Error('device_model required');
  if (!input.os_version) throw new Error('os_version required');
  if (!BUILD_TYPES.has(input.build_type)) throw new Error(`invalid build_type: ${input.build_type}`);
  const status = input.status || 'running';
  if (!RUN_STATUSES.has(status)) throw new Error(`invalid status: ${status}`);

  const row = {
    platform: input.platform,
    device_model: input.device_model,
    os_version: input.os_version,
    build_type: input.build_type,
    status,
    tenant_id: input.tenant_id ?? null,
    started_at: input.started_at ?? new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('mobile_certification_runs')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Finalize a run's lifecycle status + completion time. This is the ONLY mutation the service
 * performs, and only on the (mutable) runs table — never on the append-only results ledger.
 *
 * @param {string} runId
 * @param {string} status  one of RUN_STATUSES (typically 'passed'|'failed'|'blocked')
 * @returns {Promise<object>} the updated run row
 */
export async function finalizeRun(runId, status) {
  if (!runId) throw new Error('runId required');
  if (!RUN_STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
  const { data, error } = await supabase
    .from('mobile_certification_runs')
    .update({ status, completed_at: new Date().toISOString() })
    .eq('id', runId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Append ONE check result to the immutable ledger. Append-only by construction: it only INSERTs.
 * Recording the same check_key twice for a run is allowed and produces TWO rows (the history is
 * a log, not a keyed upsert) — the DB trigger + the absence of any update/delete export guarantee
 * a recorded result can never be rewritten.
 *
 * @param {string} runId
 * @param {{check_key:string, result:string, detail?:string, evidence_ref?:string}} input
 * @returns {Promise<object>} the created result row
 */
export async function recordResult(runId, input = {}) {
  if (!runId) throw new Error('runId required');
  if (!input.check_key) throw new Error('check_key required');
  if (!RESULT_VALUES.has(input.result)) throw new Error(`invalid result: ${input.result}`);
  const evidence_ref = normalizeEvidenceRef(input.evidence_ref);

  const row = {
    run_id: runId,
    check_key: input.check_key,
    result: input.result,
    detail: input.detail ?? null,
    evidence_ref,
  };
  const { data, error } = await supabase
    .from('mobile_certification_results')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Derive an aggregate status from a run's result counts. Any fail => 'failed'; else if there are
 * passes and no fails => 'passed'; a run with only skips (nothing actually exercised) => 'blocked';
 * a run with no results yet => 'pending'.
 */
export function deriveStatus({ pass = 0, fail = 0, skip = 0 } = {}) {
  if (fail > 0) return 'failed';
  if (pass > 0) return 'passed';
  if (skip > 0) return 'blocked';
  return 'pending';
}

/**
 * Aggregate the certification matrix: every run with its per-result counts, a derived status, and
 * a program-level summary (by platform + overall pass/fail/skip). Read-gated to admin/government/
 * service actors to match the RLS policy shape.
 *
 * @param {{ actor?:{role?:string}, platform?:string, tenant_id?:string }} [opts]
 * @returns {Promise<{runs:object[], summary:object}>}
 */
export async function getRunMatrix(opts = {}) {
  assertCanReadCertification(opts.actor || {});

  let runsQuery = supabase.from('mobile_certification_runs').select('*');
  if (opts.platform) runsQuery = runsQuery.eq('platform', opts.platform);
  if (opts.tenant_id) runsQuery = runsQuery.eq('tenant_id', opts.tenant_id);
  const { data: runsData, error: runsErr } = await runsQuery;
  if (runsErr) throw new Error(runsErr.message);
  const runs = Array.isArray(runsData) ? runsData : [];

  const { data: resultsData, error: resErr } = await supabase
    .from('mobile_certification_results')
    .select('*');
  if (resErr) throw new Error(resErr.message);
  const results = Array.isArray(resultsData) ? resultsData : [];

  const byRun = new Map();
  for (const r of results) {
    const bucket = byRun.get(r.run_id) || { total: 0, pass: 0, fail: 0, skip: 0, checks: [] };
    bucket.total += 1;
    if (r.result === 'pass') bucket.pass += 1;
    else if (r.result === 'fail') bucket.fail += 1;
    else if (r.result === 'skip') bucket.skip += 1;
    bucket.checks.push({ check_key: r.check_key, result: r.result, detail: r.detail ?? null, evidence_ref: r.evidence_ref ?? null });
    byRun.set(r.run_id, bucket);
  }

  const summary = {
    total_runs: runs.length,
    by_platform: { android: 0, ios: 0 },
    totals: { pass: 0, fail: 0, skip: 0 },
    statuses: { pending: 0, running: 0, passed: 0, failed: 0, blocked: 0 },
  };

  const matrixRuns = runs.map((run) => {
    const counts = byRun.get(run.id) || { total: 0, pass: 0, fail: 0, skip: 0, checks: [] };
    const derived_status = deriveStatus(counts);
    if (run.platform === 'android') summary.by_platform.android += 1;
    else if (run.platform === 'ios') summary.by_platform.ios += 1;
    summary.totals.pass += counts.pass;
    summary.totals.fail += counts.fail;
    summary.totals.skip += counts.skip;
    if (summary.statuses[run.status] != null) summary.statuses[run.status] += 1;
    return {
      id: run.id,
      platform: run.platform,
      device_model: run.device_model,
      os_version: run.os_version,
      build_type: run.build_type,
      status: run.status,
      tenant_id: run.tenant_id ?? null,
      started_at: run.started_at ?? null,
      completed_at: run.completed_at ?? null,
      results: { total: counts.total, pass: counts.pass, fail: counts.fail, skip: counts.skip },
      derived_status,
      checks: counts.checks,
    };
  });

  return { runs: matrixRuns, summary };
}

export default { recordRun, finalizeRun, recordResult, getRunMatrix, deriveStatus, assertCanReadCertification, normalizeEvidenceRef };
