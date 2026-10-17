/**
 * OC-5D (P3) — the Service Network migrations, ported from PR #197 and re-timestamped, proven as a SET.
 *
 * The six per-slice PGlite checks (database/test/service_network_s*_check.mjs) prove each migration's own
 * behaviour. This file proves what only the set can show:
 *   · ORDER — #197's 20260904* stamps sorted before migrations the slices depend on or follow (one even
 *     shared its timestamp with an RC1 migration). Every Service Network file now sorts after every
 *     object it references, in dependency order, inside OC-5D's range, with no timestamp collision;
 *   · RE-APPLICATION — a migration's version is its full filename, so an environment that applied #197's
 *     20260904* copies will run these again. Applying the whole set twice changes nothing and loses no
 *     row (schema snapshot identical, seeded rows intact);
 *   · O4 — the dedupe trigger function is replaced by its LAST definition, so the last definition must
 *     contain every earlier branch verbatim; it derives the documented keys, a replayed transition is
 *     refused by the database, and EXECUTE is not left granted to PUBLIC/anon/authenticated (#197 omitted
 *     the REVOKE);
 *   · O5 — 'service_case' joins the twelve thread types, nothing invented does;
 *   · F3 — `service_case_status_v1` is registered (in-app, approved), its in-code mirror is the same copy,
 *     and the notification service feeds every required variable from a case event's payload.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { CommunicationNotificationService } = await import('../services/communication/communicationNotificationService.js');
const { CommunicationTemplateService } = await import('../services/communication/communicationTemplateService.js');

const MIGRATIONS = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const read = (file) => readFileSync(`${MIGRATIONS}${file}`, 'utf8');
const ALL = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

const SN = {
  s1: '20261004180000_service_network_s1_garage_identity.sql',
  s2: '20261004180100_service_network_s2_service_cases.sql',
  s3: '20261004180200_service_network_s3_inquiry_target_garage.sql',
  s4: '20261004180300_service_network_s4_work_order_assignment.sql',
  s5: '20261004180400_service_network_s5_service_records.sql',
  s8: '20261004180500_service_network_s8_service_links.sql',
  o4: '20261004180600_service_network_o4_event_dedupe.sql',
  o5: '20261004180700_service_network_o5_thread_type.sql',
  template: '20261004180800_service_network_case_status_template.sql',
};

function split(file) {
  const raw = read(file);
  assert.ok(raw.includes('-- +migrate Up'), `${file}: missing "-- +migrate Up"`);
  const idx = raw.indexOf('-- +migrate Down');
  return {
    up: (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', ''),
    down: idx >= 0 ? raw.slice(idx).replace('-- +migrate Down', '') : '',
  };
}

// ── ORDER ───────────────────────────────────────────────────────────────────────────────────────

/** What each Service Network migration references, and the migration that creates it. */
const DEPENDS_ON = {
  s1: ['20260617120000_user_sessions_auth_contract_align.sql'],
  s2: [SN.s1],
  s3: ['20260616120000_marketplace_v1_inquiries.sql'],
  s4: [SN.s1, SN.s2, '20260808150000_mechanic_work_orders_convergence.sql', '20261004160100_oc5a_work_order_owner_authorization.sql'],
  s5: [SN.s2, SN.s4, '20260710130000_partsentry_review_requests.sql', '20261004160200_oc5a_partsentry_attested_record_and_ledger_intents.sql'],
  s8: [SN.s1, SN.s2],
  o4: ['20260811132100_communications_2_reliability_closure.sql', '20260826120000_email_1_0_hardening.sql'],
  o5: ['20260623143000_omnichannel_communication_engine.sql'],
  template: ['20260811131500_communications_2_conversation_core.sql', SN.o5],
};

test('order: every Service Network migration exists under its OC-5D name, and #197\'s 20260904* copies do not', () => {
  for (const file of Object.values(SN)) assert.ok(ALL.includes(file), `${file} is missing`);
  const stale = ALL.filter((f) => /^20260904\d{6}_service_network_/.test(f));
  assert.deepEqual(stale, [], 'a #197-stamped copy would run before migrations it depends on');
});

