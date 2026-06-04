-- +migrate Up
-- Fix recursive Diaspora RLS policy checks by moving order access checks into
-- SECURITY DEFINER helpers. The live validation runs after 013 and applies this
-- narrow policy replacement to keep direct Supabase access scoped without
-- causing policy recursion between orders and participants/documents.

CREATE OR REPLACE FUNCTION diaspora_can_access_order(target_order_id UUID, target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM diaspora_import_orders o
    WHERE o.id = target_order_id
      AND o.deleted_at IS NULL
      AND (
        o.buyer_id = target_user_id
        OR o.created_by = target_user_id
        OR o.updated_by = target_user_id
        OR EXISTS (
          SELECT 1 FROM tenant_users tu
          WHERE tu.tenant_id = o.tenant_id AND tu.user_id = target_user_id
        )
        OR EXISTS (
          SELECT 1 FROM diaspora_import_order_participants p
          WHERE p.import_order_id = o.id
            AND p.user_id = target_user_id
            AND p.deleted_at IS NULL
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION diaspora_can_access_order(UUID, TEXT) TO anon, authenticated;

DROP POLICY IF EXISTS "diaspora_orders_owner_participant_tenant" ON diaspora_import_orders;
DROP POLICY IF EXISTS "diaspora_orders_owner_insert" ON diaspora_import_orders;
DROP POLICY IF EXISTS "diaspora_orders_owner_participant_update" ON diaspora_import_orders;
DROP POLICY IF EXISTS "diaspora_participants_access" ON diaspora_import_order_participants;
DROP POLICY IF EXISTS "diaspora_documents_private_access" ON diaspora_trade_documents;
DROP POLICY IF EXISTS "diaspora_reservations_access" ON diaspora_cargo_reservations;
DROP POLICY IF EXISTS "diaspora_shipments_access" ON diaspora_shipments;
DROP POLICY IF EXISTS "diaspora_stage_events_access" ON diaspora_shipment_stage_events;
DROP POLICY IF EXISTS "diaspora_compliance_access" ON diaspora_compliance_reviews;
DROP POLICY IF EXISTS "diaspora_payment_access" ON diaspora_payment_milestones;
DROP POLICY IF EXISTS "diaspora_audit_access" ON diaspora_import_audit_log;
DROP POLICY IF EXISTS "vehicle_import_records_access" ON vehicle_import_records;
DROP POLICY IF EXISTS "vehicle_government_documents_access" ON vehicle_government_documents;

CREATE POLICY "diaspora_orders_owner_participant_tenant" ON diaspora_import_orders
  FOR SELECT USING (diaspora_can_access_order(id, auth.uid()::text));

CREATE POLICY "diaspora_orders_owner_insert" ON diaspora_import_orders
  FOR INSERT WITH CHECK (
    created_by = auth.uid()::text
    OR buyer_id = auth.uid()::text
    OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  );

CREATE POLICY "diaspora_orders_owner_participant_update" ON diaspora_import_orders
  FOR UPDATE USING (diaspora_can_access_order(id, auth.uid()::text))
  WITH CHECK (diaspora_can_access_order(id, auth.uid()::text));

CREATE POLICY "diaspora_participants_access" ON diaspora_import_order_participants FOR ALL USING (
  user_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  user_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "diaspora_documents_private_access" ON diaspora_trade_documents FOR ALL USING (
  uploaded_by = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  uploaded_by = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "diaspora_reservations_access" ON diaspora_cargo_reservations FOR ALL USING (
  buyer_id = auth.uid()::text
  OR seller_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  buyer_id = auth.uid()::text
  OR seller_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "diaspora_shipments_access" ON diaspora_shipments FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "diaspora_stage_events_access" ON diaspora_shipment_stage_events FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "diaspora_compliance_access" ON diaspora_compliance_reviews FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "diaspora_payment_access" ON diaspora_payment_milestones FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "diaspora_audit_access" ON diaspora_import_audit_log FOR SELECT USING (
  actor_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "vehicle_import_records_access" ON vehicle_import_records FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

CREATE POLICY "vehicle_government_documents_access" ON vehicle_government_documents FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR diaspora_can_access_order(import_order_id, auth.uid()::text)
);

-- +migrate Down
DROP FUNCTION IF EXISTS diaspora_can_access_order(UUID, TEXT);
