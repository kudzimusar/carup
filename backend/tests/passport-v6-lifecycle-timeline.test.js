import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PASSPORT_AUDIENCES,
  PASSPORT_VISIBILITY,
} from '../services/passport/passportContract.js';
import {
  PASSPORT_LIFECYCLE_CATEGORIES,
  buildUnifiedLifecycleTimeline,
} from '../services/passport/passportLifecycleTimeline.js';

const events = [
  {
    id: 'old-service',
    category: 'service',
    kind: 'service_recorded',
    occurred_at: '2026-08-10T10:00:00Z',
    source_type: 'mechanic_work_order',
    source_ref: 'wo-1',
    visibility: PASSPORT_VISIBILITY.PUBLIC,
    public_summary: 'Service record available.',
  },
  {
    id: 'corrected-service',
    category: 'service',
    kind: 'service_record_corrected',
    occurred_at: '2026-08-11T10:00:00Z',
    source_type: 'service_correction',
    source_ref: 'corr-1',
    visibility: PASSPORT_VISIBILITY.PUBLIC,
    public_summary: 'Service record corrected.',
    supersedes: ['mechanic_work_order::wo-1'],
    correction_reason: 'Incorrect mileage supplied by workshop.',
  },
  {
    id: 'owner-transfer',
    category: 'sale_transfer',
    kind: 'transfer_started',
    occurred_at: '2026-08-12T10:00:00Z',
    source_type: 'ownership_transfer',
    source_ref: 'transfer-1',
    visibility: PASSPORT_VISIBILITY.OWNER,
    summary: 'Ownership transfer requires action.',
    details: { transfer_id: 'transfer-1' },
  },
];

test('V6: lifecycle categories match the canonical plan', () => {
  assert.deepEqual(PASSPORT_LIFECYCLE_CATEGORIES, [
    'manufacture_import',
    'registration_licensing',
    'ownership',
    'inspection',
    'mileage',
    'evidence',
    'verification',
    'damage_incident',
    'insurance',
    'service',
    'parts',
    'listing',
    'reservation_transaction',
    'sale_transfer',
  ]);
});

test('V6: correction supersedes the prior source record without deleting history', () => {
  const current = buildUnifiedLifecycleTimeline(events, {
    audience: PASSPORT_AUDIENCES.PUBLIC,
  });
  assert.equal(current.events.some((e) => e.id === 'old-service'), false);
  assert.equal(current.events.some((e) => e.id === 'corrected-service'), true);

  const audit = buildUnifiedLifecycleTimeline(events, {
    audience: PASSPORT_AUDIENCES.GOVERNANCE,
    includeSuperseded: true,
  });
  const old = audit.events.find((e) => e.id === 'old-service');
  assert.equal(old.superseded, true);
});

test('V6: public lifecycle does not leak owner-only transfer events', () => {
  const pub = buildUnifiedLifecycleTimeline(events, {
    audience: PASSPORT_AUDIENCES.PUBLIC,
  });
  assert.equal(pub.events.some((e) => e.id === 'owner-transfer'), false);

  const owner = buildUnifiedLifecycleTimeline(events, {
    audience: PASSPORT_AUDIENCES.OWNER,
  });
  assert.equal(owner.events.some((e) => e.id === 'owner-transfer'), true);
});

test('V6: category filters are explicit and validated', () => {
  const service = buildUnifiedLifecycleTimeline(events, {
    audience: PASSPORT_AUDIENCES.OWNER,
    categories: ['service'],
  });
  assert.equal(service.events.every((e) => e.category === 'service'), true);

  assert.throws(
    () => buildUnifiedLifecycleTimeline(events, {
      audience: PASSPORT_AUDIENCES.PUBLIC,
      categories: ['imaginary_history'],
    }),
    /Unsupported Passport lifecycle category filter/,
  );
});

test('V6: incomplete coverage stays explicit instead of becoming clean history', () => {
  const result = buildUnifiedLifecycleTimeline([], {
    audience: PASSPORT_AUDIENCES.PUBLIC,
    coverageState: 'partial',
    coverageLimitations: ['Pre-CarUp service history is not connected.'],
  });

  assert.equal(result.state, 'partial');
  assert.equal(result.coverage_state, 'partial');
  assert.deepEqual(result.coverage_limitations, ['Pre-CarUp service history is not connected.']);
  assert.deepEqual(result.events, []);
});

test('V6: duplicate projections of one source record collapse', () => {
  const result = buildUnifiedLifecycleTimeline([
    {
      id: 'a',
      category: 'inspection',
      kind: 'inspection_recorded',
      occurred_at: '2026-08-01T10:00:00Z',
      source_type: 'vid_inspection',
      source_ref: 'vid-1',
      visibility: PASSPORT_VISIBILITY.PUBLIC,
      public_summary: 'Older projection.',
    },
    {
      id: 'b',
      category: 'inspection',
      kind: 'inspection_recorded',
      occurred_at: '2026-08-02T10:00:00Z',
      source_type: 'vid_inspection',
      source_ref: 'vid-1',
      visibility: PASSPORT_VISIBILITY.PUBLIC,
      public_summary: 'Latest projection.',
    },
  ]);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, 'b');
});

test('V6: public corrections never expose private correction_reason', () => {
  const pub = buildUnifiedLifecycleTimeline(events, {
    audience: PASSPORT_AUDIENCES.PUBLIC,
  });
  const corrected = pub.events.find((e) => e.id === 'corrected-service');
  assert.equal(corrected.correction_reason, null);

  const owner = buildUnifiedLifecycleTimeline(events, {
    audience: PASSPORT_AUDIENCES.OWNER,
  });
  assert.equal(
    owner.events.find((e) => e.id === 'corrected-service').correction_reason,
    'Incorrect mileage supplied by workshop.',
  );
});

test('V6 anti-fork: lifecycle is a projection and owns no ledger/database writes', () => {
  const src = readFileSync('backend/services/passport/passportLifecycleTimeline.js', 'utf8');
  assert.match(src, /passportTimelineService\.js/);
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
  assert.doesNotMatch(src, /event_outbox|events_outbox|activity_ledger/i);
});
