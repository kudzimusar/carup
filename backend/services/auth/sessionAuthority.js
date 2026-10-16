import crypto from 'node:crypto';
import pg from 'pg';

import { buildSessionAuthorityPoolConfig, SESSION_AUTHORITY_TLS_CONTRACT } from './sessionAuthorityTls.js';

import { isProductionLikeRuntime } from '../../utils/runtimeEnvironment.js';
import { buildSessionRow } from './sessionRow.js';

/**
 * CA-K3-AUTH-05 — runtime boundary for interactive session authority.
 *
 * Ordinary backend reads continue through the Supabase service_role, but only through exact-token
 * SECURITY DEFINER resolvers which never return token material. Every mutation and every Corporate
 * Phase-C write RPC uses a distinct PostgreSQL login supplied as SESSION_AUTH_DATABASE_URL.
 *
 * A local/test-only compatibility seam keeps the existing in-memory unit tests useful. It is
 * categorically disabled in every declared deployment, even when NODE_ENV is accidentally "test".
 */

let authorityPool = null;

export class SessionAuthorityUnavailableError extends Error {
  constructor(message = 'Dedicated session authority is not configured.') {
    super(message);
    this.name = 'SessionAuthorityUnavailableError';
    this.code = 'SESSION_AUTHORITY_UNAVAILABLE';
  }
}

export function isSessionAuthorityConfigured(env = process.env) {
  return typeof env.SESSION_AUTH_DATABASE_URL === 'string' && env.SESSION_AUTH_DATABASE_URL.trim() !== '';
}

export function isLegacySessionTestAdapterAllowed(env = process.env) {
  if (isProductionLikeRuntime(env)) return false;
  return !isSessionAuthorityConfigured(env)
    && ['test', 'development', 'local'].includes(String(env.NODE_ENV || '').toLowerCase());
}

function pool() {
  if (!isSessionAuthorityConfigured()) throw new SessionAuthorityUnavailableError();
  if (!authorityPool) {
    authorityPool = new pg.Pool({
      ...buildSessionAuthorityPoolConfig(process.env.SESSION_AUTH_DATABASE_URL),
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
  }
  return authorityPool;
}

export async function probeSessionAuthorityConnection() {
  const result = await pool().query(`
    SELECT
      current_user::text AS runtime_role,
      COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls_active
  `);
  const row = result.rows?.[0] || {};
  return {
    connected: true,
    tls_active: row.tls_active === true,
    runtime_role: typeof row.runtime_role === 'string' ? row.runtime_role : null,
    verification: SESSION_AUTHORITY_TLS_CONTRACT.verification,
    trust_anchor: SESSION_AUTHORITY_TLS_CONTRACT.trustAnchor,
  };
}

async function authorityScalar(sql, params = []) {
  const result = await pool().query(sql, params);
  return result.rows?.[0]?.data ?? null;
}

function legacyOrThrow(legacyTestClient) {
  if (isLegacySessionTestAdapterAllowed() && legacyTestClient?.from) return legacyTestClient;
  throw new SessionAuthorityUnavailableError();
}

export async function resolveSessionByToken(readClient, token) {
  if (!token) return null;
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(readClient);
    const { data, error } = await client
      .from('user_sessions')
      .select('id,user_id,active_role,active_organization_id,is_valid,created_at,expires_at,user_agent')
      .eq('token', token)
      .single();
    if (error) {
      if (error.code === 'PGRST116' || /no session|not found/i.test(String(error.message || ''))) return null;
      const e = new Error(error.message || 'Session read failed');
      e.code = error.code;
      throw e;
    }
    return data || null;
  }

  if (!readClient?.rpc) throw new SessionAuthorityUnavailableError('Session resolver client is unavailable.');
  const { data, error } = await readClient.rpc('session_authority_resolve_token', { p_token: token });
  if (error) {
    const e = new Error(error.message || 'Session resolver failed');
    e.code = error.code;
    throw e;
  }
  return data || null;
}

export async function resolveSessionAssuranceByToken(readClient, token) {
  if (!token) return null;
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(readClient);
    const { data, error } = await client
      .from('user_sessions')
      .select('id,user_id,is_valid,created_at,expires_at,auth_method,step_up_at,step_up_method')
      .eq('token', token)
      .single();
    if (error) {
      if (error.code === 'PGRST116' || /no session|not found/i.test(String(error.message || ''))) return null;
      const e = new Error(error.message || 'Session assurance read failed');
      e.code = error.code;
      throw e;
    }
    return data || null;
  }

  if (!readClient?.rpc) throw new SessionAuthorityUnavailableError('Session assurance resolver client is unavailable.');
  const { data, error } = await readClient.rpc('session_authority_resolve_assurance', { p_token: token });
  if (error) {
    const e = new Error(error.message || 'Session assurance resolver failed');
    e.code = error.code;
    throw e;
  }
  return data || null;
}

