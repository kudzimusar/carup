import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {
  canUploadEvidence,
  checksumForBuffer,
  evidenceStatusTrustImpact,
  evidenceToTimelineItem,
  parseBase64Payload,
  validateEvidenceUploadPayload
} from '../services/evidence/evidenceService.js';

function createEvidenceContractApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const evidence = [];
  let trustScore = 70;

  function userContext(req) {
    return {
      id: req.headers['x-user-id'] || null,
      role: req.headers['x-stakeholder-role'] || null
    };
  }

  app.post('/api/evidence/upload', (req, res) => {
    try {
      const context = userContext(req);
      if (!context.id || !context.role) {
        return res.status(401).json({ error: 'Unauthorized. No active user context.' });
      }

      const normalized = validateEvidenceUploadPayload(req.body, { requireVehicleId: true });
      if (!canUploadEvidence(normalized.evidenceType, context.role)) {
        return res.status(403).json({ error: `Forbidden. Role '${context.role}' is not authorized to upload '${normalized.evidenceType}'` });
      }

      const parsed = parseBase64Payload(req.body.file);
      const checksum = checksumForBuffer(parsed.fileBuffer);
      const row = {
        id: `ev-${evidence.length + 1}`,
        vehicle_id: normalized.vehicleId,
        vin: normalized.vehicleId,
        event_type: normalized.eventType || normalized.evidenceType,
        evidence_type: normalized.evidenceType,
        file_url: `https://storage.example.test/${normalized.vehicleId}/${normalized.evidenceType}.png`,
        uploaded_by: context.id,
        uploader_role: context.role,
        captured_at: req.body.captured_at || '2026-01-01T00:00:00Z',
        uploaded_at: '2026-01-01T01:00:00Z',
        verification_status: 'pending',
        verification_notes: null,
        linked_registry_event_id: normalized.linkedRegistryEventId,
        trust_score_impact: 0,
        metadata: normalized.metadata,
        image_hash: checksum,
        checksum
      };
      evidence.push(row);
      return res.status(201).json(row);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/vehicles/:vin/evidence/:evidenceId/verify', (req, res) => {
    const context = userContext(req);
    if (!['admin', 'government'].includes(context.role)) {
      return res.status(403).json({ error: `Forbidden. Role '${context.role}' cannot access this resource.` });
    }

    const row = evidence.find(item => item.vin === req.params.vin && item.id === req.params.evidenceId);
    if (!row) return res.status(404).json({ error: 'Evidence record not found matching this VIN' });

    row.verification_status = 'verified';
    row.verification_notes = req.body.notes || null;
    row.trust_score_impact = evidenceStatusTrustImpact('verified', req.body.trust_score_impact ?? 3);
    trustScore += row.trust_score_impact;
    return res.json({ success: true, evidence: row, trustScore });
  });

  app.patch('/api/vehicles/:vin/evidence/:evidenceId/reject', (req, res) => {
    const context = userContext(req);
    if (!['admin', 'government'].includes(context.role)) {
      return res.status(403).json({ error: `Forbidden. Role '${context.role}' cannot access this resource.` });
    }

    const row = evidence.find(item => item.vin === req.params.vin && item.id === req.params.evidenceId);
    if (!row) return res.status(404).json({ error: 'Evidence record not found matching this VIN' });

    row.verification_status = 'rejected';
    row.verification_notes = req.body.notes || null;
    row.trust_score_impact = evidenceStatusTrustImpact('rejected', req.body.trust_score_impact ?? -5);
    trustScore += row.trust_score_impact;
    return res.json({ success: true, evidence: row, trustScore });
  });

  app.get('/api/vehicles/:vin/evidence/timeline', (req, res) => {
    const timeline = evidence
      .filter(item => item.vin === req.params.vin && item.verification_status === 'verified')
      .map(evidenceToTimelineItem);
    res.json({ vin: req.params.vin, timeline });
  });

  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const pngPayload = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;

test('evidence API uploads, approves, rejects, fetches timeline, and applies trust impact', async () => {
  await withServer(createEvidenceContractApp(), async (baseUrl) => {
    const missingVehicle = await fetch(`${baseUrl}/api/evidence/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'u1', 'x-stakeholder-role': 'dealer' },
      body: JSON.stringify({ evidence_type: 'dealer_listing_photo', file: pngPayload })
    });
    assert.equal(missingVehicle.status, 400);
    assert.match((await missingVehicle.json()).error, /vehicle_id is required/);

    const unsupportedFile = await fetch(`${baseUrl}/api/evidence/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'u1', 'x-stakeholder-role': 'dealer' },
      body: JSON.stringify({
        vehicle_id: 'VIN123',
        evidence_type: 'dealer_listing_photo',
        file: `data:text/plain;base64,${Buffer.from('bad').toString('base64')}`
      })
    });
    assert.equal(unsupportedFile.status, 400);
    assert.match((await unsupportedFile.json()).error, /Unsupported file type/);

    const unauthorized = await fetch(`${baseUrl}/api/evidence/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'u1', 'x-stakeholder-role': 'owner' },
      body: JSON.stringify({ vehicle_id: 'VIN123', evidence_type: 'police_clearance_document', file: pngPayload })
    });
    assert.equal(unauthorized.status, 403);

    const upload = await fetch(`${baseUrl}/api/evidence/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'dealer-1', 'x-stakeholder-role': 'dealer' },
      body: JSON.stringify({
        vehicle_id: 'VIN123',
        event_type: 'dealer_listing',
        evidence_type: 'dealer_listing_photo',
        file: pngPayload,
        linked_registry_event_id: 'listing:1'
      })
    });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json();
    assert.equal(uploaded.verification_status, 'pending');
    assert.ok(uploaded.checksum);

    const approve = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence/${uploaded.id}/verify`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin-1', 'x-stakeholder-role': 'admin' },
      body: JSON.stringify({ notes: 'Matches listing registry event.', trust_score_impact: 4 })
    });
    assert.equal(approve.status, 200);
    const approved = await approve.json();
    assert.equal(approved.evidence.verification_status, 'verified');
    assert.equal(approved.evidence.trust_score_impact, 4);
    assert.equal(approved.trustScore, 74);

    const rejectedUpload = await fetch(`${baseUrl}/api/evidence/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'dealer-1', 'x-stakeholder-role': 'dealer' },
      body: JSON.stringify({ vehicle_id: 'VIN123', evidence_type: 'damage_photo', file: pngPayload })
    });
    const rejectedItem = await rejectedUpload.json();

    const reject = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence/${rejectedItem.id}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin-1', 'x-stakeholder-role': 'admin' },
      body: JSON.stringify({ notes: 'Image does not match VIN.', trust_score_impact: -6 })
    });
    assert.equal(reject.status, 200);
    const rejected = await reject.json();
    assert.equal(rejected.evidence.verification_status, 'rejected');
    assert.equal(rejected.evidence.trust_score_impact, -6);
    assert.equal(rejected.trustScore, 68);

    const timeline = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence/timeline`);
    assert.equal(timeline.status, 200);
    const timelinePayload = await timeline.json();
    assert.equal(timelinePayload.timeline.length, 1);
    assert.equal(timelinePayload.timeline[0].id, `evidence:${uploaded.id}`);
  });
});
