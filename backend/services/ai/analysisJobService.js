/**
 * Durable AI analysis job service — Milestone 3A (master plan §7.4).
 *
 * Runs a typed analysis task through a provider and persists a durable job with full
 * lifecycle (queued → processing → succeeded | failed_retryable | failed_terminal |
 * manual_review_required). Stores provider/model, latency, confidence, structured result,
 * validation errors, and a public-safe summary. AI stays advisory: this NEVER changes
 * evidence verification_status or trust (master plan §2.2) — it records observations and,
 * below a confidence threshold, routes to manual review (not auto-publication, §7.6).
 */
import { resolveAnalysisProvider } from './analysisProvider.js';

const JOBS = 'ai_analysis_jobs';
const OBS = 'ai_observations';

// Below this confidence a successful task is flagged for human review rather than trusted.
export const MANUAL_REVIEW_THRESHOLD = 0.6;

export async function createAnalysisJob(supabase, { evidenceId, vin, taskType }) {
  const { data, error } = await supabase.from(JOBS).insert({
    evidence_id: evidenceId, vin: vin || null, task_type: taskType, status: 'queued', attempts: 0,
  }).select();
  if (error) throw new Error(`create analysis job failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Execute a queued job. monotonicClock lets tests inject deterministic latency.
 */
export async function runAnalysisJob(supabase, job, ctx = {}, opts = {}) {
  const provider = opts.provider || resolveAnalysisProvider({ forceMock: opts.forceMock });
  const start = opts.now ? opts.now() : Date.now();
  await supabase.from(JOBS).update({ status: 'processing', attempts: (Number(job.attempts) || 0) + 1, started_at: new Date().toISOString(), provider: provider.id }).eq('id', job.id);

  try {
    const out = await provider.analyze(job.task_type, ctx);
    const latency = (opts.now ? opts.now() : Date.now()) - start;
    const confidence = typeof out.confidence === 'number' ? out.confidence : null;
    const status = confidence != null && confidence < MANUAL_REVIEW_THRESHOLD ? 'manual_review_required' : 'succeeded';

    const { data: updated } = await supabase.from(JOBS).update({
      status, provider: out.provider || provider.id, model: out.model || null,
      latency_ms: latency, confidence, result: out.result || {}, safe_summary: out.safe_summary || null,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', job.id).select();

    // Persist typed observations.
    for (const o of out.observations || []) {
      await supabase.from(OBS).insert({ job_id: job.id, evidence_id: job.evidence_id, task_type: job.task_type, observation_type: o.type, value: o.value || {}, confidence: o.confidence ?? confidence });
    }
    return Array.isArray(updated) ? updated[0] : updated;
  } catch (err) {
    const attempts = (Number(job.attempts) || 0) + 1;
    const terminal = attempts >= (Number(job.max_attempts) || 3);
    const { data: failed } = await supabase.from(JOBS).update({
      status: terminal ? 'failed_terminal' : 'failed_retryable',
      validation_errors: [{ message: err.message }], updated_at: new Date().toISOString(),
    }).eq('id', job.id).select();
    return Array.isArray(failed) ? failed[0] : failed;
  }
}

/** Convenience: create + run a job in one call. */
export async function analyzeEvidence(supabase, { evidenceId, vin, taskType, ctx = {}, opts = {} }) {
  const job = await createAnalysisJob(supabase, { evidenceId, vin, taskType });
  return runAnalysisJob(supabase, job, ctx, opts);
}

export default { MANUAL_REVIEW_THRESHOLD, createAnalysisJob, runAnalysisJob, analyzeEvidence };
