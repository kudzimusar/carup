-- +migrate Up
-- O2-X5A: scope loosenings so the EXISTING workbook stores serve the new stakeholder
-- vehicle templates (seller_vehicles / dealer_vehicle_inventory) — the alternative, a
-- second batch/receipt/confirmation store, is forbidden by the X5A plan (B10: one
-- history store; one mapping-confirmation discipline).
--
-- Both changes REMOVE a NOT NULL only. No column, type, default, index or RLS change;
-- every existing writer keeps writing exactly what it wrote before.
--
-- 1) dealer_workbook_mapping_confirmations.dealer_id becomes nullable: a PRIVATE
--    SELLER confirming a mapping for their own vehicle workbook has no dealer profile.
--    Scope for such rows is user_id (always NOT NULL); dealer rows keep carrying
--    dealer_id exactly as X5 wrote them.
ALTER TABLE public.dealer_workbook_mapping_confirmations
  ALTER COLUMN dealer_id DROP NOT NULL;

-- 2) diaspora_workbook_import_receipts.tenant_id becomes nullable: vehicle-workbook
--    imports execute under the importing USER's own listing authority with no tenant.
--    Diaspora receipts keep writing tenant_id as before; caller scoping for the new
--    template keys is by batch ownership (uploaded_by on the batch row).
ALTER TABLE public.diaspora_workbook_import_receipts
  ALTER COLUMN tenant_id DROP NOT NULL;
