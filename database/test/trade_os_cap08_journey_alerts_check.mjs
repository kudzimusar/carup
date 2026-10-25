/**
 * Trade OS T11-CAP-08 — Journey alerts: the database-enforced identity of one alert, on a REAL Postgres (PGlite).
 *
 * The event worker re-runs every handler of an event when any one throws, so an alert handler that told
 * two people before failing on the third runs again for all three. The only thing that makes that safe is
 * an identity the DATABASE enforces: one (kind, order, person, observation) is one alert.
 *
 * This is the part a JS mirror of the SQL cannot prove, so it runs the real function. It also proves the
 * thing most likely to be broken by editing a shared trigger function: that the three branches it already
 * had — the Email 1.0 ones — still give EXACTLY the same answers. The same inputs go through the old
 * function (extracted from the migration that defined it) and the new one, and must agree.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf-8');
const migration = read('../migrations/20260922090000_trade_os_cap08_journey_alerts.sql');
const up = migration.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = migration.split('-- +migrate Down')[1];

// The function exactly as Email 1.0 left it: the state this migration is applied on top of.
const email10 = read('../migrations/20260826120000_email_1_0_hardening.sql');
const oldFunction = email10.match(/CREATE OR REPLACE FUNCTION public\.communication_domain_event_dedupe_key\(\)[\s\S]*?\$\$;/)?.[0];
if (!oldFunction) { console.error('could not find the Email 1.0 function to compare against'); process.exit(2); }

const db = new PGlite();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); }
};
const refuses = async (name, stmt, pattern) => check(name, async () => {
  let threw = null;
  try { await db.exec(stmt); } catch (e) { threw = e; }
  if (!threw) throw new Error('the database ACCEPTED what it must refuse');
  if (pattern && !pattern.test(threw.message)) throw new Error(`refused for the wrong reason: ${threw.message.split('\n')[0]}`);
});
const key = async (table, type, payload) => {
  const r = await db.query(`INSERT INTO public.${table} (event_type, payload) VALUES ($1, $2::jsonb) RETURNING dedupe_key;`, [type, JSON.stringify(payload)]);
  return r.rows[0].dedupe_key;
};

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;

  CREATE TABLE public.domain_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0, tenant_id text NULL,
    dedupe_key text NULL, created_at timestamptz NOT NULL DEFAULT now()
  );
  -- As 20260811132100 created them: a PARTIAL unique index (a NULL key is exempt by construction) and the trigger.
  CREATE UNIQUE INDEX idx_domain_events_dedupe_key ON public.domain_events (dedupe_key) WHERE dedupe_key IS NOT NULL;

  CREATE TABLE public.communication_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_key text NOT NULL UNIQUE,
    business_workflow text, stakeholder_audience text, classification text, owner_team text,
    status text NOT NULL DEFAULT 'active', metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE public.communication_template_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES public.communication_templates(id),
    version int NOT NULL, channel text NOT NULL, language text NOT NULL, subject_template text, body_template text,
    required_variables jsonb, optional_variables jsonb, approval_status text, experiment_metadata jsonb,
    UNIQUE (template_id, version, channel, language)
  );

  -- Probe tables run the SAME inputs through an old and a new function without the unique index in the way.
  CREATE TABLE public.probe_old (event_type text, payload jsonb, dedupe_key text);
  CREATE TABLE public.probe_new (event_type text, payload jsonb, dedupe_key text);
`);

// The state the migration is applied ON TOP OF: the Email 1.0 function, bound to domain_events and the old probe.
await db.exec(oldFunction);
await db.exec(`
  CREATE TRIGGER trg_domain_events_communication_dedupe BEFORE INSERT ON public.domain_events
    FOR EACH ROW EXECUTE FUNCTION public.communication_domain_event_dedupe_key();
`);
await db.exec(oldFunction.replace('communication_domain_event_dedupe_key', 'probe_old_fn'));
await db.exec(`CREATE TRIGGER probe_old_t BEFORE INSERT ON public.probe_old FOR EACH ROW EXECUTE FUNCTION public.probe_old_fn();`);

await check('before the migration, a Journey alert has NO identity — the defect this closes', async () => {
  const a = await key('domain_events', 'diaspora.journey.alert', { alertKey: 'DEPARTED:ord-1:user-1:evt-1' });
  const b = await key('domain_events', 'diaspora.journey.alert', { alertKey: 'DEPARTED:ord-1:user-1:evt-1' });
  if (a !== null || b !== null) throw new Error('the old function already had an identity for Journey alerts');
  await db.exec(`DELETE FROM public.domain_events;`);
});

await check('the migration applies on top of Email 1.0', async () => { await db.exec(up); });

await db.exec(`
  CREATE TRIGGER probe_new_t BEFORE INSERT ON public.probe_new FOR EACH ROW EXECUTE FUNCTION public.communication_domain_event_dedupe_key();
`);

// ── The new identity ──────────────────────────────────────────────────────

for (const type of ['diaspora.journey.alert', 'diaspora.journey.exception']) {
  await check(`${type}: the key is the event type and the alert key`, async () => {
    const k = await key('domain_events', type, { alertKey: 'DEPARTED:ord-1:user-1:evt-1', recipientUserId: 'user-1' });
    if (k !== `${type}:DEPARTED:ord-1:user-1:evt-1`) throw new Error(`unexpected key ${k}`);
  });

  await refuses(`${type}: the SAME alert twice is refused — the unique index is the guarantee`,
    `INSERT INTO public.domain_events (event_type, payload) VALUES ('${type}', '{"alertKey":"DEPARTED:ord-1:user-1:evt-1"}');`,
    /idx_domain_events_dedupe_key|duplicate key/i);

  await check(`${type}: ON CONFLICT DO NOTHING recovers silently, as the event bus relies on`, async () => {
    const r = await db.query(`INSERT INTO public.domain_events (event_type, payload, status, attempts, tenant_id)
      VALUES ('${type}', '{"alertKey":"DEPARTED:ord-1:user-1:evt-1"}', 'pending', 0, NULL) ON CONFLICT DO NOTHING RETURNING *;`);
    if (r.rows.length !== 0) throw new Error('a duplicate was inserted instead of being recovered');
    const n = await db.query(`SELECT count(*)::int AS n FROM public.domain_events WHERE event_type='${type}' AND dedupe_key='${type}:DEPARTED:ord-1:user-1:evt-1';`);
    if (n.rows[0].n !== 1) throw new Error(`${n.rows[0].n} rows share one identity`);
  });
}

await check('a different person, order, kind or observation is a different alert', async () => {
  for (const alertKey of ['DEPARTED:ord-1:user-2:evt-1', 'DEPARTED:ord-2:user-1:evt-1', 'ARRIVED:ord-1:user-1:evt-1', 'DEPARTED:ord-1:user-1:evt-2']) {
    await db.exec(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.alert', '${JSON.stringify({ alertKey })}');`);
  }
});

await check('the event type is part of the identity: the same alert key under the other type is a different alert', async () => {
  const before = await db.query(`SELECT count(*)::int AS n FROM public.domain_events WHERE dedupe_key LIKE '%:DEPARTED:ord-1:user-9:evt-9';`);
  await db.exec(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.alert', '{"alertKey":"DEPARTED:ord-1:user-9:evt-9"}');`);
  await db.exec(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.exception', '{"alertKey":"DEPARTED:ord-1:user-9:evt-9"}');`);
  const after = await db.query(`SELECT count(*)::int AS n FROM public.domain_events WHERE dedupe_key LIKE '%:DEPARTED:ord-1:user-9:evt-9';`);
  if (after.rows[0].n - before.rows[0].n !== 2) throw new Error('the two types collided');
});

await check('no alert key means no identity: the row is insertable, and several of them are', async () => {
  for (const payload of [{}, { alertKey: null }, { alertKey: '' }, { alertKey: '   ' }]) {
    const k = await key('domain_events', 'diaspora.journey.alert', payload);
    if (k !== null) throw new Error(`a blank key produced an identity: ${JSON.stringify(k)}`);
  }
});

await check('surrounding whitespace is not part of the identity (the JS registry trims too)', async () => {
  const k = await key('probe_new', 'diaspora.journey.alert', { alertKey: '  DEPARTED:ord-5:user-5:evt-5  ' });
  if (k !== 'diaspora.journey.alert:DEPARTED:ord-5:user-5:evt-5') throw new Error(`unexpected key ${k}`);
});

await check('an alert key on any OTHER event type confers no identity — the new branch is not a catch-all', async () => {
  for (const type of ['diaspora.loading.cargo_loaded', 'diaspora.shipment.exception', 'VEHICLE_RESERVED', 'diaspora.journey.something_else']) {
    const k = await key('probe_new', type, { alertKey: 'DEPARTED:ord-1:user-1:evt-1' });
    if (k !== null) throw new Error(`${type} acquired an identity from an alertKey`);
  }
});

// ── Nothing that already worked changed ───────────────────────────────────

await check('the three Email 1.0 branches give EXACTLY the answers they gave before, for every input', async () => {
  const inputs = [
    ['marketplace.inquiry.created', { inquiryId: 'inq-1' }], ['marketplace.inquiry.created', { inquiryId: '' }], ['marketplace.inquiry.created', {}],
    ['marketplace.inquiry.created', { inquiryId: 'inq-1', alertKey: 'x' }],
    ['user.email.verified', { recipientUserId: 'user-1' }], ['user.email.verified', { recipientUserId: '' }], ['user.email.verified', {}],
    ['vehicle.trust.presentation_changed', { presentation_fingerprint: 'fp-1' }], ['vehicle.trust.presentation_changed', { presentation_fingerprint: '' }],
    ['vehicle.trust.presentation_changed', {}],
    ['diaspora.loading.cargo_loaded', { recipientUserId: 'user-1' }], ['diaspora.shipment.exception', { shipmentId: 's-1' }],
    ['VEHICLE_RESERVED', { id: 'x' }], ['MARKETPLACE_FUNDS_HELD', { transactionIntentId: 't' }], ['', {}],
  ];
  for (const [type, payload] of inputs) {
    const was = await key('probe_old', type, payload);
    const is = await key('probe_new', type, payload);
    if (was !== is) throw new Error(`${type} ${JSON.stringify(payload)}: was ${was}, is now ${is}`);
  }
});

await check('the trigger on domain_events is still the one bound to the function (the migration did not need to re-create it)', async () => {
  const r = await db.query(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.domain_events'::regclass AND p.proname = 'communication_domain_event_dedupe_key' AND NOT t.tgisinternal;`);
  if (r.rows[0].n !== 1) throw new Error(`${r.rows[0].n} triggers`);
});

// ── Governed access ───────────────────────────────────────────────────────

await check('the function cannot be executed by the browser or by PUBLIC', async () => {
  const r = await db.query(`SELECT has_function_privilege('anon','public.communication_domain_event_dedupe_key()','EXECUTE') AS a,
                                   has_function_privilege('authenticated','public.communication_domain_event_dedupe_key()','EXECUTE') AS b,
                                   has_function_privilege('public','public.communication_domain_event_dedupe_key()','EXECUTE') AS c;`).catch(async () => {
    // PGlite has no `public` pseudo-role in has_function_privilege on some builds; fall back to the ACL.
    const acl = await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname='communication_domain_event_dedupe_key';`);
    return { rows: [{ a: false, b: false, c: !/=X\//.test(acl.rows[0].acl || '') ? false : true }] };
  });
  const row = r.rows[0];
  if (row.a || row.b || row.c) throw new Error('EXECUTE is still granted');
});

// ── The governed wording ──────────────────────────────────────────────────

await check('journey_update_v1 is registered in the governed registry, in-app, approved, with its two required variables', async () => {
  const t = await db.query(`SELECT * FROM public.communication_templates WHERE template_key='journey_update_v1';`);
  if (t.rows.length !== 1) throw new Error('the template is not registered exactly once');
  const row = t.rows[0];
  if (row.classification !== 'transactional' || row.status !== 'active' || row.stakeholder_audience !== 'customer') throw new Error('wrong governance fields');
  const v = await db.query(`SELECT * FROM public.communication_template_versions WHERE template_id=$1;`, [row.id]);
  if (v.rows.length !== 1) throw new Error('the template does not have exactly one version');
  const ver = v.rows[0];
  if (ver.channel !== 'in_app' || ver.language !== 'en' || ver.approval_status !== 'approved' || ver.version !== 1) throw new Error('wrong version fields');
  if (ver.subject_template !== 'Your shipment {{reference}}' || ver.body_template !== '{{status}}') throw new Error(`wrong wording: ${ver.subject_template} / ${ver.body_template}`);
  if (JSON.stringify(ver.required_variables) !== JSON.stringify(['reference', 'status'])) throw new Error('wrong required variables');
});

await check('applying the migration again changes nothing — no second template, no second version', async () => {
  await db.exec(up);
  const t = await db.query(`SELECT count(*)::int AS n FROM public.communication_templates WHERE template_key='journey_update_v1';`);
  const v = await db.query(`SELECT count(*)::int AS n FROM public.communication_template_versions;`);
  if (t.rows[0].n !== 1 || v.rows[0].n !== 1) throw new Error(`templates ${t.rows[0].n}, versions ${v.rows[0].n}`);
});

await check('a template already registered by someone else is left alone, not overwritten', async () => {
  const db2 = new PGlite();
  await db2.exec(`
    CREATE TABLE public.domain_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text, payload jsonb, dedupe_key text);
    CREATE TABLE public.communication_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_key text NOT NULL UNIQUE,
      business_workflow text, stakeholder_audience text, classification text, owner_team text, status text DEFAULT 'active', metadata jsonb DEFAULT '{}'::jsonb);
    CREATE TABLE public.communication_template_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid, version int, channel text, language text,
      subject_template text, body_template text, required_variables jsonb, optional_variables jsonb, approval_status text, experiment_metadata jsonb,
      UNIQUE (template_id, version, channel, language));
    INSERT INTO public.communication_templates (template_key, business_workflow, owner_team, status) VALUES ('journey_update_v1', 'other_workflow', 'someone-else', 'retired');
    CREATE ROLE anon; CREATE ROLE authenticated;
  `);
  await db2.exec(up);
  const r = await db2.query(`SELECT owner_team, status FROM public.communication_templates WHERE template_key='journey_update_v1';`);
  await db2.close();
  if (r.rows[0].owner_team !== 'someone-else' || r.rows[0].status !== 'retired') throw new Error('an existing governed template was overwritten');
});

// ── Down ──────────────────────────────────────────────────────────────────

await check('Down restores the Email 1.0 function exactly — Journey alerts lose their identity, nothing else changes', async () => {
  await db.exec(down);
  const a = await key('probe_new', 'diaspora.journey.alert', { alertKey: 'DEPARTED:ord-1:user-1:evt-1' });
  if (a !== null) throw new Error('Down left the Journey branch in place');
  const inputs = [
    ['marketplace.inquiry.created', { inquiryId: 'inq-1' }], ['user.email.verified', { recipientUserId: 'user-1' }],
    ['vehicle.trust.presentation_changed', { presentation_fingerprint: 'fp-1' }], ['diaspora.loading.cargo_loaded', { recipientUserId: 'u' }],
    ['marketplace.inquiry.created', {}], ['user.email.verified', {}], ['vehicle.trust.presentation_changed', {}],
  ];
  for (const [type, payload] of inputs) {
    const was = await key('probe_old', type, payload);
    const is = await key('probe_new', type, payload);
    if (was !== is) throw new Error(`after Down, ${type} ${JSON.stringify(payload)}: Email 1.0 gave ${was}, the function now gives ${is}`);
  }
});

await check('Down does not delete the governed template — retiring it is its own decision', async () => {
  const t = await db.query(`SELECT count(*)::int AS n FROM public.communication_templates WHERE template_key='journey_update_v1';`);
  if (t.rows[0].n !== 1) throw new Error('Down removed the template');
});

await check('Down does not touch the events that already exist', async () => {
  const n = await db.query(`SELECT count(*)::int AS n FROM public.domain_events;`);
  if (n.rows[0].n < 1) throw new Error('events were lost');
});

// ── The JS registry names the same field ──────────────────────────────────

await check('the JS registry derives the identity from the same field and the same two event types', async () => {
  const js = read('../../backend/services/eventBus/eventBusService.js');
  const block = js.match(/DETERMINISTIC_EVENT_IDENTITY_FIELDS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1] || '';
  for (const type of ['diaspora.journey.alert', 'diaspora.journey.exception']) {
    if (!new RegExp(`'${type.replace(/\./g, '\\.')}'\\s*:\\s*\\['alertKey'\\]`).test(block)) throw new Error(`${type} is not registered on alertKey`);
  }
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));
await db.close();
process.exit(failed.length ? 1 : 0);
