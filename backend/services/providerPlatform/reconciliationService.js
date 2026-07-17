/**
 * Provider reconciliation — Full Activation.
 *
 * Generic scheduled reconciliation for any provider capability. Compares an external
 * settlement/result set (provided by the caller, e.g. a signed batch file or provider
 * report) against the internal append-only attempt/decision history, records matched +
 * mismatched counts into reconciliation_jobs, and queues each unmatched item into
 * reconciliation_mismatches for human review. Reconciliation artifacts live in a private
 * Storage bucket (report_ref path only — never contents in the DB).
 */
import { supabase } from '../../db/supabase.js';

/**
 * Run a reconciliation pass.
 * @param providerId          provider_registry id
 * @param capabilityType      'government_source' | 'insurance' | 'finance' | 'escrow'
 * @param externalRecords     [{ external_ref, internal_ref?, amount_cents?, ... }]
 * @param internalLookup      async (record) => internal row or null  (injected; testable)
 * @param opts                { window_start, window_end, report_ref }
 * @returns the reconciliation_jobs row with matched/mismatch counts
 */
export async function runReconciliation(providerId, capabilityType, externalRecords, internalLookup, opts = {}) {
  const { data: job, error } = await supabase.from('reconciliation_jobs').insert({
    provider_id: providerId, capability_type: capabilityType,
    window_start: opts.window_start || null, window_end: opts.window_end || null,
    status: 'running', report_ref: opts.report_ref || null,
  }).select().single();
  if (error) throw new Error(`failed to create reconciliation job: ${error.message}`);

  let matched = 0;
  const mismatches = [];
  for (const rec of externalRecords || []) {
    let internal = null;
    try { internal = await internalLookup(rec); } catch { internal = null; }
    if (!internal) {
      mismatches.push({ external_ref: rec.external_ref || null, internal_ref: null, mismatch_type: 'missing_internal', detail: rec });
    } else if (rec.amount_cents != null && internal.amount_cents != null && Number(rec.amount_cents) !== Number(internal.amount_cents)) {
      mismatches.push({ external_ref: rec.external_ref || null, internal_ref: internal.ref || null, mismatch_type: 'amount_mismatch', detail: { external: rec.amount_cents, internal: internal.amount_cents } });
    } else {
      matched++;
    }
  }

  if (mismatches.length) {
    await supabase.from('reconciliation_mismatches').insert(
      mismatches.map((m) => ({ job_id: job.id, provider_id: providerId, external_ref: m.external_ref, internal_ref: m.internal_ref, mismatch_type: m.mismatch_type, detail: m.detail, resolution: 'open' }))
    );
  }

  const status = mismatches.length === 0 ? 'succeeded' : 'partial';
  const { data: done } = await supabase.from('reconciliation_jobs')
    .update({ status, matched_count: matched, mismatch_count: mismatches.length, updated_at: new Date().toISOString() })
    .eq('id', job.id).select().single();
  return done || { ...job, status, matched_count: matched, mismatch_count: mismatches.length };
}

export async function listOpenMismatches(providerId) {
  const { data } = await supabase.from('reconciliation_mismatches')
    .select('*').eq('provider_id', providerId).eq('resolution', 'open').order('created_at', { ascending: false });
  return data || [];
}

export async function resolveMismatch(mismatchId, resolution, { actor } = {}) {
  const allowed = ['investigating', 'resolved', 'written_off'];
  if (!allowed.includes(resolution)) throw new Error(`invalid resolution ${resolution}`);
  const { data, error } = await supabase.from('reconciliation_mismatches')
    .update({ resolution }).eq('id', mismatchId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export default { runReconciliation, listOpenMismatches, resolveMismatch };
