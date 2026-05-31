import { supabase } from '../../db/supabase.js';
import { verifyChain } from '../blockchain/blockchainService.js';

// AGENT A3 — Rolling checkpoint-accelerated timeline fetcher
export async function getVehicleTimeline(vin) {
  // Fetch all timeline events in parallel from Supabase
  const [ownershipResult, serviceResult, insuranceResult, escrowResult] = await Promise.all([
    supabase.from('vehicle_ownership_history').select('id, transfer_date, previous_owner_id, new_owner_id').eq('vin', vin),
    supabase.from('partsentry_logs').select('id, timestamp, action_type, part_name, mechanic_id, mileage, description').eq('vin', vin),
    supabase.from('insurance_records').select('policy_number, start_date, insurer_id, premium_amount, risk_score').eq('vin', vin),
    supabase.from('safepay_escrows').select('id, created_at, status, buyer_id, amount, current_stage').eq('vin', vin),
  ]);

  const events = [];

  // Ownership transfers
  for (const e of (ownershipResult.data || [])) {
    events.push({
      event_source: 'ownership_transfer',
      id: e.id,
      timestamp: e.transfer_date,
      label: 'Owner Transfer',
      desc: 'Previous owner transferred to new buyer',
      details: { previous: e.previous_owner_id, new: e.new_owner_id }
    });
  }

  // Service logs
  for (const e of (serviceResult.data || [])) {
    events.push({
      event_source: 'service',
      id: e.id,
      timestamp: e.timestamp,
      label: e.action_type,
      desc: `${e.part_name} (${e.action_type})`,
      details: { mechanic: e.mechanic_id, mileage: e.mileage, notes: e.description }
    });
  }

  // Insurance records
  for (const e of (insuranceResult.data || [])) {
    events.push({
      event_source: 'insurance',
      id: e.policy_number,
      timestamp: e.start_date,
      label: 'Insurance Insured',
      desc: 'Policy premium set',
      details: { insurer: e.insurer_id, premium: e.premium_amount, risk: e.risk_score }
    });
  }

  // Escrow transactions
  for (const e of (escrowResult.data || [])) {
    events.push({
      event_source: 'escrow',
      id: e.id,
      timestamp: e.created_at,
      label: 'SafePay Escrow',
      desc: `Escrow transaction state: ${e.status}`,
      details: { buyer: e.buyer_id, amount: e.amount, stage: e.current_stage }
    });
  }

  // Sort all events chronologically
  return events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export async function runOdometerAudit(vin) {
  // Use the vehicle's recorded base mileage
  const { data: vehicle } = await supabase.from('vehicles').select('mileage').eq('vin', vin).single();
  const baseMileage = vehicle ? vehicle.mileage : 0;
  
  const nowIso = new Date().toISOString();
  const { data: serviceLogs } = await supabase
    .from('partsentry_logs')
    .select('mileage, timestamp, id')
    .eq('vin', vin)
    .lte('timestamp', nowIso)
    .order('timestamp', { ascending: true });

  // Build deduplicated mileage timeline
  const seen = new Set();
  const deduplicatedLogs = [];
  
  for (const log of (serviceLogs || [])) {
    const key = `${log.mileage}-${log.timestamp}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicatedLogs.push({ mileage: log.mileage, timestamp: log.timestamp, source: `Service Log #${log.id}` });
    }
  }

  let lastMileage = 0;
  const anomalies = [];

  for (const log of deduplicatedLogs) {
    if (log.mileage < lastMileage) {
      anomalies.push({
        type: 'ODOMETER_ROLLBACK',
        timestamp: log.timestamp,
        source: log.source,
        mileageRecorded: log.mileage,
        previousMileage: lastMileage,
        difference: lastMileage - log.mileage,
        severity: 'Critical'
      });
    }
    lastMileage = log.mileage;
  }

  return {
    vin,
    verified: anomalies.length === 0,
    checkpointsCount: deduplicatedLogs.length,
    baseMileage,
    anomalies,
    milestones: deduplicatedLogs
  };
}

// AGENT E2 — Trust mutation historian
async function recordTrustScoreHistory(entityType, entityId, previousScore, newScore, triggerEvent) {
  // trust_score_history table — insert if table exists, graceful fallback
  try {
    await supabase.from('trust_score_history').insert({
      entity_type: entityType,
      entity_id: entityId,
      previous_score: previousScore,
      new_score: newScore,
      trigger_event: triggerEvent,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    // Table may not exist yet — log but don't break
    console.warn('trust_score_history insert skipped:', e.message);
  }
}

export async function calculateVehicleTrustScore(vin) {
  const { data: vehicle } = await supabase.from('vehicles').select('*').eq('vin', vin).single();
  
  if (!vehicle) return 0;

  const previousScore = vehicle.trust_score;
  let baseScore = 75.0;

  if (vehicle.duty_paid) baseScore += 10.0;
  if (vehicle.police_verified) baseScore += 10.0;

  const odoAudit = await runOdometerAudit(vin);
  if (!odoAudit.verified) baseScore -= 40.0;

  const ledgerAudit = await verifyChain(vin);
  if (!ledgerAudit.verified) baseScore -= 50.0;

  const { count: serviceCount } = await supabase
    .from('partsentry_logs')
    .select('*', { count: 'exact', head: true })
    .eq('vin', vin);
  if (serviceCount >= 3) baseScore += 5.0;

  // Check persistent stolen vehicle registry
  const { data: stolenRecord } = await supabase
    .from('stolen_vehicles')
    .select('vin')
    .eq('vin', vin)
    .eq('status', 'ACTIVE_POLICE_ALERT')
    .single();
  if (stolenRecord) baseScore -= 80.0;

  const finalScore = Math.max(0.0, Math.min(100.0, baseScore));
  
  await supabase.from('vehicles').update({ trust_score: finalScore }).eq('vin', vin);

  if (Math.abs(finalScore - previousScore) > 0.01) {
    const triggerEvents = [];
    if (!odoAudit.verified) triggerEvents.push('ODOMETER_ROLLBACK_DETECTED');
    if (!ledgerAudit.verified) triggerEvents.push('BLOCKCHAIN_TAMPERING_DETECTED');
    if (stolenRecord) triggerEvents.push('ACTIVE_POLICE_ALERT');
    if (triggerEvents.length === 0) triggerEvents.push('ROUTINE_RECALCULATION');
    
    await recordTrustScoreHistory('VEHICLE', vin, previousScore, finalScore, triggerEvents.join('|'));
  }

  return {
    vin,
    trustScore: finalScore,
    metrics: {
      cvr_synced: true,
      zimra_duty: !!vehicle.duty_paid,
      zrp_police_cleared: !!vehicle.police_verified,
      blockchain_audit_valid: ledgerAudit.verified,
      odometer_consistent: odoAudit.verified,
      maintenance_logs_count: serviceCount || 0,
      stolen_alert_active: !!stolenRecord
    }
  };
}
