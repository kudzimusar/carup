/**
 * Communication event coverage gate (seam-E E3 regression guard).
 *
 * Every event type the communication engine subscribes to MUST have a real
 * emitter — a quoted literal inside an emit/publish-style call under
 * backend/services or backend/routes. Subscribing to events nothing emits is
 * dead code that silently drops product notifications; this gate makes such
 * drift a CI failure instead of a production surprise.
 *
 * Also covers the serverless outbox drain (seam-E E1): the worker-secret
 * guarded /api/internal/events/process route pair plus its Vercel cron, and
 * the notification policies/templates for the seam-E notification events.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { COMMUNICATION_EVENT_TYPES } = await import('../services/communication/communicationEventListeners.js');
const { NOTIFICATION_POLICIES } = await import('../services/communication/communicationNotificationService.js');
const { CommunicationTemplateService } = await import('../services/communication/communicationTemplateService.js');

const backendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCAN_ROOTS = [path.join(backendDir, 'services'), path.join(backendDir, 'routes')];

function collectJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectJsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const scannedFiles = SCAN_ROOTS.flatMap((root) => collectJsFiles(root))
  .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));

/**
 * True when the event type appears as a quoted literal argument of an
 * emit/publish/persist *Event call, e.g.:
 *   emitDomainEvent(null, 'finance.application.approved', ...)
 *   publishMemoryEvent('ESCROW_CREATED', ...)
 *   persistCommunicationEvent(null, 'marketplace.inquiry.created', ...)  // local alias of emitDomainEvent
 */
function emitterRegexFor(eventType) {
  const escaped = eventType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    String.raw`\b[\w$]*(?:emit|publish|persist)[\w$]*Event\s*\(\s*(?:(?:null|[A-Za-z_$][\w.$]*)\s*,\s*)?['"\x60]` + escaped + String.raw`['"\x60]`,
    'i'
  );
}

test('every subscribed communication event type has a real emitter under backend/services or backend/routes', () => {
  assert.ok(COMMUNICATION_EVENT_TYPES.length > 0, 'COMMUNICATION_EVENT_TYPES must not be empty');
  const missing = [];
  for (const eventType of COMMUNICATION_EVENT_TYPES) {
    const regex = emitterRegexFor(eventType);
    const emitted = scannedFiles.some(({ source }) => regex.test(source));
    if (!emitted) missing.push(eventType);
  }
  assert.deepEqual(
    missing,
    [],
    `Subscribed event type(s) with no emitDomainEvent/publishMemoryEvent literal emitter: ${missing.join(', ')}. ` +
    'Either add a real emitter or remove the subscription from COMMUNICATION_EVENT_TYPES.'
  );
});

test('subscribed communication event types are unique', () => {
  assert.equal(new Set(COMMUNICATION_EVENT_TYPES).size, COMMUNICATION_EVENT_TYPES.length);
});

test('outbox drain route pair exists in communicationRoutes with the worker-secret guard', () => {
  const routeSource = fs.readFileSync(path.join(backendDir, 'routes', 'communicationRoutes.js'), 'utf8');
  assert.ok(routeSource.includes("router.get('/api/internal/events/process'"), 'GET /api/internal/events/process must be registered');
  assert.ok(routeSource.includes("router.post('/api/internal/events/process'"), 'POST /api/internal/events/process must be registered');

  const handlerMatch = routeSource.match(/async function processEventOutboxBatch[\s\S]*?\n\}/);
  assert.ok(handlerMatch, 'processEventOutboxBatch handler must exist');
  assert.ok(handlerMatch[0].includes('requireWorkerSecret(req, res)'), 'outbox drain must be guarded by requireWorkerSecret');
  assert.ok(handlerMatch[0].includes('pollEvents()'), 'outbox drain must run one eventWorker poll cycle');
  assert.ok(handlerMatch[0].includes('backlog'), 'outbox drain response must report the remaining backlog');
});

test('backend vercel.json schedules the outbox drain cron', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(backendDir, 'vercel.json'), 'utf8'));
  const cron = (vercelConfig.crons || []).find((c) => c.path === '/api/internal/events/process');
  assert.ok(cron, 'vercel.json must schedule /api/internal/events/process');
  assert.equal(cron.schedule, '* * * * *');
});

// Mirrors the inline CHECK on message_threads.thread_type
// (message_threads_thread_type_check, database/migrations/20260623143000_omnichannel_communication_engine.sql).
const LEGAL_THREAD_TYPES = [
  'support', 'marketplace_inquiry', 'referral', 'escrow', 'finance', 'import',
  'container', 'trust_safety', 'feedback', 'complaint', 'account', 'general',
];

test('every notification policy threadType satisfies the message_threads_thread_type_check DB CHECK', () => {
  for (const [eventType, policy] of Object.entries(NOTIFICATION_POLICIES)) {
    assert.ok(
      LEGAL_THREAD_TYPES.includes(policy.threadType),
      `${eventType} threadType '${policy.threadType}' violates message_threads_thread_type_check — the thread INSERT would fail and the notification would never queue`
    );
  }
});

test('seam-E notification policies resolve with required fields and registered templates', () => {
  // threadType values MUST satisfy the message_threads_thread_type_check DB CHECK
  // (support|marketplace_inquiry|referral|escrow|finance|import|container|trust_safety|
  // feedback|complaint|account|general). channels stay in_app-only until recipient
  // address enrichment exists — the delivery worker only reads email/phone/push targets
  // from notification.payload, which policy-driven notifications never carry.
  const expectations = {
    'identity.verification.decided': {
      notificationType: 'verification_decision',
      threadType: 'account',
      priority: 'high',
      channels: ['in_app'],
      templateKey: 'verification_decision_v1',
    },
    'marketplace.listing.moderated': {
      notificationType: 'listing_moderation',
      threadType: 'trust_safety',
      priority: 'normal',
      channels: ['in_app'],
      templateKey: 'listing_moderation_v1',
    },
    'evidence.review.decided': {
      notificationType: 'evidence_review',
      threadType: 'trust_safety',
      priority: 'normal',
      channels: ['in_app'],
      templateKey: 'evidence_review_v1',
    },
  };

  const templates = new CommunicationTemplateService().listTemplates();
  for (const [eventType, expected] of Object.entries(expectations)) {
    const policy = NOTIFICATION_POLICIES[eventType];
    assert.ok(policy, `NOTIFICATION_POLICIES must contain ${eventType}`);
    assert.equal(policy.notificationType, expected.notificationType, `${eventType} notificationType`);
    assert.equal(policy.threadType, expected.threadType, `${eventType} threadType`);
    assert.equal(policy.priority, expected.priority, `${eventType} priority`);
    assert.deepEqual(policy.channels, expected.channels, `${eventType} channels`);
    assert.equal(policy.templateKey, expected.templateKey, `${eventType} templateKey`);
    assert.equal(policy.transactional, true, `${eventType} must be transactional`);
    assert.ok(Array.isArray(policy.fallbackChannels), `${eventType} fallbackChannels must be an array`);
    assert.ok(templates.includes(expected.templateKey), `template ${expected.templateKey} must be registered`);
    assert.ok(COMMUNICATION_EVENT_TYPES.includes(eventType), `${eventType} must be subscribed`);
  }
});
