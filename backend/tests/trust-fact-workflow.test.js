import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  approveTrustFactRequest,
  createTrustFactRequest,
  getTrustFactAuditTrail,
  listTrustFactReviewQueue,
  rejectTrustFactRequest,
  revokeTrustFactRequest,
  validatePhase2ATrustFactPayload,
} = await import('../services/trustGovernance/trustFactWorkflowService.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.inFilters = [];
    this.neqFilters = [];
    this.orderSpec = null;
    this.limitValue = null;
    this.operation = 'select';
    this.payload = null;
  }

  select() {
    return this;
  }

  eq(key, value) {
    this.filters.push({ key, value });
    return this;
  }

  neq(key, value) {
    this.neqFilters.push({ key, value });
    return this;
  }

  in(key, values) {
    this.inFilters.push({ key, values });
    return this;
  }

  order(column, options = {}) {
    this.orderSpec = { column, ascending: options.ascending !== false };
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  insert(payload) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  maybeSingle() {
    return this.execute({ single: true, maybe: true });
  }

  single() {
    return this.execute({ single: true, maybe: false });
  }

  then(resolve, reject) {
    return this.execute({ single: false, maybe: false }).then(resolve, reject);
  }

  rows() {
    return this.client.data[this.table] || [];
  }

  matches(row) {
    return this.filters.every(filter => row[filter.key] === filter.value) &&
      this.inFilters.every(filter => filter.values.includes(row[filter.key])) &&
      this.neqFilters.every(filter => row[filter.key] !== filter.value);
  }

  async execute({ single, maybe }) {
    if ((this.table === 'trust_audit_events' || this.table === 'organization_audit_logs') && this.client.failAudit && this.operation === 'insert') {
      return { data: null, error: { message: `${this.table} failed` } };
    }

    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map(row => ({
        id: row.id || `${this.table}-${++this.client.sequence}`,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString(),
        ...clone(row),
      }));
      this.client.data[this.table].push(...inserted);
      return single ? { data: clone(inserted[0]), error: null } : { data: clone(inserted), error: null };
    }

    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) {
          Object.assign(row, clone(this.payload));
          updated.push(clone(row));
        }
      }
      if (single) {
        if (!updated.length && !maybe) return { data: null, error: { message: 'No rows updated' } };
        return { data: updated[0] || null, error: null };
      }
      return { data: updated, error: null };
    }

    let rows = this.rows().filter(row => this.matches(row)).map(clone);
    if (this.orderSpec) {
      rows.sort((a, b) => {
        const av = a[this.orderSpec.column] || '';
        const bv = b[this.orderSpec.column] || '';
        return this.orderSpec.ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    if (this.limitValue !== null) rows = rows.slice(0, this.limitValue);

    if (single) {
      if (!rows.length && !maybe) return { data: null, error: { message: 'No rows found' } };
      return { data: rows[0] || null, error: null };
    }

    return { data: rows, error: null };
  }
}

function createMockClient() {
  const data = {
    vehicles: [
      {
        vin: 'VIN1',
        owner_id: 'owner-1',
        tenant_id: 'tenant-1',
        vehicle_condition_category: 'unknown',
        passport_verified: false,
        passport_verified_at: null,
        passport_verification_source: null,
        inspection_ready: false,
      },
      {
        vin: 'VIN2',
        owner_id: 'owner-2',
        tenant_id: 'tenant-2',
        vehicle_condition_category: 'unknown',
        passport_verified: false,
        passport_verified_at: null,
        passport_verification_source: null,
        inspection_ready: false,
      },
    ],
    vehicle_evidence: [
      { id: 'ev-condition', vin: 'VIN1', evidence_type: 'dealer_listing_photo', verification_status: 'verified', visibility_level: 'public_safe' },
      { id: 'ev-reg', vin: 'VIN1', evidence_type: 'registration_document', verification_status: 'verified', visibility_level: 'restricted' },
      { id: 'ev-inspection', vin: 'VIN1', evidence_type: 'inspection_photo', verification_status: 'verified', visibility_level: 'public_safe' },
      { id: 'ev-other-vin', vin: 'VIN2', evidence_type: 'registration_document', verification_status: 'verified', visibility_level: 'restricted' },
      { id: 'ev-pending', vin: 'VIN1', evidence_type: 'registration_document', verification_status: 'pending', visibility_level: 'restricted' },
    ],
    trust_fact_requests: [],
    trust_audit_events: [],
    organization_audit_logs: [],
    organization_users: [],
  };

  return {
    data,
    sequence: 0,
    failAudit: false,
    from(table) {
      if (!this.data[table]) this.data[table] = [];
      return new MockQuery(this, table);
    },
  };
}

const owner = { id: 'owner-1', role: 'owner', tenantId: null };
const otherOwner = { id: 'owner-3', role: 'owner', tenantId: null };
const dealer = { id: 'dealer-1', role: 'dealer', tenantId: 'tenant-1' };
const otherDealer = { id: 'dealer-2', role: 'dealer', tenantId: 'tenant-x' };
const admin = { id: 'admin-1', role: 'admin', tenantId: null };
const government = { id: 'gov-1', role: 'government', tenantId: null };

test('validates Phase 2A trust fact payloads', () => {
  assert.deepEqual(validatePhase2ATrustFactPayload('vehicle_condition_category', { condition_category: 'brand_new' }), { condition_category: 'brand_new' });
  assert.deepEqual(validatePhase2ATrustFactPayload('passport_verified', { passport_verified: true }), { passport_verified: true });
  assert.deepEqual(validatePhase2ATrustFactPayload('inspection_ready', { inspection_ready: true }), { inspection_ready: true });
  assert.throws(() => validatePhase2ATrustFactPayload('zimra_verified', { zimra_verified: true }), /Unsupported/);
  assert.throws(() => validatePhase2ATrustFactPayload('vehicle_condition_category', { condition_category: 'nearly_new' }), /Invalid/);
});

test('owner can request for owned vehicle and cannot request for another owner vehicle', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Registration document ready for Passport review',
  });
  assert.equal(request.status, 'pending');
  assert.equal(client.data.trust_audit_events.at(-1).event_type, 'TRUST_FACT_CHANGE_REQUESTED');

  await assert.rejects(
    () => createTrustFactRequest(client, otherOwner, 'VIN1', {
      trust_fact: 'inspection_ready',
      requested_value: { inspection_ready: true },
      evidence_ids: ['ev-inspection'],
      reason: 'Inspection evidence ready',
    }),
    /vehicle scope/
  );
});

