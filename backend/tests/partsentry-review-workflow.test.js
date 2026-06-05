import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvePartSentryReviewRequest,
  createPartSentryReviewRequest,
  flagPartSentrySuspicion,
  listPartSentryReviewQueue,
  rejectPartSentryReviewRequest,
  revokePartSentryReviewRequest,
  validatePartSentryReviewPayload,
} from '../services/trustGovernance/partsentryReviewService.js';

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
      { vin: 'VIN1', owner_id: 'owner-1', tenant_id: 'tenant-1' },
      { vin: 'VIN2', owner_id: 'owner-2', tenant_id: 'tenant-2' },
    ],
    partsentry_logs: [
      {
        id: 101,
        vin: 'VIN1',
        mechanic_id: 'mech-1',
        part_name: 'Brake pads',
        part_oem: 'OEM-123',
        action_type: 'Replaced',
        mileage: 45000,
        timestamp: '2026-06-01T00:00:00Z',
        verification_status: 'unverified',
        part_verification_status: 'unverified',
        suspicion_status: 'none',
        public_card_eligible: false,
      },
      {
        id: 102,
        vin: 'VIN1',
        mechanic_id: 'admin-1',
        part_name: 'Air filter',
        part_oem: 'OEM-999',
        action_type: 'Inspected',
        mileage: 46000,
        timestamp: '2026-06-02T00:00:00Z',
        verification_status: 'unverified',
        part_verification_status: 'unverified',
        suspicion_status: 'none',
        public_card_eligible: false,
      },
      {
        id: 103,
        vin: 'VIN2',
        mechanic_id: 'mech-2',
        part_name: 'Battery',
        part_oem: '',
        action_type: 'Replaced',
        mileage: 20000,
        timestamp: '2026-06-03T00:00:00Z',
        verification_status: 'unverified',
        part_verification_status: 'unverified',
        suspicion_status: 'flagged',
        public_card_eligible: false,
      },
    ],
    vehicle_evidence: [
      { id: 'ev-part', vin: 'VIN1', evidence_type: 'parts_invoice', verification_status: 'verified', visibility_level: 'restricted' },
      { id: 'ev-work', vin: 'VIN1', evidence_type: 'work_order', verification_status: 'verified', visibility_level: 'restricted' },
      { id: 'ev-unverified', vin: 'VIN1', evidence_type: 'parts_invoice', verification_status: 'pending', visibility_level: 'restricted' },
      { id: 'ev-other-vin', vin: 'VIN2', evidence_type: 'parts_invoice', verification_status: 'verified', visibility_level: 'restricted' },
    ],
    partsentry_review_requests: [],
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

const mechanic = { id: 'mech-1', role: 'mechanic' };
const owner = { id: 'owner-1', role: 'owner' };
const otherOwner = { id: 'owner-x', role: 'owner' };
const dealer = { id: 'dealer-1', role: 'dealer', tenantId: 'tenant-1' };
const otherDealer = { id: 'dealer-x', role: 'dealer', tenantId: 'tenant-x' };
const admin = { id: 'admin-1', role: 'admin' };
const government = { id: 'gov-1', role: 'government' };

test('validates PartSentry review payloads', () => {
  assert.deepEqual(validatePartSentryReviewPayload('public_card_eligible', { public_card_eligible: true }), { public_card_eligible: true });
  assert.deepEqual(validatePartSentryReviewPayload('verification_status', { verification_status: 'verified' }), { verification_status: 'verified' });
  assert.deepEqual(validatePartSentryReviewPayload('part_verification_status', { part_verification_status: 'disputed' }), { part_verification_status: 'disputed' });
  assert.deepEqual(validatePartSentryReviewPayload('suspicion_status', { suspicion_status: 'flagged' }), { suspicion_status: 'flagged' });
  assert.throws(() => validatePartSentryReviewPayload('public_card_eligible', { public_card_eligible: false }), /must set/);
  assert.throws(() => validatePartSentryReviewPayload('verification_status', { verification_status: 'pending' }), /Invalid/);
});

test('mechanic can request review for own log', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, mechanic, 101, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Ready for public card review',
  });

  assert.equal(request.status, 'pending');
  assert.equal(request.requested_by_role, 'mechanic');
  assert.equal(client.data.trust_audit_events.at(-1).event_type, 'PARTSENTRY_REVIEW_REQUESTED');
});

test('owner can request only for owned VIN log', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, owner, 101, {
    request_type: 'verification_status',
    requested_value: { verification_status: 'verified' },
    evidence_ids: ['ev-work'],
    reason: 'Owner wants service log verified',
  });
  assert.equal(request.requested_by_role, 'owner');

  await assert.rejects(
    () => createPartSentryReviewRequest(client, otherOwner, 101, {
      request_type: 'verification_status',
      requested_value: { verification_status: 'verified' },
      reason: 'Out of scope',
    }),
    /owned vehicles|scope/
  );
});

test('dealer can request only for tenant VIN log', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, dealer, 101, {
    request_type: 'verification_status',
    requested_value: { verification_status: 'verified' },
    reason: 'Tenant vehicle service log',
  });
  assert.equal(request.requested_by_role, 'dealer');

  await assert.rejects(
    () => createPartSentryReviewRequest(client, otherDealer, 101, {
      request_type: 'verification_status',
      requested_value: { verification_status: 'verified' },
      reason: 'Out of tenant scope',
    }),
    /tenant vehicles|scope/
  );
});

