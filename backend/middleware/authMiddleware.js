import { supabase } from '../db/supabase.js';

/**
 * The value `authenticationMethod` carries when an identity was ASSERTED by a header rather than
 * proven by a session. Exported so a consumer gating a private capability compares against this
 * constant instead of re-spelling the literal — a literal that has to agree across two files is a
 * typo away from silently disabling the gate.
 */
export const FALLBACK_AUTH_METHOD = 'x-user-id-fallback';

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

function normalizeRole(role) {
  return role ? String(role).toLowerCase() : null;
}

/**
 * A STRICTER fallback rule for routes that can expose PRIVATE EVIDENCE.
 *
 * `isUserIdFallbackAllowed()` infers permission from `NODE_ENV`, and that inference has been wrong in
 * production-adjacent environments before: a staging deployment running `NODE_ENV=test` turns the
 * spoofable `x-user-id` header into a working identity. For most routes that is a contained
 * development convenience. For the evidence and passport paths it is not — those return another
 * person's registration document, police clearance and insurance certificate, and mint signed URLs
 * into the private bucket.
 *
 * So these paths do not accept an inference. They require the operator to have said so explicitly,
 * which no NODE_ENV misconfiguration can do by accident.
 */
/**
 * Refuse an identity that was ASSERTED by a header rather than PROVEN by a session, unless the
 * operator has explicitly opted in.
 *
 * Factored out because it is now needed at the FOURTH private-document capability issuer, and each
 * one was found separately, after the previous "fix". Routes that mint a signed URL into the
 * private `ocr-documents` bucket are the ones that matter: registration documents, police
 * clearances, insurance certificates, and identity evidence (passport/ID/selfie).
 *
 * Compose it AFTER `authorizeRole(...)`, which establishes `req.userContext`. The role check is
 * unchanged; this adds a second question — not "who do you claim to be" but "how do we know".
 */
export function requireProvenIdentity() {
  return (req, res, next) => {
    if (req.userContext?.authenticationMethod === 'x-user-id-fallback'
      && !isPrivateEvidenceFallbackAllowed()) {
      return res.status(401).json({
        error: 'Unauthorized. This resource requires a real session, not the x-user-id fallback.',
      });
    }
    return next();
  };
}

export function isPrivateEvidenceFallbackAllowed(env = process.env) {
  return env.CARUP_ALLOW_X_USER_ID_FALLBACK === 'true';
}

/**
 * Deployment environments that must NEVER honour a NODE_ENV inference, whatever NODE_ENV says.
 *
 * CarUp has already run NODE_ENV=test inside a Vercel PRODUCTION environment, which turned the
 * spoofable x-user-id header into a working identity — including admin. A single mis-set
 * variable was enough. Conjoining the inference with the deployment environment means no single
 * mis-set variable can open it again: the incident that happened is closed, because VERCEL_ENV
 * was 'production' throughout it.
 *
 * The explicit CARUP_ALLOW_X_USER_ID_FALLBACK opt-in is unchanged and still overrides, so local
 * development and the test suite are unaffected.
 */
function isProductionDeployment(env) {
  return env.CARUP_ENV === 'production' || env.VERCEL_ENV === 'production';
}

