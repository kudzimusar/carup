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
  // Service Network S8 — service_links: UNIQUE (public_token) and UNIQUE
  // (resource_type, resource_id) so a resource has exactly one stable address;
  // service_capability_grants: UNIQUE (token_hash).
  service_links: [['public_token'], ['resource_type', 'resource_id']],
  service_capability_grants: [['token_hash']],
  // Service Network S5 — service_record_parts: UNIQUE (service_record_id, partsentry_log_id)
  // and service_record_evidence: UNIQUE (service_record_id, evidence_id). Both make the
  // attach paths retry-safe: a repeated attach must lose the race rather than record the
  // same part or the same evidence twice against one service record.
  service_record_parts: [['service_record_id', 'partsentry_log_id']],
  service_record_evidence: [['service_record_id', 'evidence_id']],
  // Service Network S4 — mechanic_work_orders: partial UNIQUE (service_case_id) WHERE NOT NULL
  // (one work order per Service Case) and work_order_assignments: partial UNIQUE
  // (work_order_id) WHERE unassigned_at IS NULL (at most one LIVE mechanic per work order —
  // a second concurrent assign must lose the race, not produce two "current" mechanics).
  mechanic_work_orders: [['service_case_id']],
  work_order_assignments: [['work_order_id', 'unassigned_at']],
  // Service Network S2 — service_cases: partial UNIQUE (source_inquiry_id) WHERE NOT NULL.
  // This index IS the idempotent marketplace bridge: a retry must lose the insert race
  // rather than open a second Service Case for one inquiry.
  service_cases: [['source_inquiry_id']],
  // Service Network S1 — garage_public_profiles: PRIMARY KEY (tenant_id) and UNIQUE (slug).
  // Both are load-bearing: one profile per garage tenant, and a globally unique public
  // slug (the public identity, since internal tenant UUIDs are never published).
  garage_public_profiles: [['tenant_id'], ['slug']],
  // Service Network S1 — garage_branches: UNIQUE (tenant_id, name).
  garage_branches: [['tenant_id', 'name']],
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

  /**
   * Postgres-like comparison. Dates and ISO date strings compare chronologically;
   * numbers numerically; everything else lexicographically. A NULL never satisfies a
   * comparison, matching SQL three-valued logic.
   */
  function compareValues(op, left, right) {
    if (left === null || left === undefined) return false;
    let a = left;
    let b = right;
    const asTime = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
    if (!Number.isNaN(asTime(a)) && !Number.isNaN(asTime(b))
        && typeof a !== 'number' && typeof b !== 'number') {
      a = asTime(a); b = asTime(b);
    } else if (!Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) {
      a = Number(a); b = Number(b);
    } else {
      a = String(a); b = String(b);
    }
    switch (op) {
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      default: return true;
    }
  }

  function builder(table) {
    const rows = ensure(table);
    const state = {
      op: 'select',
      payload: null,
      count: null,
      head: false,
      filtersEq: [],
      filtersNeq: [],
      // Comparison filters. These were previously no-ops that returned the chain
      // untouched, so every `.gt()/.lt()/.gte()/.lte()`-filtered query silently
      // returned the WHOLE table — which made expiry and window checks vacuous.
      filtersCmp: [],
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
      state.notNull.every((c) => row[c] !== null && row[c] !== undefined) &&
      state.filtersCmp.every(([op, k, v]) => compareValues(op, row[k], v));

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
        return { data: data[0], error: null, count: state.count ? data.length : null };
      }
      if (state.maybeSingle) return { data: data[0] || null, error: null, count: state.count ? data.length : null };
      if (state.count) {
        return { data: state.head ? null : data, error: null, count: data.length };
      }
      return { data, error: null };
    }

    const chain = {
      select(_cols, opts) {
        // supabase-js: .select(cols, { count: 'exact', head: true }) returns a row COUNT.
        // Without this the mock silently answers `count: undefined`, which a service reading
        // `count ?? 0` turns into a fabricated zero — exactly the "unknown is not zero"
        // failure the real client would never produce.
        if (opts && opts.count) state.count = opts.count;
        if (opts && opts.head) state.head = true;
        return chain;
      },
      insert(p) { state.op = 'insert'; state.payload = p; return chain; },
      update(p) { state.op = 'update'; state.payload = p; return chain; },
      delete() { state.op = 'delete'; return chain; },
      upsert(p) { state.op = 'insert'; state.payload = p; return chain; },
      eq(k, v) { state.filtersEq.push([k, v]); return chain; },
      neq(k, v) { state.filtersNeq.push([k, v]); return chain; },
      in(k, vals) { state.filtersIn.push([k, Array.isArray(vals) ? vals : [vals]]); return chain; },
      or() { return chain; },
      gte(k, v) { state.filtersCmp.push(['gte', k, v]); return chain; },
      lte(k, v) { state.filtersCmp.push(['lte', k, v]); return chain; },
      gt(k, v) { state.filtersCmp.push(['gt', k, v]); return chain; },
      lt(k, v) { state.filtersCmp.push(['lt', k, v]); return chain; },
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
