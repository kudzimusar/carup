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

/**
 * Unique indexes the mock enforces, mirroring the real migrations.
 *
 * Several services rely on Postgres raising 23505 as their concurrency-safe de-duplication mechanism:
 * they INSERT and treat "you lost the race" as "already handled". A mock that accepts every insert
 * makes those code paths untestable — worse, it makes a de-duplication test pass even if the
 * constraint were dropped from the migration. Registering the index here means the fake fails the
 * same way the database does.
 *
 * NULLs never collide (matching Postgres's default NULLS DISTINCT behaviour). Only the indexes listed
 * here are enforced, so existing tests are unaffected.
 */
export const UNIQUE_INDEXES = Object.freeze({
  // ledger #21 — diaspora_safetrade_provider_events: UNIQUE (provider, event_id)
  diaspora_safetrade_provider_events: [['provider', 'event_id']],
  // ledger #21 — diaspora_safetrade_operations: UNIQUE (tenant_id, idempotency_key)
  diaspora_safetrade_operations: [['tenant_id', 'idempotency_key']],
  // ledger #21 — diaspora_workbook_import_confirmations: UNIQUE (tenant_id, idempotency_key)
  diaspora_workbook_import_confirmations: [['tenant_id', 'idempotency_key']],
  // ledger #21 — diaspora_drive_sync_attempts: UNIQUE (tenant_id, idempotency_key)
  diaspora_drive_sync_attempts: [['tenant_id', 'idempotency_key']],
  // ledger #12 — diaspora_billing_provider_events: UNIQUE (provider, event_id)
  diaspora_billing_provider_events: [['provider', 'event_id']],
  // ledger #27 — diaspora_subscription_renewals: UNIQUE (tenant_id, subscription_id, period_end).
  // The renewal sweep's idempotency IS this index: a second sweep in the same period must lose the
  // insert race rather than record a second due renewal, and on the other side of that window is a
  // duplicate charge.
  diaspora_subscription_renewals: [['tenant_id', 'subscription_id', 'period_end']],
  // ledger #12 — diaspora_user_entitlement_overrides:
  //   CONSTRAINT uq_diaspora_user_override UNIQUE (tenant_id, user_id, feature_key)
  //
  // Deliberately NOT deleted_at-aware, because the real constraint is not either. That is the whole
  // bug ledger #26 exists to fix: a soft-deleted override keeps its unique slot, so re-granting it
  // collides. A mock that accepted the insert would let the broken read-then-insert path pass its
  // tests forever while the capability was, in production, ungrantable for the rest of time.
  diaspora_user_entitlement_overrides: [['tenant_id', 'user_id', 'feature_key']],
  // T4 — diaspora_logistics_requests: uq_diaspora_logistics_request_live_import_order.
  //
  // The continuation edge's idempotency IS this index: two concurrent "arrange shipping" clicks on
  // one purchase must produce ONE shipping request, and the loser must be handed the winner rather
  // than an error.
  //
  // The real index is PARTIAL (… WHERE deleted_at IS NULL AND import_order_id IS NOT NULL AND
  // status NOT IN ('CANCELLED','CLOSED')). The mock cannot express a predicate, so this entry is
  // STRICTER than Postgres in exactly one direction: after a continuation is cancelled or closed,
  // the real database frees the slot and the mock does not. That divergence is safe for the
  // concurrency path it exists to test, but it means a "re-arrange shipping after cancelling"
  // test must NOT be written against the mock — the partial predicate is proven against real
  // Postgres in database/test/trade_os_t4_continuation_check.mjs instead.
  //
  // NULL import_order_id never collides (Postgres NULLS DISTINCT), so logistics-origin requests —
  // the common case — are entirely unaffected.
  diaspora_logistics_requests: [['import_order_id']],
});

export function createMockSupabase(seed = {}, options = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((row) => ({ ...row }));
  }

  let idCounter = 1;
  const nextId = (prefix) => `${prefix}-${idCounter++}`;

  // RPC support: `options.rpc` maps function name -> (params, helpers) => data. Mirrors the SQL
  // functions so service-level tests exercise the same invariants. `faults` lets tests simulate a
  // mid-transaction failure to prove all-or-nothing rollback.
  const rpcImpls = options.rpc || {};
  const faults = options.faults || {};

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
      // .in() previously returned the chain untouched, so every `.in()`-filtered query returned the
      // WHOLE table and any test of such a query passed vacuously.
      filtersIn: [],
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
      state.filtersIn.every(([k, vs]) => vs.map(String).includes(String(row[k]))) &&
      state.isNull.every((c) => row[c] === null || row[c] === undefined) &&
      state.notNull.every((c) => row[c] !== null && row[c] !== undefined);

    function exec() {
      if (state.op === 'insert') {
        const items = Array.isArray(state.payload) ? state.payload : [state.payload];
        // Enforce the registered unique indexes exactly as Postgres would (23505), so services whose
        // de-duplication IS the constraint are actually exercised rather than trivially passing.
        const uniques = UNIQUE_INDEXES[table];
        if (uniques) {
          for (const p of items) {
            for (const cols of uniques) {
              if (cols.some((c) => p[c] === undefined || p[c] === null)) continue; // NULLs never collide
              if (rows.some((existing) => cols.every((c) => existing[c] === p[c]))) {
                return {
                  data: null,
                  error: {
                    code: '23505',
                    message: `duplicate key value violates unique constraint on ${table} (${cols.join(', ')})`,
                  },
                };
              }
            }
          }
        }
        const inserted = items.map((p) => {
          const row = { id: p.id || nextId(`${table}`), ...p };
          // Match Postgres `DEFAULT now()`. A FIXED past timestamp made every inserted row look
          // ancient, so any age-based logic (claim leases, backlog staleness) silently took the
          // "stale" branch in every test and could never be exercised correctly. Tests that care
          // about a specific timestamp already set created_at explicitly, which still wins.
          if (row.created_at === undefined) row.created_at = new Date().toISOString();
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
      in(k, vals) { state.filtersIn.push([k, Array.isArray(vals) ? vals : [vals]]); return chain; },
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

  async function rpc(name, params) {
    const impl = rpcImpls[name];
    if (!impl) return { data: null, error: { message: `RPC ${name} not found` } };
    try {
      const data = await impl(params || {}, { table: ensure, nextId, faults });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  return {
    from: builder,
    rpc,
    /** test-only accessors */
    _tables: tables,
    _rows: (table) => ensure(table),
    _faults: faults,
    setFault(key, value = true) { faults[key] = value; },
    clearFaults() { for (const k of Object.keys(faults)) delete faults[k]; },
  };
}
