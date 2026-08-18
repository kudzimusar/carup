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
 *   - Real-time subscriptions
 *   - Signed-URL storage uploads
 *
 * For write/admin operations, use the Express API Gateway instead.
 *
 * NOT used for authentication. CarUp authenticates against its own backend
 * (POST /api/auth/login -> a session token row in public.user_sessions, sent as the
 * x-session-token header); see web/src/context/AuthContext.tsx. Supabase Auth (GoTrue) is
 * provisioned but dormant — auth.users is empty and no supabase.auth.* call exists anywhere
 * in this repo. An earlier version of this comment claimed "Auth flows (Supabase Auth)",
 * which was never true.
 *
 * `detectSessionInUrl` below is therefore inert today. If Supabase Auth is ever adopted, note
 * that it will consume an #access_token fragment on ANY route this client is loaded on, and
 * there is currently no /auth/* route to receive one.
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
