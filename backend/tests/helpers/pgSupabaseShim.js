/**
 * Test-only PostgREST-shaped client over a real PostgreSQL connection (node-postgres).
 *
 * Lets service and route tests run against the REAL migrations and SECURITY DEFINER functions of a disposable
 * database instead of a hand-written mock of their rules. Supports the subset of the supabase-js builder CarUp's
 * payment services use: select/insert/update with eq/neq/in/is filters, order, limit, single/maybeSingle, and rpc()
 * with named arguments. Values come back the way PostgREST returns them (ISO timestamps, numbers for int8).
 * Never point it at anything but a disposable database.
 */
import pg from 'pg';

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString()));
pg.types.setTypeParser(1114, (v) => (v === null ? null : new Date(`${v}Z`).toISOString()));

const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier ${name}`);
  return `"${name}"`;
};
const toPg = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  ? JSON.stringify(value) : value);

export function createPgSupabase(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 4 });

  function from(table) {
    const state = { op: 'select', cols: '*', filters: [], order: [], limit: null, payload: null, single: false, maybe: false };
    const chain = {
      select(cols = '*') { if (state.op === 'select') state.cols = cols; return chain; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
      update(payload) { state.op = 'update'; state.payload = payload; return chain; },
      eq(col, value) { state.filters.push([col, '=', value]); return chain; },
      neq(col, value) { state.filters.push([col, '<>', value]); return chain; },
      in(col, values) { state.filters.push([col, 'in', values]); return chain; },
      is(col, value) { state.filters.push([col, 'is', value]); return chain; },
      order(col, opts) { state.order.push([col, opts?.ascending === false ? 'DESC' : 'ASC']); return chain; },
      limit(n) { state.limit = n; return chain; },
      single() { state.single = true; return chain; },
      maybeSingle() { state.maybe = true; return chain; },
      then(resolve, reject) { return exec().then(resolve, reject); },
    };
    async function exec() {
      const params = [];
      const where = state.filters.map(([col, op, value]) => {
        if (op === 'in') { params.push(value); return `${ident(col)} = ANY($${params.length})`; }
        if (op === 'is') return `${ident(col)} IS ${value === null ? 'NULL' : value ? 'TRUE' : 'FALSE'}`;
        params.push(toPg(value));
        return `${ident(col)} ${op} $${params.length}`;
      });
      const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      let sql;
      if (state.op === 'insert') {
        const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
        const cols = Object.keys(rows[0]);
        const values = rows.map((row) => `(${cols.map((c) => { params.push(toPg(row[c])); return `$${params.length}`; }).join(', ')})`);
        sql = `INSERT INTO public.${ident(table)} (${cols.map(ident).join(', ')}) VALUES ${values.join(', ')} RETURNING *`;
      } else if (state.op === 'update') {
        const sets = Object.entries(state.payload).map(([c, v]) => { params.push(toPg(v)); return `${ident(c)} = $${params.length}`; });
        sql = `UPDATE public.${ident(table)} SET ${sets.join(', ')}${whereSql} RETURNING *`;
      } else {
        const order = state.order.length ? ` ORDER BY ${state.order.map(([c, d]) => `${ident(c)} ${d}`).join(', ')}` : '';
        sql = `SELECT ${state.cols} FROM public.${ident(table)}${whereSql}${order}${state.limit ? ` LIMIT ${Number(state.limit)}` : ''}`;
      }
      let rows;
      try { ({ rows } = await pool.query(sql, params)); } catch (err) { return { data: null, error: { message: err.message, code: err.code } }; }
      if (state.single) {
        return rows.length === 1 ? { data: rows[0], error: null }
          : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
      }
      if (state.maybe) {
        return rows.length > 1 ? { data: null, error: { message: 'multiple rows', code: 'PGRST116' } } : { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    }
    return chain;
  }

  // PAY-04: like the PGlite PostgREST shim (pgliteLedgerHarness.supabaseOver), a function returning one scalar
  // (for example jsonb) yields that value, and a set-returning or composite-returning function yields its rows,
  // instead of a composite rendered as a string.
  const shapes = new Map();
  async function shapeOf(name) {
    if (!shapes.has(name)) {
      const { rows: [shape] } = await pool.query(
        `SELECT p.proretset, t.typtype FROM pg_proc p JOIN pg_type t ON t.oid = p.prorettype
          WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace LIMIT 1`, [name]);
      shapes.set(name, shape || null);
    }
    return shapes.get(name);
  }

  async function rpc(name, args = {}) {
    const keys = Object.keys(args);
    const call = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ');
    try {
      const shape = await shapeOf(name);
      if (shape && (shape.proretset || shape.typtype === 'c')) {
        const { rows } = await pool.query(`SELECT * FROM public.${ident(name)}(${call})`, keys.map((k) => toPg(args[k])));
        return { data: rows, error: null };
      }
      const { rows } = await pool.query(`SELECT public.${ident(name)}(${call}) AS result`, keys.map((k) => toPg(args[k])));
      return { data: rows[0]?.result ?? null, error: null };
    } catch (err) {
      return { data: null, error: { message: err.message, code: err.code, details: err.detail || null } };
    }
  }

  return { from, rpc, pool, query: (sql, params) => pool.query(sql, params), end: () => pool.end() };
}
