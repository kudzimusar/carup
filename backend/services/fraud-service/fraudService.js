import { supabase } from '../../db/supabase.js';

export class FraudService {
  /**
   * Scans a transaction or verification event for spoofing indicators, emulators, or multi-account abuse
   */
  static async scanFraudRisk(userId, sessionPayload = {}) {
    const reasons = [];
    let riskScore = 0; // 0 to 100, higher is riskier

    const { ipAddress, userAgent, deviceId, vin } = sessionPayload;

    try {
      // 1. Check for Duplicate Devices (Multiple accounts mapping to the same device)
      if (deviceId) {
        const { data: duplicateDeviceSess, error: deviceErr } = await supabase
          .from('device_sessions')
          .select('user_id')
          .eq('device_id', deviceId)
          .neq('user_id', userId);

        if (duplicateDeviceSess && duplicateDeviceSess.length > 0) {
          const distinctUsersCount = new Set(duplicateDeviceSess.map(s => s.user_id)).size;
          if (distinctUsersCount >= 2) {
            riskScore += 35;
            reasons.push(`DUPLICATE_DEVICE_HARDWARE: ${distinctUsersCount} distinct user accounts shared this device.`);
          }
        }
      }

      // 2. Check for Emulator Telemetry heuristics
      if (userAgent) {
        const uaLower = userAgent.toLowerCase();
        const isEmulator = 
          uaLower.includes('emulator') || 
          uaLower.includes('sdk_gphone') || 
          uaLower.includes('genymotion') || 
          uaLower.includes('google_sdk');
        
        if (isEmulator) {
          riskScore += 40;
          reasons.push('SUSPICIOUS_HARDWARE_ENVIRONMENT: Request originates from a simulated/emulator device.');
        }
      }

      // 3. Check for Repeated Verification Failures
      const { count: failCount } = await supabase
        .from('security_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('event_type', 'VERIFICATION_FAILURE');

      if (failCount && failCount >= 3) {
        riskScore += 25;
        reasons.push(`REPEATED_VERIFICATION_FAILURES: User triggered ${failCount} consecutive onboarding rejections.`);
      }

      // 4. Suspicious IP / VPN detection (Mocked simulation for local Zimbabwe endpoints)
      if (ipAddress) {
        const isVpn = ipAddress.startsWith('10.') || ipAddress.startsWith('172.') || ipAddress.includes('vpn');
        if (isVpn) {
          riskScore += 15;
          reasons.push('VPN_IP_TUNNELING: Session IP belongs to a proxy / virtual private network range.');
        }
      }

      // 5. Check for Duplicate VIN reuse
      if (vin) {
        const { count: vinCount } = await supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true })
          .eq('vin', vin);

        if (vinCount && vinCount >= 2) {
          riskScore += 50;
          reasons.push(`DUPLICATE_VEHICLE_VIN: The VIN ${vin} is already listed by a different stakeholder.`);
        }
      }

      // Cap final risk score at 100
      const finalRiskScore = Math.min(100, riskScore);
      const isHighRisk = finalRiskScore >= 50;

      // Log high risk alerts directly into security_events
      if (isHighRisk) {
        await supabase.from('security_events').insert({
          id: 'fraud_' + Math.random().toString(36).substring(2, 12),
          user_id: userId,
          event_type: 'HIGH_FRAUD_ALERT',
          details: `Risk assessment triggered high alert (Score: ${finalRiskScore}). Reasons: ${reasons.join(' | ')}`,
          severity: finalRiskScore >= 75 ? 'CRITICAL' : 'HIGH',
          timestamp: new Date().toISOString()
        });
      }

      return {
        userId,
        riskScore: finalRiskScore,
        riskRating: finalRiskScore >= 75 ? 'Critical' : finalRiskScore >= 50 ? 'High' : finalRiskScore >= 25 ? 'Medium' : 'Low',
        reasons,
        isFlagged: isHighRisk
      };
    } catch (e) {
      console.error('Fraud scan evaluation crashed:', e);
      return {
        userId,
        riskScore: 0,
        riskRating: 'Low',
        reasons: [],
        isFlagged: false
      };
    }
  }
}
