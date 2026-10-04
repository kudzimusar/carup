import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { recordIntentNow } from '../blockchain/ledgerIntentService.js';
import { ATTESTATIONS, LEDGER_EVENT_TYPES } from './partsentryServiceAuthority.js';

export const PARTSENTRY_ACTION_TYPES = Object.freeze(['Replaced', 'Repaired', 'Inspected', 'Diagnosed']);

/** A refusal the route answers with its own status, before anything was written. */
export class PartSentryRecordError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.name = 'PartSentryRecordError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * The database's refusal, translated. Every one of these happened INSIDE partsentry_record_service, so
 * nothing was written: the record, the odometer and the ledger intent commit together or not at all.
 */
function translateRecordError(error) {
  const code = error?.code || null;
  const message = error?.message || 'The service record could not be saved.';
  if (code === '22023') return new PartSentryRecordError(message, 400, code);
  if (code === 'P0002') return new PartSentryRecordError('Vehicle not found.', 404, code);
  if (code === '23505') return new PartSentryRecordError('This request key was already used for a different service record.', 409, code);
  return new PartSentryRecordError('The service record could not be saved. Nothing was recorded.', 503, code);
}

/**
 * Record one PartSentry entry under an authority `resolvePartSentryWriteAuthority` has already decided.
 *
 * ONE commit boundary (OC-5A, finding D): `partsentry_record_service` writes the log, moves the canonical
 * odometer ONLY for a governed mechanic service, and writes the ledger intent — all or nothing. The
 * ledger event is then recorded from the intent through the canonical writer; when that cannot happen
 * now, the record still stands and the result says `ledger.status: 'pending'`. A caller is never told
 * "failed" for a record that was kept.
 *
 * Idempotent: the same `idempotencyKey` (or, for clients that send none, the same actor/part/reading
 * within five minutes) returns the ORIGINAL record with `replayed: true` — and re-attempts its ledger
 * event if that is still pending — instead of refusing the retry of a request whose response was lost.
 */
export async function recordPartSentryEntry({
  vin, actorId, authority, partName, partOem, actionType, description, mileage, idempotencyKey = null,
  client = supabase, recordLedger = recordIntentNow,
}) {
  if (!authority?.allowed || !Object.values(ATTESTATIONS).includes(authority.attestation)) {
    throw new PartSentryRecordError('No PartSentry write authority was established for this record.', 403);
  }
  /**
   * The submitted mileage may become the vehicle's canonical odometer, so it has to be a real reading
   * before anything else happens. Any comparison against NaN is false, so an absent or unparseable
   * mileage once sailed past the odometer guard and reset an odometer.
   */
  const odometer = Number(mileage);
  if (!Number.isInteger(odometer) || odometer < 0) {
    throw new PartSentryRecordError('A valid odometer reading is required to record a repair (whole kilometres).', 400);
  }
  const cleanPartName = typeof partName === 'string' ? partName.trim() : '';
  if (!cleanPartName) throw new PartSentryRecordError('A part name is required.', 400);
  if (!PARTSENTRY_ACTION_TYPES.includes(actionType)) {
    throw new PartSentryRecordError(`actionType must be one of: ${PARTSENTRY_ACTION_TYPES.join(', ')}.`, 400);
  }
  const key = idempotencyKey == null ? null : String(idempotencyKey).trim();
  if (key !== null && (key.length < 8 || key.length > 200)) {
    throw new PartSentryRecordError('An idempotency key must be 8 to 200 characters.', 400);
  }

  // An absent description or OEM is stored as absent. Substituting a placeholder would put a value
  // into an evidence record that nobody actually supplied.
  const cleanDescription = typeof description === 'string' && description.trim() ? description.trim() : null;
  const cleanPartOem = typeof partOem === 'string' && partOem.trim() ? partOem.trim() : null;

  const timestamp = new Date().toISOString();
  const signature = crypto.createHash('sha256').update(vin + actorId + cleanPartName + odometer + timestamp).digest('hex').substring(0, 16).toUpperCase();
  const attestation = authority.attestation;
  const odometerApplied = attestation === ATTESTATIONS.MECHANIC_SERVICE;

  // What the ledger event will say. `mechanicId` appears ONLY on a governed mechanic service; the
  // database adds logId and ledgerIntentId. The signer is named explicitly, never inferred.
  const ledgerPayload = {
    attestation,
    partName: cleanPartName,
    partOem: cleanPartOem,
    actionType,
    odometer,
    odometerApplied,
    recordedBy: actorId,
    workOrderId: authority.workOrderId ?? null,
    signature,
    ...(attestation === ATTESTATIONS.MECHANIC_SERVICE ? { mechanicId: actorId } : {}),
  };

  const { data, error } = await client.rpc('partsentry_record_service', {
    p_vin: vin,
    p_actor_id: actorId,
    p_attestation: attestation,
    p_work_order_id: authority.workOrderId ?? null,
    p_tenant_id: authority.tenantId ?? null,
    p_part_name: cleanPartName,
    p_part_oem: cleanPartOem,
    p_action_type: actionType,
    p_description: cleanDescription,
    p_mileage: odometer,
    p_signature: signature,
    p_timestamp: timestamp,
    p_idempotency_key: key,
    p_ledger_event_type: LEDGER_EVENT_TYPES[attestation],
    p_ledger_payload: ledgerPayload,
  });
  if (error) throw translateRecordError(error);
  const outcome = typeof data === 'string' ? JSON.parse(data) : data;
  const log = outcome?.log;
  if (!log || log.id === undefined || log.id === null) {
    throw new PartSentryRecordError('The service record could not be confirmed.', 503);
  }

  const ledger = outcome.intent
    ? await recordLedger(outcome.intent, { client })
    : { status: 'not_applicable', intentId: null }; // a replay of a record written before OC-5A

  return {
    id: log.id,
    vin: log.vin,
    // `mechanicId` is the historical column name; it holds the recording actor for every attestation.
    mechanicId: log.mechanic_id,
    recordedBy: log.mechanic_id,
    attestation: log.attestation,
    odometerApplied: log.odometer_applied,
    workOrderId: log.work_order_id ?? null,
    partName: log.part_name,
    partOem: log.part_oem,
    actionType: log.action_type,
    description: log.description,
    mileage: log.mileage,
    signature: log.signature,
    timestamp: log.timestamp,
    replayed: outcome.replayed === true,
    ledger,
  };
}

