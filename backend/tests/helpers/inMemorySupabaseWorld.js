/**
 * An in-memory Supabase "world" for journey tests through the SHIPPED app (OC-4C, OC-4E).
 *
 * Table-agnostic: any table, any columns. It implements the supabase-js query-builder subset the routes
 * on the governed journeys use (select/insert/upsert/update/delete with eq/neq/in/is/gt/gte/lt/lte/
 * ilike/or-free filters, order, limit, range, single/maybeSingle, head counts, JSON-path `col->>key`
 * equality), a Storage double that really stores bytes, and an RPC table a test can register handlers in.
 *
 * Not a database: no FKs, RLS, triggers or CHECKs — those are proven on real PostgreSQL (PGlite) in the
 * OC-3D/OC-4A suites. What this proves is the WIRING: real routes, real services, real auth, real
 * provider boundaries, against state a test can inspect.
 *
 * Ids: a row inserted without one gets a random UUID — EXCEPT in a table declared `serialTables`, which
 * gets the next integer, as a BIGSERIAL column would. That matters wherever code ORDERS by id: the
 * ledger verifier walks `blockchain_events` by id, so random ids made a two-event chain read as broken
 * about half the time (found by OC-4E's first CI run, not by the local runs).
 */
import { randomUUID } from 'node:crypto';

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * PostgREST-faithful column projection for `select('a, b, alias:c, rel:table(x)')`. A route that keeps
 * private columns out with a query-level allow-list must be exercised WITH that allow-list, or a privacy
 * assertion is meaningless (OC-4E found exactly that false positive). Embedded relations are omitted —
 * this world does not join — and `*` returns the whole row.
 */
