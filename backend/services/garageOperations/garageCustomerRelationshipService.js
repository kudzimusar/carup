import { getGarageCustomers } from '../serviceNetwork/garageQueueService.js';
import { sumMoney } from '../../utils/garageMoney.js';
import { isAbsentRelation } from '../../utils/schemaPresence.js';
import { GARAGE_ADMIN_ROLES, GARAGE_WORKSPACE_ROLES, requireGarageTenant } from '../serviceNetwork/serviceAuthority.js';
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';

const STATUSES = new Set(['active', 'inactive', 'prospect']);
const CATEGORIES = new Set(['individual', 'business', 'fleet', 'other']);
const FOLLOW_UP = new Set(['pending', 'completed', 'cancelled']);
const EDITABLE = new Set([
  'relationship_status', 'customer_category', 'preferred_branch_id', 'assigned_staff_user_id',
  'internal_notes', 'tags', 'follow_up_at', 'follow_up_status',
]);

function actorId(actor) {
  const id = actor?.id || actor?.userId;
  if (!id) throw new ValidationError('An authenticated actor is required');
  return id;
}
function failure(label, error) {
  if (error?.code === '23505') throw new ConflictError(`${label}: relationship already exists`);
  throw new DatabaseError(`${label}: ${error?.message || 'database error'}`);
}
async function rows(query, label) {
  const { data, error } = await query;
  if (error) failure(label, error);
  return data || [];
}
function publicMetadata(row, { includeNotes = true, preferredSiteName = null, assignedStaffName = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    customer_reference_code: row.customer_reference_code,
    relationship_status: row.relationship_status,
    customer_category: row.customer_category,
    preferred_branch_id: row.preferred_branch_id,
    assigned_staff_user_id: row.assigned_staff_user_id,
    internal_notes: includeNotes ? row.internal_notes : null,
    notes_available: includeNotes,
    preferred_site_name: preferredSiteName,
    assigned_staff_name: assignedStaffName,
    tags: row.tags || [],
    first_relationship_at: row.first_relationship_at,
    follow_up_at: row.follow_up_at,
    follow_up_status: row.follow_up_status,
  };
}
async function relationships(client, tenantId) {
  return rows(client.from('garage_customer_relationships').select('*').eq('tenant_id', tenantId), 'Failed to load relationships');
}
async function registeredCaseRows(client, tenantId, userId) {
  return rows(client.from('service_cases').select('*')
    .eq('garage_tenant_id', tenantId).eq('requester_user_id', userId)
    .order('requested_at', { ascending: true }), 'Failed to load customer service history');
}
async function prospectNameByIdentity(client, entries, tenantId) {
  const ids = entries.filter((r) => r.external_identity_id).map((r) => r.external_identity_id);
  if (!ids.length) return new Map();
  const identities = await rows(client.from('channel_identities').select('id, tenant_id, display_name, user_id')
    .in('id', ids).eq('tenant_id', tenantId).is('user_id', null), 'Failed to load external identity labels');
  return new Map(identities.map((r) => [r.id, r]));
}