export async function issueInteractiveSession({
  userId,
  activeRole,
  activeOrganizationId = null,
  ipAddress = '127.0.0.1',
  userAgent = null,
  authMethod = 'password',
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const token = 'sk_live_' + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const row = {
      ...buildSessionRow({
        userId,
        activeRole,
        token,
        expiresAt,
        tenantId: activeOrganizationId,
        req: { ip: ipAddress, headers: { 'user-agent': userAgent } },
      }),
      auth_method: authMethod,
      step_up_at: null,
      step_up_method: null,
    };
    const response = await client.from('user_sessions').insert(row);
    if (response?.error) throw new Error(response.error.message || 'Session issue failed');
    return { id: row.id, token, user_id: userId, created_at: row.created_at, expires_at: row.expires_at };
  }

  return authorityScalar(
    'SELECT public.session_authority_issue($1::text,$2::text,$3::text,$4::text,$5::text,$6::text) AS data',
    [userId, activeRole, activeOrganizationId, ipAddress, userAgent, authMethod],
  );
}

export async function setSessionActiveOrganization({
  token,
  userId,
  activeOrganizationId = null,
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const { data: row, error: readError } = await client
      .from('user_sessions')
      .select('id,active_organization_id,is_valid,expires_at')
      .eq('token', token)
      .eq('user_id', userId)
      .single();
    if (readError || !row) throw new Error(readError?.message || 'Session not found');
    const previous = row.active_organization_id || null;
    const { error } = await client.from('user_sessions')
      .update({ active_organization_id: activeOrganizationId })
      .eq('token', token)
      .eq('user_id', userId);
    if (error) throw new Error(error.message || 'Session update failed');
    return { id: row.id, previous_active_organization_id: previous, active_organization_id: activeOrganizationId };
  }

  return authorityScalar(
    'SELECT public.session_authority_set_active_organization($1::text,$2::text,$3::text) AS data',
    [token, userId, activeOrganizationId],
  );
}

export async function revokeCurrentSession({ token, userId } = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const { data, error } = await client.from('user_sessions')
      .update({ is_valid: false })
      .eq('token', token)
      .eq('user_id', userId)
      .eq('is_valid', true)
      .select('user_id');
    if (error) throw new Error(error.message || 'Session revocation failed');
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return { revoked_count: rows.length };
  }

  return authorityScalar(
    'SELECT public.session_authority_revoke_current($1::text,$2::text) AS data',
    [token, userId],
  );
}

export async function listUserSessions(readClient, {
  userId,
  presentingToken = null,
  liveOnly = false,
} = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(readClient);
    let query = client.from('user_sessions')
      .select('id,token,created_at,expires_at,is_valid,user_agent')
      .eq('user_id', userId);
    if (liveOnly) query = query.eq('is_valid', true);
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'Session list failed');
    return (data || []).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      is_valid: row.is_valid,
      user_agent: row.user_agent,
      current: Boolean(presentingToken && row.token === presentingToken),
    }));
  }

  if (!readClient?.rpc) throw new SessionAuthorityUnavailableError('Session resolver client is unavailable.');
  const { data, error } = await readClient.rpc('session_authority_list_user_sessions', {
    p_user_id: userId,
    p_presenting_token: presentingToken,
  });
  if (error) throw new Error(error.message || 'Session list failed');
  const rows = Array.isArray(data) ? data : [];
  return liveOnly ? rows.filter((row) => row.is_valid === true) : rows;
}

