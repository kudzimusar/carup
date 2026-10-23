
import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import {
  GARAGE_ADMIN_ROLES,
  GARAGE_WORKSPACE_ROLES,
  requireGarageTenant,
} from '../serviceNetwork/serviceAuthority.js';
import {
  ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError,
} from '../../utils/errors.js';

const TERMINAL = new Set(['declined', 'cancelled', 'fulfilled', 'no_show']);
const GARAGE_STATUS_TARGETS = new Set(['declined', 'cancelled', 'fulfilled', 'no_show']);
const REASON_CODES = new Set(['leave', 'training', 'unavailable', 'other']);

function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}
function workspaceTenant(actor) { return requireGarageTenant(actor, GARAGE_WORKSPACE_ROLES); }
function adminTenant(actor) { return requireGarageTenant(actor, GARAGE_ADMIN_ROLES); }
function tenantRole(actor) { return actor?.activeTenant?.role || null; }

function requiredString(value, label, max = 200) {
  const clean = String(value ?? '').trim();
  if (!clean) throw new ValidationError(label + ' is required');
  if (clean.length > max) throw new ValidationError(label + ' must be at most ' + max + ' characters');
  return clean;
}
function integer(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(label + ' must be an integer between ' + min + ' and ' + max);
  }
  return n;
}
function dateValue(value, label = 'date') {
  const v = requiredString(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError(label + ' must be YYYY-MM-DD');
  return v;
}
function instant(value, label) {
  const v = requiredString(value, label, 80);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError(label + ' must be an ISO timestamp');
  return d.toISOString();
}
function clock(value, label) {
  const v = requiredString(value, label, 8);
  const m = /^(\d{2}):(\d{2})(?::00)?$/.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new ValidationError(label + ' must be HH:MM');
  }
  return m[1] + ':' + m[2];
}
function rpcFailure(error, fallback) {
  const message = String(error?.message || error || '');
  if (/NOT_FOUND|NOT_OWNED/i.test(message)) return new NotFoundError(fallback);
  if (/CAPACITY|LIVE_APPOINTMENT|TERMINAL|REQUIRES_|MUST_BE_ACCEPTED|BLOCK_/i.test(message)) {
    return new ConflictError(message.replace(/^.*GARAGE_OPS03_/, '').replaceAll('_', ' ').trim() || fallback);
  }
  if (/ADMIN_REQUIRED|REQUESTER_CANCELLATION_NOT_ALLOWED/i.test(message)) return new ForbiddenError(fallback);
  if (/GARAGE_OPS03_/i.test(message)) {
    return new ValidationError(message.replace(/^.*GARAGE_OPS03_/, '').replaceAll('_', ' ').trim() || fallback);
  }
  return new DatabaseError(fallback + ': ' + (message || 'database error'));
}
async function requiredAudit(client, actor, eventType, previousValue, newValue, sourceRoute) {
  const result = await logAuditEvent(client, {
    event_type: eventType,
    actor_user_id: actorId(actor),
    actor_role: actor.role,
    actor_tenant_id: adminTenant(actor),
    source_route: sourceRoute,
    previous_value: previousValue ?? null,
    new_value: newValue ?? null,
  });
  if (!result.success) {
    throw new DatabaseError('Scheduling audit failed: ' + (result.error || result.fallbackError || 'unknown error'));
  }
}

async function requesterCase(client, actor, caseId) {
  const userId = actorId(actor);
  const id = requiredString(caseId, 'service case id', 80);
  const { data, error } = await client.from('service_cases')
    .select('id, garage_tenant_id, branch_id, requester_user_id, status, vin, service_category')
    .eq('id', id).eq('requester_user_id', userId).maybeSingle();
  if (error) throw new DatabaseError('Could not load service case: ' + error.message);
  if (!data) throw new NotFoundError('Service case not found');
  return data;
}

async function activeBranch(client, tenantId, branchId) {
  const id = requiredString(branchId, 'branch_id', 80);
  const { data, error } = await client.from('garage_branches')
    .select('id, tenant_id, name, branch_code, timezone, is_active')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new DatabaseError('Could not load Garage site: ' + error.message);
  if (!data || data.is_active !== true) throw new ValidationError('That Garage site is not active');
  return data;
}

async function schedulingSettings(client, tenantId, branchId) {
  const { data, error } = await client.from('garage_branch_scheduling_settings')
    .select('*').eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle();
  if (error) throw new DatabaseError('Could not load scheduling settings: ' + error.message);
  return data || null;
}

