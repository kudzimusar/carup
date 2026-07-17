/**
 * Regulated REAL-MONEY escrow PROVIDER extension — Full Activation (canonical doc §115–130).
 *
 * Extends the trust-gated escrow lifecycle (escrowTrustService.js) with the regulatory control
 * surface a real-money escrow provider requires. It runs every escrow through the shared
 * provider framework (providerFramework.js) against a registered `escrow` provider and layers
 * a richer, immutable provider lifecycle on top of the existing append-only escrow_trust_events.
 *
 * Fail-closed by construction. A new provider escrow may be created ONLY when ALL hold:
 *   - global escrow capability enabled + global escrow kill switch off;
 *   - the provider is registered and callable (kill switch off, callable activation mode);
 *   - an ACTIVE escrow_provider_config exists with its own kill switch off;
 *   - the amount is within the configured transaction caps;
 *   - the participant(s) are on the pilot allowlist (when a pilot allowlist is set);
 *   - KYC/KYB is APPROVED for every required subject (when kyc_kyb_required);
 *   - the existing trust gates pass (identity / publication / fraud / dealer / participant /
 *     documents / listing snapshot).
 *
 * SANDBOX/LIVE SEPARATION: ONLY a provider whose activation_mode === 'live' moves real money.
 * Every other mode is labelled sandbox and can NEVER be represented as real money. No real funds
 * move until an approved provider + signed contracts + KYC/AML + settlement + real credentials
 * exist — none of which are invented here.
 *
 * Money history is immutable: provider lifecycle transitions append to escrow_trust_events;
 * reconciliation appends to escrow_reconciliation_ledger; dual-control approvals append to
 * escrow_dual_control_approvals. Nothing is ever updated or deleted.
 */
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { evaluateEscrowGates } from './escrowTrustService.js';
import { isCallable } from '../providerPlatform/providerRegistry.js';
import { executeProviderRequest } from '../providerPlatform/providerFramework.js';
import { isCapabilityEnabled } from '../featureFlags/capabilityFlags.js';

// ── Provider escrow lifecycle (distinct from the base escrow_trust FSM state names) ──────────
// funding → inspection → release → payout → reconciliation, with dispute/refund/cancellation
// branches. Recorded immutably in escrow_trust_events (from_status/to_status are free TEXT).
export const PROVIDER_ESCROW_STATES = [
  'funding', 'inspection', 'release', 'payout', 'cancellation', 'dispute', 'refund', 'reconciliation',
];
export const PROVIDER_VALID_TRANSITIONS = {
  funding:        ['inspection', 'dispute', 'cancellation', 'refund'],
  inspection:     ['release', 'dispute', 'cancellation', 'refund'],
  release:        ['payout', 'dispute'],
  payout:         ['reconciliation'],
  dispute:        ['release', 'refund', 'cancellation'],
  refund:         ['reconciliation'],
  cancellation:   [],
  reconciliation: [],
};
const PROVIDER_EVENT_PREFIX = 'provider:'; // namespaces provider events inside escrow_trust_events

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const IS_PRODUCTION = () => process.env.NODE_ENV === 'production' || process.env.CARUP_ENV === 'production';

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────

/** SANDBOX/LIVE separation. ONLY activation_mode 'live' is real money; everything else is sandbox. */
export function fundLabel(provider) {
  const live = provider?.activation_mode === 'live';
  return { label: live ? 'live' : 'sandbox', is_real_money: live, sandbox: !live };
}

/** Global + provider-level kill-switch / capability gate for creating NEW escrow. Fail-closed. */
export function escrowCreationGate(provider, config, env = process.env) {
  if (!isCapabilityEnabled('escrow', env)) return { allowed: false, reason: 'capability_disabled' };
  if (env.ESCROW_GLOBAL_KILL_SWITCH === '1') return { allowed: false, reason: 'global_kill_switch' };
  const callable = isCallable(provider);
  if (!callable.callable) return { allowed: false, reason: callable.reason };
  if (!config) return { allowed: false, reason: 'no_provider_config' };
  if (!config.active) return { allowed: false, reason: 'config_inactive' };
  if (config.kill_switch_enabled) return { allowed: false, reason: 'provider_kill_switch' };
  return { allowed: true, reason: null };
}

