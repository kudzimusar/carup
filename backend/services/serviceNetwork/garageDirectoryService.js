import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

/**
 * Service Network S1 — Governed Garage Identity & Publication.
 *
 * Authority model (S0 freeze):
 *   - garage identity anchors on the ACTIVE tenants universe (UUID ids);
 *   - this service owns garage_public_profiles / garage_branches ONLY;
 *   - tenant scoping is app-level (.eq('tenant_id', verified context)) because
 *     the backend runs as service_role — RLS is not the runtime boundary;
 *   - publication is truthful: no ratings, no invented hours/phones/badges;
 *     verification_dimensions render "verified" ONLY when a governed workflow
 *     wrote a fact (Foundation ships no such writer, so everything is unverified);
 *   - PartSentry participation is DERIVED from partsentry_logs at read time —
 *     never stored here (no duplicate authority).
 */

/** Frozen S1 service-category vocabulary (structured, app-side validated — S0 §4.1). */
export const GARAGE_SERVICE_CATEGORIES = Object.freeze([
  'general_service',
  'engine',
  'transmission',
  'brakes',
  'suspension',
  'electrical',
  'diagnostics',
  'bodywork',
  'tyres',
  'air_conditioning',
  'exhaust',
  'other',
]);

const PUBLICATION_STATUSES = Object.freeze(['draft', 'published', 'unpublished']);
const CONTACT_POLICIES = Object.freeze(['in_app_only', 'phone_public']);
/** Tenant types that may hold a garage profile in Foundation 1.0 (S1 freeze). */
const GARAGE_TENANT_TYPES = Object.freeze(['garage']);
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

/**
 * Public-safe projection allow-list. Internal tenant UUIDs are NOT public
 * identity — the slug is (plan §6.5 "do not publish internal tenant IDs").
 */
function toPublicGarage(row, { includeTenantScopedExtras = false } = {}) {
  const pub = {
    slug: row.slug,
    display_name: row.display_name,
    description: row.description || null,
    location_city: row.location_city || null,
    location_province: row.location_province || null,
    service_categories: Array.isArray(row.service_categories) ? row.service_categories : [],
    contact_policy: row.contact_policy,
    public_phone: row.contact_policy === 'phone_public' ? (row.public_phone || null) : null,
    verification_dimensions: row.verification_dimensions && typeof row.verification_dimensions === 'object'
      ? row.verification_dimensions
      : {},
    public_media: Array.isArray(row.public_media) ? row.public_media : [],
    published_at: row.published_at || null,
  };
  if (includeTenantScopedExtras) {
    pub.publication_status = row.publication_status;
    pub.created_at = row.created_at;
    pub.updated_at = row.updated_at;
  }
  return pub;
}

function toPublicBranch(row) {
  return {
    name: row.name,
    location_city: row.location_city || null,
    location_province: row.location_province || null,
    address_public: row.address_public || null,
  };
}

function requireTenantContext(userContext = {}) {
  const tenantId = userContext.tenantId || null;
  if (!tenantId) {
    throw new ForbiddenError('A membership-verified garage tenant context is required (x-tenant-id membership)');
  }
  return tenantId;
}

async function loadTenant(supabaseClient, tenantId) {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('id, name, type, status')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load tenant: ${error.message}`);
  if (!data) throw new NotFoundError('Tenant not found');
  return data;
}

function assertGarageTenant(tenant) {
  if (!GARAGE_TENANT_TYPES.includes(String(tenant.type || '').toLowerCase())) {
    throw new ForbiddenError('Garage profiles are limited to garage-type tenants in Foundation 1.0');
  }
}

function normalizeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    throw new ValidationError('slug must be 2-64 chars of a-z, 0-9 and hyphen, not starting/ending with hyphen');
  }
  return slug;
}

function slugFromName(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  if (!SLUG_PATTERN.test(slug)) {
    throw new ValidationError('display_name cannot be converted to a valid slug; provide slug explicitly');
  }
  return slug;
}

function normalizeCategories(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError('service_categories must be an array');
  const seen = new Set();
  for (const raw of value) {
    const c = String(raw || '').trim();
    if (!GARAGE_SERVICE_CATEGORIES.includes(c)) {
      throw new ValidationError(`Unknown service category: ${c || '(empty)'}`);
    }
    seen.add(c);
  }
  return [...seen];
}

function normalizeProfileInput(body = {}) {
  const out = {};
  if (body.display_name !== undefined) {
    const name = String(body.display_name || '').trim();
    if (name.length < 2 || name.length > 120) {
      throw new ValidationError('display_name must be 2-120 characters');
    }
    out.display_name = name;
  }
  if (body.description !== undefined) {
    const d = body.description === null ? null : String(body.description).trim();
    if (d && d.length > 2000) throw new ValidationError('description must be at most 2000 characters');
    out.description = d || null;
  }
  for (const key of ['location_city', 'location_province']) {
    if (body[key] !== undefined) {
      const v = body[key] === null ? null : String(body[key]).trim();
      if (v && v.length > 120) throw new ValidationError(`${key} must be at most 120 characters`);
      out[key] = v || null;
    }
  }
  if (body.contact_policy !== undefined) {
    if (!CONTACT_POLICIES.includes(body.contact_policy)) {
      throw new ValidationError(`contact_policy must be one of: ${CONTACT_POLICIES.join(', ')}`);
    }
    out.contact_policy = body.contact_policy;
  }
  if (body.public_phone !== undefined) {
    const p = body.public_phone === null ? null : String(body.public_phone).trim();
    if (p && !/^\+?[0-9 ()-]{5,25}$/.test(p)) throw new ValidationError('public_phone is not a plausible phone number');
    out.public_phone = p || null;
  }
  if (body.service_categories !== undefined) {
    out.service_categories = normalizeCategories(body.service_categories);
  }
  if (body.slug !== undefined) {
    out.slug = normalizeSlug(body.slug);
  }
  // publication_status is NEVER accepted here — explicit transitions only.
  if (body.publication_status !== undefined) {
    throw new ValidationError('publication_status cannot be set directly; use publish/unpublish');
  }
  // verification_dimensions has no client writer in Foundation 1.0.
  if (body.verification_dimensions !== undefined) {
    throw new ValidationError('verification_dimensions is written only by governed verification workflows');
  }
  return out;
}

async function loadProfileByTenant(supabaseClient, tenantId) {
  const { data, error } = await supabaseClient
    .from('garage_public_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load garage profile: ${error.message}`);
  return data || null;
}

