/**
 * In-memory mock Supabase client for Diaspora Trade OS service-level tests.
 *
 * Supports the subset of the supabase-js query builder used by the Phase 3-7 services:
 *   from(table)
 *     .select('*')
 *     .insert(payload).select().single()
 *     .update(payload).eq(...).select().single()
 *     .eq / .neq / .in / .is(col,null) / .not(col,'is',null) / .gte / .lte / .order / .range / .limit
 *     .single() / .maybeSingle()
 *
 * Rows are stored per table as plain objects. Inserts assign an id when missing. The builder is
 * thenable so `await client.from(t)...` resolves to `{ data, error }` exactly like supabase-js.
 */
export function createMockSupabase(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((row) => ({ ...row }));
  }

  let idCounter = 1;
  const nextId = (prefix) => `${prefix}-${idCounter++}`;

  function ensure(table) {
    if (!tables[table]) tables[table] = [];
    return tables[table];
  }

  function builder(table) {
    const rows = ensure(table);
    const state = {
      op: 'select',
      payload: null,
      filtersEq: [],
      filtersNeq: [],
      isNull: [],
      notNull: [],
      single: false,
      maybeSingle: false,
      orderBy: null,
      range: null,
    };

    const matches = (row) =>
      state.filtersEq.every(([k, v]) => String(row[k]) === String(v)) &&
      state.filtersNeq.every(([k, v]) => String(row[k]) !== String(v)) &&
      state.isNull.every((c) => row[c] === null || row[c] === undefined) &&
      state.notNull.every((c) => row[c] !== null && row[c] !== undefined);

    function exec() {
      if (state.op === 'insert') {
        const items = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted = items.map((p) => {
          const row = { id: p.id || nextId(`${table}`), ...p };
          if (row.created_at === undefined) row.created_at = new Date(2026, 5, 20).toISOString();
          rows.push(row);
          return { ...row };
        });
        const data = state.single || state.maybeSingle ? inserted[0] : inserted;
        return { data, error: null };
      }

      if (state.op === 'update') {
        const matched = rows.filter(matches);
        matched.forEach((row) => Object.assign(row, state.payload));
        const copies = matched.map((r) => ({ ...r }));
        if (state.single) {
          if (!copies.length) return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
          return { data: copies[0], error: null };
        }
        if (state.maybeSingle) return { data: copies[0] || null, error: null };
        return { data: copies, error: null };
      }

      // select
      let data = rows.filter(matches).map((r) => ({ ...r }));
      if (state.orderBy) {
        const [col, dir] = state.orderBy;
        data.sort((a, b) => {
          if (a[col] === b[col]) return 0;
          return (a[col] > b[col] ? 1 : -1) * dir;
        });
      }
      if (state.range) data = data.slice(state.range[0], state.range[1] + 1);
      if (state.single) {
        if (!data.length) return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
        return { data: data[0], error: null };
      }
      if (state.maybeSingle) return { data: data[0] || null, error: null };
      return { data, error: null };
    }

    const chain = {
      select() { return chain; },
      insert(p) { state.op = 'insert'; state.payload = p; return chain; },
      update(p) { state.op = 'update'; state.payload = p; return chain; },
      delete() { state.op = 'delete'; return chain; },
      upsert(p) { state.op = 'insert'; state.payload = p; return chain; },
      eq(k, v) { state.filtersEq.push([k, v]); return chain; },
      neq(k, v) { state.filtersNeq.push([k, v]); return chain; },
      in() { return chain; },
      or() { return chain; },
      gte() { return chain; },
      lte() { return chain; },
      gt() { return chain; },
      lt() { return chain; },
      is(col, val) { if (val === null) state.isNull.push(col); return chain; },
      not(col, op, val) { if (op === 'is' && val === null) state.notNull.push(col); return chain; },
      order(col, opts) { state.orderBy = [col, opts && opts.ascending === false ? -1 : 1]; return chain; },
      range(a, b) { state.range = [a, b]; return chain; },
      limit(n) { state.range = [0, n - 1]; return chain; },
      single() { state.single = true; return chain; },
      maybeSingle() { state.maybeSingle = true; return chain; },
      then(resolve, reject) {
        try {
          return Promise.resolve(exec()).then(resolve, reject);
        } catch (err) {
          return reject ? reject(err) : Promise.reject(err);
        }
      },
    };
    return chain;
  }

  return {
    from: builder,
    /** test-only accessors */
    _tables: tables,
    _rows: (table) => ensure(table),
  };
}
