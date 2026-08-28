import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  PASSPORT_AUDIENCES,
  PASSPORT_VISIBILITY,
  governedValue,
} from '../services/passport/passportContract.js';
import {
  buildPassportTimeline,
} from '../services/passport/passportTimelineService.js';
import {
  assemblePassportReadModel,
} from '../services/passport/passportReadModelService.js';

const VIN = 'CARUPPASSPORT0001';
const NOW = '2026-08-28T09:00:00.000Z';

function baseInput() {
  return {
    vin: VIN,
    identity: {
      state: 'known',
      public: { make: 'Toyota', model: 'Hilux', year: 2021 },
      owner: {
        make: 'Toyota',
        model: 'Hilux',
        year: 2021,
        owner_id: 'owner-1',
        engine_number: 'ENG-PRIVATE',
      },
    },
    lifecycle: {
      state: 'known',
      public: { state: 'owned' },
      owner: { state: 'owned', owner_actions_enabled: true },
    },
    trust: {
      state: 'known',
      public: {
        evaluation_state: 'evaluated',
        band: 'moderate',
        score: 52,
        confidence: 'medium',
        known_limitations: ['No live government source connected.'],
      },
      owner: {
        evaluation_state: 'evaluated',
        band: 'moderate',
        score: 52,
        confidence: 'medium',
        known_limitations: ['No live government source connected.'],
        internal_decision_id: 'decision-1',
      },
    },
    evidence: {
      state: 'partial',
      public: { public_safe_count: 2 },
      owner: { total_count: 4, public_safe_count: 2, restricted_count: 2 },
    },
    timeline: {
      events: [
        {
          id: 'event-public',
          kind: 'inspection_recorded',
          occurred_at: '2026-08-25T10:00:00Z',
          source_type: 'vid_inspection',
          source_ref: 'vid-1',
          authority: 'VID',
          verification_state: 'source_connected',
          visibility: PASSPORT_VISIBILITY.PUBLIC,
          public_summary: 'Inspection record available.',
          summary: 'Inspection passed at Harare depot.',
          public_details: { status: 'recorded' },
          details: { status: 'recorded', reviewer_id: 'internal-reviewer' },
          mileage: 48210,
          mileage_unit: 'km',
          evidence_ids: ['evidence-1'],
        },
        {
          id: 'event-private',
          kind: 'ownership_claim_verified',
          occurred_at: '2026-08-26T10:00:00Z',
          source_type: 'ownership_claim',
          source_ref: 'claim-1',
          authority: 'CarUp governance',
          verification_state: 'verified',
          visibility: PASSPORT_VISIBILITY.OWNER,
          public_summary: null,
          summary: 'Ownership claim verified.',
          details: { owner_id: 'owner-1' },
        },
      ],
    },
    ownership: {
      state: 'known',
      public: { history_count: 2, current_owner_private: true },
      owner: { history_count: 2, current_relationship: 'owner', owner_id: 'owner-1' },
    },
    service: {
      state: 'unknown',
      public: null,
      owner: null,
    },
    listing: {
      state: 'not_applicable',
      public: null,
      owner: null,
    },
    attention: {
      state: 'not_evaluated',
      public: null,
      owner: null,
    },
    limitations: ['Service history coverage is incomplete.'],
  };
}

test('V1: public Passport uses only public projections and hides owner-only timeline events', () => {
  const model = assemblePassportReadModel(baseInput(), {
    audience: PASSPORT_AUDIENCES.PUBLIC,
    now: NOW,
  });

  assert.equal(model.vin, VIN);
  assert.equal(model.generated_at, NOW);
  assert.deepEqual(model.identity.data, { make: 'Toyota', model: 'Hilux', year: 2021 });
  assert.equal(model.timeline.events.length, 1);
  assert.equal(model.timeline.events[0].kind, 'inspection_recorded');
  assert.deepEqual(model.timeline.events[0].details, { status: 'recorded' });
  assert.equal(JSON.stringify(model).includes('owner-1'), false);
  assert.equal(JSON.stringify(model).includes('ENG-PRIVATE'), false);
  assert.equal(JSON.stringify(model).includes('internal-reviewer'), false);
});

test('V1: owner Passport can use owner projection without widening the public projection', () => {
  const owner = assemblePassportReadModel(baseInput(), {
    audience: PASSPORT_AUDIENCES.OWNER,
    now: NOW,
  });
  const pub = assemblePassportReadModel(baseInput(), {
    audience: PASSPORT_AUDIENCES.PUBLIC,
    now: NOW,
  });

  assert.equal(owner.identity.data.owner_id, 'owner-1');
  assert.equal(owner.identity.data.engine_number, 'ENG-PRIVATE');
  assert.equal(owner.timeline.events.length, 2);
  assert.equal(pub.identity.data.owner_id, undefined);
  assert.equal(pub.timeline.events.length, 1);
});