function appointmentView(row) {
  if (!row) return null;
  return {
    id: row.id,
    service_case_id: row.service_case_id,
    branch_id: row.branch_id,
    status: row.status,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    appointment_timezone: row.appointment_timezone,
    planned_workforce_profile_id: row.planned_workforce_profile_id || null,
    requested_by_user_id: row.requested_by_user_id,
    confirmed_at: row.confirmed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getRequesterAppointmentAvailability(
  client = defaultClient, actor = {}, caseId, query = {},
) {
  const serviceCase = await requesterCase(client, actor, caseId);
  const branchId = requiredString(query.branch_id || serviceCase.branch_id, 'branch_id', 80);
  const branch = await activeBranch(client, serviceCase.garage_tenant_id, branchId);
  if (serviceCase.branch_id && serviceCase.branch_id !== branch.id) {
    throw new ValidationError('The appointment branch must match this Service Case');
  }

  const localDate = dateValue(query.date);
  const durationMinutes = integer(query.duration_minutes, 'duration_minutes', { min: 5, max: 720 });
  if (!branch.timezone) {
    return {
      configured: false,
      reason: 'Schedule timezone not configured',
      branch: { id: branch.id, name: branch.name, timezone: null },
      date: localDate,
      duration_minutes: durationMinutes,
      slots: [],
    };
  }

  const settings = await schedulingSettings(client, serviceCase.garage_tenant_id, branch.id);
  if (!settings) {
    return {
      configured: false,
      reason: 'Scheduling not configured',
      branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
      date: localDate,
      duration_minutes: durationMinutes,
      slots: [],
    };
  }
  if (!settings.scheduling_enabled) {
    return {
      configured: true,
      enabled: false,
      reason: 'Scheduling is disabled for this site',
      branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
      date: localDate,
      duration_minutes: durationMinutes,
      slot_interval_minutes: settings.slot_interval_minutes,
      capacity: settings.max_concurrent_appointments,
      slots: [],
    };
  }

  const { data, error } = await client.rpc('garage_ops03_list_availability', {
    p_tenant_id: serviceCase.garage_tenant_id,
    p_service_case_id: serviceCase.id,
    p_branch_id: branch.id,
    p_local_date: localDate,
    p_duration_minutes: durationMinutes,
  });
  if (error) throw rpcFailure(error, 'Could not calculate appointment availability');

  const slots = (data || []).map((row) => ({
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    appointment_timezone: row.appointment_timezone,
    branch_capacity: Number(row.branch_capacity),
    booked_count: Number(row.booked_count),
    available_count: Number(row.available_count),
    bookable: Number(row.available_count) > 0,
  }));

  return {
    configured: true,
    enabled: true,
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    date: localDate,
    duration_minutes: durationMinutes,
    slot_interval_minutes: settings.slot_interval_minutes,
    capacity: settings.max_concurrent_appointments,
    slots,
  };
}

export async function requestAppointment(client = defaultClient, actor = {}, caseId, body = {}) {
  const serviceCase = await requesterCase(client, actor, caseId);
  const branchId = requiredString(body.branch_id || serviceCase.branch_id, 'branch_id', 80);
  const startsAt = instant(body.starts_at, 'starts_at');
  const endsAt = instant(body.ends_at, 'ends_at');
  if (startsAt >= endsAt) throw new ValidationError('ends_at must be after starts_at');

  const { data, error } = await client.rpc('garage_ops03_request_appointment', {
    p_service_case_id: serviceCase.id,
    p_branch_id: branchId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_actor_user_id: actorId(actor),
  });
  if (error) throw rpcFailure(error, 'Could not request appointment');
  return { appointment: appointmentView(Array.isArray(data) ? data[0] : data) };
}

export async function listRequesterAppointments(client = defaultClient, actor = {}) {
  const userId = actorId(actor);
  const { data, error } = await client.from('garage_appointments')
    .select('*').eq('requested_by_user_id', userId).order('created_at', { ascending: false }).limit(200);
  if (error) throw new DatabaseError('Could not load appointments: ' + error.message);
  return { appointments: (data || []).map(appointmentView), total: (data || []).length };
}

export async function cancelRequesterAppointment(
  client = defaultClient, actor = {}, caseId, appointmentId,
) {
  const serviceCase = await requesterCase(client, actor, caseId);
  const { data: appointment, error: readError } = await client.from('garage_appointments')
    .select('id, service_case_id').eq('id', String(appointmentId)).eq('service_case_id', serviceCase.id).maybeSingle();
  if (readError) throw new DatabaseError('Could not load appointment: ' + readError.message);
  if (!appointment) throw new NotFoundError('Appointment not found');

  const { data, error } = await client.rpc('garage_ops03_transition_appointment', {
    p_appointment_id: appointment.id,
    p_target_status: 'cancelled',
    p_actor_user_id: actorId(actor),
    p_actor_scope: 'requester',
    p_tenant_id: null,
  });
  if (error) throw rpcFailure(error, 'Could not cancel appointment');
  return { appointment: appointmentView(Array.isArray(data) ? data[0] : data) };
}

export async function getGarageSchedule(client = defaultClient, actor = {}, query = {}) {
  const tenantId = workspaceTenant(actor);
  let builder = client.from('garage_appointments').select('*').eq('tenant_id', tenantId);

  const status = String(query.status || '').trim();
  if (status) builder = builder.eq('status', status);
  const branchId = String(query.branch_id || '').trim();
  if (branchId) builder = builder.eq('branch_id', branchId);
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  if (from) builder = builder.gte('starts_at', instant(from, 'from'));
  if (to) builder = builder.lt('starts_at', instant(to, 'to'));

  const role = tenantRole(actor);
  if (role === 'mechanic') {
    const { data: profile, error: profileError } = await client.from('garage_workforce_profiles')
      .select('id').eq('tenant_id', tenantId).eq('user_id', actorId(actor))
      .eq('employment_status', 'active').maybeSingle();
    if (profileError) throw new DatabaseError('Could not load mechanic schedule identity: ' + profileError.message);
    if (!profile) return { appointments: [], unscheduled_cases: [], total: 0, scope: 'planned_for_me' };
    builder = builder.eq('planned_workforce_profile_id', profile.id);
  }

  const { data: appointments, error } = await builder.order('starts_at', { ascending: true }).limit(300);
  if (error) throw new DatabaseError('Could not load Garage schedule: ' + error.message);

  const rows = appointments || [];
  const caseIds = [...new Set(rows.map((a) => a.service_case_id))];
  const branchIds = [...new Set(rows.map((a) => a.branch_id))];
  const profileIds = [...new Set(rows.map((a) => a.planned_workforce_profile_id).filter(Boolean))];

  const [caseRead, branchRead, profileRead] = await Promise.all([
    caseIds.length
      ? client.from('service_cases').select('id,vin,requester_user_id,service_category,status').in('id', caseIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length
      ? client.from('garage_branches').select('id,name,branch_code,timezone').eq('tenant_id', tenantId).in('id', branchIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? client.from('garage_workforce_profiles').select('id,user_id,staff_code').eq('tenant_id', tenantId).in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (caseRead.error) throw new DatabaseError('Could not load scheduled Service Cases: ' + caseRead.error.message);
  if (branchRead.error) throw new DatabaseError('Could not load scheduled Garage sites: ' + branchRead.error.message);
  if (profileRead.error) throw new DatabaseError('Could not load planned workforce: ' + profileRead.error.message);

  const cases = caseRead.data || [];
  const requesterIds = [...new Set(cases.map((c) => c.requester_user_id).filter(Boolean))];
  const vins = [...new Set(cases.map((c) => c.vin).filter(Boolean))];
  const workerUserIds = [...new Set((profileRead.data || []).map((p) => p.user_id).filter(Boolean))];
  const allUserIds = [...new Set([...requesterIds, ...workerUserIds])];

  const [userRead, vehicleRead] = await Promise.all([
    allUserIds.length
      ? client.from('users').select('id,name').in('id', allUserIds)
      : Promise.resolve({ data: [], error: null }),
    vins.length
      ? client.from('vehicles').select('vin,make,model,year').in('vin', vins)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (userRead.error) throw new DatabaseError('Could not load schedule identities: ' + userRead.error.message);
  if (vehicleRead.error) throw new DatabaseError('Could not load schedule vehicles: ' + vehicleRead.error.message);

  const caseById = new Map(cases.map((x) => [x.id, x]));
  const branchById = new Map((branchRead.data || []).map((x) => [x.id, x]));
  const profileById = new Map((profileRead.data || []).map((x) => [x.id, x]));
  const nameById = new Map((userRead.data || []).map((x) => [x.id, x.name || null]));
  const vehicleByVin = new Map((vehicleRead.data || []).map((x) => [x.vin, x]));

  const schedule = rows.map((a) => {
    const serviceCase = caseById.get(a.service_case_id) || null;
    const profile = a.planned_workforce_profile_id ? profileById.get(a.planned_workforce_profile_id) || null : null;
    return {
      ...appointmentView(a),
      service_case: serviceCase ? {
        id: serviceCase.id,
        status: serviceCase.status,
        vin: serviceCase.vin,
        service_category: serviceCase.service_category || null,
        requester_name: serviceCase.requester_user_id ? nameById.get(serviceCase.requester_user_id) || null : null,
      } : null,
      vehicle: serviceCase ? vehicleByVin.get(serviceCase.vin) || null : null,
      branch: branchById.get(a.branch_id) || null,
      planned_workforce: profile ? {
        profile_id: profile.id,
        user_id: profile.user_id,
        staff_code: profile.staff_code,
        display_name: nameById.get(profile.user_id) || null,
      } : null,
    };
  });

  let unscheduledCases = [];
  if (role === 'admin') {
    const { data: openCases, error: casesError } = await client.from('service_cases')
      .select('id,vin,status,service_category,branch_id,requester_user_id,requested_at')
      .eq('garage_tenant_id', tenantId).in('status', ['requested', 'accepted']).limit(200);
    if (casesError) throw new DatabaseError('Could not load unscheduled Service Cases: ' + casesError.message);
    const activeCaseIds = new Set(rows.filter((a) => !TERMINAL.has(a.status)).map((a) => a.service_case_id));
    unscheduledCases = (openCases || []).filter((c) => !activeCaseIds.has(c.id));
  }

  return {
    appointments: schedule,
    unscheduled_cases: unscheduledCases,
    total: schedule.length,
    scope: role === 'mechanic' ? 'planned_for_me' : 'garage',
  };
}

export async function getGarageSchedulingConfiguration(client = defaultClient, actor = {}) {
  const tenantId = adminTenant(actor);
  const [sitesRead, settingsRead, profilesRead, assignmentsRead, schedulesRead, unavailableRead, membershipsRead] = await Promise.all([
    client.from('garage_branches').select('id,name,branch_code,timezone,is_active').eq('tenant_id', tenantId).order('name'),
    client.from('garage_branch_scheduling_settings').select('*').eq('tenant_id', tenantId),
    client.from('garage_workforce_profiles').select('id,user_id,staff_code,employment_status').eq('tenant_id', tenantId),
    client.from('garage_workforce_branch_assignments').select('workforce_profile_id,branch_id,ended_at,is_primary').eq('tenant_id', tenantId).is('ended_at', null),
    client.from('garage_workforce_schedules').select('*').eq('tenant_id', tenantId).order('day_of_week'),
    client.from('garage_workforce_unavailability').select('*').eq('tenant_id', tenantId).order('starts_at'),
    client.from('tenant_users').select('user_id,role').eq('tenant_id', tenantId),
  ]);
  for (const [label, read] of [
    ['sites', sitesRead], ['settings', settingsRead], ['workforce', profilesRead],
    ['assignments', assignmentsRead], ['work schedules', schedulesRead],
    ['unavailability', unavailableRead], ['memberships', membershipsRead],
  ]) {
    if (read.error) throw new DatabaseError('Could not load scheduling ' + label + ': ' + read.error.message);
  }

  const profileRows = profilesRead.data || [];
  const memberById = new Map((membershipsRead.data || []).map((m) => [m.user_id, m.role]));
  const activeUserIds = profileRows.filter((p) => p.employment_status === 'active').map((p) => p.user_id);
  const { data: names, error: namesError } = activeUserIds.length
    ? await client.from('users').select('id,name').in('id', activeUserIds)
    : { data: [], error: null };
  if (namesError) throw new DatabaseError('Could not load workforce names: ' + namesError.message);
  const nameById = new Map((names || []).map((u) => [u.id, u.name || null]));

  return {
    sites: (sitesRead.data || []).map((s) => ({
      ...s,
      settings: (settingsRead.data || []).find((x) => x.branch_id === s.id) || null,
    })),
    workforce: profileRows.map((p) => ({
      ...p,
      display_name: nameById.get(p.user_id) || null,
      tenant_role: memberById.get(p.user_id) || null,
      live_branch_ids: (assignmentsRead.data || []).filter((a) => a.workforce_profile_id === p.id).map((a) => a.branch_id),
      schedules: (schedulesRead.data || []).filter((x) => x.workforce_profile_id === p.id),
      unavailability: (unavailableRead.data || []).filter((x) => x.workforce_profile_id === p.id),
    })),
  };
}

export async function updateBranchSchedulingSettings(
  client = defaultClient, actor = {}, siteId, body = {},
) {
  const tenantId = adminTenant(actor);
  const site = await activeBranch(client, tenantId, siteId);
  if (!site.timezone) throw new ValidationError('Schedule timezone not configured');

  if (typeof body.scheduling_enabled !== 'boolean') {
    throw new ValidationError('scheduling_enabled must be explicitly true or false');
  }
  const capacity = integer(body.max_concurrent_appointments, 'max_concurrent_appointments', { min: 1, max: 100 });
  const interval = integer(body.slot_interval_minutes, 'slot_interval_minutes', { min: 5, max: 240 });
  if (1440 % interval !== 0) throw new ValidationError('slot_interval_minutes must divide a 24-hour day');

  const previous = await schedulingSettings(client, tenantId, site.id);
  const row = {
    branch_id: site.id,
    tenant_id: tenantId,
    scheduling_enabled: body.scheduling_enabled,
    max_concurrent_appointments: capacity,
    slot_interval_minutes: interval,
    updated_by_user_id: actorId(actor),
  };
  const { data, error } = await client.from('garage_branch_scheduling_settings')
    .upsert(row, { onConflict: 'branch_id' }).select('*').single();
  if (error) throw new DatabaseError('Could not save scheduling settings: ' + error.message);

  await requiredAudit(client, actor, 'GARAGE_BRANCH_SCHEDULING_UPDATED',
    previous ? {
      branch_id: site.id,
      scheduling_enabled: previous.scheduling_enabled,
      max_concurrent_appointments: previous.max_concurrent_appointments,
      slot_interval_minutes: previous.slot_interval_minutes,
    } : null,
    {
      branch_id: site.id,
      scheduling_enabled: data.scheduling_enabled,
      max_concurrent_appointments: data.max_concurrent_appointments,
      slot_interval_minutes: data.slot_interval_minutes,
    },
    '/api/garage/schedule/sites/:siteId/settings',
  );
  return { settings: data };
}

async function workforceForUser(client, tenantId, userId) {
  const target = requiredString(userId, 'user id', 120);
  const { data, error } = await client.from('garage_workforce_profiles')
    .select('id,user_id,staff_code,employment_status')
    .eq('tenant_id', tenantId).eq('user_id', target).maybeSingle();
  if (error) throw new DatabaseError('Could not load workforce profile: ' + error.message);
  if (!data || data.employment_status !== 'active') throw new ValidationError('An active workforce profile is required');
  return data;
}

export async function addWorkforceRecurringSchedule(
  client = defaultClient, actor = {}, userId, body = {},
) {
  const tenantId = adminTenant(actor);
  const profile = await workforceForUser(client, tenantId, userId);
  const branch = await activeBranch(client, tenantId, body.branch_id);
  const day = integer(body.day_of_week, 'day_of_week', { min: 0, max: 6 });
  const startsAt = clock(body.starts_at, 'starts_at');
  const endsAt = clock(body.ends_at, 'ends_at');
  if (startsAt >= endsAt) throw new ValidationError('ends_at must be after starts_at');
  const effectiveFrom = dateValue(body.effective_from, 'effective_from');
  const effectiveUntil = body.effective_until ? dateValue(body.effective_until, 'effective_until') : null;
  if (effectiveUntil && effectiveUntil < effectiveFrom) throw new ValidationError('effective_until cannot be before effective_from');

  const { data: live, error: liveError } = await client.from('garage_workforce_branch_assignments')
    .select('branch_id').eq('tenant_id', tenantId).eq('workforce_profile_id', profile.id)
    .eq('branch_id', branch.id).is('ended_at', null).maybeSingle();
  if (liveError) throw new DatabaseError('Could not verify workforce site assignment: ' + liveError.message);
  if (!live) throw new ValidationError('The workforce member needs a live assignment to this site');

  const row = {
    tenant_id: tenantId,
    workforce_profile_id: profile.id,
    branch_id: branch.id,
    day_of_week: day,
    starts_at: startsAt,
    ends_at: endsAt,
    effective_from: effectiveFrom,
    effective_until: effectiveUntil,
    created_by_user_id: actorId(actor),
  };
  const { data, error } = await client.from('garage_workforce_schedules').insert(row).select('*').single();
  if (error) throw new DatabaseError('Could not add workforce schedule: ' + error.message);
  await requiredAudit(client, actor, 'GARAGE_WORKFORCE_SCHEDULE_UPDATED', null, {
    schedule_id: data.id,
    workforce_profile_id: profile.id,
    branch_id: branch.id,
    day_of_week: day,
    starts_at: startsAt,
    ends_at: endsAt,
    effective_from: effectiveFrom,
    effective_until: effectiveUntil,
  }, '/api/garage/schedule/workforce/:userId/recurring');
  return { schedule: data };
}

export async function addWorkforceUnavailability(
  client = defaultClient, actor = {}, userId, body = {},
) {
  const tenantId = adminTenant(actor);
  const profile = await workforceForUser(client, tenantId, userId);
  const startsAt = instant(body.starts_at, 'starts_at');
  const endsAt = instant(body.ends_at, 'ends_at');
  if (startsAt >= endsAt) throw new ValidationError('ends_at must be after starts_at');
  const reason = body.reason_code == null || body.reason_code === '' ? null : String(body.reason_code);
  if (reason && !REASON_CODES.has(reason)) throw new ValidationError('Unknown unavailability reason_code');

  const row = {
    tenant_id: tenantId,
    workforce_profile_id: profile.id,
    starts_at: startsAt,
    ends_at: endsAt,
    reason_code: reason,
    created_by_user_id: actorId(actor),
  };
  const { data, error } = await client.from('garage_workforce_unavailability').insert(row).select('*').single();
  if (error) throw new DatabaseError('Could not add workforce unavailability: ' + error.message);
  await requiredAudit(client, actor, 'GARAGE_WORKFORCE_UNAVAILABILITY_CHANGED', null, {
    unavailability_id: data.id,
    workforce_profile_id: profile.id,
    starts_at: startsAt,
    ends_at: endsAt,
    reason_code: reason,
  }, '/api/garage/schedule/workforce/:userId/unavailability');
  return { unavailability: data };
}

async function adminAppointmentRpc(client, actor, functionName, appointmentId, body = {}) {
  const tenantId = adminTenant(actor);
  const params = {
    p_tenant_id: tenantId,
    p_appointment_id: requiredString(appointmentId, 'appointment id', 80),
    p_branch_id: requiredString(body.branch_id, 'branch_id', 80),
    p_starts_at: instant(body.starts_at, 'starts_at'),
    p_ends_at: instant(body.ends_at, 'ends_at'),
    p_planned_workforce_profile_id: requiredString(body.planned_workforce_profile_id, 'planned_workforce_profile_id', 80),
    p_actor_user_id: actorId(actor),
  };
  if (params.p_starts_at >= params.p_ends_at) throw new ValidationError('ends_at must be after starts_at');
  const { data, error } = await client.rpc(functionName, params);
  if (error) throw rpcFailure(error, 'Could not update appointment schedule');
  return { appointment: appointmentView(Array.isArray(data) ? data[0] : data) };
}

export async function confirmGarageAppointment(client = defaultClient, actor = {}, appointmentId, body = {}) {
  return adminAppointmentRpc(client, actor, 'garage_ops03_confirm_appointment', appointmentId, body);
}

export async function rescheduleGarageAppointment(client = defaultClient, actor = {}, appointmentId, body = {}) {
  return adminAppointmentRpc(client, actor, 'garage_ops03_reschedule_appointment', appointmentId, body);
}

export async function transitionGarageAppointment(
  client = defaultClient, actor = {}, appointmentId, targetStatus,
) {
  const tenantId = adminTenant(actor);
  const status = requiredString(targetStatus, 'status', 30);
  if (!GARAGE_STATUS_TARGETS.has(status)) throw new ValidationError('Unsupported appointment status transition');
  const { data, error } = await client.rpc('garage_ops03_transition_appointment', {
    p_appointment_id: requiredString(appointmentId, 'appointment id', 80),
    p_target_status: status,
    p_actor_user_id: actorId(actor),
    p_actor_scope: 'garage',
    p_tenant_id: tenantId,
  });
  if (error) throw rpcFailure(error, 'Could not change appointment status');
  return { appointment: appointmentView(Array.isArray(data) ? data[0] : data) };
}
