import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REL03B5_EXPECTED_FINGERPRINT,
  REL03B5_EXPECTED_TOTAL,
  REL03B5_FAMILY_COUNTS,
  REL03B5_REASON_BY_EVENT,
  assertReasonTotals,
  assertRel03b5StagingTarget,
  reasonCountsForRows,
  validateFrozenPopulation,
} from '../../scripts/ci/lib/oc5r-rel03b5-quarantine-contract.mjs';

const MIGRATION = readFileSync(new URL('../../database/migrations/20261009110000_oc5r_rel03b5_historical_event_quarantine.sql', import.meta.url), 'utf8');
const CONTRACT = readFileSync(new URL('../../scripts/ci/lib/oc5r-rel03b5-quarantine-contract.mjs', import.meta.url), 'utf8');
const QUARANTINE = readFileSync(new URL('../../scripts/ci/oc5r-rel03b5-quarantine-historical-events.mjs', import.meta.url), 'utf8');
const RESTORE = readFileSync(new URL('../../scripts/ci/oc5r-rel03b5-restore-quarantined-events.mjs', import.meta.url), 'utf8');
const INVENTORY = readFileSync(new URL('../../scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs', import.meta.url), 'utf8');
const WORKER = readFileSync(new URL('../services/eventBus/eventWorker.js', import.meta.url), 'utf8');

test('B5 frozen historical population and reason vocabulary are exact', () => {
  assert.equal(REL03B5_EXPECTED_TOTAL, 196);
  assert.equal(REL03B5_EXPECTED_FINGERPRINT, '5f95aa1324364a05d10654ae4c7ce195');
  assert.deepEqual(REL03B5_FAMILY_COUNTS, {
    'dealer.onboarding.started': 6,
    DIASPORA_CONTAINER_LOADING: 4,
    DIASPORA_SHIPMENT_IN_TRANSIT: 3,
    DIASPORA_SHIPMENT_ARRIVED: 6,
    DIASPORA_SHIPMENT_CUSTOMS_HOLD: 3,
    DIASPORA_IMPORT_ORDER_CREATED: 57,
    DIASPORA_PAYMENT_MILESTONE_CREATED: 110,
    DIASPORA_DOCUMENT_UPLOADED: 1,
    'identity.biometric.consent.granted': 6,
  });
  assert.equal(REL03B5_REASON_BY_EVENT['dealer.onboarding.started'], 'AUDIT_ONLY_LEGACY');
  assert.equal(REL03B5_REASON_BY_EVENT.DIASPORA_CONTAINER_LOADING, 'LEGACY_DUPLICATE_WORKFLOW_EVENT');
  assert.equal(REL03B5_REASON_BY_EVENT.DIASPORA_IMPORT_ORDER_CREATED, 'LEGACY_DUPLICATE_DIRECT_NOTIFICATION');
  assert.equal(REL03B5_REASON_BY_EVENT['identity.biometric.consent.granted'], 'RETIRED_HISTORICAL_EVENT');
});