/** Transaction-cap gate against the configured [min,max] range (in cents). */
export function capGate(config, amountCents) {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { allowed: false, reason: 'invalid_amount' };
  if (config.min_amount_cents != null && amountCents < config.min_amount_cents) return { allowed: false, reason: 'below_min_amount' };
  if (config.max_amount_cents != null && amountCents > config.max_amount_cents) return { allowed: false, reason: 'cap_exceeded' };
  return { allowed: true, reason: null };
}

/** Pilot allowlist gate. Empty allowlist ⇒ no pilot restriction. Otherwise EVERY provided id must be listed. */
export function pilotGate(config, participants = []) {
  const list = Array.isArray(config.pilot_allowlist) ? config.pilot_allowlist.map(String) : [];
  if (list.length === 0) return { allowed: true, reason: null };
  const ids = participants.filter(Boolean).map(String);
  if (ids.length === 0) return { allowed: false, reason: 'not_on_pilot_allowlist' };
  const missing = ids.find((id) => !list.includes(id));
  return missing ? { allowed: false, reason: 'not_on_pilot_allowlist' } : { allowed: true, reason: null };
}

// ── DB helpers ───────────────────────────────────────────────────────────────────────────────

async function loadEscrowProvider(providerKey, jurisdiction = 'ZW') {
  const { data } = await supabase.from('provider_registry').select('*')
    .eq('provider_key', providerKey).eq('capability_type', 'escrow').eq('jurisdiction', jurisdiction).maybeSingle();
  return data || null;
}

async function loadConfig(providerId, jurisdiction, currency) {
  const { data } = await supabase.from('escrow_provider_config').select('*')
    .eq('provider_id', providerId).eq('jurisdiction', jurisdiction).eq('currency', currency).maybeSingle();
  return data || null;
}

async function loadSession(sessionId) {
  const { data } = await supabase.from('escrow_trust_sessions').select('*').eq('id', sessionId).maybeSingle();
  return data || null;
}

async function appendProviderEvent(sessionId, fromState, toState, actor, reason, payload) {
  await supabase.from('escrow_trust_events').insert({
    session_id: sessionId,
    from_status: fromState ? PROVIDER_EVENT_PREFIX + fromState : PROVIDER_EVENT_PREFIX + 'none',
    to_status: PROVIDER_EVENT_PREFIX + toState,
    actor_id: actor?.id || null, actor_role: actor?.role || null,
    reason: reason || null, payload: payload || null,
  });
}

/**
 * Current provider lifecycle state for a session = the latest provider-namespaced LIFECYCLE event.
 * Non-lifecycle audit markers (e.g. blocked attempts) are recorded but never change the state, so a
 * blocked initiation never masquerades as an initiated escrow and can be retried after remediation.
 */
export async function getProviderState(sessionId) {
  const { data } = await supabase.from('escrow_trust_events').select('*')
    .eq('session_id', sessionId).order('created_at', { ascending: false });
  const events = (data || []).filter((e) => String(e.to_status || '').startsWith(PROVIDER_EVENT_PREFIX));
  const strip = (s) => String(s).slice(PROVIDER_EVENT_PREFIX.length);
  const lifecycle = events.filter((e) => PROVIDER_ESCROW_STATES.includes(strip(e.to_status)));
  if (lifecycle.length === 0) return { state: null, initiation: null, events };
  const state = strip(lifecycle[0].to_status); // events are ordered created_at DESC
  const initiation = lifecycle.find((e) => e.to_status === PROVIDER_EVENT_PREFIX + 'funding') || null;
  return { state, initiation, events };
}

