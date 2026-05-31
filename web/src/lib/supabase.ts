import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

/**
 * CarUp OS — Supabase Browser Client
 *
 * Uses the anon (public) key — subject to Row Level Security policies.
 * Safe to use in browser. Use this for:
 *   - Public vehicle listings (read-only)
 *   - Auth flows (Supabase Auth)
 *   - Real-time subscriptions
 *
 * For write/admin operations, use the Express API Gateway instead.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export default supabase;
