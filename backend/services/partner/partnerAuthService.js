/**
 * Partner API auth + audit — Workstream 9.
 *
 * Issues hashed API credentials, verifies them in constant time, enforces least-privilege
 * scopes, and records every request append-only. No plaintext key is ever stored: the key
 * is shown once at creation. The Express gateway holds the service-role key; partners never
 * touch Supabase directly.
 */
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';

const KEY_PREFIX = 'carup_pk_';

export function hashKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey)).digest('hex');
}

/** Generate a new high-entropy key. Returned ONCE; only its hash is persisted. */
export function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(24).toString('hex');
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Create a partner client. Returns { client, apiKey } where apiKey is plaintext and must
 * be delivered to the partner once and never stored.
 */
export async function createPartnerClient({ name, scopes = [], tenant_id = null, rate_limit_per_min = 60, contact_email = null, created_by = null }) {
  if (!name) throw new Error('partner name is required');
  const apiKey = generateKey();
  const row = {
    name,
    key_hash: hashKey(apiKey),
    scopes,
    tenant_id,
    rate_limit_per_min,
    contact_email,
    created_by,
    status: 'active',
  };
  const { data, error } = await supabase.from('partner_clients').insert(row).select().single();
  if (error) throw new Error(`failed to create partner client: ${error.message}`);
  return { client: toSafeClient(data), apiKey };
}

/** Verify a raw API key. Returns the active client or null. Constant-time hash compare. */
export async function verifyPartnerKey(rawKey) {
  if (!rawKey || !String(rawKey).startsWith(KEY_PREFIX)) return null;
  const h = hashKey(rawKey);
  const { data, error } = await supabase
    .from('partner_clients')
    .select('*')
    .eq('key_hash', h)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== 'active') return null;
  if (!constantTimeEqual(data.key_hash, h)) return null;
  return data;
}

export function clientHasScope(client, scope) {
  const scopes = Array.isArray(client?.scopes) ? client.scopes : [];
  if (scopes.includes('*') || scopes.includes('vehicle:*')) return true;
  return scopes.includes(scope);
}

export async function revokePartnerClient(clientId) {
  const { data, error } = await supabase
    .from('partner_clients')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', clientId)
    .select()
    .single();
  if (error) throw new Error(`failed to revoke partner client: ${error.message}`);
  return toSafeClient(data);
}

export async function listPartnerClients() {
  const { data, error } = await supabase.from('partner_clients').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(`failed to list partner clients: ${error.message}`);
  return (data || []).map(toSafeClient);
}

/** Append-only request audit. Never throws into the request path. */
export async function logPartnerRequest(entry) {
  try {
    await supabase.from('partner_api_requests').insert({
      client_id: entry.client_id || null,
      correlation_id: entry.correlation_id,
      method: entry.method,
      path: entry.path,
      scope_required: entry.scope_required || null,
      status_code: entry.status_code,
      outcome: entry.outcome || 'ok',
      latency_ms: entry.latency_ms ?? null,
      idempotency_key: entry.idempotency_key || null,
    });
  } catch { /* audit best-effort; never block the response */ }
}

/** Never expose the key hash. */
export function toSafeClient(client) {
  if (!client) return client;
  const { key_hash, ...safe } = client;
  return safe;
}

export default {
  hashKey,
  generateKey,
  createPartnerClient,
  verifyPartnerKey,
  clientHasScope,
  revokePartnerClient,
  listPartnerClients,
  logPartnerRequest,
};
