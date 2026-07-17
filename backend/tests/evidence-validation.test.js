import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  canUploadEvidence,
  evidenceStatusTrustImpact,
  evidenceToTimelineItem,
  mergeEventsWithEvidence,
  parseBase64Payload,
  validateEvidenceUploadPayload
} = await import('../services/evidence/evidenceService.js');

const pngPayload = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;

test('validates required vehicle_id for top-level evidence uploads', () => {
  assert.throws(
    () => validateEvidenceUploadPayload({ evidence_type: 'odometer_photo', file: pngPayload }, { requireVehicleId: true }),
    /vehicle_id is required/
  );
});

test('accepts the supported CarVertical gap evidence types', () => {
  const payload = validateEvidenceUploadPayload({
    vehicle_id: 'VIN123',
    event_type: 'inspection',
    evidence_type: 'inspection_photo',
    file: pngPayload,
    linked_registry_event_id: 'vid:1',
    metadata: { odometer_reading: 52000 }
  }, { requireVehicleId: true });

  assert.equal(payload.vehicleId, 'VIN123');
  assert.equal(payload.evidenceType, 'inspection_photo');
  assert.equal(payload.linkedRegistryEventId, 'vid:1');
});

test('rejects unsupported evidence and file types', () => {
  assert.throws(
    () => validateEvidenceUploadPayload({ vehicle_id: 'VIN123', evidence_type: 'random_photo', file: pngPayload }, { requireVehicleId: true }),
    /Unsupported evidence type/
  );

  assert.throws(
    () => parseBase64Payload(`data:text/plain;base64,${Buffer.from('nope').toString('base64')}`),
    /Unsupported file type/
  );
});

test('enforces role upload matrix', () => {
  assert.equal(canUploadEvidence('police_clearance_document', 'government'), true);
  assert.equal(canUploadEvidence('police_clearance_document', 'owner'), false);
  assert.equal(canUploadEvidence('dealer_listing_photo', 'dealer'), true);
});

test('normalizes trust-score impact for verification decisions', () => {
  assert.equal(evidenceStatusTrustImpact('verified', 4), 4);
  assert.equal(evidenceStatusTrustImpact('verified', -2), 0);
  assert.equal(evidenceStatusTrustImpact('rejected', 3), 0);
  assert.equal(evidenceStatusTrustImpact('rejected'), -5);
});

test('renders only verified evidence in the visual timeline merge', () => {
  const merged = mergeEventsWithEvidence([
    { id: 'service:1', event_source: 'service', timestamp: '2026-01-03T00:00:00Z', label: 'Service' }
  ], [
    {
      id: 'ev-ok',
      vin: 'VIN123',
      evidence_type: 'odometer_photo',
      file_url: 'https://example.test/odo.png',
      uploader_role: 'dealer',
      uploaded_by: 'u1',
      captured_at: '2026-01-02T00:00:00Z',
      uploaded_at: '2026-01-02T01:00:00Z',
      verification_status: 'verified',
      trust_score_impact: 3,
      linked_registry_event_id: 'vid:1',
      metadata: {}
    },
    {
      id: 'ev-rejected',
      vin: 'VIN123',
      evidence_type: 'damage_photo',
      file_url: 'https://example.test/rejected.png',
      uploader_role: 'dealer',
      uploaded_by: 'u1',
      captured_at: '2026-01-01T00:00:00Z',
      uploaded_at: '2026-01-01T01:00:00Z',
      verification_status: 'rejected',
      trust_score_impact: -5,
      metadata: {}
    }
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'evidence:ev-ok');
  assert.equal(merged.some(item => item.id === 'evidence:ev-rejected'), false);

  const timelineItem = evidenceToTimelineItem({
    id: 'ev-ok',
    evidence_type: 'odometer_photo',
    file_url: 'https://example.test/odo.png',
    verification_status: 'verified',
    captured_at: '2026-01-02T00:00:00Z',
    trust_score_impact: 3,
    metadata: {}
  });
  assert.equal(timelineItem.label, 'Odometer Photo');
});
