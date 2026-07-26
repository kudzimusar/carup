-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Foundation mutation-boundary hardening (compensating, additive).
--
-- The foundation migrations (013, phase1b) shipped `FOR ALL` RLS policies plus table-level
-- INSERT/UPDATE grants to `authenticated` on the entire Diaspora lifecycle/data surface. An
-- authenticated tenant member reaching the tables directly (bypassing the Express/service-role
-- backend) could self-drive import-order status, participant assignment, quote acceptance, document
-- verification, container capacity, reservation approval, shipment state/stage, compliance approval,
-- payment-milestone status, reputation outcomes, stock quantities, the append-only stock ledger, and
-- the immutable audit log. Those tables are ALREADY applied to staging, so this migration does NOT
-- edit their bytes — it is an additive, idempotent, compensating migration that REVOKEs the broad
-- mutation capability and replaces every `FOR ALL` policy with a `FOR SELECT` policy (same read
-- predicate). All writes now flow exclusively through the service_role backend (which bypasses RLS)
-- after its Express authorization gate; the frontend performs no direct diaspora-table writes, so
-- user operability is preserved. Reference-catalog tables and the co-loading container read stay
-- readable. NOT applied to production. Closes risk SEC-DB-2.
-- =============================================================

-- ── PART 1 — table-level grant hardening ─────────────────────────────────────
-- For every foundation lifecycle/data table: RLS on; strip anon entirely; strip authenticated
-- INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER (SELECT retained, RLS-scoped); service_role keeps
-- the write privileges the backend services require.
DO $harden$
DECLARE
  t text;
  lifecycle_tables text[] := ARRAY[
    'diaspora_import_orders','diaspora_import_order_participants','diaspora_trade_profiles',
    'diaspora_import_quotes','diaspora_trade_documents','diaspora_trade_document_extractions',
    'diaspora_trade_document_verifications','diaspora_container_shipments','diaspora_cargo_reservations',
    'diaspora_shipments','diaspora_shipment_stage_events','diaspora_compliance_reviews',
    'diaspora_payment_milestones','diaspora_reputation_records','diaspora_import_audit_log',
    'diaspora_notification_preferences','vehicle_import_records','vehicle_government_documents',
    'diaspora_workbook_import_batches','diaspora_workbook_import_rows','diaspora_supply_documents',
    'diaspora_stock_items','diaspora_order_documents','diaspora_ai_commands','diaspora_stock_ledger',
    'diaspora_drive_connections','diaspora_drive_files'
  ];
BEGIN
  FOREACH t IN ARRAY lifecycle_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
      END IF;
    END IF;
  END LOOP;
END
$harden$;

-- ── PART 2 — replace FOR ALL policies with FOR SELECT (same read predicate) ───
-- Writes are impossible for authenticated at the grant layer above; recreating the policies as
-- SELECT-only is defense-in-depth so a future stray GRANT cannot re-open direct writes.

-- import_orders: keep the existing SELECT policy; drop the owner INSERT/UPDATE policies (create/update
-- now flow through the backend createImportOrder / transitionImportOrder service_role paths).
DROP POLICY IF EXISTS "diaspora_orders_owner_insert" ON public.diaspora_import_orders;
DROP POLICY IF EXISTS "diaspora_orders_owner_participant_update" ON public.diaspora_import_orders;

DROP POLICY IF EXISTS "diaspora_participants_access" ON public.diaspora_import_order_participants;
CREATE POLICY "diaspora_participants_read" ON public.diaspora_import_order_participants FOR SELECT TO authenticated USING (
  user_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

DROP POLICY IF EXISTS "diaspora_trade_profiles_access" ON public.diaspora_trade_profiles;
CREATE POLICY "diaspora_trade_profiles_read" ON public.diaspora_trade_profiles FOR SELECT TO authenticated USING (
  user_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
);

DROP POLICY IF EXISTS "diaspora_order_child_access" ON public.diaspora_import_quotes;
CREATE POLICY "diaspora_import_quotes_read" ON public.diaspora_import_quotes FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR seller_id = auth.uid()::text
);

