/**
 * T11-CAP-LR01-R1 — the real-purchase seed: it creates what the facts say and NOTHING else.
 *
 * Rehearsed on PGlite with staging-shaped base tables (the real column lists, NOT NULLs, defaults and CHECKs read
 * from staging on 2026-10-25) and the REAL CAP-04 / CAP-05 migrations. The fixtures below are structural: the
 * facts file is the real one, because the point is to hold the real plan to the rules.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { MIGRATIONS, loadMigration, makeDb, HarnessStop } from '../scripts/t11-cap-stg-converge.mjs'
import {
  MUST_STAY_EMPTY, WRITABLE, assertPlanTruthful, auditSeal, buildPlan, loadFacts, seed, verify,
} from '../scripts/t11-cap-r1-vezel-seed.mjs'

process.env.NODE_ENV = 'test'
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const FACTS = loadFacts()
const USER = FACTS.account.user_id
const SERENA = FACTS.protected_vehicle.vin
const NOW = new Date('2026-10-25T04:00:00Z')

const WORLDS = []
test.after(async () => { for (const p of WORLDS) await p.close().catch(() => {}) })

async function world({ user = true, serena = true, shipmentsExisting = true } = {}) {
  const pg = new PGlite()
  WORLDS.push(pg)
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.tenants (id uuid PRIMARY KEY);
    CREATE TABLE public.users (id text PRIMARY KEY);
    CREATE TABLE public.vehicles (
      vin text PRIMARY KEY, make text NOT NULL, model text NOT NULL, generation text, trim text, year integer NOT NULL, color text,
      mileage integer NOT NULL, fuel_type text, drivetrain text, transmission text, import_source text, duty_paid boolean DEFAULT false,
      police_verified boolean DEFAULT false, status text DEFAULT 'Available', trust_score real, price real NOT NULL, currency text,
      created_at timestamptz DEFAULT now(), tenant_id uuid, owner_id text REFERENCES public.users(id) ON DELETE SET NULL,
      plate_number text, chassis_number text, engine_number text, registration_status text, registration_country text,
      current_seller_id text, current_seller_type text, vehicle_condition_category text NOT NULL DEFAULT 'unknown',
      passport_verified boolean NOT NULL DEFAULT false, zimra_verified boolean NOT NULL DEFAULT false,
      safe_pay_ready boolean NOT NULL DEFAULT false, inspection_ready boolean NOT NULL DEFAULT false,
      publication_status text NOT NULL DEFAULT 'draft', listing_city text, seller_description text,
      CONSTRAINT vehicles_publication_status_check CHECK (publication_status = ANY (ARRAY['draft','identity_complete','documents_submitted','review_pending','publishable','published'])),
      CONSTRAINT vehicles_vehicle_condition_category_check CHECK (vehicle_condition_category = ANY (ARRAY['brand_new','recently_imported','locally_used','second_hand','certified_dealer','unknown']))
    );
    CREATE TABLE public.diaspora_import_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, buyer_id text REFERENCES public.users(id) ON DELETE SET NULL,
      linked_vehicle_vin text REFERENCES public.vehicles(vin) ON DELETE SET NULL, order_type text NOT NULL,
      origin_country text NOT NULL, origin_city text, destination_country text NOT NULL DEFAULT 'Zimbabwe', destination_city text,
      requested_make text, requested_model text, requested_year_min integer, budget_amount numeric,
      budget_currency text NOT NULL DEFAULT 'USD', chassis_number text, vin text, status text NOT NULL DEFAULT 'IMPORT_REQUESTED',
      verification_status text NOT NULL DEFAULT 'PENDING_REVIEW', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text REFERENCES public.users(id) ON DELETE SET NULL, updated_by text REFERENCES public.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
      budget_disclosed boolean NOT NULL DEFAULT false, consignee_kind text, consignee_name text, consignee_phone text,
      delivery_address text, clearing_agent_name text,
      CONSTRAINT diaspora_import_orders_order_type_check CHECK (order_type = ANY (ARRAY['vehicle','parts','mixed'])),
      CONSTRAINT diaspora_import_orders_consignee_kind_check CHECK (consignee_kind = ANY (ARRAY['self','my_company','another_person','another_company','undecided'])),
      CONSTRAINT diaspora_import_orders_status_check CHECK (status = ANY (ARRAY['IMPORT_REQUESTED','QUOTE_ISSUED','SELLER_ASSIGNED','DOCUMENTS_PENDING','DOCUMENTS_VERIFIED','CONTAINER_BOOKED','READY_FOR_LOADING','LOADED','SHIPPED','ARRIVED_AT_BORDER','CUSTOMS_IN_PROGRESS','DUTY_PENDING','DUTY_PAID','RELEASED','REGISTRATION_PENDING','ROADWORTHINESS_PENDING','INSURANCE_PENDING','ZIMBABWE_READY','LOCAL_LISTING_ENABLED','COMPLETED','CANCELLED','DISPUTED','FLAGGED_FOR_REVIEW']))
    );
    CREATE TABLE public.diaspora_container_shipments (id uuid PRIMARY KEY);
    CREATE TABLE public.diaspora_shipments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
      import_order_id uuid NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
      container_id uuid REFERENCES public.diaspora_container_shipments(id) ON DELETE SET NULL, carrier_name text, tracking_number text,
      origin_port text, destination_port text, departure_date timestamptz, estimated_arrival_date timestamptz, actual_arrival_date timestamptz,
      status text NOT NULL DEFAULT 'PLANNED', verification_status text NOT NULL DEFAULT 'PENDING_REVIEW', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text REFERENCES public.users(id) ON DELETE SET NULL, updated_by text REFERENCES public.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
      CONSTRAINT diaspora_shipments_status_check CHECK (status = ANY (ARRAY['PLANNED','BOOKED','LOADING','IN_TRANSIT','ARRIVED','CUSTOMS_HOLD','RELEASED','COMPLETED','EXCEPTION']))
    );
    CREATE TABLE public.diaspora_shipment_stage_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, shipment_id uuid NOT NULL REFERENCES public.diaspora_shipments(id) ON DELETE CASCADE,
      import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE, stage text NOT NULL, notes text, location text,
      event_time timestamptz NOT NULL DEFAULT now(), verification_status text NOT NULL DEFAULT 'PENDING_REVIEW',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_by text, updated_by text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    );
    CREATE TABLE public.diaspora_import_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
      actor_id text REFERENCES public.users(id) ON DELETE SET NULL, action text NOT NULL, resource_type text NOT NULL, resource_id text,
      previous_state jsonb, new_state jsonb, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, cryptographic_seal text NOT NULL, ip_address text,
      user_agent text, verification_status text NOT NULL DEFAULT 'VERIFIED', created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    );
  `)
  for (const m of MIGRATIONS.slice(0, 2)) await pg.exec(loadMigration(m).up)
  if (user) await pg.exec(`INSERT INTO public.users (id) VALUES ('${USER}'), ('u-other')`)
  if (serena) {
    await pg.exec(`INSERT INTO public.vehicles (vin, make, model, year, mileage, price, owner_id, chassis_number, status, publication_status)
      VALUES ('${SERENA}', 'Nissan', 'Serena Highway Star', 2016, 63000, 12800, '${USER}', '${SERENA}', 'Available', 'published')`)
  }
  if (shipmentsExisting) {
    // An unrelated order of the same user, and an unrelated shipment — they must come through untouched.
    await pg.exec(`INSERT INTO public.diaspora_import_orders (id, buyer_id, created_by, order_type, origin_country, status)
      VALUES ('11111111-1111-4111-8111-111111111111', '${USER}', '${USER}', 'vehicle', 'Japan', 'QUOTE_ISSUED')`)
  }
  return { pg, db: makeDb(pg) }
}

const count = async (db, table, where = 'true') => (await db.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`)).rows[0].n

// ── The plan holds the facts and invents nothing ──────────────────────────

test('R1-S: the plan contains exactly the verified facts', () => {
  const plan = buildPlan(FACTS)
  assert.equal(plan.vehicles.vin, 'RU3-1316558');
  assert.equal(plan.vehicles.chassis_number, 'RU3-1316558');
  assert.equal(plan.vehicles.engine_number, 'LEB6736579');
  assert.deepEqual([plan.vehicles.make, plan.vehicles.model, plan.vehicles.year, plan.vehicles.mileage], ['Honda', 'Vezel', 2018, 134741]);
  assert.equal(plan.diaspora_shipments.carrier_name, 'Hoegh Autoliners K.K.');
  assert.equal(plan.diaspora_shipments.origin_port, 'Shimonoseki, Japan');
  assert.equal(plan.diaspora_shipments.destination_port, 'Dar es Salaam');
  assert.equal(plan.diaspora_shipments.estimated_arrival_date, '2026-09-18T00:00:00Z');
  assert.equal(plan.diaspora_shipments.metadata.planned_departure_date, '2026-08-29T00:00:00Z');
  assert.equal(plan.diaspora_shipment_legs.vessel_name, 'HOEGH TRACER (V-61)');
  assert.equal(plan.diaspora_shipment_legs.leg_sequence, 1);
  assert.equal(plan.diaspora_import_orders.metadata.external_reference.reference, 'CD740269');
});

test('R1-S: every value in the plan has a recorded basis in the facts file', () => {
  const allowed = new Set(['CAP_OBSERVED', 'SCHEMA_DEFAULT', 'SCHEMA_MANDATORY_PLACEHOLDER', 'CARUP_CONVENTION', 'OWNER_AUTHORISED']);
  for (const section of ['vehicle', 'order', 'shipment', 'leg']) {
    for (const [col, f] of Object.entries(FACTS[section].fields)) {
      assert.ok(allowed.has(f.basis), `${section}.${col} has no recognised basis`);
      assert.notEqual(f.value, undefined, `${section}.${col} has no value`);
    }
  }
  for (const [col, f] of Object.entries(FACTS.shipment.metadata)) assert.ok(allowed.has(f.basis), `shipment.metadata.${col} has no basis`);
  // And the placeholders are admitted as placeholders, not as facts.
  assert.equal(FACTS.vehicle.fields.price.basis, 'SCHEMA_MANDATORY_PLACEHOLDER');
  assert.equal(FACTS.order.fields.destination_country.basis, 'SCHEMA_MANDATORY_PLACEHOLDER');
});

test('R1-S: no movement, amount, consignee, document or customs fact is in the plan', () => {
  const plan = buildPlan(FACTS);
  const text = JSON.stringify(plan);
  assert.equal(plan.diaspora_shipments.departure_date, undefined);
  assert.equal(plan.diaspora_shipments.actual_arrival_date, undefined);
  assert.equal(plan.diaspora_shipments.status, 'PLANNED');
  assert.equal(plan.diaspora_import_orders.status, 'IMPORT_REQUESTED');
  assert.equal(plan.vehicles.price, 0, 'the schema-forced price is a placeholder, never an amount');
  for (const forbidden of ['IN_TRANSIT', 'ARRIVED', 'RELEASED', 'COMPLETED', 'CUSTOMS_HOLD', 'DUTY_PAID', 'Kingstone', 'Musaurwa', 'CHIVERO', 'BUDIRIRO', 'cap?t=', 'beforward.jp']) {
    assert.ok(!text.includes(forbidden), `the plan contains ${forbidden}`);
  }
  for (const [table, cols] of Object.entries(MUST_STAY_EMPTY)) for (const col of cols) {
    const v = plan[table]?.[col];
    assert.ok(v === undefined || v === null, `${table}.${col} is set`);
  }
});

test('R1-S: a plan that sets a forbidden column, a movement or an amount is refused before any database is touched', () => {
  const cases = [
    (p) => { p.diaspora_shipments.departure_date = '2026-08-29T00:00:00Z' },
    (p) => { p.diaspora_shipments.actual_arrival_date = '2026-09-18T00:00:00Z' },
    (p) => { p.diaspora_shipments.tracking_number = 'X' },
    (p) => { p.diaspora_shipments.status = 'IN_TRANSIT' },
    (p) => { p.diaspora_import_orders.status = 'SHIPPED' },
    (p) => { p.diaspora_import_orders.budget_amount = 21000 },
    (p) => { p.diaspora_import_orders.consignee_name = 'Someone' },
    (p) => { p.vehicles.price = 21000 },
    (p) => { p.vehicles.publication_status = 'published' },
    (p) => { p.vehicles.owner_id = 'u-other' },
    (p) => { p.vehicles.vin = SERENA },
    (p) => { p.vehicles.zimra_verified = true },
    (p) => { p.diaspora_shipment_legs.leg_sequence = 2 },
    (p) => { p.diaspora_shipment_legs.imo = '1234567' },
  ];
  for (const mutate of cases) {
    const plan = buildPlan(FACTS);
    mutate(plan);
    assert.throws(() => assertPlanTruthful(plan, FACTS), (e) => e instanceof HarnessStop && e.code === 'PLAN_NOT_TRUTHFUL', String(mutate));
  }
});

test('R1-S: the writable-column whitelist does not include any movement or amount column', () => {
  const all = Object.values(WRITABLE).flat();
  for (const bad of ['departure_date', 'actual_arrival_date', 'tracking_number', 'budget_amount', 'consignee_name', 'currency', 'zimra_verified', 'police_verified', 'duty_paid']) {
    assert.ok(!all.includes(bad), `${bad} is writable`);
  }
});

// ── Applying it ───────────────────────────────────────────────────────────

test('R1-S: apply creates one vehicle, one order, one shipment, its creation event and ONE leg — and the protected vehicle is byte-identical', async () => {
  const { db } = await world();
  const before = await count(db, 'vehicles');
  const ev = await seed(db, FACTS, { commit: true, now: NOW });
  assert.equal(ev.committed, true);
  assert.equal(ev.protected.unchanged, true);
  assert.deepEqual(Object.keys(ev.created).sort(), ['creation_event', 'import_order', 'leg', 'shipment', 'vehicle']);
  assert.equal(await count(db, 'vehicles'), before + 1);
  assert.equal(await count(db, 'diaspora_import_orders', `linked_vehicle_vin = 'RU3-1316558'`), 1);
  assert.equal(await count(db, 'diaspora_shipments'), 1);
  assert.equal(await count(db, 'diaspora_shipment_legs'), 1);
  assert.equal(await count(db, 'diaspora_shipment_stage_events'), 1);
  assert.equal(await count(db, 'diaspora_shipment_stage_events', `stage <> 'PLANNED'`), 0, 'a movement stage was written');
  assert.equal(await count(db, 'diaspora_shipment_observations'), 0, 'an estimate revision was invented');
  assert.equal(await count(db, 'diaspora_import_audit_log'), 2);
  const v = await verify(db, FACTS);
  assert.equal(v.verdict, 'MATCHES', v.problems.join('; '));
});

test('R1-S: the written shipment says nothing happened — no departure, no arrival, no tracking number, PLANNED', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  const { rows: [s] } = await db.query('SELECT * FROM public.diaspora_shipments');
  assert.equal(s.departure_date, null);
  assert.equal(s.actual_arrival_date, null);
  assert.equal(s.tracking_number, null);
  assert.equal(s.container_id, null);
  assert.equal(s.created_by, null, 'an operator identity was borrowed');
  assert.equal(s.status, 'PLANNED');
  assert.equal(new Date(s.estimated_arrival_date).toISOString(), '2026-09-18T00:00:00.000Z');
  assert.equal(s.metadata.planned_departure_date, '2026-08-29T00:00:00Z');
  assert.equal(s.metadata.provenance.programme, 'T11-CAP-LR01-R1');
  const { rows: [l] } = await db.query('SELECT * FROM public.diaspora_shipment_legs');
  assert.equal(l.created_by, null);
  assert.equal(l.voyage_ref, null);
  assert.equal(l.source, 'OPERATOR_DECLARED');
});

test('R1-S: the vehicle is the owner\'s, off the marketplace, with a placeholder price — and the order is the earliest status', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  const { rows: [v] } = await db.query("SELECT * FROM public.vehicles WHERE vin = 'RU3-1316558'");
  assert.equal(v.owner_id, USER);
  assert.equal(v.current_seller_id, null);
  assert.equal(v.status, 'Pending');
  assert.equal(v.publication_status, 'draft');
  assert.equal(Number(v.price), 0);
  assert.equal(v.currency, null);
  assert.equal(v.registration_status, null);
  assert.equal(v.zimra_verified, false);
  const { rows: [o] } = await db.query("SELECT * FROM public.diaspora_import_orders WHERE linked_vehicle_vin = 'RU3-1316558'");
  assert.equal(o.status, 'IMPORT_REQUESTED');
  assert.equal(o.buyer_id, USER);
  assert.equal(o.budget_amount, null);
  assert.equal(o.consignee_name, null);
  assert.equal(o.destination_city, null);
});

test('R1-S: the audit trail is attributed to the certification run, never to a person, and its seal verifies', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  const { rows } = await db.query('SELECT * FROM public.diaspora_import_audit_log ORDER BY action');
  assert.deepEqual(rows.map((r) => r.action), ['IMPORT_ORDER_CREATED', 'SHIPMENT_CREATED']);
  for (const r of rows) {
    assert.equal(r.actor_id, null);
    assert.equal(r.metadata.programme, 'T11-CAP-LR01-R1');
    assert.match(r.metadata.note, /no user session/);
    assert.match(r.cryptographic_seal, /^[0-9a-f]{64}$/);
  }
});

test('R1-S: the audit seal formula is the repository\'s own', async () => {
  const { buildAuditSeal } = await import('../services/diaspora/diasporaAuditService.js');
  const args = { actorId: null, action: 'A', resourceType: 'r', resourceId: 'x', timestamp: '2026-10-25T00:00:00.000Z', payload: { previousState: null, newState: { a: 1 }, metadata: { m: 1 } } };
  assert.equal(auditSeal(args), buildAuditSeal(args));
});

test('R1-S: the unrelated order of the same user, and every other vehicle, are untouched', async () => {
  const { db } = await world();
  const other = (await db.query("SELECT md5(row_to_json(o)::text) AS m FROM public.diaspora_import_orders o WHERE id = '11111111-1111-4111-8111-111111111111'")).rows[0].m;
  const serena = (await db.query(`SELECT md5(row_to_json(v)::text) AS m FROM public.vehicles v WHERE vin = '${SERENA}'`)).rows[0].m;
  const ev = await seed(db, FACTS, { commit: true, now: NOW });
  assert.equal((await db.query("SELECT md5(row_to_json(o)::text) AS m FROM public.diaspora_import_orders o WHERE id = '11111111-1111-4111-8111-111111111111'")).rows[0].m, other);
  assert.equal((await db.query(`SELECT md5(row_to_json(v)::text) AS m FROM public.vehicles v WHERE vin = '${SERENA}'`)).rows[0].m, serena);
  assert.equal(ev.protected.before, serena);
  assert.equal(ev.counts_before.kingston_orders + 1, ev.counts_after_in_transaction.kingston_orders);
  assert.equal(ev.counts_before.kingston_vehicles + 1, ev.counts_after_in_transaction.kingston_vehicles);
});

// ── Safety ────────────────────────────────────────────────────────────────

test('R1-S: preflight writes inside a transaction and ROLLS IT BACK — nothing remains', async () => {
  const { db } = await world();
  const ev = await seed(db, FACTS, { commit: false, now: NOW });
  assert.equal(ev.committed, false);
  assert.equal(Object.keys(ev.created).length, 5, 'the dry run did not exercise the whole write');
  for (const t of ['diaspora_shipments', 'diaspora_shipment_legs', 'diaspora_shipment_stage_events', 'diaspora_import_audit_log']) assert.equal(await count(db, t), 0, `${t} kept a dry-run row`);
  assert.equal(await count(db, 'vehicles', "vin = 'RU3-1316558'"), 0);
  assert.equal(await count(db, 'diaspora_import_orders', "linked_vehicle_vin = 'RU3-1316558'"), 0);
});

test('R1-S: it is idempotent — a second run inserts nothing and reports what already exists', async () => {
  const { db } = await world();
  const first = await seed(db, FACTS, { commit: true, now: NOW });
  const snapshot = async () => (await db.query(`SELECT
    (SELECT md5(string_agg(row_to_json(t)::text, '|' ORDER BY id)) FROM public.diaspora_shipments t) AS s,
    (SELECT count(*) FROM public.diaspora_import_audit_log)::int AS a,
    (SELECT count(*) FROM public.diaspora_shipment_stage_events)::int AS e`)).rows[0];
  const before = await snapshot();
  const second = await seed(db, FACTS, { commit: true, now: new Date('2026-10-26T00:00:00Z') });
  assert.deepEqual(second.created, {}, 'a second run created rows');
  assert.equal(second.existing.import_order, first.created.import_order);
  assert.equal(second.existing.shipment, first.created.shipment);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await count(db, 'diaspora_import_orders', "linked_vehicle_vin = 'RU3-1316558'"), 1);
});

test('R1-S: a partly seeded state resumes without duplicating (vehicle exists, nothing else)', async () => {
  const { db } = await world();
  const plan = buildPlan(FACTS);
  await db.query(`INSERT INTO public.vehicles (vin, make, model, trim, year, color, mileage, fuel_type, drivetrain, transmission, import_source, status, publication_status, price, owner_id, chassis_number, engine_number)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
  [plan.vehicles.vin, plan.vehicles.make, plan.vehicles.model, plan.vehicles.trim, plan.vehicles.year, plan.vehicles.color, plan.vehicles.mileage, plan.vehicles.fuel_type, plan.vehicles.drivetrain, plan.vehicles.transmission, plan.vehicles.import_source, plan.vehicles.status, plan.vehicles.publication_status, plan.vehicles.price, plan.vehicles.owner_id, plan.vehicles.chassis_number, plan.vehicles.engine_number]);
  const ev = await seed(db, FACTS, { commit: true, now: NOW });
  assert.equal(ev.existing.vehicle, 'RU3-1316558');
  assert.equal(ev.created.vehicle, undefined);
  assert.ok(ev.created.import_order && ev.created.shipment && ev.created.leg);
  assert.equal(await count(db, 'vehicles', "vin = 'RU3-1316558'"), 1);
});

test('R1-S: an existing row that DISAGREES with the facts stops the run — it is not "fixed", and nothing is written', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  await db.query("UPDATE public.diaspora_shipments SET carrier_name = 'Somebody Else'");
  const audits = await count(db, 'diaspora_import_audit_log');
  await assert.rejects(() => seed(db, FACTS, { commit: true, now: NOW }), (e) => e.code === 'EXISTING_ROW_DISAGREES' && /shipment: carrier_name/.test(e.message));
  assert.equal(await count(db, 'diaspora_import_audit_log'), audits);
  assert.equal((await db.query('SELECT carrier_name FROM public.diaspora_shipments')).rows[0].carrier_name, 'Somebody Else', 'the disagreeing row was overwritten');
});

test('R1-S: a vehicle already held under the same key by someone else stops the run', async () => {
  const { db } = await world();
  await db.query(`INSERT INTO public.vehicles (vin, make, model, year, mileage, price, owner_id) VALUES ('RU3-1316558', 'Honda', 'Vezel', 2018, 1, 5, 'u-other')`);
  await assert.rejects(() => seed(db, FACTS, { commit: true, now: NOW }), (e) => e.code === 'EXISTING_ROW_DISAGREES' && /vehicle:/.test(e.message));
});

test('R1-S: two live orders already linked to the vehicle are never chosen between', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  await db.query(`INSERT INTO public.diaspora_import_orders (buyer_id, created_by, order_type, origin_country, linked_vehicle_vin) VALUES ('${USER}', '${USER}', 'vehicle', 'Japan', 'RU3-1316558')`);
  await assert.rejects(() => seed(db, FACTS, { commit: true, now: NOW }), (e) => e.code === 'AMBIGUOUS_EXISTING');
});

test('R1-S: if the protected vehicle changes during the run, everything is rolled back', async () => {
  const { pg, db } = await world();
  // A rogue trigger touches the protected vehicle when the new vehicle is inserted.
  await pg.exec(`CREATE FUNCTION public.touch_protected() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.vehicles SET mileage = mileage + 1 WHERE vin = '${SERENA}'; RETURN NEW; END; $$;
    CREATE TRIGGER trg_touch AFTER INSERT ON public.diaspora_shipments FOR EACH ROW EXECUTE FUNCTION public.touch_protected();`);
  await assert.rejects(() => seed(db, FACTS, { commit: true, now: NOW }), (e) => e.code === 'PROTECTED_VEHICLE_CHANGED');
  assert.equal(await count(db, 'vehicles', "vin = 'RU3-1316558'"), 0, 'the new vehicle survived a failed run');
  assert.equal(await count(db, 'diaspora_shipments'), 0);
  assert.equal((await db.query(`SELECT mileage FROM public.vehicles WHERE vin = '${SERENA}'`)).rows[0].mileage, 63000);
});

test('R1-S: it is blocked, not improvised, when the account or the protected vehicle is absent', async () => {
  const noUser = await world({ user: false, serena: false, shipmentsExisting: false });
  await assert.rejects(() => seed(noUser.db, FACTS, { commit: true, now: NOW }), (e) => e.code === 'BLOCKED_PREREQUISITES' && /account/.test(e.message));
  const noSerena = await world({ serena: false });
  await assert.rejects(() => seed(noSerena.db, FACTS, { commit: true, now: NOW }), (e) => e.code === 'BLOCKED_PREREQUISITES' && /protected vehicle/.test(e.message));
  assert.equal(await count(noSerena.db, 'vehicles', "vin = 'RU3-1316558'"), 0);
});

test('R1-S: verify is read-only and notices a movement or an estimate revision this seed did not record', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  const ok = await verify(db, FACTS);
  assert.equal(ok.verdict, 'MATCHES');
  const { rows: [s] } = await db.query('SELECT id FROM public.diaspora_shipments');
  await db.query("INSERT INTO public.diaspora_shipment_stage_events (shipment_id, stage, event_time) VALUES ($1, 'IN_TRANSIT', now())", [s.id]);
  const moved = await verify(db, FACTS);
  assert.equal(moved.verdict, 'DIFFERS');
  assert.ok(moved.problems.some((p) => /movement stage event/.test(p)));
});

test('R1-S: an edit to the facts file that would invent something is refused when the plan is built — not only when called directly', () => {
  const edits = [
    (f) => { f.shipment.fields.departure_date = { value: '2026-08-29T00:00:00Z', basis: 'CAP_OBSERVED' } },
    (f) => { f.shipment.fields.status.value = 'IN_TRANSIT' },
    (f) => { f.order.fields.status.value = 'SHIPPED' },
    (f) => { f.vehicle.fields.price.value = 21000 },
    (f) => { f.vehicle.fields.zimra_verified = { value: true, basis: 'CAP_OBSERVED' } },
    (f) => { f.order.fields.consignee_name = { value: 'Someone', basis: 'CAP_OBSERVED' } },
    (f) => { f.leg.fields.leg_sequence.value = 2 },
    (f) => { f.vehicle.fields.owner_id.value = 'u-other' },
  ];
  for (const edit of edits) {
    const facts = JSON.parse(JSON.stringify(FACTS));
    edit(facts);
    assert.throws(() => buildPlan(facts), (e) => e instanceof HarnessStop && e.code === 'PLAN_NOT_TRUTHFUL', String(edit));
  }
});

test('R1-S: verify notices a second vessel leg this seed did not record', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  const { rows: [s] } = await db.query('SELECT id FROM public.diaspora_shipments');
  await db.query("INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name) VALUES ($1, 2, 'EXTRA')", [s.id]);
  const v = await verify(db, FACTS);
  assert.equal(v.verdict, 'DIFFERS');
  assert.ok(v.problems.some((p) => /exactly one live leg/.test(p)));
});

test('R1-S: verify notices an estimate revision this seed did not record', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  const { rows: [s] } = await db.query('SELECT id FROM public.diaspora_shipments');
  await db.query(`INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at, payload)
    VALUES ($1, 'OPERATOR_DECLARED', 'e1', 'ETA_REVISION', now(), '{"estimated_arrival":"2026-09-25T00:00:00Z","reason":"x"}'::jsonb)`, [s.id]);
  const v = await verify(db, FACTS);
  assert.equal(v.verdict, 'DIFFERS');
  assert.ok(v.problems.some((p) => /estimate revision/.test(p)));
});

test('R1-S: verify notices an actual arrival that was never observed by CarUp', async () => {
  const { db } = await world();
  await seed(db, FACTS, { commit: true, now: NOW });
  await db.query("UPDATE public.diaspora_shipments SET actual_arrival_date = '2026-09-18T00:00:00Z'");
  const v = await verify(db, FACTS);
  assert.equal(v.verdict, 'DIFFERS');
  assert.ok(v.problems.some((p) => /actual_arrival_date/.test(p)));
});

test('R1-S: the script refuses anything but approved staging, and never names production in its requests', async () => {
  const { ensureStagingDbUrl } = await import('../scripts/t11-cap-stg-converge.mjs');
  assert.throws(() => ensureStagingDbUrl('postgres://u:p@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres'), (e) => e.code === 'NOT_APPROVED_STAGING');
  assert.throws(() => ensureStagingDbUrl('postgres://u:p@localhost:5432/postgres'), (e) => e.code === 'NOT_APPROVED_STAGING');
  assert.doesNotThrow(() => ensureStagingDbUrl('postgres://u:p@db.eoyenigwevnxwwhyhaer.supabase.co:5432/postgres'));
  const src = fs.readFileSync(new URL('../scripts/t11-cap-r1-vezel-seed.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes('vhmnajoeicasaigiophh'), 'the seed names the production project');
  assert.ok(!/\b(UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b\s+(public\.)?(vehicles|diaspora_)/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the seed contains a write other than INSERT');
});

test('R1-S: the facts file holds no secret and no private contact data', () => {
  const text = fs.readFileSync(new URL('../scripts/data/t11-cap-r1-vezel-facts.json', import.meta.url), 'utf8');
  for (const leak of [/[?&]t=[0-9a-f]{16,}/i, /cap\?t=/i, /\+\d{6,}/, /@gmail\./i, /CHIVERO/i, /BUDIRIRO/i, /Musaurwa/i, /Kingstone/i, /password/i, /documentcenter/i, /\b[0-9a-f]{32}\b/i]) {
    assert.ok(!leak.test(text), `the facts file matches ${leak}`);
  }
});
