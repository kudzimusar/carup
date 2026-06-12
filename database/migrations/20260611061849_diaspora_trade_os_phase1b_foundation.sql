-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS Phase 1B foundation
--
-- Mirrors the staging foundation tables used by Phase 1C workbook dry-runs.
-- This migration is intentionally idempotent for development verification:
-- existing tables are not dropped, RLS is re-enabled, policies are recreated
-- with authenticated-only scope, and indexes/triggers are created safely.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.set_diaspora_trade_os_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.diaspora_trade_os_current_user_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true), ''), '')
$$;

CREATE OR REPLACE FUNCTION public.diaspora_trade_os_is_platform_admin(
  actor_id text DEFAULT public.diaspora_trade_os_current_user_id()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT actor_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = actor_id
        AND lower(coalesce(u.role, '')) IN ('admin', 'platform_admin', 'super_admin')
    )
$$;

CREATE OR REPLACE FUNCTION public.diaspora_trade_os_is_tenant_member(
  actor_id text,
  requested_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT actor_id IS NOT NULL
    AND requested_tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tenant_users tu
      WHERE tu.user_id = actor_id
        AND tu.tenant_id = requested_tenant_id
    )
$$;

CREATE OR REPLACE FUNCTION public.diaspora_trade_os_can_access_row(
  row_tenant_id uuid,
  row_created_by text,
  row_updated_by text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT public.diaspora_trade_os_is_platform_admin()
    OR public.diaspora_trade_os_current_user_id() = row_created_by
    OR public.diaspora_trade_os_current_user_id() = row_updated_by
    OR public.diaspora_trade_os_is_tenant_member(
      public.diaspora_trade_os_current_user_id(),
      row_tenant_id
    )
$$;

REVOKE ALL ON FUNCTION public.diaspora_trade_os_current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_trade_os_is_platform_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_trade_os_is_tenant_member(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_trade_os_can_access_row(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diaspora_trade_os_current_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.diaspora_trade_os_is_platform_admin(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.diaspora_trade_os_is_tenant_member(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.diaspora_trade_os_can_access_row(uuid, text, text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.diaspora_workbook_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  uploaded_by text NOT NULL,
  template_type text NOT NULL,
  source_filename text,
  source_mime_type text,
  source_file_size_bytes bigint,
  source_storage_path text,
  source_drive_file_id text,
  checksum_sha256 text,
  idempotency_key text NOT NULL,
  dry_run_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_rows integer NOT NULL DEFAULT 0,
  accepted_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  import_status text NOT NULL DEFAULT 'DRY_RUN',
  rollback_status text NOT NULL DEFAULT 'NOT_REQUIRED',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_workbook_import_batches_idempotency_unique
    UNIQUE (tenant_id, uploaded_by, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.diaspora_workbook_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  batch_id uuid NOT NULL REFERENCES public.diaspora_workbook_import_batches(id) ON DELETE CASCADE,
  sheet_name text NOT NULL,
  workbook_row_number integer NOT NULL,
  workbook_record_id text,
  target_table text,
  target_record_id uuid,
  action_type text NOT NULL DEFAULT 'UPSERT_DRAFT',
  row_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_status text NOT NULL DEFAULT 'PENDING',
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  import_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_workbook_import_rows_unique_row
    UNIQUE (batch_id, sheet_name, workbook_row_number)
);

CREATE TABLE IF NOT EXISTS public.diaspora_supply_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  seller_trade_profile_id uuid REFERENCES public.diaspora_trade_profiles(id) ON DELETE SET NULL,
  document_number text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  origin_country text,
  origin_city text,
  valid_from timestamptz,
  valid_until timestamptz,
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  publication_status text NOT NULL DEFAULT 'PRIVATE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_supply_documents_number_unique
    UNIQUE (tenant_id, document_number)
);

CREATE TABLE IF NOT EXISTS public.diaspora_stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  seller_trade_profile_id uuid REFERENCES public.diaspora_trade_profiles(id) ON DELETE SET NULL,
  supply_document_id uuid REFERENCES public.diaspora_supply_documents(id) ON DELETE SET NULL,
  sku text,
  part_name text NOT NULL,
  part_number text,
  oem_number text,
  aftermarket_number text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year_min integer,
  vehicle_year_max integer,
  condition text NOT NULL DEFAULT 'USED',
  origin_country text,
  origin_city text,
  warehouse_location text,
  quantity_on_hand numeric NOT NULL DEFAULT 0,
  quantity_reserved numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  unit_price numeric,
  currency text NOT NULL DEFAULT 'USD',
  export_readiness_status text NOT NULL DEFAULT 'DRAFT',
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  publication_status text NOT NULL DEFAULT 'PRIVATE',
  stock_passport_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_stock_items_sku_unique
    UNIQUE (tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS public.diaspora_order_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE SET NULL,
  buyer_trade_profile_id uuid REFERENCES public.diaspora_trade_profiles(id) ON DELETE SET NULL,
  document_number text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  requested_item_summary text,
  destination_country text,
  destination_city text,
  budget_amount numeric,
  budget_currency text NOT NULL DEFAULT 'USD',
  urgency text NOT NULL DEFAULT 'NORMAL',
  order_passport_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_order_documents_number_unique
    UNIQUE (tenant_id, document_number)
);

CREATE TABLE IF NOT EXISTS public.diaspora_ai_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  requested_by text NOT NULL,
  workbook_batch_id uuid REFERENCES public.diaspora_workbook_import_batches(id) ON DELETE SET NULL,
  raw_command text NOT NULL,
  voice_transcript text,
  intent text NOT NULL,
  risk_level text NOT NULL DEFAULT 'LOW',
  confidence_score numeric NOT NULL DEFAULT 0,
  target_entity_type text,
  target_entity_id text,
  extracted_entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED',
  execution_status text NOT NULL DEFAULT 'DRAFT',
  error_message text,
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.diaspora_stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  stock_item_id uuid NOT NULL REFERENCES public.diaspora_stock_items(id) ON DELETE RESTRICT,
  import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE SET NULL,
  supply_document_id uuid REFERENCES public.diaspora_supply_documents(id) ON DELETE SET NULL,
  workbook_batch_id uuid REFERENCES public.diaspora_workbook_import_batches(id) ON DELETE SET NULL,
  source_command_id uuid REFERENCES public.diaspora_ai_commands(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  quantity_delta numeric NOT NULL,
  quantity_before numeric,
  quantity_after numeric,
  unit_cost numeric,
  unit_price numeric,
  currency text NOT NULL DEFAULT 'USD',
  reference_document_id uuid REFERENCES public.diaspora_trade_documents(id) ON DELETE SET NULL,
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED',
  execution_status text NOT NULL DEFAULT 'DRAFT',
  audit_lock boolean NOT NULL DEFAULT true,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.diaspora_drive_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id text NOT NULL,
  provider text NOT NULL,
  provider_account_email text,
  provider_account_id text,
  root_folder_id text,
  root_folder_url text,
  permission_scope text,
  credential_reference text,
  access_status text NOT NULL DEFAULT 'ACTIVE',
  last_sync_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_drive_connections_unique_provider
    UNIQUE (user_id, provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS public.diaspora_drive_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  drive_connection_id uuid NOT NULL REFERENCES public.diaspora_drive_connections(id) ON DELETE CASCADE,
  provider text NOT NULL,
  drive_file_id text NOT NULL,
  drive_file_url text,
  file_name text NOT NULL,
  mime_type text,
  checksum_sha256 text,
  file_owner text,
  permission_scope text,
  linked_entity_type text NOT NULL,
  linked_entity_id text NOT NULL,
  sync_status text NOT NULL DEFAULT 'PENDING',
  last_sync_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_drive_files_unique_provider_file
    UNIQUE (drive_connection_id, provider, drive_file_id)
);

CREATE INDEX IF NOT EXISTS idx_diaspora_workbook_batches_tenant_status
  ON public.diaspora_workbook_import_batches (tenant_id, import_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_workbook_rows_batch
  ON public.diaspora_workbook_import_rows (batch_id, sheet_name, validation_status);
CREATE INDEX IF NOT EXISTS idx_diaspora_supply_documents_seller_status
  ON public.diaspora_supply_documents (seller_trade_profile_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_stock_items_tenant_seller
  ON public.diaspora_stock_items (tenant_id, seller_trade_profile_id, publication_status);
CREATE INDEX IF NOT EXISTS idx_diaspora_stock_items_part_lookup
  ON public.diaspora_stock_items (part_name, part_number, oem_number, vehicle_make, vehicle_model);
CREATE INDEX IF NOT EXISTS idx_diaspora_order_documents_buyer_status
  ON public.diaspora_order_documents (buyer_trade_profile_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_ai_commands_requestor_status
  ON public.diaspora_ai_commands (requested_by, execution_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_stock_ledger_item_created
  ON public.diaspora_stock_ledger (stock_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_drive_connections_user_provider
  ON public.diaspora_drive_connections (user_id, provider, access_status);
CREATE INDEX IF NOT EXISTS idx_diaspora_drive_files_linked_entity
  ON public.diaspora_drive_files (linked_entity_type, linked_entity_id, sync_status);

DROP TRIGGER IF EXISTS set_diaspora_workbook_import_batches_updated_at ON public.diaspora_workbook_import_batches;
CREATE TRIGGER set_diaspora_workbook_import_batches_updated_at
  BEFORE UPDATE ON public.diaspora_workbook_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_workbook_import_rows_updated_at ON public.diaspora_workbook_import_rows;
CREATE TRIGGER set_diaspora_workbook_import_rows_updated_at
  BEFORE UPDATE ON public.diaspora_workbook_import_rows
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_supply_documents_updated_at ON public.diaspora_supply_documents;
CREATE TRIGGER set_diaspora_supply_documents_updated_at
  BEFORE UPDATE ON public.diaspora_supply_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_stock_items_updated_at ON public.diaspora_stock_items;
CREATE TRIGGER set_diaspora_stock_items_updated_at
  BEFORE UPDATE ON public.diaspora_stock_items
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_order_documents_updated_at ON public.diaspora_order_documents;
CREATE TRIGGER set_diaspora_order_documents_updated_at
  BEFORE UPDATE ON public.diaspora_order_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_ai_commands_updated_at ON public.diaspora_ai_commands;
CREATE TRIGGER set_diaspora_ai_commands_updated_at
  BEFORE UPDATE ON public.diaspora_ai_commands
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_stock_ledger_updated_at ON public.diaspora_stock_ledger;
CREATE TRIGGER set_diaspora_stock_ledger_updated_at
  BEFORE UPDATE ON public.diaspora_stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_drive_connections_updated_at ON public.diaspora_drive_connections;
CREATE TRIGGER set_diaspora_drive_connections_updated_at
  BEFORE UPDATE ON public.diaspora_drive_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_drive_files_updated_at ON public.diaspora_drive_files;
CREATE TRIGGER set_diaspora_drive_files_updated_at
  BEFORE UPDATE ON public.diaspora_drive_files
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

ALTER TABLE public.diaspora_workbook_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_workbook_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_supply_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_order_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_ai_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_drive_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS diaspora_workbook_batches_private_access ON public.diaspora_workbook_import_batches;
CREATE POLICY diaspora_workbook_batches_private_access
  ON public.diaspora_workbook_import_batches
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, uploaded_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, uploaded_by, updated_by));

DROP POLICY IF EXISTS diaspora_workbook_rows_private_access ON public.diaspora_workbook_import_rows;
CREATE POLICY diaspora_workbook_rows_private_access
  ON public.diaspora_workbook_import_rows
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

DROP POLICY IF EXISTS diaspora_supply_documents_private_access ON public.diaspora_supply_documents;
CREATE POLICY diaspora_supply_documents_private_access
  ON public.diaspora_supply_documents
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

DROP POLICY IF EXISTS diaspora_stock_items_private_access ON public.diaspora_stock_items;
CREATE POLICY diaspora_stock_items_private_access
  ON public.diaspora_stock_items
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

DROP POLICY IF EXISTS diaspora_order_documents_private_access ON public.diaspora_order_documents;
CREATE POLICY diaspora_order_documents_private_access
  ON public.diaspora_order_documents
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

DROP POLICY IF EXISTS diaspora_ai_commands_private_access ON public.diaspora_ai_commands;
CREATE POLICY diaspora_ai_commands_private_access
  ON public.diaspora_ai_commands
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, requested_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, requested_by, updated_by));

DROP POLICY IF EXISTS diaspora_stock_ledger_private_access ON public.diaspora_stock_ledger;
CREATE POLICY diaspora_stock_ledger_private_access
  ON public.diaspora_stock_ledger
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

DROP POLICY IF EXISTS diaspora_drive_connections_owner_access ON public.diaspora_drive_connections;
CREATE POLICY diaspora_drive_connections_owner_access
  ON public.diaspora_drive_connections
  FOR ALL
  TO authenticated
  USING (
    public.diaspora_trade_os_is_platform_admin()
    OR public.diaspora_trade_os_current_user_id() = user_id
  )
  WITH CHECK (
    public.diaspora_trade_os_is_platform_admin()
    OR public.diaspora_trade_os_current_user_id() = user_id
  );

DROP POLICY IF EXISTS diaspora_drive_files_owner_access ON public.diaspora_drive_files;
CREATE POLICY diaspora_drive_files_owner_access
  ON public.diaspora_drive_files
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

COMMENT ON FUNCTION public.set_diaspora_trade_os_updated_at()
  IS 'Maintains updated_at for Diaspora Trade OS Phase 1B foundation tables.';
COMMENT ON FUNCTION public.diaspora_trade_os_can_access_row(uuid, text, text)
  IS 'Shared row predicate for authenticated owners, tenant members, and platform admins.';

COMMENT ON TABLE public.diaspora_workbook_import_batches
  IS 'Workbook dry-run batch history. Dry-run persistence is allowed here before live trade imports exist.';
COMMENT ON TABLE public.diaspora_workbook_import_rows
  IS 'Workbook row-level dry-run diagnostics. Rows do not execute live trade table writes.';
COMMENT ON TABLE public.diaspora_supply_documents
  IS 'Supplier offline/online supply document drafts for future reviewed import flows.';
COMMENT ON TABLE public.diaspora_stock_items
  IS 'Stock catalog records. Workbook imports must not directly overwrite quantities; use the stock ledger in later phases.';
COMMENT ON TABLE public.diaspora_order_documents
  IS 'Buyer-side offline/online order document drafts for future reviewed import flows.';
COMMENT ON TABLE public.diaspora_ai_commands
  IS 'AI command staging records only. Phase 1B/1C does not execute AI actions.';
COMMENT ON TABLE public.diaspora_stock_ledger
  IS 'Auditable stock quantity movement ledger reserved for reviewed future import execution.';
COMMENT ON TABLE public.diaspora_drive_connections
  IS 'Drive connection metadata. Stores credential_reference only; never store OAuth access or refresh tokens in this table.';
COMMENT ON COLUMN public.diaspora_drive_connections.credential_reference
  IS 'Reference to a secure credential vault entry. Do not store raw OAuth tokens or secrets here.';
COMMENT ON TABLE public.diaspora_drive_files
  IS 'Drive file metadata and entity links for future Drive sync phases; does not store file contents or OAuth secrets.';

-- +migrate Down
-- Intentionally omitted. These foundation tables hold audit and dry-run history;
-- rollback must be planned explicitly before dropping persisted diagnostics.