test('B5 schema adds provenance without imposing a global status vocabulary', () => {
  for (const column of ['quarantined_at', 'quarantine_reason', 'quarantine_metadata']) {
    assert.match(MIGRATION, new RegExp(column));
  }
  assert.match(MIGRATION, /status <> 'quarantined'/);
  assert.match(MIGRATION, /quarantined_at IS NOT NULL/);
  assert.match(MIGRATION, /NULLIF\(BTRIM\(quarantine_reason\), ''\) IS NOT NULL/);
  assert.doesNotMatch(MIGRATION, /CHECK\s*\(\s*status\s+IN\s*\(/i);
  assert.match(MIGRATION, /It does NOT mean:/);
  assert.match(MIGRATION, /customer notified/);
});

test('B5 target and frozen-population guards fail closed', () => {
  assert.doesNotThrow(() => assertRel03b5StagingTarget({ kind: 'staging', projectRef: 'eoyenigwevnxwwhyhaer' }));
  assert.throws(() => assertRel03b5StagingTarget({ kind: 'production', projectRef: 'forbidden' }));
  assert.throws(() => assertRel03b5StagingTarget({ kind: 'unknown', projectRef: null }));

  const summary = {
    total: 196,
    fingerprint: REL03B5_EXPECTED_FINGERPRINT,
    locked_rows: 0,
    family_counts: { ...REL03B5_FAMILY_COUNTS },
  };
  assert.equal(validateFrozenPopulation(summary), true);
  assert.throws(() => validateFrozenPopulation({ ...summary, total: 195 }), /TOTAL DRIFT/);
  assert.throws(() => validateFrozenPopulation({ ...summary, fingerprint: 'drift' }), /FINGERPRINT DRIFT/);
  assert.throws(() => validateFrozenPopulation({ ...summary, locked_rows: 1 }), /LOCKED ROW STOP/);
  assert.throws(
    () => validateFrozenPopulation({
      ...summary,
      family_counts: { ...summary.family_counts, DIASPORA_DOCUMENT_UPLOADED: 2 },
    }),
    /FAMILY DRIFT/,
  );
});

test('B5 quarantine is exact-ID atomic and restoration has no broad mode', () => {
  assert.match(QUARANTINE, /client\.query\('BEGIN'\)/);
  assert.match(QUARANTINE, /client\.query\('ROLLBACK'\)/);
  assert.match(QUARANTINE, /client\.query\('COMMIT'\)/);
  assert.match(QUARANTINE, /validateFrozenPopulation\(summary\)/);
  assert.match(QUARANTINE, /WHERE d\.id = selected\.id/);
  assert.match(QUARANTINE, /status = 'quarantined'/);
  assert.match(QUARANTINE, /quarantine_reason = selected\.reason/);
  assert.doesNotMatch(QUARANTINE, /UPDATE public\.domain_events[\s\S]*WHERE event_type = ANY/i);
  assert.match(RESTORE, /--ids-file is required/);
  assert.match(RESTORE, /--reason is required/);
  assert.match(RESTORE, /WHERE id = ANY\(\$1::uuid\[\]\)/);
  assert.doesNotMatch(RESTORE, /event_type\s*=/);
  assert.doesNotMatch(RESTORE, /restore all/i);
});

test('B5 reason totals are deterministic', () => {
  const rows = Object.entries(REL03B5_FAMILY_COUNTS).flatMap(([event_type, count]) =>
    Array.from({ length: count }, () => ({
      event_type,
      quarantine_reason: REL03B5_REASON_BY_EVENT[event_type],
    })));
  const counts = reasonCountsForRows(rows);
  assertReasonTotals(counts);
  assert.deepEqual(counts, {
    AUDIT_ONLY_LEGACY: 6,
    LEGACY_DUPLICATE_WORKFLOW_EVENT: 16,
    LEGACY_DUPLICATE_DIRECT_NOTIFICATION: 168,
    RETIRED_HISTORICAL_EVENT: 6,
  });
});

test('worker and replay predicates exclude quarantined without weakening B3 truth', () => {
  assert.match(WORKER, /WHERE status = 'pending' AND attempts < \$1/);
  assert.match(WORKER, /status = 'dead_letter'/);
  assert.match(WORKER, /NO_CURRENT_SUBSCRIBER/);
  assert.doesNotMatch(WORKER, /status = 'quarantined'[\s\S]*processEvent/);
  assert.match(INVENTORY, /historical_quarantine_count/);
  assert.match(INVENTORY, /quarantine_reason_counts/);
});

function assertMutationBoundaries(sources) {
  assert.match(sources.contract, /export const REL03B5_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer';/);
  assert.match(sources.contract, /export const REL03B5_EXPECTED_TOTAL = 196;/);
  assert.match(sources.contract, /export const REL03B5_EXPECTED_FINGERPRINT = '5f95aa1324364a05d10654ae4c7ce195';/);
  assert.match(sources.contract, /for \(const \[eventType, expected\] of Object\.entries\(REL03B5_FAMILY_COUNTS\)\)/);
  assert.match(sources.quarantine, /validateFrozenPopulation\(summary\)/);
  assert.match(sources.quarantine, /WHERE d\.id = selected\.id/);
  assert.match(sources.quarantine, /status = 'quarantined'/);
  assert.match(sources.quarantine, /quarantine_reason = selected\.reason/);
  assert.match(sources.restore, /--ids-file is required/);
  assert.match(sources.restore, /WHERE id = ANY\(\$1::uuid\[\]\)/);
}

test('B5 mutation set kills all critical boundary removals 8/8', () => {
  const base = { contract: CONTRACT, quarantine: QUARANTINE, restore: RESTORE };
  const mutants = [
    {
      ...base,
      contract: base.contract.replace(
        "export const REL03B5_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer';",
        '',
      ),
    },
    {
      ...base,
      contract: base.contract.replace(
        'export const REL03B5_EXPECTED_TOTAL = 196;',
        'export const REL03B5_EXPECTED_TOTAL = 195;',
      ),
    },
    {
      ...base,
      contract: base.contract.replace(
        'for (const [eventType, expected] of Object.entries(REL03B5_FAMILY_COUNTS)) {',
        'for (const [eventType, expected] of []) {',
      ),
    },
    {
      ...base,
      contract: base.contract.replace(
        "export const REL03B5_EXPECTED_FINGERPRINT = '5f95aa1324364a05d10654ae4c7ce195';",
        "export const REL03B5_EXPECTED_FINGERPRINT = 'ignored';",
      ),
    },
    {
      ...base,
      quarantine: base.quarantine.replace('WHERE d.id = selected.id', 'WHERE d.event_type = ANY($1::text[])'),
    },
    {
      ...base,
      quarantine: base.quarantine.replace("status = 'quarantined'", "status = 'processed'"),
    },
    {
      ...base,
      quarantine: base.quarantine.replace('quarantine_reason = selected.reason,', ''),
    },
    {
      ...base,
      restore: base.restore.replace(
        "if (!idsFile) throw new Error('--ids-file is required; wildcard or event-type restoration is forbidden.');",
        '',
      ),
    },
  ];

  let killed = 0;
  for (const mutant of mutants) {
    assert.throws(() => assertMutationBoundaries(mutant));
    killed += 1;
  }
  console.log('[REL03B-5 MUTATION] quarantine boundaries killed ' + killed + '/' + mutants.length);
  assert.equal(killed, 8);
});
