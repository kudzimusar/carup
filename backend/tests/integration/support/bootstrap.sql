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

-- Pre-existing runtime tables the omnichannel engine migration ADDITIVELY extends (ALTER … ADD COLUMN
-- IF NOT EXISTS). They are created by earlier CarUp migrations in production; the gate re-creates their
-- live shapes minimally so the base migration applies. notification_queue.id is BIGSERIAL (a numeric
-- queue id), which is why communication_audit_events.notification_id is TEXT (holds the stringified id).
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id BIGSERIAL PRIMARY KEY,
  recipient_id TEXT,
  type TEXT,
  title TEXT,
  message TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Minimal Marketplace inquiry shape required by the Communications 2.0 reliability trigger.
-- This is disposable CI only; the real table comes from the Marketplace migration chain.
CREATE TABLE IF NOT EXISTS public.marketplace_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT,
  listing_type TEXT NOT NULL DEFAULT 'vehicle',
  buyer_id TEXT,
  guest_name TEXT,
  guest_email TEXT,
  guest_phone TEXT,
  seller_id TEXT,
  seller_tenant_id TEXT,
  inquiry_type TEXT NOT NULL,
  message TEXT,
  referral_code TEXT,
  campaign_code TEXT,
  source_channel TEXT NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'new',
  risk_status TEXT NOT NULL DEFAULT 'clear',
  assigned_operator TEXT,
  country TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
