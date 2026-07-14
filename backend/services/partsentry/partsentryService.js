import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { addEvent } from '../blockchain/blockchainService.js';

// AGENT G2 — Idempotency protection for partsentry logs

export async function addRepairLog(vin, mechanicId, partName, partOem, actionType, description, mileage) {
  // Odometer check
  const { data: vehicle } = await supabase.from('vehicles').select('mileage').eq('vin', vin).single();
  if (vehicle && mileage < vehicle.mileage) {
    throw new Error(`Mileage verification failure. Recorded mileage ${mileage} km cannot be lower than vehicle current odometer ${vehicle.mileage} km.`);
  }

  const timestamp = new Date().toISOString();
  
  const signData = vin + mechanicId + partName + mileage + timestamp;
  const signature = crypto.createHash('sha256').update(signData).digest('hex').substring(0, 16).toUpperCase();

  // Idempotency check
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: duplicate } = await supabase
    .from('partsentry_logs')
    .select('id')
    .eq('vin', vin)
    .eq('mechanic_id', mechanicId)
    .eq('part_name', partName)
    .eq('mileage', mileage)
    .gt('timestamp', fiveMinutesAgo)
    .single();
  
  if (duplicate) {
    throw new Error(`Idempotency block: duplicate service log detected (Log #${duplicate.id}). Retry within 5 minutes is rejected.`);
  }

  const { data: inserted } = await supabase.from('partsentry_logs').insert({
    vin, mechanic_id: mechanicId, part_name: partName, part_oem: partOem,
    action_type: actionType, description, mileage, signature, timestamp
  }).select('id');

  const newId = inserted?.[0]?.id;

  // Update vehicle odometer
  await supabase.from('vehicles').update({ mileage }).eq('vin', vin);

  await addEvent(vin, 'Mechanic Inspection', { logId: newId, partName, partOem, actionType, odometer: mileage, mechanicId, signature });

  return { id: newId, vin, mechanicId, partName, partOem, actionType, description, mileage, signature, timestamp };
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
      ? 'id, vin, part_name, part_oem, action_type, mileage, timestamp, verification_status, part_verification_status, public_card_eligible, suspicion_status'
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
