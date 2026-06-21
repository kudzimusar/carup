-- Launch access-control containment.
--
-- This migration is intentionally narrow: it removes direct client-role access
-- to launch-critical server-owned records while keeping backend service-role
-- paths intact. It is idempotent and safe to apply more than once.

DO $$
DECLARE
  table_name text;
  target_tables text[] := ARRAY[
    'saved_vehicles',
    'listing_images',
    'vehicle_documents',
    'dealer_leads',
    'payment_transactions',
    'financial_ledger',
    'administrative_overrides',
    'system_audit_logs',
    'domain_events',
    'ai_inference_logs',
    'identity_documents'
  ];
BEGIN
  FOREACH table_name IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.diaspora_can_access_order(uuid, text)') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.diaspora_can_access_order(
      target_order_id uuid,
      target_user_id text
    )
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $function$
      SELECT target_user_id IS NOT NULL
        AND target_user_id = auth.uid()::text
        AND EXISTS (
          SELECT 1
          FROM public.diaspora_import_orders o
          WHERE o.id = target_order_id
            AND o.deleted_at IS NULL
            AND (
              o.buyer_id = target_user_id
              OR o.created_by = target_user_id
              OR o.updated_by = target_user_id
              OR EXISTS (
                SELECT 1
                FROM public.tenant_users tu
                WHERE tu.tenant_id = o.tenant_id
                  AND tu.user_id = target_user_id
              )
              OR EXISTS (
                SELECT 1
                FROM public.diaspora_import_order_participants p
                WHERE p.import_order_id = o.id
                  AND p.user_id = target_user_id
                  AND p.deleted_at IS NULL
              )
            )
        );
    $function$;

    REVOKE ALL ON FUNCTION public.diaspora_can_access_order(uuid, text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.diaspora_can_access_order(uuid, text) TO authenticated, service_role;
  END IF;
END $$;
