// Pure per-channel provider operations telemetry (plan §12 / P1.4).
//
// Joins the live adapter health with recent webhook logs, delivery attempts, and queue rows to
// produce the operational evidence the Command Center's Providers surface needs — webhook
// configured/verified, latest inbound webhook, latest successful outbound, latest provider error,
// per-channel queue/retry/dead-letter counts, and credential PRESENCE (never values). No DB coupling.

const OUTBOUND_OK = new Set(['sent', 'delivered', 'read']);

function toEpoch(v) {
  const n = v ? Date.parse(v) : NaN;
  return Number.isNaN(n) ? -Infinity : n;
}

// Most recent row (by the given timestamp field) matching a predicate.
function latest(rows, tsField, predicate = () => true) {
  let best = null;
  let bestTs = -Infinity;
  for (const r of rows) {
    if (!predicate(r)) continue;
    const t = toEpoch(r[tsField]);
    if (t >= bestTs) { bestTs = t; best = r; }
  }
  return best;
}

/**
 * @param {Array<object>} adapterHealth  registry.health() → [{ channel, mode, available, provider, missing, webhookPath? }]
 * @param {object} data                  { attempts, webhooks, notifications, now, staleAfterSeconds }
 * @returns {Array<object>} one telemetry row per channel
 */
export function buildProviderTelemetry(adapterHealth = [], data = {}) {
  const attempts = data.attempts || [];
  const webhooks = data.webhooks || [];
  const notifications = data.notifications || [];

  return adapterHealth.map((h) => {
    const channel = String(h.channel || '').toLowerCase();
    const chAttempts = attempts.filter((a) => String(a.channel || '').toLowerCase() === channel);
    const chWebhooks = webhooks.filter((w) => String(w.channel || '').toLowerCase() === channel);
    const chNotifs = notifications.filter((n) => String(n.channel || '').toLowerCase() === channel);

    const latestInbound = latest(chWebhooks, 'received_at');
    const latestSuccess = latest(chAttempts, 'completed_at', (a) => OUTBOUND_OK.has(String(a.status || '').toLowerCase()));
    const latestError = latest(chAttempts, 'started_at', (a) => a.error_code || a.error_message
      || ['failed', 'dead_letter', 'error'].includes(String(a.status || '').toLowerCase()));

    const countBy = (status) => chNotifs.filter((n) => String(n.status || '').toLowerCase() === status).length;
    const missing = Array.isArray(h.missing) ? h.missing : [];

    return {
      channel,
      provider: h.provider ?? null,
      mode: h.mode ?? (h.available ? 'real' : 'unknown'),   // real | fake | not_configured | planned
      available: Boolean(h.available),
      webhook: {
        path: h.webhookPath ?? h.webhook_path ?? null,
        configured: Boolean(h.webhookPath || h.webhook_path || h.webhookConfigured),
        latest_inbound_at: latestInbound?.received_at ?? null,
        last_signature_valid: latestInbound ? Boolean(latestInbound.signature_valid) : null,
      },
      outbound: {
        latest_success_at: latestSuccess?.completed_at ?? null,
        latest_success_provider_message_id: latestSuccess?.provider_message_id ?? null,
      },
      latest_error: latestError ? {
        at: latestError.started_at ?? null,
        code: latestError.error_code ?? null,
        message: latestError.error_message ?? null,
      } : null,
      queue: {
        queued: countBy('queued'),
        retry_scheduled: countBy('retry_scheduled'),
        dead_letter: countBy('dead_letter'),
      },
      // Credential PRESENCE only — the names that are missing, and whether the set is complete.
      credentials: { complete: missing.length === 0, missing },
    };
  });
}
