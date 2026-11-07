// R6 DBA #2: trigger cost of the dealership guards on NON-programme (legacy) rows.
// Each measurement: BEGIN; [DISABLE TRIGGER]; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ...; ROLLBACK.
// ON/OFF runs alternate; median of RUNS. Nothing is kept: every statement is rolled back.
// Usage (disposable PG17 only; schema from DEALER_NATIVE_SCHEMA_ONLY=1 dealer_1_0_pglite_check.mjs,
// then psql -f dealer_r6_trigger_cost_fixture.sql):
//   DEALER_ISOLATED_POSTGRES_URL=postgresql://postgres@127.0.0.1:<port>/carup_dealer_isolated_ci \
//     node database/test/dealer_r6_trigger_cost_bench.mjs
import pg from 'pg';
const url = process.env.DEALER_ISOLATED_POSTGRES_URL || '';
const parsed = new URL(url || 'invalid://x');
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || parsed.pathname !== '/carup_dealer_isolated_ci' || parsed.search || parsed.hash) {
  throw new Error('ISOLATED_LOOPBACK_POSTGRES_CI_DATABASE_REQUIRED');
}
const c = new pg.Client({ connectionString: url, application_name: 'carup-dealer-r6-trigger-cost-bench' }); await c.connect();
const RUNS = Number(process.env.RUNS || 7);
const L = (g) => `('10000000-0000-4000-8000-'||lpad((${g})::text,12,'0'))::uuid`;
const scenarios = [
  { id: 'S1', label: 'bulk UPDATE publication_status, 50,000 legacy vehicles (guard fires per row)', table: 'vehicles', trigger: 'dealer_guard_canonical_listing_write',
    sql: `UPDATE vehicles SET publication_status = CASE WHEN publication_status='published' THEN 'publishable' ELSE 'published' END WHERE vin LIKE 'LEGACY%'` },
  { id: 'S2', label: 'INSERT 20,000 legacy vehicles (guard fires per row)', table: 'vehicles', trigger: 'dealer_guard_canonical_listing_write',
    sql: `INSERT INTO vehicles(vin,tenant_id,make,model,year,publication_status) SELECT 'BENCHI'||lpad(g::text,11,'0'),${L('1+g%5000')},'Synthetic','Insert',2020,'draft' FROM generate_series(1,20000) g` },
  { id: 'S3', label: 'single legacy VIN publish (point UPDATE)', table: 'vehicles', trigger: 'dealer_guard_canonical_listing_write',
    sql: `UPDATE vehicles SET publication_status='published' WHERE vin='LEGACY00000012345'` },
  { id: 'S4', label: 'bulk UPDATE price, 50,000 legacy vehicles (column not watched: guard never fires)', table: 'vehicles', trigger: 'dealer_guard_canonical_listing_write',
    sql: `UPDATE vehicles SET price = price + 1 WHERE vin LIKE 'LEGACY%'` },
  { id: 'S5', label: 'UPDATE tenants.status, 5,000 legacy tenants', table: 'tenants', trigger: 'dealer_withdraw_listings_on_tenant_change',
    sql: `UPDATE tenants SET status='suspended' WHERE name LIKE 'Legacy tenant %'` },
  { id: 'S6', label: 'UPDATE tenant_users.role, 5,000 legacy memberships', table: 'tenant_users', trigger: 'dealer_withdraw_listings_on_owner_membership_change',
    sql: `UPDATE tenant_users SET role='member' WHERE user_id LIKE 'bench-user-%' AND tenant_id::text LIKE '10000000-%'` },
  { id: 'S7', label: 'INSERT 5,000 legacy marketplace_inquiries', table: 'marketplace_inquiries', trigger: 'dealer_guard_marketplace_inquiry',
    sql: `INSERT INTO marketplace_inquiries(listing_id,seller_tenant_id,status,risk_status) SELECT 'LEGACY'||lpad(g::text,11,'0'),(${L('1+g%5000')})::text,'new','clear' FROM generate_series(1,5000) g` },
  { id: 'S8', label: 'UPDATE dealer_profiles risk columns, 1,000 legacy profiles', table: 'dealer_profiles', trigger: 'dealer_withdraw_listings_on_profile_change',
    also: ['dealer_guard_linked_profile_reinstatement'],
    sql: `UPDATE dealer_profiles SET investigation_state='under_investigation' WHERE legal_name LIKE 'Legacy dealer %'` },
];
const walk = (node, out) => { out.hit += node['Shared Hit Blocks'] || 0; out.read += node['Shared Read Blocks'] || 0; for (const p of node.Plans || []) walk(p, out); return out; };
async function measure(s, enabled) {
  await c.query('BEGIN');
  try {
    if (!enabled) for (const t of [s.trigger, ...(s.also || [])]) await c.query(`ALTER TABLE ${s.table} DISABLE TRIGGER ${t}`);
    const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${s.sql}`);
    const plan = r.rows[0]['QUERY PLAN'][0];
    const trig = (plan.Triggers || []).filter((t) => t['Trigger Name'].startsWith('dealer_'));
    return { exec: plan['Execution Time'], trigMs: trig.reduce((a, t) => a + t.Time, 0), calls: trig.reduce((a, t) => Math.max(a, t.Calls), 0),
      rows: plan.Plan['Actual Rows'], buf: walk(plan.Plan, { hit: 0, read: 0 }), node: plan.Plan.Plans?.[0]?.['Node Type'] || plan.Plan['Node Type'] };
  } finally { await c.query('ROLLBACK'); }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const results = [];
for (const s of scenarios) {
  await measure(s, true); await measure(s, false); // warm cache
  const on = [], off = [];
  for (let i = 0; i < RUNS; i += 1) { on.push(await measure(s, true)); off.push(await measure(s, false)); }
  const row = { id: s.id, label: s.label, runs: RUNS,
    on_ms: +med(on.map((x) => x.exec)).toFixed(2), off_ms: +med(off.map((x) => x.exec)).toFixed(2),
    trigger_ms: +med(on.map((x) => x.trigMs)).toFixed(2), trigger_calls: on[0].calls,
    per_row_us: on[0].calls ? +((med(on.map((x) => x.trigMs)) * 1000) / on[0].calls).toFixed(2) : 0,
    buffers_on: on[0].buf, buffers_off: off[0].buf };
  row.ratio = +(row.on_ms / row.off_ms).toFixed(2);
  results.push(row);
  console.log(JSON.stringify(row));
}
// Lapse sweep driver and the guard's own lookups (plans only, no writes kept).
const plans = {};
for (const [k, sql] of Object.entries({
  sweep_driver: `SELECT DISTINCT l.tenant_id FROM dealer_approved_seed_links l JOIN vehicles x ON x.tenant_id = l.tenant_id AND x.publication_status = 'published'`,
  guard_link_lookup_legacy: `SELECT * FROM dealer_approved_seed_links WHERE tenant_id = ${L(12)} FOR SHARE`,
  withdraw_prelock_programme: `SELECT 1 FROM vehicles WHERE tenant_id = '20000000-0000-4000-8000-000000000007' ORDER BY vin FOR NO KEY UPDATE`,
  inquiry_guard_lookup_legacy: `SELECT * FROM dealer_approved_seed_links WHERE tenant_id::text = '10000000-0000-4000-8000-000000000012' FOR SHARE`,
})) {
  await c.query('BEGIN');
  const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING ON) ${sql}`);
  await c.query('ROLLBACK');
  plans[k] = r.rows.map((x) => x['QUERY PLAN']).join('\n');
}
await c.query('BEGIN');
const sweep = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT dealer_withdraw_lapsed_listing_authority('bench')`);
await c.query('ROLLBACK');
plans.sweep_execution_ms = sweep.rows[0]['QUERY PLAN'][0]['Execution Time'];
for (const [k, v] of Object.entries(plans)) console.log(`--- ${k}\n${v}`);
await c.end();
