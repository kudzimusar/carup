/**
 * OC-5R-REL-01 — the outbound communications kill switch.
 *
 * There was no way to stop a CarUp runtime from sending. `COMMUNICATION_WORKER_ENABLED` was read by
 * nothing, `COMMUNICATION_ENGINE_ENABLED` gated no send, and the only operational stop ever used was
 * unscheduling a cron — which leaves every inline send (auth email, the admin smoke, the admin
 * credential probe) untouched. A staging preview holding real Resend/Brevo credentials could reach a
 * real inbox during an automated UAT.
 *
 * `COMMUNICATION_OUTBOUND_DISABLED` is that stop. It is read at SEND time from the environment (never
 * stored on an adapter registry: a process builds many), and it is enforced twice:
 *
 *   1. at the transport — every HTTP send an adapter makes (`HttpCommunicationAdapter.requestJson`
 *      and Twilio's form send) returns `outbound_disabled` WITHOUT contacting the provider, so no
 *      path — governed or not — can send while it is on;
 *   2. at the delivery worker — an external-channel notification is HELD (re-scheduled with its
 *      attempt restored, audited as `outbound_held`), not attempted, retried into exhaustion, or
 *      dead-lettered into a fallback channel.
 *
 * Internal channels (`in_app`, `web_chat`, `mobile_chat`) never leave CarUp and are not held.
 *
 * FAIL CLOSED: any value other than an explicit "off" spelling (false / 0 / no / off / empty)
 * disables outbound sending. Read-only provider calls (a template-status read, a credential lookup)
 * are not sends and are not affected.
 */
export const OUTBOUND_KILL_SWITCH_ENV = 'COMMUNICATION_OUTBOUND_DISABLED';
export const OUTBOUND_DISABLED_CODE = 'outbound_disabled';
export const OUTBOUND_HELD_EVENT = 'outbound_held';
/** How long a held notification waits before the worker looks at it again. */
export const OUTBOUND_HOLD_MS = 60 * 60 * 1000;

const OFF_SPELLINGS = new Set(['', 'false', '0', 'no', 'off']);
export const INTERNAL_CHANNELS = Object.freeze(['in_app', 'web_chat', 'mobile_chat']);

export function isOutboundDisabled(env = process.env) {
  const raw = env?.[OUTBOUND_KILL_SWITCH_ENV];
  if (raw === undefined || raw === null) return false;
  return !OFF_SPELLINGS.has(String(raw).trim().toLowerCase());
}

export function isExternalChannel(channel) {
  return !INTERNAL_CHANNELS.includes(String(channel || 'in_app').trim().toLowerCase());
}

/** The adapter result for a send the switch stopped. Retryable: the message is held, not lost. */
export function outboundDisabledResult(provider) {
  return {
    accepted: false,
    retryable: true,
    errorCode: OUTBOUND_DISABLED_CODE,
    errorMessage: `Outbound communications are disabled (${OUTBOUND_KILL_SWITCH_ENV}); ${provider} was not contacted and nothing was sent.`,
  };
}

/** What /api/health reports. Names and states only. */
export function outboundHealth(env = process.env) {
  const disabled = isOutboundDisabled(env);
  return {
    kill_switch: disabled ? 'active' : 'inactive',
    external_sends: disabled ? 'disabled' : 'enabled',
    internal_channels: 'enabled',
    control: OUTBOUND_KILL_SWITCH_ENV,
  };
}
