// Pure SLA state machine for the communication Command Center (plan §10).
//
// Reuses message_threads.sla_due_at plus the additive first_response/next_response/resolution targets
// and pause state added by 20260705180000_communication_sla.sql. No DB coupling — unit-tested and
// shared by the API + (mirrored) the frontend badge. States: healthy / due_soon / breached / paused /
// not_applicable. "Paused" freezes the clock (pause/resume adjusts sla_paused_seconds).

export const SLA_STATES = Object.freeze({
  HEALTHY: 'healthy',
  DUE_SOON: 'due_soon',
  BREACHED: 'breached',
  PAUSED: 'paused',
  NOT_APPLICABLE: 'not_applicable',
});

const TERMINAL = new Set(['resolved', 'closed', 'spam']);
const DUE_SOON_MS = 15 * 60 * 1000;

// Keep exact minutes for analytics/API compatibility, but never show users absurd
// historical values such as "First response overdue 41892m" on a reused thread.
// Human-facing labels progressively use minutes, hours and days while preserving the
// underlying deadline and raw minute count for SLA evidence.
function formatSlaDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }
  const days = Math.floor(minutes / (24 * 60));
  const remainingHours = Math.floor((minutes % (24 * 60)) / 60);
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

// The single most urgent unmet target on a thread drives the badge: prefer the earliest of the
// first-response (if not yet responded), next-response, resolution, or the legacy sla_due_at.
function activeTarget(thread) {
  const candidates = [];
  if (thread.first_response_due_at && !thread.first_response_at) {
    candidates.push({ kind: 'first_response', dueAt: thread.first_response_due_at });
  }
  if (thread.next_response_due_at) candidates.push({ kind: 'next_response', dueAt: thread.next_response_due_at });
  if (thread.resolution_due_at) candidates.push({ kind: 'resolution', dueAt: thread.resolution_due_at });
  if (!candidates.length && thread.sla_due_at) candidates.push({ kind: 'response', dueAt: thread.sla_due_at });
  candidates.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  return candidates[0] || null;
}

/**
 * Compute the SLA state for a thread.
 * @param {object} thread  message_threads row (+ SLA columns)
 * @param {number} now     epoch ms
 * @returns {{ state, kind: string|null, dueAt: string|null, minutes: number|null, label: string }}
 */
export function computeSlaState(thread = {}, now = Date.now()) {
  if (thread.sla_paused_at) {
    return { state: SLA_STATES.PAUSED, kind: null, dueAt: thread.sla_due_at || null, minutes: null, label: 'SLA paused' };
  }
  if (TERMINAL.has(String(thread.status || ''))) {
    return { state: SLA_STATES.NOT_APPLICABLE, kind: null, dueAt: null, minutes: null, label: '' };
  }
  const target = activeTarget(thread);
  if (!target) return { state: SLA_STATES.NOT_APPLICABLE, kind: null, dueAt: null, minutes: null, label: '' };

  const dueTime = new Date(target.dueAt).getTime();
  if (Number.isNaN(dueTime)) return { state: SLA_STATES.NOT_APPLICABLE, kind: null, dueAt: null, minutes: null, label: '' };

  const diffMs = dueTime - now;
  const minutes = Math.max(0, Math.round(Math.abs(diffMs) / 60000));
  const duration = formatSlaDuration(minutes);
  const noun = target.kind === 'resolution' ? 'Resolution' : target.kind === 'first_response' ? 'First response' : 'SLA';
  if (diffMs < 0) return { state: SLA_STATES.BREACHED, kind: target.kind, dueAt: target.dueAt, minutes, label: `${noun} overdue ${duration}` };
  if (diffMs < DUE_SOON_MS) return { state: SLA_STATES.DUE_SOON, kind: target.kind, dueAt: target.dueAt, minutes, label: `${noun} due in ${duration}` };
  return { state: SLA_STATES.HEALTHY, kind: target.kind, dueAt: target.dueAt, minutes, label: `${noun} in ${duration}` };
}

// Column patch to PAUSE the SLA clock (records when + why).
export function pausePatch(thread = {}, reason = 'paused', nowIso = new Date().toISOString()) {
  if (thread.sla_paused_at) return {}; // already paused — idempotent
  return { sla_paused_at: nowIso, sla_pause_reason: reason };
}

// Column patch to RESUME the SLA clock: clears pause state and pushes every due-at forward by the
// paused duration so time spent paused does not count against the SLA. Accumulates sla_paused_seconds.
export function resumePatch(thread = {}, now = Date.now()) {
  if (!thread.sla_paused_at) return {}; // not paused — idempotent
  const pausedMs = Math.max(0, now - new Date(thread.sla_paused_at).getTime());
  const pausedSeconds = Math.round(pausedMs / 1000);
  const shift = (iso) => (iso ? new Date(new Date(iso).getTime() + pausedMs).toISOString() : iso);
  const patch = {
    sla_paused_at: null,
    sla_pause_reason: null,
    sla_paused_seconds: Number(thread.sla_paused_seconds || 0) + pausedSeconds,
  };
  for (const col of ['sla_due_at', 'first_response_due_at', 'next_response_due_at', 'resolution_due_at']) {
    if (thread[col]) patch[col] = shift(thread[col]);
  }
  return patch;
}
