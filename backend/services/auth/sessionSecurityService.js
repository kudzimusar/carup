import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * O2-X3 — governed session revocation over the existing user_sessions.is_valid contract.
 *
 * Scopes: 'one' (a specific session id), 'others' (everything but the presenting session),
 * 'all'. Every revocation is audited with who/why/which/when — session IDS only, never token
 * material. Invalidated rows are refused by authMiddleware exactly as before; nothing here
 * changes the auth contract, it only exercises it.
 */

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Session revocation audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

async function liveSessionsForUser(client, userId) {
  const { data, error } = await client
    .from('user_sessions')
    .select('id, token, created_at, expires_at, is_valid, user_agent')
    .eq('user_id', userId)
    .eq('is_valid', true);
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Revoke sessions for a user. `scope`:
 *  - 'all'            every live session
 *  - 'others'         every live session except `presentingToken`'s row
 *  - 'one'            exactly `sessionId`
 */
export async function revokeSessionsForUser(client = supabase, actor = {}, {
  userId,
  scope = 'all',
  sessionId = null,
  presentingToken = null,
  reason,
  lifecycleEventId = null,
} = {}, options = {}) {
  if (!userId) throw new ValidationError('userId is required.');
  if (!reason || !String(reason).trim()) throw new ValidationError('A revocation reason is required.');
  if (!['all', 'others', 'one'].includes(scope)) {
    throw new ValidationError(`Unknown revocation scope: ${scope}.`);
  }
  if (scope === 'one' && !sessionId) throw new ValidationError('sessionId is required for scope one.');
  if (scope === 'others' && !presentingToken) {
    throw new ValidationError('The presenting session token is required for scope others.');
  }

  const live = await liveSessionsForUser(client, userId);
  const targets = live.filter((row) => {
    if (scope === 'one') return row.id === sessionId;
    if (scope === 'others') return row.token !== presentingToken;
    return true;
  });

  for (const row of targets) {
    const { error } = await client
      .from('user_sessions')
      .update({ is_valid: false })
      .eq('id', row.id)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  const actorId = actor.id || actor.userId || null;
  await writeAudit(client, {
    req: options.req,
    event_type: 'USER_SESSIONS_REVOKED',
    actor_user_id: actorId,
    actor_role: actor.platformRole || actor.baseRole || actor.role || null,
    actor_tenant_id: actor.tenantId,
    source_route: options.sourceRoute || null,
    targetType: 'user_sessions',
    targetId: userId,
    new_value: {
      scope,
      reason: String(reason).slice(0, 300),
      revoked_session_ids: targets.map((row) => row.id),
      revoked_count: targets.length,
      lifecycle_event_id: lifecycleEventId,
    },
    reason: String(reason).slice(0, 300),
  });

  return { revoked_count: targets.length, revoked_session_ids: targets.map((row) => row.id) };
}

/** The caller's own sessions, shaped for display — token material never leaves the server. */
export async function listOwnSessions(client = supabase, actor = {}, { presentingToken = null } = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  const live = await liveSessionsForUser(client, userId);
  return live
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      user_agent: row.user_agent ? String(row.user_agent).slice(0, 120) : null,
      current: Boolean(presentingToken && row.token === presentingToken),
    }));
}

export default { revokeSessionsForUser, listOwnSessions };
