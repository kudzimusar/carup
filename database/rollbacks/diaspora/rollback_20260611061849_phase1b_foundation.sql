-- Rollback for 20260611061849_diaspora_trade_os_phase1b_foundation.sql
-- Classification: REVERSIBLE SQL — ***TOTAL DATA LOSS*** for all Phase 1B tables.
--
-- ############################################################################
-- ##  DATA LOSS WARNING                                                     ##
-- ##  This drops ALL workbook import batches/rows, supply documents, stock  ##
-- ##  items, stock ledger history, order documents, AI command records and  ##
-- ##  Drive connections/files. There is NO undo except backup restore.      ##
-- ############################################################################
--
-- SAFETY LATCH: the DO block below raises unless you edit the marker to 'I_HAVE_A_VERIFIED_BACKUP'.
-- Rehearse on staging first (EB-1 blocked this at authoring time — NOT yet rehearsed).

-- BEFORE: capture row counts (save this output before proceeding).
SELECT 'diaspora_workbook_import_batches' AS t, count(*) FROM public.diaspora_workbook_import_batches
UNION ALL SELECT 'diaspora_workbook_import_rows', count(*) FROM public.diaspora_workbook_import_rows
UNION ALL SELECT 'diaspora_supply_documents', count(*) FROM public.diaspora_supply_documents
UNION ALL SELECT 'diaspora_stock_items', count(*) FROM public.diaspora_stock_items
UNION ALL SELECT 'diaspora_order_documents', count(*) FROM public.diaspora_order_documents
UNION ALL SELECT 'diaspora_ai_commands', count(*) FROM public.diaspora_ai_commands
UNION ALL SELECT 'diaspora_stock_ledger', count(*) FROM public.diaspora_stock_ledger
UNION ALL SELECT 'diaspora_drive_connections', count(*) FROM public.diaspora_drive_connections
UNION ALL SELECT 'diaspora_drive_files', count(*) FROM public.diaspora_drive_files;

DO $$
DECLARE latch text := 'EDIT_ME_BEFORE_RUNNING';
BEGIN
  IF latch <> 'I_HAVE_A_VERIFIED_BACKUP' THEN
    RAISE EXCEPTION 'Safety latch engaged: edit the latch variable after verifying a restorable backup.';
  END IF;

  -- Children before parents (ledger/rows reference items/batches).
  DROP TABLE IF EXISTS public.diaspora_drive_files CASCADE;
  DROP TABLE IF EXISTS public.diaspora_drive_connections CASCADE;
  DROP TABLE IF EXISTS public.diaspora_stock_ledger CASCADE;
  DROP TABLE IF EXISTS public.diaspora_ai_commands CASCADE;
  DROP TABLE IF EXISTS public.diaspora_order_documents CASCADE;
  DROP TABLE IF EXISTS public.diaspora_stock_items CASCADE;
  DROP TABLE IF EXISTS public.diaspora_supply_documents CASCADE;
  DROP TABLE IF EXISTS public.diaspora_workbook_import_rows CASCADE;
  DROP TABLE IF EXISTS public.diaspora_workbook_import_batches CASCADE;

  -- Phase 1B helper functions (reused by Phases 8/9/10 — those must be rolled back FIRST via their
  -- own Down blocks or this will orphan their policies).
  DROP FUNCTION IF EXISTS public.diaspora_trade_os_can_access_row(uuid, text, uuid);
  DROP FUNCTION IF EXISTS public.diaspora_trade_os_is_tenant_member(uuid);
  DROP FUNCTION IF EXISTS public.diaspora_trade_os_is_platform_admin();
  DROP FUNCTION IF EXISTS public.diaspora_trade_os_current_user_id();
  DROP FUNCTION IF EXISTS public.set_diaspora_trade_os_updated_at();
END $$;

-- AFTER: confirm the objects are gone (expect zero rows).
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'diaspora_workbook%'
   OR table_schema = 'public' AND table_name IN
     ('diaspora_supply_documents','diaspora_stock_items','diaspora_order_documents',
      'diaspora_ai_commands','diaspora_stock_ledger','diaspora_drive_connections','diaspora_drive_files');