export async function listGarageCustomerRelationships(client, actor) {
  const tenantId = requireGarageTenant(actor, GARAGE_WORKSPACE_ROLES);
  const [projection, metadata] = await Promise.all([
    getGarageCustomers(client, actor), relationships(client, tenantId),
  ]);
  const byUser = new Map(metadata.filter((r) => r.registered_user_id).map((r) => [r.registered_user_id, r]));
  const sites = await rows(client.from('garage_branches').select('id, name').eq('tenant_id', tenantId), 'Failed to load preferred site labels');
  const siteNameById = new Map(sites.map((site) => [site.id, site.name]));
  const staffIds = [...new Set(metadata.map((r) => r.assigned_staff_user_id).filter(Boolean))];
  const staff = staffIds.length ? await rows(client.from('users').select('id, name').in('id', staffIds), 'Failed to load advisor labels') : [];
  const staffNameById = new Map(staff.map((person) => [person.id, person.name]));
  const metadataFor = (row) => publicMetadata(row, {
    includeNotes: actor.activeTenant?.role === 'admin',
    preferredSiteName: siteNameById.get(row?.preferred_branch_id) || null,
    assignedStaffName: staffNameById.get(row?.assigned_staff_user_id) || null,
  });
  const customers = projection.customers.map((c) => ({
    ...c,
    customer_id: `registered:${c.user_id}`,
    party_kind: 'registered',
    relationship: metadataFor(byUser.get(c.user_id)),
  }));
  // An external contact or walk-in is a prospect, never a fabricated CarUp customer.
  const identityById = await prospectNameByIdentity(client, metadata, tenantId);
  const prospects = metadata.filter((r) => r.party_kind !== 'registered').map((r) => ({
    customer_id: `relationship:${r.id}`,
    party_kind: r.party_kind,
    display_name: r.party_kind === 'walk_in'
      ? r.prospect_name : (identityById.get(r.external_identity_id)?.display_name || null),
    identity_status: 'Garage prospect; CarUp identity not verified',
    relationship: metadataFor(r),
    vehicle_count: 0,
    case_count: 0,
    completed_count: 0,
    last_service_at: null,
    spend_by_currency: {},
    conversation_thread_id: null,
  }));
  return { customers, prospects, total: customers.length, prospect_total: prospects.length };
}

async function resolveParty(client, actor, customerId) {
  const tenantId = requireGarageTenant(actor, GARAGE_WORKSPACE_ROLES);
  if (customerId.startsWith('registered:')) {
    const userId = customerId.slice('registered:'.length);
    if (!userId || userId.length > 128) throw new NotFoundError('Customer not found');
    const cases = await registeredCaseRows(client, tenantId, userId);
    if (!cases.length) throw new NotFoundError('Customer not found');
    const [relationship] = await rows(client.from('garage_customer_relationships').select('*')
      .eq('tenant_id', tenantId).eq('registered_user_id', userId).limit(1), 'Failed to load relationship');
    const [user] = await rows(client.from('users').select('id, name').eq('id', userId).limit(1), 'Failed to load customer identity');
    return { tenantId, userId, cases, relationship: relationship || null, displayName: user?.name || null, partyKind: 'registered' };
  }
  if (customerId.startsWith('relationship:')) {
    const id = customerId.slice('relationship:'.length);
    const [relationship] = await rows(client.from('garage_customer_relationships').select('*')
      .eq('tenant_id', tenantId).eq('id', id).limit(1), 'Failed to load relationship');
    if (!relationship || relationship.party_kind === 'registered') throw new NotFoundError('Customer not found');
    const identityById = await prospectNameByIdentity(client, [relationship], tenantId);
    return {
      tenantId, userId: null, cases: [], relationship,
      displayName: relationship.prospect_name || identityById.get(relationship.external_identity_id)?.display_name || null,
      partyKind: relationship.party_kind,
    };
  }
  throw new NotFoundError('Customer not found');
}

