import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyEventTypes } from '../../scripts/ci/lib/oc5r-rel03-subscriber-classifier.mjs';

const WORKER = readFileSync(new URL('../services/eventBus/eventWorker.js', import.meta.url), 'utf8');
const INVENTORY = readFileSync(new URL('../../scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs', import.meta.url), 'utf8');
const DEALER = readFileSync(new URL('../services/dealer/dealerOnboardingService.js', import.meta.url), 'utf8');

test('registered Communications consumers are not hidden by apostrophes in registry comments', () => {
  const rows = classifyEventTypes([
    'diaspora.rfq.quote_submitted',
    'diaspora.rfq.quote_accepted',
    'diaspora.shipment.exception',
  ]);
  for (const row of rows) {
    assert.equal(row.known_subscriber, true, row.event_type);
    assert.equal(row.communications_subscriber, true, row.event_type);
    assert.equal(row.effect_class, 'IN_APP_ONLY', row.event_type);
  }
});

test('dealer onboarding observability is deliberately outside the durable worker path', () => {
  const [row] = classifyEventTypes(['dealer.onboarding.started']);
  assert.equal(row.known_subscriber, false);
  assert.equal(row.effect_class, 'NO_CURRENT_SUBSCRIBER');
  assert.match(DEALER, /structured logger keeps operational visibility without creating an unconsumable event/);
  assert.doesNotMatch(DEALER, /emitDomainEvent\s*\(/);
  assert.doesNotMatch(DEALER, /subscribe\(\s*['"]dealer\.onboarding\.started/);
});

test('inventory gives explicit operator guidance for unhandled events', () => {
  assert.match(INVENTORY, /DO NOT CALL CURRENT WORKER UNTIL PROVEN DISPOSITION/);
  assert.match(INVENTORY, /preservation or quarantine is not business-event success/);
});

test('mutation: removing the zero-handler guard is killed', () => {
  const guard = /if \(handlers\.length === 0\) \{[\s\S]*?NO_CURRENT_SUBSCRIBER[\s\S]*?throw error;[\s\S]*?\}/;
  assert.match(WORKER, guard);
  const mutant = WORKER.replace(guard, '');
  assert.notEqual(mutant, WORKER, 'mutation anchor must match');
  assert.doesNotMatch(mutant, guard, 'zero-handler-guard removal mutant survived');
  console.log('[REL03B-3 MUTATION] zero-handler guard removal killed 1/1');
});
