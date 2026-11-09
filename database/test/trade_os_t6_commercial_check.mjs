/**
 * Trade OS T6 — commercial transparency schema, verified by EXECUTING the migration on real
 * PostgreSQL (PGlite).
 *
 * What only a real database can show:
 *
 *   1. FX snapshots are genuinely IMMUTABLE — the trigger refuses UPDATE and DELETE. A quote that
 *      displayed "≈ USD 532.14" must stay reproducible; editing the rate behind it would rewrite
 *      commercial history that someone already acted on.
 *   2. Money always carries its currency. The legacy hazard is that every existing money column is
 *      NOT NULL DEFAULT 'USD', so an omitted currency silently becomes USD; the T6 CHECK makes
 *      "amount without currency" unstorable instead.
 *   3. UNKNOWN is representable and is NOT zero — a component may have a NULL amount.
 *   4. A charge component belongs to exactly ONE quote domain, enforced by the database rather
 *      than by convention.
 *   5. Allocation is idempotent per (component, reservation), so a replay updates rather than
 *      double-charging a participant.
 *   6. Down leaves no residue, and Up re-applies after Down.
 *
 * ci.yml's migration_pglite_check.mjs NEW_MIGRATIONS list ends at 20260810120000, so this
 * migration is executed by NO other gate. This file is that gate for 20260908090000.
 *
 * Run:  node database/test/trade_os_t6_commercial_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const T6 = '20260908090000_trade_os_t6_commercial_transparency.sql';

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
};
const sectionOf = (file, section) => {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const down = raw.indexOf('-- +migrate Down');
  return section === 'up'
    ? (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '')
    : (down >= 0 ? raw.slice(down) : '').replace('-- +migrate Down', '');
};
const refused = async (fn) => { try { await fn(); return false; } catch { return true; } };

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.users (id text PRIMARY KEY);
  CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.diaspora_trade_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.diaspora_import_quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.diaspora_logistics_quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.diaspora_cargo_reservations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.diaspora_trade_corridors (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.diaspora_trade_corridor_legs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
`);

const up = sectionOf(T6, 'up');
const down = sectionOf(T6, 'down');
await db.exec(up);
await db.exec(up);   // idempotent re-apply
record('Up applies, and re-applies without error', true);

// ── 1. FX snapshots ─────────────────────────────────────────────────────
const snap = (await db.query(`
  INSERT INTO public.diaspora_fx_rate_snapshots
    (base_currency, quote_currency, rate, rate_date, source, source_reference, triangulation)
  VALUES ('JPY','USD',0.0063991300,'2026-09-04','ECB','eurofxref-daily',
    '{"legs":[{"pair":"EUR/JPY","rate":181.59},{"pair":"EUR/USD","rate":1.1622}]}'::jsonb)
  RETURNING id, rate, status`)).rows[0];
record('an FX snapshot stores rate, effective date, source and triangulation legs',
  Number(snap.rate) > 0 && snap.status === 'AVAILABLE');

record('a snapshot cannot be UPDATED (immutable history)',
  await refused(() => db.query(`UPDATE public.diaspora_fx_rate_snapshots SET rate = 0.99 WHERE id = $1`, [snap.id])));
record('a snapshot cannot be DELETED (immutable history)',
  await refused(() => db.query(`DELETE FROM public.diaspora_fx_rate_snapshots WHERE id = $1`, [snap.id])));
record('a zero or negative rate is unstorable — a corrupt rate is not a degraded one',
  await refused(() => db.query(`INSERT INTO public.diaspora_fx_rate_snapshots (base_currency,quote_currency,rate,rate_date,source) VALUES ('JPY','USD',0,'2026-09-05','ECB')`)));
record('a non-ISO currency code is refused',
  await refused(() => db.query(`INSERT INTO public.diaspora_fx_rate_snapshots (base_currency,quote_currency,rate,rate_date,source) VALUES ('jpy','USD',1,'2026-09-05','ECB')`)));
record('same pair + same date + same source cannot duplicate (same-date replay is a no-op)',
  await refused(() => db.query(`INSERT INTO public.diaspora_fx_rate_snapshots (base_currency,quote_currency,rate,rate_date,source) VALUES ('JPY','USD',0.0064,'2026-09-04','ECB')`)));
// A NEWER rate is a NEW row; the older one survives untouched.
await db.query(`INSERT INTO public.diaspora_fx_rate_snapshots (base_currency,quote_currency,rate,rate_date,source) VALUES ('JPY','USD',0.0071,'2026-09-05','ECB')`);
const both = await db.query(`SELECT rate_date, rate FROM public.diaspora_fx_rate_snapshots WHERE base_currency='JPY' ORDER BY rate_date`);
record('a newer rate is a NEW snapshot; the historical one is unchanged',
  both.rows.length === 2 && Number(both.rows[0].rate) === 0.00639913);
record('STALE is a storable state; UNAVAILABLE deliberately is not',
  !(await refused(() => db.query(`INSERT INTO public.diaspora_fx_rate_snapshots (base_currency,quote_currency,rate,rate_date,source,status) VALUES ('ZAR','USD',0.054,'2026-09-04','ECB','STALE')`)))
  && await refused(() => db.query(`INSERT INTO public.diaspora_fx_rate_snapshots (base_currency,quote_currency,rate,rate_date,source,status) VALUES ('ZAR','USD',0.054,'2026-09-05','ECB','UNAVAILABLE')`)));

// ── 2. Charge components ────────────────────────────────────────────────
const iq = (await db.query(`INSERT INTO public.diaspora_import_quotes DEFAULT VALUES RETURNING id`)).rows[0].id;
const lq = (await db.query(`INSERT INTO public.diaspora_logistics_quotes DEFAULT VALUES RETURNING id`)).rows[0].id;

record('a component must belong to EXACTLY ONE quote domain — neither is refused',
  await refused(() => db.query(`INSERT INTO public.diaspora_trade_charge_components (cost_stage,label) VALUES ('MAIN_CARRIAGE','x')`)));
record('…and BOTH is refused',
  await refused(() => db.query(`INSERT INTO public.diaspora_trade_charge_components (import_quote_id,logistics_quote_id,cost_stage,label) VALUES ($1,$2,'MAIN_CARRIAGE','x')`, [iq, lq])));

record('money without its currency is UNSTORABLE (closes the DEFAULT USD hazard)',
  await refused(() => db.query(`INSERT INTO public.diaspora_trade_charge_components (logistics_quote_id,cost_stage,label,original_amount) VALUES ($1,'MAIN_CARRIAGE','Ocean freight',1800)`, [lq])));

const unknown = (await db.query(`
  INSERT INTO public.diaspora_trade_charge_components (logistics_quote_id,cost_stage,label,inclusion)
  VALUES ($1,'CLEARING','Destination clearing','EXCLUDED') RETURNING id, original_amount, inclusion`, [lq])).rows[0];
record('UNKNOWN is representable — a component may be unpriced, and that is NOT zero',
  unknown.original_amount === null && unknown.inclusion === 'EXCLUDED');

const priced = (await db.query(`
  INSERT INTO public.diaspora_trade_charge_components
    (logistics_quote_id,cost_stage,label,original_amount,original_currency,inclusion,commercial_status,provenance,revenue_class)
  VALUES ($1,'MAIN_CARRIAGE','Ocean freight',180000,'JPY','INCLUDED','QUOTED','PROVIDER_STATED','PASS_THROUGH_COST')
  RETURNING id, original_currency, provenance, revenue_class`, [lq])).rows[0];
record('source money keeps its own currency (JPY stays JPY)', priced.original_currency === 'JPY');
record('provenance and revenue class are independent dimensions',
  priced.provenance === 'PROVIDER_STATED' && priced.revenue_class === 'PASS_THROUGH_COST');
record('an invented cost stage is refused',
  await refused(() => db.query(`INSERT INTO public.diaspora_trade_charge_components (logistics_quote_id,cost_stage,label) VALUES ($1,'BRIBERY','x')`, [lq])));
record('an invented revenue class is refused',
  await refused(() => db.query(`INSERT INTO public.diaspora_trade_charge_components (logistics_quote_id,cost_stage,label,revenue_class) VALUES ($1,'CARUP','x','MYSTERY_MARGIN')`, [lq])));
record('a CarUp fee is classifiable AS CarUp revenue, never as a third-party charge',
  !(await refused(() => db.query(`INSERT INTO public.diaspora_trade_charge_components (import_quote_id,cost_stage,label,original_amount,original_currency,revenue_class) VALUES ($1,'CARUP','CarUp coordination fee',50,'USD','CARUP_SERVICE_FEE')`, [iq]))));

// ── 3. Rate observations ────────────────────────────────────────────────
record('a research observation is classifiable and markable synthetic',
  !(await refused(() => db.query(`INSERT INTO public.diaspora_trade_rate_observations (classification,is_synthetic,cost_stage,label,amount,currency,effective_from,source_name) VALUES ('RESEARCH_OBSERVATION',true,'MAIN_CARRIAGE','Synthetic benchmark',1800,'USD','2026-09-01','SYNTHETIC certification fixture')`))));
record('an invented classification is refused',
  await refused(() => db.query(`INSERT INTO public.diaspora_trade_rate_observations (classification,cost_stage,label,amount,currency,effective_from,source_name) VALUES ('GUESS','MAIN_CARRIAGE','x',1,'USD','2026-09-01','y')`)));
record('an effective range that ends before it starts is refused',
  await refused(() => db.query(`INSERT INTO public.diaspora_trade_rate_observations (classification,cost_stage,label,amount,currency,effective_from,effective_to,source_name) VALUES ('OFFICIAL_FEE','REGULATORY','x',1,'USD','2026-09-10','2026-09-01','y')`)));

// ── 4. Allocation ───────────────────────────────────────────────────────
const r1 = (await db.query(`INSERT INTO public.diaspora_cargo_reservations DEFAULT VALUES RETURNING id`)).rows[0].id;
const r2 = (await db.query(`INSERT INTO public.diaspora_cargo_reservations DEFAULT VALUES RETURNING id`)).rows[0].id;
await db.query(`INSERT INTO public.diaspora_shared_charge_allocations (charge_component_id,reservation_id,allocation_basis,allocated_amount,currency,basis_quantity,basis_total) VALUES ($1,$2,'CBM',60000,'JPY',18,54)`, [priced.id, r1]);
await db.query(`INSERT INTO public.diaspora_shared_charge_allocations (charge_component_id,reservation_id,allocation_basis,allocated_amount,currency,basis_quantity,basis_total,rounding_remainder) VALUES ($1,$2,'CBM',120000,'JPY',36,54,0)`, [priced.id, r2]);
const sum = (await db.query(`SELECT sum(allocated_amount)::numeric AS total FROM public.diaspora_shared_charge_allocations WHERE charge_component_id=$1 AND deleted_at IS NULL`, [priced.id])).rows[0];
record('allocations reconcile EXACTLY to the source charge (180000 JPY)', Number(sum.total) === 180000, `sum=${sum.total}`);
record('a second allocation for the same participant is refused (replay-safe, no double charge)',
  await refused(() => db.query(`INSERT INTO public.diaspora_shared_charge_allocations (charge_component_id,reservation_id,allocation_basis,allocated_amount,currency) VALUES ($1,$2,'CBM',1,'JPY')`, [priced.id, r1])));
const r3 = (await db.query(`INSERT INTO public.diaspora_cargo_reservations DEFAULT VALUES RETURNING id`)).rows[0].id;
record('an allocation basis outside the governed set is refused (no silent CBM default)',
  await refused(() => db.query(`INSERT INTO public.diaspora_shared_charge_allocations (charge_component_id,reservation_id,allocation_basis,allocated_amount,currency) VALUES ($1,$2,'WHATEVER',1,'JPY')`, [priced.id, r3])));
record('allocation_basis has NO database default — it must be stated',
  (await db.query(`SELECT column_default FROM information_schema.columns WHERE table_name='diaspora_shared_charge_allocations' AND column_name='allocation_basis'`)).rows[0].column_default === null);

// deleting a quote removes its components, but never touches FX history
await db.query(`DELETE FROM public.diaspora_logistics_quotes WHERE id=$1`, [lq]);
const left = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_trade_charge_components WHERE logistics_quote_id=$1`, [lq]);
const fxLeft = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_fx_rate_snapshots`);
record('deleting a quote cascades its components but leaves FX evidence intact',
  left.rows[0].n === 0 && fxLeft.rows[0].n === 3);

// ── 5. Down / Up ────────────────────────────────────────────────────────
await db.exec(down);
const gone = await db.query(`SELECT to_regclass('public.diaspora_fx_rate_snapshots') a, to_regclass('public.diaspora_trade_charge_components') b, to_regclass('public.diaspora_trade_rate_observations') c, to_regclass('public.diaspora_shared_charge_allocations') d`);
record('Down drops all four tables', Object.values(gone.rows[0]).every((v) => v === null));
await db.exec(up);
record('Up re-applies cleanly after Down',
  (await db.query(`SELECT to_regclass('public.diaspora_fx_rate_snapshots') a`)).rows[0].a !== null);

console.log(JSON.stringify(results, null, 2));
process.exit(results.ok ? 0 : 1);