export async function getGarageCustomerDetail(client, actor, customerId) {
  const party = await resolveParty(client, actor, customerId);
  const { cases, tenantId, userId } = party;
  const [preferredSite] = party.relationship?.preferred_branch_id
    ? await rows(client.from('garage_branches').select('id, name').eq('tenant_id', tenantId)
      .eq('id', party.relationship.preferred_branch_id).limit(1), 'Failed to load preferred site') : [];
  const [assignedStaff] = party.relationship?.assigned_staff_user_id
    ? await rows(client.from('users').select('id, name').eq('id', party.relationship.assigned_staff_user_id)
      .limit(1), 'Failed to load advisor label') : [];
  const caseIds = cases.map((c) => c.id);
  const vins = [...new Set(cases.map((c) => c.vin).filter(Boolean))];
  const workOrders = caseIds.length ? await rows(client.from('mechanic_work_orders')
    .select('id, service_case_id, status, created_at, completed_at, cancelled_at')
    .eq('tenant_id', tenantId).in('service_case_id', caseIds), 'Failed to load work orders') : [];
  const serviceRecords = caseIds.length ? await rows(client.from('service_records')
    .select('id, service_case_id, work_order_id, vin, service_category, total_cost, currency, performed_at, created_at')
    .eq('tenant_id', tenantId).in('service_case_id', caseIds), 'Failed to load service records') : [];
  const canonical = vins.length ? await rows(client.from('vehicles')
    .select('vin, make, model, year, owner_id').in('vin', vins), 'Failed to load canonical vehicles') : [];
  const vehicleByVin = new Map(canonical.map((v) => [v.vin, v]));
  const vehicles = vins.map((vin) => {
    const v = vehicleByVin.get(vin);
    const relatedCases = cases.filter((c) => c.vin === vin);
    return {
      vin,
      make: v?.make || null, model: v?.model || null, year: v?.year || null,
      relationship_basis: 'service_requester',
      canonical_owner_recorded: Boolean(v?.owner_id),
      canonical_owner_is_customer: Boolean(userId && v?.owner_id === userId),
      case_count: relatedCases.length,
      last_service_at: relatedCases.map((c) => c.completed_at || c.requested_at).filter(Boolean).sort().at(-1) || null,
      open_case_count: relatedCases.filter((c) => ['requested', 'accepted', 'active'].includes(c.status)).length,
    };
  });
  const [projection] = userId ? (await getGarageCustomers(client, actor)).customers.filter((c) => c.user_id === userId) : [];
  return {
    customer: {
      customer_id: customerId,
      party_kind: party.partyKind,
      display_name: party.displayName,
      identity_status: userId ? 'CarUp account' : 'Garage prospect; CarUp identity not verified',
      relationship: publicMetadata(party.relationship, {
        includeNotes: actor.activeTenant?.role === 'admin', preferredSiteName: preferredSite?.name || null,
        assignedStaffName: assignedStaff?.name || null,
      }),
      spend_by_currency: projection?.spend_by_currency || {},
      conversation_thread_id: projection?.conversation_thread_id || null,
    },
    vehicles,
    cases: cases.map((c) => ({
      id: c.id, vin: c.vin, status: c.status, service_category: c.service_category,
      requested_at: c.requested_at, completed_at: c.completed_at, branch_id: c.branch_id,
    })),
    work_orders: workOrders,
    service_records: serviceRecords,
    // GARAGE-1.0: the commercial history, from the estimate / invoice / payment-record authorities.
    // Money is a garage-admin matter, so a mechanic's view of the customer carries none of it.
    commercial: actor.activeTenant?.role === 'admin' ? await commercialHistorySafe(client, tenantId, caseIds) : null,
  };
}

/** The commercial tables are newer than this surface: where they are not deployed yet it contributes nothing. */
async function commercialHistorySafe(client, tenantId, caseIds) {
  try {
    return await commercialHistory(client, tenantId, caseIds);
  } catch (error) {
    if (isAbsentRelation(error)) return null;
    throw error;
  }
}

