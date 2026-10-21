import { logAuditEvent } from '../auditLogger.js';
import {
  ConflictError,
  DatabaseError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors.js';
import {
  GARAGE_ADMIN_ROLES,
  GARAGE_WORKSPACE_ROLES,
  requireGarageTenant,
} from './serviceAuthority.js';

const actorId = (actor = {}) => {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
};

const readTenant = (actor) => requireGarageTenant(actor, GARAGE_WORKSPACE_ROLES);
const adminTenant = (actor) => requireGarageTenant(actor, GARAGE_ADMIN_ROLES);

async function audit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Garage operations audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

const cleanText = (value, max, { nullable = true } = {}) => {
  if (value === undefined) return undefined;
  if (value === null) return nullable ? null : '';
  const text = String(value).trim();
  if (!text) return nullable ? null : '';
  if (text.length > max) throw new ValidationError(`Value must be at most ${max} characters.`);
  return text;
};

function normalizeCode(value, label = 'code') {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,15}$/.test(code)) {
    throw new ValidationError(`${label} must be 2-16 uppercase letters, numbers or hyphens.`);
  }
  return code;
}

function normalizeEmail(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const email = String(value).trim().toLowerCase();
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('contact_email is not a plausible email address.');
  }
  return email;
}

function normalizePhone(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const phone = String(value).trim();
  if (phone.length > 40 || !/^\+?[0-9 ()-]{5,40}$/.test(phone)) {
    throw new ValidationError('contact_phone is not a plausible phone number.');
  }
  return phone;
}

function normalizeBranchInput(body = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 120) {
      throw new ValidationError('branch name must be 2-120 characters.');
    }
    out.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'code')) out.code = normalizeCode(body.code, 'branch code');
  if (Object.prototype.hasOwnProperty.call(body, 'location_city')) out.location_city = cleanText(body.location_city, 120);
  if (Object.prototype.hasOwnProperty.call(body, 'location_province')) out.location_province = cleanText(body.location_province, 120);
  if (Object.prototype.hasOwnProperty.call(body, 'address_public')) out.address_public = cleanText(body.address_public, 240);
  if (Object.prototype.hasOwnProperty.call(body, 'contact_phone')) out.contact_phone = normalizePhone(body.contact_phone);
  if (Object.prototype.hasOwnProperty.call(body, 'contact_email')) out.contact_email = normalizeEmail(body.contact_email);
  if (Object.prototype.hasOwnProperty.call(body, 'manager_user_id')) {
    out.manager_user_id = body.manager_user_id ? String(body.manager_user_id).trim() : null;
  }
  return out;
}

async function requireCurrentMember(client, tenantId, userId) {
  const id = String(userId || '').trim();
  if (!id) throw new ValidationError('A staff user id is required.');
  const { data, error } = await client
    .from('tenant_users')
    .select('id, user_id, role, joined_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', id)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not verify garage membership: ${error.message}`);
  if (!data) throw new ValidationError('That person is not a current member of this garage.');
  return data;
}

async function requireAdminManager(client, tenantId, userId) {
  if (!userId) return null;
  const member = await requireCurrentMember(client, tenantId, userId);
  if (String(member.role || '').toLowerCase() !== 'admin') {
    throw new ValidationError('A branch manager must be an administrator of this garage.');
  }
  return member;
}

async function loadBranch(client, tenantId, branchId) {
  const id = String(branchId || '').trim();
  if (!id) throw new ValidationError('branch id is required.');
  const { data, error } = await client
    .from('garage_branches')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load branch: ${error.message}`);
  if (!data) throw new NotFoundError('Branch not found.');
  return data;
}

async function loadHours(client, tenantId, branchIds) {
  if (!branchIds.length) return new Map();
  const { data, error } = await client
    .from('garage_branch_hours')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('branch_id', branchIds)
    .order('weekday', { ascending: true })
    .order('slot_no', { ascending: true });
  if (error) throw new DatabaseError(`Could not load branch hours: ${error.message}`);
  const map = new Map();
  for (const row of data || []) {
    const list = map.get(row.branch_id) || [];
    list.push(row);
    map.set(row.branch_id, list);
  }
  return map;
}