test('admin can approve public_card_eligible', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, mechanic, 101, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Complete service log',
  });

  const result = await approvePartSentryReviewRequest(client, admin, request.id, {
    decision_notes: 'PartSentry log is public-card safe',
  });

  assert.equal(result.request.status, 'approved');
  assert.equal(client.data.partsentry_logs.find(row => row.id === 101).public_card_eligible, true);
  assert.equal(client.data.trust_audit_events.at(-1).event_type, 'PARTSENTRY_PUBLIC_CARD_ELIGIBILITY_APPROVED');
});

test('admin can reject with required decision notes', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, mechanic, 101, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Needs review',
  });

  await assert.rejects(() => rejectPartSentryReviewRequest(client, admin, request.id, {}), /decision_notes/);
  const rejected = await rejectPartSentryReviewRequest(client, admin, request.id, {
    decision_notes: 'Missing public-safe notes',
  });
  assert.equal(rejected.status, 'rejected');
});

test('admin can revoke public_card_eligible', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, mechanic, 101, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Complete service log',
  });
  await approvePartSentryReviewRequest(client, admin, request.id, {
    decision_notes: 'Approved',
  });

  const revoked = await revokePartSentryReviewRequest(client, admin, request.id, {
    decision_notes: 'New dispute opened',
  });

  assert.equal(revoked.status, 'revoked');
  assert.equal(client.data.partsentry_logs.find(row => row.id === 101).public_card_eligible, false);
});

test('mechanic cannot approve own log and government cannot approve routine PartSentry facts', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, mechanic, 101, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Complete service log',
  });

  await assert.rejects(
    () => approvePartSentryReviewRequest(client, mechanic, request.id, { decision_notes: 'Self approve' }),
    /Mechanic cannot/
  );
  await assert.rejects(
    () => approvePartSentryReviewRequest(client, government, request.id, { decision_notes: 'Government approve' }),
    /Government cannot/
  );
});

test('reviewer self-approval is blocked when actor id equals mechanic id', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, admin, 102, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Admin-submitted mechanic log',
  });

  await assert.rejects(
    () => approvePartSentryReviewRequest(client, admin, request.id, { decision_notes: 'Approve own mechanic record' }),
    /own PartSentry log/
  );
});

test('public_card_eligible approval requires no active suspicion', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, { id: 'admin-2', role: 'admin' }, 103, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Try flagged log',
  });

  await assert.rejects(
    () => approvePartSentryReviewRequest(client, admin, request.id, { decision_notes: 'Approve flagged log' }),
    /blocked/
  );
});

test('verified parts approval requires verified part evidence', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, mechanic, 101, {
    request_type: 'part_verification_status',
    requested_value: { part_verification_status: 'verified' },
    evidence_ids: ['ev-part'],
    reason: 'Verified invoice attached',
  });

  await approvePartSentryReviewRequest(client, admin, request.id, {
    decision_notes: 'Invoice verified',
  });
  assert.equal(client.data.partsentry_logs.find(row => row.id === 101).part_verification_status, 'verified');

  const badClient = createMockClient();
  const badRequest = await createPartSentryReviewRequest(badClient, mechanic, 101, {
    request_type: 'part_verification_status',
    requested_value: { part_verification_status: 'verified' },
    evidence_ids: ['ev-unverified'],
    reason: 'Bad invoice evidence',
  });
  await assert.rejects(
    () => approvePartSentryReviewRequest(badClient, admin, badRequest.id, { decision_notes: 'Approve bad evidence' }),
    /verified part provenance/
  );
});

test('audit failure blocks mutation', async () => {
  const client = createMockClient();
  const request = await createPartSentryReviewRequest(client, mechanic, 101, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Ready for review',
  });

  client.failAudit = true;
  await assert.rejects(
    () => approvePartSentryReviewRequest(client, admin, request.id, { decision_notes: 'Audit fails' }),
    /Audit logging failed/
  );
  assert.equal(client.data.partsentry_logs.find(row => row.id === 101).public_card_eligible, false);
});

test('flagging suspicion disables public_card_eligible', async () => {
  const client = createMockClient();
  client.data.partsentry_logs.find(row => row.id === 101).public_card_eligible = true;

  await flagPartSentrySuspicion(client, admin, 101, {
    suspicion_status: 'flagged',
    decision_notes: 'Suspicious invoice pattern',
  });

  const log = client.data.partsentry_logs.find(row => row.id === 101);
  assert.equal(log.suspicion_status, 'flagged');
  assert.equal(log.public_card_eligible, false);
  assert.equal(client.data.trust_audit_events.at(-1).event_type, 'PARTSENTRY_SUSPICION_FLAGGED');
});

test('review queue returns safe fields only', async () => {
  const client = createMockClient();
  await createPartSentryReviewRequest(client, mechanic, 101, {
    request_type: 'public_card_eligible',
    requested_value: { public_card_eligible: true },
    reason: 'Queue item',
  });

  const queue = await listPartSentryReviewQueue(client, admin, { status: 'pending' });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].vin, 'VIN1');
  assert.equal(queue[0].request_type, 'public_card_eligible');
  assert.equal('requested_by' in queue[0], false);
  assert.equal('reviewed_by' in queue[0], false);
  assert.equal('mechanic_id' in queue[0], false);
});
