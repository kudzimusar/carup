import { supabase } from '../../db/supabase.js';
import { verifyChain } from '../blockchain/blockchainService.js';

// AGENT A3 — Rolling checkpoint-accelerated timeline fetcher
export async function getVehicleTimeline(vin) {
  // Fetch all timeline events in parallel from Supabase
  const [
    ownershipResult, serviceResult, insuranceResult, escrowResult,
    zimraResult, cvrResult, vidResult, cidResult, zinaraResult, plateHistoryResult,
    workOrderResult
  ] = await Promise.all([
    supabase.from('vehicle_ownership_history').select('id, transfer_date, previous_owner_id, new_owner_id').eq('vin', vin),
    supabase.from('partsentry_logs').select('id, timestamp, action_type, part_name, mechanic_id, mileage, description').eq('vin', vin),
    supabase.from('insurance_records').select('policy_number, start_date, insurer_id, premium_amount, risk_score').eq('vin', vin),
    supabase.from('safepay_escrows').select('id, created_at, status, buyer_id, amount, current_stage').eq('vin', vin),
    supabase.from('zimra_declarations').select('*').eq('vin', vin),
    supabase.from('cvr_ownership_records').select('*').eq('vin', vin),
    supabase.from('vid_inspections').select('*').eq('vin', vin),
    supabase.from('cid_clearance_records').select('*').eq('vin', vin),
    supabase.from('zinara_licensing_records').select('*').eq('vin', vin),
    supabase.from('vehicle_plate_history').select('*').eq('vin', vin),
    // Mechanic-signed service records. The timeline previously carried NONE, so its only
    // `event_source: 'service'` events were PartSentry part logs — which is how one part log came to
    // be published as both "1 service" and "1 part". Owner surfaces that separate the two need a real
    // source for each, and `/api/vehicles/me` counts these same work orders.
    supabase.from('mechanic_work_orders').select('id, vin, created_at, status, description, mechanic_id').eq('vin', vin),
  ]);

  const events = [];

  // Ownership transfers
  for (const e of (ownershipResult.data || [])) {
    events.push({
      event_source: 'ownership_transfer',
      id: `ownership_transfer:${e.id}`,
      timestamp: e.transfer_date,
      label: 'Owner Transfer',
      desc: 'Previous owner transferred to new buyer',
      details: { previous: e.previous_owner_id, new: e.new_owner_id }
    });
  }

  // Mechanic-signed service records. Emitted under the SAME `event_source` as PartSentry (both are
  // service-shaped events on the vehicle's timeline) but with their own `workorder:` id prefix, which
  // is what lets a consumer tell a service from a part instead of counting one row as both.
  // A missing table on an older instance yields no rows rather than an error.
  for (const e of (workOrderResult?.data || [])) {
    events.push({
      event_source: 'service',
      id: `workorder:${e.id}`,
      timestamp: e.created_at,
      label: e.status ? `Service — ${e.status}` : 'Service',
      desc: e.description || 'Mechanic-signed service record',
      details: { mechanic: e.mechanic_id, notes: e.description ?? null },
    });
  }

  // PartSentry part logs
  for (const e of (serviceResult.data || [])) {
    events.push({
      event_source: 'service',
      id: `partsentry:${e.id}`,
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
      id: `insurance:${e.policy_number}`,
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
      id: `escrow:${e.id}`,
      timestamp: e.created_at,
      label: 'SafePay Escrow',
      desc: `Escrow transaction state: ${e.status}`,
      details: { buyer: e.buyer_id, amount: e.amount, stage: e.current_stage }
    });
  }

  // ZIMRA Custom Clearance
  for (const e of (zimraResult.data || [])) {
    events.push({
      event_source: 'zimra',
      id: `zimra:${e.id}`,
      timestamp: e.customs_stamp_date,
      label: 'ZIMRA Customs Clearance',
      desc: `Import duty cleared via ${e.port_of_entry}. Ref: ${e.customs_ref_number}`,
      details: { importer: e.importer_name, dutyPaid: e.duty_paid_zig, date: e.customs_stamp_date }
    });
  }

  // CVR Registrations
  for (const e of (cvrResult.data || [])) {
    events.push({
      event_source: 'cvr',
      id: `cvr:${e.id}`,
      timestamp: e.issue_date,
      label: 'CVR Registration',
      desc: `Registered plate ${e.registration_number}. Owner: ${e.owner_full_name}`,
      details: { logbookSerial: e.logbook_serial_number, ownerId: e.owner_id_number, status: e.status }
    });
  }

  // VID Inspections
  for (const e of (vidResult.data || [])) {
    events.push({
      event_source: 'vid',
      id: `vid:${e.id}`,
      timestamp: e.inspected_at,
      label: 'VID Inspection',
      desc: `Mechanical inspection: ${e.inspection_status} at ${e.inspection_center}`,
      details: { brakingEfficiency: e.braking_efficiency_pct, suspensionPassed: e.suspension_passed, steeringPassed: e.steering_passed, odometer: e.odometer_reading }
    });
  }

  // CID Clearances
  for (const e of (cidResult.data || [])) {
    events.push({
      event_source: 'cid',
      id: `cid:${e.id}`,
      timestamp: e.cleared_at,
      label: 'CID Police Clearance',
      desc: `CID clearance check: ${e.stolen_check_status} at ${e.station_name}`,
      details: { reference: e.clearance_ref_number, officer: e.authorized_by_officer }
    });
  }

  // ZINARA Licensing
  for (const e of (zinaraResult.data || [])) {
    events.push({
      event_source: 'zinara',
      id: `zinara:${e.id}`,
      timestamp: e.licensing_term_start,
      label: 'ZINARA Licensing',
      desc: `Road licensing term: ${e.status}. Paid: ${e.amount_paid_zig} ZiG`,
      details: { termEnd: e.licensing_term_end, receipt: e.receipt_number }
    });
  }

  // Plate History events (Timeline events based on user prompt step 8)
  for (const p of (plateHistoryResult.data || [])) {
    // plate_assigned / temporary_id_issued
    if (p.issued_at) {
      const isTemp = p.plate_type === 'temporary';
      events.push({
        event_source: isTemp ? 'temporary_id_issued' : 'plate_assigned',
        id: isTemp ? `temporary_id_issued:${p.id}` : `plate_assigned:${p.id}`,
        timestamp: p.issued_at,
        label: isTemp ? 'Temporary ID Issued' : 'Plate Assigned',
        desc: isTemp 
          ? `Temporary identification number issued: ${p.plate_number}`
          : `Number plate assigned: ${p.plate_number}`,
        details: {
          plateNumber: p.plate_number,
          plateType: p.plate_type,
          reason: p.reason,
          createdBy: p.created_by
        }
      });
    }

    // plate_verified
    if (p.verified_at) {
      events.push({
        event_source: 'plate_verified',
        id: `plate_verified:${p.id}`,
        timestamp: p.verified_at,
        label: 'Plate Verified',
        desc: `Number plate ${p.plate_number} verified via ${p.verification_source || 'CVR'}`,
        details: {
          plateNumber: p.plate_number,
          verifiedBy: p.verified_by,
          verificationSource: p.verification_source
        }
      });
    }

    // plate_flagged
    if (p.status === 'flagged') {
      events.push({
        event_source: 'plate_flagged',
        id: `plate_flagged:${p.id}`,
        timestamp: p.updated_at || p.created_at,
        label: 'Plate Flagged',
        desc: `Number plate ${p.plate_number} flagged: ${p.reason || 'No reason provided'}`,
        details: {
          plateNumber: p.plate_number,
          reason: p.reason
        }
      });
    }

    // plate_suspended
    if (p.status === 'suspended') {
      events.push({
        event_source: 'plate_suspended',
        id: `plate_suspended:${p.id}`,
        timestamp: p.updated_at || p.created_at,
        label: 'Plate Suspended',
        desc: `Number plate ${p.plate_number} suspended: ${p.reason || 'No reason provided'}`,
        details: {
          plateNumber: p.plate_number,
          reason: p.reason
        }
      });
    }

    // plate_changed (if status is previous, it implies the plate was changed)
    if (p.status === 'previous') {
      events.push({
        event_source: 'plate_changed',
        id: `plate_changed:${p.id}`,
        timestamp: p.updated_at || p.created_at,
        label: 'Plate Changed',
        desc: `Number plate ${p.plate_number} retired or changed`,
        details: {
          plateNumber: p.plate_number,
          status: p.status
        }
      });
    }
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

async function computeVehicleTrustScoreContext(vin) {
  const { data: vehicle } = await supabase.from('vehicles').select('*').eq('vin', vin).single();
  
  if (!vehicle) return 0;

  const previousScore = vehicle.trust_score;
  let baseScore = 70.0; // Baseline starting score

  // 1. ZIMRA Customs Ingestion Check
  const { data: zimra } = await supabase.from('zimra_declarations').select('id').eq('vin', vin).single();
  const dutyPaidReal = !!zimra || !!vehicle.duty_paid;
  if (dutyPaidReal) baseScore += 10.0;

  // 2. CID Police Clearance Check
  const { data: cid } = await supabase
    .from('cid_clearance_records')
    .select('stolen_check_status')
    .eq('vin', vin)
    .single();
  const policeVerifiedReal = (cid && cid.stolen_check_status === 'Cleared') || !!vehicle.police_verified;
  if (policeVerifiedReal) baseScore += 10.0;

  // 3. CVR Ownership Registry Sync Check
  const { data: cvr } = await supabase.from('cvr_ownership_records').select('id').eq('vin', vin).single();
  const cvrSyncedReal = !!cvr;
  if (cvrSyncedReal) baseScore += 5.0;

  // 4. VID Inspection Mechanical Health Check
  const { data: vid } = await supabase
    .from('vid_inspections')
    .select('inspection_status')
    .eq('vin', vin)
    .order('inspected_at', { ascending: false })
    .limit(1);
  const vidStatus = vid?.[0]?.inspection_status;
  if (vidStatus === 'Passed') baseScore += 5.0;
  else if (vidStatus === 'Failed_Unroadworthy') baseScore -= 20.0;

  // Odometer and ledger audits
  const odoAudit = await runOdometerAudit(vin);
  if (!odoAudit.verified) baseScore -= 40.0;

  const ledgerAudit = await verifyChain(vin);
  if (!ledgerAudit.verified) baseScore -= 50.0;

  const { count: serviceCount } = await supabase
    .from('partsentry_logs')
    .select('*', { count: 'exact', head: true })
    .eq('vin', vin);
  if (serviceCount >= 3) baseScore += 5.0;

  const { data: evidenceImpacts } = await supabase
    .from('vehicle_evidence')
    .select('verification_status, trust_score_impact, trust_impact')
    .eq('vin', vin)
    .in('verification_status', ['verified', 'rejected']);

  const evidenceTrustImpact = (evidenceImpacts || []).reduce((sum, item) => {
    const impact = Number(item.trust_score_impact ?? item.trust_impact ?? 0);
    return sum + impact;
  }, 0);
  baseScore += evidenceTrustImpact;

  // Check persistent stolen vehicle registry
  const { data: stolenRecord } = await supabase
    .from('stolen_vehicles')
    .select('vin')
    .eq('vin', vin)
    .eq('status', 'ACTIVE_POLICE_ALERT')
    .single();
  if (stolenRecord) baseScore -= 80.0;

  // --- NEW ZIMBABWE PLATE TRUST RULES ---
  // A. Confidence reductions
  if (!vehicle.plate_number) {
    baseScore -= 10.0; // Confidence reduction: missing plate number
  } else if (!vehicle.plate_verified_at) {
    baseScore -= 10.0; // Confidence reduction: plate exists but unverified
  }

  // B. Flagged / Suspended plate quarantine penalty
  if (vehicle.plate_status === 'Flagged' || vehicle.plate_status === 'Suspended') {
    baseScore -= 50.0;
  }

  // C. Plate maps to multiple VINs or belongs to another vehicle
  if (vehicle.normalized_plate_number) {
    const { count: duplicateVinCount } = await supabase
      .from('vehicles')
      .select('vin', { count: 'exact', head: true })
      .eq('normalized_plate_number', vehicle.normalized_plate_number)
      .neq('vin', vin);
    if (duplicateVinCount && duplicateVinCount > 0) {
      baseScore -= 50.0;
    }
  }

  // D. Temporary ID is expired and unresolved
  if (vehicle.temporary_identification_number && vehicle.registration_status === 'Expired') {
    baseScore -= 30.0;
  }

  const finalScore = Math.max(0.0, Math.min(100.0, baseScore));

  const triggerEvents = [];
  if (!odoAudit.verified) triggerEvents.push('ODOMETER_ROLLBACK_DETECTED');
  if (!ledgerAudit.verified) triggerEvents.push('BLOCKCHAIN_TAMPERING_DETECTED');
  if (stolenRecord) triggerEvents.push('ACTIVE_POLICE_ALERT');
  if (vehicle.plate_status === 'Flagged' || vehicle.plate_status === 'Suspended') triggerEvents.push('PLATE_SUSPENDED_OR_FLAGGED');
  if (Math.abs(evidenceTrustImpact) > 0.01) triggerEvents.push('EVIDENCE_REVIEW_IMPACT');
  if (triggerEvents.length === 0) triggerEvents.push('ROUTINE_RECALCULATION');

  const report = {
    vin,
    trustScore: finalScore,
    metrics: {
      cvr_synced: cvrSyncedReal,
      zimra_duty: dutyPaidReal,
      zrp_police_cleared: policeVerifiedReal,
      blockchain_audit_valid: ledgerAudit.verified,
      odometer_consistent: odoAudit.verified,
      maintenance_logs_count: serviceCount || 0,
      stolen_alert_active: !!stolenRecord,
      evidence_trust_impact: evidenceTrustImpact,
      verified_evidence_count: (evidenceImpacts || []).filter(item => item.verification_status === 'verified').length,
      rejected_evidence_count: (evidenceImpacts || []).filter(item => item.verification_status === 'rejected').length
    }
  };

  return { report, previousScore, triggerEvents };
}

export async function computeVehicleTrustScore(vin) {
  const context = await computeVehicleTrustScoreContext(vin);
  return context?.report || 0;
}

export async function calculateVehicleTrustScore(vin) {
  const context = await computeVehicleTrustScoreContext(vin);
  if (!context) return 0;

  const { report, previousScore, triggerEvents } = context;

  await supabase.from('vehicles').update({ trust_score: report.trustScore }).eq('vin', vin);

  if (Math.abs(report.trustScore - previousScore) > 0.01) {
    await recordTrustScoreHistory('VEHICLE', vin, previousScore, report.trustScore, triggerEvents.join('|'));
  }

  return report;
}
