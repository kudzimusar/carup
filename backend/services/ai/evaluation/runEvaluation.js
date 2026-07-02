/**
 * AI evaluation harness — Milestone 3 (master plan §7.6, §13.3).
 *
 * Runs a provider against the labeled eval dataset and reports PER-TASK metrics:
 * accuracy, precision/recall/false-positive (for boolean tasks), abstention rate, and
 * latency. Provider-agnostic: pass the mock for deterministic CI numbers, or the live
 * provider for real quality measurement. Per master plan §13.3 there is NO single overall
 * accuracy number — metrics are reported per task, and high-risk public findings require
 * conservative thresholds + human confirmation (this harness reports; it never publishes).
 *
 * Run:  node backend/services/ai/evaluation/runEvaluation.js
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mockAnalysisProvider } from '../analysisProvider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function actualFor(task, out) {
  switch (task) {
    case 'image_quality': return { usable: out.result?.usable };
    case 'plate_ocr': return { plate: out.result?.plate ?? null };
    case 'vin_ocr': return { vin: out.result?.vin ?? null };
    case 'odometer_ocr': return { odometer: out.result?.odometer ?? null };
    case 'damage_detection': return { has_damage: (out.result?.damage || []).length > 0 };
    case 'manipulation': return { manipulated: !!out.result?.manipulated };
    case 'repair_paint_inconsistency': return { repainted: !!out.result?.repainted };
    default: return out.result || {};
  }
}

function matches(expect, actual) {
  return Object.keys(expect).every((k) => JSON.stringify(expect[k]) === JSON.stringify(actual[k]));
}

export async function runEvaluation({ provider = mockAnalysisProvider, dataset } = {}) {
  const data = dataset || JSON.parse(readFileSync(join(__dirname, 'evalDataset.json'), 'utf-8'));
  const perTask = {};

  for (const c of data.cases) {
    const t = c.task;
    perTask[t] = perTask[t] || { task: t, total: 0, correct: 0, tp: 0, fp: 0, fn: 0, tn: 0, abstain: 0, latencyMs: 0 };
    const m = perTask[t];
    const start = Date.now();
    let out;
    try {
      out = await provider.analyze(t, { metadata: c.metadata || {} });
    } catch {
      m.total += 1; m.abstain += 1; continue;
    }
    m.latencyMs += Date.now() - start;
    const actual = actualFor(t, out);
    const correct = matches(c.expect, actual);
    m.total += 1;
    if (correct) m.correct += 1;

    // boolean precision/recall bookkeeping where the expectation is a single boolean
    const boolKey = Object.keys(c.expect).find((k) => typeof c.expect[k] === 'boolean');
    if (boolKey) {
      const exp = c.expect[boolKey]; const act = !!actual[boolKey];
      if (exp && act) m.tp += 1; else if (!exp && act) m.fp += 1; else if (exp && !act) m.fn += 1; else m.tn += 1;
    }
    if (typeof out.confidence === 'number' && out.confidence < 0.6) m.abstain += 1;
  }

  const report = Object.values(perTask).map((m) => {
    const precision = (m.tp + m.fp) ? m.tp / (m.tp + m.fp) : null;
    const recall = (m.tp + m.fn) ? m.tp / (m.tp + m.fn) : null;
    const fpr = (m.fp + m.tn) ? m.fp / (m.fp + m.tn) : null;
    return {
      task: m.task, n: m.total,
      accuracy: m.total ? +(m.correct / m.total).toFixed(3) : null,
      precision: precision != null ? +precision.toFixed(3) : null,
      recall: recall != null ? +recall.toFixed(3) : null,
      false_positive_rate: fpr != null ? +fpr.toFixed(3) : null,
      abstention_rate: m.total ? +(m.abstain / m.total).toFixed(3) : null,
      avg_latency_ms: m.total ? Math.round(m.latencyMs / m.total) : null,
    };
  });

  return { provider: provider.id, mode: provider.mode, version: data.version, tasks: report };
}

// Allow direct execution (path-safe comparison; handles spaces in the path).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runEvaluation().then((r) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(r, null, 2));
  });
}

export default { runEvaluation };
