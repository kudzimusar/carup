import { supabase } from '../../db/supabase.js';
import { addEvent } from '../blockchain/blockchainService.js';

// AGENT E1 — STOLEN VEHICLE PERSISTENCE ENGINEER
// Police alerts now stored in Supabase — survive all server reboots and deployments.

export async function reportVehicleStolen(vin, policeReportNumber, reportingOwnerId) {
  const { data: vehicle, error: vehicleError } = await supabase.from('vehicles').select('*').eq('vin', vin).single();
  if (vehicleError || !vehicle) throw new Error(`Vehicle record not found: ${vehicleError?.message || ''}`);
  
  const timestamp = new Date().toISOString();
  
  const { error: upsertError } = await supabase.from('stolen_vehicles').upsert({
    vin, police_report_number: policeReportNumber, reporting_owner_id: reportingOwnerId,
    status: 'ACTIVE_POLICE_ALERT', created_at: timestamp, cleared_at: null, cleared_by: null
  }, { onConflict: 'vin' });
  
  if (upsertError) {
    throw new Error(`Failed to upsert stolen vehicle alert: ${upsertError.message} (Code: ${upsertError.code})`);
  }
  
  const { error: updateError } = await supabase.from('vehicles').update({ police_verified: false, status: 'Flagged' }).eq('vin', vin);
  if (updateError) {
    throw new Error(`Failed to update vehicle status to Flagged: ${updateError.message}`);
  }
  
  await addEvent(vin, 'Stolen Vehicle Flagged', { policeReportNumber, reportingOwnerId, timestamp, status: 'ACTIVE_POLICE_ALERT' });

  return { vin, policeReportNumber, flagged: true, status: 'ACTIVE_POLICE_ALERT', persistedToDatabase: true };
}

export async function checkStolenStatus(vin) {
  const { data: record, error: fetchError } = await supabase
    .from('stolen_vehicles')
    .select('*')
    .eq('vin', vin)
    .eq('status', 'ACTIVE_POLICE_ALERT')
    .maybeSingle(); // Use maybeSingle to prevent throw when 0 rows are found
  
  if (fetchError) {
    throw new Error(`Failed to fetch stolen status: ${fetchError.message}`);
  }
  
  return { vin, stolen: !!record, policeReportNumber: record?.police_report_number || null, reportedAt: record?.created_at || null, actionRequired: record ? 'IMMEDIATE_ZRP_INTERCEPTION' : 'NONE' };
}

export async function clearStolenStatus(vin, clearedByUserId) {
  const timestamp = new Date().toISOString();
  
  const { error: updateStolenError } = await supabase.from('stolen_vehicles').update({ status: 'RECOVERED', cleared_at: timestamp, cleared_by: clearedByUserId }).eq('vin', vin);
  if (updateStolenError) throw new Error(`Failed to clear stolen status: ${updateStolenError.message}`);
  
  const { error: updateVehicleError } = await supabase.from('vehicles').update({ police_verified: true, status: 'Available' }).eq('vin', vin);
  if (updateVehicleError) throw new Error(`Failed to clear vehicle status: ${updateVehicleError.message}`);
  
  await addEvent(vin, 'Stolen Vehicle Cleared', { clearedByUserId, timestamp, status: 'RECOVERED' });
  
  return { vin, cleared: true, clearedAt: timestamp };
}
