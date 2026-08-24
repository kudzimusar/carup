/**
 * Issue #164 Phase 8 — service-timeline privacy and fidelity.
 *
 * Two opposite mistakes are pinned here, because the remediation made both in turn.
 *
 * TOO NARROW (Codex round 2, P1): adding `mechanic_work_orders` to the passport timeline put the
 * user-entered `description` into `event.desc`, and the public sanitizer had no `service` branch — so
 * free text from a table that also carries `customer_name` and `customer_id` became readable by any
 * anonymous caller who knew the VIN.
 *
 * TOO BROAD (self-caught): the first fix added an UNSCOPED `service` branch to the sanitizer. That
 * also caught PartSentry events, which are structured and non-sensitive and legitimately publish
 * things like "Front brake pads (Replaced)" — measured on the live preview before the change. A fix
 * broader than the property it needs destroys real information just as surely as a narrow one leaks.
 *
 * Both directions must hold at once, so both are asserted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const TIMELINE_SRC = readFileSync(path.resolve(here, '../services/trustGraph/trustGraphService.js'), 'utf8');
const SERVER_SRC = readFileSync(path.resolve(here, '../server.js'), 'utf8');

/** The work-order select, isolated so the assertions are about that query and nothing else. */
const workOrderSelect = (() => {
  const m = TIMELINE_SRC.match(/from\('mechanic_work_orders'\)\s*\.select\(([^)]*)\)/);
  return m ? m[1] : null;
})();

test('the work-order query exists and is the timeline source for services', () => {
  assert.ok(workOrderSelect, 'mechanic_work_orders must be read — services need their own source');
});

// ── Producer side: sensitive columns are never even fetched ───────────────────────────────────────

test('the work-order query fetches no free text and no customer identity', () => {
  for (const column of ['description', 'issue_description', 'customer_name', 'customer_id']) {
    assert.doesNotMatch(workOrderSelect, new RegExp(`\\b${column}\\b`),
      `${column} must not be selected — this timeline is published to anonymous callers by VIN`);
  }
});

test('the work-order query DOES fetch the controlled and governed columns it needs', () => {
  for (const column of ['status', 'total_cost']) {
    assert.match(workOrderSelect, new RegExp(`\\b${column}\\b`), `${column} must be selected`);
  }
});

test('the emitted work-order event carries no free-text notes', () => {
  const emit = TIMELINE_SRC.slice(
    TIMELINE_SRC.indexOf("id: `workorder:"),
    TIMELINE_SRC.indexOf("// PartSentry part logs"),
  );
  assert.ok(emit.length > 0, 'the work-order emitter must exist');
  assert.doesNotMatch(emit, /e\.description|e\.issue_description|e\.customer_name/,
    'no user-entered column may reach the event');
  // The recorded cost must travel: omitting it made the cost reducer read a missing value as $0.
  assert.match(emit, /cost: e\.total_cost/, 'the recorded cost must be published');
});

// ── Public projection: the override applies to work orders ONLY ───────────────────────────────────

test('the public sanitizer fixes the description for WORK-ORDER events', () => {
  assert.match(SERVER_SRC, /event_source === 'service' && String\(event\.id \|\| ''\)\.startsWith\('workorder:'\)/,
    'a work-order event must get a fixed public description, as defence behind the producer');
});

test('the public sanitizer does NOT blanket every service event', () => {
  // An unscoped branch would suppress PartSentry's real published part description.
  assert.doesNotMatch(SERVER_SRC, /else if \(event\.event_source === 'service'\) \{/,
    'PartSentry events must keep publishing their structured part description');
});

test('PartSentry remains the source of its own public description', () => {
  const emit = TIMELINE_SRC.slice(TIMELINE_SRC.indexOf('// PartSentry part logs'));
  assert.match(emit, /id: `partsentry:/);
  assert.match(emit, /\$\{e\.part_name\}/, 'the part name is structured, non-sensitive, and stays');
});
