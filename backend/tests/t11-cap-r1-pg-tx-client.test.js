/**
 * T11-CAP-LR01-R1 — the bounded Postgres client the alert certification runs the real notification path through.
 * Rehearsed on a real Postgres engine (PGlite). What matters most here is what it REFUSES: it is the only door the code
 * under test has to the staging database, so its limits are the harness's safety case.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { createPgTxClient } from '../scripts/lib/pgTxServiceClient.mjs'

const WORLDS = []
test.after(async () => { for (const p of WORLDS) await p.close().catch(() => {}) })

async function world(options = {}) {
  const pg = new PGlite()
  WORLDS.push(pg)
  await pg.exec(`
    CREATE TABLE widgets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      tags text[], at timestamptz, amount numeric, n integer, note text);
    CREATE TABLE domain_events_like (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL, status text NOT NULL DEFAULT 'pending');
    CREATE TABLE secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), value text);
    CREATE TABLE readonly_ref (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
    INSERT INTO readonly_ref (name) VALUES ('ref-1');
    INSERT INTO secrets (value) VALUES ('top');
    INSERT INTO domain_events_like (event_type) VALUES ('someone.elses.event');
    CREATE FUNCTION add_one(n integer) RETURNS integer LANGUAGE sql AS $$ SELECT n + 1 $$;
    CREATE FUNCTION two_rows() RETURNS TABLE (a int, b text) LANGUAGE sql AS $$ SELECT 1, 'x' UNION ALL SELECT 2, 'y' $$;
  `)
  const client = createPgTxClient(pg, {
    readTables: ['readonly_ref'], writeTables: ['widgets', 'domain_events_like'], rpcs: ['add_one', 'two_rows'], ...options,
  })
  return { pg, client }
}

// ── The shapes it supports behave like PostgREST ──────────────────────────

test('R1-PG: insert returns the row with defaults; jsonb, arrays, timestamps and numerics come back as the real client returns them', async () => {
  const { client } = await world()
  const { data, error } = await client.from('widgets').insert({ name: 'a', payload: { k: [1, 2, { z: true }] }, tags: ['x', 'y'], at: '2026-10-25T04:16:30.906Z', amount: 12.5, n: 3 }).select().single()
  assert.equal(error, null)
  assert.match(data.id, /^[0-9a-f-]{36}$/)
  assert.deepEqual(data.payload, { k: [1, 2, { z: true }] })
  assert.deepEqual(data.tags, ['x', 'y'])
  assert.equal(data.at, '2026-10-25T04:16:30.906Z', 'a timestamp was not returned as an ISO string')
  assert.equal(data.amount, 12.5)
  assert.equal(typeof data.amount, 'number')
  assert.equal(data.note, null)
})

test('R1-PG: a JSON array stored in a jsonb column stays a JSON array (it is not turned into a Postgres array)', async () => {
  const { client } = await world()
  const { data, error } = await client.from('widgets').insert({ name: 'arr', payload: [1, 2, 3] }).select().single()
  assert.equal(error, null)
  assert.deepEqual(data.payload, [1, 2, 3])
})

test('R1-PG: select with eq / neq / in / is / not / gt / order / limit', async () => {
  const { client } = await world()
  await client.from('widgets').insert([{ name: 'a', n: 1, note: 'x' }, { name: 'b', n: 2 }, { name: 'c', n: 3, note: 'x' }, { name: 'd', n: 4 }])
  const names = async (q) => (await q).data.map((r) => r.name)
  assert.deepEqual(await names(client.from('widgets').select('name').eq('note', 'x').order('name')), ['a', 'c'])
  assert.deepEqual(await names(client.from('widgets').select('name').is('note', null).order('name')), ['b', 'd'])
  assert.deepEqual(await names(client.from('widgets').select('name').not('note', 'is', null).order('name')), ['a', 'c'])
  assert.deepEqual(await names(client.from('widgets').select('name').neq('name', 'a').order('name', { ascending: false }).limit(2)), ['d', 'c'])
  assert.deepEqual(await names(client.from('widgets').select('name').in('name', ['b', 'd']).order('name')), ['b', 'd'])
  assert.deepEqual(await names(client.from('widgets').select('name').gt('n', 2).order('name')), ['c', 'd'])
  assert.deepEqual(await names(client.from('widgets').select('name').in('name', [])), [], 'an empty IN matched something')
  assert.deepEqual(await names(client.from('widgets').select('name').eq('note', null).order('name')), ['b', 'd'], 'eq(null) must mean IS NULL, as the repository relies on')
})

test('R1-PG: single and maybeSingle report the same errors PostgREST does', async () => {
  const { client } = await world()
  await client.from('widgets').insert([{ name: 'a' }, { name: 'b' }])
  assert.equal((await client.from('widgets').select().eq('name', 'a').single()).data.name, 'a')
  const none = await client.from('widgets').select().eq('name', 'zzz').single()
  assert.equal(none.error.code, 'PGRST116')
  const many = await client.from('widgets').select().maybeSingle()
  assert.equal(many.error.code, 'PGRST116')
  const absent = await client.from('widgets').select().eq('name', 'zzz').maybeSingle()
  assert.deepEqual(absent, { data: null, error: null })
})

test('R1-PG: update and delete return the affected rows; upsert updates on conflict or ignores duplicates', async () => {
  const { client } = await world()
  await client.from('widgets').insert({ name: 'a', n: 1 })
  const up = await client.from('widgets').update({ n: 9, payload: { changed: true } }).eq('name', 'a').select().single()
  assert.equal(up.data.n, 9)
  assert.deepEqual(up.data.payload, { changed: true })
  const ups = await client.from('widgets').upsert({ name: 'a', n: 10 }, { onConflict: 'name' }).select().single()
  assert.equal(ups.data.n, 10)
  const ign = await client.from('widgets').upsert({ name: 'a', n: 11 }, { onConflict: 'name', ignoreDuplicates: true }).select()
  assert.deepEqual(ign.data, [], 'ignoreDuplicates returned a row')
  assert.equal((await client.from('widgets').select().eq('name', 'a').single()).data.n, 10)
  const del = await client.from('widgets').delete().eq('name', 'a').select('id')
  assert.equal(del.data.length, 1)
})

test('R1-PG: a database error is returned as { error }, not thrown, with the code the code under test inspects', async () => {
  const { client } = await world()
  await client.from('widgets').insert({ name: 'dup' })
  const r = await client.from('widgets').insert({ name: 'dup' }).select().single()
  assert.equal(r.data, null)
  assert.equal(r.error.code, '23505')
})

test('R1-PG: a named rpc returns its scalar or its rows', async () => {
  const { client } = await world()
  assert.deepEqual(await client.rpc('add_one', { n: 41 }), { data: 42, error: null })
  const r = await client.rpc('two_rows', {})
  assert.deepEqual(r.data, [{ a: 1, b: 'x' }, { a: 2, b: 'y' }])
})

// ── What it refuses ───────────────────────────────────────────────────────

test('R1-PG: it refuses a table that was not named — to read or to write — before sending anything', async () => {
  const { pg, client } = await world()
  await assert.rejects(async () => await client.from('secrets').select(), /REFUSED/)
  await assert.rejects(async () => await client.from('secrets').insert({ value: 'x' }), /REFUSED/)
  await assert.rejects(async () => await client.from('readonly_ref').insert({ name: 'x' }), /REFUSED/, 'a read-only table accepted a write')
  await assert.rejects(async () => await client.from('readonly_ref').update({ name: 'x' }).eq('name', 'ref-1'), /REFUSED/)
  await assert.rejects(async () => await client.from('readonly_ref').delete(), /REFUSED/)
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM secrets')).rows[0].n, 1)
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM readonly_ref WHERE name = 'ref-1'")).rows[0].n, 1)
  assert.ok(client.statements.every((s) => s.table !== 'secrets'), 'a statement against an unnamed table was recorded as sent')
  // …and a named read-only table IS readable.
  assert.equal((await client.from('readonly_ref').select().single()).data.name, 'ref-1')
})

test('R1-PG: it refuses a call shape it does not implement rather than guessing', async () => {
  const { client } = await world()
  await assert.rejects(async () => await client.from('widgets').select('id, other(*)'), /unsupported select projection/)
  await assert.rejects(async () => await client.from('widgets').select().not('note', 'like', '%x%'), /unsupported not/)
  await assert.rejects(async () => await client.from('widgets').upsert({ name: 'a' }), /unsupported upsert without onConflict/)
  await assert.rejects(async () => await client.from('widgets').select().eq('no_such_column', 1), /unknown column/)
  await assert.rejects(async () => await client.from('widgets; DROP TABLE widgets').select(), /unsafe identifier/)
  await assert.rejects(async () => await client.from('widgets').select('name; DROP TABLE widgets'), /unknown column|unsafe/)
  await assert.rejects(async () => await client.rpc('drop_everything', {}), /REFUSED/)
  await assert.rejects(async () => await client.rpc('add_one', { 'n; DROP TABLE widgets': 1 }), /unsafe identifier/)
})

test('R1-PG: data is only ever a bound parameter — a hostile value is stored, not executed', async () => {
  const { pg, client } = await world()
  const hostile = "x'); DROP TABLE widgets; --"
  const r = await client.from('widgets').insert({ name: hostile, note: hostile }).select().single()
  assert.equal(r.error, null)
  assert.equal(r.data.name, hostile)
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM widgets')).rows[0].n, 1)
  const found = await client.from('widgets').select().eq('name', hostile).single()
  assert.equal(found.data.note, hostile)
})

test('R1-PG: an UPDATE or DELETE on an own-only table can reach only rows this run created — a pre-existing row is never touched', async () => {
  const { pg, client } = await world()
  client.ownOnly('domain_events_like')
  // someone else's row already exists
  const mine = await client.from('domain_events_like').insert({ event_type: 'my.event' }).select().single()
  // an unrestricted-looking update by status would, without the guard, flip BOTH rows
  const updated = await client.from('domain_events_like').update({ status: 'processed' }).eq('status', 'pending').select()
  assert.deepEqual(updated.data.map((r) => r.event_type), ['my.event'], 'the update reached a row this run did not create')
  assert.equal((await pg.query("SELECT status FROM domain_events_like WHERE event_type = 'someone.elses.event'")).rows[0].status, 'pending')
  const deleted = await client.from('domain_events_like').delete().eq('status', 'processed').select('id')
  assert.deepEqual(deleted.data.map((r) => r.id), [mine.data.id])
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM domain_events_like WHERE event_type = 'someone.elses.event'")).rows[0].n, 1, 'someone else\'s row was deleted')
})

test('R1-PG: every statement is recorded, and the ids of the rows it inserted are remembered', async () => {
  const { client } = await world()
  const a = await client.from('widgets').insert({ name: 'a' }).select().single()
  await client.from('widgets').select().eq('name', 'a')
  await client.from('widgets').update({ n: 1 }).eq('name', 'a')
  assert.deepEqual(client.statements.map((s) => `${s.op}:${s.table}:${s.rows}`), ['insert:widgets:1', 'select:widgets:1', 'update:widgets:1'])
  assert.ok(client.created.get('widgets').has(a.data.id))
})

test('R1-PG: a JSON value bound for a jsonb column is sent as JSON text — node-pg would otherwise turn an array into a Postgres array literal', async () => {
  // PGlite is forgiving about this; the real driver is not. A recording stand-in sees exactly what would be sent.
  const sent = []
  const fake = {
    async query(sql, params) {
      sent.push({ sql, params })
      if (/information_schema/.test(sql)) return { rows: [{ column_name: 'id', data_type: 'uuid' }, { column_name: 'payload', data_type: 'jsonb' }, { column_name: 'tags', data_type: 'ARRAY' }] }
      return { rows: [{ id: '00000000-0000-4000-8000-000000000001' }] }
    },
  }
  const client = createPgTxClient(fake, { writeTables: ['widgets'] })
  await client.from('widgets').insert({ payload: [1, 2, 3], tags: ['a', 'b'] }).select()
  const insert = sent.find((x) => /INSERT INTO/.test(x.sql))
  assert.equal(insert.params[0], '[1,2,3]', 'a JSON array was handed to the driver as a JS array')
  assert.deepEqual(insert.params[1], ['a', 'b'], 'a real Postgres array column must stay an array')
  assert.match(insert.sql, /\$1::jsonb/)
})
