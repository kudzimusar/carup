/**
 * OC-5R-PC01-H — the CLEAN-SOURCE catalog of the seven converged definitions.
 *
 * "Clean source" is this lineage applied to an empty PostgreSQL (PGlite): the Supabase API roles, the minimum
 * prerequisite tables the three migrations require, then those migrations' own Up sections. The convergence
 * transaction compares what it produced on staging with this, object by object, and refuses to commit — or, on
 * a dry run, reports — any difference. One builder serves the CLI and the rehearsal tests, so there is exactly
 * one definition of "clean".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { parseMigrationSource } from '../../../backend/db/migrationParser.js';
import { prepareUpSql } from './stagingMigrationRunner.mjs';
import { SOURCES, CONVERGED_CATALOG_SQL } from './pc01StagingDefinitionConvergence.mjs';

const upOf = (migrationsDir, file) => prepareUpSql(parseMigrationSource(readFileSync(path.join(migrationsDir, file), 'utf8'), file).up, file).sql;

/** An empty PostgreSQL with exactly this lineage's definitions of the converged objects. The caller closes it. */
export async function buildCleanSourceDb(migrationsDir) {
  const db = new PGlite();
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE public.users (id text PRIMARY KEY);
    CREATE TABLE public.dealer_profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.garage_applications (id uuid PRIMARY KEY);
    CREATE TABLE public.tenants (id uuid PRIMARY KEY);
    CREATE TABLE public.tenant_users (id uuid PRIMARY KEY);
    -- the column D5 is about, exactly as ${SOURCES.receipts} defines it
    CREATE TABLE public.diaspora_workbook_import_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL);
  `);
  for (const file of [SOURCES.identity, SOURCES.confirmations, SOURCES.activation]) await db.exec(upOf(migrationsDir, file));
  return db;
}

/** The clean-source catalog of the converged objects. */
export async function cleanSourceCatalog(migrationsDir) {
  const db = await buildCleanSourceDb(migrationsDir);
  try {
    return JSON.parse((await db.query(CONVERGED_CATALOG_SQL)).rows[0].catalog);
  } finally {
    await db.close().catch(() => {});
  }
}