export async function listGarageBranches(client, actor = {}) {
  const tenantId = readTenant(actor);
  const { data, error } = await client
    .from('garage_branches')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });
  if (error) throw new DatabaseError(`Could not load garage branches: ${error.message}`);
  const rows = data || [];
  const hours = await loadHours(client, tenantId, rows.map((row) => row.id));
  return {
    branches: rows.map((row) => ({ ...row, opening_hours: hours.get(row.id) || [] })),
  };
}

export async function createGarageBranch(client, actor = {}, body = {}, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const input = normalizeBranchInput(body);
  await requireAdminManager(client, tenantId, input.manager_user_id);

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('garage_branches')
    .insert({ tenant_id: tenantId, ...input, is_active: true, created_at: now, updated_at: now })
    .select()
    .single();

  if (error) {
    if (String(error.code) === '23505') throw new ValidationError('That branch name or code already exists in this garage.');
    throw new DatabaseError(`Could not create branch: ${error.message}`);
  }

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_BRANCH_CREATED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/branches',
    targetType: 'garage_branches',
    targetId: data.id,
    previous_value: null,
    new_value: { id: data.id, name: data.name, code: data.code, manager_user_id: data.manager_user_id },
  });

  return { branch: { ...data, opening_hours: [] } };
}

export async function updateGarageBranch(client, actor = {}, branchId, body = {}, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const existing = await loadBranch(client, tenantId, branchId);
  const patch = normalizeBranchInput(body, { partial: true });
  if (!Object.keys(patch).length) throw new ValidationError('No branch changes were supplied.');
  await requireAdminManager(client, tenantId, patch.manager_user_id);

  patch.updated_at = new Date().toISOString();
  const { data, error } = await client
    .from('garage_branches')
    .update(patch)
    .eq('tenant_id', tenantId)
    .eq('id', existing.id)
    .select()
    .single();

  if (error) {
    if (String(error.code) === '23505') throw new ValidationError('That branch name or code already exists in this garage.');
    if (String(error.code) === '23503') throw new ValidationError('The selected branch manager is not a member of this garage.');
    throw new DatabaseError(`Could not update branch: ${error.message}`);
  }

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_BRANCH_UPDATED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/branches/:branchId',
    targetType: 'garage_branches',
    targetId: data.id,
    previous_value: existing,
    new_value: data,
  });

  return { branch: data };
}

export async function replaceGarageBranchHours(client, actor = {}, branchId, hours, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const branch = await loadBranch(client, tenantId, branchId);
  const schedule = Array.isArray(hours) ? hours : null;
  if (!schedule) throw new ValidationError('hours must be an array.');

  const normalized = schedule.map((row) => {
    const weekday = Number(row?.weekday);
    const slot = row?.slot_no === undefined ? 1 : Number(row.slot_no);
    const isClosed = Boolean(row?.is_closed);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new ValidationError('weekday must be 0-6.');
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw new ValidationError('slot_no must be 1-4.');
    const opens = row?.opens_at ? String(row.opens_at).trim() : null;
    const closes = row?.closes_at ? String(row.closes_at).trim() : null;
    if (isClosed && (opens || closes)) throw new ValidationError('A closed day cannot also have opening times.');
    if (!isClosed && (!/^\d{2}:\d{2}(:\d{2})?$/.test(opens || '') || !/^\d{2}:\d{2}(:\d{2})?$/.test(closes || ''))) {
      throw new ValidationError('Open hours require opens_at and closes_at in HH:MM format.');
    }
    return { weekday, slot_no: slot, is_closed: isClosed, opens_at: opens, closes_at: closes };
  });

  const seen = new Set();
  for (const row of normalized) {
    const key = `${row.weekday}:${row.slot_no}`;
    if (seen.has(key)) throw new ValidationError('Each weekday/slot combination may appear only once.');
    seen.add(key);
  }

  const { data: outcome, error } = await client.rpc('replace_garage_branch_hours', {
    p_tenant_id: tenantId,
    p_branch_id: branch.id,
    p_hours: normalized,
    p_actor_user_id: actorUserId,
  });
  if (error) throw new DatabaseError(`Could not replace branch hours: ${error.message}`);

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_BRANCH_HOURS_REPLACED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/branches/:branchId/hours',
    targetType: 'garage_branch_hours',
    targetId: branch.id,
    previous_value: null,
    new_value: { branch_id: branch.id, hours: normalized },
  });

  return { ...outcome, hours: normalized };
}