/** KYC/KYB gate: every required subject must have an APPROVED state for this provider. Fail-closed. */
export async function kycGate(config, providerId, subjects = []) {
  if (!config.kyc_kyb_required) return { allowed: true, reason: null };
  for (const s of subjects) {
    if (!s || !s.id) continue;
    const { data } = await supabase.from('escrow_kyc_kyb_states').select('status')
      .eq('subject_type', s.type).eq('subject_id', s.id).eq('provider_id', providerId).maybeSingle();
    if (!data || data.status !== 'approved') {
      return { allowed: false, reason: 'kyc_kyb_not_approved', subject: `${s.type}:${s.id}`, status: data?.status || 'not_started' };
    }
  }
  return { allowed: true, reason: null };
}

// ── Public API ─────────────────────────────────────────────────────────────────────────────

/**
 * Initiate a provider escrow on an existing trust session. Runs (in order, all fail-closed):
 * kill-switch/capability → provider callable → active config → transaction caps → pilot allowlist
 * → KYC/KYB → existing trust gates → provider framework call. On success, records the immutable
 * 'funding' initiation event. Idempotent: a session already initiated returns its existing record.
 *
 * NOTE: sandbox until the provider is genuinely 'live'. Sandbox funds are labelled sandbox and are
 * never represented as real money.
 */
export async function initiateProviderEscrow(sessionId, { providerKey, amountCents, currency, gateContext = {}, subjects, actor } = {}) {
  const session = await loadSession(sessionId);
  if (!session) throw new Error(`escrow session not found: ${sessionId}`);

  // Idempotent: already initiated?
  const existing = await getProviderState(sessionId);
  if (existing.initiation) {
    return { ok: true, deduped: true, session_id: sessionId, state: existing.state, record: existing.initiation.payload || null };
  }

  const jurisdiction = gateContext.jurisdiction || 'ZW';
  const provider = await loadEscrowProvider(providerKey, jurisdiction);
  if (!provider) return blocked(sessionId, 'provider_not_registered', actor);

  const config = await loadConfig(provider.id, jurisdiction, currency);

  // 1. Global + provider kill switch / capability / active config (fail-closed).
  const createGate = escrowCreationGate(provider, config, process.env);
  if (!createGate.allowed) return blocked(sessionId, createGate.reason, actor);

  // 2. Transaction caps.
  const caps = capGate(config, amountCents);
  if (!caps.allowed) return blocked(sessionId, caps.reason, actor);

  // 3. Currency must match the config (defensive; loadConfig already filters by currency).
  if (config.currency !== currency) return blocked(sessionId, 'currency_mismatch', actor);

  // 4. Pilot allowlist.
  const participants = [session.buyer_id, session.seller_id, session.tenant_id];
  const pilot = pilotGate(config, participants);
  if (!pilot.allowed) return blocked(sessionId, pilot.reason, actor);

  // 5. KYC/KYB gate for required subjects.
  const kycSubjects = subjects || defaultSubjects(session);
  const kyc = await kycGate(config, provider.id, kycSubjects);
  if (!kyc.allowed) return blocked(sessionId, kyc.reason, actor, { subject: kyc.subject, kyc_status: kyc.status });

  // 6. Existing trust gates (identity/publication/fraud/dealer/participant/documents/snapshot).
  const gate = evaluateEscrowGates(gateContext);
  if (!gate.allowed) return blocked(sessionId, `trust_gate:${gate.reasons.join(',')}`, actor, { gate_reasons: gate.reasons });

  // 7. Run through the shared provider framework (sandbox simulator until a real live transport).
  const result = await executeProviderRequest(provider, {
    vin: session.vin, reference: sessionId, amount_cents: amountCents, currency,
  }, { idempotencyKey: `escrow-init:${sessionId}` });
  if (!result.ok) return blocked(sessionId, `provider:${result.blocked_reason || result.outcome}`, actor, { framework: result });

  // 8. Success → record the immutable funding initiation with an HONEST fund label.
  const funds = fundLabel(provider);
  const record = {
    provider_id: provider.id, provider_key: providerKey, config_id: config.id,
    amount_cents: amountCents, currency, jurisdiction,
    fund_label: funds.label, is_real_money: funds.is_real_money, sandbox: funds.sandbox,
    activation_mode: provider.activation_mode, correlation_id: result.correlation_id,
  };
  await appendProviderEvent(sessionId, null, 'funding', actor, 'provider_escrow_initiated', record);
  return { ok: true, session_id: sessionId, state: 'funding', record, fund_label: funds.label, is_real_money: funds.is_real_money };
}

