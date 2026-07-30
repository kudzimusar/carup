import { supabase } from '../db/supabase.js';

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

function normalizeRole(role) {
  return role ? String(role).toLowerCase() : null;
}

export function isUserIdFallbackAllowed(env = process.env) {
  return env.CARUP_ALLOW_X_USER_ID_FALLBACK === 'true' ||
    env.NODE_ENV === 'test' ||
    env.NODE_ENV === 'development' ||
    env.NODE_ENV === 'local';
}

export function resolveEffectiveRole({ userRole, tenantRole = null, requestedRole = null }) {
  const platformRole = normalizeRole(userRole) || 'member';
  const trustedTenantRole = normalizeRole(tenantRole);
  const requested = normalizeRole(requestedRole);

  if (!requested) return platformRole;
  if (requested === platformRole) return requested;
  if (trustedTenantRole && requested === trustedTenantRole && requested !== 'admin') return requested;

  const error = new Error(`Forbidden. Requested role '${requested}' is not verified for this user context.`);
  error.statusCode = 403;
  throw error;
}

async function loadSession(sessionToken) {
  const { data: session, error } = await supabase
    .from('user_sessions')
    .select('user_id, is_valid, expires_at, active_role, active_organization_id')
    .eq('token', sessionToken)
    .single();
  if (error || !session || !session.is_valid || new Date(session.expires_at) < new Date()) return null;
  return session;
}

async function loadTenantRole(userId, tenantId) {
  if (!tenantId) return null;
  const { data: tenantUser, error } = await supabase
    .from('tenant_users')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .single();
  if (error || !tenantUser) return null;
  return normalizeRole(tenantUser.role);
}

export function authorizeRole(allowedRoles = []) {
  return async (req, res, next) => {
    const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
    const tenantIdHeader = req.headers['x-tenant-id'] ? String(req.headers['x-tenant-id']) : null;
    const requestedRoleHeader = normalizeRole(req.headers['x-stakeholder-role']);
    const fallbackUserId = req.headers['x-user-id'];

    try {
      let activeUserId = null;
      let sessionRole = null;
      let sessionTenantId = null;
      const session = sessionToken ? await loadSession(sessionToken) : null;

      if (sessionToken && !session) {
        return res.status(401).json({ error: 'Unauthorized. Session is invalid or expired.' });
      }
      if (session) {
        activeUserId = session.user_id;
        sessionRole = normalizeRole(session.active_role);
        sessionTenantId = session.active_organization_id ? String(session.active_organization_id) : null;
      }

      if (!activeUserId && fallbackUserId) {
        if (!isUserIdFallbackAllowed()) {
          return res.status(401).json({ error: 'Unauthorized. x-user-id fallback is unavailable outside local/test mode.' });
        }
        activeUserId = fallbackUserId;
      }
      if (!activeUserId) {
        return res.status(401).json({ error: 'Unauthorized. No active user context.' });
      }

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('role, is_verified')
        .eq('id', activeUserId)
        .single();
      if (userError || !user) {
        return res.status(401).json({ error: 'Unauthorized. User record not found.' });
      }

      const platformRole = normalizeRole(user.role) || 'member';
      const sessionBacked = Boolean(session);
      const effectiveTenantId = sessionBacked ? sessionTenantId : tenantIdHeader;

      // A token establishes its own role and tenant. Client headers may repeat that context, but
      // cannot replace it. This prevents stale or tampered local storage from redefining a session.
      if (sessionBacked && tenantIdHeader && tenantIdHeader !== sessionTenantId) {
        return res.status(403).json({ error: 'Forbidden. Requested tenant does not match the active session.' });
      }
      if (sessionBacked && requestedRoleHeader && sessionRole && requestedRoleHeader !== sessionRole) {
        return res.status(403).json({ error: 'Forbidden. Requested role does not match the active session.' });
      }

      const tenantRole = effectiveTenantId ? await loadTenantRole(activeUserId, effectiveTenantId) : null;
      if (effectiveTenantId && !tenantRole) {
        return res.status(403).json({ error: 'Forbidden. You do not have access to this tenant organization.' });
      }

      const roleCandidate = sessionBacked ? (sessionRole || platformRole) : requestedRoleHeader;
      const effectiveRole = resolveEffectiveRole({
        userRole: platformRole,
        tenantRole,
        requestedRole: roleCandidate,
      });
      const allowed = allowedRoles.map(normalizeRole);

      if (allowed.length > 0 && !allowed.includes(effectiveRole) && !PLATFORM_ADMIN_ROLES.has(platformRole)) {
        return res.status(403).json({ error: `Forbidden. Role '${effectiveRole}' cannot access this resource.` });
      }

      req.userContext = {
        id: activeUserId,
        userId: activeUserId,
        role: effectiveRole,
        effectiveRole,
        baseRole: platformRole,
        platformRole,
        tenantRole,
        tenantId: effectiveTenantId || null,
        requestedRole: roleCandidate,
        isVerified: Boolean(user.is_verified),
      };
      next();
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  };
}

/** Optional authentication for public routes. A valid token still uses its session role and tenant. */
export function optionalAuth() {
  return async (req, _res, next) => {
    const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
    const fallbackUserId = req.headers['x-user-id'];
    try {
      const session = sessionToken ? await loadSession(sessionToken) : null;
      let activeUserId = session?.user_id || null;
      if (!activeUserId && fallbackUserId && isUserIdFallbackAllowed()) activeUserId = fallbackUserId;
      if (activeUserId) {
        const { data: user } = await supabase.from('users').select('role, is_verified').eq('id', activeUserId).single();
        const platformRole = normalizeRole(user?.role) || 'member';
        const tenantId = session?.active_organization_id ? String(session.active_organization_id) : null;
        const tenantRole = tenantId ? await loadTenantRole(activeUserId, tenantId) : null;
        const role = session
          ? resolveEffectiveRole({ userRole: platformRole, tenantRole, requestedRole: session.active_role })
          : platformRole;
        req.userContext = {
          id: activeUserId,
          userId: activeUserId,
          role,
          effectiveRole: role,
          platformRole,
          tenantRole,
          tenantId,
          isVerified: Boolean(user?.is_verified),
        };
      }
    } catch {
      // Best effort only: optional authentication never blocks a public request.
    }
    next();
  };
}
