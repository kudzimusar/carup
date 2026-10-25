/**
 * Trade OS T11-CAP-08 — Journey alerts: the database-enforced identity of one alert, on a REAL Postgres (PGlite).
 *
 * The event worker re-runs every handler of an event when any one throws, so an alert handler that told two
 * people before failing on the third runs again for all three. The only thing that makes that safe is an
 * identity the DATABASE enforces: one (kind, order, person, observation) is one alert.
 *
 * WHAT THIS CHECK EXISTS TO PROVE, because the first version of this migration got it wrong. The shared
 * `communication_domain_event_dedupe_key()` is re-stated wholesale by every programme that adds a branch, so the
 * last writer wins and each must know every earlier branch. This lineage cannot see Service Network's O4 branch,
 * which is live on staging; a migration here that re-stated the function would have silently removed it. So the
 * Journey identity is a DEDICATED trigger, and this check proves the three consequences:
 *
 *   1. the shared function is byte-for-byte untouched, so nobody else's branch can be lost to this migration;
 *   2. another programme re-stating the shared function AFTER this migration cannot remove the Journey identity;
 *   3. the Journey trigger fires for exactly two event types and confers nothing on any other.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf-8');
const migration = read('../migrations/20260922090000_trade_os_cap08_journey_alerts.sql');
const up = migration.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = migration.split('-- +migrate Down')[1];

// The shared function as Email 1.0 left it, then as ANOTHER programme's lineage re-states it (Service Network O4:
// a `service.case.*` branch this lineage does not contain), then as a still-later programme might.
const email10 = read('../migrations/20260826120000_email_1_0_hardening.sql');
const emailFunction = email10.match(/CREATE OR REPLACE FUNCTION public\.communication_domain_event_dedupe_key\(\)[\s\S]*?\$\$;/)?.[0];
if (!emailFunction) { console.error('could not find the Email 1.0 function'); process.exit(2); }

const restate = (extraBranch) => emailFunction
  .replace('  v_recipient TEXT;\nBEGIN', '  v_recipient TEXT;\n  v_other TEXT;\nBEGIN')
  .replace(/(    IF v_fingerprint IS NOT NULL THEN\n      NEW\.dedupe_key := 'vehicle\.trust\.presentation_changed:' \|\| v_fingerprint;\n    END IF;\n)/, `$1${extraBranch}`);
const O4_LIVE = restate(`  ELSIF NEW.event_type IN ('service.case.requested', 'service.case.accepted') THEN
    v_other := NULLIF(NEW.payload ->> 'serviceCaseId', '');
    IF v_other IS NOT NULL THEN
      NEW.dedupe_key := NEW.event_type || ':' || v_other;
    END IF;
`);
const LATER = restate(`  ELSIF NEW.event_type IN ('garage.appointment.booked') THEN
    v_other := NULLIF(NEW.payload ->> 'appointmentId', '');
    IF v_other IS NOT NULL THEN
      NEW.dedupe_key := NEW.event_type || ':' || v_other;
    END IF;
`);
if (!O4_LIVE.includes('service.case.accepted') || !LATER.includes('garage.appointment.booked')) { console.error('could not model the other lineages'); process.exit(2); }

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
const keyOf = async (type, payload) => {
  const r = await db.query(`INSERT INTO public.domain_events (event_type, payload) VALUES ($1, $2::jsonb) RETURNING id, dedupe_key;`, [type, JSON.stringify(payload)]);
  const { id, dedupe_key } = r.rows[0];
  await db.query(`DELETE FROM public.domain_events WHERE id = $1;`, [id]);
  return dedupe_key;
};
const sharedSource = async () => (await db.query(`SELECT md5(prosrc) AS h FROM pg_proc WHERE proname = 'communication_domain_event_dedupe_key';`)).rows[0].h;

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
  -- As 20260811132100 created them: a PARTIAL unique index (a NULL key is exempt by construction).
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
`);

// The state this migration is applied ON TOP OF: the shared function as ANOTHER lineage (Service Network O4) re-stated
// it — containing a branch this lineage has never seen — bound by its own trigger.
await db.exec(O4_LIVE);
await db.exec(`CREATE TRIGGER trg_domain_events_communication_dedupe BEFORE INSERT ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.communication_domain_event_dedupe_key();`);
const sharedBefore = await sharedSource();

await check('before the migration, a Journey alert has NO identity — the defect this closes', async () => {
  const a = await keyOf('diaspora.journey.alert', { alertKey: 'DEPARTED:ord-1:user-1:evt-1' });
  if (a !== null) throw new Error('the shared function already had an identity for Journey alerts');
});

await check('the migration applies on top of a shared function that carries another lineage\'s branch', async () => { await db.exec(up); });

// ── 1. The shared function is untouched ───────────────────────────────────

await check('the shared dedupe function is BYTE-FOR-BYTE untouched — no one else\'s branch can be lost to this migration', async () => {
  if ((await sharedSource()) !== sharedBefore) throw new Error('the migration changed the shared function');
});

await check('another lineage\'s branch (Service Network O4) still gives its answer after this migration', async () => {
  const k = await keyOf('service.case.accepted', { serviceCaseId: 'case-1' });
  if (k !== 'service.case.accepted:case-1') throw new Error(`O4's branch was lost: ${k}`);
});

await check('the migration text never re-states the shared function', async () => {
  if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.communication_domain_event_dedupe_key/i.test(migration)) {
    throw new Error('the migration re-states the shared function');
  }
});

// ── The new identity ──────────────────────────────────────────────────────

for (const type of ['diaspora.journey.alert', 'diaspora.journey.exception']) {
  await check(`${type}: the key is the event type and the alert key`, async () => {
    const k = await keyOf(type, { alertKey: 'DEPARTED:ord-1:user-1:evt-1', recipientUserId: 'user-1' });
    if (k !== `${type}:DEPARTED:ord-1:user-1:evt-1`) throw new Error(`unexpected key ${k}`);
  });

  await check(`${type}: the first alert is recorded`, async () => {
    await db.exec(`INSERT INTO public.domain_events (event_type, payload) VALUES ('${type}', '{"alertKey":"DEPARTED:ord-1:user-1:evt-1"}');`);
  });

  await refuses(`${type}: the SAME alert twice is refused — the unique index is the guarantee`,
    `INSERT INTO public.domain_events (event_type, payload) VALUES ('${type}', '{"alertKey":"DEPARTED:ord-1:user-1:evt-1"}');`,
    /idx_domain_events_dedupe_key|duplicate key/i);

  await check(`${type}: ON CONFLICT DO NOTHING recovers silently, as the event bus relies on`, async () => {
    const r = await db.query(`INSERT INTO public.domain_events (event_type, payload, status, attempts, tenant_id)
      VALUES ('${type}', '{"alertKey":"DEPARTED:ord-1:user-1:evt-1"}', 'pending', 0, NULL) ON CONFLICT DO NOTHING RETURNING *;`);
    if (r.rows.length !== 0) throw new Error('a duplicate was inserted instead of being recovered');
    const n = await db.query(`SELECT count(*)::int AS n FROM public.domain_events WHERE dedupe_key='${type}:DEPARTED:ord-1:user-1:evt-1';`);
    if (n.rows[0].n !== 1) throw new Error(`${n.rows[0].n} rows share one identity`);
  });
}

await check('a different person, order, kind or observation is a different alert', async () => {
  for (const alertKey of ['DEPARTED:ord-1:user-2:evt-1', 'DEPARTED:ord-2:user-1:evt-1', 'ARRIVED:ord-1:user-1:evt-1', 'DEPARTED:ord-1:user-1:evt-2']) {
    await db.exec(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.alert', '${JSON.stringify({ alertKey })}');`);
  }
});

await check('the event type is part of the identity: the same alert key under the other type is a different alert', async () => {
  await db.exec(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.alert', '{"alertKey":"DEPARTED:ord-1:user-9:evt-9"}');`);
  await db.exec(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.exception', '{"alertKey":"DEPARTED:ord-1:user-9:evt-9"}');`);
});

await check('no alert key means no identity: the row is insertable, and several of them are', async () => {
  for (const payload of [{}, { alertKey: null }, { alertKey: '' }, { alertKey: '   ' }]) {
    const k = await keyOf('diaspora.journey.alert', payload);
    if (k !== null) throw new Error(`a blank key produced an identity: ${JSON.stringify(k)}`);
  }
  for (let i = 0; i < 2; i += 1) await db.exec(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.alert', '{}');`);
});

await check('surrounding whitespace is not part of the identity (the JS registry trims too)', async () => {
  const k = await keyOf('diaspora.journey.alert', { alertKey: '  DEPARTED:ord-5:user-5:evt-5  ' });
  if (k !== 'diaspora.journey.alert:DEPARTED:ord-5:user-5:evt-5') throw new Error(`unexpected key ${k}`);
});

// ── 3. Scope: exactly two event types ─────────────────────────────────────

await check('an alert key on any OTHER event type confers no identity — the trigger is not a catch-all', async () => {
  for (const type of ['diaspora.loading.cargo_loaded', 'diaspora.shipment.exception', 'VEHICLE_RESERVED', 'diaspora.journey.something_else', 'diaspora.journey']) {
    const k = await keyOf(type, { alertKey: 'DEPARTED:ord-1:user-1:evt-1' });
    if (k !== null) throw new Error(`${type} acquired an identity from an alertKey`);
  }
});

await check('the trigger is scoped by a WHEN clause naming exactly the two event types', async () => {
  const r = await db.query(`SELECT pg_get_triggerdef(t.oid) AS d FROM pg_trigger t WHERE t.tgname = 'trg_domain_events_journey_alert_dedupe';`);
  if (r.rows.length !== 1) throw new Error(`${r.rows.length} triggers`);
  const def = r.rows[0].d;
  if (!/WHEN/i.test(def) || !def.includes('diaspora.journey.alert') || !def.includes('diaspora.journey.exception')) throw new Error(`unscoped trigger: ${def}`);
  if (!/BEFORE INSERT/i.test(def) || !/FOR EACH ROW/i.test(def)) throw new Error(`wrong timing: ${def}`);
});

await check('the shared trigger and the Journey trigger are two separate triggers on domain_events', async () => {
  const r = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='public.domain_events'::regclass AND NOT tgisinternal;`);
  if (r.rows[0].n !== 2) throw new Error(`${r.rows[0].n} triggers`);
});

// ── 2. Order independence: the regression this design exists to prevent ───

await check('ANOTHER lineage re-stating the shared function AFTER this migration cannot remove the Journey identity', async () => {
  await db.exec(LATER); // a later programme's wholesale CREATE OR REPLACE, which knows nothing about Journey alerts
  const k = await keyOf('diaspora.journey.alert', { alertKey: 'ARRIVED:ord-7:user-7:evt-7' });
  if (k !== 'diaspora.journey.alert:ARRIVED:ord-7:user-7:evt-7') throw new Error(`the Journey identity was lost: ${k}`);
  const garage = await keyOf('garage.appointment.booked', { appointmentId: 'a-1' });
  if (garage !== 'garage.appointment.booked:a-1') throw new Error('the later lineage\'s own branch is not working');
  const o4 = await keyOf('service.case.accepted', { serviceCaseId: 'case-2' });
  if (o4 !== null) throw new Error('the model of the later restatement is wrong (it should have dropped O4 — that is the hazard)');
});

await check('re-applying the migration is a no-op: still exactly one Journey trigger, still no change to the shared function', async () => {
  const before = await sharedSource();
  await db.exec(up);
  await db.exec(up);
  const n = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_domain_events_journey_alert_dedupe';`);
  if (n.rows[0].n !== 1) throw new Error(`${n.rows[0].n} Journey triggers after re-applying`);
  if ((await sharedSource()) !== before) throw new Error('re-applying changed the shared function');
});

// ── Governed access ───────────────────────────────────────────────────────

await check('the new function cannot be executed by the browser or by PUBLIC', async () => {
  const r = await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname='communication_journey_alert_dedupe_key';`);
  const acl = r.rows[0].acl || '';
  // A default ACL is NULL (PUBLIC may execute). After REVOKE ... FROM PUBLIC the owner keeps it and nobody else is listed.
  if (!acl) throw new Error('EXECUTE is still granted to PUBLIC (no ACL was written)');
  // PUBLIC's entry has an EMPTY grantee (`=X/owner`); the owner's own entry (`owner=X/owner`) is not PUBLIC.
  if (/[{,]=X\//.test(acl)) throw new Error(`PUBLIC may still execute: ${acl}`);
  if (/anon|authenticated/.test(acl)) throw new Error(`a browser role may execute: ${acl}`);
});

await check('the new function pins its search_path, as the shared one does', async () => {
  const r = await db.query(`SELECT proconfig::text AS c FROM pg_proc WHERE proname='communication_journey_alert_dedupe_key';`);
  if (!/search_path=public/.test(r.rows[0].c || '')) throw new Error(`search_path is not pinned: ${r.rows[0].c}`);
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

await check('applying the migration again leaves exactly one template and one version', async () => {
  const t = await db.query(`SELECT count(*)::int AS n FROM public.communication_templates WHERE template_key='journey_update_v1';`);
  const v = await db.query(`SELECT count(*)::int AS n FROM public.communication_template_versions;`);
  if (t.rows[0].n !== 1 || v.rows[0].n !== 1) throw new Error(`templates ${t.rows[0].n}, versions ${v.rows[0].n}`);
});

await check('a template already registered by someone else is left alone, not overwritten', async () => {
  const db2 = new PGlite();
  await db2.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE public.domain_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text, payload jsonb, dedupe_key text);
    CREATE TABLE public.communication_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_key text NOT NULL UNIQUE,
      business_workflow text, stakeholder_audience text, classification text, owner_team text, status text DEFAULT 'active', metadata jsonb DEFAULT '{}'::jsonb);
    CREATE TABLE public.communication_template_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid, version int, channel text, language text,
      subject_template text, body_template text, required_variables jsonb, optional_variables jsonb, approval_status text, experiment_metadata jsonb,
      UNIQUE (template_id, version, channel, language));
    INSERT INTO public.communication_templates (template_key, business_workflow, owner_team, status) VALUES ('journey_update_v1', 'other_workflow', 'someone-else', 'retired');
  `);
  await db2.exec(up);
  const r = await db2.query(`SELECT owner_team, status FROM public.communication_templates WHERE template_key='journey_update_v1';`);
  await db2.close();
  if (r.rows[0].owner_team !== 'someone-else' || r.rows[0].status !== 'retired') throw new Error('an existing governed template was overwritten');
});

// ── Down ──────────────────────────────────────────────────────────────────

await check('Down removes the Journey trigger and function and touches nothing else', async () => {
  const before = await sharedSource();
  await db.exec(down);
  const trig = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_domain_events_journey_alert_dedupe';`);
  const fn = await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname='communication_journey_alert_dedupe_key';`);
  if (trig.rows[0].n !== 0 || fn.rows[0].n !== 0) throw new Error('Down left the trigger or the function behind');
  if ((await sharedSource()) !== before) throw new Error('Down touched the shared function');
  const shared = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_domain_events_communication_dedupe';`);
  if (shared.rows[0].n !== 1) throw new Error('Down removed the shared trigger');
});

await check('after Down, Journey alerts lose their identity and every other branch is exactly as it was', async () => {
  const a = await keyOf('diaspora.journey.alert', { alertKey: 'DEPARTED:ord-1:user-1:evt-1' });
  if (a !== null) throw new Error('Down left an identity in place');
  const g = await keyOf('garage.appointment.booked', { appointmentId: 'a-2' });
  if (g !== 'garage.appointment.booked:a-2') throw new Error('another lineage\'s branch changed after Down');
  const inquiry = await keyOf('marketplace.inquiry.created', { inquiryId: 'inq-1' });
  if (inquiry !== 'marketplace.inquiry.created:inq-1') throw new Error('an Email 1.0 branch changed after Down');
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
