-- =============================================================
-- PLATFORM SECURITY P0 — remove anonymous access to raw vehicle_evidence
-- =============================================================
-- LIVE-VERIFIED ON STAGING (2026-08-25) with the PUBLIC anon key, which ships
-- in the browser bundle and is therefore held by everyone:
--
--   GET /rest/v1/vehicle_evidence?vin=eq.<VIN>&select=*
--     -> HTTP 200, 4 rows, 54 COLUMNS EACH, including:
--          uploaded_by    = "golden-a-owner-stg"
--          verified_by    = "golden-reviewer-stg"
--          file_path      = "<VIN>/golden-registration_document.pdf"
--          storage_bucket = "ocr-documents"
--        and the columns the passport withholds as "Not shown publicly":
--          plate_number, normalized_plate_number, chassis_number, engine_number,
--          tenant_id, verification_notes
--
-- WHY THE APPLICATION FIX WAS NOT ENOUGH
-- --------------------------------------
-- A companion hotfix closes four ANONYMOUS APPLICATION doors that published the
-- same rows (`/api/vehicles/:vin/evidence`, `/evidence/timeline`, and the
-- passport's `evidenceVault` and `timeline`). None of that helps here: PostgREST
-- is a FIFTH door that does not pass through the application at all, so every
-- allow-list the backend applies is bypassed by asking Postgres directly.
--
-- RLS IS ROW SECURITY, NOT A COLUMN CONTRACT. This is the crux. The policy
-- `vehicle evidence public verified read` correctly restricts anon to
-- public_safe + verified ROWS — and that is all it does. `anon` separately holds
-- SELECT on all 54 COLUMNS (015_vehicle_evidence_timeline.sql:59, re-granted at
-- 20260809110000_api_role_write_hardening.sql:44), so `select=*` returns every
-- column of every row the policy admits. Tightening the policy would not have
-- fixed this; only removing the column privilege does.
--
-- WHY A STRAIGHT REVOKE IS SAFE
-- ------------------------------
-- Audited before writing this: nothing in `web/` reads this table through a
-- Supabase client or a hand-built PostgREST URL. The browser reaches evidence
-- exclusively through the CarUp backend API, which uses the SERVICE-ROLE client
-- and is unaffected by a grant made to `anon`. The governed public projection
-- (`toPublicEvidence` / the passport's verified-evidence block) continues to
-- publish the FACT of a verified document while withholding the file.
--
-- Note the 20260809110000 migration's own header: it was deliberately WRITE-side
-- only and left the SELECT posture for a later programme to adjudicate. This is
-- that adjudication, for this table.

-- +migrate Up

-- The privilege is what leaks the columns, so the privilege is what is removed.
-- Written to be idempotent and safe to re-run.
REVOKE SELECT ON TABLE public.vehicle_evidence FROM anon;
REVOKE ALL    ON TABLE public.vehicle_evidence FROM anon;

-- The anon SELECT policy is now unreachable (no privilege can satisfy it) and is
-- dropped so the effective posture is readable from the schema rather than
-- requiring the reader to cross-reference grants against policies.
DROP POLICY IF EXISTS "vehicle evidence public verified read" ON public.vehicle_evidence;

-- DELIBERATELY UNCHANGED:
--   · `authenticated` grants and policies — the owner/reviewer/admin application
--     paths that Issue #164 depends on read through them.
--   · service_role — the CarUp backend's own client, which every legitimate
--     public read now flows through.
--   · Every write-side grant and policy: this migration is read-side only, the
--     mirror image of 20260809110000.

-- +migrate Down

-- Restores the pre-migration posture EXACTLY, including the exposure, so the
-- rollback is honest about what it reinstates rather than quietly leaving a
-- half-state. Only run this to unblock an incident; the exposure returns with it.
GRANT SELECT ON TABLE public.vehicle_evidence TO anon;

CREATE POLICY "vehicle evidence public verified read"
ON public.vehicle_evidence
FOR SELECT
TO anon
USING (visibility_level = 'public_safe' AND verification_status = 'verified');