async function assertBranchMayDeactivate(client, tenantId, branchId) {
  const { data: cases, error: caseError } = await client
    .from('service_cases')
    .select('id, status')
    .eq('garage_tenant_id', tenantId)
    .eq('branch_id', branchId);
  if (caseError) throw new DatabaseError(`Could not verify branch service cases: ${caseError.message}`);
  const liveCases = (cases || []).filter((row) => ['requested', 'accepted', 'active'].includes(String(row.status || '').toLowerCase()));
  if (liveCases.length) throw new ConflictError('This branch still has open service cases. Move or close them before deactivating the branch.');

  const { data: workOrders, error: workError } = await client
    .from('mechanic_work_orders')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId);
  if (workError) throw new DatabaseError(`Could not verify branch work orders: ${workError.message}`);
  const terminal = new Set(['completed', 'cancelled', 'complete', 'closed', 'done']);
  const liveOrders = (workOrders || []).filter((row) => !terminal.has(String(row.status || '').trim().toLowerCase()));
  if (liveOrders.length) throw new ConflictError('This branch still has open work orders. Move or close them before deactivating the branch.');
}

export async function setGarageBranchActive(client, actor = {}, branchId, active, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const existing = await loadBranch(client, tenantId, branchId);
  if (!active) await assertBranchMayDeactivate(client, tenantId, existing.id);
  if (Boolean(existing.is_active) === Boolean(active)) return { branch: existing, changed: false };

  const { data, error } = await client
    .from('garage_branches')
    .update({ is_active: Boolean(active), updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', existing.id)
    .select()
    .single();
  if (error) throw new DatabaseError(`Could not change branch status: ${error.message}`);

  await audit(client, {
    req: options.req,
    event_type: active ? 'GARAGE_BRANCH_REACTIVATED' : 'GARAGE_BRANCH_DEACTIVATED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: active ? '/api/garage/operations/branches/:branchId/activate' : '/api/garage/operations/branches/:branchId/deactivate',
    targetType: 'garage_branches',
    targetId: data.id,
    previous_value: { is_active: existing.is_active },
    new_value: { is_active: data.is_active },
  });

  return { branch: data, changed: true };
}

function normalizeDepartmentInput(body = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 120) throw new ValidationError('department name is required and must be at most 120 characters.');
    out.name = name;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'code')) {
    const code = normalizeCode(body.code, 'department code');
    if (!code) throw new ValidationError('department code is required.');
    out.code = code;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'is_active')) out.is_active = Boolean(body.is_active);
  return out;
}

export async function listGarageDepartments(client, actor = {}) {
  const tenantId = adminTenant(actor);
  const { data, error } = await client
    .from('garage_departments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });
  if (error) throw new DatabaseError(`Could not load departments: ${error.message}`);
  return { departments: data || [] };
}

export async function createGarageDepartment(client, actor = {}, body = {}, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const input = normalizeDepartmentInput(body);
  const { data, error } = await client
    .from('garage_departments')
    .insert({ tenant_id: tenantId, ...input, created_by_user_id: actorUserId })
    .select()
    .single();
  if (error) {
    if (String(error.code) === '23505') throw new ValidationError('That department code already exists.');
    throw new DatabaseError(`Could not create department: ${error.message}`);
  }
  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_DEPARTMENT_CREATED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/departments',
    targetType: 'garage_departments',
    targetId: data.id,
    previous_value: null,
    new_value: data,
  });
  return { department: data };
}

