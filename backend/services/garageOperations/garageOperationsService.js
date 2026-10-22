import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { GARAGE_ADMIN_ROLES, requireGarageTenant } from '../serviceNetwork/serviceAuthority.js';
import {
  ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError,
} from '../../utils/errors.js';

export const GARAGE_EMPLOYMENT_CLASSIFICATIONS = Object.freeze(['owner', 'employee', 'contractor', 'other']);
export const GARAGE_WORKFORCE_STATUSES = Object.freeze(['pending', 'active', 'inactive', 'ended']);

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,23}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{5,25}$/;

function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}
function tenantIdOf(actor) { return requireGarageTenant(actor, GARAGE_ADMIN_ROLES); }
function clean(value, max = 200) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (v.length > max) throw new ValidationError(`value must be at most ${max} characters`);
  return v;
}
function code(value, label) {
  const v = String(value || '').trim().toUpperCase();
  if (!CODE_RE.test(v)) throw new ValidationError(`${label} must be 2-24 uppercase letters, numbers or hyphens`);
  return v;
}
function timezoneValue(value) {
  const v = clean(value, 80);
  if (!v) return null;
  try {
    // Intl rejects unknown IANA zones. A Garage operating timezone is authority, not display text.
    new Intl.DateTimeFormat('en-US', { timeZone: v }).format(0);
  } catch {
    throw new ValidationError('timezone must be a valid IANA time zone');
  }
  return v;
}
function dateValue(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const v = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError(`${label} must be YYYY-MM-DD`);
  return v;
}
function boolValue(value, fallback = undefined) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ValidationError('boolean value required');
  return value;
}
function dbError(prefix, error) {
  if (String(error?.code) === '23505') return new ConflictError(prefix);
  return new DatabaseError(`${prefix}: ${error?.message || 'database error'}`);
}
async function requiredAudit(client, actor, eventType, targetType, targetId, previousValue, newValue, sourceRoute, req) {
  const tenantId = tenantIdOf(actor);
  const result = await logAuditEvent(client, {
    req,
    event_type: eventType,
    actor_user_id: actorId(actor),
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: sourceRoute,
    targetType,
    targetId,
    previous_value: previousValue ?? null,
    new_value: newValue ?? null,
  });
  if (!result.success) throw new Error(`Garage operations audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
}

async function assertMember(client, tenantId, userId) {
  const target = String(userId || '').trim();
  if (!target) throw new ValidationError('user_id is required');
  const { data, error } = await client.from('tenant_users')
    .select('id, user_id, role, joined_at')
    .eq('tenant_id', tenantId).eq('user_id', target).maybeSingle();
  if (error) throw new DatabaseError(`Could not verify Garage membership: ${error.message}`);
  if (!data) throw new ValidationError('That person is not a current member of this garage');
  return data;
}

async function assertActiveWorkforceMember(client, tenantId, userId, label = 'manager') {
  await assertMember(client, tenantId, userId);
  const { data, error } = await client.from('garage_workforce_profiles')
    .select('id, user_id, employment_status')
    .eq('tenant_id', tenantId)
    .eq('user_id', String(userId))
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not verify ${label} workforce profile: ${error.message}`);
  if (!data || data.employment_status !== 'active') {
    throw new ValidationError(`The ${label} must have an active workforce profile in this garage`);
  }
  return data;
}