function splitTopLevel(columns) {
  const parts = [];
  let depth = 0; let current = '';
  for (const ch of String(columns)) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
function project(row, columns) {
  if (!columns || columns === '*' || row === null || row === undefined) return row;
  const parts = splitTopLevel(columns);
  if (parts.includes('*')) return row;
  const out = {};
  for (const part of parts) {
    if (part.includes('(')) continue; // embedded relation: not joined here
    const [alias, column] = part.includes(':') ? part.split(':').map((x) => x.trim()) : [part, part];
    const source = column.split('->>')[0];
    if (Object.prototype.hasOwnProperty.call(row, source)) out[alias] = row[source];
  }
  return out;
}

function readField(row, key) {
  if (key.includes('->>')) {
    const [column, path] = key.split('->>');
    return row[column]?.[path];
  }
  return row[key];
}

export function createSupabaseWorld(seed = {}, { serialTables = [] } = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, clone(rows)]));
  const serial = new Set(serialTables);
  const nextId = (table) => {
    if (!serial.has(table)) return randomUUID();
    const max = (tables[table] || []).reduce((m, r) => (Number.isFinite(Number(r.id)) ? Math.max(m, Number(r.id)) : m), 0);
    return max + 1;
  };
  const objects = new Map();
  const rpcs = new Map();
  const writes = [];

  const rowsOf = (table) => (tables[table] ||= []);

  function from(table) {
    const st = { op: 'select', filters: [], order: [], limit: null, range: null, payload: null, returning: false, head: false, onConflict: null, columns: '*' };
    const matches = (row) => st.filters.every(([key, op, value]) => {
      const actual = readField(row, key);
      switch (op) {
        case 'eq': return actual === value;
        case 'neq': return actual !== value;
        case 'in': return value.includes(actual);
        case 'is': return actual === value || (value === null && actual === undefined);
        case 'gt': return actual > value;
        case 'gte': return actual >= value;
        case 'lt': return actual < value;
        case 'lte': return actual <= value;
        case 'ilike': return typeof actual === 'string' && new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i').test(actual);
        default: return true;
      }
    });
    const q = {
      select(columns = '*', options = {}) {
        st.columns = columns || '*';
        if (st.op === 'select') { if (options.head) st.head = true; } else st.returning = true;
        return q;
      },
      insert(payload) { st.op = 'insert'; st.payload = payload; return q; },
      upsert(payload, options = {}) { st.op = 'upsert'; st.payload = payload; st.onConflict = options.onConflict || null; return q; },
      update(payload) { st.op = 'update'; st.payload = payload; return q; },
      delete() { st.op = 'delete'; return q; },
      eq(k, v) { st.filters.push([k, 'eq', v]); return q; },
      neq(k, v) { st.filters.push([k, 'neq', v]); return q; },
      in(k, v) { st.filters.push([k, 'in', v]); return q; },
      is(k, v) { st.filters.push([k, 'is', v]); return q; },
      gt(k, v) { st.filters.push([k, 'gt', v]); return q; },
      gte(k, v) { st.filters.push([k, 'gte', v]); return q; },
      lt(k, v) { st.filters.push([k, 'lt', v]); return q; },
      lte(k, v) { st.filters.push([k, 'lte', v]); return q; },
      ilike(k, v) { st.filters.push([k, 'ilike', v]); return q; },
      order(k, o = {}) { st.order.push([k, o.ascending !== false]); return q; },
      limit(n) { st.limit = n; return q; },
      range(a, b) { st.range = [a, b]; return q; },
      single() { return run('single'); },
      maybeSingle() { return run('maybe'); },
      then(resolve, reject) { return run('list').then(resolve, reject); },
    };
    async function run(mode) {
      let out;
      if (st.op === 'insert' || st.op === 'upsert') {
        const incoming = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((row) => ({ created_at: new Date().toISOString(), ...clone(row) }));
        out = [];
        for (const row of incoming) {
          if (row.id === undefined || row.id === null) row.id = nextId(table);
          if (st.op === 'upsert' && st.onConflict) {
            const keys = st.onConflict.split(',').map((k) => k.trim());
            const existing = rowsOf(table).find((r) => keys.every((k) => r[k] === row[k]));
            if (existing) { Object.assign(existing, row); out.push(existing); continue; }
          }
          rowsOf(table).push(row);
          out.push(row);
        }
        writes.push({ table, op: st.op, rows: clone(out) });
        if (!st.returning) return { data: null, error: null };
      } else if (st.op === 'update') {
        out = rowsOf(table).filter(matches);
        for (const row of out) Object.assign(row, clone(st.payload));
        writes.push({ table, op: 'update', rows: clone(out), patch: clone(st.payload) });
        if (!st.returning && mode === 'list') return { data: null, error: null };
      } else if (st.op === 'delete') {
        const removed = rowsOf(table).filter(matches);
        tables[table] = rowsOf(table).filter((row) => !matches(row));
        writes.push({ table, op: 'delete', rows: clone(removed) });
        return { data: null, error: null };
      } else {
        out = rowsOf(table).filter(matches);
        if (st.head) return { data: null, count: out.length, error: null };
        for (const [key, ascending] of [...st.order].reverse()) {
          out = [...out].sort((a, b) => ((a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (ascending ? 1 : -1)));
        }
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
        if (st.limit !== null) out = out.slice(0, st.limit);
      }
      out = clone(out).map((row) => project(row, st.columns));
      if (mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: `${out.length} rows` } };
      if (mode === 'maybe') return { data: out[0] ?? null, error: null };
      return { data: out, error: null, count: out.length };
    }
    return q;
  }

  const storage = {
    from: (bucket) => ({
      async upload(name, buffer, options = {}) {
        objects.set(`${bucket}/${name}`, { buffer: Buffer.from(buffer), contentType: options.contentType || 'application/octet-stream' });
        return { data: { path: name }, error: null };
      },
      getPublicUrl: (name) => ({ data: { publicUrl: `https://storage.invalid/${bucket}/${name}` } }),
      async download(path) {
        const hit = objects.get(`${bucket}/${path}`);
        return hit ? { data: new Blob([hit.buffer], { type: hit.contentType }), error: null } : { data: null, error: { message: 'object not found' } };
      },
      async createSignedUrl(path) { return { data: { signedUrl: `https://storage.invalid/signed/${bucket}/${path}` }, error: null }; },
      async remove(paths) { for (const p of paths) objects.delete(`${bucket}/${p}`); return { data: null, error: null }; },
    }),
  };

  async function rpc(name, params) {
    const handler = rpcs.get(name);
    if (!handler) return { data: null, error: { code: 'PGRST202', message: `function ${name} not found in the in-memory world` } };
    return handler(params, { tables, rowsOf });
  }

  return {
    tables, objects, writes, rpcs,
    rows: (table) => rowsOf(table),
    client: { from, storage, rpc },
  };
}

/** Point the shared supabase client at a world for the duration of a test file. Returns a restore(). */
export function installSupabaseWorld(supabase, world) {
  const saved = { from: supabase.from, storage: supabase.storage, rpc: supabase.rpc };
  supabase.from = (table) => world.client.from(table);
  Object.defineProperty(supabase, 'storage', { configurable: true, writable: true, value: world.client.storage });
  supabase.rpc = (name, params) => world.client.rpc(name, params);
  return () => {
    supabase.from = saved.from;
    Object.defineProperty(supabase, 'storage', { configurable: true, writable: true, value: saved.storage });
    supabase.rpc = saved.rpc;
  };
}

export default { createSupabaseWorld, installSupabaseWorld };