export async function updateGarageDepartment(client, actor = {}, departmentId, body = {}, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const id = String(departmentId || '').trim();
  if (!id) throw new ValidationError('department id is required.');
  const { data: existing, error: readError } = await client
    .from('garage_departments').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (readError) throw new DatabaseError(`Could not load department: ${readError.message}`);
  if (!existing) throw new NotFoundError('Department not found.');

  const patch = normalizeDepartmentInput(body, { partial: true });
  if (!Object.keys(patch).length) throw new ValidationError('No department changes were supplied.');
  patch.updated_at = new Date().toISOString();

  const { data, error } = await client
    .from('garage_departments').update(patch).eq('tenant_id', tenantId).eq('id', id).select().single();
  if (error) {
    if (String(error.code) === '23505') throw new ValidationError('That department code already exists.');
    if (String(error.code) === '23503') throw new ConflictError('This department is still assigned to staff and cannot be removed from use.');
    throw new DatabaseError(`Could not update department: ${error.message}`);
  }

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_DEPARTMENT_UPDATED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/departments/:departmentId',
    targetType: 'garage_departments',
    targetId: id,
    previous_value: existing,
    new_value: data,
  });
  return { department: data };
}

function normalizeProfileInput(body = {}) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(body, 'employee_code')) out.employee_code = normalizeCode(body.employee_code, 'employee code');
  if (Object.prototype.hasOwnProperty.call(body, 'job_title')) out.job_title = cleanText(body.job_title, 120);
  if (Object.prototype.hasOwnProperty.call(body, 'department_id')) out.department_id = body.department_id ? String(body.department_id).trim() : null;
  if (Object.prototype.hasOwnProperty.call(body, 'employment_type')) {
    const type = body.employment_type ? String(body.employment_type).trim().toLowerCase() : null;
    if (type && !['owner', 'employee', 'contractor', 'apprentice'].includes(type)) {
      throw new ValidationError('employment_type must be owner, employee, contractor or apprentice.');
    }
    out.employment_type = type;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'work_phone')) out.work_phone = normalizePhone(body.work_phone);
  if (Object.prototype.hasOwnProperty.call(body, 'started_on')) {
    const date = body.started_on ? String(body.started_on).trim() : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('started_on must be YYYY-MM-DD.');
    out.started_on = date;
  }
  return out;
}

async function requireDepartment(client, tenantId, departmentId) {
  if (!departmentId) return null;
  const { data, error } = await client
    .from('garage_departments').select('id, is_active').eq('tenant_id', tenantId).eq('id', departmentId).maybeSingle();
  if (error) throw new DatabaseError(`Could not verify department: ${error.message}`);
  if (!data || data.is_active === false) throw new ValidationError('The selected department is not active in this garage.');
  return data;
}

