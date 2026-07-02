/**
 * Cross-border ownership/evidence handoff — Diaspora Trade OS.
 *
 * After a vehicle import completes compliance (order ZIMBABWE_READY, all required government
 * documents VERIFIED, vehicle_import_records row VERIFIED), this service hands the verified
 * import into CarUp's normal vehicle identity + evidence layer:
 *
 *   1. resolves or creates the canonical `vehicles` row (vin-keyed identity),
 *   2. links vehicle_import_records.vehicle_vin and diaspora_import_orders.linked_vehicle_vin,
 *   3. appends a CROSS_BORDER_OWNERSHIP_HANDOFF event to the vehicle's immutable timeline
 *      ledger (`blockchain_events`) with safe provenance only,
 *   4. seals the handoff with an idempotency marker on the order (metadata.ownershipHandoff),
 *   5. writes a critical audit row and best-effort notification/outbox events.
 *
 * Evidence-table decision (discovered, not guessed): `vehicle_evidence` is file-backed —
 * file_url/storage_bucket/file_path/mime_type/file_size are NOT NULL and evidence_type is
 * CHECK-constrained to photo/document types (migrations 014/015). A file-less system event
 * cannot be written there truthfully, so the handoff event goes to `blockchain_events`
 * (vin, free event_type, JSONB payload, hash chain) — the immutable per-VIN event ledger the
 * vehicle passport verifies via verifyChain. The insert mirrors blockchainService.addEvent
 * (same hash chain + system signature format) but runs against the injected client.
 *
 * The event payload NEVER contains storage paths/URLs and makes no claims of legal title,
 * registration, customs clearance or roadworthiness — it records only that a verified import
 * completed and the identity was handed to the CarUp vehicle record.
 *
 * All reads/writes go through resolveClient(options) so tests can inject the in-memory mock.
 */
import crypto from 'crypto';
import { IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { GOVERNMENT_DOCUMENT_CATEGORIES } from '../../constants/diaspora/diasporaDocumentTypes.js';
import { ZIMBABWE_READY_REQUIRED_DOCUMENTS } from './diasporaWorkflowService.js';
import { calculateHash } from '../blockchain/blockchainService.js';
import { CarUpError, DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  assertCanReadImportOrder,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
  requireUserContext,
} from './diasporaAuthorization.js';
import { appendCriticalAudit, resolveClient } from './diasporaServiceUtils.js';

export const HANDOFF_EVENT_TYPE = 'CROSS_BORDER_OWNERSHIP_HANDOFF';
export const HANDOFF_AUDIT_ACTION = 'DIASPORA_OWNERSHIP_HANDOFF';
export const HANDOFF_NOTIFICATION_TYPE = 'DIASPORA_OWNERSHIP_HANDOFF';

const ORDERS = 'diaspora_import_orders';
const IMPORT_RECORDS = 'vehicle_import_records';
const GOVERNMENT_DOCS = 'vehicle_government_documents';
const VEHICLES = 'vehicles';
const TIMELINE_EVENTS = 'blockchain_events';
const GENESIS_HASH = '0'.repeat(64);

/** 409-style typed error: a vehicles row for this VIN already belongs to a different context. */
export class OwnershipHandoffConflictError extends CarUpError {
  constructor(message = 'Vehicle identity conflict during ownership handoff', details = null) {
    super(message, 409, 'OWNERSHIP_HANDOFF_CONFLICT', details);
  }
}

// ── reads (all against the injected client) ────────────────────────────────────────────────

async function loadOrder(client, importOrderId) {
  const { data, error } = await client
    .from(ORDERS)
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw new NotFoundError('Diaspora import order not found');
  return data;
}

async function loadParticipants(client, importOrderId) {
  const { data, error } = await client
    .from('diaspora_import_order_participants')
    .select('*')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null);
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

/**
 * Mirror of diasporaWorkflowService.getGovernmentFootprint/assertZimbabweReadyPrerequisites,
 * re-implemented against the injected client (the originals are singleton-bound).
 * Returns the VERIFIED document rows (id + category only — never storage references).
 */
async function assertGovernmentDocumentsVerified(client, importOrderId) {
  const { data, error } = await client
    .from(GOVERNMENT_DOCS)
    .select('id, document_category, verification_status')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null);
  if (error) throw new DatabaseError(error.message);

  const statusByCategory = new Map((data || []).map((row) => [row.document_category, row.verification_status]));
  const missing = GOVERNMENT_DOCUMENT_CATEGORIES
    .filter((category) => ZIMBABWE_READY_REQUIRED_DOCUMENTS.includes(category))
    .filter((category) => (statusByCategory.get(category) || 'MISSING') !== 'VERIFIED');

  if (missing.length > 0) {
    throw new ValidationError(
      'Ownership handoff requires every required government document to be VERIFIED.',
      { missing },
    );
  }

  return (data || [])
    .filter((row) => row.verification_status === 'VERIFIED')
    .map((row) => ({ id: row.id, category: row.document_category }));
}

