// Pure delivery-recovery categorisation for the Command Center recovery view (plan §11).
//
// Buckets notification_queue rows into the operator-facing recovery categories: queued too long,
// stale processing locks, retry scheduled, failed, dead-lettered, and cancelled. No DB coupling —
// unit-tested and reused by the /recovery endpoint over a tenant-scoped row set.

export const RECOVERY_CATEGORIES = [
  'queued_too_long', 'stale_processing', 'retry_scheduled', 'failed', 'dead_letter', 'cancelled',
];

function ageMs(row, now) {
  const at = row.next_attempt_at || row.scheduled_at || row.created_at || null;
  const t = at ? Date.parse(at) : NaN;
  return Number.isNaN(t) ? 0 : now - t;
}

/**
 * @param {Array<object>} notifications  notification_queue rows (already tenant-scoped)
 * @param {object} opts  { now, staleAfterSeconds=900, queuedThresholdSeconds=300 }
 * @returns {{ categories: Record<string, object[]>, counts: Record<string, number> }}
 */
export function categorizeRecovery(notifications = [], opts = {}) {
  const now = opts.now ?? Date.now();
  const staleMs = Number(opts.staleAfterSeconds ?? 900) * 1000;
  const queuedMs = Number(opts.queuedThresholdSeconds ?? 300) * 1000;

  const categories = { queued_too_long: [], stale_processing: [], retry_scheduled: [], failed: [], dead_letter: [], cancelled: [] };

  for (const row of notifications) {
    const status = String(row.status || '').toLowerCase();
    if (status === 'dead_letter') categories.dead_letter.push(row);
    else if (status === 'cancelled') categories.cancelled.push(row);
    else if (status === 'failed') categories.failed.push(row);
    else if (status === 'retry_scheduled') categories.retry_scheduled.push(row);
    else if (status === 'processing') {
      const lockedMs = row.locked_at ? now - Date.parse(row.locked_at) : 0;
      if (row.locked_at && lockedMs > staleMs) categories.stale_processing.push(row);
    } else if (status === 'queued' && ageMs(row, now) > queuedMs) {
      categories.queued_too_long.push(row);
    }
  }

  const counts = {};
  let total = 0;
  for (const key of RECOVERY_CATEGORIES) {
    counts[key] = categories[key].length;
    total += counts[key];
  }
  counts.total = total;
  return { categories, counts };
}
