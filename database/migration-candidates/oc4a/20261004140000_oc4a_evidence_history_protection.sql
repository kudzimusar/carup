-- +migrate Up
-- =====================================================================================================
-- OC-4A CANDIDATE — NOT APPLIED ANYWHERE. Lives outside database/migrations on purpose: no runner or
-- workflow picks it up. Promotion into database/migrations is an authorised staging-lane act.
--
-- Evidence-history protection for the three histories OC-3D left exposed on PostgreSQL (their only
-- "protection" was the SQLite triggers in 004_add_tamper_proofing.sql, which never parsed here).
-- Classification from their MEASURED writers (OC-4A), not from their names:
--
--   financial_ledger  APPEND ONLY. No runtime writer exists. A ledger is corrected by a compensating
--                     entry, never by editing or deleting one.
--   partsentry_logs   DOMAIN HISTORY WITH GOVERNED CORRECTION. The repair FACT (vin, mechanic, part,
--                     action, mileage, signature, timestamp, …) is immutable once written. The six
--                     governance fields change only through the PartSentry review workflow
--                     (partsentryReviewService), which records every change in trust_audit_events.
--   ocr_documents     CONTROLLED STATUS TRANSITION REQUIRED. An extraction is immutable candidate
--                     evidence. `status` may move within its CHECK lifecycle; `file_path` may be set
--                     ONCE, from the extraction placeholder to the stored object
--                     (verificationSessionService links it after the session completes).
--
-- No row of any of the three is deleted, and no table is truncated. The guards compare the WHOLE row
-- (minus the explicitly mutable keys) as jsonb, so a production-only column this repository never
-- declared is protected by default rather than silently left editable.
--
-- Stated limit (as OC-3D): triggers and grants bind application roles; a table owner / superuser can
-- still bypass them. That party is answered by tamper evidence, not by this file.
-- =====================================================================================================

CREATE OR REPLACE FUNCTION public.carup_history_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only history: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION public.carup_partsentry_logs_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  governed CONSTANT text[] := ARRAY['public_card_eligible', 'verification_status', 'part_verification_status',
                                    'suspicion_status', 'approved_by', 'approved_at'];
BEGIN
  IF (to_jsonb(NEW) - governed) IS DISTINCT FROM (to_jsonb(OLD) - governed) THEN
    RAISE EXCEPTION 'partsentry_logs: the repair record is immutable; only governed review fields may change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.carup_ocr_documents_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'file_path']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'file_path']) THEN
    RAISE EXCEPTION 'ocr_documents: an extraction is immutable candidate evidence; only status and the one-time file link may change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.file_path IS DISTINCT FROM OLD.file_path
     AND OLD.file_path NOT IN ('inline_upload_not_persisted_by_extraction', 'not_persisted') THEN
    RAISE EXCEPTION 'ocr_documents: file_path is linked once, from the extraction placeholder; it is not re-pointed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_name text;
  v_tenant_fk boolean := false;
