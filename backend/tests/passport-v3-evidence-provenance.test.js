import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PASSPORT_AUDIENCES } from '../services/passport/passportContract.js';
import {
  buildPassportEvidenceSection,
  canAudienceSeeEvidence,
  projectPassportEvidence,
} from '../services/passport/passportEvidenceProjection.js';

const baseEvidence = {
  id: 'evidence-1',
  vin: 'CARUPPASSPORT0001',
  plate_number: 'PLATE-VALUE',
  chassis_number: 'CHASSIS-VALUE',
  engine_number: 'ENGINE-VALUE',
  evidence_type: 'registration_document',
  file_url: 'https://example.test/evidence-1',
  storage_bucket: 'documents-bucket',
  file_path: 'documents/evidence-1.pdf',
  mime_type: 'application/pdf',
  uploaded_by: 'user-a',
  uploader_role: 'owner',
  tenant_id: 'tenant-a',
  captured_at: '2026-08-20T10:00:00Z',
  uploaded_at: '2026-08-20T10:01:00Z',
  source_name: 'Registration evidence',
  source_reference: 'REG-1',
  verification_status: 'verified',
  verification_notes: 'Matches canonical VIN.',
  visibility_level: 'public_safe',
  verified_by: 'user-b',
  verified_at: '2026-08-21T10:00:00Z',
  trust_impact: 99,
  trust_score_impact: 99,
  confidence_impact: 1,
  checksum: 'checksum-value',
};

const provenance = [{
  evidence_id: 'evidence-1',
  event_type: 'approved',
  actor_user_id: 'user-c',
  actor_role: 'admin',
  actor_type: 'user',
  ip_address: 'address-value',
  created_at: '2026-08-21T10:00:00Z',
  sequence: 2,
}];

test('V3: public Passport receives only verified public-safe evidence', () => {
  assert.equal(canAudienceSeeEvidence(baseEvidence, PASSPORT_AUDIENCES.PUBLIC), true);
  assert.equal(
    canAudienceSeeEvidence({ ...baseEvidence, verification_status: 'pending' }, PASSPORT_AUDIENCES.PUBLIC),
    false,
  );
  assert.equal(
    canAudienceSeeEvidence({ ...baseEvidence, visibility_level: 'restricted' }, PASSPORT_AUDIENCES.PUBLIC),
    false,
  );
});

test('V3: public evidence projection is whitelist-based and strips private/internal fields', () => {
  const item = projectPassportEvidence(baseEvidence, {
    audience: PASSPORT_AUDIENCES.PUBLIC,
    provenanceEvents: provenance,
  });

  assert.equal(item.evidence_id, 'evidence-1');
  assert.equal(item.evidence_class, 'ownership_transfer');
  assert.equal(item.verification_status, 'verified');

  const rendered = JSON.stringify(item);
  for (const value of [
    'PLATE-VALUE',
    'CHASSIS-VALUE',
    'ENGINE-VALUE',
    'documents/evidence-1.pdf',
    'user-a',
    'tenant-a',
    'user-b',
    'user-c',
    'address-value',
  ]) {
    assert.equal(rendered.includes(value), false, `${value} must not reach public Passport evidence`);
  }
});

test('V3: Passport evidence never republishes per-evidence Trust impact', () => {
  const item = projectPassportEvidence(baseEvidence, {
    audience: PASSPORT_AUDIENCES.OWNER,
  });

  assert.equal(item.trust_impact, undefined);
  assert.equal(item.trust_score_impact, undefined);
  assert.equal(item.confidence_impact, undefined);
});

test('V3: owner may see private/restricted evidence but not government-only evidence', () => {
  assert.ok(projectPassportEvidence(
    { ...baseEvidence, visibility_level: 'private', verification_status: 'pending' },
    { audience: PASSPORT_AUDIENCES.OWNER },
  ));
  assert.ok(projectPassportEvidence(
    { ...baseEvidence, visibility_level: 'restricted', verification_status: 'disputed' },
    { audience: PASSPORT_AUDIENCES.OWNER },
  ));
  assert.equal(projectPassportEvidence(
    { ...baseEvidence, visibility_level: 'government_only' },
    { audience: PASSPORT_AUDIENCES.OWNER },
  ), null);
});

test('V3: governance may inspect government-only evidence without raw provenance actor/IP fields', () => {
  const item = projectPassportEvidence(
    { ...baseEvidence, visibility_level: 'government_only' },
    { audience: PASSPORT_AUDIENCES.GOVERNANCE, provenanceEvents: provenance },
  );

  assert.ok(item);
  assert.equal(item.provenance[0].event_type, 'approved');
  assert.equal(item.provenance[0].actor_role, 'admin');
  assert.equal(item.provenance[0].actor_user_id, undefined);
  assert.equal(item.provenance[0].ip_address, undefined);
});

test('V3: evidence section preserves sparse state instead of inventing a clean record', () => {
  const section = buildPassportEvidenceSection([], {
    audience: PASSPORT_AUDIENCES.PUBLIC,
  });
  assert.equal(section.state, 'unknown');
  assert.equal(section.count, 0);
  assert.deepEqual(section.items, []);

  const unavailable = buildPassportEvidenceSection([], {
    audience: PASSPORT_AUDIENCES.PUBLIC,
    collectionState: 'unavailable',
  });
  assert.equal(unavailable.state, 'unavailable');
});

test('V3: superseded/disputed evidence remains explicit for authorized audiences', () => {
  const disputed = projectPassportEvidence(
    { ...baseEvidence, visibility_level: 'private', verification_status: 'disputed' },
    { audience: PASSPORT_AUDIENCES.OWNER },
  );
  const superseded = projectPassportEvidence(
    { ...baseEvidence, visibility_level: 'private', verification_status: 'superseded' },
    { audience: PASSPORT_AUDIENCES.OWNER },
  );

  assert.equal(disputed.verification_status, 'disputed');
  assert.equal(superseded.verification_status, 'superseded');
});

test('V3 anti-fork: projection reuses canonical evidence contracts and owns no database or Trust engine', () => {
  const src = readFileSync('backend/services/passport/passportEvidenceProjection.js', 'utf8');
  assert.match(src, /evidenceTaxonomy\.js/);
  assert.match(src, /provenanceService\.js/);
  assert.doesNotMatch(src, /\.from\s*\(|supabase/i);
  assert.doesNotMatch(src, /calculateVehicleTrustScore|computeVehicleTrustScore|trustDecisionService/i);
  assert.doesNotMatch(src, /trust_impact\s*:|trust_score_impact\s*:|confidence_impact\s*:/);
});