test('dealer can request for tenant vehicle and cannot request non-tenant vehicle', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, dealer, 'VIN1', {
    trust_fact: 'inspection_ready',
    requested_value: { inspection_ready: true },
    evidence_ids: ['ev-inspection'],
    reason: 'Inspection completed by dealer',
  });
  assert.equal(request.requested_by_role, 'dealer');

  await assert.rejects(
    () => createTrustFactRequest(client, otherDealer, 'VIN1', {
      trust_fact: 'passport_verified',
      requested_value: { passport_verified: true },
      evidence_ids: ['ev-reg'],
      reason: 'Out of tenant scope',
    }),
    /vehicle scope/
  );
});

test('request validation rejects invalid fact, invalid value, missing reason, missing evidence, and duplicate pending requests', async () => {
  const client = createMockClient();
  await assert.rejects(() => createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'dealer_verified',
    requested_value: { dealer_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Bad fact',
  }), /Unsupported/);

  await assert.rejects(() => createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: false },
    evidence_ids: ['ev-reg'],
    reason: 'Bad value',
  }), /must set passport_verified to true/);

  await assert.rejects(() => createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
  }), /Reason is required/);

  await assert.rejects(() => createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    reason: 'No evidence',
  }), /evidence_id/);

  await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'First request',
  });
  await assert.rejects(() => createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Duplicate request',
  }), /pending request/);
});

test('admin approves vehicle_condition_category with reason and writes audit events', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'vehicle_condition_category',
    requested_value: { condition_category: 'brand_new' },
    evidence_ids: ['ev-condition'],
    reason: 'Vehicle listing evidence supports brand new category',
  });

  const result = await approveTrustFactRequest(client, admin, request.id, { reason: 'Reviewed condition evidence' });
  assert.equal(result.request.status, 'approved');
  assert.equal(client.data.vehicles[0].vehicle_condition_category, 'brand_new');
  assert.ok(client.data.trust_audit_events.some(event => event.event_type === 'TRUST_FACT_APPROVED'));
  assert.ok(client.data.trust_audit_events.some(event => event.event_type === 'VEHICLE_CONDITION_CATEGORY_SET'));
});

test('government cannot approve vehicle_condition_category', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'vehicle_condition_category',
    requested_value: { condition_category: 'brand_new' },
    evidence_ids: ['ev-condition'],
    reason: 'Vehicle listing evidence supports brand new category',
  });

  await assert.rejects(
    () => approveTrustFactRequest(client, government, request.id, { reason: 'Government should not approve condition' }),
    /Government cannot/
  );
});

test('government can approve passport_verified and inspection_ready with verified evidence', async () => {
  const client = createMockClient();
  const passportRequest = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Registration evidence ready',
  });
  await approveTrustFactRequest(client, government, passportRequest.id, { reason: 'Registration document verified' });
  assert.equal(client.data.vehicles[0].passport_verified, true);

  const inspectionRequest = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'inspection_ready',
    requested_value: { inspection_ready: true },
    evidence_ids: ['ev-inspection'],
    reason: 'Inspection evidence ready',
  });
  await approveTrustFactRequest(client, government, inspectionRequest.id, { reason: 'Inspection photo verified' });
  assert.equal(client.data.vehicles[0].inspection_ready, true);
});