function defaultSubjects(session) {
  const subs = [];
  if (session.buyer_id) subs.push({ type: 'buyer', id: session.buyer_id });
  if (session.seller_id) subs.push({ type: 'seller', id: session.seller_id });
  return subs;
}

async function blocked(sessionId, reason, actor, extra = {}) {
  // Record the block immutably as a non-lifecycle audit marker ('blocked'): it never becomes the
  // current state and never marks the session as initiated, so the block can be remediated + retried.
  await appendProviderEvent(sessionId, null, 'blocked', actor, `blocked:${reason}`, { blocked: true, reason, ...extra })
    .catch(() => {}); // best-effort audit; a failed audit never turns a block into an allow
  return { ok: false, session_id: sessionId, blocked_reason: reason, ...extra };
}

/**
 * Transition the provider escrow lifecycle. Validates against PROVIDER_VALID_TRANSITIONS and
 * appends an immutable event. Rejects invalid transitions and un-initiated sessions.
 */
export async function transitionProviderEscrow(sessionId, toState, { actor, reason, payload } = {}) {
  if (!PROVIDER_ESCROW_STATES.includes(toState)) throw new Error(`invalid provider escrow state: ${toState}`);
  const cur = await getProviderState(sessionId);
  if (!cur.state) throw new Error('provider escrow not initiated');
  if (cur.state === toState) return { session_id: sessionId, state: toState, deduped: true }; // idempotent
  const allowed = PROVIDER_VALID_TRANSITIONS[cur.state] || [];
  if (!allowed.includes(toState)) throw new Error(`invalid provider escrow transition: ${cur.state} -> ${toState}`);
  await appendProviderEvent(sessionId, cur.state, toState, actor, reason, payload);
  return { session_id: sessionId, from: cur.state, state: toState };
}

/**
 * Dual-control gate for a sensitive manual release/refund. REJECTS when the two approvers are the
 * same id (or either is missing), records the two-distinct-approver approval immutably, then
 * performs the corresponding FSM transition. action ∈ {release, refund}.
 */
export async function requireDualControl(sessionId, action, approver1, approver2, { reason } = {}) {
  if (!['release', 'refund'].includes(action)) throw new Error(`invalid dual-control action: ${action}`);
  const id1 = approver1?.id || approver1;
  const id2 = approver2?.id || approver2;
  if (!id1 || !id2) throw new Error('dual control requires two approvers');
  if (String(id1) === String(id2)) throw new Error('dual control requires two DISTINCT approvers');

  const { data, error } = await supabase.from('escrow_dual_control_approvals').insert({
    session_id: sessionId, action, approver_1_id: id1, approver_2_id: id2, reason: reason || null,
  }).select().single();
  if (error) throw new Error(`failed to record dual-control approval: ${error.message}`);

  const transition = await transitionProviderEscrow(sessionId, action, {
    actor: { id: id1, role: 'admin' }, reason: `dual_control:${action}`,
    payload: { approval_id: data.id, approver_1_id: id1, approver_2_id: id2 },
  });
  return { approval: data, transition };
}

/**
 * Ingest a signed escrow-provider webhook. Signed (HMAC-SHA256) + replay-protected (5-min drift)
 * + idempotent (deduped via escrow_trust_webhook_events). FAIL-CLOSED on a missing secret. Every
 * attempt (including invalid/replayed/duplicate) is recorded append-only.
 */
