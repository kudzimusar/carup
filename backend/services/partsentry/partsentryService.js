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

export async function getRepairHistory(vin) {
  const { data, error } = await supabase.from('partsentry_logs').select('*').eq('vin', vin).order('timestamp', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
