import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const DEALER = read('backend/services/dealer/dealerOnboardingService.js');
const DIASPORA_NOTICE = read('backend/services/diaspora/diasporaNotificationService.js');
const IMPORT_ORDER = read('backend/services/diaspora/diasporaImportOrderService.js');
const DOCUMENT = read('backend/services/diaspora/diasporaDocumentService.js');
const SHIPMENT = read('backend/services/diaspora/diasporaShipmentService.js');
const CONTAINER = read('backend/services/diaspora/diasporaContainerService.js');
const COMMUNICATIONS = read('backend/services/communication/communicationEventListeners.js');
const SHIPMENT_EXCEPTION = read('backend/services/diaspora/shipmentExceptionNotifier.js');
const LOADING_NOTICE = read('backend/services/diaspora/loadingLifecycleNotifier.js');

function functionBlock(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, 'missing function: ' + signature);
  const next = source.indexOf('\nexport ', start + signature.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function collectIdentitySource() {
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (/\.[cm]?js$/.test(name)) {
        files.push(full);
      }
    }
  }
  walk(path.join(ROOT, 'backend', 'services', 'identity'));
  for (const name of readdirSync(path.join(ROOT, 'backend', 'routes'))) {
    if (/identity/i.test(name) && /\.[cm]?js$/.test(name)) {
      files.push(path.join(ROOT, 'backend', 'routes', name));
    }
  }
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

const IDENTITY = collectIdentitySource();

function assertProducerContract(overrides = {}) {
  const dealer = overrides.dealer ?? DEALER;
  const diasporaNotice = overrides.diasporaNotice ?? DIASPORA_NOTICE;
  const shipment = overrides.shipment ?? SHIPMENT;
  const container = overrides.container ?? CONTAINER;
  const identity = overrides.identity ?? IDENTITY;

  assert.doesNotMatch(dealer, /emitDomainEvent\s*\(/, 'Dealer observability must not enqueue outbox work');
  assert.match(dealer, /DEALER_ONBOARDING_PROFILE_SUBMITTED/, 'Dealer audit evidence must remain');
  assert.match(dealer, /logger\.info\('DEALER_ONBOARDING', eventType, payload\)/, 'Dealer structured observability must remain');

  const milestone = functionBlock(diasporaNotice, 'export async function notifyDiasporaMilestone');
  assert.doesNotMatch(milestone, /emitDiasporaEvent\s*\(/, 'milestone notifier must not dual-write domain_events');
  assert.doesNotMatch(milestone, /emitDomainEvent\s*\(/, 'milestone notifier must not bypass its direct delivery path');
  assert.match(milestone, /queueDiasporaNotification\s*\(/, 'legacy direct notification remains the single delivery path');
  assert.match(milestone, /recipientId:\s*importOrder\?\.buyer_id\s*\|\|\s*importOrder\?\.created_by/, 'recipient authority must remain buyer/creator derived');
  assert.match(milestone, /type:\s*eventType/, 'notification type must remain tied to the business transition');

  assert.doesNotMatch(shipment, /emitDiasporaEvent\s*\(/, 'uppercase shipment lifecycle must not enter the worker');
  assert.match(shipment, /SHIPMENT_STAGE_CHANGED/, 'shipment audit authority must remain');
  assert.match(shipment, /writeShipmentStageEvent\s*\(/, 'shipment stage-event authority must remain');

  assert.doesNotMatch(container, /emitDiasporaEvent\s*\(/, 'uppercase container lifecycle must not enter the worker');
  assert.match(container, /CONTAINER_STATUS_CHANGED/, 'container status audit authority must remain');
  assert.match(container, /CONTAINER_CREATED/, 'container creation audit authority must remain');

  assert.doesNotMatch(identity, /identity\.biometric\.consent\.granted/, 'retired biometric producer must stay retired');
}

test('current Class-C producer paths are converged to one truthful authority', () => {
  assertProducerContract();
});

test('three legacy Diaspora milestone families retain direct delivery without durable duplicate events', () => {
  for (const [source, eventType] of [
    [IMPORT_ORDER, 'DIASPORA_IMPORT_ORDER_CREATED'],
    [IMPORT_ORDER, 'DIASPORA_PAYMENT_MILESTONE_CREATED'],
    [DOCUMENT, 'DIASPORA_DOCUMENT_UPLOADED'],
  ]) {
    assert.match(source, new RegExp(eventType), eventType + ' producer must remain');
  }
  const milestone = functionBlock(DIASPORA_NOTICE, 'export async function notifyDiasporaMilestone');
  assert.match(milestone, /queueDiasporaNotification/);
  assert.doesNotMatch(milestone, /emitDiasporaEvent|emitDomainEvent/);
});

test('uppercase shipment/container duplicates are retired while governed lower-case communications remain', () => {
  assert.doesNotMatch(SHIPMENT, /emitDiasporaEvent\s*\(/);
  assert.doesNotMatch(CONTAINER, /emitDiasporaEvent\s*\(/);
  for (const eventType of [
    'diaspora.shipment.exception',
    'diaspora.loading.cargo_loaded',
    'diaspora.loading.cargo_left_behind',
  ]) {
    assert.match(COMMUNICATIONS, new RegExp(eventType.replaceAll('.', '\\.')));
  }
  assert.match(SHIPMENT_EXCEPTION, /recipientUserId/, 'shipment exception keeps governed recipient authority');
  assert.match(LOADING_NOTICE, /recipientUserId/, 'loading communications keep governed recipient authority');
});

test('retired biometric consent event has no current identity producer', () => {
  assert.doesNotMatch(IDENTITY, /identity\.biometric\.consent\.granted/);
});

test('mutation set: reintroducing orphan producer seams is killed 6/6', () => {
  const mutants = [
    { dealer: DEALER + "\nfunction mutant(){ return emitDomainEvent(null, 'dealer.onboarding.started', {}, null); }\n" },
    { diasporaNotice: DIASPORA_NOTICE.replace(
      'export async function notifyDiasporaMilestone({ eventType, importOrder, actorId = null, title, message, metadata = {} }) {',
      "export async function notifyDiasporaMilestone({ eventType, importOrder, actorId = null, title, message, metadata = {} }) {\n  await emitDiasporaEvent(eventType, {}, null);"
    ) },
    { shipment: SHIPMENT + "\nfunction mutant(){ return emitDiasporaEvent('DIASPORA_SHIPMENT_IN_TRANSIT', {}, null); }\n" },
    { container: CONTAINER + "\nfunction mutant(){ return emitDiasporaEvent('DIASPORA_CONTAINER_LOADING', {}, null); }\n" },
    { identity: IDENTITY + "\nconst mutantBiometricEvent = 'identity.biometric.consent.granted';\n" },
    { diasporaNotice: DIASPORA_NOTICE.replace('return queueDiasporaNotification({', 'return null; // queue removed by mutant\n  /*') },
  ];

  let killed = 0;
  for (const mutant of mutants) {
    assert.throws(() => assertProducerContract(mutant));
    killed += 1;
  }
  console.log('[REL03B-4 MUTATION] current-producer convergence killed ' + killed + '/' + mutants.length);
  assert.equal(killed, 6);
});