export async function ingestEscrowProviderWebhook({ payloadString, signature, timestamp, idempotencyKey, body }, now = Date.now()) {
  const verdict = verifyEscrowWebhook(payloadString, signature, timestamp, now);

  let duplicate = false;
  if (idempotencyKey) {
    const { data: seen } = await supabase.from('escrow_trust_webhook_events')
      .select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (seen) duplicate = true;
  }

  await supabase.from('escrow_trust_webhook_events').insert({
    session_id: body?.session_id || null, event_type: body?.event_type || 'escrow_provider',
    signature_valid: verdict.valid, replay_detected: verdict.replay,
    idempotency_key: idempotencyKey || null, payload: body || null,
  }).select().single().then(() => {}, () => {}); // best-effort; unique clash ⇒ already recorded

  if (!verdict.valid) return { applied: false, reason: verdict.reason, signature_valid: false };
  if (duplicate) return { applied: false, reason: 'duplicate', signature_valid: true };
  if (!body?.session_id || !body?.to_status) return { applied: false, reason: 'missing_fields', signature_valid: true };

  try {
    const t = await transitionProviderEscrow(body.session_id, body.to_status, {
      actor: { id: 'escrow_provider_webhook', role: 'system' }, reason: 'provider_webhook',
      payload: { external_txn_ref: body.external_txn_ref || null },
    });
    return { applied: true, reason: 'ok', signature_valid: true, state: t.state };
  } catch (e) {
    return { applied: false, reason: e.message, signature_valid: true };
  }
}

/** Fail-closed HMAC verifier for escrow-provider webhooks. Missing secret ⇒ never valid. */
export function verifyEscrowWebhook(payloadString, signatureHeader, timestampHeader, now = Date.now()) {
  const secret = escrowWebhookSecret();
  if (!secret) return { valid: false, replay: false, reason: 'missing_secret' }; // fail-closed
  if (!signatureHeader) return { valid: false, replay: false, reason: 'missing_signature' };
  if (!timestampHeader) return { valid: false, replay: false, reason: 'missing_timestamp' };
  const drift = Math.abs(now - Number(timestampHeader));
  if (Number.isNaN(drift) || drift > REPLAY_WINDOW_MS) return { valid: false, replay: true, reason: 'timestamp_drift' };
  const expected = crypto.createHmac('sha256', secret).update(`${timestampHeader}.${payloadString}`).digest('hex');
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(signatureHeader, 'hex'), Buffer.from(expected, 'hex'));
    return { valid: ok, replay: false, reason: ok ? 'ok' : 'bad_signature' };
  } catch {
    return { valid: false, replay: false, reason: 'bad_signature_format' };
  }
}