/** Estimates, invoices and what the garage recorded as received — per case, per currency, never mixed. */
async function commercialHistory(client, tenantId, caseIds) {
  if (!caseIds.length) return { estimates: [], invoices: [], outstanding_by_currency: [], note: COMMERCIAL_NOTE };
  const estimates = await rows(client.from('garage_estimates')
    .select('id, service_case_id, version, status, currency, sent_total_amount, sent_at, decided_at')
    .eq('tenant_id', tenantId).in('service_case_id', caseIds).order('version', { ascending: false }), 'Failed to load estimates');
  const invoices = await rows(client.from('garage_invoices')
    .select('id, service_case_id, invoice_number, status, currency, total_amount, issued_at')
    .eq('tenant_id', tenantId).in('service_case_id', caseIds).order('issued_at', { ascending: false }), 'Failed to load invoices');
  const payments = invoices.length ? await rows(client.from('garage_payment_records')
    .select('invoice_id, kind, amount').eq('tenant_id', tenantId).in('invoice_id', invoices.map((i) => i.id)), 'Failed to load payment records') : [];
  const net = new Map();
  for (const p of payments) {
    net.set(p.invoice_id, (net.get(p.invoice_id) || 0) + Math.round(Number(p.amount) * 100) * (p.kind === 'payment' ? 1 : -1));
  }
  const outstanding = new Map();
  const invoiceViews = invoices.map((i) => {
    const total = Math.round(Number(i.total_amount) * 100);
    const paid = net.get(i.id) || 0;
    const status = i.status === 'voided' ? 'voided' : (paid <= 0 ? 'unpaid' : (paid < total ? 'partially_paid' : 'paid'));
    if (i.status === 'issued' && total - paid > 0) outstanding.set(i.currency, [...(outstanding.get(i.currency) || []), ((total - paid) / 100).toFixed(2)]);
    return {
      id: i.id, service_case_id: i.service_case_id, invoice_number: i.invoice_number, status: i.status,
      currency: i.currency, total_amount: i.total_amount, issued_at: i.issued_at, payment_status: status,
      paid_amount: (Math.max(paid, 0) / 100).toFixed(2),
    };
  });
  return {
    estimates: estimates.filter((e) => e.sent_at).map((e) => ({
      id: e.id, service_case_id: e.service_case_id, version: e.version, status: e.status, currency: e.currency,
      total_amount: e.sent_total_amount, decided_at: e.decided_at,
    })),
    invoices: invoiceViews,
    outstanding_by_currency: [...outstanding.entries()].map(([currency, vals]) => ({ currency, balance: sumMoney(vals, currency) })),
    note: COMMERCIAL_NOTE,
  };
}
const COMMERCIAL_NOTE = 'Invoices are documents and the payments shown are ones this garage recorded off-platform that CarUp has not verified: they are not proof of paid revenue.';

async function validateSiteAndAdvisor(client, tenantId, changes) {
  if (changes.preferred_branch_id) {
    const site = await rows(client.from('garage_branches').select('id').eq('id', changes.preferred_branch_id)
      .eq('tenant_id', tenantId).eq('is_active', true).limit(1), 'Failed to verify preferred site');
    if (!site.length) throw new ValidationError('Preferred site must be active in this Garage');
  }
  if (changes.assigned_staff_user_id) {
    const profile = await rows(client.from('garage_workforce_profiles').select('id')
      .eq('tenant_id', tenantId).eq('user_id', changes.assigned_staff_user_id)
      .eq('employment_status', 'active').limit(1), 'Failed to verify service advisor');
    const membership = await rows(client.from('tenant_users').select('id')
      .eq('tenant_id', tenantId).eq('user_id', changes.assigned_staff_user_id).limit(1), 'Failed to verify advisor membership');
    if (!profile.length || !membership.length) throw new ValidationError('Service advisor must be active in this Garage');
  }
}
function normalizeChanges(body, before) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Relationship changes are required');
  for (const key of Object.keys(body)) if (!EDITABLE.has(key)) throw new ValidationError(`${key} cannot be changed here`);
  if (!Object.keys(body).length) throw new ValidationError('At least one change is required');
  const changes = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'relationship_status') {
      if (!STATUSES.has(value)) throw new ValidationError('Invalid relationship status');
      changes[key] = value;
    } else if (key === 'customer_category') {
      if (value !== null && !CATEGORIES.has(value)) throw new ValidationError('Invalid customer category');
      changes[key] = value;
    } else if (key === 'preferred_branch_id' || key === 'assigned_staff_user_id') {
      if (value !== null && (typeof value !== 'string' || !value.trim())) throw new ValidationError(`${key} must be an ID or null`);
      changes[key] = value;
    } else if (key === 'internal_notes') {
      if (value !== null && (typeof value !== 'string' || value.length > 2000)) throw new ValidationError('Notes must be at most 2000 characters');
      changes[key] = value;
    } else if (key === 'tags') {
      if (!Array.isArray(value) || value.length > 12 || value.some((t) => typeof t !== 'string' || !/^[a-z0-9 -]{1,24}$/i.test(t))) {
        throw new ValidationError('Tags must contain at most 12 short labels');
      }
      changes[key] = [...new Set(value.map((t) => t.trim()))];
    } else if (key === 'follow_up_at') {
      if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) throw new ValidationError('Invalid follow-up date');
      changes[key] = value;
    } else if (key === 'follow_up_status') {
      if (value !== null && !FOLLOW_UP.has(value)) throw new ValidationError('Invalid follow-up status');
      changes[key] = value;
    }
  }
  const date = Object.hasOwn(changes, 'follow_up_at') ? changes.follow_up_at : before?.follow_up_at || null;
  const status = Object.hasOwn(changes, 'follow_up_status') ? changes.follow_up_status : before?.follow_up_status || null;
  if (Boolean(date) !== Boolean(status)) throw new ValidationError('Follow-up date and status must be recorded or cleared together');
  if (!before?.follow_up_status && status && status !== 'pending') {
    throw new ValidationError('A new follow-up must start pending');
  }
  if (['completed', 'cancelled'].includes(before?.follow_up_status)
    && ['completed', 'cancelled'].includes(status) && status !== before.follow_up_status) {
    throw new ValidationError('A closed follow-up cannot change its terminal outcome');
  }
  return changes;
}

