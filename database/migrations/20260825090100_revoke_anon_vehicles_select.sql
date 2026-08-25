-- =============================================================
-- PLATFORM SECURITY P0 — remove anonymous access to raw public.vehicles
-- =============================================================
-- LIVE-VERIFIED ON STAGING (2026-08-25) with the PUBLIC anon key:
--
--   GET /rest/v1/vehicles?vin=eq.<VIN>&select=*
--     -> HTTP 200, 66 COLUMNS, including
--          owner_id           = "golden-a-owner-stg"
--          current_seller_id  = "golden-a-owner-stg"
--          plate_number       = "GLDA0001"
--          chassis_number     = "CARUPGLDNA-CHS-0001"
--          engine_number      = "CARUPGLDNA-ENG-0001"
--
--   GET /rest/v1/vehicles?vin=eq.<DRAFT VIN>&select=vin,publication_status,owner_id,plate_number
--     -> HTTP 200, the DRAFT vehicle, fully readable
--
-- Two release invariants were therefore defeated below the application:
--   · "an unpublished listing is absent from public surfaces" — a draft row is
--     readable directly;
--   · "owner_id / current_seller_id / plate / chassis / engine are never public"
--     — the passport withholds all five as "Not shown publicly", and PostgREST
--     handed them over anyway.
--
-- PRODUCTION STATE AT THE TIME OF WRITING -- THIS ONE IS A LIVE BREACH
-- --------------------------------------------------------------------
-- Verified read-only against project vhmnajoeicasaigiophh with that project's
-- own anon key, printing column NAMES and counts only -- never a row value:
--
--   GET /rest/v1/vehicles?select=*&limit=1
--     -> HTTP 206, content-range 0-0/352, 45 COLUMNS, including
--          owner_id, current_seller_id, plate_number, chassis_number,
--          engine_number, normalized_plate_number, tenant_id
--
-- Those are 352 REAL CUSTOMER ROWS, not fixtures. Unlike vehicle_evidence
-- (empty in production), this table is leaking now.
--
-- WHY THIS TABLE AND NOT THE OTHERS
-- ---------------------------------
-- Many public tables carry a stray anon SELECT grant, but RLS is enabled and NO
-- policy admits anon, so they return 200 with zero rows -- `users` (29 rows) and
-- `safepay_escrows` (468 rows) were both probed and returned nothing.
-- `vehicles` is the exception: `vehicles_public_read` is `USING (true)` for role
-- `public`, so RLS admits EVERY row, and the column grant then hands over every
-- column of each one. Grant plus permissive policy is what makes this live.
--
-- The probe methodology was validated with a discriminating control: three
-- tables anon genuinely cannot read (ocr_documents, user_sessions,
-- trust_audit_events) each returned HTTP 401 / SQLSTATE 42501 "permission denied
-- for table ...". A denial is therefore OBSERVABLE, so the post-migration check
-- can distinguish "revoked" from "empty" -- an all-zero result is not accepted
-- as success on its own.

-- WHY RLS DID NOT PREVENT THIS, AND WHY TIGHTENING IT WOULD NOT HAVE
-- ------------------------------------------------------------------
-- `vehicles_public_read` is `USING (true)` — every row, drafts included — and
-- `anon` separately holds SELECT on all 66 COLUMNS. Even with a perfect row
-- predicate, `select=*` would still return every column of every admitted row.
-- RLS is ROW security; it is not a public column contract. Only removing the
-- column privilege closes this.
--
-- WHY A STRAIGHT REVOKE IS SAFE — AUDITED, NOT ASSUMED
-- ----------------------------------------------------
-- The 20260809110000 hardening migration deliberately left the SELECT posture
-- alone, recording it as "a product decision (anon browses public vehicles
-- directly)". That decision no longer has a consumer. Measured across the repo:
--
--   · web/src/lib/supabase.ts is the ONLY browser Supabase client, and
--     web/src/hooks/useVehicles.ts is its ONLY importer;
--   · NOTHING imports useVehicles — it is dead code, so its
--     `postgres_changes` subscription on `vehicles` never mounts and no
--     realtime dependency exists either;
--   · every live vehicle read in the browser goes through the CarUp backend
--     API, which uses the SERVICE-ROLE client and is untouched by an `anon`
--     grant;
--   · no `storage` policy references `vehicles` (checked in pg_policies and in
--     the migration tree), so no signed-URL path depends on this privilege.
--
-- The dead hook is deleted in the same change-set, so the grant and its only
-- would-be consumer disappear together rather than leaving a file that looks
-- load-bearing.
--
-- NO PUBLIC VIEW IS INTRODUCED. The owner's fallback option was a narrowly
-- allow-listed projection IF direct PostgREST access had to remain. It does
-- not, so the simpler and stronger option is taken: no direct anonymous SQL
-- surface at all. That also avoids the `security_invoker` trap, where a view
-- owned by a privileged role silently bypasses the row restrictions it appears
-- to inherit.

-- +migrate Up

REVOKE SELECT ON TABLE public.vehicles FROM anon;
REVOKE ALL    ON TABLE public.vehicles FROM anon;

-- `vehicles_public_read` is `USING (true)` and applies to role `public`, which
-- includes anon. With the privilege gone it can no longer admit an anonymous
-- reader, but it is scoped to `authenticated` so the policy states what it
-- actually governs instead of implying a public read that can no longer happen.
DROP POLICY IF EXISTS vehicles_public_read ON public.vehicles;

CREATE POLICY vehicles_public_read
ON public.vehicles
FOR SELECT
TO authenticated
USING (true);

-- DELIBERATELY UNCHANGED: service_role (the backend's own client, through which
-- every legitimate public read now flows), the `authenticated` posture, and
-- every write-side grant and policy. This migration is read-side only.

-- +migrate Down

-- Restores the pre-migration posture EXACTLY, exposure included, so a rollback
-- is honest about what it reinstates.
GRANT SELECT ON TABLE public.vehicles TO anon;

DROP POLICY IF EXISTS vehicles_public_read ON public.vehicles;

CREATE POLICY vehicles_public_read
ON public.vehicles
FOR SELECT
TO public
USING (true);
