import { ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { GARAGE_SERVICE_CATEGORIES } from './garageDirectoryService.js';
import { assertEvidenceUsable } from './serviceAuthority.js';

/**
 * Service Network S5 — service records, mileage observations, parts and evidence.
 *
 * A service record is a SOURCE record of what a garage did. It is not a Passport
 * projection (S6 projects from it) and it is never Trust (Invariant 4).
 *
 * MILEAGE (plan §13.1, S0 adjudication): `vehicles.mileage` keeps its single
 * existing writer — `partsentryService.addRepairLog`, which applies a monotonic
 * guard and then overwrites. This service records what was OBSERVED during work,
 * with its own provenance, and never writes the canonical odometer. A reading that
 * disagrees with the canonical value is still recorded, so it can be reconciled
 * rather than silently discarded.
 *
 * PARTS and EVIDENCE stay with their authorities: this service stores governed
 * references to `partsentry_logs` rows and evidence rows, and re-implements neither.
 */

/** Plan §6.6 provenance vocabulary — a strict superset of Passport's SERVICE_AUTHORITIES. */
export const SERVICE_AUTHORITIES = Object.freeze([
  'owner_declared', 'garage_stated', 'mechanic_attributed',
  'professional_governed', 'evidence_backed', 'partner_record', 'unknown',
]);

export const MILEAGE_OBSERVATION_SOURCES = Object.freeze([
  'garage_stated', 'mechanic_attributed', 'evidence_backed', 'owner_declared',
]);

function requireTenantContext(userContext = {}) {
  const tenantId = userContext.tenantId || null;
  if (!tenantId) throw new ForbiddenError('A membership-verified garage tenant context is required');
  return tenantId;
}

// A JS default applies only to `undefined`, so an explicit null argument reached the property
// read and produced a TypeError (HTTP 500) where the honest answer is 403. An absent identity is
// a refusal, not a server fault.
function actorId(userContext) {
  const id = userContext?.id || userContext?.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required');
  return id;
}

function normalizedStatus(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function isTerminalWorkOrder(status) {
  return ['completed', 'cancelled'].includes(normalizedStatus(status));
}

async function loadWorkOrder(supabaseClient, workOrderId, tenantId) {
  const id = String(workOrderId || '').trim();
  if (!id) throw new ValidationError('work order id is required');
  const { data, error } = await supabaseClient
    .from('mechanic_work_orders')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load work order: ${error.message}`);
  if (!data) throw new NotFoundError('Work order not found');
  return data;
}

async function loadRecord(supabaseClient, recordId, tenantId) {
  const id = String(recordId || '').trim();
  if (!id) throw new ValidationError('service record id is required');
  const { data, error } = await supabaseClient
    .from('service_records')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load service record: ${error.message}`);
  if (!data) throw new NotFoundError('Service record not found');
  return data;
}

function normalizeMoney(body) {
  if (body.total_cost === undefined || body.total_cost === null || body.total_cost === '') {
    // Absent cost stays absent. It is never rendered or stored as zero (Invariant 10).
    return { total_cost: null, currency: null };
  }
  const cost = Number(body.total_cost);
  if (!Number.isFinite(cost) || cost < 0) throw new ValidationError('total_cost must be a non-negative number');
  const currency = String(body.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError('currency (ISO-4217, e.g. USD) is required whenever a cost is recorded');
  }
  return { total_cost: cost, currency };
}

function normalizeAuthority(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  const a = String(value).trim();
  if (!SERVICE_AUTHORITIES.includes(a)) {
    throw new ValidationError(`Unknown service provenance: ${a}`);
  }
  return a;
}

/** Record what was done on a work order. */
export async function recordService(supabaseClient, userContext, workOrderId, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const recorder = actorId(userContext);
  const workOrder = await loadWorkOrder(supabaseClient, workOrderId, tenantId);
  if (isTerminalWorkOrder(workOrder.status)) {
    throw new ConflictError(`This work order is ${workOrder.status} and remains historical; no further service can be recorded`);
  }

  let category = null;
  if (body.service_category !== undefined && body.service_category !== null && body.service_category !== '') {
    category = String(body.service_category).trim();
    if (!GARAGE_SERVICE_CATEGORIES.includes(category)) {
      throw new ValidationError(`Unknown service category: ${category}`);
    }
  }

  const money = normalizeMoney(body);
  const now = new Date().toISOString();
  const row = {
    work_order_id: workOrder.id,
    service_case_id: workOrder.service_case_id || null,
    tenant_id: tenantId,
    vin: workOrder.vin,
    work_performed: body.work_performed ? String(body.work_performed).trim() : null,
    service_category: category || workOrder.service_category || null,
    service_authority: normalizeAuthority(body.service_authority),
    total_cost: money.total_cost,
    currency: money.currency,
    recorded_by_user_id: recorder,
    // The real-world service time may legitimately differ from when it was typed in.
    performed_at: body.performed_at ? new Date(body.performed_at).toISOString() : now,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabaseClient.from('service_records').insert(row).select().single();
  if (error) throw new DatabaseError(`Failed to record service: ${error.message}`);
  return { record: data };
}

/**
 * Record a mileage reading observed during service.
 *
 * This is an OBSERVATION. It does not write `vehicles.mileage`, and a reading that
 * disagrees with the canonical odometer is recorded rather than rejected, so the
 * disagreement is visible instead of lost.
 */
export async function recordMileageObservation(supabaseClient, userContext, recordId, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const observer = actorId(userContext);
  const record = await loadRecord(supabaseClient, recordId, tenantId);

  const mileage = Number(body.observed_mileage);
  if (!Number.isInteger(mileage) || mileage < 0) {
    throw new ValidationError('observed_mileage must be a non-negative integer');
  }
  const source = body.observation_source ? String(body.observation_source).trim() : 'garage_stated';
  if (!MILEAGE_OBSERVATION_SOURCES.includes(source)) {
    throw new ValidationError(`Unknown mileage observation source: ${source}`);
  }

  const { data, error } = await supabaseClient
    .from('service_mileage_observations')
    .insert({
      service_record_id: record.id,
      vin: record.vin,
      observed_mileage: mileage,
      observation_source: source,
      observed_at: body.observed_at ? new Date(body.observed_at).toISOString() : new Date().toISOString(),
      observed_by_user_id: observer,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(`Failed to record mileage observation: ${error.message}`);

  // Report whether this observation disagrees with the canonical odometer, WITHOUT
  // changing it. Canonical odometer resolution stays outside Foundation 1.0.
  const { data: vehicle } = await supabaseClient
    .from('vehicles').select('mileage').eq('vin', record.vin).maybeSingle();
  const canonical = vehicle && vehicle.mileage !== null && vehicle.mileage !== undefined
    ? Number(vehicle.mileage) : null;

  return {
    observation: data,
    canonical_mileage: canonical,
    // null when there is nothing to compare against — unknown, not "agrees".
    disagrees_with_canonical: canonical === null ? null : mileage < canonical,
  };
}

/** Link a PartSentry log to this service record. PartSentry still owns the part record. */
export async function linkPartRecord(supabaseClient, userContext, recordId, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const record = await loadRecord(supabaseClient, recordId, tenantId);
  const logId = Number(body.partsentry_log_id);
  if (!Number.isInteger(logId) || logId <= 0) {
    throw new ValidationError('partsentry_log_id must be a positive integer');
  }

  const { data: log, error: logError } = await supabaseClient
    .from('partsentry_logs')
    .select('id, vin, tenant_id')
    .eq('id', logId)
    .maybeSingle();
  if (logError) throw new DatabaseError(`Failed to load part record: ${logError.message}`);
  if (!log) throw new NotFoundError('Part record not found');
  // A part record from another vehicle or another garage cannot be attached.
  if (log.vin !== record.vin) throw new ValidationError('That part record belongs to a different vehicle');
  if (log.tenant_id && log.tenant_id !== tenantId) {
    throw new ValidationError('That part record belongs to a different garage');
  }

  const { data, error } = await supabaseClient
    .from('service_record_parts')
    .insert({ service_record_id: record.id, partsentry_log_id: logId })
    .select()
    .single();
  if (error) {
    if (String(error.code) === '23505') return { link: null, created: false };
    throw new DatabaseError(`Failed to link part record: ${error.message}`);
  }
  return { link: data, created: true };
}

/** Link an evidence row. The Evidence authority still owns it. */
export async function linkEvidence(supabaseClient, userContext, recordId, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const record = await loadRecord(supabaseClient, recordId, tenantId);
  const evidenceId = String(body.evidence_id || '').trim();
  if (!evidenceId) throw new ValidationError('evidence_id is required');

  // HARDENING: a matching VIN is NOT authorization — it only says the evidence concerns
  // the same vehicle. Using an evidence item additionally requires a governed service
  // engagement for that vehicle by this garage, and evidence provided by another party
  // is not this garage's to reuse. Evidence itself remains the Evidence authority's.
  await assertEvidenceUsable(supabaseClient, userContext, evidenceId, {
    vin: record.vin,
    tenantId,
    serviceCaseId: record.service_case_id,
  });

  const { data, error } = await supabaseClient
    .from('service_record_evidence')
    .insert({ service_record_id: record.id, evidence_id: evidenceId })
    .select()
    .single();
  if (error) {
    if (String(error.code) === '23505') return { link: null, created: false };
    throw new DatabaseError(`Failed to link evidence: ${error.message}`);
  }

  // Evidence-backed is a CLAIM ABOUT PROVENANCE, so it is only asserted once real
  // evidence is attached — never set by a client, and never assumed.
  if (record.service_authority !== 'evidence_backed') {
    await supabaseClient.from('service_records')
      .update({ service_authority: 'evidence_backed', updated_at: new Date().toISOString() })
      .eq('id', record.id)
      .eq('tenant_id', tenantId);
  }
  return { link: data, created: true };
}

/** Full source view of a service record for the participants. */
export async function getServiceRecord(supabaseClient, userContext, recordId) {
  const tenantId = requireTenantContext(userContext);
  const record = await loadRecord(supabaseClient, recordId, tenantId);
  const [{ data: observations }, { data: parts }, { data: evidence }] = await Promise.all([
    supabaseClient.from('service_mileage_observations').select('*').eq('service_record_id', record.id),
    supabaseClient.from('service_record_parts').select('*').eq('service_record_id', record.id),
    supabaseClient.from('service_record_evidence').select('*').eq('service_record_id', record.id),
  ]);
  return {
    record,
    mileage_observations: observations || [],
    part_records: parts || [],
    evidence_references: evidence || [],
  };
}