export async function upsertGarageStaffProfile(client, actor = {}, userId, body = {}, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const member = await requireCurrentMember(client, tenantId, userId);
  const input = normalizeProfileInput(body);
  await requireDepartment(client, tenantId, input.department_id);

  const { data: existing, error: existingError } = await client
    .from('garage_staff_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('user_id', member.user_id)
    .maybeSingle();
  if (existingError) throw new DatabaseError(`Could not load staff profile: ${existingError.message}`);

  const now = new Date().toISOString();
  const row = {
    tenant_id: tenantId,
    user_id: member.user_id,
    ...input,
    updated_by_user_id: actorUserId,
    updated_at: now,
  };

  let data; let error;
  if (existing) {
    ({ data, error } = await client
      .from('garage_staff_profiles')
      .update(row)
      .eq('tenant_id', tenantId)
      .eq('user_id', member.user_id)
      .select()
      .single());
  } else {
    ({ data, error } = await client
      .from('garage_staff_profiles')
      .insert({ ...row, created_by_user_id: actorUserId, created_at: now })
      .select()
      .single());
  }
  if (error) {
    if (String(error.code) === '23505') throw new ValidationError('That employee code is already in use in this garage.');
    if (String(error.code) === '23503') throw new ValidationError('The selected department does not belong to this garage.');
    throw new DatabaseError(`Could not save staff profile: ${error.message}`);
  }

  await audit(client, {
    req: options.req,
    event_type: existing ? 'GARAGE_STAFF_PROFILE_UPDATED' : 'GARAGE_STAFF_PROFILE_CREATED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/staff/:userId/profile',
    targetType: 'garage_staff_profiles',
    targetId: `${tenantId}:${member.user_id}`,
    previous_value: existing || null,
    new_value: data,
  });

  return { profile: data, created: !existing };
}

export async function assignGarageStaffBranch(client, actor = {}, userId, body = {}, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const member = await requireCurrentMember(client, tenantId, userId);
  const branchId = String(body.branch_id || '').trim();
  if (!branchId) throw new ValidationError('branch_id is required.');

  const { data: outcome, error } = await client.rpc('assign_garage_staff_branch', {
    p_tenant_id: tenantId,
    p_user_id: member.user_id,
    p_branch_id: branchId,
    p_is_primary: Boolean(body.is_primary),
    p_actor_user_id: actorUserId,
  });
  if (error) {
    const message = String(error.message || '');
    if (message.includes('GARAGE_BRANCH_NOT_ACTIVE')) throw new ValidationError('That branch is not active.');
    if (message.includes('GARAGE_OPS_MEMBER_REQUIRED')) throw new ValidationError('That person is not a current member of this garage.');
    throw new DatabaseError(`Could not assign staff to branch: ${message}`);
  }

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_STAFF_BRANCH_ASSIGNED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/staff/:userId/branches',
    targetType: 'garage_staff_branch_assignments',
    targetId: outcome?.assignment_id || `${tenantId}:${member.user_id}:${branchId}`,
    previous_value: null,
    new_value: { user_id: member.user_id, branch_id: branchId, is_primary: Boolean(body.is_primary) },
  });

  return outcome || { assigned: true };
}

export async function endGarageStaffBranchAssignment(client, actor = {}, assignmentId, reason, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const id = String(assignmentId || '').trim();
  if (!id) throw new ValidationError('assignment id is required.');

  const { data: outcome, error } = await client.rpc('end_garage_staff_branch_assignment', {
    p_tenant_id: tenantId,
    p_assignment_id: id,
    p_actor_user_id: actorUserId,
    p_reason: reason ? String(reason).trim() : 'reassigned',
  });
  if (error) {
    if (String(error.message || '').includes('GARAGE_STAFF_ASSIGNMENT_NOT_FOUND')) throw new NotFoundError('Staff branch assignment not found.');
    throw new DatabaseError(`Could not end staff branch assignment: ${error.message}`);
  }

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_STAFF_BRANCH_ASSIGNMENT_ENDED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/staff/:userId/branches/:assignmentId',
    targetType: 'garage_staff_branch_assignments',
    targetId: id,
    previous_value: null,
    new_value: { ended: true, reason: reason || 'reassigned' },
  });

  return outcome;
}

function normalizeSkill(body = {}) {
  const name = String(body.skill_name || '').trim();
  if (!name || name.length > 120) throw new ValidationError('skill_name is required and must be at most 120 characters.');
  const code = String(body.skill_code || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).slice(0, 40);
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code)) throw new ValidationError('skill_code must be 2-40 lowercase letters, numbers, underscores or hyphens.');
  return { skill_code: code, skill_name: name };
}

