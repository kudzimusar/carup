import { supabase } from '../../db/supabase.js';
import crypto from 'crypto';

export const TRUST_LEVELS = {
  0: 'Anonymous',
  1: 'Phone Verified',
  2: 'ID Verified',
  3: 'Biometric Verified',
  4: 'Vehicle Verified',
  5: 'Dealer Certified',
};

export class TrustService {
  /**
   * Sets the overall trust verification tier level for a user
   */
  static async assignTrustLevel(userId, level, details = {}) {
    const stringLevel = TRUST_LEVELS[level];
    if (!stringLevel) {
      throw new Error(`Invalid Trust Level tier: ${level}`);
    }

    try {
      const timestamp = new Date().toISOString();

      // 1. Fetch user to confirm record presence
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        throw new Error(`User not found: ${userError?.message || ''}`);
      }

      // 2. Upsert user into kyc_profiles
      const { error: kycError } = await supabase
        .from('kyc_profiles')
        .upsert({
          user_id: userId,
          first_name: details.firstName || user.name.split(' ')[0] || 'Unknown',
          last_name: details.lastName || user.name.split(' ')[1] || 'Unknown',
          overall_status: `Level_${level}_${stringLevel}`,
          updated_at: timestamp,
        });

      if (kycError) throw kycError;

      // 3. Log a detailed security event
      const eventId = 'sec_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);
      await supabase.from('security_events').insert({
        id: eventId,
        user_id: userId,
        event_type: 'TRUST_LEVEL_UPGRADE',
        details: `User upgraded to Trust Level ${level} (${stringLevel}). Verification details: ${JSON.stringify(details)}`,
        severity: 'LOW',
        timestamp
      });

      // 4. Update the local custom trust history tracking if table exists
      try {
        await supabase.from('trust_score_history').insert({
          entity_type: 'USER',
          entity_id: userId,
          previous_score: level * 20.0,
          new_score: (level + 1) * 20.0,
          trigger_event: `LEVEL_UPGRADE_${stringLevel}`,
          timestamp
        });
      } catch (e) {
        console.warn('Skipping trust_score_history (table may not exist):', e.message);
      }

      return {
        userId,
        trustLevel: level,
        tierName: stringLevel,
        updatedAt: timestamp,
        persisted: true
      };
    } catch (error) {
      console.error('Failed to assign user trust level:', error);
      throw error;
    }
  }

  /**
   * Evaluates dynamic user trust score based on registration markers
   */
  static async calculateUserTrustScore(userId) {
    let score = 20.0; // Starting baseline

    try {
      const { data: user } = await supabase.from('users').select('phone').eq('id', userId).single();
      if (user?.phone) score += 20.0; // Level 1: Phone Verified

      const { data: documents } = await supabase
        .from('identity_documents')
        .select('*')
        .eq('user_id', userId)
        .eq('verification_status', 'verified');
      if (documents && documents.length > 0) score += 25.0; // Level 2: ID Verified

      const { data: kyc } = await supabase.from('kyc_profiles').select('overall_status').eq('user_id', userId).single();
      if (kyc?.overall_status?.includes('Biometric')) score += 25.0; // Level 3: Biometric Verified

      // Check for security events to degrade trust (e.g. repeated verification failures)
      const { count: failedAttempts } = await supabase
        .from('security_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('event_type', 'VERIFICATION_FAILURE');
      
      if (failedAttempts) {
        score -= Math.min(30.0, failedAttempts * 10.0);
      }

      return Math.max(0.0, Math.min(100.0, score));
    } catch (e) {
      console.error('Error calculating user trust score:', e);
      return score;
    }
  }
}