export async function updateGarageCustomerRelationship(client, actor, customerId, body) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  const party = await resolveParty(client, actor, customerId);
  const before = party.relationship;
  const changes = normalizeChanges(body, before);
  if (party.partyKind !== 'registered' && changes.relationship_status === 'active') {
    throw new ValidationError('An unlinked prospect cannot be marked as a verified active customer');
  }
  await validateSiteAndAdvisor(client, tenantId, changes);
  let row;
  if (!before) {
    if (!party.userId) throw new NotFoundError('Relationship not found');
    const first = party.cases[0];
    const insert = {
      tenant_id: tenantId, party_kind: 'registered', origin: 'service_case',
      registered_user_id: party.userId, relationship_status: 'active',
      first_relationship_at: first.requested_at || first.created_at,
      created_by_user_id: actorId(actor), updated_by_user_id: actorId(actor), ...changes,
    };
    const { data, error } = await client.from('garage_customer_relationships').insert(insert).select('*').single();
    if (error) failure('Failed to create relationship', error);
    row = data;
  } else {
    const { data, error } = await client.from('garage_customer_relationships').update({ ...changes, updated_by_user_id: actorId(actor) })
      .eq('tenant_id', tenantId).eq('id', before.id).select('*').single();
    if (error) failure('Failed to update relationship', error);
    row = data;
  }
  return { customer_id: customerId, relationship: publicMetadata(row) };
}

export async function createGarageProspect(client, actor, body) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  if (!body || typeof body !== 'object' || body.tenant_id !== undefined) throw new ValidationError('Invalid prospect');
  let insert;
  if (body.origin === 'walk_in') {
    const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    if (body.walk_in_confirmed !== true || !name || name.length > 120) throw new ValidationError('Confirm a real walk-in and record a short prospect label');
    insert = { party_kind: 'walk_in', origin: 'walk_in', prospect_name: name };
  } else if (body.origin === 'communications') {
    const id = body.external_identity_id;
    if (typeof id !== 'string' || !id) throw new ValidationError('External identity id is required');
    const identity = await rows(client.from('channel_identities').select('id, tenant_id, user_id')
      .eq('id', id).eq('tenant_id', tenantId).is('user_id', null).limit(1), 'Failed to verify external identity');
    if (!identity.length) throw new ValidationError('External contact must belong to this Garage and remain unlinked to a CarUp user');
    insert = { party_kind: 'external', origin: 'communications', external_identity_id: id };
  } else {
    throw new ValidationError('A real walk-in or governed Communications contact is required');
  }
  const { data, error } = await client.from('garage_customer_relationships').insert({
    tenant_id: tenantId, ...insert, relationship_status: 'prospect',
    first_relationship_at: new Date().toISOString(), created_by_user_id: actorId(actor),
  }).select('*').single();
  if (error) failure('Failed to create prospect', error);
  return { customer_id: `relationship:${data.id}`, party_kind: insert.party_kind, relationship: publicMetadata(data) };
}