export async function addGarageStaffSkill(client, actor = {}, userId, body = {}, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const member = await requireCurrentMember(client, tenantId, userId);
  const skill = normalizeSkill(body);

  const { data, error } = await client
    .from('garage_staff_skills')
    .upsert({ tenant_id: tenantId, user_id: member.user_id, ...skill, recorded_by_user_id: actorUserId, recorded_at: new Date().toISOString() }, { onConflict: 'tenant_id,user_id,skill_code' })
    .select()
    .single();
  if (error) throw new DatabaseError(`Could not save staff skill: ${error.message}`);

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_STAFF_SKILL_RECORDED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/staff/:userId/skills',
    targetType: 'garage_staff_skills',
    targetId: `${tenantId}:${member.user_id}:${skill.skill_code}`,
    previous_value: null,
    new_value: data,
  });
  return { skill: data };
}

export async function removeGarageStaffSkill(client, actor = {}, userId, skillCode, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  await requireCurrentMember(client, tenantId, userId);
  const code = String(skillCode || '').trim();
  if (!code) throw new ValidationError('skill code is required.');

  const { data, error } = await client
    .from('garage_staff_skills')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', String(userId))
    .eq('skill_code', code)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not remove staff skill: ${error.message}`);
  if (!data) throw new NotFoundError('Staff skill not found.');

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_STAFF_SKILL_REMOVED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/staff/:userId/skills/:skillCode',
    targetType: 'garage_staff_skills',
    targetId: `${tenantId}:${userId}:${code}`,
    previous_value: data,
    new_value: { removed: true },
  });
  return { removed: true };
}

function normalizeCertification(body = {}) {
  const name = String(body.name || '').trim();
  if (!name || name.length > 160) throw new ValidationError('Certification name is required and must be at most 160 characters.');
  const issued = body.issued_on ? String(body.issued_on).trim() : null;
  const expires = body.expires_on ? String(body.expires_on).trim() : null;
  for (const [label, value] of [['issued_on', issued], ['expires_on', expires]]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${label} must be YYYY-MM-DD.`);
  }
  if (issued && expires && expires < issued) throw new ValidationError('expires_on cannot be before issued_on.');
  return {
    name,
    issuer: cleanText(body.issuer, 160),
    credential_ref: cleanText(body.credential_ref, 200),
    issued_on: issued,
    expires_on: expires,
  };
}

export async function addGarageStaffCertification(client, actor = {}, userId, body = {}, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const member = await requireCurrentMember(client, tenantId, userId);
  const input = normalizeCertification(body);

  const { data, error } = await client
    .from('garage_staff_certifications')
    .insert({ tenant_id: tenantId, user_id: member.user_id, ...input, recorded_by_user_id: actorUserId })
    .select()
    .single();
  if (error) throw new DatabaseError(`Could not add staff certification: ${error.message}`);

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_STAFF_CERTIFICATION_RECORDED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/staff/:userId/certifications',
    targetType: 'garage_staff_certifications',
    targetId: data.id,
    previous_value: null,
    new_value: data,
  });
  return { certification: data };
}