test('V1: public projection fails closed if a forbidden private key is supplied as public data', () => {
  const input = baseInput();
  input.identity.public = { make: 'Toyota', owner_id: 'must-not-leak' };

  assert.throws(
    () => assemblePassportReadModel(input, { audience: PASSPORT_AUDIENCES.PUBLIC, now: NOW }),
    /forbidden key/i,
  );
});

test('V1: canonical Trust is passed through unchanged instead of recomputed by Passport', () => {
  const input = baseInput();
  input.trust.public = {
    evaluation_state: 'evaluated',
    band: 'low',
    score: 17,
    confidence: 'high',
    known_limitations: ['Deliberate test value from canonical Trust projection.'],
  };

  const model = assemblePassportReadModel(input, {
    audience: PASSPORT_AUDIENCES.PUBLIC,
    now: NOW,
  });

  assert.deepEqual(model.trust.data, input.trust.public);
  assert.equal(model.trust.data.score, 17);
  assert.equal(model.trust.data.band, 'low');
});

test('V1: unknown remains null/unknown and is never converted into zero or false', () => {
  assert.deepEqual(governedValue(undefined), { value: null, state: 'unknown', source: null });
  assert.deepEqual(governedValue(null), { value: null, state: 'unknown', source: null });
  assert.deepEqual(governedValue(0), { value: 0, state: 'known', source: null });
  assert.deepEqual(governedValue(false), { value: false, state: 'known', source: null });

  const input = baseInput();
  input.service = { state: 'unknown', public: null, owner: null };
  const model = assemblePassportReadModel(input, {
    audience: PASSPORT_AUDIENCES.PUBLIC,
    now: NOW,
  });
  assert.equal(model.service.state, 'unknown');
  assert.equal(model.service.data, null);
});

test('V1: timeline de-duplicates multiple projections of one authoritative source record', () => {
  const events = [
    {
      kind: 'service_record_added',
      occurred_at: '2026-08-20T10:00:00Z',
      source_type: 'mechanic_work_order',
      source_ref: 'wo-1',
      visibility: PASSPORT_VISIBILITY.PUBLIC,
      public_summary: 'Service record.',
    },
    {
      kind: 'service_record_added',
      occurred_at: '2026-08-21T10:00:00Z',
      source_type: 'mechanic_work_order',
      source_ref: 'wo-1',
      visibility: PASSPORT_VISIBILITY.PUBLIC,
      public_summary: 'Updated service projection.',
    },
  ];

  const timeline = buildPassportTimeline(events, { audience: PASSPORT_AUDIENCES.PUBLIC });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].occurred_at, '2026-08-21T10:00:00.000Z');
  assert.equal(timeline[0].summary, 'Updated service projection.');
});

test('V1: timeline rejects history without provenance identity', () => {
  assert.throws(
    () => buildPassportTimeline([{
      kind: 'mileage_observed',
      occurred_at: '2026-08-20T10:00:00Z',
      source_type: 'inspection',
      visibility: PASSPORT_VISIBILITY.PUBLIC,
    }]),
    /source_ref/,
  );
});

test('V1 anti-fork: Passport foundation contains no Trust calculation or database authority', () => {
  const dir = 'backend/services/passport';
  const source = readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(`${dir}/${name}`, 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /trustGraphService|calculateVehicleTrustScore|computeVehicleTrustScore/);
  assert.doesNotMatch(source, /\.from\s*\(/, 'foundation must remain free of direct database reads');
  assert.doesNotMatch(source, /vehicles\.trust_score|vehicle\.trust_score/);
  assert.doesNotMatch(source, /supabase/i, 'foundation composition must not own a Supabase client');
});

test('V1: governance may see internal events while public cannot', () => {
  const events = [{
    kind: 'discrepancy_detected',
    occurred_at: '2026-08-27T10:00:00Z',
    source_type: 'review_task',
    source_ref: 'review-9',
    visibility: PASSPORT_VISIBILITY.INTERNAL,
    summary: 'Internal discrepancy review.',
    details: { case: 'review-9' },
  }];

  assert.equal(buildPassportTimeline(events, { audience: PASSPORT_AUDIENCES.PUBLIC }).length, 0);
  assert.equal(buildPassportTimeline(events, { audience: PASSPORT_AUDIENCES.GOVERNANCE }).length, 1);
});
