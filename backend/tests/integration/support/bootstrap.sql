-- Supabase-compatibility bootstrap for the Command Center Postgres integration gate (P1.12 / item 5).
-- Applied into a DISPOSABLE database's own `public` schema BEFORE the real migrations, so the
-- migrations' `SET search_path = public` SECURITY DEFINER functions + RLS policies run unchanged.
-- Emulates the Supabase-isms the migrations depend on: roles, the auth schema + auth.jwt()/auth.uid(),
-- pgcrypto, and the CarUp `users` table (referenced by the inbox projection's registered-user fallback).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase roles (idempotent). NOLOGIN group roles the migrations GRANT to / define policies for.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- auth schema + the two functions the RLS policies call. They read the request JWT claims from a GUC
-- (request.jwt.claims), exactly like Supabase — the test sets that GUC to simulate a signed-in user.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  -- `->> 'sub'` yields text; the declared return type is uuid, so cast (NULL sub → NULL uuid).
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Minimal CarUp users table (matches the live supabase_schema.sql shape) — referenced by the inbox
-- projection's registered-user identity fallback + search.
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
