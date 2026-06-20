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

  if (!requested) {
    return platformRole;
  }

  if (requested === platformRole) {
    return requested;
  }

  if (trustedTenantRole && requested === trustedTenantRole && requested !== 'admin') {
    return requested;
  }

  const error = new Error(`Forbidden. Requested role '${requested}' is not verified for this user context.`);
  error.statusCode = 403;
  throw error;
}

export function authorizeRole(allowedRoles = []) {
  return async (req, res, next) => {
    const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
    const tenantIdHeader = req.headers['x-tenant-id'];
    const requestedRole = normalizeRole(req.headers['x-stakeholder-role']);
    const fallbackUserId = req.headers['x-user-id'];

    try {
      let activeUserId = null;

      // 1. Validate Session Token
      if (sessionToken) {
        const { data: session, error: sessionError } = await supabase
          .from('user_sessions')
          .select('user_id, is_valid, expires_at')
          .eq('token', sessionToken)
          .single();

        if (sessionError || !session || !session.is_valid || new Date(session.expires_at) < new Date()) {
          return res.status(401).json({ error: 'Unauthorized. Session is invalid or expired.' });
        }
        activeUserId = session.user_id;
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

      // 2. Fetch User Profile
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('role, is_verified')
        .eq('id', activeUserId)
        .single();

      if (userError || !user) {
        return res.status(401).json({ error: 'Unauthorized. User record not found.' });
      }

      const platformRole = normalizeRole(user.role) || 'member';

      // 3. Validate Tenant Context (Multi-Tenancy Rule)
      let tenantRole = null;
      if (tenantIdHeader) {
        const { data: tenantUser, error: tenantError } = await supabase
          .from('tenant_users')
          .select('role')
          .eq('tenant_id', tenantIdHeader)
          .eq('user_id', activeUserId)
          .single();

        if (tenantError || !tenantUser) {
          return res.status(403).json({ error: 'Forbidden. You do not have access to this tenant organization.' });
        }
        tenantRole = normalizeRole(tenantUser.role); // e.g., 'admin', 'manager', 'mechanic'
      }

      const effectiveRole = resolveEffectiveRole({
        userRole: platformRole,
        tenantRole,
        requestedRole,
      });
      const allowed = allowedRoles.map(normalizeRole);

      // 4. Enforce Route Role Permissions
      if (allowed.length > 0 && !allowed.includes(effectiveRole) && !PLATFORM_ADMIN_ROLES.has(platformRole)) {
        return res.status(403).json({ error: `Forbidden. Role '${effectiveRole}' cannot access this resource.` });
      }

      // 5. Inject Context for Downstream Routes
      req.userContext = {
        id: activeUserId,
        userId: activeUserId,
        role: effectiveRole,
        effectiveRole,
        baseRole: platformRole,
        platformRole,
        tenantRole,
        tenantId: tenantIdHeader || null,
        requestedRole,
        isVerified: Boolean(user.is_verified),
      };

      next();
    } catch (error) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message });
    }
  };
}

/**
 * Optional authentication. Resolves req.userContext when a valid session (or dev x-user-id fallback)
 * is present, otherwise continues as an anonymous guest WITHOUT failing the request. Use for public
 * endpoints that personalize when signed in (e.g. marketplace inquiry attribution, listing-view events).
 * Never throws; never blocks; never trusts client role headers for privileged checks.
 */
export function optionalAuth() {
  return async (req, _res, next) => {
    const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
    const fallbackUserId = req.headers['x-user-id'];
    try {
      let activeUserId = null;
      if (sessionToken) {
        const { data: session } = await supabase
          .from('user_sessions')
          .select('user_id, is_valid, expires_at')
          .eq('token', sessionToken)
          .single();
        if (session && session.is_valid && new Date(session.expires_at) >= new Date()) {
          activeUserId = session.user_id;
        }
      }
      if (!activeUserId && fallbackUserId && isUserIdFallbackAllowed()) {
        activeUserId = fallbackUserId;
      }
      if (activeUserId) {
        const { data: user } = await supabase.from('users').select('role, is_verified').eq('id', activeUserId).single();
        const platformRole = normalizeRole(user?.role) || 'member';
        req.userContext = {
          id: activeUserId,
          userId: activeUserId,
          role: platformRole,
          platformRole,
          tenantId: req.headers['x-tenant-id'] || null,
          isVerified: Boolean(user?.is_verified),
        };
      }
    } catch {
      // Best-effort only — never block a public request on auth resolution.
    }
    next();
  };
}