test('approval rejects evidence from another VIN or unverified evidence', async () => {
  const client = createMockClient();
  const otherVinEvidence = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-other-vin'],
    reason: 'Wrong evidence VIN',
  });
  await assert.rejects(() => approveTrustFactRequest(client, admin, otherVinEvidence.id, { reason: 'Review' }), /match the request VIN/);

  const secondClient = createMockClient();
  const pendingEvidence = await createTrustFactRequest(secondClient, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-pending'],
    reason: 'Pending evidence',
  });
  await assert.rejects(() => approveTrustFactRequest(secondClient, admin, pendingEvidence.id, { reason: 'Review' }), /verified evidence/);
});

test('rejection does not mutate vehicles and writes audit event', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'inspection_ready',
    requested_value: { inspection_ready: true },
    evidence_ids: ['ev-inspection'],
    reason: 'Inspection evidence ready',
  });
  await rejectTrustFactRequest(client, admin, request.id, { reason: 'Evidence needs clearer image' });
  assert.equal(client.data.vehicles[0].inspection_ready, false);
  assert.equal(client.data.trust_fact_requests[0].status, 'rejected');
  assert.ok(client.data.trust_audit_events.some(event => event.event_type === 'TRUST_FACT_REJECTED'));
});

test('revocation mutates vehicles back and writes audit events', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Registration evidence ready',
  });
  await approveTrustFactRequest(client, admin, request.id, { reason: 'Approved Passport evidence' });
  assert.equal(client.data.vehicles[0].passport_verified, true);

  await revokeTrustFactRequest(client, admin, request.id, { reason: 'Passport evidence was superseded' });
  assert.equal(client.data.vehicles[0].passport_verified, false);
  assert.equal(client.data.trust_fact_requests[0].status, 'revoked');
  assert.ok(client.data.trust_audit_events.some(event => event.event_type === 'TRUST_FACT_REVOKED'));
  assert.ok(client.data.trust_audit_events.some(event => event.event_type === 'PASSPORT_VERIFICATION_REVOKED'));
});

test('self-approval is rejected for non-admin reviewers', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, government, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Government submitted request',
  });
  await assert.rejects(() => approveTrustFactRequest(client, government, request.id, { reason: 'Self review' }), /Self-review/);
});

test('audit failure blocks approval before vehicle mutation', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'inspection_ready',
    requested_value: { inspection_ready: true },
    evidence_ids: ['ev-inspection'],
    reason: 'Inspection evidence ready',
  });

  client.failAudit = true;
  await assert.rejects(() => approveTrustFactRequest(client, admin, request.id, { reason: 'Audit should fail' }), /Audit logging failed/);
  assert.equal(client.data.vehicles[0].inspection_ready, false);
  assert.equal(client.data.trust_fact_requests[0].status, 'pending');
});

test('audit failure blocks request creation before pending row mutation', async () => {
  const client = createMockClient();
  client.failAudit = true;

  await assert.rejects(() => createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Audit should fail before request creation',
  }), /Audit logging failed/);

  assert.equal(client.data.trust_fact_requests.length, 0);
});

test('review queue scopes admin and government correctly', async () => {
  const client = createMockClient();
  await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'vehicle_condition_category',
    requested_value: { condition_category: 'brand_new' },
    evidence_ids: ['ev-condition'],
    reason: 'Condition category review',
  });
  await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Passport review',
  });

  const adminQueue = await listTrustFactReviewQueue(client, admin, { status: 'pending' });
  assert.equal(adminQueue.length, 2);
  const govQueue = await listTrustFactReviewQueue(client, government, { status: 'pending' });
  assert.equal(govQueue.length, 1);
  assert.equal(govQueue[0].trust_fact, 'passport_verified');
});

test('audit trail returns safe summaries without actor user IDs or PII fields', async () => {
  const client = createMockClient();
  const request = await createTrustFactRequest(client, owner, 'VIN1', {
    trust_fact: 'passport_verified',
    requested_value: { passport_verified: true },
    evidence_ids: ['ev-reg'],
    reason: 'Passport review',
  });
  await approveTrustFactRequest(client, admin, request.id, { reason: 'Passport approved' });

  const events = await getTrustFactAuditTrail(client, owner, 'VIN1');
  assert.ok(events.length > 0);
  assert.equal('actor_user_id' in events[0], false);
  assert.equal('phone' in events[0], false);
  assert.equal('email' in events[0], false);
  assert.equal(events[0].decision_notes, null);
});
