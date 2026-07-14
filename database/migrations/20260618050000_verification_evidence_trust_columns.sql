-- Phase 7C — Verification evidence and trust schema alignment.
--
-- Adds assessment columns directly to verification_sessions so the backend's
-- sanitizeSession and decision policy engine can persist/retrieve classification
-- and trust results without joining to verification_assessments on every read.
--
-- All new columns are nullable TEXT (no CHECK constraint — enum enforcement
-- lives in the application layer via caseWorkflow.js constants).
--
-- Safe additive migration:
--   - No DROP TABLE, DROP COLUMN, DELETE, TRUNCATE
--   - All ALTER TABLE ADD COLUMN use IF NOT EXISTS
--   - All columns are nullable (TEXT) — no backfill needed
--
-- Order: run after 20260618040000_verification_case_management.sql.

ALTER TABLE verification_sessions ADD COLUMN IF NOT EXISTS evidence_classification TEXT;
ALTER TABLE verification_sessions ADD COLUMN IF NOT EXISTS ocr_execution_status TEXT;
ALTER TABLE verification_sessions ADD COLUMN IF NOT EXISTS extraction_trust_status TEXT;
ALTER TABLE verification_sessions ADD COLUMN IF NOT EXISTS identity_binding_status TEXT;
ALTER TABLE verification_sessions ADD COLUMN IF NOT EXISTS selfie_check_status TEXT;