async function loadVerifiedImportRecord(client, importOrderId) {
  const { data, error } = await client
    .from(IMPORT_RECORDS)
    .select('*')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null);
  if (error) throw new DatabaseError(error.message);

  const records = data || [];
  if (records.length === 0) {
    throw new NotFoundError('No vehicle import record exists for this import order');
  }
  const verified = records.find((row) => row.verification_status === 'VERIFIED');
  if (!verified) {
    throw new ValidationError('Ownership handoff requires a VERIFIED vehicle import record.', {
      verificationStatuses: records.map((row) => row.verification_status),
    });
  }
  return verified;
}

async function findVehicleByVin(client, vin) {
  const { data, error } = await client.from(VEHICLES).select('*').eq('vin', vin).maybeSingle();
  if (error) throw new DatabaseError(error.message);
  return data || null;
}

/** All prior handoff timeline events for a VIN, with parsed payloads. */
async function findHandoffTimelineEvents(client, vin) {
  const { data, error } = await client
    .from(TIMELINE_EVENTS)
    .select('*')
    .eq('vin', vin)
    .eq('event_type', HANDOFF_EVENT_TYPE);
  if (error) throw new DatabaseError(error.message);
  return (data || []).map((row) => ({
    ...row,
    payload: typeof row.payload === 'string' ? safeParse(row.payload) : (row.payload || {}),
  }));
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// ── authorization (server-derived roles only) ──────────────────────────────────────────────

/**
 * Handoff is reviewer-gated: trusted platform admin/reviewer, or a tenant admin of the ORDER's
 * tenant. Ordinary buyers/sellers/participants are never allowed. Cross-tenant admins are
 * rejected by isTenantAdminForRecord (tenant ids must match).
 */
function assertCanCompleteHandoff(order, context) {
  if (isPlatformAdmin(context) || isPlatformReviewer(context)) return;
  if (isTenantAdminForRecord(order, context)) return;
  throw new ForbiddenError('You are not authorized to complete a Diaspora ownership handoff');
}

/** True when an existing vehicles row belongs to a different owner/tenant context. */
function establishesDifferentOwnership(vehicle, order) {
  const vehicleTenant = normalizeId(vehicle.tenant_id);
  const orderTenant = normalizeId(order.tenant_id);
  if (vehicleTenant && orderTenant && vehicleTenant !== orderTenant) return true;
  if (vehicleTenant && !orderTenant) return true; // vehicle already claimed by a tenant this order lacks
  const vehicleOwner = normalizeId(vehicle.owner_id);
  const orderBuyer = normalizeId(order.buyer_id);
  if (vehicleOwner && orderBuyer && vehicleOwner !== orderBuyer) return true;
  return false;
}

// ── writes ─────────────────────────────────────────────────────────────────────────────────

/**
 * Minimal, truthful canonical identity insert (vehicles schema: supabase_schema.sql +
 * 002/010/013_zimbabwe_plate/20260624140000 migrations). NOT NULL columns without defaults —
 * make, model, year, mileage, price — receive explicit "not yet known/listed" values; the row
 * is kept off the marketplace (status 'Pending', publication_status 'draft') and marked with
 * import_source 'diaspora_import'. duty_paid/police_verified keep their FALSE defaults: this
 * handoff makes no customs/roadworthiness/title claims.
 */
async function insertVehicleIdentity(client, { vin, chassisNumber, order }) {
  const { data, error } = await client
    .from(VEHICLES)
    .insert({
      vin,
      chassis_number: chassisNumber || null,
      make: order.requested_make || 'Unknown',
      model: order.requested_model || 'Unknown',
      year: order.requested_year_min ?? order.requested_year_max ?? 0,
      mileage: 0, // no odometer attestation captured yet
      price: 0, // identity handoff — not listed for sale
      currency: order.budget_currency || 'USD',
      status: 'Pending',
      publication_status: 'draft',
      import_source: 'diaspora_import',
      tenant_id: order.tenant_id || null,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new DatabaseError(`Failed to create CarUp vehicle identity: ${error.message}`);
  return data;
}

/**
 * Hash-chained timeline event, mirroring blockchainService.addEvent (same calculateHash and
 * system signature format) against the injected client so the chain stays verifiable.
 */
async function appendHandoffTimelineEvent(client, { vin, payload }) {
  const { data: lastEvents, error: lastError } = await client
    .from(TIMELINE_EVENTS)
    .select('current_hash, id')
    .eq('vin', vin)
    .order('id', { ascending: false })
    .limit(1);
  if (lastError) throw new DatabaseError(lastError.message);

  const previousHash = lastEvents?.[0]?.current_hash || GENESIS_HASH;
  const timestamp = new Date().toISOString();
  const currentHash = calculateHash(previousHash, vin, HANDOFF_EVENT_TYPE, timestamp, payload);
  const hmac = crypto.createHmac('sha256', 'carup-system-secret');
  hmac.update(currentHash);

  const { data, error } = await client
    .from(TIMELINE_EVENTS)
    .insert({
      previous_hash: previousHash,
      current_hash: currentHash,
      vin,
      event_type: HANDOFF_EVENT_TYPE,
      payload: JSON.stringify(payload),
      timestamp,
      signature: `system:${hmac.digest('hex')}`,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(`Failed to append handoff evidence event: ${error.message}`);
  return data;
}

/**
 * Best-effort notification/outbox, mirroring notifyDiasporaMilestone (emitDiasporaEvent +
 * queueDiasporaNotification row shapes) but through the injected client. Never throws —
 * notification failure must not corrupt or roll back a completed handoff.
 */
async function notifyOwnershipHandoff(client, { order, vin, actorId }) {
  const title = 'Vehicle import handed to CarUp record';
  const message = 'Your verified import has completed compliance and its identity has been handed to the CarUp vehicle record.';
  try {
    await client
      .from('domain_events')
      .insert({
        event_type: HANDOFF_NOTIFICATION_TYPE,
        payload: { importOrderId: order.id, vehicleVin: vin, actorId, title, message },
        status: 'pending',
        attempts: 0,
        tenant_id: order.tenant_id ? String(order.tenant_id) : null,
      })
      .select()
      .single();
  } catch (err) {
    console.warn('⚠️ Diaspora handoff domain event skipped:', err.message);
  }
  try {
    const recipientId = order.buyer_id || order.created_by;
    if (recipientId) {
      await client
        .from('notification_queue')
        .insert({
          recipient_id: recipientId,
          type: HANDOFF_NOTIFICATION_TYPE,
          title,
          message,
          read: false,
          metadata: { importOrderId: order.id, vehicleVin: vin, channels: ['IN_APP', 'EMAIL_READY', 'SMS_READY', 'WHATSAPP_READY', 'PUSH_READY'] },
        })
        .select()
        .single();
    }
  } catch (err) {
    console.warn('⚠️ Diaspora handoff notification skipped:', err.message);
  }
}

// ── public API ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete the cross-border ownership/evidence handoff for a compliance-complete import order.
 *
 * Fail-closed preconditions (each a typed error, all validated BEFORE the first write):
 *   NotFoundError    — order/import record missing
 *   ValidationError  — order not ZIMBABWE_READY, government documents not all VERIFIED,
 *                      import record not VERIFIED, no VIN/chassis identity available
 *   ForbiddenError   — actor is not platform admin/reviewer or the order tenant's admin
 *   OwnershipHandoffConflictError — VIN already owned by a different tenant/owner context or
 *                      already handed off from a different import order
 *
 * Idempotent: a replay (order metadata.ownershipHandoff marker already present) returns
 * { idempotentReplay: true, ... } and writes nothing.
 */
export async function completeOwnershipHandoff(importOrderId, payload = {}, userContext = {}, options = {}) {
  if (!importOrderId) throw new ValidationError('importOrderId is required');
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  // ── validate everything before the first write ──
  const order = await loadOrder(client, importOrderId);
  assertCanCompleteHandoff(order, context);

  // Idempotent replay: the completion marker is only written after the evidence event, so its
  // presence proves the handoff finished. Checked before the status gate so a replay still
  // succeeds after the order later advances past ZIMBABWE_READY.
  const existingMarker = order.metadata?.ownershipHandoff;
  if (existingMarker) {
    const vehicle = existingMarker.vehicleVin ? await findVehicleByVin(client, existingMarker.vehicleVin) : null;
    const evidence = existingMarker.vehicleVin ? await findHandoffTimelineEvents(client, existingMarker.vehicleVin) : [];
    return {
      idempotentReplay: true,
      vehicle,
      handoff: existingMarker,
      evidence: evidence.filter((event) => normalizeId(event.payload?.importOrderId) === normalizeId(importOrderId)),
    };
  }

  if (order.status !== IMPORT_ORDER_STATUSES.ZIMBABWE_READY) {
    throw new ValidationError(
      `Ownership handoff requires the import order to be ${IMPORT_ORDER_STATUSES.ZIMBABWE_READY}. Current status: ${order.status}`,
      { currentStatus: order.status },
    );
  }

  const verifiedDocuments = await assertGovernmentDocumentsVerified(client, importOrderId);
  const importRecord = await loadVerifiedImportRecord(client, importOrderId);

  const chassisNumber = importRecord.chassis_number || order.chassis_number || null;
  const vin = importRecord.vehicle_vin || order.linked_vehicle_vin || null;
  // JDM imports commonly carry only a chassis number; CarUp keys vehicle identity by vin, so the
  // chassis number becomes the canonical identity key when no VIN exists.
  const canonicalVin = vin || chassisNumber;
  if (!canonicalVin) {
    throw new ValidationError('Ownership handoff requires a VIN or chassis number on the verified import record.');
  }
  const identitySource = vin ? 'vin' : 'chassis_number';

  // Conflict checks — no silent overwrite of someone else's vehicle identity.
  const existingVehicle = await findVehicleByVin(client, canonicalVin);
  if (existingVehicle && establishesDifferentOwnership(existingVehicle, order)) {
    throw new OwnershipHandoffConflictError(
      'A CarUp vehicle with this VIN already exists in a different owner/tenant context.',
      { vin: canonicalVin, vehicleTenantId: existingVehicle.tenant_id ?? null, orderTenantId: order.tenant_id ?? null },
    );
  }
  const priorHandoffEvents = await findHandoffTimelineEvents(client, canonicalVin);
  const foreignHandoff = priorHandoffEvents.find(
    (event) => event.payload?.importOrderId && normalizeId(event.payload.importOrderId) !== normalizeId(importOrderId),
  );
  if (foreignHandoff) {
    throw new OwnershipHandoffConflictError(
      'This VIN was already handed off from a different diaspora import order.',
      { vin: canonicalVin, conflictingImportOrderId: foreignHandoff.payload.importOrderId },
    );
  }

  // ── writes: vehicle → links → evidence → completion marker → audit → notify ──
  const nowIso = new Date().toISOString();

  // 1. Resolve or create the canonical vehicle identity.
  const vehicle = existingVehicle || await insertVehicleIdentity(client, { vin: canonicalVin, chassisNumber, order });

  // 2. Link all three records. vehicle_import_records.vehicle_vin references vehicles(vin).
  const { data: linkedRecord, error: recordError } = await client
    .from(IMPORT_RECORDS)
    .update({ vehicle_vin: canonicalVin, updated_by: context.id, updated_at: nowIso })
    .eq('id', importRecord.id)
    .select()
    .single();
  if (recordError) throw new DatabaseError(`Failed to link vehicle import record: ${recordError.message}`);

  const { error: orderLinkError } = await client
    .from(ORDERS)
    .update({ linked_vehicle_vin: canonicalVin, updated_by: context.id, updated_at: nowIso })
    .eq('id', importOrderId);
  if (orderLinkError) throw new DatabaseError(`Failed to link import order to vehicle: ${orderLinkError.message}`);

  // 3. Evidence/timeline event — safe provenance only. No storage paths/URLs, no claims of
  //    legal title/registration/customs clearance/roadworthiness. A retry that failed after
  //    this point is deduplicated by re-checking existing events for this order.
  const provenance = {
    importOrderId,
    vehicleImportRecordId: importRecord.id,
    originCountry: importRecord.origin_country || order.origin_country || null,
    importDate: importRecord.import_date || null,
    verifiedGovernmentDocuments: verifiedDocuments,
    actorId: context.id,
    identitySource,
    handedOffAt: nowIso,
    statement: 'Verified import completed; vehicle identity handed to the CarUp vehicle record. This event does not assert legal title, registration, customs clearance or roadworthiness.',
  };
  const alreadyWritten = priorHandoffEvents.find(
    (event) => normalizeId(event.payload?.importOrderId) === normalizeId(importOrderId),
  );
  const evidenceEvent = alreadyWritten || await appendHandoffTimelineEvent(client, { vin: canonicalVin, payload: provenance });

  // 4. Completion marker — written last among the linkage writes so a mid-failure retry
  //    re-runs the (idempotent) steps above instead of skipping them.
  const handoffMarker = {
    vehicleVin: canonicalVin,
    vehicleImportRecordId: importRecord.id,
    evidenceEventId: evidenceEvent.id ?? null,
    actorId: context.id,
    handedOffAt: nowIso,
  };
  const { data: updatedOrder, error: markerError } = await client
    .from(ORDERS)
    .update({
      metadata: { ...(order.metadata || {}), ownershipHandoff: handoffMarker },
      updated_by: context.id,
      updated_at: nowIso,
    })
    .eq('id', importOrderId)
    .select()
    .single();
  if (markerError) throw new DatabaseError(`Failed to seal ownership handoff: ${markerError.message}`);

  // 5. Critical audit — fail-loud, never silently swallowed.
  await appendCriticalAudit(client, {
    importOrderId,
    tenantId: order.tenant_id,
    actorId: context.id,
    action: HANDOFF_AUDIT_ACTION,
    resourceType: 'vehicle',
    resourceId: canonicalVin,
    previousState: { orderStatus: order.status, vehicleExisted: Boolean(existingVehicle) },
    newState: { vehicleVin: canonicalVin, vehicleImportRecordId: importRecord.id, evidenceEventId: evidenceEvent.id ?? null },
    metadata: provenance,
    req,
  });

  // 6. Best-effort notification/outbox — after all integrity-critical writes succeeded.
  await notifyOwnershipHandoff(client, { order: updatedOrder || order, vin: canonicalVin, actorId: context.id });

  return {
    idempotentReplay: false,
    vehicle,
    importOrder: updatedOrder,
    vehicleImportRecord: linkedRecord,
    evidence: { ...evidenceEvent, payload: provenance },
    handoff: handoffMarker,
  };
}

/**
 * Participant-readable handoff status for the UI/passport: the order's buyer/seller/participants
 * and privileged reviewers may read it (same read gate as the rest of the order).
 */
export async function getOwnershipHandoffStatus(importOrderId, userContext = {}, options = {}) {
  if (!importOrderId) throw new ValidationError('importOrderId is required');
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);

  const order = await loadOrder(client, importOrderId);
  const participants = await loadParticipants(client, importOrderId);
  assertCanReadImportOrder(order, participants, context);

  const marker = order.metadata?.ownershipHandoff || null;
  const vehicleVin = marker?.vehicleVin || order.linked_vehicle_vin || null;

  let evidence = [];
  if (marker && vehicleVin) {
    const events = await findHandoffTimelineEvents(client, vehicleVin);
    evidence = events
      .filter((event) => normalizeId(event.payload?.importOrderId) === normalizeId(importOrderId))
      .map((event) => ({
        id: event.id,
        event_type: event.event_type,
        timestamp: event.timestamp,
        payload: event.payload,
      }));
  }

  return { handedOff: Boolean(marker), vehicleVin, evidence };
}