BEGIN
  -- financial_ledger: append only.
  IF to_regclass('public.financial_ledger') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_financial_ledger_no_update ON public.financial_ledger';
    EXECUTE 'CREATE TRIGGER trg_financial_ledger_no_update BEFORE UPDATE ON public.financial_ledger FOR EACH ROW EXECUTE FUNCTION public.carup_history_reject_mutation()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_financial_ledger_no_delete ON public.financial_ledger';
    EXECUTE 'CREATE TRIGGER trg_financial_ledger_no_delete BEFORE DELETE ON public.financial_ledger FOR EACH ROW EXECUTE FUNCTION public.carup_history_reject_mutation()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_financial_ledger_no_truncate ON public.financial_ledger';
    EXECUTE 'CREATE TRIGGER trg_financial_ledger_no_truncate BEFORE TRUNCATE ON public.financial_ledger FOR EACH STATEMENT EXECUTE FUNCTION public.carup_history_reject_mutation()';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON public.financial_ledger FROM anon, authenticated, service_role';
  ELSE
    RAISE NOTICE '[oc-4a] financial_ledger absent — nothing to protect.';
  END IF;

  -- partsentry_logs: governed correction only; never deleted.
  IF to_regclass('public.partsentry_logs') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_partsentry_logs_guard_update ON public.partsentry_logs';
    EXECUTE 'CREATE TRIGGER trg_partsentry_logs_guard_update BEFORE UPDATE ON public.partsentry_logs FOR EACH ROW EXECUTE FUNCTION public.carup_partsentry_logs_guard_update()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_partsentry_logs_no_delete ON public.partsentry_logs';
    EXECUTE 'CREATE TRIGGER trg_partsentry_logs_no_delete BEFORE DELETE ON public.partsentry_logs FOR EACH ROW EXECUTE FUNCTION public.carup_history_reject_mutation()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_partsentry_logs_no_truncate ON public.partsentry_logs';
    EXECUTE 'CREATE TRIGGER trg_partsentry_logs_no_truncate BEFORE TRUNCATE ON public.partsentry_logs FOR EACH STATEMENT EXECUTE FUNCTION public.carup_history_reject_mutation()';
    EXECUTE 'REVOKE DELETE, TRUNCATE ON public.partsentry_logs FROM anon, authenticated, service_role';
    -- Repair history survives its vehicle and its garage. The vin FK (CASCADE in supabase_schema.sql) and,
    -- where 002 added one, the tenant_id FK (CASCADE from tenants) become RESTRICT; names are not assumed.
    -- The row trigger already refuses a cascaded delete; the FK says so declaratively, and — being a
    -- system trigger — still holds under ALTER TABLE … DISABLE TRIGGER USER.
    FOR v_name IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.partsentry_logs'::regclass AND contype = 'f' AND confrelid = 'public.vehicles'::regclass
    LOOP
      EXECUTE format('ALTER TABLE public.partsentry_logs DROP CONSTRAINT %I', v_name);
    END LOOP;
    EXECUTE 'ALTER TABLE public.partsentry_logs ADD CONSTRAINT partsentry_logs_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE RESTRICT';
    IF to_regclass('public.tenants') IS NOT NULL THEN
      FOR v_name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.partsentry_logs'::regclass AND contype = 'f' AND confrelid = 'public.tenants'::regclass
      LOOP
        EXECUTE format('ALTER TABLE public.partsentry_logs DROP CONSTRAINT %I', v_name);
        v_tenant_fk := true;
      END LOOP;
      IF v_tenant_fk THEN
        EXECUTE 'ALTER TABLE public.partsentry_logs ADD CONSTRAINT partsentry_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT';
      END IF;
    END IF;
  ELSE
    RAISE NOTICE '[oc-4a] partsentry_logs absent — nothing to protect.';
  END IF;

  -- ocr_documents: controlled status transition; never deleted.
  IF to_regclass('public.ocr_documents') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_ocr_documents_guard_update ON public.ocr_documents';
    EXECUTE 'CREATE TRIGGER trg_ocr_documents_guard_update BEFORE UPDATE ON public.ocr_documents FOR EACH ROW EXECUTE FUNCTION public.carup_ocr_documents_guard_update()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_ocr_documents_no_delete ON public.ocr_documents';
    EXECUTE 'CREATE TRIGGER trg_ocr_documents_no_delete BEFORE DELETE ON public.ocr_documents FOR EACH ROW EXECUTE FUNCTION public.carup_history_reject_mutation()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_ocr_documents_no_truncate ON public.ocr_documents';
    EXECUTE 'CREATE TRIGGER trg_ocr_documents_no_truncate BEFORE TRUNCATE ON public.ocr_documents FOR EACH STATEMENT EXECUTE FUNCTION public.carup_history_reject_mutation()';
    EXECUTE 'REVOKE DELETE, TRUNCATE ON public.ocr_documents FROM anon, authenticated, service_role';
  ELSE
    RAISE NOTICE '[oc-4a] ocr_documents absent — nothing to protect.';
  END IF;
END $$;

-- +migrate Down
-- Removes the triggers and functions and restores the partsentry_logs vin (and tenant) CASCADE. It does NOT
-- re-grant DELETE/TRUNCATE/UPDATE: the privileges held before Up are not measured, and widening write
-- access to an evidence history must be a deliberate, recorded act — not a rollback side effect.
DROP TRIGGER IF EXISTS trg_ocr_documents_no_truncate ON public.ocr_documents;
DROP TRIGGER IF EXISTS trg_ocr_documents_no_delete ON public.ocr_documents;
DROP TRIGGER IF EXISTS trg_ocr_documents_guard_update ON public.ocr_documents;
DROP TRIGGER IF EXISTS trg_partsentry_logs_no_truncate ON public.partsentry_logs;
DROP TRIGGER IF EXISTS trg_partsentry_logs_no_delete ON public.partsentry_logs;
DROP TRIGGER IF EXISTS trg_partsentry_logs_guard_update ON public.partsentry_logs;
ALTER TABLE public.partsentry_logs DROP CONSTRAINT IF EXISTS partsentry_logs_vin_fkey;
ALTER TABLE public.partsentry_logs
  ADD CONSTRAINT partsentry_logs_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE CASCADE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.partsentry_logs'::regclass AND conname = 'partsentry_logs_tenant_id_fkey') THEN
    ALTER TABLE public.partsentry_logs DROP CONSTRAINT partsentry_logs_tenant_id_fkey;
    EXECUTE 'ALTER TABLE public.partsentry_logs ADD CONSTRAINT partsentry_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_financial_ledger_no_truncate ON public.financial_ledger;
DROP TRIGGER IF EXISTS trg_financial_ledger_no_delete ON public.financial_ledger;
DROP TRIGGER IF EXISTS trg_financial_ledger_no_update ON public.financial_ledger;
DROP FUNCTION IF EXISTS public.carup_ocr_documents_guard_update();
DROP FUNCTION IF EXISTS public.carup_partsentry_logs_guard_update();
DROP FUNCTION IF EXISTS public.carup_history_reject_mutation();
