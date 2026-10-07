import { supabase } from '../db/supabase.js';
import { isLendableTenantRole } from '../services/auth/tenantRoleCatalogue.js';
import { resolveVerifiedActiveTenant, TenantContextUnavailableError } from '../services/auth/activeTenantContext.js';
import { isProductionLikeRuntime } from '../utils/runtimeEnvironment.js';

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
 * A declared deployment must NEVER honour a NODE_ENV inference, whatever NODE_ENV says.
 *
 * CarUp has already run NODE_ENV=test inside a Vercel PRODUCTION environment, which turned the
 * spoofable x-user-id header into a working identity — including admin. A single mis-set
 * variable was enough. Conjoining the inference with the deployment declaration means no single
 * mis-set variable can open it again. Until OC-5R-PROV-01 B1 only a PRODUCTION declaration
 * counted, so NODE_ENV=test in a preview or on staging still opened it; the declaration is now
 * the central classifier (utils/runtimeEnvironment.js), which covers every deployment.
 *
 * The explicit CARUP_ALLOW_X_USER_ID_FALLBACK opt-in is unchanged and still overrides, so local
 * development and the test suite are unaffected.
 */
export function isUserIdFallbackAllowed(env = process.env) {
  if (env.CARUP_ALLOW_X_USER_ID_FALLBACK === 'true') return true;
  if (isProductionLikeRuntime(env)) return false;
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

  // A verified membership may lend ONLY a governed domain role ('mechanic', 'dealer' — see
  // tenantRoleCatalogue.js). Before OC-5A this refused 'admin' and admitted everything else, so a
  // tenant row reading 'government', 'reviewer' or 'finance' became platform authority.
  if (trustedTenantRole && requested === trustedTenantRole && isLendableTenantRole(requested)) {
    return requested;
  }

  const error = new Error(`Forbidden. Requested role '${requested}' is not verified for this user context.`);
  error.statusCode = 403;
  throw error;
}

export function authorizeRole(allowedRoles = [], { allowUserIdFallback = true, ignoreTenantHeader = false } = {}) {
  return async (req, res, next) => {
    const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
    // The session's own endpoints (/api/auth/me, /api/auth/active-tenant) read the SELECTION and ignore
    // the assertion, so a client holding a stale organisation can always recover instead of being
    // refused on the very calls that would repair it.
    const tenantIdHeader = ignoreTenantHeader ? undefined : req.headers['x-tenant-id'];
    const requestedRole = normalizeRole(req.headers['x-stakeholder-role']);
    const fallbackUserId = req.headers['x-user-id'];

    try {
      let activeUserId = null;
      let sessionTenantId = null;

      // 1. Validate Session Token
      if (sessionToken) {
        const { data: session, error: sessionError } = await supabase
          .from('user_sessions')
          .select('user_id, is_valid, expires_at, active_organization_id')
          .eq('token', sessionToken)
          .single();

        if (sessionError || !session || !session.is_valid || new Date(session.expires_at) < new Date()) {
          return res.status(401).json({ error: 'Unauthorized. Session is invalid or expired.' });
        }
        activeUserId = session.user_id;
        sessionTenantId = session.active_organization_id || null;
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

      // 3. Validate Tenant Context (Multi-Tenancy Rule) — OC-5D: one verifier, an explicit selection.
      //
      // The organisation a request acts for is the one the person SELECTED on this session
      // (PUT /api/auth/active-tenant), re-verified here on every request — a revoked membership or a
      // deactivated tenant stops carrying authority at once. `x-tenant-id` is only an ASSERTION about
      // that selection: if it names another organisation the request is refused. A session with no
      // selection keeps the verified-header path for one release (membership AND an active tenant are
      // required now); the x-user-id test fallback uses the same verified header. A membership that
      // could not be READ is a 503 — never "you do not belong".
      let activeTenant = null;
      let tenantContext = 'none';
      if (authenticationMethod === 'session' && sessionTenantId) {
        if (tenantIdHeader && String(tenantIdHeader) !== String(sessionTenantId)) {
          return res.status(403).json({
            error: 'Forbidden. This request names a different organisation than the one selected for this session.',
            code: 'TENANT_CONTEXT_MISMATCH',
          });
        }
        const selected = await resolveVerifiedActiveTenant(supabase, activeUserId, sessionTenantId);
        if (selected && selected.usable) {
          activeTenant = selected;
          tenantContext = 'selected';
        } else if (tenantIdHeader) {
          // The client still believes it acts for this organisation. Say so, rather than letting the
          // request run without it — or letting a raw-header fallback downstream pick it back up.
          return res.status(403).json({
            error: 'Your access to the selected organisation has changed. Select an organisation again.',
            code: 'TENANT_CONTEXT_REVOKED',
          });
        } else {
          tenantContext = 'revoked';
        }
      } else if (tenantIdHeader) {
        const asserted = await resolveVerifiedActiveTenant(supabase, activeUserId, tenantIdHeader);
        if (!asserted) {
          return res.status(403).json({ error: 'Forbidden. You do not have access to this tenant organization.' });
        }
        if (!asserted.usable) {
          return res.status(403).json({ error: 'Forbidden. This organisation is not active.', code: 'TENANT_INACTIVE' });
        }
        activeTenant = asserted;
        tenantContext = 'asserted';
      }
      const tenantRole = activeTenant ? activeTenant.role : null;

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
        // Derived ONLY from the verified active tenant — never from a raw header.
        tenantId: activeTenant ? activeTenant.id : null,
        activeTenant,
        tenantContext,
        requestedRole,
        isVerified: Boolean(user.is_verified),
        authenticationMethod,
      };

      next();
    } catch (error) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message, ...(error instanceof TenantContextUnavailableError ? { code: error.code } : {}) });
    }
  };
}