export async function revokeSessionScope({
  userId,
  scope = 'all',
  sessionId = null,
  presentingToken = null,
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const sessions = await listUserSessions(client, { userId, presentingToken, liveOnly: true });
    const targets = sessions.filter((row) => {
      if (scope === 'one') return row.id === sessionId;
      if (scope === 'others') return !row.current;
      return scope === 'all';
    });
    for (const row of targets) {
      const { error } = await client.from('user_sessions')
        .update({ is_valid: false })
        .eq('id', row.id)
        .eq('user_id', userId);
      if (error) throw new Error(error.message || 'Session revocation failed');
    }
    return { revoked_count: targets.length, revoked_session_ids: targets.map((row) => row.id) };
  }

  return authorityScalar(
    'SELECT public.session_authority_revoke_scope($1::text,$2::text,$3::text,$4::text) AS data',
    [userId, scope, sessionId, presentingToken],
  );
}

export async function recordPasswordReauth({
  token,
  userId,
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const stampedAt = new Date().toISOString();
    const { data, error } = await client
      .from('user_sessions')
      .update({ step_up_at: stampedAt, step_up_method: 'password_reauth' })
      .eq('token', token)
      .eq('user_id', userId)
      .eq('is_valid', true)
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message || 'Could not record step-up');
    return { id: data.id, step_up_at: stampedAt, method: 'password_reauth' };
  }

  return authorityScalar(
    'SELECT public.session_authority_record_password_reauth($1::text,$2::text) AS data',
    [token, userId],
  );
}

export async function clearPasswordReauth({
  sessionId,
  expectedStepUpAt,
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const { data, error } = await client.from('user_sessions')
      .update({ step_up_at: null, step_up_method: null })
      .eq('id', sessionId)
      .eq('step_up_at', expectedStepUpAt);
    if (error) throw new Error(error.message || 'Could not clear step-up');
    return { cleared_count: Array.isArray(data) ? data.length : data ? 1 : 0 };
  }

  return authorityScalar(
    'SELECT public.session_authority_clear_password_reauth($1::text,$2::text) AS data',
    [sessionId, expectedStepUpAt],
  );
}

export async function setUserPasswordHash({
  userId,
  passwordHash,
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const { error } = await client.from('users').update({ password_hash: passwordHash }).eq('id', userId);
    if (error) throw new Error(error.message || 'Password update failed');
    return { updated: true, user_id: userId };
  }

  return authorityScalar(
    'SELECT public.session_authority_set_password_hash($1::text,$2::text) AS data',
    [userId, passwordHash],
  );
}

export async function deleteUnestablishedRegistrationUser({
  userId,
  expectedEmail,
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const { error } = await client.from('users').delete().eq('id', userId).eq('email', expectedEmail);
    if (error) throw new Error(error.message || 'Registration compensation failed');
    return { deleted_count: 1 };
  }

  return authorityScalar(
    'SELECT public.session_authority_delete_unestablished_user($1::text,$2::text) AS data',
    [userId, expectedEmail],
  );
}

export async function insertAuthActionToken({
  userId,
  purpose,
  tokenHash,
  expiresAt,
  requestedIp = null,
  userAgent = null,
  metadata = {},
  createdBy = null,
  source = 'api',
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const { data, error } = await client
      .from('auth_action_tokens')
      .insert({
        user_id: userId,
        purpose,
        token_hash: tokenHash,
        expires_at: expiresAt,
        requested_ip: requestedIp,
        user_agent: userAgent,
        metadata,
        created_by: createdBy,
        source,
      })
      .select('id, user_id, purpose, expires_at, created_at')
      .single();
    if (error) throw new Error(error.message || 'Failed to issue auth action token');
    return data;
  }

  return authorityScalar(
    'SELECT public.session_authority_auth_token_insert($1::text,$2::text,$3::text,$4::timestamptz,$5::text,$6::text,$7::jsonb,$8::text,$9::text) AS data',
    [userId, purpose, tokenHash, expiresAt, requestedIp, userAgent, JSON.stringify(metadata || {}), createdBy, source],
  );
}

export async function consumeAuthActionToken({
  tokenHash,
  purpose,
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const nowIso = new Date().toISOString();
    const { data, error } = await client
      .from('auth_action_tokens')
      .update({ used_at: nowIso })
      .eq('token_hash', tokenHash)
      .eq('purpose', purpose)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .select('id, user_id, purpose, metadata, expires_at, created_at')
      .maybeSingle();

    if (error) return { ok: false, reason: `consume_failed:${error.message}` };
    if (data) return { ok: true, token: data };

    const { data: existing } = await client
      .from('auth_action_tokens')
      .select('id, used_at, revoked_at, expires_at, purpose')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (!existing) return { ok: false, reason: 'unknown_token' };
    if (existing.purpose !== purpose) return { ok: false, reason: 'wrong_purpose' };
    if (existing.revoked_at) return { ok: false, reason: 'revoked' };
    if (existing.used_at) return { ok: false, reason: 'already_used' };
    return { ok: false, reason: 'expired' };
  }

  return authorityScalar(
    'SELECT public.session_authority_auth_token_consume($1::text,$2::text) AS data',
    [tokenHash, purpose],
  );
}

