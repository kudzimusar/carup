import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';
import { applyTestDatabaseContainment, guardedDotfileValues } from './testDatabaseContainment.js';

// This `dotenv.config()` is the inheritance vector for the whole backend test suite: nearly every
// test reaches this module through a static import chain, so a developer machine's generic `.env` —
// which for a CarUp maintainer is the PRODUCTION environment file — lands in `process.env` before any
// test body runs. A `NODE_ENV=test` process then opened a connection to the production database.
// Containment asks the FILE what it defines rather than snapshotting `process.env` first: another
// module in the import chain may already have loaded dotenv by the time this runs, which would make an
// inherited value look deliberate.
const dotfile = dotenv.config();
applyTestDatabaseContainment(process.env, guardedDotfileValues(dotfile.parsed));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.');
}

/**
 * CarUp OS — Supabase Admin Client
 * 
 * Uses the service_role key — bypasses Row Level Security.
 * This is ONLY used server-side inside the Express API Gateway.
 * Never expose this key to the browser.
 */
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: 'public',
  },
  realtime: {
    transport: ws,
  },
});

/**
 * Helper: execute a Supabase query and throw on error (matches the old db.get/db.all pattern)
 */
export async function dbSelect(table, filters = {}, options = {}) {
  let query = supabase.from(table).select(options.select || '*');

  // Apply eq filters
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }

  if (options.single) {
    query = query.single();
  }

  if (options.order) {
    query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Supabase SELECT error on ${table}: ${error.message}`);
  return data;
}

export async function dbInsert(table, rows) {
  const { data, error } = await supabase.from(table).insert(rows).select();
  if (error) throw new Error(`Supabase INSERT error on ${table}: ${error.message}`);
  return data;
}

export async function dbUpdate(table, updates, filters = {}) {
  let query = supabase.from(table).update(updates);
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  const { data, error } = await query.select();
  if (error) throw new Error(`Supabase UPDATE error on ${table}: ${error.message}`);
  return data;
}

export async function dbDelete(table, filters = {}) {
  let query = supabase.from(table).delete();
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  const { error } = await query;
  if (error) throw new Error(`Supabase DELETE error on ${table}: ${error.message}`);
  return true;
}

console.log('✅ CarUp OS — Supabase client initialized (service_role mode)');
