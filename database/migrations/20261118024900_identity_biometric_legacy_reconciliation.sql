-- Run before 20261118025000. The archived ledger retains its original rows,
-- identity sequence, dependencies, append-only trigger and RLS. Historical
-- grants are not consent for the current purpose, applicant case or revision.
DO $$
BEGIN
  IF to_regclass('public.identity_biometric_consents') IS NULL THEN RETURN; END IF;
  LOCK TABLE public.identity_biometric_consents IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='identity_biometric_consents' AND column_name='sequence_id'
  ) THEN RETURN; END IF;

  IF to_regclass('public.identity_biometric_consents_o2_archive') IS NOT NULL OR
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND table_name='identity_biometric_consents' AND (column_name,data_type) IN (
        ('id','text'),('seq','bigint'),('purposes','jsonb'),('supersedes_id','text'),('actor_kind','text')
      )) <> 5 OR NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid='public.identity_biometric_consents'::regclass
          AND tgname='trg_identity_biometric_consents_append_only' AND tgenabled IN ('O','A')
      ) THEN
    RAISE EXCEPTION 'Unknown O2-X4 consent ledger shape. Stop for governed reconciliation.';
  END IF;
  ALTER TABLE public.identity_biometric_consents RENAME TO identity_biometric_consents_o2_archive;
  REVOKE ALL ON public.identity_biometric_consents_o2_archive FROM PUBLIC, anon, authenticated, service_role;
END;
$$;