/**
 * Service-level writer for governed platform fixtures (the Golden vehicle dataset). It records a
 * `platform_recorded` entry: a platform-owned fixture is not a mechanic's service and must not move
 * the canonical odometer or be ledgered as a mechanic inspection. Product routes never call this —
 * they decide authority with resolvePartSentryWriteAuthority and call recordPartSentryEntry.
 */
export async function addRepairLog(vin, actorId, partName, partOem, actionType, description, mileage, _tenantId = null, options = {}) {
  return recordPartSentryEntry({
    vin, actorId, partName, partOem, actionType, description, mileage,
    authority: { allowed: true, attestation: ATTESTATIONS.PLATFORM_RECORDED, workOrderId: null, tenantId: null },
    idempotencyKey: options.idempotencyKey ?? null,
    client: options.client ?? supabase,
  });
}

/**
 * Fail-closed non-suspicious ALLOWLIST (mirrors main's summarizePartSentry semantics):
 * a public row may be returned ONLY when its suspicion_status is NULL or one of these
 * known-safe values. Any other value — watch/flagged AND any unknown/future state —
 * is excluded, instead of a denylist that would silently publish new states.
 */
const NON_SUSPICIOUS_PARTSENTRY_STATUSES = ['none', 'cleared', ''];

function isNonSuspiciousPartSentryRow(row) {
  const status = String(row?.suspicion_status ?? '').trim().toLowerCase();
  return NON_SUSPICIOUS_PARTSENTRY_STATUSES.includes(status);
}

export async function getRepairHistory(vin, { publicOnly = false } = {}) {
  let query = supabase
    .from('partsentry_logs')
    .select(publicOnly
      ? 'id, vin, part_name, part_oem, action_type, mileage, timestamp, attestation, verification_status, part_verification_status, public_card_eligible, suspicion_status'
      : '*'
    )
    .eq('vin', vin)
    .order('timestamp', { ascending: false });

  if (publicOnly) {
    query = query.eq('public_card_eligible', true);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (!publicOnly) return rows;

  // Public projection requires BOTH the public_card_eligible opt-in (filtered above) AND the
  // non-suspicious allowlist (suspicion_status IS NULL OR IN ('none','cleared','')). The
  // suspicion_status column is fetched only for this in-memory guard and stripped from the
  // response so the public payload shape is unchanged.
  return rows
    .filter(isNonSuspiciousPartSentryRow)
    .map(({ suspicion_status: _suspicionStatus, ...publicRow }) => publicRow);
}