/** Sign a payload the way a valid escrow provider would (test/util helper). */
export function signEscrowWebhook(payloadString, timestamp) {
  const secret = escrowWebhookSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${payloadString}`).digest('hex');
}

// Fail-closed: in production a missing secret yields null (no signature can ever verify). Outside
// production a stable dev secret keeps sandbox/staging webhook tests reproducible.
function escrowWebhookSecret() {
  return process.env.ESCROW_PROVIDER_WEBHOOK_SECRET || (IS_PRODUCTION() ? null : 'escrow-provider-sandbox-hmac-secret');
}

/**
 * Reconcile external provider transactions against internal escrow amounts for a window. Records
 * every comparison into the append-only escrow_reconciliation_ledger and queues unmatched/mismatched
 * rows into reconciliation_mismatches under a reconciliation_jobs row.
 *
 * Records are supplied (external = provider statement, internal = our escrow records) so this is
 * deterministic and unit-testable; production assembles them from the provider API + our ledgers.
 */
export async function runEscrowReconciliation(providerId, { windowStart = null, windowEnd = null, external = [], internal = [] } = {}) {
  const { data: job, error: jobErr } = await supabase.from('reconciliation_jobs').insert({
    provider_id: providerId, capability_type: 'escrow',
    window_start: windowStart, window_end: windowEnd, status: 'running',
  }).select().single();
  if (jobErr) throw new Error(`failed to open reconciliation job: ${jobErr.message}`);

  const internalByRef = new Map();
  for (const i of internal) if (i.external_txn_ref) internalByRef.set(String(i.external_txn_ref), i);
  const matchedInternalRefs = new Set();

  let matched = 0;
  const mismatches = [];

  for (const ext of external) {
    const ref = ext.external_txn_ref != null ? String(ext.external_txn_ref) : null;
    const int = ref != null ? internalByRef.get(ref) : null;
    const externalAmount = ext.amount_cents ?? null;
    const internalAmount = int ? (int.amount_cents ?? null) : null;
    const isMatch = !!int && internalAmount != null && externalAmount != null && internalAmount === externalAmount;

    await recordLedger(providerId, int?.session_id ?? ext.session_id ?? null, ref, internalAmount, externalAmount, isMatch);
    if (int) matchedInternalRefs.add(ref);

    if (isMatch) { matched++; continue; }
    const mismatchType = !int ? 'missing_internal' : 'amount_mismatch';
    mismatches.push(await recordMismatch(job.id, providerId, ref, int?.session_id ?? null, mismatchType, { externalAmount, internalAmount }));
  }

  // Internal records with no external counterpart in the window.
  for (const i of internal) {
    const ref = i.external_txn_ref != null ? String(i.external_txn_ref) : null;
    if (ref != null && matchedInternalRefs.has(ref)) continue;
    await recordLedger(providerId, i.session_id ?? null, ref, i.amount_cents ?? null, null, false);
    mismatches.push(await recordMismatch(job.id, providerId, ref, i.session_id ?? null, 'missing_external', { internalAmount: i.amount_cents ?? null, externalAmount: null }));
  }

  const status = mismatches.length === 0 ? 'succeeded' : 'partial';
  const { data: updated } = await supabase.from('reconciliation_jobs').update({
    status, matched_count: matched, mismatch_count: mismatches.length, updated_at: new Date().toISOString(),
  }).eq('id', job.id).select().single();

  return { job: updated || job, matched, mismatch_count: mismatches.length, mismatches };
}

async function recordLedger(providerId, sessionId, externalRef, internalAmount, externalAmount, isMatch) {
  await supabase.from('escrow_reconciliation_ledger').insert({
    provider_id: providerId, session_id: sessionId, external_txn_ref: externalRef,
    internal_amount_cents: internalAmount, external_amount_cents: externalAmount, matched: isMatch,
  }).select().single().then(() => {}, () => {}); // append-only; unique-ext clash ⇒ already booked
}

async function recordMismatch(jobId, providerId, externalRef, sessionId, mismatchType, detail) {
  const { data } = await supabase.from('reconciliation_mismatches').insert({
    job_id: jobId, provider_id: providerId, external_ref: externalRef,
    internal_ref: sessionId, mismatch_type: mismatchType, detail, resolution: 'open',
  }).select().single();
  return data || { job_id: jobId, provider_id: providerId, mismatch_type: mismatchType, detail };
}

/**
 * Provider-level escrow kill switch. enabled=true blocks NEW escrow creation for this provider
 * WITHOUT touching any existing session or money history. Records an append-only audit line.
 */
export async function setEscrowKillSwitch(configId, enabled, { actor, reason } = {}) {
  const { data, error } = await supabase.from('escrow_provider_config')
    .update({ kill_switch_enabled: !!enabled, updated_at: new Date().toISOString() }).eq('id', configId).select().single();
  if (error) throw new Error(error.message);
  await supabase.from('provider_activation_history').insert({
    provider_id: data.provider_id, from_mode: 'escrow_config', to_mode: 'escrow_config',
    reason: `escrow_kill_switch=${!!enabled}${reason ? ': ' + reason : ''}`,
    actor_id: actor?.id || null, actor_role: actor?.role || null,
  }).then(() => {}, () => {});
  return data;
}

export default {
  PROVIDER_ESCROW_STATES, PROVIDER_VALID_TRANSITIONS,
  fundLabel, escrowCreationGate, capGate, pilotGate, kycGate, getProviderState,
  initiateProviderEscrow, transitionProviderEscrow, requireDualControl,
  ingestEscrowProviderWebhook, verifyEscrowWebhook, signEscrowWebhook,
  runEscrowReconciliation, setEscrowKillSwitch,
};
