/**
 * Trade OS T5 — corridor authority + sailing facts + mode reconciliation, verified by EXECUTING
 * the migration on real PostgreSQL (PGlite).
 *
 * What only a real database can show here:
 *
 *   1. The corridor tables build, seed idempotently (Up is re-runnable), and the live-code
 *      uniqueness actually rejects a duplicate corridor code while allowing one after soft-delete.
 *   2. The leg mode vocabulary CHECK admits the conceptual modes and REFUSES an invented one — a
 *      corridor leg can say 'rail' without CarUp booking rail, but cannot say 'teleport'.
 *   3. The widened service_mode CHECK on diaspora_logistics_quotes accepts 'roro' and still
 *      refuses an unknown mode; Down restores the exact pre-T5 vocabulary (roro refused again).
 *   4. The sailing's corridor references SET NULL on corridor deletion rather than orphaning or
 *      cascading away a real sailing.
 *   5. Down → Up → Down leaves no residue.
 *
 * ci.yml's migration_pglite_check.mjs NEW_MIGRATIONS list ends at 20260810120000, so this
 * migration is executed by NO other gate. This file is that gate for 20260907090000, wired into
 * CI as its own step.
 *
 * Run:  node database/test/trade_os_t5_corridor_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const T5 = '20260907090000_trade_os_t5_corridors_and_sailing_lifecycle.sql';

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
};
const sectionOf = (file, section) => {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const down = raw.indexOf('-- +migrate Down');
  return section === 'up'
    ? (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '')
    : (down >= 0 ? raw.slice(down) : '').replace('-- +migrate Down', '');
};

const db = new PGlite();

// Stand-ins for the authorities the migration references. Supabase roles do not exist in PGlite,
// so they are created first — the migration's RLS/GRANT statements must run verbatim.
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.users (id text PRIMARY KEY);
  CREATE TABLE public.diaspora_container_shipments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_country text NOT NULL,
    destination_country text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    deleted_at timestamptz
  );
  CREATE TABLE public.diaspora_logistics_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_mode text NOT NULL,
    total_amount numeric NOT NULL,
    CONSTRAINT diaspora_logistics_quotes_service_mode_check
      CHECK (service_mode = ANY (ARRAY['shared_container'::text, 'lcl'::text, 'fcl'::text, 'road'::text, 'multimodal'::text, 'other'::text])),
    CONSTRAINT diaspora_logistics_quotes_total_amount_check CHECK (total_amount > 0)
  );
`);

const up = sectionOf(T5, 'up');
const down = sectionOf(T5, 'down');

// ── 1. Up applies, and applies AGAIN without duplicating seeds ─────────────
await db.exec(up);
await db.exec(up);
const corridors = await db.query(`SELECT code, planning_status FROM public.diaspora_trade_corridors WHERE deleted_at IS NULL ORDER BY code`);
record('Up is idempotent: exactly the three seeded corridors after a double apply',
  corridors.rows.length === 3
  && corridors.rows.map((r) => r.code).join(',') === 'JP-BEI-ZW,JP-DAR-ZW,JP-DUR-ZW');
record('JP-DAR-ZW is seeded as research_candidate, not benchmark',
  corridors.rows.find((r) => r.code === 'JP-DAR-ZW')?.planning_status === 'research_candidate');
const legs = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_trade_corridor_legs WHERE deleted_at IS NULL`);
record('legs seed once: 8 legs total across the three corridors', legs.rows[0].n === 8);

// ── 2. live-code uniqueness ────────────────────────────────────────────────
let dupRefused = false;
try {
  await db.query(`INSERT INTO public.diaspora_trade_corridors (code, display_name, origin_country, destination_country) VALUES ('JP-BEI-ZW','dup','Japan','Zimbabwe')`);
} catch { dupRefused = true; }
record('a duplicate LIVE corridor code is refused', dupRefused);
await db.query(`UPDATE public.diaspora_trade_corridors SET deleted_at = now() WHERE code = 'JP-DAR-ZW'`);
let reusable = true;
try {
  await db.query(`INSERT INTO public.diaspora_trade_corridors (code, display_name, origin_country, destination_country, planning_status) VALUES ('JP-DAR-ZW','replacement','Japan','Zimbabwe','research_candidate')`);
} catch { reusable = false; }
record('a soft-deleted code can be re-issued (predicate, not plain unique)', reusable);

// ── 3. leg mode vocabulary ─────────────────────────────────────────────────
const beira = (await db.query(`SELECT id FROM public.diaspora_trade_corridors WHERE code='JP-BEI-ZW' AND deleted_at IS NULL`)).rows[0].id;
let railOk = true;
try {
  await db.query(`INSERT INTO public.diaspora_trade_corridor_legs (corridor_id, sequence, origin_country, destination_country, mode_options) VALUES ($1, 99, 'Zimbabwe', 'Zimbabwe', ARRAY['rail','road'])`, [beira]);
} catch { railOk = false; }
record("a leg can express 'rail' — route knowledge is wider than what CarUp operates", railOk);
let inventedRefused = false;
try {
  await db.query(`INSERT INTO public.diaspora_trade_corridor_legs (corridor_id, sequence, origin_country, destination_country, mode_options) VALUES ($1, 100, 'Zimbabwe', 'Zimbabwe', ARRAY['teleport'])`, [beira]);
} catch { inventedRefused = true; }
record('an invented mode on a leg is refused', inventedRefused);

// ── 4. widened offer mode CHECK ────────────────────────────────────────────
let roroOk = true;
try { await db.query(`INSERT INTO public.diaspora_logistics_quotes (service_mode, total_amount) VALUES ('roro', 100)`); }
catch { roroOk = false; }
record("a provider offer can now say 'roro'", roroOk);
let junkRefused = false;
try { await db.query(`INSERT INTO public.diaspora_logistics_quotes (service_mode, total_amount) VALUES ('hovercraft', 100)`); }
catch { junkRefused = true; }
record('an unknown offer mode is still refused', junkRefused);

// ── 5. sailing corridor references SET NULL, never cascade the sailing ────
const sail = (await db.query(`INSERT INTO public.diaspora_container_shipments (origin_country, destination_country, corridor_id) VALUES ('Japan','Mozambique',$1) RETURNING id`, [beira])).rows[0].id;
await db.query(`DELETE FROM public.diaspora_trade_corridors WHERE id = $1`, [beira]);
const after = await db.query(`SELECT corridor_id FROM public.diaspora_container_shipments WHERE id = $1`, [sail]);
record('deleting a corridor nulls the sailing reference and keeps the sailing',
  after.rows.length === 1 && after.rows[0].corridor_id === null);

// ── 6. Down: refuses while roro is IN USE, then restores the pre-T5 world ──
let downRefusedInUse = false;
try { await db.exec(down); } catch { downRefusedInUse = true; }
record('Down FAILS LOUDLY while a roro offer exists — rollback may not strand or delete offers', downRefusedInUse);
await db.query(`DELETE FROM public.diaspora_logistics_quotes WHERE service_mode = 'roro'`);
await db.exec(down);
let roroRefusedAgain = false;
try { await db.query(`INSERT INTO public.diaspora_logistics_quotes (service_mode, total_amount) VALUES ('roro', 100)`); }
catch { roroRefusedAgain = true; }
record("Down restores the pre-T5 offer vocabulary ('roro' refused again)", roroRefusedAgain);
const gone = await db.query(`SELECT to_regclass('public.diaspora_trade_corridors') AS c, to_regclass('public.diaspora_trade_corridor_legs') AS l`);
record('Down drops both corridor tables', gone.rows[0].c === null && gone.rows[0].l === null);
const cols = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='diaspora_container_shipments' AND column_name IN ('origin_port','destination_port','corridor_id','corridor_leg_id')`);
record('Down removes the four sailing columns', cols.rows[0].n === 0);

// Up must survive a fresh apply after Down (recovery-safe).
await db.exec(up);
const again = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_trade_corridors WHERE deleted_at IS NULL`);
record('Up re-applies cleanly after Down', again.rows[0].n === 3);

console.log(JSON.stringify(results, null, 2));
process.exit(results.ok ? 0 : 1);
