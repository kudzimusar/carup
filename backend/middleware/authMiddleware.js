import { supabase } from '../db/supabase.js';

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

function normalizeRole(role) {
  return role ? String(role).toLowerCase() : null;
}

export function authorizeRole(allowedRoles = []) {
  return async (req, res, next) => {
    const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
    const tenantIdHeader = req.headers['x-tenant-id'];
    const requestedRole = normalizeRole(req.headers['x-stakeholder-role']);
    const fallbackUserId = req.headers['x-user-id']; // Temporary dev fallback if no token

    try {
      let activeUserId = fallbackUserId;

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

      if (requestedRole && requestedRole !== platformRole && requestedRole !== tenantRole) {
        return res.status(403).json({ error: `Forbidden. You do not hold requested role '${requestedRole}'.` });
      }

      const effectiveRole = requestedRole || tenantRole || platformRole;
      const allowed = allowedRoles.map(normalizeRole);

      // 4. Enforce Route Role Permissions
      if (allowed.length > 0 && !allowed.includes(effectiveRole) && !PLATFORM_ADMIN_ROLES.has(platformRole)) {
        return res.status(403).json({ error: `Forbidden. Role '${effectiveRole}' cannot access this resource.` });
      }

      // 5. Inject Context for Downstream Routes
      req.userContext = { 
        id: activeUserId, 
        role: effectiveRole,
        platformRole,
        tenantRole,
        tenantId: tenantIdHeader || null,
        requestedRole,
        isVerified: Boolean(user.is_verified),
      };
      
      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal auth validation failed: ' + error.message });
    }
  };
}