DROP POLICY IF EXISTS "diaspora_documents_private_access" ON public.diaspora_trade_documents;
CREATE POLICY "diaspora_trade_documents_read" ON public.diaspora_trade_documents FOR SELECT TO authenticated USING (
  uploaded_by = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR import_order_id IN (SELECT import_order_id FROM public.diaspora_import_order_participants WHERE user_id = auth.uid()::text AND deleted_at IS NULL)
);

DROP POLICY IF EXISTS "diaspora_extractions_private_access" ON public.diaspora_trade_document_extractions;
CREATE POLICY "diaspora_extractions_read" ON public.diaspora_trade_document_extractions FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR trade_document_id IN (SELECT id FROM public.diaspora_trade_documents WHERE uploaded_by = auth.uid()::text)
);

DROP POLICY IF EXISTS "diaspora_verifications_private_access" ON public.diaspora_trade_document_verifications;
CREATE POLICY "diaspora_verifications_read" ON public.diaspora_trade_document_verifications FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR trade_document_id IN (SELECT id FROM public.diaspora_trade_documents WHERE uploaded_by = auth.uid()::text)
);

-- containers: keep the co-loading marketplace read (diaspora_containers_read_participants); drop the
-- FOR ALL tenant_write.
DROP POLICY IF EXISTS "diaspora_containers_tenant_write" ON public.diaspora_container_shipments;

DROP POLICY IF EXISTS "diaspora_reservations_access" ON public.diaspora_cargo_reservations;
CREATE POLICY "diaspora_reservations_read" ON public.diaspora_cargo_reservations FOR SELECT TO authenticated USING (
  buyer_id = auth.uid()::text
  OR seller_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

DROP POLICY IF EXISTS "diaspora_shipments_access" ON public.diaspora_shipments;
CREATE POLICY "diaspora_shipments_read" ON public.diaspora_shipments FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR import_order_id IN (SELECT import_order_id FROM public.diaspora_import_order_participants WHERE user_id = auth.uid()::text AND deleted_at IS NULL)
);

DROP POLICY IF EXISTS "diaspora_stage_events_access" ON public.diaspora_shipment_stage_events;
CREATE POLICY "diaspora_stage_events_read" ON public.diaspora_shipment_stage_events FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

DROP POLICY IF EXISTS "diaspora_compliance_access" ON public.diaspora_compliance_reviews;
CREATE POLICY "diaspora_compliance_read" ON public.diaspora_compliance_reviews FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

DROP POLICY IF EXISTS "diaspora_payment_access" ON public.diaspora_payment_milestones;
CREATE POLICY "diaspora_payment_read" ON public.diaspora_payment_milestones FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

DROP POLICY IF EXISTS "diaspora_reputation_access" ON public.diaspora_reputation_records;
CREATE POLICY "diaspora_reputation_read" ON public.diaspora_reputation_records FOR SELECT TO authenticated USING (
  reviewer_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR trade_profile_id IN (SELECT id FROM public.diaspora_trade_profiles WHERE user_id = auth.uid()::text)
);

-- audit log: policy is already FOR SELECT (kept); the grant loop above additionally strips any write.

DROP POLICY IF EXISTS "diaspora_notifications_access" ON public.diaspora_notification_preferences;
CREATE POLICY "diaspora_notifications_read" ON public.diaspora_notification_preferences FOR SELECT TO authenticated USING (
  user_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
);

DROP POLICY IF EXISTS "vehicle_import_records_access" ON public.vehicle_import_records;
CREATE POLICY "vehicle_import_records_read" ON public.vehicle_import_records FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

DROP POLICY IF EXISTS "vehicle_government_documents_access" ON public.vehicle_government_documents;
CREATE POLICY "vehicle_government_documents_read" ON public.vehicle_government_documents FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM public.diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