/**
 * OC-5D — require a verified ACTIVE organisation of the given type(s), where the caller holds one of
 * the given TENANT roles. Compose after authorizeRole()/authorizeSessionRole(). The tenant role never
 * becomes a platform role, and there is deliberately no platform-admin bypass: acting FOR a garage is
 * a garage member's act.
 */
export function requireActiveTenant({ types = [], roles = [] } = {}) {
  const allowedTypes = types.map((t) => String(t).toLowerCase());
  const allowedRoles = roles.map(normalizeRole);
  return (req, res, next) => {
    const context = req.userContext;
    if (!context?.id) return res.status(401).json({ error: 'Unauthorized.', code: 'UNAUTHENTICATED' });
    const tenant = context.activeTenant;
    if (!tenant) {
      return context.tenantContext === 'revoked'
        ? res.status(403).json({ error: 'Your access to the selected organisation has changed. Select an organisation again.', code: 'TENANT_CONTEXT_REVOKED' })
        : res.status(403).json({ error: 'Select the organisation you are acting for.', code: 'ACTIVE_TENANT_REQUIRED' });
    }
    if (allowedTypes.length && tenant.metadataUnavailable) {
      return res.status(503).json({ error: 'Your organisation context could not be read right now. Please try again shortly.', code: 'TENANT_CONTEXT_UNAVAILABLE' });
    }
    if (allowedTypes.length && !allowedTypes.includes(tenant.type)) {
      return res.status(403).json({ error: 'This action is for a different kind of organisation.', code: 'ACTIVE_TENANT_TYPE' });
    }
    if (allowedRoles.length && !allowedRoles.includes(tenant.role)) {
      return res.status(403).json({ error: 'Your role in this organisation does not allow this action.', code: 'ACTIVE_TENANT_ROLE' });
    }
    return next();
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
 * The tenant an optional-auth caller named, IF their membership of it is verified. Never throws:
 * optional authentication must not fail a public request, so any doubt resolves to "no tenant".
 */
async function verifiedTenantMembership(tenantIdHeader, userId) {
  const none = { tenantId: null, tenantRole: null, activeTenant: null };
  if (!tenantIdHeader || !userId) return none;
  try {
    const tenant = await resolveVerifiedActiveTenant(supabase, userId, tenantIdHeader);
    if (!tenant || !tenant.usable) return none;
    return { tenantId: tenant.id, tenantRole: tenant.role, activeTenant: tenant };
  } catch {
    return none;
  }
}

/** The session's selected organisation, re-verified; a header naming another one yields none. */
async function verifiedSessionTenant(sessionTenantId, tenantIdHeader, userId) {
  const none = { tenantId: null, tenantRole: null, activeTenant: null };
  if (tenantIdHeader && String(tenantIdHeader) !== String(sessionTenantId)) return none;
  return verifiedTenantMembership(sessionTenantId, userId);
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
      let sessionTenantId = null;
      if (sessionToken) {
        const { data: session } = await supabase
          .from('user_sessions')
          .select('user_id, is_valid, expires_at, active_organization_id')
          .eq('token', sessionToken)
          .single();
        if (session && session.is_valid && new Date(session.expires_at) >= new Date()) {
          activeUserId = session.user_id;
          sessionTenantId = session.active_organization_id || null;
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
        // OC-5D: the session's verified selection, else a verified header (one release); a mismatch, a
        // revoked selection or any doubt yields no tenant — optional auth never blocks.
        const tenant = sessionTenantId && !fallbackDerived
          ? await verifiedSessionTenant(sessionTenantId, req.headers['x-tenant-id'], activeUserId)
          : await verifiedTenantMembership(req.headers['x-tenant-id'], activeUserId);
        req.userContext = {
          id: activeUserId,
          userId: activeUserId,
          role: platformRole,
          platformRole,
          // OC-5A: a tenant is context only when the caller's membership of it is VERIFIED — the
          // question authorizeRole asks. The bare header used to become tenantId here, so every
          // consumer had to remember not to trust it (the PartSentry read path documented exactly
          // that). An unverified claim, or a failed lookup, yields no tenant — never the claimed one.
          tenantId: tenant.tenantId,
          tenantRole: tenant.tenantRole,
          activeTenant: tenant.activeTenant || null,
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