export async function removeGarageStaffCertification(client, actor = {}, userId, certificationId, options = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  await requireCurrentMember(client, tenantId, userId);
  const id = String(certificationId || '').trim();
  if (!id) throw new ValidationError('certification id is required.');

  const { data, error } = await client
    .from('garage_staff_certifications')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', String(userId))
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not remove staff certification: ${error.message}`);
  if (!data) throw new NotFoundError('Staff certification not found.');

  await audit(client, {
    req: options.req,
    event_type: 'GARAGE_STAFF_CERTIFICATION_REMOVED',
    actor_user_id: actorUserId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/operations/staff/:userId/certifications/:certificationId',
    targetType: 'garage_staff_certifications',
    targetId: id,
    previous_value: data,
    new_value: { removed: true },
  });
  return { removed: true };
}

export async function listGarageStaffOperations(client, actor = {}) {
  const tenantId = adminTenant(actor);

  const [
    membersResult,
    usersResult,
    profilesResult,
    branchesResult,
    assignmentsResult,
    departmentsResult,
    skillsResult,
    certificationsResult,
  ] = await Promise.all([
    client.from('tenant_users').select('id, user_id, role, joined_at').eq('tenant_id', tenantId).order('joined_at', { ascending: true }),
    client.from('users').select('id, name, email'),
    client.from('garage_staff_profiles').select('*').eq('tenant_id', tenantId),
    client.from('garage_branches').select('id, name, code, is_active').eq('tenant_id', tenantId),
    client.from('garage_staff_branch_assignments').select('*').eq('tenant_id', tenantId).is('ended_at', null),
    client.from('garage_departments').select('*').eq('tenant_id', tenantId),
    client.from('garage_staff_skills').select('*').eq('tenant_id', tenantId),
    client.from('garage_staff_certifications').select('*').eq('tenant_id', tenantId),
  ]);

  for (const [label, result] of [
    ['members', membersResult],
    ['users', usersResult],
    ['staff profiles', profilesResult],
    ['branches', branchesResult],
    ['branch assignments', assignmentsResult],
    ['departments', departmentsResult],
    ['skills', skillsResult],
    ['certifications', certificationsResult],
  ]) {
    if (result.error) throw new DatabaseError(`Could not load garage ${label}: ${result.error.message}`);
  }

  const members = membersResult.data || [];
  const ids = new Set(members.map((m) => m.user_id));
  const usersById = new Map((usersResult.data || []).filter((u) => ids.has(u.id)).map((u) => [u.id, u]));
  const profileByUser = new Map((profilesResult.data || []).map((p) => [p.user_id, p]));
  const branchById = new Map((branchesResult.data || []).map((b) => [b.id, b]));
  const departmentById = new Map((departmentsResult.data || []).map((d) => [d.id, d]));

  const assignmentsByUser = new Map();
  for (const row of assignmentsResult.data || []) {
    const list = assignmentsByUser.get(row.user_id) || [];
    list.push({ ...row, branch: branchById.get(row.branch_id) || null });
    assignmentsByUser.set(row.user_id, list);
  }
  const skillsByUser = new Map();
  for (const row of skillsResult.data || []) {
    const list = skillsByUser.get(row.user_id) || [];
    list.push(row);
    skillsByUser.set(row.user_id, list);
  }
  const certsByUser = new Map();
  for (const row of certificationsResult.data || []) {
    const list = certsByUser.get(row.user_id) || [];
    list.push(row);
    certsByUser.set(row.user_id, list);
  }

  return {
    staff: members.map((member) => {
      const user = usersById.get(member.user_id);
      const profile = profileByUser.get(member.user_id) || null;
      return {
        membership_id: member.id,
        user_id: member.user_id,
        display_name: user?.name || null,
        email: user?.email || null,
        role: member.role || null,
        joined_at: member.joined_at || null,
        profile,
        department: profile?.department_id ? departmentById.get(profile.department_id) || null : null,
        branch_assignments: assignmentsByUser.get(member.user_id) || [],
        skills: skillsByUser.get(member.user_id) || [],
        certifications: certsByUser.get(member.user_id) || [],
      };
    }),
    branches: branchesResult.data || [],
    departments: departmentsResult.data || [],
  };
}

export default {
  listGarageBranches,
  createGarageBranch,
  updateGarageBranch,
  replaceGarageBranchHours,
  setGarageBranchActive,
  listGarageDepartments,
  createGarageDepartment,
  updateGarageDepartment,
  listGarageStaffOperations,
  upsertGarageStaffProfile,
  assignGarageStaffBranch,
  endGarageStaffBranchAssignment,
  addGarageStaffSkill,
  removeGarageStaffSkill,
  addGarageStaffCertification,
  removeGarageStaffCertification,
};