-- Phase 1B tables: 8 use the shared can_access_row predicate; drive_connections keys on owner/admin.
-- Drop the phase1b FOR ALL policies by their exact original names, then recreate SELECT-only.
DROP POLICY IF EXISTS diaspora_workbook_batches_private_access ON public.diaspora_workbook_import_batches;
CREATE POLICY diaspora_workbook_batches_read ON public.diaspora_workbook_import_batches FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));
DROP POLICY IF EXISTS diaspora_workbook_rows_private_access ON public.diaspora_workbook_import_rows;
CREATE POLICY diaspora_workbook_rows_read ON public.diaspora_workbook_import_rows FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));
DROP POLICY IF EXISTS diaspora_supply_documents_private_access ON public.diaspora_supply_documents;
CREATE POLICY diaspora_supply_documents_read ON public.diaspora_supply_documents FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));
DROP POLICY IF EXISTS diaspora_stock_items_private_access ON public.diaspora_stock_items;
CREATE POLICY diaspora_stock_items_read ON public.diaspora_stock_items FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));
DROP POLICY IF EXISTS diaspora_order_documents_private_access ON public.diaspora_order_documents;
CREATE POLICY diaspora_order_documents_read ON public.diaspora_order_documents FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));
DROP POLICY IF EXISTS diaspora_ai_commands_private_access ON public.diaspora_ai_commands;
CREATE POLICY diaspora_ai_commands_read ON public.diaspora_ai_commands FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));
DROP POLICY IF EXISTS diaspora_stock_ledger_private_access ON public.diaspora_stock_ledger;
CREATE POLICY diaspora_stock_ledger_read ON public.diaspora_stock_ledger FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));
DROP POLICY IF EXISTS diaspora_drive_files_owner_access ON public.diaspora_drive_files;
CREATE POLICY diaspora_drive_files_read ON public.diaspora_drive_files FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));
DROP POLICY IF EXISTS diaspora_drive_connections_owner_access ON public.diaspora_drive_connections;
CREATE POLICY diaspora_drive_connections_read ON public.diaspora_drive_connections FOR SELECT TO authenticated USING (
  public.diaspora_trade_os_is_platform_admin() OR public.diaspora_trade_os_current_user_id() = user_id
);

-- ── PART 3 — helper-function hardening ───────────────────────────────────────
-- (a) Trigger functions: pin search_path and remove any client EXECUTE (triggers run as table owner,
--     never need direct anon/authenticated EXECUTE).
DO $trg$
DECLARE fn text; sig text;
BEGIN
  FOR fn, sig IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('set_diaspora_updated_at','set_diaspora_trade_os_updated_at')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp', fn, sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', fn, sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', fn, sig); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated', fn, sig); END IF;
  END LOOP;
END
$trg$;

-- (b) Diaspora AUTHORIZATION helpers: pin search_path (ALTER SET only — never changes the body) and
--     revoke anon EXECUTE. current_tenant_id() is deliberately NOT in this list — see block (b2):
--     the PUBLIC marketplace policy vehicles.tenant_vehicles_isolation calls it (`tenant_id =
--     current_tenant_id() OR tenant_id IS NULL`), so anon must keep EXECUTE or every anonymous
--     vehicle browse fails at policy evaluation. This mirrors the explicit decision already recorded
--     in 20260620232827 ("current_tenant_id() KEEPS its existing (anon-inclusive) EXECUTE grants").
DO $help$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'is_diaspora_platform_admin','diaspora_trade_os_is_platform_admin','diaspora_trade_os_is_tenant_member',
      'diaspora_trade_os_can_access_row','diaspora_trade_os_current_user_id','diaspora_can_access_order')
  LOOP
    -- Pin search_path (idempotent — ALTER SET is safe to repeat and never changes the body).
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp', r.proname, r.sig);
    -- Neither PUBLIC (the implicit default EXECUTE grant every function gets at CREATE) nor anon may
    -- call a Diaspora authz helper — revoking only anon would leave anon executable via PUBLIC.
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', r.proname, r.sig);
    END IF;
    -- authenticated keeps EXECUTE (the RLS SELECT predicates call these helpers); backend service_role
    -- keeps EXECUTE. Mirrors phase1b's original REVOKE-PUBLIC + GRANT authenticated/service_role.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.sig);
    END IF;
  END LOOP;
