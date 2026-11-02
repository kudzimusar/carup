/**
 * OCR 1.0-C3 — the Garage evidence migrations, verified by EXECUTING them on real PostgreSQL (PGlite).
 *
 * ci.yml warns that migration_pglite_check.mjs's NEW_MIGRATIONS list ends at 20260810120000, so the
 * C3 migrations (20260918090000/100000/110000) and the lineage reconciliation (20261003100000) are
 * executed by NO other gate. Four things need a real database and cannot be shown any other way:
 *
 *   1. LINEAGE. #209 and C3 both CREATE TABLE IF NOT EXISTS the same tables; only C3's shape has
 *      `extraction_model`. With #209's shape first, C3's create is a silent no-op and the column is
 *      missing — the reconciliation migration must restore it. Proven by building #209's shape
 *      (C3's file minus that one column, the only structural difference) and then applying C3.
 *   2. COHERENCE CHECKS. The table's own constraints must accept every write the C3 consumer makes
 *      — including a reading whose provider reported NO confidence (NULL, never 0) — and refuse the
 *      incoherent ones (stale candidates on a failed run, an `unavailable` row with a timestamp).
 *   3. ACCESS. Browser roles (anon, authenticated) get no direct access; service_role does.
 *   4. IDEMPOTENCE. Every C3 migration and the reconciliation can be re-applied on either lineage.
 *
 * Run:  node database/test/ocr_c3_garage_evidence_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const C3_APPLICATIONS = '20260918090000_ocr_c3_garage_applications.sql';
const C3_EVIDENCE = '20260918100000_ocr_c3_garage_application_evidence.sql';
const C3_RLS = '20260918110000_ocr_c3_garage_onboarding_rls.sql';
const RECONCILE = '20261003100000_ocr_c3_garage_evidence_lineage_reconciliation.sql';

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
};
const sectionOf = (file, section) => {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const down = raw.indexOf('-- +migrate Down');
  return section === 'up'
    ? (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '')
    : (down >= 0 ? raw.slice(down) : '').replace('-- +migrate Down', '');
};
const attempt = async (db, label, sql) => {
  try { await db.exec(sql); return record(label, true); }
  catch (e) { return record(label, false, String(e.message || e).slice(0, 200)); }
};
const refuse = async (db, label, sql, pattern) => {
  try { await db.exec(sql); return record(label, false, 'statement was accepted'); }
  catch (e) { return record(label, pattern.test(String(e.message)), String(e.message).slice(0, 160)); }
};

const USER_A = 'garage-applicant-a';
const APP_A = '11111111-1111-4111-8111-111111111111';

async function freshDatabase() {
  const db = new PGlite();
  // No CREATE EXTENSION: gen_random_uuid() is core since PostgreSQL 13.
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    -- Minimal stand-ins for the two referenced authorities: only the key the foreign keys point at.
    CREATE TABLE public.users (id TEXT PRIMARY KEY);
    CREATE TABLE public.tenants (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    INSERT INTO public.users (id) VALUES ('${USER_A}');
  `);
  return db;
}

const hasColumn = async (db, table, column) => {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]);
  return rows.length === 1;
};

// ── Lineage A: C3 only ──────────────────────────────────────────────────────────────────────────
{
  const db = await freshDatabase();
  await attempt(db, '[C3 lineage] applications Up applies', sectionOf(C3_APPLICATIONS, 'up'));
  await attempt(db, '[C3 lineage] evidence Up applies', sectionOf(C3_EVIDENCE, 'up'));
  await attempt(db, '[C3 lineage] RLS Up applies', sectionOf(C3_RLS, 'up'));
  await attempt(db, '[C3 lineage] reconciliation Up applies', sectionOf(RECONCILE, 'up'));
  record('[C3 lineage] extraction_model exists', await hasColumn(db, 'garage_application_documents', 'extraction_model'));
  await attempt(db, '[C3 lineage] every migration re-applies (idempotent)',
    [C3_APPLICATIONS, C3_EVIDENCE, C3_RLS, RECONCILE].map((f) => sectionOf(f, 'up')).join('\n'));
  await attempt(db, '[C3 lineage] reconciliation Down is a safe no-op', sectionOf(RECONCILE, 'down'));
  record('[C3 lineage] Down leaves the consumer column in place',
    await hasColumn(db, 'garage_application_documents', 'extraction_model'));

  // ── Coherence: every write shape the C3 consumer makes ──
  await db.exec(`INSERT INTO public.garage_applications (id, applicant_user_id, status) VALUES ('${APP_A}', '${USER_A}', 'draft');`);
  const doc = (n) => `'aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}'`;
  const base = (n, extra) => `INSERT INTO public.garage_application_documents
      (id, application_id, uploaded_by_user_id, evidence_type, file_ref, mime_type, size_bytes ${extra.cols})
      VALUES (${doc(n)}, '${APP_A}', '${USER_A}', '${extra.type || 'utility_bill'}', 'garage-onboarding/${APP_A}/f-${n}.png', 'image/png', 10 ${extra.vals});`;

  await attempt(db, '[coherence] not_attempted on upload', base(1, { cols: '', vals: '' }));
  await attempt(db, '[coherence] signage photo starts unavailable with a note, no timestamp',
    base(2, { type: 'signage_photo', cols: ', extraction_state, extraction_note', vals: ", 'unavailable', 'There is no text to read on this kind of evidence.'" }));
  await attempt(db, '[coherence] awaiting_confirmation with NO reported confidence (NULL, never 0)',
    base(3, { cols: ', extraction_state, extraction_candidates, extraction_provider, extraction_model, extraction_confidence, extracted_at',
      vals: `, 'awaiting_confirmation', '{"trading_name":{"state":"machine_candidate","value":"Mbare Motors"}}'::jsonb, 'cloudflare', '@cf/qwen/qwen3.8-27b', NULL, now()` }));
  await attempt(db, '[coherence] low_confidence carries the provider-reported number',
    base(4, { cols: ', extraction_state, extraction_candidates, extraction_provider, extraction_model, extraction_confidence, extracted_at',
      vals: `, 'low_confidence', '{"address_line":{"state":"machine_candidate","value":"Stand 4"}}'::jsonb, 'cloudflare', '@cf/qwen/qwen3.8-27b', 0.41, now()` }));
  await attempt(db, '[coherence] failed with no candidates and no invented provenance',
    base(5, { cols: ', extraction_state, extraction_provider, extraction_model, extracted_at', vals: ", 'failed', NULL, NULL, now()" }));

  // A failed RE-RUN must clear an earlier reading — the database refuses the stale combination,
  // which is why the consumer clears candidates on every failed exit.
  await refuse(db, '[coherence] failed run cannot keep stale candidates',
    `UPDATE public.garage_application_documents SET extraction_state='failed', extracted_at=now() WHERE id=${doc(3)};`,
    /check constraint|violates/i);
  await attempt(db, '[coherence] failed re-run that clears the reading is accepted',
    `UPDATE public.garage_application_documents
        SET extraction_state='failed', extraction_candidates=NULL, extraction_confidence=NULL,
            extraction_provider='cloudflare', extraction_model=NULL, extracted_at=now()
      WHERE id=${doc(3)};`);
  await refuse(db, '[coherence] unavailable cannot carry an extraction timestamp',
    base(6, { cols: ', extraction_state, extracted_at', vals: ", 'unavailable', now()" }), /check constraint|violates/i);
  await refuse(db, '[coherence] confidence outside 0..1 is refused',
    base(7, { cols: ', extraction_state, extraction_candidates, extraction_confidence, extracted_at',
      vals: `, 'awaiting_confirmation', '{}'::jsonb, 1.5, now()` }), /check constraint|violates|overflow/i);
  await refuse(db, '[coherence] an unknown extraction state is refused',
    base(8, { cols: ', extraction_state', vals: ", 'verified'" }), /check constraint|violates/i);

  // ── Access: no browser role reaches the tables directly ──
  for (const table of ['garage_applications', 'garage_application_decisions', 'garage_application_documents']) {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query(
        `SELECT has_table_privilege($1, $2, 'SELECT') OR has_table_privilege($1, $2, 'INSERT')
             OR has_table_privilege($1, $2, 'UPDATE') OR has_table_privilege($1, $2, 'DELETE') AS any`,
        [role, `public.${table}`]);
      record(`[access] ${role} has no direct privilege on ${table}`, rows[0].any === false);
    }
    const { rows: svc } = await db.query(`SELECT has_table_privilege('service_role', $1, 'SELECT') AS ok`, [`public.${table}`]);
    record(`[access] service_role keeps access to ${table}`, svc[0].ok === true);
    const { rows: rls } = await db.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`]);
    record(`[access] ${table} has RLS enabled AND forced`, rls[0].relrowsecurity === true && rls[0].relforcerowsecurity === true);
  }
  await db.close();
}

// ── Lineage B: #209's shape first (the staging case) ──────────────────────────────────────────────
{
  const db = await freshDatabase();
  // #209's 20260906120000 differs from C3's 20260918100000 structurally by exactly one column:
  // `extraction_model`. Building #209's shape from C3's own file keeps this gate inside the tree.
  const p209Evidence = sectionOf(C3_EVIDENCE, 'up').replace(/^\s*extraction_model TEXT,\s*$/m, '');
  record('[#209 lineage] the #209 shape really lacks extraction_model', !/extraction_model/.test(p209Evidence));
  await attempt(db, '[#209 lineage] #209-shaped tables apply first',
    `${sectionOf(C3_APPLICATIONS, 'up')}\n${p209Evidence}`);
  await attempt(db, '[#209 lineage] C3 migrations then apply without error',
    [C3_APPLICATIONS, C3_EVIDENCE, C3_RLS].map((f) => sectionOf(f, 'up')).join('\n'));
  record('[#209 lineage] DEFECT REPRODUCED: C3 alone leaves extraction_model missing',
    (await hasColumn(db, 'garage_application_documents', 'extraction_model')) === false);
  await attempt(db, '[#209 lineage] reconciliation Up applies', sectionOf(RECONCILE, 'up'));
  record('[#209 lineage] reconciliation restores extraction_model',
    await hasColumn(db, 'garage_application_documents', 'extraction_model'));
  await db.exec(`INSERT INTO public.garage_applications (id, applicant_user_id, status) VALUES ('${APP_A}', '${USER_A}', 'draft');`);
  await attempt(db, '[#209 lineage] a C3 extraction write now succeeds',
    `INSERT INTO public.garage_application_documents
       (application_id, uploaded_by_user_id, evidence_type, file_ref, mime_type, size_bytes,
        extraction_state, extraction_provider, extraction_model, extracted_at)
     VALUES ('${APP_A}', '${USER_A}', 'utility_bill', 'garage-onboarding/x.png', 'image/png', 10,
        'failed', 'cloudflare', NULL, now());`);
  await attempt(db, '[#209 lineage] reconciliation re-applies (idempotent)', sectionOf(RECONCILE, 'up'));
  await db.close();
}

console.log(JSON.stringify(results, null, 2));
process.exit(results.ok ? 0 : 1);
