/**
 * Communication event coverage gate (seam-E E3 regression guard).
 *
 * Every event type the communication engine subscribes to MUST have a real
 * emitter. Subscribing to events nothing emits is dead code that silently drops
 * product notifications; this gate makes such drift a CI failure instead of a
 * production surprise.
 *
 * An emitter is a quoted literal inside an emit/publish-style call under
 * backend/services or backend/routes, OR an INSERT INTO domain_events inside a
 * SQL migration. The second form is not a loophole: Issue #164 Phase 6 moved the
 * marketplace transaction emitters into `issue164_transition_session_atomic` so
 * the state transition and its event commit in ONE transaction, which is a
 * stronger emitter than a JS call that can succeed after the transition fails.
 * Requiring JS would have meant rejecting the better implementation.
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

/** Migrations that write `domain_events` directly. */
const MIGRATIONS_DIR = path.join(path.dirname(backendDir), 'database', 'migrations');
const migrationSources = fs.existsSync(MIGRATIONS_DIR)
  ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
  : [];

/**
 * True when a SQL migration inserts this event type into `domain_events`.
 *
 * Deliberately requires BOTH the domain_events insert and the literal in the same file, so a
 * migration that merely mentions the string does not count as emitting it.
 */
function emittedBySql(eventType) {
  const escaped = eventType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literal = new RegExp(`['"]${escaped}['"]`);
  return migrationSources.some((source) => /INSERT\s+INTO\s+(public\.)?domain_events/i.test(source) && literal.test(source));
}

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

