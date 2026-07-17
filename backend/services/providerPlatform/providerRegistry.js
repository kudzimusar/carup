/**
 * Provider registry service — Full Activation.
 *
 * Manages provider control-plane rows: registration, activation-mode transitions (recorded
 * append-only), kill switches, health and incidents. Never stores secret values — only a
 * `credential_ref` naming where the secret lives (env/vault). Fail-closed by default: a new
 * provider is registered with kill_switch_enabled=true and mode='not_configured'.
 */
import { supabase } from '../../db/supabase.js';

export const CALLABLE_MODES = new Set(['sandbox', 'partner_file', 'manual', 'pilot_live', 'live']);
export const ALL_MODES = ['not_configured', 'contract_pending', 'credential_pending', 'sandbox',
  'partner_file', 'manual', 'pilot_live', 'live', 'degraded', 'unavailable', 'suspended'];

function assertNoSecret(value, field) {
  if (value == null) return;
  const s = String(value);
  if (/(sbp_|eyJ[A-Za-z0-9_-]{20,}|postgres:\/\/|secret|password|BEGIN [A-Z ]*PRIVATE KEY)/i.test(s)) {
    throw new Error(`refusing to store an apparent secret in ${field}; store a reference (env key name) only`);
  }
}

/** Register or update a provider (idempotent on provider_key+capability_type+jurisdiction). */
export async function upsertProvider(input, actor = {}) {
  if (!input.provider_key) throw new Error('provider_key required');
  if (!['government_source', 'insurance', 'finance', 'escrow'].includes(input.capability_type)) {
    throw new Error('invalid capability_type');
  }
  assertNoSecret(input.credential_ref, 'credential_ref');
  const jurisdiction = input.jurisdiction || 'ZW';
  const { data: existing } = await supabase.from('provider_registry')
    .select('*').eq('provider_key', input.provider_key).eq('capability_type', input.capability_type).eq('jurisdiction', jurisdiction).maybeSingle();

  const row = {
    provider_key: input.provider_key,
    capability_type: input.capability_type,
    jurisdiction,
    display_name: input.display_name || input.provider_key,
    transport: input.transport || 'simulator',
    credential_ref: input.credential_ref || null,
    endpoint_allowlist: input.endpoint_allowlist || [],
    config: input.config || {},
    rate_limit_per_min: input.rate_limit_per_min || 60,
    tenant_id: input.tenant_id || null,
  };
  if (existing) {
    const { data, error } = await supabase.from('provider_registry').update({ ...row, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase.from('provider_registry').insert({ ...row, created_by: actor.id || null, activation_mode: 'not_configured', kill_switch_enabled: true }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** Transition a provider's activation mode; records append-only history. */
export async function setActivationMode(providerId, toMode, { reason, actor } = {}) {
  if (!ALL_MODES.includes(toMode)) throw new Error(`invalid mode ${toMode}`);
  const { data: p } = await supabase.from('provider_registry').select('*').eq('id', providerId).maybeSingle();
  if (!p) throw new Error('provider not found');
  // 'live'/'pilot_live' require a signed contract + a credential reference (no secret needed here).
  if ((toMode === 'live' || toMode === 'pilot_live') && (p.contract_status !== 'signed' || !p.credential_ref)) {
    throw new Error(`cannot set ${toMode}: requires contract_status=signed and a credential_ref`);
  }
  const { data, error } = await supabase.from('provider_registry')
    .update({ activation_mode: toMode, updated_at: new Date().toISOString() }).eq('id', providerId).select().single();
  if (error) throw new Error(error.message);
  await supabase.from('provider_activation_history').insert({
    provider_id: providerId, from_mode: p.activation_mode, to_mode: toMode,
    reason: reason || null, actor_id: actor?.id || null, actor_role: actor?.role || null,
  });
  return data;
}

/** Set the per-provider kill switch. enabled=true blocks all new calls (fail-closed). */
export async function setKillSwitch(providerId, enabled, { reason, actor } = {}) {
  const { data, error } = await supabase.from('provider_registry')
    .update({ kill_switch_enabled: !!enabled, updated_at: new Date().toISOString() }).eq('id', providerId).select().single();
  if (error) throw new Error(error.message);
  await supabase.from('provider_activation_history').insert({
    provider_id: providerId, from_mode: data.activation_mode, to_mode: data.activation_mode,
    reason: `kill_switch=${!!enabled}${reason ? ': ' + reason : ''}`, actor_id: actor?.id || null, actor_role: actor?.role || null,
  });
  return data;
}

export async function recordHealth(providerId, status, { latency_ms, detail } = {}) {
  await supabase.from('provider_health_checks').insert({ provider_id: providerId, status, latency_ms: latency_ms ?? null, detail: detail || null });
  const health_state = status === 'healthy' ? 'healthy' : status === 'degraded' ? 'degraded' : 'down';
  await supabase.from('provider_registry').update({ health_state, updated_at: new Date().toISOString() }).eq('id', providerId);
}

export async function openIncident(providerId, { severity, summary, actor }) {
  const { data, error } = await supabase.from('provider_incidents').insert({ provider_id: providerId, severity, summary, opened_by: actor?.id || null }).select().single();
  if (error) throw new Error(error.message);
  await supabase.from('provider_registry').update({ incident_state: 'active', updated_at: new Date().toISOString() }).eq('id', providerId);
  return data;
}

export async function getProvider(providerKey, capabilityType, jurisdiction = 'ZW') {
  const { data } = await supabase.from('provider_registry').select('*').eq('provider_key', providerKey).eq('capability_type', capabilityType).eq('jurisdiction', jurisdiction).maybeSingle();
  return data || null;
}

export async function listProviders(filters = {}) {
  let query = supabase.from('provider_registry').select('*');
  if (filters.capability_type) query = query.eq('capability_type', filters.capability_type);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Pure helper: is a provider callable right now? Fail-closed. */
export function isCallable(provider) {
  if (!provider) return { callable: false, reason: 'not_registered' };
  if (provider.kill_switch_enabled) return { callable: false, reason: 'kill_switch' };
  if (!CALLABLE_MODES.has(provider.activation_mode)) return { callable: false, reason: `mode_${provider.activation_mode}` };
  return { callable: true, reason: null };
}

export default { CALLABLE_MODES, ALL_MODES, upsertProvider, setActivationMode, setKillSwitch, recordHealth, openIncident, getProvider, listProviders, isCallable };