test('order: each file sorts after everything it references, and the set is in dependency order', () => {
  for (const [slice, deps] of Object.entries(DEPENDS_ON)) {
    for (const dep of deps) {
      assert.ok(ALL.includes(dep), `${slice}: dependency ${dep} does not exist`);
      assert.ok(dep < SN[slice], `${SN[slice]} must sort after ${dep}`);
    }
  }
});

test('order: the set sits after every RC1 and earlier OC-5 migration, inside OC-5D\'s range, with no timestamp collision', () => {
  const files = Object.values(SN);
  const lastBefore = ALL.filter((f) => !files.includes(f) && f < files[0]).pop();
  assert.ok(lastBefore < files[0], 'nothing interleaves before the set');
  assert.ok(ALL.filter((f) => !files.includes(f)).every((f) => f < files[0] || f > files[files.length - 1]),
    'no other migration sorts inside the Service Network set');
  for (const f of files) assert.match(f, /^2026100418\d{4}_/, `${f} is outside OC-5D's 2026100418xxxx range`);
  // #197's S4/O4 shared their stamps with RC1 migrations; no Service Network stamp may be shared now.
  // (Older pairs elsewhere in the tree predate OC-5 and are not this set's to rename.)
  for (const f of files) {
    const sharing = ALL.filter((other) => other !== f && other.slice(0, 14) === f.slice(0, 14));
    assert.deepEqual(sharing, [], `${f} shares its timestamp`);
  }
});

// ── A disposable PostgreSQL with every prerequisite, built from the real migrations ──────────────

