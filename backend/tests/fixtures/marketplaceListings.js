/**
 * Test-only fixtures for real-inventory onboarding (Navigation Intelligence).
 *
 * These are REAL-LOOKING listings (valid VINs, non-seed owner/tenant) used to prove the marketplace
 * path works end-to-end in tests. They are NOT seeded into any database — pure in-memory test data.
 */

/** A real-looking private listing: valid VIN, real owner, Local/ZW -> classifies as locally_used. */
export const realPrivateListing = {
  vin: '1HGBH41JXMN109186', // valid 17-char VIN (no I/O/Q)
  make: 'Toyota', model: 'Corolla', year: 2018, mileage: 65000,
  fuel_type: 'Petrol', transmission: 'Manual',
  price: 9500, currency: 'USD', status: 'Available',
  import_source: 'Local', registration_country: 'ZW', current_seller_type: 'Private Owner',
  owner_id: 'usr-1001-real', tenant_id: null,
  vehicle_condition_category: 'unknown', passport_verified: false,
  duty_paid: true, police_verified: true, trust_score: 70,
};

/** A real-looking dealer listing: valid VIN, real non-default tenant, Japan import -> recently_imported. */
export const realDealerListing = {
  vin: '1FMCU0GD9JUA12345', // valid 17-char VIN
  make: 'Ford', model: 'Ranger', year: 2020, mileage: 80000,
  fuel_type: 'Diesel', transmission: 'Automatic',
  price: 28000, currency: 'USD', status: 'Available',
  import_source: 'Japan', registration_country: 'ZW', current_seller_type: 'Dealer',
  owner_id: null, tenant_id: 'a1b2c3d4-1111-2222-3333-444455556666',
  vehicle_condition_category: 'unknown', passport_verified: false,
  duty_paid: true, police_verified: true, trust_score: 80,
};

/** A fixture/demo row (synthetic VIN, seed owner, default tenant) that must stay excluded. */
export const fixtureListing = {
  vin: 'VIN_REF_776997', make: 'Ford', model: 'Fiesta', year: 2018, mileage: 50000,
  price: 9500, currency: 'USD', status: 'Available',
  import_source: 'Local', registration_country: 'ZW', current_seller_type: 'Private Owner',
  owner_id: 'u3', tenant_id: '00000000-0000-0000-0000-000000000001',
  vehicle_condition_category: 'unknown',
};

/**
 * Minimal in-memory mock of the Supabase query chain.
 *
 * Read:   .from(t).select(...).eq/.neq/.gte/.lte/.in/.order/.limit(...) then await -> { data:[], error }
 * Single: .single()/.maybeSingle() -> { data: firstRow|null, error }
 * Write:  .from(t).insert(row|rows)[.select()][.single()] | .update(patch).eq(...)[.select()][.single()]
 *         .delete().eq(...) -> mutates store[t]
 * store mutates in place so write-then-read assertions work across calls.
 */
export function buildMockSupabase(store = {}) {
  return {
    from(table) {
      if (!Array.isArray(store[table])) store[table] = store[table] ? [].concat(store[table]) : [];
      const rows = store[table];
      const filters = [];
      let mode = 'select';
      let payload = null;
      const applyFilters = () => rows.filter((r) => filters.every((f) => f(r)));
      const resolve = () => {
        if (mode === 'insert') {
          const list = Array.isArray(payload) ? payload : [payload];
          list.forEach((r) => rows.push(r));
          return { data: Array.isArray(payload) ? list : list[0], list, error: null };
        }
        if (mode === 'update') {
          const matched = applyFilters();
          matched.forEach((r) => Object.assign(r, payload));
          return { data: matched, list: matched, error: null };
        }
        if (mode === 'delete') {
          const matched = applyFilters();
          store[table] = rows.filter((r) => !matched.includes(r));
          return { data: matched, list: matched, error: null };
        }
        const data = applyFilters();
        return { data, list: data, error: null };
      };
      const builder = {
        select() { return builder; },
        eq(col, val) { filters.push((r) => r[col] === val); return builder; },
        neq(col, val) { filters.push((r) => r[col] !== val); return builder; },
        gte(col, val) { filters.push((r) => Number(r[col]) >= Number(val)); return builder; },
        lte(col, val) { filters.push((r) => Number(r[col]) <= Number(val)); return builder; },
        in(col, vals) { const set = new Set(vals); filters.push((r) => set.has(r[col])); return builder; },
        // PostgREST disjunction: .or('col.eq.a,col2.eq.b') — supports the eq
        // operator only, which is all the services push down.
        or(expression) {
          const legs = String(expression).split(',').map((leg) => {
            const m = /^([^.]+)\.eq\.(.*)$/.exec(leg);
            if (!m) throw new Error(`mock supabase .or(): unsupported leg "${leg}"`);
            return { col: m[1], val: m[2] };
          });
          filters.push((r) => legs.some(({ col, val }) => r[col] === val || String(r[col]) === val));
          return builder;
        },
        order() { return builder; },
        limit() { return builder; },
        insert(value) { mode = 'insert'; payload = value; return builder; },
        update(patch) { mode = 'update'; payload = patch; return builder; },
        delete() { mode = 'delete'; return builder; },
        single() {
          const res = resolve();
          return Promise.resolve({ data: (res.list && res.list[0]) || null, error: res.error });
        },
        maybeSingle() { return builder.single(); },
        then(onFulfilled, onRejected) {
          const res = resolve();
          return Promise.resolve({ data: res.data, error: res.error }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}