test('every subscribed communication event type has a real emitter (JS or SQL)', () => {
  assert.ok(COMMUNICATION_EVENT_TYPES.length > 0, 'COMMUNICATION_EVENT_TYPES must not be empty');
  const missing = [];
  for (const eventType of COMMUNICATION_EVENT_TYPES) {
    const regex = emitterRegexFor(eventType);
    const emitted = scannedFiles.some(({ source }) => regex.test(source)) || emittedBySql(eventType);
    if (!emitted) missing.push(eventType);
  }
  assert.deepEqual(
    missing,
    [],
    `Subscribed event type(s) with no emitter — neither an emitDomainEvent/publishMemoryEvent literal ` +
    `nor a domain_events INSERT in a migration: ${missing.join(', ')}. ` +
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

test('outbox drain cron lives in Supabase pg_cron, and vercel.json carries no sub-daily cron', () => {
  // Vercel Hobby rejects sub-daily cron schedules AT DEPLOY TIME — a
  // '* * * * *' entry in vercel.json fails every carup-backend deployment.
  // The every-minute drain therefore lives in Supabase pg_cron
  // (20260809120000_events_outbox_pg_cron.sql), exactly like the
  // communications delivery worker (20260626120000_communication_supabase_cron.sql).
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(backendDir, 'vercel.json'), 'utf8'));
  const subDaily = (vercelConfig.crons || []).find((c) => /[*/]/.test(String(c.schedule).split(' ').slice(0, 2).join(' ')));
  assert.equal(subDaily, undefined, 'vercel.json must not carry a sub-daily cron (fails deployment on the Hobby plan)');

  const cronMigration = fs.readFileSync(
    path.join(backendDir, '..', 'database', 'migrations', '20260809120000_events_outbox_pg_cron.sql'),
    'utf8',
  );
  assert.ok(cronMigration.includes('carup-events-outbox-every-minute'), 'migration must define the named cron job');
  assert.ok(cronMigration.includes("'* * * * *'"), 'migration must use every-minute schedule');
  assert.ok(cronMigration.includes('pg_cron'), 'migration must reference pg_cron extension');
  assert.ok(cronMigration.includes('pg_net'), 'migration must reference pg_net extension');
  assert.ok(cronMigration.includes('/api/internal/events/process'), 'migration must target the events drain endpoint');
  assert.ok(cronMigration.includes('CARUP_EVENTS_ENDPOINT_URL'), 'must read endpoint URL from Vault');
  assert.ok(cronMigration.includes('CARUP_WORKER_SECRET'), 'must read the shared worker secret from Vault');
  assert.ok(cronMigration.includes('cron.unschedule'), 'must include idempotent unschedule step');
  assert.ok(cronMigration.includes('+migrate Down'), 'must have rollback section');

  // Fail-closed contract: a migration must never be ledgered as applied while
  // silently creating no scheduler. Missing pg_cron/pg_net must RAISE, not skip.
  const upSection = cronMigration.split(/^-- \+migrate Down/m)[0];
  const raiseCount = (upSection.match(/RAISE EXCEPTION '\[carup-events-cron\]/g) || []).length;
  assert.equal(raiseCount, 2, 'Up must RAISE EXCEPTION for BOTH missing pg_cron and missing pg_net');
  assert.ok(!upSection.includes('Skipping job setup'), 'the old NOTICE-and-skip path must be gone from Up');
  // Vault secrets stay an activation gate, not fail-closed: the job command
  // no-ops via WHERE EXISTS until both secrets are present.
  assert.ok(/WHERE EXISTS[\s\S]*CARUP_EVENTS_ENDPOINT_URL/.test(upSection), 'job command must guard on the endpoint-URL secret');
  assert.ok(/AND EXISTS[\s\S]*CARUP_WORKER_SECRET/.test(upSection), 'job command must guard on the worker secret');
});

test('events cron migration FAILS on a database without pg_cron (behavioral, PGlite)', async () => {
  // PGlite ships no pg_cron/pg_net, so applying the Up section against it must
  // throw the fail-closed error instead of completing (which is exactly what
  // would let a migration runner record a capability that was never created).
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const migrationPath = path.join(backendDir, '..', 'database', 'migrations', '20260809120000_events_outbox_pg_cron.sql');
  const up = fs.readFileSync(migrationPath, 'utf8').split(/^-- \+migrate Down/m)[0];
  await assert.rejects(
    () => db.exec(up),
    (err) => String(err?.message || err).includes('[carup-events-cron] pg_cron is not installed'),
    'Up must raise the fail-closed pg_cron error on a cron-less database',
  );
  await db.close();
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

/**
 * C1 — "an emitter literal exists" is not enough, and this gate proved it the expensive way.
 *
 * All ten SafeTrade events passed the test above from the day they were subscribed. Every one had a
 * real SQL emitter, and every one was silently dropped in production, because the check answered
 * "is this event EMITTED?" when the question that matters is "does emitting it actually reach a
 * customer?". A subscription whose events can never be addressed is dead code with a green test.
 *
 * So the gate now also asks, for the governed families where it is decidable statically:
 *
 *   emittable  -> a real emitter exists                      (the test above)
 *   addressable -> a recipient can be resolved for it        (payload carries one, or an adapter
 *                                                             resolves one from canonical authority)
 *   canonicalizable -> a policy exists that names a template and classification
 *
 * It deliberately does not attempt to prove renderability here — that needs real payloads and lives
 * in the per-reference suites. This is the blind spot C1 exposed, not a general framework.
 */

/**
 * Every payload key of every `INSERT INTO domain_events ... jsonb_build_object(...)` in one SQL
 * source, matched by BALANCED PARENTHESES so nested calls like `btrim(p_provider)` do not truncate
 * the scan.
 */
function domainEventPayloadKeys(source) {
  const keys = [];
  const re = /INSERT\s+INTO\s+(?:public\.)?domain_events/gi;
  let match = re.exec(source);
  while (match) {
    const after = source.slice(match.index);
    const jb = after.indexOf('jsonb_build_object(');
    if (jb !== -1 && jb < 2000) {
      const open = jb + 'jsonb_build_object('.length;
      let depth = 1;
      let i = open;
      for (; i < after.length && depth > 0; i += 1) {
        if (after[i] === '(') depth += 1;
        else if (after[i] === ')') depth -= 1;
      }
      const body = after.slice(open, i - 1);
      let level = 0;
      let expectKey = true;
      for (const token of body.match(/'[^']*'|[(),]|[^,()]+/g) || []) {
        if (token === '(') { level += 1; continue; }
        if (token === ')') { level -= 1; continue; }
        if (token === ',') { if (level === 0) expectKey = !expectKey; continue; }
        if (level === 0 && expectKey && /^'[A-Za-z_]+'$/.test(token.trim())) keys.push(token.trim().slice(1, -1));
      }
    }
    match = re.exec(source);
  }
  return keys;
}

test('C1 GATE: every subscribed event is ADDRESSABLE, not merely emittable', async () => {
  const { NOTIFICATION_POLICIES } = await import('../services/communication/communicationNotificationService.js');
  const { SAFETRADE_ADAPTED_EVENT_TYPES } = await import('../services/communication/adapters/safeTradeDomainEventAdapter.js');

  // The recipient keys queueFromDomainEvent will accept straight off a payload.
  const RECIPIENT_KEYS = /recipientUserId|recipient_user_id|userId|user_id|buyerId|buyer_id|sellerId|seller_id/;

  const unaddressable = [];
  for (const eventType of COMMUNICATION_EVENT_TYPES) {
    // An adapter that resolves participants from canonical authority makes the event addressable
    // even though its emitter carries no principal. That is exactly the SafeTrade case.
    if (SAFETRADE_ADAPTED_EVENT_TYPES.has(eventType)) continue;

    // Otherwise SOME emitter of this event must put a recipient on the payload. For SQL emitters we
    // check the emitting migration; for JS emitters, the emitting file.
    const escaped = eventType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const literal = new RegExp(`['"\x60]${escaped}['"\x60]`);
    // The PAYLOAD keys, not "the file mentions buyer_id somewhere". The SafeTrade session migration
    // contains `p_actor_id=v_tx.buyer_id` in its permission guard, so a file-level scan calls it
    // addressable when the emitted payload carries no principal at all — the very illusion this
    // gate exists to destroy.
    const sqlCarriesRecipient = migrationSources.some((source) => literal.test(source)
      && domainEventPayloadKeys(source).some((key) => RECIPIENT_KEYS.test(key)));
    const jsCarriesRecipient = scannedFiles.some(({ source }) => emitterRegexFor(eventType).test(source)
      && RECIPIENT_KEYS.test(source));
    // Some events are addressed by a named producer at the orchestrator, not by the policy table:
    // marketplace inquiries become a canonical conversation, and user.email.verified is routed to
    // the Leadership Welcome producer, which resolves the recipient from the user record.
    const producerRouted = eventType === 'marketplace.inquiry.created' || eventType === 'user.email.verified';
    if (!sqlCarriesRecipient && !jsCarriesRecipient && !producerRouted) unaddressable.push(eventType);
  }

  assert.deepEqual(unaddressable, [],
    `subscribed but UNADDRESSABLE — these would be emitted and silently dropped: ${unaddressable.join(', ')}`);

  // ...and every subscribed type must have a policy that can actually canonicalize it.
  // Producer-routed events never reach getPolicy() — the orchestrator branches before it — so
  // requiring a policy entry for them would be requiring dead configuration.
  const PRODUCER_ROUTED = new Set(['marketplace.inquiry.created', 'user.email.verified']);
  const uncanonicalizable = COMMUNICATION_EVENT_TYPES.filter((eventType) => {
    if (PRODUCER_ROUTED.has(eventType)) return false;
    const policy = NOTIFICATION_POLICIES[eventType];
    return !policy || !policy.templateKey || !policy.classification;
  });
  assert.deepEqual(uncanonicalizable, [],
    `subscribed but with no governed policy/template/classification: ${uncanonicalizable.join(', ')}`);
});

test('C1 GATE: an event adapted by the SafeTrade adapter must actually BE subscribed', async () => {
  const { SAFETRADE_ADAPTED_EVENT_TYPES } = await import('../services/communication/adapters/safeTradeDomainEventAdapter.js');
  const subscribed = new Set(COMMUNICATION_EVENT_TYPES);
  const orphaned = [...SAFETRADE_ADAPTED_EVENT_TYPES].filter((e) => !subscribed.has(e));
  assert.deepEqual(orphaned, [], `adapted but not subscribed — the adapter would never run: ${orphaned.join(', ')}`);
});
