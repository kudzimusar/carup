/**
 * AI Vision Provider Abstraction.
 * Supports a customizable mock analyzer and safeguards against network errors or provider downtime.
 */

export async function analyzeEvidenceImage(fileBuffer, mimeType, evidenceType, metadata = {}) {
  // Check if simulated provider error is requested
  const scenario = metadata.mock_ai_scenario || null;
  if (scenario === 'provider_error') {
    throw new Error('AI Vision provider service timeout or connection refused (Simulated API error).');
  }

  // Abstracted wrapper that simulates Vision analysis
  // Decoupled from live API providers for Phase 4.
  const timeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 10000);
  
  const analysisPromise = new Promise((resolve) => {
    // Simulate minor network processing latency
    setTimeout(() => {
      let riskScore = 0.05;
      let confidence = 0.95;
      let aiStatus = 'ai_passed';
      let recommendedAction = 'approve';
      let reviewerSummary = 'No risks detected. The evidence elements are consistent.';
      let visiblePlate = metadata.plate_number || null;
      let visibleVin = metadata.vin || null;
      let visibleOdometer = metadata.odometer_reading || null;
      let damageIndicators = [];
      let manipulationIndicators = [];
      let detectedObjects = [];

      switch (scenario) {
        case 'flagged_vin_mismatch':
          riskScore = 0.9;
          confidence = 0.98;
          aiStatus = 'ai_flagged';
          recommendedAction = 'reject';
          visibleVin = 'VIN_MISMATCH_999';
          reviewerSummary = 'Visible VIN in document/photo (VIN_MISMATCH_999) does not match vehicle registered VIN.';
          detectedObjects = ['vin_plate', 'registration_document'];
          break;

        case 'flagged_manipulation':
          riskScore = 0.8;
          confidence = 0.85;
          aiStatus = 'ai_flagged';
          recommendedAction = 'reject';
          manipulationIndicators = [{ type: 'compression_mismatch', severity: 'high', notes: 'Metadata mismatch detected' }];
          reviewerSummary = 'Suspicious metadata modification and compression levels suggesting image manipulation.';
          detectedObjects = ['car_photo'];
          break;

        case 'flagged_odometer_rollback':
          riskScore = 0.85;
          confidence = 0.92;
          aiStatus = 'ai_flagged';
          recommendedAction = 'reject';
          visibleOdometer = 45000;
          reviewerSummary = 'Odometer reading in photo (45,000 km) is lower than the last recorded mileage (80,000 km) in maintenance logs.';
          detectedObjects = ['odometer_display'];
          break;

        case 'low_confidence':
          riskScore = 0.15;
          confidence = 0.45;
          aiStatus = 'ai_low_confidence';
          recommendedAction = 'inspect';
          reviewerSummary = 'Image is blurry or low resolution. Unable to confidently extract details.';
          break;

        case 'manual_review_required':
          riskScore = 0.3;
          confidence = 0.7;
          aiStatus = 'ai_manual_review_required';
          recommendedAction = 'inspect';
          reviewerSummary = 'Complex or unreadable document layout. Manual reviewer inspection recommended.';
          break;

        default:
          // Default clean pass behavior
          if (evidenceType === 'odometer_photo') {
            detectedObjects = ['odometer_display'];
            visibleOdometer = visibleOdometer || 120000;
          } else if (evidenceType === 'damage_photo') {
            detectedObjects = ['scratch', 'bumper'];
            damageIndicators = [{ type: 'dent', severity: 'medium', location: 'front_bumper' }];
          } else {
            detectedObjects = ['vehicle_exterior'];
          }
          break;
      }

      resolve({
        risk_score: riskScore,
        confidence,
        ai_status: aiStatus,
        recommended_action: recommendedAction,
        reviewer_summary: reviewerSummary,
        visible_plate: visiblePlate,
        visible_vin: visibleVin,
        visible_odometer: visibleOdometer,
        damage_indicators: damageIndicators,
        manipulation_indicators: manipulationIndicators,
        detected_objects: detectedObjects,
        public_safe_summary: recommendedAction === 'approve' ? 'AI analysis: image verified clean.' : null
      });
    }, 50);
  });

  // Enforce strict timeout boundary. The timer MUST be cleared once the race
  // settles — otherwise every analysis leaves a dangling multi-second timer
  // that keeps the event loop alive (a real resource leak under load, and the
  // cause of the test-runner IPC crash when this suite runs alongside others).
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`AI Vision provider analysis timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([analysisPromise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}
