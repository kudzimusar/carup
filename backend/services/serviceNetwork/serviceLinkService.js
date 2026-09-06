import crypto from 'crypto';
import { ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  assertPractitionerAuthority,
  assertServiceCaseAuthority,
  assertVehicleAuthority,
} from './serviceAuthority.js';
// O6: the ONE registry of what an anonymous caller may resolve. Consulted rather than mirrored.
import { LOOKUP_KINDS, LOOKUP_DECISIONS, resolveLookupAccess } from '../../utils/passportLookupPolicy.js';

/**
 * Service Network S8 — Service Link resolver and scoped capability grants.
 *
 * The interaction principle (plan §20) is:
 *
 *     Scan → Resolve → Authenticate → Authorize → Act → Record
 *
 * Resolution is deliberately the WEAKEST step. Scanning a code proves only that
 * someone held a printed sticker, so a resolved link grants nothing: it returns a
 * role-safe context and the caller must still authenticate and be authorized. The
 * scanner device never becomes authority (§20.5) — writes bind to the authenticated
 * user and verified tenant membership, and no device identity is fabricated where the
 * platform has no governed one.
 *
 * Permanent links carry NO private payload (§6.8), so a QR sticker on a windscreen can
 * be photographed by anyone without leaking owner data.
 *
 * Capability grants follow the proven SA1C pattern: the raw secret is returned once and
 * only its SHA-256 hash is persisted; redemption is a single conditional update, so it
 * is atomic and replay-safe. `auth_action_tokens` is not reused — its purpose CHECK is
 * closed to four auth purposes and widening it would destabilise SA1.
 */

const LINK_TOKEN_BYTES = 16;   // 128 bits — opaque, non-enumerable public address
const GRANT_TOKEN_BYTES = 32;  // 256 bits — bearer secret

export const SERVICE_LINK_RESOURCE_TYPES = Object.freeze(['vehicle', 'service_case', 'practitioner']);
export const CAPABILITY_PURPOSES = Object.freeze(['service_case_participation', 'service_context_read']);
/** Short by design: a capability is an invitation to act now, not standing access. */
export const CAPABILITY_TTL_MINUTES = Object.freeze({
  service_case_participation: 60 * 24,
  service_context_read: 60 * 4,
});