export async function revokeAuthActionTokens({
  userId,
  purpose = null,
} = {}, { legacyTestClient = null } = {}) {
  if (isLegacySessionTestAdapterAllowed()) {
    const client = legacyOrThrow(legacyTestClient);
    const nowIso = new Date().toISOString();
    let query = client
      .from('auth_action_tokens')
      .update({ revoked_at: nowIso })
      .eq('user_id', userId)
      .is('used_at', null)
      .is('revoked_at', null);
    if (purpose) query = query.eq('purpose', purpose);
    const { error } = await query;
    if (error) throw new Error(error.message || 'Failed to revoke auth action tokens');
    return { revoked_count: 0 };
  }

  return authorityScalar(
    'SELECT public.session_authority_auth_token_revoke($1::text,$2::text) AS data',
    [userId, purpose],
  );
}

const CORPORATE_RPC = Object.freeze({
  corporate_authority_apply_direct: {
    keys: ['p_operation','p_actor_user_id','p_actor_session_id','p_subject_user_id','p_org_node_id','p_membership_id',
      'p_reason','p_reference','p_effective_from','p_effective_until','p_classification','p_session_revocation'],
    casts: ['text','text','text','text','text','uuid','text','text','timestamptz','timestamptz','text','jsonb'],
  },
  corporate_authority_request_submit: {
    keys: ['p_operation','p_membership_id','p_requester_user_id','p_requester_session_id','p_reason','p_reference'],
    casts: ['text','uuid','text','text','text','text'],
  },
  corporate_authority_request_decide: {
    keys: ['p_request_id','p_checker_user_id','p_checker_session_id','p_decision','p_reason','p_expected_subject_user_id',
      'p_expected_membership_id','p_expected_org_node_id','p_expected_operation','p_expected_binding_digest'],
    casts: ['uuid','text','text','text','text','text','uuid','text','text','text'],
  },
  corporate_authority_request_execute: {
    keys: ['p_request_id','p_executor_user_id','p_executor_session_id','p_expected_binding_digest'],
    casts: ['uuid','text','text','text'],
  },
  corporate_authority_request_cancel: {
    keys: ['p_request_id','p_actor_user_id','p_actor_session_id','p_reason'],
    casts: ['uuid','text','text','text'],
  },
});

export async function executeCorporateAuthorityRpc(name, params = {}, { legacyTestClient = null } = {}) {
  const spec = CORPORATE_RPC[name];
  if (!spec) throw new Error('SESSION_AUTHORITY/RPC_NOT_ALLOWED');

  if (isLegacySessionTestAdapterAllowed()) {
    if (!legacyTestClient?.rpc) throw new SessionAuthorityUnavailableError('Corporate test RPC client unavailable.');
    const response = await legacyTestClient.rpc(name, params);
    if (response?.error) {
      const error = new Error(response.error.message || 'Corporate authority RPC failed');
      Object.assign(error, response.error);
      throw error;
    }
    return response?.data;
  }

  const args = spec.keys.map((key) => params[key] ?? null);
  const placeholders = spec.casts.map((cast, i) => `$${i + 1}::${cast}`).join(',');
  return authorityScalar(`SELECT public.${name}(${placeholders}) AS data`, args);
}

export async function closeSessionAuthorityPoolForTests() {
  if (authorityPool) {
    const p = authorityPool;
    authorityPool = null;
    await p.end();
  }
}

export default {
  isSessionAuthorityConfigured,
  resolveSessionByToken,
  resolveSessionAssuranceByToken,
  issueInteractiveSession,
  setSessionActiveOrganization,
  revokeCurrentSession,
  listUserSessions,
  revokeSessionScope,
  recordPasswordReauth,
  clearPasswordReauth,
  setUserPasswordHash,
  deleteUnestablishedRegistrationUser,
  insertAuthActionToken,
  consumeAuthActionToken,
  revokeAuthActionTokens,
  executeCorporateAuthorityRpc,
};
