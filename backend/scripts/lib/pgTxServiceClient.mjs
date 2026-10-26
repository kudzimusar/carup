/**
 * A supabase-js-shaped client over a `pg` connection, built for ONE job: running the real notification path against the real
 * staging schema INSIDE a transaction the caller rolls back.
 *
 * It is deliberately small and deliberately strict, in the way `backend/tests/helpers/pgliteSupabaseClient.js` is:
 *
 *   · it supports exactly the query shapes the code under test makes — from().select/insert/upsert/update/delete with
 *     eq/neq/gt/gte/lt/lte/in/is/not/order/limit and single/maybeSingle, plus a named, allow-listed rpc — and THROWS on
 *     anything else, so a new call shape cannot silently pass through;
 *   · every table it will read and every table it will write is named by the caller; a statement against any other table
 *     throws before it is sent;
 *   · every statement is recorded (verb, table, rows), and the ids of every row it inserts are remembered, so the caller can
 *     prove what the run touched and that an UPDATE/DELETE reached only rows the run itself created;
 *   · values are always bound parameters; identifiers are validated; there is no string concatenation of data.
 *
 * Like the real client it returns `{ data, error }` for database errors rather than throwing them. Timestamps come back as
 * ISO strings and numeric/bigint as numbers, the way PostgREST returns them, because the code under test compares both.
 */
const IDENT = /^[a-z_][a-z0-9_]*$/i
const ident = (name) => { if (!IDENT.test(name)) throw new Error(`unsafe identifier ${JSON.stringify(name)}`); return name }

const toError = (e) => ({ code: e?.code ?? 'P0001', message: String(e?.message ?? e), details: e?.detail ?? null, hint: e?.hint ?? null })