export function hashCapabilityToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function generateToken(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// A JS default applies only to `undefined`, so an explicit null argument reached the property
// read and produced a TypeError (HTTP 500) where the honest answer is 403. An absent identity is
// a refusal, not a server fault.
function actorId(userContext) {
  const id = userContext?.id || userContext?.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required');
  return id;
}

/** Create (or return) the permanent link for a resource. Links are stable addresses. */
export async function ensureServiceLink(supabaseClient, userContext, body = {}) {
  const creator = actorId(userContext);
  const resourceType = String(body.resource_type || '').trim();
  if (!SERVICE_LINK_RESOURCE_TYPES.includes(resourceType)) {
    throw new ValidationError(`resource_type must be one of: ${SERVICE_LINK_RESOURCE_TYPES.join(', ')}`);
  }
  const resourceId = String(body.resource_id || '').trim();
  if (!resourceId) throw new ValidationError('resource_id is required');

  // HARDENING: minting a PERMANENT public address for a resource is consequential — the
  // token ends up on a sticker. Being signed in is not authority, so canonical authority
  // over the specific resource is required first. Each check throws NotFoundError for an
  // unauthorised resource, so this cannot be used to probe which VINs or cases exist.
  let resolvedTenantId = null;
  if (resourceType === 'vehicle') {
    await assertVehicleAuthority(supabaseClient, userContext, resourceId);
  } else if (resourceType === 'service_case') {
    const { serviceCase } = await assertServiceCaseAuthority(supabaseClient, userContext, resourceId);
    // The tenant is derived from the CASE, never from the request body.
    resolvedTenantId = serviceCase.garage_tenant_id;
  } else {
    await assertPractitionerAuthority(supabaseClient, userContext, resourceId);
    resolvedTenantId = userContext.tenantId || null;
  }

  const { data: existing, error: existingError } = await supabaseClient
    .from('service_links')
    .select('*')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .maybeSingle();
  if (existingError) throw new DatabaseError(`Failed to read service link: ${existingError.message}`);
  if (existing) return { link: publicLinkView(existing), created: false };

  const row = {
    public_token: generateToken(LINK_TOKEN_BYTES),
    resource_type: resourceType,
    resource_id: resourceId,
    // Server-derived only. A client-supplied tenant_id is never honoured: it would let a
    // caller stamp another garage's identity onto a permanent public link.
    tenant_id: resolvedTenantId,
    created_by_user_id: creator,
    is_active: true,
  };
  const { data, error } = await supabaseClient.from('service_links').insert(row).select().single();
  if (error) {
    if (String(error.code) === '23505') {
      const { data: winner } = await supabaseClient.from('service_links').select('*')
        .eq('resource_type', resourceType).eq('resource_id', resourceId).maybeSingle();
      if (winner) return { link: publicLinkView(winner), created: false };
    }
    throw new DatabaseError(`Failed to create service link: ${error.message}`);
  }
  return { link: publicLinkView(data), created: true };
}

/** The link itself carries no private payload — only its opaque address and type. */
function publicLinkView(row) {
  return {
    public_token: row.public_token,
    resource_type: row.resource_type,
    is_active: row.is_active !== false && !row.revoked_at,
  };
}

/**
 * Resolve a scanned/followed link.
 *
 * This is intentionally low-privilege. For an unauthenticated caller it returns only what
 * kind of thing was scanned and what to do next — never owner identity, never the VIN,
 * never case contents (§20.1, §20.2). Authorization happens afterwards, on the real
 * endpoints, against the authenticated user.
 */
export async function resolveServiceLink(supabaseClient, userContext, publicToken) {
  const token = String(publicToken || '').trim();
  if (!token) throw new ValidationError('link token is required');

  const { data: link, error } = await supabaseClient
    .from('service_links')
    .select('*')
    .eq('public_token', token)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to resolve link: ${error.message}`);
  if (!link || link.is_active === false || link.revoked_at) {
    // A revoked or unknown token are indistinguishable — the resolver is not an oracle.
    throw new NotFoundError('This link is not valid');
  }

  const viewerId = userContext?.id || userContext?.userId || null;
  const viewerTenantId = userContext?.tenantId || null;

  const context = {
    resource_type: link.resource_type,
    // Source attribution flows onward from here (§20.4): an action begun from a scan
    // records source_channel 'qr'.
    source_channel: 'qr',
    authenticated: Boolean(viewerId),
  };

  if (!viewerId) {
    // O6: anonymous scanning is intentional — a stranger holding a job card must not be forced to
    // create an account to see that the link is real. But that decision belongs to the CENTRAL
    // public-lookup policy, not to this file. #194 made the public kinds a deliberate list so a new
    // anonymous surface has to be added in the open; this resolver predates that list and bypassed
    // it. Asking here makes the registration load-bearing: drop SERVICE_LINK from
    // PUBLIC_LOOKUP_KINDS and anonymous resolution genuinely stops.
    const access = resolveLookupAccess({ kind: LOOKUP_KINDS.SERVICE_LINK, actor: null });
    if (access.decision !== LOOKUP_DECISIONS.ALLOW) {
      throw new ForbiddenError('Anonymous service-link resolution is not permitted by the lookup policy.');
    }
    // A safe authentication/claim path and nothing else: no VIN, no case, no participants, no
    // garage identity. Scanning establishes that a link exists — never any authority over it.
    return { ...context, access: 'authentication_required', next_action: 'sign_in_to_continue' };
  }

  if (link.resource_type === 'vehicle') {
    const { data: vehicle } = await supabaseClient
      .from('vehicles').select('vin, owner_id').eq('vin', link.resource_id).maybeSingle();
    if (!vehicle) throw new NotFoundError('This link is not valid');
    const isOwner = vehicle.owner_id === viewerId;
    return {
      ...context,
      access: isOwner ? 'owner' : 'limited',
      // The VIN is disclosed only to the owner; a stranger who scans a windscreen
      // sticker learns that it is a vehicle and nothing more.
      vin: isOwner ? vehicle.vin : null,
      next_action: isOwner ? 'open_vehicle' : 'request_service',
    };
  }

  if (link.resource_type === 'service_case') {
    const { data: serviceCase } = await supabaseClient
      .from('service_cases').select('id, requester_user_id, garage_tenant_id, status')
      .eq('id', link.resource_id).maybeSingle();
    if (!serviceCase) throw new NotFoundError('This link is not valid');
    const isParticipant = serviceCase.requester_user_id === viewerId
      || (viewerTenantId && serviceCase.garage_tenant_id === viewerTenantId);
    if (!isParticipant) {
      // A non-participant learns nothing about the case, not even its status.
      return { ...context, access: 'not_a_participant', next_action: 'request_access' };
    }
    return {
      ...context, access: 'participant', service_case_id: serviceCase.id,
      status: serviceCase.status, next_action: 'open_service_case',
    };
  }

  // practitioner — a governed PUBLIC projection only (§20.3). Activity is not quality:
  // no ratings, no scores, and affiliation is stated only where governed.
  const { data: membership } = await supabaseClient
    .from('tenant_users').select('tenant_id').eq('user_id', link.resource_id).maybeSingle();
  let affiliation = null;
  if (membership?.tenant_id) {
    const { data: profile } = await supabaseClient
      .from('garage_public_profiles')
      .select('display_name, slug, publication_status')
      .eq('tenant_id', membership.tenant_id).maybeSingle();
    if (profile && profile.publication_status === 'published') {
      affiliation = { display_name: profile.display_name, slug: profile.slug };
    }
  }
  return {
    ...context,
    access: 'public_practitioner',
    practitioner: {
      // Identity, affiliation and credential-review state are distinct facts (§20.3).
      affiliation,                       // null = not governed/published, not "independent"
      credential_review_state: 'not_reviewed', // Foundation ships no credential workflow
    },
    next_action: 'select_workflow',
  };
}

/**
 * Grant a narrow, time-boxed capability over one resource.
 *
 * The raw secret is returned exactly once. Only its hash is stored.
 *
 * A capability conveys ONLY the service-context authority named by its purpose. It does
 * NOT confer access to the canonical Communications conversation: Communications owns
 * participation and applies its own participant rules (Invariant 6), so conversation
 * access is never a side effect of holding a service capability.
 */
export async function grantCapability(supabaseClient, userContext, body = {}) {
  const granter = actorId(userContext);
  const purpose = String(body.purpose || '').trim();
  if (!CAPABILITY_PURPOSES.includes(purpose)) {
    throw new ValidationError(`purpose must be one of: ${CAPABILITY_PURPOSES.join(', ')}`);
  }
  const resourceType = String(body.resource_type || '').trim();
  if (!['vehicle', 'service_case'].includes(resourceType)) {
    throw new ValidationError('resource_type must be vehicle or service_case');
  }
  const resourceId = String(body.resource_id || '').trim();
  if (!resourceId) throw new ValidationError('resource_id is required');

  // Explicit resource authority (§21): only the owner of the vehicle, or the requester
  // of the case, may grant access to it. A garage cannot grant itself access.
  if (resourceType === 'vehicle') {
    const { data: vehicle } = await supabaseClient
      .from('vehicles').select('vin, owner_id').eq('vin', resourceId).maybeSingle();
    if (!vehicle) throw new NotFoundError('Vehicle not found');
    if (vehicle.owner_id !== granter) throw new ForbiddenError('Only the vehicle owner may grant access to it');
  } else {
    const { data: serviceCase } = await supabaseClient
      .from('service_cases').select('id, requester_user_id').eq('id', resourceId).maybeSingle();
    if (!serviceCase) throw new NotFoundError('Service case not found');
    if (serviceCase.requester_user_id !== granter) {
      throw new ForbiddenError('Only the requester may grant access to this service case');
    }
  }

  // A named grantee must be a real tenant, or the binding would be meaningless.
  const granteeTenantId = body.grantee_tenant_id ? String(body.grantee_tenant_id).trim() : null;
  if (granteeTenantId) {
    const { data: tenant } = await supabaseClient
      .from('tenants').select('id').eq('id', granteeTenantId).maybeSingle();
    if (!tenant) throw new ValidationError('Unknown grantee tenant');
  }

  const rawToken = generateToken(GRANT_TOKEN_BYTES);
  const ttl = CAPABILITY_TTL_MINUTES[purpose];
  const { data, error } = await supabaseClient
    .from('service_capability_grants')
    .insert({
      token_hash: hashCapabilityToken(rawToken),
      purpose,
      resource_type: resourceType,
      resource_id: resourceId,
      granted_by_user_id: granter,
      grantee_tenant_id: granteeTenantId,
      expires_at: new Date(Date.now() + ttl * 60 * 1000).toISOString(),
    })
    .select()
    .single();
  if (error) throw new DatabaseError(`Failed to grant capability: ${error.message}`);

  return {
    // Returned ONCE. Never logged, never stored, never retrievable again.
    token: rawToken,
    grant: { id: data.id, purpose: data.purpose, resource_type: data.resource_type, expires_at: data.expires_at },
  };
}

/** Redeem a capability. Atomic and replay-safe: a second redemption matches zero rows. */
export async function redeemCapability(supabaseClient, userContext, rawToken) {
  const redeemer = actorId(userContext);
  const token = String(rawToken || '').trim();
  if (!token) throw new ValidationError('capability token is required');
  const tokenHash = hashCapabilityToken(token);
  const now = new Date().toISOString();

  // Wrong-recipient defence. A grant bound to a garage may only be redeemed from a
  // verified context for THAT garage. The check is made before the consuming update so a
  // mis-delivered link is not silently burned, and it is expressed as the same
  // "not valid" outcome so unknown / expired / revoked / wrong-recipient / replayed all
  // remain indistinguishable to a holder.
  const { data: candidate, error: lookupError } = await supabaseClient
    .from('service_capability_grants')
    .select('grantee_tenant_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (lookupError) throw new DatabaseError(`Failed to read capability: ${lookupError.message}`);
  if (candidate && candidate.grantee_tenant_id
      && candidate.grantee_tenant_id !== (userContext?.tenantId || null)) {
    throw new NotFoundError('This access link is not valid');
  }

  const { data, error } = await supabaseClient
    .from('service_capability_grants')
    .update({ redeemed_at: now, redeemed_by_user_id: redeemer })
    .eq('token_hash', tokenHash)
    .is('redeemed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to redeem capability: ${error.message}`);
  if (!data) {
    // Unknown, already used, revoked and expired are deliberately indistinguishable.
    throw new NotFoundError('This access link is not valid');
  }
  return {
    grant: {
      purpose: data.purpose, resource_type: data.resource_type, resource_id: data.resource_id,
      granted_by_user_id: data.granted_by_user_id, redeemed_at: data.redeemed_at,
    },
  };
}

/** Revocation is immediate and available before or after redemption. */
export async function revokeCapability(supabaseClient, userContext, grantId) {
  const actor = actorId(userContext);
  const id = String(grantId || '').trim();
  if (!id) throw new ValidationError('grant id is required');
  const { data, error } = await supabaseClient
    .from('service_capability_grants')
    .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: actor })
    .eq('id', id)
    .eq('granted_by_user_id', actor)
    .is('revoked_at', null)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to revoke capability: ${error.message}`);
  if (!data) throw new NotFoundError('Grant not found');
  return { grant: { id: data.id, revoked_at: data.revoked_at } };
}