END
$help$;

-- (b2) current_tenant_id(): the shared tenant-context helper consumed by the PUBLIC vehicles
--      marketplace policy. Explicit, unambiguous posture — search_path pinned; EXECUTE for anon,
--      authenticated AND service_role (no PUBLIC-wide grant); body untouched.
DO $ctid$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NOT NULL THEN
    ALTER FUNCTION public.current_tenant_id() SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO service_role;
    END IF;
  END IF;
END
$ctid$;

-- (c) Actor-spoofing guard: an authenticated caller must only be able to evaluate THEIR OWN identity
--     through the membership/admin helpers. RLS always passes current_user_id(); the backend
--     (service_role) has no request.jwt.claim.sub, so current_user_id() is NULL and it may pass any
--     actor. A direct call by an authenticated user with a FOREIGN actor_id now returns false.
CREATE OR REPLACE FUNCTION public.diaspora_trade_os_is_tenant_member(actor_id text, requested_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT actor_id IS NOT NULL AND requested_tenant_id IS NOT NULL
    AND (public.diaspora_trade_os_current_user_id() IS NULL OR actor_id = public.diaspora_trade_os_current_user_id())
    AND EXISTS (SELECT 1 FROM public.tenant_users tu WHERE tu.user_id = actor_id AND tu.tenant_id = requested_tenant_id)
$$;

-- Role comparison preserves the ORIGINAL phase1b normalization — lower(coalesce(u.role, '')) — so an
-- 'Admin'/'ADMIN' row keeps its admin status (a bare u.role IN (...) would be accidentally
-- case-sensitive and silently demote such users).
CREATE OR REPLACE FUNCTION public.diaspora_trade_os_is_platform_admin(actor_id text DEFAULT public.diaspora_trade_os_current_user_id())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT actor_id IS NOT NULL
    AND (public.diaspora_trade_os_current_user_id() IS NULL OR actor_id = public.diaspora_trade_os_current_user_id())
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = actor_id AND lower(coalesce(u.role, '')) IN ('admin','platform_admin','super_admin'))
$$;

-- Re-assert the ACL posture on both recreated helpers (CREATE OR REPLACE preserves prior ACLs, but the
-- final grants must be unambiguous): no PUBLIC, no anon; authenticated (RLS) + service_role only.
DO $recreated_acl$
BEGIN
  REVOKE ALL ON FUNCTION public.diaspora_trade_os_is_tenant_member(text, uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.diaspora_trade_os_is_platform_admin(text) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.diaspora_trade_os_is_tenant_member(text, uuid) FROM anon;
    REVOKE ALL ON FUNCTION public.diaspora_trade_os_is_platform_admin(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_trade_os_is_tenant_member(text, uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.diaspora_trade_os_is_platform_admin(text) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_trade_os_is_tenant_member(text, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.diaspora_trade_os_is_platform_admin(text) TO service_role;
  END IF;
END
$recreated_acl$;

-- +migrate Down
-- Rollback / remediation notes: this migration only tightens access (REVOKEs + SELECT-only policies +
-- helper guards). A rollback would RE-OPEN direct authenticated writes to the foundation tables and is
-- therefore a security regression — restore from backup under explicit authorization rather than
-- auto-reversing. The verification-only checks live in database/rollbacks/diaspora/. Intentionally no
-- destructive down script (mirrors the H7 grants-lock convention).