export function createPgTxClient(pg, { readTables = [], writeTables = [], rpcs = [], tenantSchema = 'public' } = {}) {
  const readable = new Set([...readTables, ...writeTables])
  const writable = new Set(writeTables)
  const rpcAllowed = new Set(rpcs)
  const statements = []
  const created = new Map() // table -> Set(id)
  const columnCache = new Map()

  const columnsOf = async (table) => {
    if (!columnCache.has(table)) {
      const { rows } = await pg.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        [tenantSchema, table],
      )
      if (!rows.length) throw new Error(`table ${table} has no columns visible in schema ${tenantSchema}`)
      columnCache.set(table, Object.fromEntries(rows.map((r) => [r.column_name, r.data_type])))
    }
    return columnCache.get(table)
  }

  const bindValue = (type, value) => {
    if (value === undefined) return null
    if (value === null) return null
    if (type === 'json' || type === 'jsonb') return JSON.stringify(value)
    return value
  }
  const cast = (type) => (type === 'jsonb' ? '::jsonb' : type === 'json' ? '::json' : '')

  const shapeRow = (row, types) => {
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      const t = types[k]
      if (v instanceof Date) out[k] = v.toISOString()
      else if ((t === 'numeric' || t === 'bigint') && typeof v === 'string') out[k] = Number(v)
      else out[k] = v
    }
    return out
  }

  class Query {
    constructor(table) {
      this.table = ident(table)
      this.op = 'select'
      this.cols = '*'
      this.returning = null
      this.filters = []
      this.orders = []
      this.limitN = null
      this.rowsIn = null
      this.patch = null
      this.upsertOpts = null
      this.mode = 'many'
    }

    select(cols = '*') {
      if (this.op === 'select') this.cols = cols
      else this.returning = cols
      return this
    }
    insert(rows) { this.op = 'insert'; this.rowsIn = Array.isArray(rows) ? rows : [rows]; return this }
    upsert(rows, opts = {}) { this.op = 'upsert'; this.rowsIn = Array.isArray(rows) ? rows : [rows]; this.upsertOpts = opts; return this }
    update(patch) { this.op = 'update'; this.patch = patch; return this }
    delete() { this.op = 'delete'; return this }

    eq(c, v) { this.filters.push({ c, k: 'eq', v }); return this }
    neq(c, v) { this.filters.push({ c, k: 'neq', v }); return this }
    gt(c, v) { this.filters.push({ c, k: 'gt', v }); return this }
    gte(c, v) { this.filters.push({ c, k: 'gte', v }); return this }
    lt(c, v) { this.filters.push({ c, k: 'lt', v }); return this }
    lte(c, v) { this.filters.push({ c, k: 'lte', v }); return this }
    in(c, v) { this.filters.push({ c, k: 'in', v }); return this }
    is(c, v) { this.filters.push({ c, k: 'is', v }); return this }
    not(c, op, v) { this.filters.push({ c, k: 'not', op, v }); return this }
    order(c, { ascending = true } = {}) { this.orders.push({ c, ascending }); return this }
    limit(n) { this.limitN = n; return this }
    single() { this.mode = 'single'; return this }
    maybeSingle() { this.mode = 'maybe'; return this }
    abortSignal() { return this }
    then(resolve, reject) { return this.exec().then(resolve, reject) }

    async exec() {
      const table = this.table
      const isWrite = this.op !== 'select'
      if (isWrite ? !writable.has(table) : !readable.has(table)) {
        throw new Error(`REFUSED: ${this.op} on ${table} is not permitted in this run`)
      }
      let types
      try { types = await columnsOf(table) } catch (e) { return { data: null, error: toError(e) } }
      const params = []
      const bind = (v) => { params.push(v); return `$${params.length}` }
      const col = (c) => { ident(c); if (!(c in types)) throw new Error(`unknown column ${table}.${c}`); return `"${c}"` }

      const where = () => {
        const parts = this.filters.map((f) => {
          const c = col(f.c)
          switch (f.k) {
            case 'eq': return f.v === null ? `${c} IS NULL` : `${c} = ${bind(bindValue(types[f.c], f.v))}${cast(types[f.c])}`
            case 'neq': return f.v === null ? `${c} IS NOT NULL` : `${c} <> ${bind(bindValue(types[f.c], f.v))}${cast(types[f.c])}`
            case 'gt': return `${c} > ${bind(f.v)}`
            case 'gte': return `${c} >= ${bind(f.v)}`
            case 'lt': return `${c} < ${bind(f.v)}`
            case 'lte': return `${c} <= ${bind(f.v)}`
            case 'in': return Array.isArray(f.v) && f.v.length ? `${c} = ANY(${bind(f.v)})` : 'FALSE'
            case 'is': return f.v === null ? `${c} IS NULL` : (f.v === true ? `${c} IS TRUE` : f.v === false ? `${c} IS FALSE` : (() => { throw new Error(`unsupported is(${f.v})`) })())
            case 'not':
              if (f.op === 'is' && f.v === null) return `${c} IS NOT NULL`
              if (f.op === 'eq') return `${c} <> ${bind(f.v)}`
              throw new Error(`unsupported not(${f.c}, ${f.op})`)
            default: throw new Error(`unsupported filter ${f.k}`)
          }
        })
        // On an own-only table an UPDATE/DELETE can only ever reach rows this run created: the restriction is part of the
        // statement, so a foreign row is never touched — not "touched and then reported".
        if ((this.op === 'update' || this.op === 'delete') && writeOwnOnly.has(table)) {
          if (!('id' in types)) throw new Error(`REFUSED: ${table} has no id column to restrict an own-only ${this.op}`)
          parts.push(`"id"::text = ANY(${bind([...(created.get(table) || [])])})`)
        }
        return parts.length ? ` WHERE ${parts.join(' AND ')}` : ''
      }
      const projection = (c) => {
        if (!c || c === '*') return '*'
        if (/[()!:]/.test(c)) throw new Error(`unsupported select projection ${JSON.stringify(c)} (no embedding)`)
        return c.split(',').map((x) => col(x.trim())).join(', ')
      }

      let sql
      try {
        if (this.op === 'select') {
          sql = `SELECT ${projection(this.cols)} FROM public.${table}${where()}`
          if (this.orders.length) sql += ` ORDER BY ${this.orders.map((o) => `${col(o.c)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')}`
          if (this.limitN != null) sql += ` LIMIT ${Number.parseInt(this.limitN, 10)}`
        } else if (this.op === 'insert' || this.op === 'upsert') {
          const keys = [...new Set(this.rowsIn.flatMap((r) => Object.keys(r)))]
          const tuples = this.rowsIn.map((r) => `(${keys.map((k) => `${bind(bindValue(types[k], r[k]))}${cast(types[k])}`).join(', ')})`)
          sql = `INSERT INTO public.${table} (${keys.map(col).join(', ')}) VALUES ${tuples.join(', ')}`
          if (this.op === 'upsert') {
            const target = this.upsertOpts.onConflict
            if (!target) throw new Error('unsupported upsert without onConflict')
            const targets = target.split(',').map((x) => col(x.trim()))
            if (this.upsertOpts.ignoreDuplicates) sql += ` ON CONFLICT (${targets.join(', ')}) DO NOTHING`
            else sql += ` ON CONFLICT (${targets.join(', ')}) DO UPDATE SET ${keys.filter((k) => !target.split(',').map((x) => x.trim()).includes(k)).map((k) => `${col(k)} = EXCLUDED.${col(k)}`).join(', ')}`
          }
          sql += ` RETURNING ${projection(this.returning || '*')}`
        } else if (this.op === 'update') {
          const keys = Object.keys(this.patch)
          const sets = keys.map((k) => `${col(k)} = ${bind(bindValue(types[k], this.patch[k]))}${cast(types[k])}`)
          sql = `UPDATE public.${table} SET ${sets.join(', ')}${where()} RETURNING ${projection(this.returning || '*')}`
        } else if (this.op === 'delete') {
          sql = `DELETE FROM public.${table}${where()} RETURNING ${projection(this.returning || '*')}`
        } else throw new Error(`unsupported operation ${this.op}`)
      } catch (e) {
        if (String(e.message).startsWith('unsupported') || String(e.message).startsWith('unknown column') || String(e.message).startsWith('unsafe')) throw e
        return { data: null, error: toError(e) }
      }

      let result
      try { result = await pg.query(sql, params) } catch (e) {
        statements.push({ op: this.op, table, error: e.code || 'ERR' })
        return { data: null, error: toError(e) }
      }
      const rows = result.rows.map((r) => shapeRow(r, types))
      statements.push({ op: this.op, table, rows: rows.length })
      if (this.op === 'insert' || this.op === 'upsert') {
        for (const r of rows) if (r.id !== undefined) { if (!created.has(table)) created.set(table, new Set()); created.get(table).add(String(r.id)) }
      }
      if (this.mode === 'single') {
        if (rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null } }
        return { data: rows[0], error: null }
      }
      if (this.mode === 'maybe') {
        if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null } }
        return { data: rows[0] ?? null, error: null }
      }
      return { data: rows, error: null }
    }
  }

  // Tables where an UPDATE/DELETE must reach only rows this run created. The caller chooses; domain_events is always one.
  const writeOwnOnly = new Set(['domain_events'])

  return {
    statements,
    created,
    ownOnly(...tables) { tables.forEach((t) => writeOwnOnly.add(t)) },
    from(table) { return new Query(table) },
    async rpc(name, params = {}) {
      if (!rpcAllowed.has(name)) throw new Error(`REFUSED: rpc ${name} is not permitted in this run`)
      ident(name)
      const keys = Object.keys(params)
      const args = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')
      try {
        const r = await pg.query(`SELECT * FROM public.${name}(${args})`, keys.map((k) => params[k]))
        statements.push({ op: 'rpc', table: name, rows: r.rows.length })
        const shaped = r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])))
        if (shaped.length === 1 && Object.keys(shaped[0]).length === 1 && Object.keys(shaped[0])[0] === name) return { data: shaped[0][name], error: null }
        return { data: shaped, error: null }
      } catch (e) { statements.push({ op: 'rpc', table: name, error: e.code || 'ERR' }); return { data: null, error: toError(e) } }
    },
  }
}
