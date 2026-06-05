import { supabase } from '../../db/supabase.js';
import crypto from 'crypto';
import { dispatchAutomationWebhook } from '../eventBus/automationWebhookService.js';
import { logger } from '../../utils/logger.js';
import { metricsHub } from '../metrics.js';

export class TrustEnforcementEngine {
  /**
   * Compares extracted OCR fields against the primary registry record to detect spoofing
   */
  static async verifyDocumentDataMatch(vin, docType, extractedPayload) {
    logger.info('TRUST_ENGINE', `Verifying metadata match for VIN: ${vin}, DocType: ${docType}`, { vin, docType });
    
    // Fetch target vehicle
    const { data: vehicle, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('vin, make, model, year, trust_score, owner_id, status')
      .eq('vin', vin)
      .single();

    if (vehicleErr || !vehicle) {
      logger.warn('TRUST_ENGINE', `Vehicle not found in registry: ${vin}`, { vin });
      return { match: false, reason: 'VEHICLE_NOT_IN_REGISTRY' };
    }

    const penalties = [];
    let mismatchDetected = false;

    // 1. Validate VIN in OCR matches listed VIN (For registration books & customs declarations)
    if (extractedPayload.vin && extractedPayload.vin !== vin) {
      mismatchDetected = true;
      penalties.push({ field: 'VIN_MISMATCH', penalty: 50, details: `Extracted: '${extractedPayload.vin}' vs Listing: '${vin}'` });
    }

    // 2. Validate Owner Name matching User profile (For CVR/Registration Book owner names)
    if (vehicle.owner_id && extractedPayload.owner_name) {
      const { data: owner } = await supabase
        .from('users')
        .select('name')
        .eq('id', vehicle.owner_id)
        .single();

      if (owner) {
        const dbName = owner.name.toLowerCase().trim();
        const docName = extractedPayload.owner_name.toLowerCase().trim();
        
        // Split names and verify that at least one key name segment matches
        const dbNameParts = dbName.split(/\s+/);
        const hasNameMatch = dbNameParts.some(part => part.length > 2 && docName.includes(part));
        
        if (!hasNameMatch) {
          mismatchDetected = true;
          penalties.push({ field: 'OWNER_NAME_MISMATCH', penalty: 30, details: `Extracted: '${extractedPayload.owner_name}' vs Registry: '${owner.name}'` });
        }
      }
    }

    // If mismatch is detected, apply trust score degradation
    if (mismatchDetected) {
      const totalPenalty = penalties.reduce((sum, p) => sum + p.penalty, 0);
      const originalScore = vehicle.trust_score || 80.0;
      const newScore = Math.max(0.0, originalScore - totalPenalty);

      logger.warn('TRUST_ENGINE', `Mismatch detected! Degrading vehicle trust: ${originalScore} -> ${newScore} (Penalty: -${totalPenalty})`, {
        vin,
        originalScore,
        newScore,
        penalties
      });

      metricsHub.recordTrustMismatch();
      metricsHub.recordTrustRecalculation();

      // Update vehicle trust score
      await supabase
        .from('vehicles')
        .update({ trust_score: newScore })
        .eq('vin', vin);

      // Write into trust history log
      try {
        await supabase.from('trust_score_history').insert({
          entity_type: 'VEHICLE',
          entity_id: vin,
          previous_score: originalScore,
          new_score: newScore,
          trigger_event: `OCR_METADATA_MISMATCH|${penalties.map(p => p.field).join('|')}`,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        logger.warn('TRUST_ENGINE', `Failed to record trust score history: ${e.message}`, { error: e });
      }

      // Log high risk anomaly inside security_events
      const eventId = 'sec_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);
      await supabase.from('security_events').insert({
        id: eventId,
        user_id: vehicle.owner_id || 'system',
        event_type: 'DOCUMENT_METADATA_MISMATCH',
        details: `OCR Document mismatch detected on ${docType}. Penalties: ${JSON.stringify(penalties)}`,
        severity: totalPenalty >= 50 ? 'CRITICAL' : 'HIGH',
        timestamp: new Date().toISOString()
      });

      // Automatically trigger quarantine if trust score drops below safety margin
      await this.enforceMarketplaceQuarantine(vin);

      return { match: false, penalties, totalPenalty, newScore };
    }

    logger.info('TRUST_ENGINE', `OCR Metadata verified successfully for VIN: ${vin}`, { vin });
    return { match: true, penalties: [], totalPenalty: 0, newScore: vehicle.trust_score };
  }

  /**
   * Propagates risk from Dealer/Organization down to listed vehicles
   */
  static async propagateStakeholderRisk(stakeholderId) {
    logger.info('TRUST_ENGINE', `Propagating risk for Stakeholder: ${stakeholderId}`, { stakeholderId });
    
    const { data: profile, error: profileErr } = await supabase
      .from('stakeholder_profiles')
      .select('trust_score')
      .eq('user_id', stakeholderId)
      .single();

    if (profileErr || !profile) {
      logger.warn('TRUST_ENGINE', `Stakeholder profile not found: ${stakeholderId}`, { stakeholderId });
      return;
    }

    const currentReputation = profile.trust_score;

    // Stakeholder is untrusted (drops below threshold 50.0)
    if (currentReputation < 50.0) {
      const degradationMultiplier = (50.0 - currentReputation) / 100.0; // Max 0.5 penalty
      
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('vin, trust_score, status')
        .eq('owner_id', stakeholderId);

      if (vehicles && vehicles.length > 0) {
        logger.warn('TRUST_ENGINE', `Seller reputation degraded to ${currentReputation}. Penalizing ${vehicles.length} vehicle listings...`, {
          stakeholderId,
          currentReputation
        });

        metricsHub.recordReputationDegradation();
        
        for (const v of vehicles) {
          const baseScore = v.trust_score || 80.0;
          const penalty = baseScore * degradationMultiplier;
          const finalScore = Math.max(0.0, parseFloat((baseScore - penalty).toFixed(1)));

          metricsHub.recordTrustRecalculation();

          await supabase.from('vehicles').update({ trust_score: finalScore }).eq('vin', v.vin);

          await supabase.from('trust_score_history').insert({
            entity_type: 'VEHICLE',
            entity_id: v.vin,
            previous_score: baseScore,
            new_score: finalScore,
            trigger_event: `STAKEHOLDER_RISK_PROPAGATION: Seller ID ${stakeholderId} trust degraded.`,
            timestamp: new Date().toISOString()
          });

          // Trigger quarantine checks
          await this.enforceMarketplaceQuarantine(v.vin);
        }
      }
    }
  }

  /**
   * Quarantines vehicle listings with trust scores under 60.0
   */
  static async enforceMarketplaceQuarantine(vin) {
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select('trust_score, status, owner_id')
      .eq('vin', vin)
      .single();

    if (error || !vehicle) return;

    if (vehicle.trust_score < 60.0 && vehicle.status === 'Available') {
      logger.warn('TRUST_ENGINE', `Enforcing marketplace quarantine on VIN: ${vin} (Score: ${vehicle.trust_score})`, {
        vin,
        trustScore: vehicle.trust_score
      });

      metricsHub.recordListingQuarantine();
      
      await supabase
        .from('vehicles')
        .update({ status: 'Suspended' })
        .eq('vin', vin);

      // Log the quarantine enforcement
      const eventId = 'sec_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);
      await supabase.from('security_events').insert({
        id: eventId,
        user_id: vehicle.owner_id || 'system',
        event_type: 'AUTOMATIC_MARKETPLACE_QUARANTINE',
        details: `Vehicle VIN ${vin} was automatically suspended from the marketplace due to trust score dropping to ${vehicle.trust_score}`,
        severity: 'HIGH',
        timestamp: new Date().toISOString()
      });

      // Emit internal VEHICLE_QUARANTINED event
      dispatchAutomationWebhook('VEHICLE_QUARANTINED', {
        vin,
        trustScore: vehicle.trust_score,
        ownerId: vehicle.owner_id
      });
    }
  }
}