export function isUserIdFallbackAllowed(env = process.env) {
  if (env.CARUP_ALLOW_X_USER_ID_FALLBACK === 'true') return true;
  if (isProductionDeployment(env)) return false;
  return env.NODE_ENV === 'test' ||
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

export function authorizeRole(allowedRoles = [], { allowUserIdFallback = true, allowTenantMembership = false } = {}) {
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

      // Distinguishes a PROVEN identity from an ASSERTED one. `requireProvenIdentity` refuses the
      // latter, so this literal is load-bearing: without it that gate reads like a guard and is a
      // no-op — which is exactly how a private-document capability stayed reachable once already.
      let authenticationMethod = activeUserId ? 'session' : null;

      if (!activeUserId && fallbackUserId) {
        if (!allowUserIdFallback) {
          return res.status(401).json({ error: 'Unauthorized. This action requires an authenticated session.' });
        }
        if (!isUserIdFallbackAllowed()) {
          return res.status(401).json({ error: 'Unauthorized. x-user-id fallback is unavailable outside local/test mode.' });
        }
        activeUserId = fallbackUserId;
        // Recorded so a downstream route can refuse an identity that was ASSERTED rather than
        // proven. Without this marker a route that checks for it is a no-op that READS like a
        // guard — which is exactly how a private-document capability stayed reachable after being
        // "fixed" once already.
        authenticationMethod = 'x-user-id-fallback';
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
      //
      // `allowTenantMembership` lets a route accept a VERIFIED tenant membership in a role it
      // already trusts, even when the person's effective role is their platform role. It is OFF by
      // default and must be opted into per route, because `tenant_users.role` and `users.role` are
      // two different namespaces that happen to share spellings.
      //
      // Why the option exists. A garage founder is platform `owner` with `tenant_users.role =
      // 'admin'` (PO-1, GMO-4). Asserting that tenant role throws — `resolveEffectiveRole`
      // deliberately refuses to let a tenant `admin` become a platform `admin` — and asserting
      // nothing leaves them as `owner`, which no garage route lists. The founder was locked out of
      // the garage they had just been given. A tenant `mechanic` never hit this because `mechanic`
      // is assumable; `admin` is the one tenant role that is not.
      //
      // Why it is NOT global. An adversarial review proved, by executing the exploit, that applying
      // this to every route collapses the two namespaces on the string 'admin': a garage founder
      // could call `GET /api/users/management` with `x-tenant-id` set to their own garage and read
      // every CarUp user, then `POST /api/users/:id/suspend` the real platform administrator.
      // `adminRoutes.js` gates on `authorizeRole(['admin'])` alone, and 'admin' there means PLATFORM
      // admin. 168 route registrations list 'admin' in that platform sense. So the tenant disjunct
      // is available only where a route says its role list is tenant-scoped.
      //
      // Where it IS enabled, `tenantRole` is not a claim: it was read from `tenant_users` for this
      // exact tenant a few lines above, and the request was already refused with 403 if no
      // membership existed. `effectiveRole`, `role` and `platformRole` are all left unchanged, so a
      // tenant admin still never becomes a CarUp admin.
      const tenantMembershipSatisfiesRoute =
        allowTenantMembership && Boolean(tenantRole) && allowed.includes(tenantRole);
      if (
        allowed.length > 0
        && !allowed.includes(effectiveRole)
        && !tenantMembershipSatisfiesRoute
        && !PLATFORM_ADMIN_ROLES.has(platformRole)
      ) {
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
        authenticationMethod,
      };

      next();
    } catch (error) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message });
    }
  };
}

/**
 * Consequential governance actions must always be backed by a validated CarUp session. This wrapper
 * deliberately ignores the local/test x-user-id fallback even when that fallback remains available
 * to ordinary development/test routes.
 */
export function authorizeSessionRole(allowedRoles = []) {
  return authorizeRole(allowedRoles, { allowUserIdFallback: false });
}

/**
 * A proven session, on a route whose role list is TENANT-scoped.
 *
 * Use this only where the listed roles name positions inside an organization — a garage's mechanic,
 * dealer or admin — rather than platform authority. It additionally accepts a verified
 * `tenant_users` membership in one of those roles, which is what lets a garage founder (platform
 * `owner`, tenant `admin`) open the garage they were just given.
 *
 * Do NOT use it on a route where 'admin' means a CarUp administrator. `tenant_users.role` is an
 * unconstrained TEXT column that any garage founder holds as 'admin', and an adversarial review
 * demonstrated a working exploit — full user-table disclosure and suspension of the real platform
 * administrator — when this behaviour was applied globally instead of per route.
 */
export function authorizeTenantRole(allowedRoles = []) {
  return authorizeRole(allowedRoles, { allowUserIdFallback: false, allowTenantMembership: true });
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
      let fallbackDerived = false;
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
        // HOW the identity was established, not merely THAT it was. Consumers that gate a private
        // capability require a PROVEN one: tightening this middleware's own policy instead would
        // change every route that merely needs to know who is calling, which is not the same
        // decision. See buildVehiclePassport, which refuses a fallback identity for its private half.
        fallbackDerived = true;
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
          authenticationMethod: fallbackDerived ? FALLBACK_AUTH_METHOD : 'session',
          // A single boolean a consumer can gate on WITHOUT re-spelling the marker. The passport
          // builder is asserted to read no request header, and the marker's own value contains a
          // header name — so a consumer comparing against it would trip that guard while doing
          // nothing wrong. `true` only when the identity was ASSERTED rather than proven.
          identityAsserted: fallbackDerived,
        };
      }
    } catch {
      // Best-effort only — never block a public request on auth resolution.
    }
    next();
  };
}
