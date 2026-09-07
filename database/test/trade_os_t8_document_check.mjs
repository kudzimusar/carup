/**
 * Trade OS T8.1 — the document subject binding, verified on a REAL Postgres (PGlite).
 *
 * A CHECK constraint that has never refused anything is indistinguishable from no constraint, so
 * every rule here is exercised by trying to break it.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260909090000_trade_os_t8_document_subject_binding.sql', import.meta.url), 'utf-8');
const up = sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = sql.split('-- +migrate Down')[1];

const db = new PGlite();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); }
};
const refuses = async (name, stmt, pattern) => check(name, async () => {
  let threw = null;
  try { await db.exec(stmt); } catch (e) { threw = e; }
  if (!threw) throw new Error('the database ACCEPTED what it must refuse');
  if (pattern && !pattern.test(threw.message)) throw new Error(`refused for the wrong reason: ${threw.message.split('\n')[0]}`);
});

// A minimal stand-in for the pre-existing table shape.
await db.exec(`
  CREATE TABLE public.diaspora_trade_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NULL,
    import_order_id uuid NULL,
    uploaded_by text NULL,
    document_type text NOT NULL,
    document_url text NULL,
    storage_path text NULL,
    ocr_document_id text NULL,
    verification_status text NULL,
    reviewed_by text NULL,
    reviewed_at timestamptz NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by text NULL,
    updated_by text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL
  );
  CREATE TABLE public.diaspora_trade_document_readiness (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type text NOT NULL,
    subject_id text NOT NULL
  );
`);
// A legacy procurement row exists BEFORE the migration — the migration must accept it as it is.
await db.exec(`INSERT INTO public.diaspora_trade_documents (import_order_id, document_type) VALUES (gen_random_uuid(), 'commercial_invoice');`);

await check('the migration applies over existing procurement rows', async () => { await db.exec(up); });

await check('the legacy procurement row survived untouched', async () => {
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_trade_documents WHERE import_order_id IS NOT NULL AND subject_type IS NULL;`);
  if (r.rows[0].n !== 1) throw new Error(`expected the legacy row intact, saw ${r.rows[0].n}`);
});

await check('a logistics request may now own a document', async () => {
  await db.exec(`INSERT INTO public.diaspora_trade_documents (subject_type, subject_id, document_type) VALUES ('logistics_request', 'req-1', 'packing_list');`);
});
await check('a container booking may now own a document', async () => {
  await db.exec(`INSERT INTO public.diaspora_trade_documents (subject_type, subject_id, document_type) VALUES ('container_booking', 'sail-1', 'bill_of_lading');`);
});

await refuses('a subject TYPE without an id is refused', 
  `INSERT INTO public.diaspora_trade_documents (subject_type, document_type) VALUES ('logistics_request', 'x');`,
  /subject_pairing|one_owner/);
await refuses('a subject ID without a type is refused',
  `INSERT INTO public.diaspora_trade_documents (subject_id, document_type) VALUES ('req-1', 'x');`,
  /subject_pairing|one_owner/);
await refuses('a blank subject id is refused',
  `INSERT INTO public.diaspora_trade_documents (subject_type, subject_id, document_type) VALUES ('logistics_request', '   ', 'x');`,
  /subject_pairing/);
await refuses('TWO owners are refused — a document belonging to two things belongs to neither',
  `INSERT INTO public.diaspora_trade_documents (import_order_id, subject_type, subject_id, document_type) VALUES (gen_random_uuid(), 'logistics_request', 'req-1', 'x');`,
  /exactly_one_owner/);
await refuses('NO owner is refused — a floating document belongs to no transaction',
  `INSERT INTO public.diaspora_trade_documents (document_type) VALUES ('x');`,
  /exactly_one_owner/);
await refuses('an invented subject kind is refused — no shadow entity by free text',
  `INSERT INTO public.diaspora_trade_documents (subject_type, subject_id, document_type) VALUES ('warehouse_receipt', 'w-1', 'x');`,
  /subject_vocabulary/);

await check('the subject index exists and is partial', async () => {
  const r = await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_trade_documents_subject';`);
  if (!r.rows.length) throw new Error('index missing');
  if (!/WHERE/i.test(r.rows[0].indexdef)) throw new Error('index is not partial');
});

await check('Down is reversible and leaves the legacy rows', async () => {
  await db.exec(down);
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_trade_documents;`);
  if (r.rows[0].n < 1) throw new Error('rows lost on down');
  const c = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='diaspora_trade_documents' AND column_name IN ('subject_type','subject_id');`);
  if (c.rows[0].n !== 0) throw new Error('columns not dropped');
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));

// Close the database and exit EXPLICITLY. Without this the process reported every check green and
// still exited 100 — a gate that says PASS and fails the build is worse than either outcome alone,
// and it was only visible by checking the exit code rather than reading the output.
await db.close();
process.exit(failed.length ? 1 : 0);
