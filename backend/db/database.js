/**
 * Legacy local SQLite migration harness.
 *
 * This file is NOT a CarUp business-data authority and must never seed users, vehicles, Trust,
 * registry, finance, insurance, organization, ledger or provider facts. It exists only so the
 * historical local SQLite migration runner can open its private carup.db file.
 *
 * Canonical application/runtime data lives in Supabase/PostgreSQL. Tests that need fixtures must
 * create them inside their own isolated harnesses.
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'carup.db');

let db = null;

export async function getDb() {
  if (db) return db;

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/**
 * Initialise only the local migration harness. No synthetic application records are inserted.
 */
export async function initDb() {
  await getDb();
  await runMigrations('up');
}