async function assertDepartment(client, tenantId, departmentId, { active = true } = {}) {
  if (!departmentId) return null;
  let q = client.from('garage_departments').select('*').eq('id', String(departmentId)).eq('tenant_id', tenantId);
  if (active) q = q.eq('is_active', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw new DatabaseError(`Could not verify department: ${error.message}`);
  if (!data) throw new ValidationError('That department is not available in this garage');
  return data;
}

async function assertSite(client, tenantId, siteId, { active = false } = {}) {
  const id = String(siteId || '').trim();
  if (!id) throw new ValidationError('site id is required');
  let q = client.from('garage_branches').select('*').eq('id', id).eq('tenant_id', tenantId);
  if (active) q = q.eq('is_active', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw new DatabaseError(`Could not load site: ${error.message}`);
  if (!data) throw new NotFoundError('Site not found');
  return data;
}

function normalizeHours(hours) {
  if (hours === undefined) return undefined;
  if (!Array.isArray(hours)) throw new ValidationError('opening_hours must be an array');
  const seen = new Set();
  return hours.map((row) => {
    const day = Number(row?.day_of_week);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new ValidationError('day_of_week must be 0-6');
    if (seen.has(day)) throw new ValidationError('opening_hours may contain each day only once');
    seen.add(day);
    const closed = row?.is_closed === true;
    const opens = closed ? null : String(row?.opens_at || '').trim();
    const closes = closed ? null : String(row?.closes_at || '').trim();
    if (!closed && (!/^\d{2}:\d{2}$/.test(opens) || !/^\d{2}:\d{2}$/.test(closes) || opens >= closes)) {
      throw new ValidationError('open days require opens_at and closes_at as HH:MM with opening before closing');
    }
    return { day_of_week: day, is_closed: closed, opens_at: opens, closes_at: closes };
  });
}

async function replaceHours(client, tenantId, branchId, hours) {
  if (hours === undefined) return;
  const { error: deleteError } = await client.from('garage_branch_opening_hours')
    .delete().eq('tenant_id', tenantId).eq('branch_id', branchId);
  if (deleteError) throw new DatabaseError(`Could not replace opening hours: ${deleteError.message}`);
  if (!hours.length) return;
  const now = new Date().toISOString();
  const { error } = await client.from('garage_branch_opening_hours').insert(
    hours.map((h) => ({ tenant_id: tenantId, branch_id: branchId, ...h, created_at: now, updated_at: now })),
  );
  if (error) throw new DatabaseError(`Could not save opening hours: ${error.message}`);
}

async function tenantTimezone(client, tenantId) {
  const { data, error } = await client.from('tenant_settings').select('timezone').eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new DatabaseError(`Could not load garage timezone: ${error.message}`);
  return data?.timezone ? timezoneValue(data.timezone) : null;
}

function normalizeSiteInput(body = {}, { create = false } = {}) {
  const out = {};
  if (body.branch_code !== undefined || create) out.branch_code = code(body.branch_code, 'branch_code');
  if (body.name !== undefined || create) {
    const v = clean(body.name, 120);
    if (!v || v.length < 2) throw new ValidationError('name must be 2-120 characters');
    out.name = v;
  }
  if (body.address_public !== undefined || body.address_line !== undefined || create) {
    const v = clean(body.address_line ?? body.address_public, 300);
    if (!v) throw new ValidationError('address_line is required');
    out.address_public = v;
  }
  if (body.location_city !== undefined || create) {
    const v = clean(body.location_city, 120);
    if (!v) throw new ValidationError('city is required');
    out.location_city = v;
  }
  if (body.location_province !== undefined) out.location_province = clean(body.location_province, 120);
  if (body.country_code !== undefined || create) {
    const v = String(body.country_code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(v)) throw new ValidationError('country_code must be a two-letter ISO country code');
    out.country_code = v;
  }
  if (body.phone !== undefined) {
    const v = clean(body.phone, 25);
    if (v && !PHONE_RE.test(v)) throw new ValidationError('phone is not a plausible phone number');
    out.phone = v;
  }
  if (body.whatsapp !== undefined) {
    const v = clean(body.whatsapp, 25);
    if (v && !PHONE_RE.test(v)) throw new ValidationError('whatsapp is not a plausible phone number');
    out.whatsapp = v;
  }
  if (body.email !== undefined) {
    const v = clean(body.email, 254);
    if (v && !EMAIL_RE.test(v)) throw new ValidationError('email is not valid');
    out.email = v;
  }
  if (body.timezone !== undefined) out.timezone = timezoneValue(body.timezone);
  if (body.is_primary !== undefined) out.is_primary = boolValue(body.is_primary);
  if (body.is_public !== undefined) out.is_public = boolValue(body.is_public);
  if (body.manager_user_id !== undefined) out.manager_user_id = clean(body.manager_user_id, 200);
  return out;
}

async function siteEnvelope(client, branch) {
  const { data: hours, error } = await client.from('garage_branch_opening_hours')
    .select('*').eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id).order('day_of_week', { ascending: true });
  if (error) throw new DatabaseError(`Could not load opening hours: ${error.message}`);
  return { ...branch, opening_hours: hours || [] };
}

export async function listGarageSites(client = defaultClient, actor = {}) {
  const tenantId = tenantIdOf(actor);
  const { data, error } = await client.from('garage_branches').select('*')
    .eq('tenant_id', tenantId).order('name', { ascending: true });
  if (error) throw new DatabaseError(`Could not load garage sites: ${error.message}`);
  const rows = data || [];
  if (!rows.length) return { sites: [] };
  const { data: hours, error: hoursError } = await client.from('garage_branch_opening_hours')
    .select('*').eq('tenant_id', tenantId).in('branch_id', rows.map((r) => r.id))
    .order('day_of_week', { ascending: true });
  if (hoursError) throw new DatabaseError(`Could not load opening hours: ${hoursError.message}`);
  const byBranch = new Map();
  for (const row of hours || []) {
    if (!byBranch.has(row.branch_id)) byBranch.set(row.branch_id, []);
    byBranch.get(row.branch_id).push(row);
  }
  return { sites: rows.map((row) => ({ ...row, opening_hours: byBranch.get(row.id) || [] })) };
}

export async function getGarageSite(client = defaultClient, actor = {}, siteId) {
  const tenantId = tenantIdOf(actor);
  return { site: await siteEnvelope(client, await assertSite(client, tenantId, siteId)) };
}

export async function createGarageSite(client = defaultClient, actor = {}, body = {}, options = {}) {
  const tenantId = tenantIdOf(actor);
  const creator = actorId(actor);
  const input = normalizeSiteInput(body, { create: true });
  if (!input.timezone) {
    input.timezone = await tenantTimezone(client, tenantId);
    if (!input.timezone) throw new ValidationError('timezone is required because this garage has no governed default timezone');
  }
  if (input.manager_user_id) await assertActiveWorkforceMember(client, tenantId, input.manager_user_id, 'branch manager');
  const hours = normalizeHours(body.opening_hours);
  const now = new Date().toISOString();
  const { data, error } = await client.from('garage_branches').insert({
    tenant_id: tenantId,
    ...input,
    is_active: true,
    is_primary: input.is_primary ?? false,
    is_public: input.is_public ?? false,
    created_at: now,
    updated_at: now,
  }).select().single();
  if (error) throw dbError('A site with that branch code or name already exists in this garage', error);
  await replaceHours(client, tenantId, data.id, hours);
  const site = await siteEnvelope(client, data);
  await requiredAudit(client, actor, 'GARAGE_SITE_CREATED', 'garage_branch', data.id, null, site, '/api/garage/sites', options.req);
  return { site, created: true };
}

export async function updateGarageSite(client = defaultClient, actor = {}, siteId, body = {}, options = {}) {
  const tenantId = tenantIdOf(actor);
  const previous = await assertSite(client, tenantId, siteId);
  if (body.manager_user_id !== undefined) {
    throw new ValidationError('Use the branch-manager endpoint to change manager responsibility');
  }
  const input = normalizeSiteInput(body);
  if (input.branch_code && previous.branch_code && input.branch_code !== previous.branch_code) {
    throw new ConflictError('branch_code is stable after it has been set');
  }
  if (input.manager_user_id) {
    if (previous.is_active !== true) throw new ConflictError('Activate this site before assigning a branch manager');
    await assertActiveWorkforceMember(client, tenantId, input.manager_user_id, 'branch manager');
  }
  const patch = { ...input, updated_at: new Date().toISOString() };
  const { data, error } = await client.from('garage_branches').update(patch)
    .eq('id', previous.id).eq('tenant_id', tenantId).select().single();
  if (error) throw dbError('That site change conflicts with an existing branch code or name', error);
  const hours = normalizeHours(body.opening_hours);
  await replaceHours(client, tenantId, previous.id, hours);
  const site = await siteEnvelope(client, data);
  await requiredAudit(client, actor, 'GARAGE_SITE_UPDATED', 'garage_branch', previous.id, previous, site, '/api/garage/sites/:siteId', options.req);
  return { site, changed: true };
}

export async function setGarageSiteStatus(client = defaultClient, actor = {}, siteId, status, options = {}) {
  const tenantId = tenantIdOf(actor);
  const previous = await assertSite(client, tenantId, siteId);
  const next = String(status || '').trim().toLowerCase();
  if (!['active', 'inactive'].includes(next)) throw new ValidationError('status must be active or inactive');
  const active = next === 'active';
  if (!active) {
    const { count, error } = await client.from('garage_workforce_branch_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('branch_id', previous.id).is('ended_at', null);
    if (error) throw new DatabaseError(`Could not verify current site assignments: ${error.message}`);
    if ((count || 0) > 0) {
      throw new ConflictError('Move or end active staff assignments before deactivating this site');
    }
  }
  const { data, error } = await client.from('garage_branches').update({
    is_active: active,
    ...(active ? {} : { is_primary: false, manager_user_id: null }),
    updated_at: new Date().toISOString(),
  }).eq('id', previous.id).eq('tenant_id', tenantId).select().single();
  if (error) throw new DatabaseError(`Could not change site status: ${error.message}`);
  await requiredAudit(client, actor, active ? 'GARAGE_SITE_ACTIVATED' : 'GARAGE_SITE_DEACTIVATED',
    'garage_branch', previous.id, previous, data, '/api/garage/sites/:siteId/status', options.req);
  return { site: await siteEnvelope(client, data), changed: previous.is_active !== active };
}

export async function setGarageSiteManager(client = defaultClient, actor = {}, siteId, userId, options = {}) {
  const tenantId = tenantIdOf(actor);
  const previous = await assertSite(client, tenantId, siteId);
  const managerId = userId == null || userId === '' ? null : String(userId).trim();
  if (managerId) {
    if (previous.is_active !== true) throw new ConflictError('Activate this site before assigning a branch manager');
    await assertActiveWorkforceMember(client, tenantId, managerId, 'branch manager');
  }
  const { data, error } = await client.from('garage_branches').update({
    manager_user_id: managerId, updated_at: new Date().toISOString(),
  }).eq('id', previous.id).eq('tenant_id', tenantId).select().single();
  if (error) throw new DatabaseError(`Could not change branch manager: ${error.message}`);
  await requiredAudit(client, actor, 'GARAGE_SITE_MANAGER_CHANGED', 'garage_branch', previous.id,
    { manager_user_id: previous.manager_user_id || null }, { manager_user_id: managerId },
    '/api/garage/sites/:siteId/manager', options.req);
  return { site: await siteEnvelope(client, data), changed: previous.manager_user_id !== managerId };
}

// ── Departments ─────────────────────────────────────────────────────────────────────────────────
export async function listGarageDepartments(client = defaultClient, actor = {}) {
  const tenantId = tenantIdOf(actor);
  const { data, error } = await client.from('garage_departments').select('*').eq('tenant_id', tenantId)
    .order('name', { ascending: true });
  if (error) throw new DatabaseError(`Could not load departments: ${error.message}`);
  return { departments: data || [] };
}

export async function createGarageDepartment(client = defaultClient, actor = {}, body = {}, options = {}) {
  const tenantId = tenantIdOf(actor);
  const name = clean(body.name, 120);
  if (!name || name.length < 2) throw new ValidationError('department name must be 2-120 characters');
  const now = new Date().toISOString();
  const { data, error } = await client.from('garage_departments').insert({
    tenant_id: tenantId, name, is_active: true, created_by_user_id: actorId(actor), created_at: now, updated_at: now,
  }).select().single();
  if (error) throw dbError('A department with that name already exists in this garage', error);
  await requiredAudit(client, actor, 'GARAGE_DEPARTMENT_CREATED', 'garage_department', data.id, null, data,
    '/api/garage/departments', options.req);
  return { department: data, created: true };
}

export async function updateGarageDepartment(client = defaultClient, actor = {}, departmentId, body = {}, options = {}) {
  const tenantId = tenantIdOf(actor);
  const id = String(departmentId || '').trim();
  const { data: previous, error: loadError } = await client.from('garage_departments').select('*')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (loadError) throw new DatabaseError(`Could not load department: ${loadError.message}`);
  if (!previous) throw new NotFoundError('Department not found');
  const patch = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = clean(body.name, 120);
    if (!name || name.length < 2) throw new ValidationError('department name must be 2-120 characters');
    patch.name = name;
  }
  if (body.is_active !== undefined) patch.is_active = boolValue(body.is_active);
  const { data, error } = await client.from('garage_departments').update(patch)
    .eq('id', id).eq('tenant_id', tenantId).select().single();
  if (error) throw dbError('That department conflicts with an existing name', error);
  await requiredAudit(client, actor, 'GARAGE_DEPARTMENT_UPDATED', 'garage_department', id, previous, data,
    '/api/garage/departments/:departmentId', options.req);
  return { department: data, changed: true };
}

// ── Workforce ───────────────────────────────────────────────────────────────────────────────────
async function loadWorkforceProfile(client, tenantId, userId) {
  const target = String(userId || '').trim();
  if (!target) throw new ValidationError('user id is required');
  const { data, error } = await client.from('garage_workforce_profiles').select('*')
    .eq('tenant_id', tenantId).eq('user_id', target).maybeSingle();
  if (error) throw new DatabaseError(`Could not load workforce profile: ${error.message}`);
  if (!data) throw new NotFoundError('Workforce profile not found');
  return data;
}

async function workforceEnvelope(client, tenantId, profile) {
  const [usersR, deptR, assignR, skillsR, certsR] = await Promise.all([
    client.from('users').select('id, name, email').eq('id', profile.user_id).maybeSingle(),
    profile.department_id
      ? client.from('garage_departments').select('id, name, is_active').eq('id', profile.department_id).eq('tenant_id', tenantId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client.from('garage_workforce_branch_assignments').select('*').eq('tenant_id', tenantId)
      .eq('workforce_profile_id', profile.id).order('assigned_at', { ascending: false }),
    client.from('garage_workforce_skills').select('*').eq('tenant_id', tenantId)
      .eq('workforce_profile_id', profile.id).order('recorded_at', { ascending: true }),
    client.from('garage_workforce_certifications').select('*').eq('tenant_id', tenantId)
      .eq('workforce_profile_id', profile.id).order('recorded_at', { ascending: false }),
  ]);
  for (const [label, result] of [['user', usersR], ['department', deptR], ['assignments', assignR], ['skills', skillsR], ['certifications', certsR]]) {
    if (result.error) throw new DatabaseError(`Could not load workforce ${label}: ${result.error.message}`);
  }
  return {
    ...profile,
    user: usersR.data || null,
    department: deptR.data || null,
    branch_assignments: (assignR.data || []).filter((a) => !a.ended_at),
    branch_assignment_history: assignR.data || [],
    skills: (skillsR.data || []).filter((s) => !s.removed_at),
    certifications: (certsR.data || []).filter((s) => !s.withdrawn_at),
  };
}

export async function listGarageWorkforce(client = defaultClient, actor = {}) {
  const tenantId = tenantIdOf(actor);
  const { data, error } = await client.from('garage_workforce_profiles').select('*')
    .eq('tenant_id', tenantId).order('staff_code', { ascending: true });
  if (error) throw new DatabaseError(`Could not load workforce: ${error.message}`);
  const profiles = [];
  for (const row of data || []) profiles.push(await workforceEnvelope(client, tenantId, row));
  return { workforce: profiles };
}

export async function getGarageWorkforceProfile(client = defaultClient, actor = {}, userId) {
  const tenantId = tenantIdOf(actor);
  return { profile: await workforceEnvelope(client, tenantId, await loadWorkforceProfile(client, tenantId, userId)) };
}

function normalizeProfileInput(body = {}, { create = false } = {}) {
  const patch = {};
  if (body.staff_code !== undefined || create) patch.staff_code = code(body.staff_code, 'staff_code');
  if (body.job_title !== undefined) patch.job_title = clean(body.job_title, 120);
  if (body.employment_classification !== undefined || create) {
    const v = String(body.employment_classification || '').trim().toLowerCase();
    if (!GARAGE_EMPLOYMENT_CLASSIFICATIONS.includes(v)) {
      throw new ValidationError(`employment_classification must be one of: ${GARAGE_EMPLOYMENT_CLASSIFICATIONS.join(', ')}`);
    }
    patch.employment_classification = v;
  }
  if (body.start_date !== undefined || create) {
    const v = dateValue(body.start_date, 'start_date');
    if (!v) throw new ValidationError('start_date is required');
    patch.start_date = v;
  }
  if (body.end_date !== undefined) patch.end_date = dateValue(body.end_date, 'end_date');
  if (body.department_id !== undefined) patch.department_id = clean(body.department_id, 100);
  if (body.internal_notes !== undefined) patch.internal_notes = clean(body.internal_notes, 2000);
  return patch;
}

export async function upsertGarageWorkforceProfile(client = defaultClient, actor = {}, userId, body = {}, options = {}) {
  const tenantId = tenantIdOf(actor);
  const target = String(userId || body.user_id || '').trim();
  const member = await assertMember(client, tenantId, target);
  const { data: existing, error: loadError } = await client.from('garage_workforce_profiles').select('*')
    .eq('tenant_id', tenantId).eq('user_id', target).maybeSingle();
  if (loadError) throw new DatabaseError(`Could not check workforce profile: ${loadError.message}`);
  const patch = normalizeProfileInput(body, { create: !existing });
  if (existing && patch.staff_code && patch.staff_code !== existing.staff_code) {
    throw new ConflictError('staff_code is stable after the workforce profile is created');
  }
  if (patch.department_id) await assertDepartment(client, tenantId, patch.department_id, { active: true });
  const now = new Date().toISOString();
  let data; let error;
  if (!existing) {
    // Mechanics are never operational merely because a profile exists. They begin pending, receive
    // a primary site through the assignment authority, then move to active. Garage admins may be
    // active without a workshop assignment because administration itself is tenant-wide.
    const initialStatus = String(member.role || '').toLowerCase() === 'mechanic' ? 'pending' : 'active';
    ({ data, error } = await client.from('garage_workforce_profiles').insert({
      tenant_id: tenantId, user_id: target, ...patch, employment_status: initialStatus,
      created_by_user_id: actorId(actor), created_at: now, updated_at: now,
    }).select().single());
  } else {
    ({ data, error } = await client.from('garage_workforce_profiles').update({ ...patch, updated_at: now })
      .eq('id', existing.id).eq('tenant_id', tenantId).select().single());
  }
  if (error) throw dbError('That staff code is already in use in this garage', error);
  const envelope = await workforceEnvelope(client, tenantId, data);
  await requiredAudit(client, actor, existing ? 'GARAGE_WORKFORCE_PROFILE_UPDATED' : 'GARAGE_WORKFORCE_PROFILE_CREATED',
    'garage_workforce_profile', data.id, existing, envelope, '/api/garage/workforce', options.req);
  return { profile: envelope, created: !existing, membershipRole: member.role };
}

export async function setGarageWorkforceStatus(client = defaultClient, actor = {}, userId, status, options = {}) {
  const tenantId = tenantIdOf(actor);
  const profile = await loadWorkforceProfile(client, tenantId, userId);
  const next = String(status || '').trim().toLowerCase();
  if (!GARAGE_WORKFORCE_STATUSES.includes(next)) throw new ValidationError('status must be pending, active, inactive or ended');

  // Keep the route-level preflight for a precise operator error; PostgreSQL repeats the same
  // authority/invariant checks inside the atomic transition so a race cannot bypass them.
  if (next === 'active') {
    const member = await assertMember(client, tenantId, profile.user_id);
    if (String(member.role || '').toLowerCase() === 'mechanic') {
      const { count, error: assignmentError } = await client.from('garage_workforce_branch_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('workforce_profile_id', profile.id)
        .eq('is_primary', true)
        .is('ended_at', null);
      if (assignmentError) throw new DatabaseError(`Could not verify the mechanic's primary site: ${assignmentError.message}`);
      if ((count || 0) !== 1) throw new ConflictError('Assign exactly one active primary site before activating this mechanic.');
    }
  } else if (next === 'pending') {
    await assertMember(client, tenantId, profile.user_id);
  }

  const { data: changed, error } = await client.rpc('garage_ops01_set_workforce_status', {
    p_tenant_id: tenantId,
    p_workforce_profile_id: profile.id,
    p_status: next,
    p_actor_user_id: actorId(actor),
  });
  if (error) throw new DatabaseError(`Could not change workforce status: ${error.message}`);

  const updated = await loadWorkforceProfile(client, tenantId, userId);
  if (changed !== true) return { profile: await workforceEnvelope(client, tenantId, updated), changed: false };

  await requiredAudit(client, actor, 'GARAGE_WORKFORCE_STATUS_CHANGED', 'garage_workforce_profile', profile.id,
    { employment_status: profile.employment_status, end_date: profile.end_date },
    { employment_status: updated.employment_status, end_date: updated.end_date },
    '/api/garage/workforce/:userId/status', options.req);
  return { profile: await workforceEnvelope(client, tenantId, updated), changed: true };
}

export async function setGarageWorkforceBranches(client = defaultClient, actor = {}, userId, body = {}, options = {}) {
  const tenantId = tenantIdOf(actor);
  const profile = await loadWorkforceProfile(client, tenantId, userId);
  if (!['pending', 'active'].includes(profile.employment_status)) {
    throw new ConflictError('Inactive or ended workforce cannot receive new operational site assignments');
  }
  await assertMember(client, tenantId, profile.user_id);
  const primaryId = String(body.primary_branch_id || '').trim();
  if (!primaryId) throw new ValidationError('primary_branch_id is required');
  const additional = Array.isArray(body.additional_branch_ids)
    ? body.additional_branch_ids.map((v) => String(v).trim()).filter(Boolean)
    : [];
  const desired = [...new Set([primaryId, ...additional])];
  for (const id of desired) await assertSite(client, tenantId, id, { active: true });

  const { data: current, error: currentError } = await client.from('garage_workforce_branch_assignments').select('*')
    .eq('tenant_id', tenantId).eq('workforce_profile_id', profile.id).is('ended_at', null);
  if (currentError) throw new DatabaseError(`Could not load current site assignments: ${currentError.message}`);

  // The replacement itself is one database transaction. The previous implementation first ended
  // every live assignment and then issued a second insert; an insert/network failure in between
  // could strand an ACTIVE mechanic without the primary-site fact OPS01 requires.
  const { data: changed, error: replaceError } = await client.rpc('garage_ops01_replace_workforce_branches', {
    p_tenant_id: tenantId,
    p_workforce_profile_id: profile.id,
    p_primary_branch_id: primaryId,
    p_additional_branch_ids: additional.filter((id) => id !== primaryId),
    p_actor_user_id: actorId(actor),
  });
  if (replaceError) {
    throw new DatabaseError(`Could not replace staff site assignments: ${replaceError.message}`);
  }

  const next = await workforceEnvelope(client, tenantId, profile);
  if (changed !== true) return { profile: next, changed: false };

  await requiredAudit(client, actor, 'GARAGE_WORKFORCE_BRANCH_ASSIGNMENT_CHANGED', 'garage_workforce_profile', profile.id,
    { assignments: current || [] }, { assignments: next.branch_assignments },
    '/api/garage/workforce/:userId/branches', options.req);
  return { profile: next, changed: true };
}

export async function replaceGarageWorkforceSkills(client = defaultClient, actor = {}, userId, skills, options = {}) {
  const tenantId = tenantIdOf(actor);
  const profile = await loadWorkforceProfile(client, tenantId, userId);
  if (!Array.isArray(skills)) throw new ValidationError('skills must be an array');
  const desired = [...new Set(skills.map((v) => String(v || '').trim()).filter(Boolean))];
  if (desired.some((v) => v.length > 80)) throw new ValidationError('skill names must be at most 80 characters');
  const { data: current, error: currentError } = await client.from('garage_workforce_skills').select('*')
    .eq('tenant_id', tenantId).eq('workforce_profile_id', profile.id).is('removed_at', null);
  if (currentError) throw new DatabaseError(`Could not load skills: ${currentError.message}`);
  const currentNames = (current || []).map((s) => s.skill_name).sort();
  if (JSON.stringify(currentNames) === JSON.stringify([...desired].sort())) {
    return { profile: await workforceEnvelope(client, tenantId, profile), changed: false };
  }
  const now = new Date().toISOString();
  if ((current || []).length) {
    const { error } = await client.from('garage_workforce_skills').update({ removed_at: now, removed_by_user_id: actorId(actor) })
      .eq('tenant_id', tenantId).eq('workforce_profile_id', profile.id).is('removed_at', null);
    if (error) throw new DatabaseError(`Could not close previous skills: ${error.message}`);
  }
  if (desired.length) {
    const { error } = await client.from('garage_workforce_skills').insert(desired.map((skill_name) => ({
      tenant_id: tenantId, workforce_profile_id: profile.id, skill_name, recorded_at: now, recorded_by_user_id: actorId(actor),
    })));
    if (error) throw dbError('Those skills could not be saved', error);
  }
  const next = await workforceEnvelope(client, tenantId, profile);
  await requiredAudit(client, actor, 'GARAGE_WORKFORCE_SKILLS_CHANGED', 'garage_workforce_profile', profile.id,
    { skills: currentNames }, { skills: desired }, '/api/garage/workforce/:userId/skills', options.req);
  return { profile: next, changed: true };
}

export async function addGarageWorkforceCertification(client = defaultClient, actor = {}, userId, body = {}, options = {}) {
  const tenantId = tenantIdOf(actor);
  const profile = await loadWorkforceProfile(client, tenantId, userId);
  const name = clean(body.name, 160);
  if (!name) throw new ValidationError('certification name is required');
  const row = {
    tenant_id: tenantId,
    workforce_profile_id: profile.id,
    name,
    issuer: clean(body.issuer, 160),
    reference_number: clean(body.reference_number, 160),
    issue_date: dateValue(body.issue_date, 'issue_date'),
    expiry_date: dateValue(body.expiry_date, 'expiry_date'),
    recorded_by_user_id: actorId(actor),
  };
  if (row.issue_date && row.expiry_date && row.expiry_date < row.issue_date) {
    throw new ValidationError('expiry_date cannot be before issue_date');
  }
  const { data, error } = await client.from('garage_workforce_certifications').insert(row).select().single();
  if (error) throw new DatabaseError(`Could not record certification: ${error.message}`);
  await requiredAudit(client, actor, 'GARAGE_WORKFORCE_CERTIFICATION_RECORDED', 'garage_workforce_certification', data.id,
    null, data, '/api/garage/workforce/:userId/certifications', options.req);
  return { certification: data, recorded: true };
}

export default {
  listGarageSites, getGarageSite, createGarageSite, updateGarageSite, setGarageSiteStatus, setGarageSiteManager,
  listGarageDepartments, createGarageDepartment, updateGarageDepartment,
  listGarageWorkforce, getGarageWorkforceProfile, upsertGarageWorkforceProfile, setGarageWorkforceStatus,
  setGarageWorkforceBranches, replaceGarageWorkforceSkills, addGarageWorkforceCertification,
};
