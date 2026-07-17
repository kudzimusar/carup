-- +migrate Up
-- =====================================================================================
-- Full Activation — Private Supabase Storage buckets + policies
--
-- Private buckets for institutional batch files, reconciliation artifacts, KYC/KYB
-- documents, dispute evidence and mobile-certification artifacts. Access is service-role
-- + admin/government only; the application mints short-lived signed URLs. Checksums,
-- type/size controls and retention are enforced in the application layer (documented in
-- docs/vehicle-trust-os/security/). No object contents are ever stored in public tables.
--
-- Guarded so it applies cleanly on Supabase (staging/prod) and is a safe no-op under PGlite
-- (which has no `storage` schema).
-- =====================================================================================

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    -- Private buckets (public=false). Idempotent.
    INSERT INTO storage.buckets (id, name, public)
    VALUES
      ('provider-batch-files',      'provider-batch-files',      false),
      ('reconciliation-reports',    'reconciliation-reports',    false),
      ('kyc-kyb-documents',         'kyc-kyb-documents',         false),
      ('dispute-evidence',          'dispute-evidence',          false),
      ('mobile-cert-artifacts',     'mobile-cert-artifacts',     false)
    ON CONFLICT (id) DO NOTHING;

    -- RLS policies: service_role does everything; admin/government may read. No anon.
    -- (Signed URLs are minted server-side with the service role; end users never read
    --  these buckets directly.)
    PERFORM 1 FROM pg_policies WHERE schemaname='storage' AND policyname='provider_buckets_admin_read';
    IF NOT FOUND THEN
      EXECUTE $pol$
        CREATE POLICY "provider_buckets_admin_read" ON storage.objects FOR SELECT TO authenticated
        USING (
          bucket_id IN ('provider-batch-files','reconciliation-reports','kyc-kyb-documents','dispute-evidence','mobile-cert-artifacts')
          AND auth.uid() IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government'))
        )
      $pol$;
    END IF;

    PERFORM 1 FROM pg_policies WHERE schemaname='storage' AND policyname='provider_buckets_no_anon';
    IF NOT FOUND THEN
      EXECUTE $pol$
        CREATE POLICY "provider_buckets_no_anon" ON storage.objects FOR ALL TO anon
        USING (false) WITH CHECK (false)
      $pol$;
    END IF;
  END IF;
END $$;

-- +migrate Down
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    DROP POLICY IF EXISTS "provider_buckets_admin_read" ON storage.objects;
    DROP POLICY IF EXISTS "provider_buckets_no_anon" ON storage.objects;
    DELETE FROM storage.buckets WHERE id IN
      ('provider-batch-files','reconciliation-reports','kyc-kyb-documents','dispute-evidence','mobile-cert-artifacts');
  END IF;
END $$;
