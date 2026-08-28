import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PASSPORT_AUDIENCES } from '../services/passport/passportContract.js';
import {
  buildPassportServicePartsSection,
  canProjectPartSentryPublicly,
  projectOwnerServiceRecord,
  projectPartSentryRecord,
  projectWorkOrderServiceRecord,
} from '../services/passport/passportServicePartsProjection.js';

test('V8: public work-order projection never includes free text or customer identity', () => {
  const item = projectWorkOrderServiceRecord({
    id: 'wo-1',
    status: 'Completed',
    total_cost: 120,
    currency: 'USD',
    description: 'Customer says gearbox makes a noise.',
    issue_description: 'Private free text.',
    customer_name: 'Private Customer',
    customer_id: 'user-private',
    tenant_id: 'garage-private',
    created_at: '2026-08-01T10:00:00Z',
  });

  const rendered = JSON.stringify(item);
  for (const value of ['gearbox makes a noise', 'Private free text', 'Private Customer', 'user-private', 'garage-private']) {
    assert.equal(rendered.includes(value), false);
  }
  assert.equal(item.status, 'Completed');
  assert.equal(item.total_cost, null);
});

test('V8: owner may see controlled work-order cost but still no customer/free-text fields', () => {
  const item = projectWorkOrderServiceRecord({
    id: 'wo-1',
    status: 'Completed',
    total_cost: 120,
    currency: 'USD',
    description: 'private note',
    customer_name: 'private person',
  }, { audience: PASSPORT_AUDIENCES.OWNER });

  assert.equal(item.total_cost, 120);
  assert.equal(item.currency, 'USD');
  assert.equal(item.description, undefined);
  assert.equal(item.customer_name, undefined);
});

test('V8: PartSentry public projection requires public-card eligibility and a known-safe suspicion state', () => {
  assert.equal(canProjectPartSentryPublicly({
    public_card_eligible: true,
    suspicion_status: 'cleared',
  }), true);

  assert.equal(canProjectPartSentryPublicly({
    public_card_eligible: true,
    suspicion_status: 'watch',
  }), false);

  assert.equal(canProjectPartSentryPublicly({
    public_card_eligible: true,
    suspicion_status: 'future_unknown_state',
  }), false);
});

test('V8: public PartSentry projection cannot expose active/unknown suspicion records', () => {
  assert.equal(projectPartSentryRecord({
    id: 1,
    public_card_eligible: true,
    suspicion_status: 'flagged',
  }), null);

  assert.equal(projectPartSentryRecord({
    id: 2,
    public_card_eligible: false,
    suspicion_status: 'none',
  }), null);
});

test('V8: owner can see a non-public PartSentry record with its status explicitly labelled', () => {
  const item = projectPartSentryRecord({
    id: 3,
    public_card_eligible: false,
    suspicion_status: 'watch',
    part_name: 'Brake pads',
    part_oem: 'OEM-1',
    action_type: 'replaced',
    verification_status: 'disputed',
    part_verification_status: 'unverified',
  }, { audience: PASSPORT_AUDIENCES.OWNER });

  assert.equal(item.part_name, 'Brake pads');
  assert.equal(item.suspicion_status, 'watch');
  assert.equal(item.verification_status, 'disputed');
});

test('V8: owner/DIY service remains owner-declared and cannot appear publicly', () => {
  const record = {
    id: 'owner-service-1',
    summary: 'Oil changed at home.',
    mileage: 50000,
  };

  assert.equal(projectOwnerServiceRecord(record, { audience: PASSPORT_AUDIENCES.PUBLIC }), null);

  const owner = projectOwnerServiceRecord(record, { audience: PASSPORT_AUDIENCES.OWNER });
  assert.equal(owner.authority, 'owner_declared');
  assert.equal(owner.summary, 'Oil changed at home.');
});

test('V8: sparse service history remains explicitly partial/unknown', () => {
  const result = buildPassportServicePartsSection({
    coverageState: 'partial',
    limitations: ['Only CarUp-era service records are connected.'],
  });

  assert.equal(result.state, 'partial');
  assert.deepEqual(result.limitations, ['Only CarUp-era service records are connected.']);
});

test('V8: service/PartSentry projection contains no Trust stamp or database writer', () => {
  const src = readFileSync('backend/services/passport/passportServicePartsProjection.js', 'utf8');
  assert.doesNotMatch(src, /trust_score|trusted\s*:/i);
  assert.doesNotMatch(src, /calculateVehicleTrustScore|refreshCanonicalTrust/);
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
});

test('V8: source strength remains explicit rather than becoming verified by record type', () => {
  const professional = projectWorkOrderServiceRecord({
    id: 'wo-2',
    authority: 'professional_governed',
  });
  const owner = projectOwnerServiceRecord({
    id: 'owner-2',
  }, { audience: PASSPORT_AUDIENCES.OWNER });

  assert.equal(professional.authority, 'professional_governed');
  assert.equal(owner.authority, 'owner_declared');
});
