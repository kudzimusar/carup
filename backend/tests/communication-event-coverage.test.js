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

/**
 * The legal thread types, DERIVED from the migrations rather than mirrored by hand.
 *
 * This used to be a hand-copied list with a comment pointing at the migration that defined it.
 * That is a second source of truth: extending the CHECK in a later migration left the mirror
 * stale, so this gate reported a violation against a constraint the database no longer had — and
 * had the drift gone the other way it would have PASSED a policy the database would reject, which
 * is the exact failure it exists to catch.
 *
 * Migrations are read in filename (timestamp) order and the LAST definition of
 * `message_threads_thread_type_check` wins, which is what the database ends up with.
 */
function legalThreadTypesFromMigrations() {
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    : [];
  let latest = null;
  for (const file of files) {
    const source = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Only the Up section defines what the database will hold.
    const up = source.split(/^-- \+migrate Down/m)[0];
    // Either the inline column CHECK or a named ADD CONSTRAINT.
    const matches = [...up.matchAll(/thread_type\s+IN\s*\(([^)]*)\)/gi)];
    if (!matches.length) continue;
    const values = [...matches[matches.length - 1][1].matchAll(/'([a-z_]+)'/gi)].map((m) => m[1]);
    if (values.length) latest = values;
  }
  return latest;
}

const LEGAL_THREAD_TYPES = legalThreadTypesFromMigrations();

test('the thread-type CHECK is discoverable in the migrations', () => {
  assert.ok(Array.isArray(LEGAL_THREAD_TYPES) && LEGAL_THREAD_TYPES.length >= 12,
    'could not derive message_threads_thread_type_check from the migrations — this gate would be vacuous');
  // The original twelve must survive every later redefinition.
  for (const original of ['support', 'marketplace_inquiry', 'referral', 'escrow', 'finance', 'import',
    'container', 'trust_safety', 'feedback', 'complaint', 'account', 'general']) {
    assert.ok(LEGAL_THREAD_TYPES.includes(original),
      `a later migration dropped '${original}' from the thread-type CHECK`);
  }
});

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

/**
 * A policy's templateKey must be REGISTERED BY A MIGRATION, not merely mirrored in
 * communicationTemplateService.js. The governed registry fails closed for an unregistered key —
 * deliberately — so a key that exists only in the in-code compatibility map renders fine in unit
 * tests and then dead-letters every notification on any environment where the Communications 2.0
 * schema is applied. That is precisely what happened to rfq_update_v1 and logistics_update_v1:
 * three T2 and three T3 policies bound them, no migration inserted them, and staging accumulated
 * 60 undeliverable lifecycle events while every local suite stayed green.
 */
/** Every key some migration inserts into the governed registry. Schema-qualified inserts count too:
 *  SA1 registers the auth emails with `INSERT INTO public.communication_templates`, which the original
 *  pattern could not see (OC-5G). */
function registeredTemplateKeys() {
  const migrationsDir = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
  const registered = new Set();
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    if (!/INSERT\s+INTO\s+(?:public\.)?communication_templates\b/i.test(sql)) continue;
    for (const m of sql.matchAll(/\(\s*'([a-z0-9_]+)'\s*,/gi)) registered.add(m[1]);
    for (const m of sql.matchAll(/template_key\s*=\s*'([a-z0-9_]+)'/gi)) registered.add(m[1]);
  }
  return registered;
}

test('every notification-policy templateKey is inserted into communication_templates by a migration', () => {
  const registered = registeredTemplateKeys();

  const policySource = fs.readFileSync(
    fileURLToPath(new URL('../services/communication/communicationNotificationService.js', import.meta.url)), 'utf8');
  const bound = new Set([...policySource.matchAll(/templateKey:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));

  // No exceptions. This test used to carry a KNOWN_UNREGISTERED list of six keys whose
  // notifications dead-lettered wherever the registry is applied (identity decisions, listing
  // moderation, evidence reviews, seller authority, Vehicle Passport trust, every SafeTrade stage).
  // OC-5G registered all six (20261004210000), at the programme moderator's direction, from the lanes'
  // own copy, and the list went with them. A new policy key ships with its registration, or this fails.
  const unregistered = [...bound]
    .filter((key) => !registered.has(key))
    .sort();
  assert.deepEqual(
    unregistered,
    [],
    'These templateKeys are bound by NOTIFICATION_POLICIES but never inserted into the governed '
    + 'communication_templates registry by any migration — they will fail closed and dead-letter '
    + 'wherever the registry exists:\n  ' + unregistered.join('\n  '),
  );
});

/**
 * OC-5G — the gate above reads NOTIFICATION_POLICIES only. A key rendered through the governed path
 * by any other call site — a producer, the auth emails, a route — never appears there, so it could be
 * unregistered and every send could fail closed with this suite green. `leadership_welcome_v1` was
 * exactly that: Email Experience R1's producer renders it on every verified address, and no
 * migration registers it.
 *
 * The call sites that reach the governed renderer are `queueNotification(…)` (the canonical and
 * product services render it), `queueAuthEmail(…)` (which passes its key straight into
 * queueNotification), and a direct `templateService.render('<key>'…)`. `queueExistingMessage`
 * renders nothing, so its keys are not counted.
 */
function objectLiteralAt(source, openIndex) {
  // Balanced braces from `{`, skipping comments, quoted strings and template literals. Comments
  // first: an apostrophe in `// the thread's own messages` is not a string.
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) return ''; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; if (i <= 0) return ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      for (i += 1; i < source.length && source[i] !== quote; i += 1) if (source[i] === '\\') i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(openIndex, i + 1); }
  }
  return '';
}