const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;
  CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, role TEXT, is_verified BOOLEAN DEFAULT false);
  INSERT INTO users(id, name, role) VALUES ('u3','Croco Dealer','dealer') ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS vehicles (vin TEXT PRIMARY KEY, owner_id TEXT, trust_score NUMERIC, status TEXT);
  CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT, type TEXT);
  CREATE TABLE IF NOT EXISTS safepay_escrows (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS partsentry_logs (id BIGSERIAL PRIMARY KEY, vin TEXT);
  CREATE TABLE IF NOT EXISTS blockchain_events (id BIGSERIAL PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS finance_applications (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS insurance_records (id TEXT PRIMARY KEY);
`;

/** A statement located in a real migration — so a renamed or reshaped source fails here, by name. */
function slice(file, startMarker, endMarker) {
  const sql = read(file);
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end > start, `${file}: cannot locate "${startMarker}"`);
  return sql.slice(start, end);
}

function prerequisites() {
  return [
    split('002_multi_tenant_and_auth_schema.sql').up,
    split('006_domain1.sql').up,
    split('20260808150000_mechanic_work_orders_convergence.sql').up,
    split('20260616120000_marketplace_v1_inquiries.sql').up,
    slice('011_phase6_schema.sql', 'CREATE TABLE IF NOT EXISTS domain_events (', ');'),
    slice('20260811132100_communications_2_reliability_closure.sql', 'ALTER TABLE public.domain_events', 'WHERE dedupe_key IS NOT NULL;'),
    slice('20260826120000_email_1_0_hardening.sql', 'CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key()', 'FROM PUBLIC, anon, authenticated;'),
    slice('20260623143000_omnichannel_communication_engine.sql', 'CREATE TABLE IF NOT EXISTS message_threads (', ');'),
    slice('20260811131500_communications_2_conversation_core.sql', 'CREATE TABLE IF NOT EXISTS communication_templates (',
      read('20260811131500_communications_2_conversation_core.sql').slice(
        read('20260811131500_communications_2_conversation_core.sql').indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_communication_template_version_unique'),
      ).split(';')[0] + ';'),
  ];
}

async function database() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const sql of prerequisites()) await db.exec(sql);
  return db;
}

async function applySet(db) {
  for (const file of Object.values(SN)) await db.exec(split(file).up);
}

/** Everything a migration can change, in a comparable form. */
async function snapshot(db) {
  const rows = async (sql) => (await db.query(sql)).rows;
  return {
    columns: await rows(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema='public' ORDER BY table_name, column_name`),
    constraints: await rows(`SELECT conrelid::regclass::text AS rel, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE connamespace='public'::regnamespace ORDER BY 1, 2`),
    indexes: await rows(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1, 2`),
    triggers: await rows(`SELECT tgrelid::regclass::text AS rel, tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    rls: await rows(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY 1`),
    grants: await rows(`SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema='public' ORDER BY 1, 2, 3`),
    functions: await rows(`SELECT proname, md5(prosrc) AS src, proacl::text AS acl FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1`),
    templates: await rows(`SELECT t.template_key, t.status, v.channel, v.version, v.approval_status, v.body_template
      FROM communication_templates t LEFT JOIN communication_template_versions v ON v.template_id=t.id ORDER BY 1, 3, 4`),
  };
}

// ── RE-APPLICATION ──────────────────────────────────────────────────────────────────────────────

test('re-application: applying the whole set twice changes nothing and loses no row', async () => {
  const db = await database();
  try {
    await applySet(db);
    await db.exec(`
      INSERT INTO users(id, role) VALUES ('u-mech','mechanic'), ('u-owner','owner');
      INSERT INTO vehicles(vin, owner_id) VALUES ('OC5DSNVIN0000001','u-owner');
      INSERT INTO tenants(id, name, type) VALUES ('11111111-1111-1111-1111-111111111111','Mbare Motors','garage');
      INSERT INTO garage_public_profiles(tenant_id, display_name, slug, created_by_user_id)
        VALUES ('11111111-1111-1111-1111-111111111111','Mbare Motors','mbare-motors','u-mech');
      INSERT INTO service_cases(id, vin, garage_tenant_id, requester_user_id, created_by_user_id)
        VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','OC5DSNVIN0000001','11111111-1111-1111-1111-111111111111','u-owner','u-owner');
      INSERT INTO mechanic_work_orders(id, tenant_id, vin, service_case_id, status, currency)
        VALUES ('11111111-2222-3333-4444-555555555555','11111111-1111-1111-1111-111111111111','OC5DSNVIN0000001','cccccccc-cccc-cccc-cccc-cccccccccccc','In Progress','ZAR');
    `);
    const first = await snapshot(db);
    await applySet(db);
    const second = await snapshot(db);
    assert.deepEqual(second, first, 'a second application changed the schema');
    const counts = (await db.query(`SELECT (SELECT count(*) FROM garage_public_profiles)::int g, (SELECT count(*) FROM service_cases)::int c,
      (SELECT count(*) FROM mechanic_work_orders WHERE service_case_id IS NOT NULL)::int w`)).rows[0];
    assert.deepEqual(counts, { g: 1, c: 1, w: 1 }, 'a second application lost rows');
    const templates = second.templates.filter((t) => t.template_key === 'service_case_status_v1');
    assert.equal(templates.length, 1, 'the template version is registered exactly once');
  } finally { await db.close(); }
});

test('re-application: every Down, newest first, then every Up again, round-trips to the same schema', async () => {
  const db = await database();
  try {
    await applySet(db);
    const applied = await snapshot(db);
    for (const file of Object.values(SN).reverse()) await db.exec(split(file).down);
    await applySet(db);
    assert.deepEqual(await snapshot(db), applied);
  } finally { await db.close(); }
});

// ── O4 ──────────────────────────────────────────────────────────────────────────────────────────

/** Every Up-section definition of the dedupe function, in migration order. */
function dedupeDefinitions() {
  const defs = [];
  for (const file of ALL) {
    // The scan reads every migration, including pre-marker legacy files (whole file = Up).
    const raw = read(file);
    const up = raw.includes('-- +migrate Down') ? raw.slice(0, raw.indexOf('-- +migrate Down')) : raw;
    const at = up.indexOf('FUNCTION public.communication_domain_event_dedupe_key()');
    if (at < 0 || !/CREATE OR REPLACE FUNCTION public\.communication_domain_event_dedupe_key\(\)/.test(up)) continue;
    const body = up.slice(up.indexOf('AS $$', at), up.indexOf('$$;', up.indexOf('AS $$', at)));
    defs.push({ file, body });
  }
  return defs;
}

/** The IF/ELSIF branches of a definition, each as its verbatim text. */
function branches(body) {
  return body.split(/\n\s*(?=(?:IF|ELSIF) NEW\.event_type)/).slice(1)
    .map((b) => b.replace(/\n\s*END IF;\s*RETURN NEW;[\s\S]*$/, '').trim());
}

test('O4: the LAST definition of the dedupe function contains every earlier branch verbatim (the last writer wins)', () => {
  const defs = dedupeDefinitions();
  assert.ok(defs.length >= 3, `expected the function's history, found ${defs.map((d) => d.file)}`);
  const last = defs[defs.length - 1];
  assert.equal(last.file, SN.o4, 'the Service Network definition must be the last one');
  const normalize = (s) => s.replace(/^\s*ELSIF\b/, 'IF').replace(/\s+/g, ' ').trim();
  const lastBranches = branches(last.body).map(normalize);
  for (const def of defs.slice(0, -1)) {
    for (const branch of branches(def.body)) {
      assert.ok(lastBranches.includes(normalize(branch)), `${def.file}: branch dropped or altered:\n${branch.slice(0, 160)}`);
    }
  }
});

test('O4: documented keys; a replayed transition is refused by the database; distinct transitions stay distinct; no case, no key', async () => {
  const db = await database();
  try {
    await applySet(db);
    const insert = (type, payload) => db.query(`INSERT INTO domain_events(event_type, payload) VALUES ($1, $2::jsonb) RETURNING dedupe_key`, [type, JSON.stringify(payload)]);
    const accepted = await insert('service.case.accepted', { serviceCaseId: 'case-1', occurredAt: '2026-10-04T10:00:00Z' });
    assert.equal(accepted.rows[0].dedupe_key, 'service.case.accepted:case-1');
    await assert.rejects(insert('service.case.accepted', { serviceCaseId: 'case-1', occurredAt: '2026-10-04T10:00:07Z' }), /duplicate key|23505/,
      'a replay with a fresh timestamp must collide, not notify twice');
    const completed = await insert('service.case.completed', { serviceCaseId: 'case-1' });
    assert.equal(completed.rows[0].dedupe_key, 'service.case.completed:case-1');
    for (const type of ['service.case.requested', 'service.case.declined', 'service.case.cancelled', 'service.work.started']) {
      assert.equal((await insert(type, { serviceCaseId: 'case-2' })).rows[0].dedupe_key, `${type}:case-2`);
    }
    assert.equal((await insert('service.case.accepted', {})).rows[0].dedupe_key, null);
    assert.equal((await insert('service.case.accepted', {})).rows[0].dedupe_key, null, 'case-less events stay insertable');
    // the three pre-existing identities are untouched
    assert.equal((await insert('marketplace.inquiry.created', { inquiryId: 'iq-1' })).rows[0].dedupe_key, 'marketplace.inquiry.created:iq-1');
    assert.equal((await insert('user.email.verified', { recipientUserId: 'u-9' })).rows[0].dedupe_key, 'user.email.verified:u-9');
    assert.equal((await insert('vehicle.trust.presentation_changed', { presentation_fingerprint: 'fp-1' })).rows[0].dedupe_key, 'vehicle.trust.presentation_changed:fp-1');
    assert.equal((await insert('something.else', { serviceCaseId: 'case-3' })).rows[0].dedupe_key, null);
  } finally { await db.close(); }
});

test('O4: EXECUTE on the trigger function is not left to PUBLIC, anon or authenticated (Up and Down)', async () => {
  const canExecute = async (db, role) => (await db.query(
    `SELECT has_function_privilege($1, 'public.communication_domain_event_dedupe_key()', 'EXECUTE') AS ok`, [role])).rows[0].ok;
  const db = await database();
  try {
    await db.exec(split(SN.o4).up);
    for (const role of ['anon', 'authenticated']) assert.equal(await canExecute(db, role), false, `${role} can execute after Up`);
    await db.exec(split(SN.o4).down);
    for (const role of ['anon', 'authenticated']) assert.equal(await canExecute(db, role), false, `${role} can execute after Down`);
  } finally { await db.close(); }

  // CREATE OR REPLACE keeps an EXISTING function's grants, so the case that needs O4's own REVOKE is a
  // database where the function does not exist yet — CREATE FUNCTION grants EXECUTE to PUBLIC there.
  for (const leg of ['up', 'down']) {
    const fresh = new PGlite();
    try {
      await fresh.exec(BOOTSTRAP);
      await fresh.exec(slice('011_phase6_schema.sql', 'CREATE TABLE IF NOT EXISTS domain_events (', ');'));
      await fresh.exec(slice('20260811132100_communications_2_reliability_closure.sql', 'ALTER TABLE public.domain_events', 'WHERE dedupe_key IS NOT NULL;'));
      await fresh.exec(split(SN.o4)[leg]);
      for (const role of ['anon', 'authenticated']) assert.equal(await canExecute(fresh, role), false, `${role} can execute on a fresh database (${leg})`);
    } finally { await fresh.close(); }
  }
});

// ── O5 ──────────────────────────────────────────────────────────────────────────────────────────

test('O5: service_case joins the twelve thread types; an invented type is still refused', async () => {
  const db = await database();
  try {
    await applySet(db);
    const types = ['support', 'marketplace_inquiry', 'referral', 'escrow', 'finance', 'import', 'container',
      'trust_safety', 'feedback', 'complaint', 'account', 'general', 'service_case'];
    for (const [i, type] of types.entries()) {
      await db.query(`INSERT INTO message_threads(thread_key, thread_type) VALUES ($1, $2)`, [`k-${i}`, type]);
    }
    await assert.rejects(db.query(`INSERT INTO message_threads(thread_key, thread_type) VALUES ('k-x', 'garage_gossip')`), /check constraint|23514/);
  } finally { await db.close(); }
});

// ── F3: service_case_status_v1 ──────────────────────────────────────────────────────────────────

test('F3: service_case_status_v1 is registered — active, transactional, one approved in-app version with the variables the payload feeds', async () => {
  const db = await database();
  try {
    await applySet(db);
    const { rows } = await db.query(`SELECT t.status, t.classification, v.channel, v.language, v.version, v.approval_status,
        v.subject_template, v.body_template, v.required_variables
      FROM communication_templates t JOIN communication_template_versions v ON v.template_id=t.id
      WHERE t.template_key='service_case_status_v1'`);
    assert.equal(rows.length, 1);
    const [v] = rows;
    assert.deepEqual([v.status, v.classification, v.channel, v.language, v.version, v.approval_status],
      ['active', 'transactional', 'in_app', 'en', 1, 'approved']);
    assert.deepEqual(v.required_variables, ['listing_id', 'status']);
    assert.doesNotMatch(`${v.subject_template} ${v.body_template}`, /request_summary|note|price|cost|\$/i, 'factual copy only');

    // the in-code mirror IS the governed copy
    const mirror = new CommunicationTemplateService().render('service_case_status_v1', { listing_id: 'OC5DSNVIN0000001', status: 'accepted' });
    assert.equal(mirror.subject, v.subject_template);
    assert.equal(mirror.body, v.body_template.replace('{{listing_id}}', 'OC5DSNVIN0000001').replace('{{status}}', 'accepted'));

    // the notification service derives every required variable from a case event's payload
    const variables = CommunicationNotificationService.prototype.variablesForEvent.call(null, 'service.case.accepted',
      { serviceCaseId: 'case-1', vin: 'OC5DSNVIN0000001', status: 'accepted', recipientUserId: 'u-owner' });
    for (const key of v.required_variables) assert.ok(variables[key], `the payload does not feed ${key}`);
    assert.equal(variables.listing_id, 'OC5DSNVIN0000001');
    assert.equal(variables.status, 'accepted');

    // Down removes only what this migration wrote
    await db.exec(split(SN.template).down);
    assert.equal((await db.query(`SELECT count(*)::int n FROM communication_templates WHERE template_key='service_case_status_v1'`)).rows[0].n, 0);
  } finally { await db.close(); }
});
