/**
 * Trade OS T8.4 — document versioning, on a REAL Postgres (PGlite).
 *
 * The question an audit actually asks is "what did we hold at the time?". Every rule below is
 * exercised by trying to break it, because a constraint that has never refused anything is
 * indistinguishable from no constraint.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const base = readFileSync(new URL('../migrations/20260909090000_trade_os_t8_document_subject_binding.sql', import.meta.url), 'utf-8');
const vers = readFileSync(new URL('../migrations/20260910090000_trade_os_t8_document_versioning.sql', import.meta.url), 'utf-8');
const upOf = (sql) => sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const downOf = (sql) => sql.split('-- +migrate Down')[1];

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
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL, subject_id text NOT NULL
  );
`);
await check('both T8 migrations apply in order', async () => { await db.exec(upOf(base)); await db.exec(upOf(vers)); });

// V1, verified.
await db.exec(`INSERT INTO public.diaspora_trade_documents (id, subject_type, subject_id, document_type, verification_status, reviewed_by, uploaded_by)
  VALUES ('11111111-1111-1111-1111-111111111111','logistics_request','req-1','commercial_invoice','VERIFIED','reviewer-1','uploader-1');`);

await check('an original is version 1 and current', async () => {
  const r = await db.query(`SELECT version, superseded_at FROM public.diaspora_trade_documents WHERE id='11111111-1111-1111-1111-111111111111';`);
  if (r.rows[0].version !== 1) throw new Error(`version ${r.rows[0].version}`);
  if (r.rows[0].superseded_at !== null) throw new Error('an original must start current');
});

// V2 replaces it.
await db.exec(`INSERT INTO public.diaspora_trade_documents (id, subject_type, subject_id, document_type, verification_status, uploaded_by, version, supersedes_document_id)
  VALUES ('22222222-2222-2222-2222-222222222222','logistics_request','req-1','commercial_invoice','UPLOADED','uploader-2',2,'11111111-1111-1111-1111-111111111111');`);
await db.exec(`UPDATE public.diaspora_trade_documents SET superseded_at = now(), superseded_by='uploader-2' WHERE id='11111111-1111-1111-1111-111111111111';`);

await check('V1 SURVIVES replacement, with its verdict and attribution intact', async () => {
  const r = await db.query(`SELECT verification_status, reviewed_by, uploaded_by, superseded_at, superseded_by FROM public.diaspora_trade_documents WHERE id='11111111-1111-1111-1111-111111111111';`);
  const v1 = r.rows[0];
  if (!v1) throw new Error('V1 was destroyed');
  if (v1.verification_status !== 'VERIFIED') throw new Error('V1 lost its verdict');
  if (v1.reviewed_by !== 'reviewer-1') throw new Error('V1 lost its reviewer');
  if (v1.uploaded_by !== 'uploader-1') throw new Error('V1 lost its uploader');
  if (!v1.superseded_at) throw new Error('V1 is not marked superseded');
  if (v1.superseded_by !== 'uploader-2') throw new Error('who replaced it was not recorded');
});

await check('V2 does NOT inherit the verdict — a new file is a new claim', async () => {
  const r = await db.query(`SELECT verification_status, version FROM public.diaspora_trade_documents WHERE id='22222222-2222-2222-2222-222222222222';`);
  if (r.rows[0].verification_status !== 'UPLOADED') throw new Error(`V2 is ${r.rows[0].verification_status}`);
  if (r.rows[0].version !== 2) throw new Error('version did not advance');
});

await check('exactly one CURRENT document remains for the transaction', async () => {
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_trade_documents WHERE subject_id='req-1' AND superseded_at IS NULL AND deleted_at IS NULL;`);
  if (r.rows[0].n !== 1) throw new Error(`${r.rows[0].n} current documents`);
});

await refuses('a CONCURRENT second replacement of the same version is refused',
  `INSERT INTO public.diaspora_trade_documents (subject_type, subject_id, document_type, version, supersedes_document_id)
   VALUES ('logistics_request','req-1','commercial_invoice',2,'11111111-1111-1111-1111-111111111111');`,
  /uq_trade_document_single_successor|duplicate key/);

await refuses('a document cannot supersede itself',
  `INSERT INTO public.diaspora_trade_documents (id, subject_type, subject_id, document_type, supersedes_document_id)
   VALUES ('33333333-3333-3333-3333-333333333333','logistics_request','req-1','commercial_invoice','33333333-3333-3333-3333-333333333333');`,
  /no_self_supersede/);

await refuses('version zero is refused',
  `INSERT INTO public.diaspora_trade_documents (subject_type, subject_id, document_type, version)
   VALUES ('logistics_request','req-9','commercial_invoice',0);`,
  /version_positive/);

await refuses('"replaced by somebody at no particular time" is refused',
  `INSERT INTO public.diaspora_trade_documents (subject_type, subject_id, document_type, superseded_by)
   VALUES ('logistics_request','req-9','commercial_invoice','someone');`,
  /supersession_dated/);

await check('the lineage is walkable backwards from the current version', async () => {
  const r = await db.query(`
    WITH RECURSIVE chain AS (
      SELECT id, version, supersedes_document_id FROM public.diaspora_trade_documents WHERE id='22222222-2222-2222-2222-222222222222'
      UNION ALL
      SELECT d.id, d.version, d.supersedes_document_id FROM public.diaspora_trade_documents d JOIN chain c ON d.id = c.supersedes_document_id
    ) SELECT count(*)::int AS n FROM chain;`);
  if (r.rows[0].n !== 2) throw new Error(`lineage length ${r.rows[0].n}, expected 2`);
});

await check('Down is reversible and destroys no rows', async () => {
  await db.exec(downOf(vers));
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_trade_documents;`);
  if (r.rows[0].n < 2) throw new Error('rows lost on down');
  const c = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='diaspora_trade_documents' AND column_name IN ('version','supersedes_document_id','superseded_at','superseded_by');`);
  if (c.rows[0].n !== 0) throw new Error('columns not dropped');
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));
await db.close();
process.exit(failed.length ? 1 : 0);