function renderedTemplateKeys(emailRegistry) {
  const roots = ['../services', '../routes'].map((dir) => fileURLToPath(new URL(`${dir}/`, import.meta.url)));
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Transient copies another test writes beside the real module (issue-158); never runtime code.
      if (entry.name.startsWith('__mutant__')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  roots.forEach(walk);
  const sites = new Map(); // key → [file, …]
  const add = (key, file) => sites.set(key, [...(sites.get(key) || []), path.relative(fileURLToPath(new URL('../..', import.meta.url)), file)]);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    // `const entry = referenceEntry('leadership_welcome')` → that reference's governed key.
    const entries = new Map([...source.matchAll(/const\s+(\w+)\s*=\s*referenceEntry\('([a-z_]+)'\)/g)]
      .map((m) => [m[1], emailRegistry[m[2]]?.templateKey]));
    for (const call of source.matchAll(/\b(?:queueNotification|queueAuthEmail)\(\s*\{/g)) {
      const literal = objectLiteralAt(source, call.index + call[0].length - 1);
      const direct = /\btemplateKey:\s*'([a-z0-9_]+)'/.exec(literal);
      if (direct) add(direct[1], file);
      const viaEntry = /\btemplateKey:\s*(\w+)\.templateKey\b/.exec(literal);
      if (viaEntry && entries.get(viaEntry[1])) add(entries.get(viaEntry[1]), file);
    }
    for (const render of source.matchAll(/templateService\.render\(\s*'([a-z0-9_]+)'/g)) add(render[1], file);
  }
  return sites;
}

/** Keys a governed render reaches that no migration registers, each a recorded owner decision. When
 *  one is registered, the test below fails until its entry is removed here. */
const RENDERED_UNREGISTERED_OWNER_DECISIONS = new Map([
  ['leadership_welcome_v1', 'Email Experience R1 (leadership welcome, sent on email verification). Its governed '
    + 'subject/body is the Email Experience lane\'s to author; until it is registered, every welcome fails closed '
    + 'wherever the registry exists. Recorded by OC-5G for the owner; not authored here.'],
]);

test('every template key a governed render reaches outside the policy table is registered — or is a recorded owner decision', async () => {
  const { EMAIL_TEMPLATE_REGISTRY } = await import('../services/communication/emailExperience/emailTemplateRegistry.js');
  const registered = registeredTemplateKeys();
  const sites = renderedTemplateKeys(EMAIL_TEMPLATE_REGISTRY);

  // The scan finds the call sites it exists to see: not a vacuous pass.
  for (const key of ['leadership_welcome_v1', 'auth_password_reset_v1', 'auth_email_verification_v1', 'auth_password_changed_v1',
    'message_acknowledgement_v1', 'listing_shared_v1', 'conversation_reply_whatsapp_v1']) {
    assert.ok(sites.has(key), `the scan no longer sees the governed render of ${key}`);
  }
  assert.ok(registered.has('auth_password_reset_v1'), 'a schema-qualified INSERT INTO public.communication_templates registers too');

  const missing = [...sites.keys()]
    .filter((key) => !registered.has(key) && !RENDERED_UNREGISTERED_OWNER_DECISIONS.has(key))
    .map((key) => `${key}  (${sites.get(key).join(', ')})`)
    .sort();
  assert.deepEqual(missing, [], 'rendered through the governed path, registered by no migration — every send fails closed '
    + 'wherever the registry exists:\n  ' + missing.join('\n  '));

  for (const key of RENDERED_UNREGISTERED_OWNER_DECISIONS.keys()) {
    assert.ok(sites.has(key), `${key} is listed but no longer rendered — remove its entry`);
    assert.ok(!registered.has(key), `${key} is now registered — remove its owner-decision entry`);
  }
});