/** Derived, factual PartSentry participation — never stored (S0: no duplicate authority). */
async function derivePartsentryParticipation(supabaseClient, tenantId) {
  const { count, error } = await supabaseClient
    .from('partsentry_logs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (error) return { available: false, recorded_repairs: null };
  return { available: true, recorded_repairs: count ?? 0 };
}

// ─────────────────────────── public directory reads ───────────────────────────

export async function getPublicGarageDirectory(supabaseClient, query = {}) {
  let builder = supabaseClient
    .from('garage_public_profiles')
    .select('*')
    .eq('publication_status', 'published');
  const city = String(query.city || '').trim();
  const province = String(query.province || '').trim();
  if (city) builder = builder.eq('location_city', city);
  if (province) builder = builder.eq('location_province', province);
  builder = builder.order('display_name', { ascending: true }).limit(200);
  const { data, error } = await builder;
  if (error) throw new DatabaseError(`Failed to list garage directory: ${error.message}`);
  let rows = data || [];
  const category = String(query.category || '').trim();
  if (category) {
    if (!GARAGE_SERVICE_CATEGORIES.includes(category)) {
      throw new ValidationError(`Unknown service category: ${category}`);
    }
    rows = rows.filter((r) => Array.isArray(r.service_categories) && r.service_categories.includes(category));
  }
  return { garages: rows.map((r) => toPublicGarage(r)), total: rows.length };
}

export async function getPublicGarageDetail(supabaseClient, slugValue) {
  const slug = normalizeSlug(slugValue);
  const { data, error } = await supabaseClient
    .from('garage_public_profiles')
    .select('*')
    .eq('slug', slug)
    .eq('publication_status', 'published')
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load garage: ${error.message}`);
  if (!data) throw new NotFoundError('Garage not found');
  const { data: branches, error: brErr } = await supabaseClient
    .from('garage_branches')
    .select('*')
    .eq('tenant_id', data.tenant_id)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (brErr) throw new DatabaseError(`Failed to load branches: ${brErr.message}`);
  const partsentry = await derivePartsentryParticipation(supabaseClient, data.tenant_id);
  return {
    garage: toPublicGarage(data),
    branches: (branches || []).map(toPublicBranch),
    partsentry_participation: partsentry,
  };
}

// ─────────────────────────── garage-side management ───────────────────────────

export async function getMyGarageProfile(supabaseClient, userContext) {
  const tenantId = requireTenantContext(userContext);
  const tenant = await loadTenant(supabaseClient, tenantId);
  assertGarageTenant(tenant);
  const profile = await loadProfileByTenant(supabaseClient, tenantId);
  const { data: branches, error } = await supabaseClient
    .from('garage_branches')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });
  if (error) throw new DatabaseError(`Failed to load branches: ${error.message}`);
  return {
    tenant: { id: tenant.id, name: tenant.name, type: tenant.type },
    profile: profile ? toPublicGarage(profile, { includeTenantScopedExtras: true }) : null,
    branches: branches || [],
  };
}

export async function upsertMyGarageProfile(supabaseClient, userContext, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const tenant = await loadTenant(supabaseClient, tenantId);
  assertGarageTenant(tenant);
  const input = normalizeProfileInput(body);
  const existing = await loadProfileByTenant(supabaseClient, tenantId);
  const now = new Date().toISOString();

  if (!existing) {
    if (!input.display_name) throw new ValidationError('display_name is required to create a garage profile');
    const insertRow = {
      tenant_id: tenantId,
      display_name: input.display_name,
      slug: input.slug || slugFromName(input.display_name),
      description: input.description ?? null,
      location_city: input.location_city ?? null,
      location_province: input.location_province ?? null,
      contact_policy: input.contact_policy || 'in_app_only',
      public_phone: input.public_phone ?? null,
      service_categories: input.service_categories || [],
      created_by_user_id: userContext.id || userContext.userId,
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await supabaseClient
      .from('garage_public_profiles')
      .insert(insertRow)
      .select()
      .single();
    if (error) {
      if (String(error.code) === '23505') {
        throw new ValidationError('That slug is already taken; choose another');
      }
      throw new DatabaseError(`Failed to create garage profile: ${error.message}`);
    }
    return { profile: toPublicGarage(data, { includeTenantScopedExtras: true }), created: true };
  }

  const patch = { ...input, updated_at: now };
  const { data, error } = await supabaseClient
    .from('garage_public_profiles')
    .update(patch)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) {
    if (String(error.code) === '23505') {
      throw new ValidationError('That slug is already taken; choose another');
    }
    throw new DatabaseError(`Failed to update garage profile: ${error.message}`);
  }
  return { profile: toPublicGarage(data, { includeTenantScopedExtras: true }), created: false };
}

/**
 * Truthful publication gate: a published entry must be USEFUL and honest —
 * name, at least one structured capability, and a real location city.
 */
function assertPublishable(profile) {
  const missing = [];
  if (!profile.display_name || String(profile.display_name).trim().length < 2) missing.push('display_name');
  if (!Array.isArray(profile.service_categories) || profile.service_categories.length === 0) missing.push('service_categories');
  if (!profile.location_city) missing.push('location_city');
  if (missing.length) {
    throw new ValidationError(`Profile is not publishable yet; missing: ${missing.join(', ')}`);
  }
}

export async function publishMyGarageProfile(supabaseClient, userContext) {
  const tenantId = requireTenantContext(userContext);
  const tenant = await loadTenant(supabaseClient, tenantId);
  assertGarageTenant(tenant);
  const profile = await loadProfileByTenant(supabaseClient, tenantId);
  if (!profile) throw new NotFoundError('No garage profile exists yet');
  assertPublishable(profile);
  const now = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from('garage_public_profiles')
    .update({ publication_status: 'published', published_at: profile.published_at || now, updated_at: now })
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) throw new DatabaseError(`Failed to publish garage profile: ${error.message}`);
  return { profile: toPublicGarage(data, { includeTenantScopedExtras: true }) };
}

export async function unpublishMyGarageProfile(supabaseClient, userContext) {
  const tenantId = requireTenantContext(userContext);
  const tenant = await loadTenant(supabaseClient, tenantId);
  assertGarageTenant(tenant);
  const profile = await loadProfileByTenant(supabaseClient, tenantId);
  if (!profile) throw new NotFoundError('No garage profile exists yet');
  const now = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from('garage_public_profiles')
    .update({ publication_status: 'unpublished', updated_at: now })
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) throw new DatabaseError(`Failed to unpublish garage profile: ${error.message}`);
  return { profile: toPublicGarage(data, { includeTenantScopedExtras: true }) };
}

// ─────────────────────────── branch management ───────────────────────────

function normalizeBranchInput(body = {}) {
  const name = String(body.name || '').trim();
  if (name.length < 2 || name.length > 120) throw new ValidationError('branch name must be 2-120 characters');
  const out = { name };
  for (const key of ['location_city', 'location_province', 'address_public']) {
    if (body[key] !== undefined) {
      const v = body[key] === null ? null : String(body[key]).trim();
      if (v && v.length > 200) throw new ValidationError(`${key} must be at most 200 characters`);
      out[key] = v || null;
    }
  }
  return out;
}

export async function createMyGarageBranch(supabaseClient, userContext, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const tenant = await loadTenant(supabaseClient, tenantId);
  assertGarageTenant(tenant);
  const input = normalizeBranchInput(body);
  const now = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from('garage_branches')
    .insert({ tenant_id: tenantId, ...input, is_active: true, created_at: now, updated_at: now })
    .select()
    .single();
  if (error) {
    if (String(error.code) === '23505') {
      throw new ValidationError('A branch with that name already exists for this garage');
    }
    throw new DatabaseError(`Failed to create branch: ${error.message}`);
  }
  return { branch: data };
}

export async function deactivateMyGarageBranch(supabaseClient, userContext, branchId) {
  const tenantId = requireTenantContext(userContext);
  const id = String(branchId || '').trim();
  if (!id) throw new ValidationError('branch id is required');
  // Tenant scoping inside the UPDATE: cross-tenant rows read as not-found (workOrdersRoutes pattern).
  const { data, error } = await supabaseClient
    .from('garage_branches')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to deactivate branch: ${error.message}`);
  if (!data) throw new NotFoundError('Branch not found');
  return { branch: data };
}
