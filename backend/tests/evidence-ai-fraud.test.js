/**
 * Backend integration tests for Vehicle Evidence Phase 4: AI Image Analysis & Fraud Controls.
 *
 * Drives the real Express routers and evidenceService over HTTP with a mocked Supabase database.
 * Verifies all security, trust scoring, duplicate photo, and privacy boundaries.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const vehiclesRouter = (await import('../routes/vehiclesRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
function resetDb() {
  db = {
    users: {
      'owner-1': { id: 'owner-1', role: 'owner', is_verified: true },
      'admin-1': { id: 'admin-1', role: 'admin', is_verified: true },
      'guest-1': { id: 'guest-1', role: 'buyer', is_verified: true }
    },
    user_sessions: {
      'session-owner': { user_id: 'owner-1', token: 'session-owner', is_valid: true },
      'session-admin': { user_id: 'admin-1', token: 'session-admin', is_valid: true }
    },
    vehicles: {
      'VIN123': {
        vin: 'VIN123',
        owner_id: 'owner-1',
        tenant_id: null,
        trust_score: 70,
        plate_number: 'ABC-1234',
        normalized_plate_number: 'ABC1234',
        chassis_number: 'CHAS123',
        engine_number: 'ENG123',
        status: 'active'
      }
    },
    evidence: {
      'ev-existing-duplicate': {
        id: 'ev-existing-duplicate',
        vin: 'VIN123',
        vehicle_id: 'VIN123',
        evidence_type: 'odometer_photo',
        file_url: 'https://storage.test/ev-existing.png',
        verification_status: 'verified',
        checksum: 'duplicate-checksum-sha256',
        image_hash: 'duplicate-checksum-sha256',
        metadata: {},
        trust_score_impact: 3
      }
    }
  };
}

function makeBuilder(table) {
  const state = { table, op: 'select', single: false, filters: {}, neqFilters: {}, payload: undefined };
  const chain = {
    select() { return chain },
    insert(p) { state.op = 'insert'; state.payload = p; return chain },
    update(p) { state.op = 'update'; state.payload = p; return chain },
    eq(k, v) { state.filters[k] = v; return chain },
    neq(k, v) { state.neqFilters[k] = v; return chain },
    is() { return chain },
    in() { return chain },
    order() { return chain },
    limit() { return chain },
    single() { state.single = true; return chain },
    then(resolve, reject) {
      try {
        return Promise.resolve(resolve_(state)).then(resolve, reject);
      } catch (e) {
        return reject ? reject(e) : Promise.reject(e);
      }
    }
  };
  return chain;
}

function resolve_(state) {
  const { table, op, single, filters, neqFilters, payload } = state;
  const ok = (data) => ({ data, error: null });
  const missing = (m) => ({ data: null, error: { message: m } });

  if (op === 'insert') {
    const id = payload.id || `ev-inserted-${Object.keys(db.evidence).length + 1}`;
    const row = { id, ...payload };
    db.evidence[id] = row;
    return ok(row);
  }

  if (op === 'update') {
    const id = filters.id || Object.keys(db.evidence).find(key => db.evidence[key].id === filters.id);
    if (table === 'vehicles') {
      const vin = filters.vin;
      if (db.vehicles[vin]) {
        db.vehicles[vin] = { ...db.vehicles[vin], ...payload };
        return ok(db.vehicles[vin]);
      }
    } else if (table === 'vehicle_evidence') {
      if (db.evidence[id]) {
        db.evidence[id] = { ...db.evidence[id], ...payload };
        return ok(db.evidence[id]);
      }
    }
    return ok({});
  }

  switch (table) {
    case 'users':
      return db.users[filters.id] ? ok(db.users[filters.id]) : missing('User not found');
    case 'user_sessions':
      return db.user_sessions[filters.token] ? ok(db.user_sessions[filters.token]) : missing('Session invalid');
    case 'vehicles':
      return db.vehicles[filters.vin] ? ok(db.vehicles[filters.vin]) : missing('Vehicle not found');
    case 'vehicle_evidence':
      if (single) {
        if (filters.id) {
          return db.evidence[filters.id] ? ok(db.evidence[filters.id]) : missing('Evidence not found');
        }
        return missing('Evidence not found');
      }
      
      let list = Object.values(db.evidence);
      if (filters.vin) list = list.filter(item => item.vin === filters.vin);
      if (filters.checksum) {
        list = list.filter(item => item.checksum === filters.checksum);
      }
      if (neqFilters.id) {
        list = list.filter(item => item.id !== neqFilters.id);
      }
      return ok(list);
    default:
      return ok([]);
  }
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeBuilder(t) });
  
  // Mock Supabase Storage API
  supabase.storage = {
    from(bucketName) {
      return {
        async upload(fileName, buffer, options) {
          return { data: { path: `${bucketName}/${fileName}` }, error: null };
        },
        getPublicUrl(fileName) {
          return { data: { publicUrl: `https://storage.test/${bucketName}/${fileName}` } };
        },
        async createSignedUrl(storagePath, expiresInSeconds) {
          return { data: { signedUrl: `https://storage.test/signed/${storagePath}` }, error: null };
        }
      };
    }
  };

  const app = express();
  app.use(express.json());
  
  // Middleware to establish user context for testing
  app.use((req, res, next) => {
    const userId = req.headers['x-user-id'] || null;
    const role = req.headers['x-stakeholder-role'] || 'guest';
    req.userContext = { id: userId, role, tenantId: req.headers['x-tenant-id'] || null };
    next();
  });

  app.use(vehiclesRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Helper base64 data to upload
const pngPayload = `data:image/png;base64,${Buffer.from('test-image-bytes').toString('base64')}`;

// --- Tests ------------------------------------------------------------------

test('AI Unavailable fails safely without blocking evidence upload flow', async () => {
  // Scenario: simulated provider_error
  const res = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'owner-1',
      'x-stakeholder-role': 'owner'
    },
    body: JSON.stringify({
      evidence_type: 'damage_photo',
      file: pngPayload,
      metadata: { mock_ai_scenario: 'provider_error' }
    })
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.verification_status, 'pending');

  // Wait a short moment for the background worker to write status
  await sleep(100);

  // Check database record updated with provider unavailable status
  const ev = db.evidence[data.id];
  assert.equal(ev.metadata.ai_analysis.ai_status, 'ai_provider_unavailable');
  assert.equal(ev.metadata.ai_analysis.recommended_action, 'inspect');
});

test('AI flagged evidence sets ai_flagged but verification_status remains pending', async () => {
  // Scenario: flagged manipulation
  const res = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'owner-1',
      'x-stakeholder-role': 'owner'
    },
    body: JSON.stringify({
      evidence_type: 'damage_photo',
      file: pngPayload,
      metadata: { mock_ai_scenario: 'flagged_manipulation' }
    })
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.verification_status, 'pending'); // AI cannot approve!

  await sleep(100);

  const ev = db.evidence[data.id];
  assert.equal(ev.metadata.ai_analysis.ai_status, 'ai_flagged');
  assert.equal(ev.metadata.ai_analysis.recommended_action, 'reject');
  assert.equal(ev.metadata.ai_analysis.manipulation_indicators.length, 1);
});

test('Public endpoint sanitizes and does not expose raw AI analysis metadata', async () => {
  // First, upload a photo that passes
  const res = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'owner-1',
      'x-stakeholder-role': 'owner'
    },
    body: JSON.stringify({
      evidence_type: 'damage_photo',
      file: pngPayload
    })
  });
  const data = await res.json();
  
  await sleep(100);

  // Mark as verified by admin (this makes it visible to public)
  db.evidence[data.id].verification_status = 'verified';

  // Request evidence as public buyer (unauthorized context)
  const getRes = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence`, {
    method: 'GET',
    headers: {
      'x-stakeholder-role': 'buyer'
    }
  });

  assert.equal(getRes.status, 200);
  const list = await getRes.json();
  
  // Verify that raw ai_analysis object is NOT present in the metadata
  const item = list.find(e => e.id === data.id);
  assert.ok(item);
  assert.equal(item.metadata.ai_analysis, undefined);
  
  // Exposes public summary
  assert.equal(item.metadata.ai_public_summary, 'AI analysis: image verified clean.');
});

test('Trust score remains unchanged until admin review approval', async () => {
  const baseTrust = db.vehicles['VIN123'].trust_score;

  const res = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'owner-1',
      'x-stakeholder-role': 'owner'
    },
    body: JSON.stringify({
      evidence_type: 'damage_photo',
      file: pngPayload
    })
  });
  assert.equal(res.status, 201);

  await sleep(100);

  // Trust score must still be equal to the baseline
  assert.equal(db.vehicles['VIN123'].trust_score, baseTrust);
});

test('Duplicate photo checksum check flags duplicates automatically', async () => {
  // We upload an item carrying the same checksum as the preset 'ev-existing-duplicate'
  const res = await fetch(`${baseUrl}/api/vehicles/VIN123/evidence/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'owner-1',
      'x-stakeholder-role': 'owner'
    },
    body: JSON.stringify({
      evidence_type: 'odometer_photo',
      file: pngPayload // Computes to same checksum in mock environment
    })
  });
  
  assert.equal(res.status, 201);
  const data = await res.json();

  // Set uploader file checksum to trigger duplicate detection match
  db.evidence[data.id].checksum = 'duplicate-checksum-sha256';

  // Re-run worker logic with preset checksum in database
  const { runAiAnalysis } = await import('../services/evidence/evidenceService.js');
  await runAiAnalysis(data.id, Buffer.from('test-image-bytes'), 'image/png', 'odometer_photo');

  const ev = db.evidence[data.id];
  assert.equal(ev.metadata.ai_analysis.ai_status, 'ai_flagged');
  assert.equal(ev.metadata.ai_analysis.recommended_action, 'reject');
  assert.equal(ev.metadata.ai_analysis.duplicate_match.is_duplicate, true);
  assert.equal(ev.metadata.ai_analysis.duplicate_match.original_evidence_id, 'ev-existing-duplicate');
});
