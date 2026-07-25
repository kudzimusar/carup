-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Hardening H1: atomic stock movement RPC
--
-- Replaces the previous 3-call sequence (ledger insert + balance update + audit
-- insert) with ONE transactional function. The stock row is locked with
-- SELECT ... FOR UPDATE so concurrent reservations cannot lose updates or
-- over-reserve. Idempotency, balance constraints, approval and a CRITICAL audit
-- row are all enforced inside the same transaction; any failure rolls back.
--
-- Additive and backwards-compatible. NOT applied to production by this program.
-- =============================================================

CREATE OR REPLACE FUNCTION public.diaspora_append_stock_movement_atomic(
  p_stock_item_id uuid,
  p_actor_id text,
  p_tenant_id uuid,
  p_actor_is_privileged boolean,
  p_action text,
  p_quantity numeric,
  p_idempotency_key text DEFAULT NULL,
  p_import_order_id uuid DEFAULT NULL,
  p_reservation_ref text DEFAULT NULL,
  p_source_command_id uuid DEFAULT NULL,
  p_reference_document_id uuid DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_unit_price numeric DEFAULT NULL,
  p_currency text DEFAULT 'USD',
  p_reason text DEFAULT NULL,
  p_approval jsonb DEFAULT NULL,
  p_correlation_id text DEFAULT NULL,
  p_source text DEFAULT 'ui'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.diaspora_stock_items%ROWTYPE;
  v_existing public.diaspora_stock_ledger%ROWTYPE;
  v_ledger public.diaspora_stock_ledger%ROWTYPE;
  v_on_hand numeric;
  v_reserved numeric;
  v_available numeric;
  v_new_on numeric;
  v_new_res numeric;
  v_seal text;
  v_ts timestamptz := now();
BEGIN
  -- 1. Action allowlist (no arbitrary actions).
  IF p_action NOT IN ('ADD','REMOVE','RESERVE','RELEASE_RESERVATION','DAMAGE','RETURN','TRANSFER','ADJUST_WITH_APPROVAL') THEN
    RAISE EXCEPTION 'DIASPORA_STOCK/INVALID_ACTION: %', p_action;
  END IF;
  IF p_quantity IS NULL OR p_quantity != p_quantity THEN -- NaN guard
    RAISE EXCEPTION 'DIASPORA_STOCK/INVALID_QUANTITY';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'DIASPORA_STOCK/UNAUTHENTICATED';
  END IF;

  -- 2. Lock the stock row for the duration of the transaction.
  SELECT * INTO v_item FROM public.diaspora_stock_items
    WHERE id = p_stock_item_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIASPORA_STOCK/NOT_FOUND';
  END IF;

  -- 3. Ownership/tenant authorization against the locked record (defense in depth with the service).
  IF NOT (
    p_actor_is_privileged
    OR v_item.created_by = p_actor_id
    OR v_item.updated_by = p_actor_id
    OR (p_tenant_id IS NOT NULL AND v_item.tenant_id IS NOT DISTINCT FROM p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'DIASPORA_STOCK/FORBIDDEN';
  END IF;

  -- 4. Idempotency: a prior movement with the same key is a replay (conflicting payload rejected).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.diaspora_stock_ledger
      WHERE stock_item_id = p_stock_item_id AND idempotency_key = p_idempotency_key AND deleted_at IS NULL
      LIMIT 1;
    IF FOUND THEN
      IF v_existing.action_type <> p_action
         OR COALESCE((v_existing.metadata->>'requestedQuantity'), '') <> p_quantity::text THEN
        RAISE EXCEPTION 'DIASPORA_STOCK/IDEMPOTENCY_CONFLICT';
      END IF;
      RETURN jsonb_build_object(
        'ledgerEntry', to_jsonb(v_existing),
        'stockItem', to_jsonb(v_item),
        'idempotentReplay', true,
        'balances', jsonb_build_object('onHand', v_item.quantity_on_hand, 'reserved', v_item.quantity_reserved, 'available', v_item.quantity_on_hand - v_item.quantity_reserved)
      );
    END IF;
  END IF;

  v_on_hand := COALESCE(v_item.quantity_on_hand, 0);
  v_reserved := COALESCE(v_item.quantity_reserved, 0);
  v_available := v_on_hand - v_reserved;

  -- 5. Compute new balances per action; reject anything that would violate integrity.
  IF p_action IN ('ADD','RETURN') THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'DIASPORA_STOCK/INVALID_QUANTITY'; END IF;
    v_new_on := v_on_hand + p_quantity; v_new_res := v_reserved;
  ELSIF p_action IN ('REMOVE','TRANSFER') THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'DIASPORA_STOCK/INVALID_QUANTITY'; END IF;
    IF p_quantity > v_available THEN RAISE EXCEPTION 'DIASPORA_STOCK/INSUFFICIENT_AVAILABLE: requested % available %', p_quantity, v_available; END IF;
    v_new_on := v_on_hand - p_quantity; v_new_res := v_reserved;
  ELSIF p_action = 'DAMAGE' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'DIASPORA_STOCK/INVALID_QUANTITY'; END IF;
    IF v_on_hand - p_quantity < v_reserved THEN RAISE EXCEPTION 'DIASPORA_STOCK/DAMAGE_BELOW_RESERVED'; END IF;
    v_new_on := v_on_hand - p_quantity; v_new_res := v_reserved;
  ELSIF p_action = 'RESERVE' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'DIASPORA_STOCK/INVALID_QUANTITY'; END IF;
    IF p_quantity > v_available THEN RAISE EXCEPTION 'DIASPORA_STOCK/INSUFFICIENT_AVAILABLE: requested % available %', p_quantity, v_available; END IF;
    v_new_on := v_on_hand; v_new_res := v_reserved + p_quantity;
  ELSIF p_action = 'RELEASE_RESERVATION' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'DIASPORA_STOCK/INVALID_QUANTITY'; END IF;
    IF p_quantity > v_reserved THEN RAISE EXCEPTION 'DIASPORA_STOCK/RELEASE_EXCEEDS_RESERVED: requested % reserved %', p_quantity, v_reserved; END IF;
    v_new_on := v_on_hand; v_new_res := v_reserved - p_quantity;
  ELSIF p_action = 'ADJUST_WITH_APPROVAL' THEN
    IF p_approval IS NULL OR (p_approval->>'approvedBy') IS NULL THEN RAISE EXCEPTION 'DIASPORA_STOCK/APPROVAL_REQUIRED'; END IF;
    IF NOT p_actor_is_privileged THEN RAISE EXCEPTION 'DIASPORA_STOCK/APPROVAL_ROLE_REQUIRED'; END IF;
    v_new_on := v_on_hand + p_quantity; v_new_res := v_reserved;
    IF v_new_on < 0 THEN RAISE EXCEPTION 'DIASPORA_STOCK/ADJUST_BELOW_ZERO'; END IF;
    IF v_new_on < v_new_res THEN RAISE EXCEPTION 'DIASPORA_STOCK/ADJUST_BELOW_RESERVED'; END IF;
  END IF;

  -- 6. Insert the immutable ledger row.
  INSERT INTO public.diaspora_stock_ledger (
    tenant_id, stock_item_id, import_order_id, supply_document_id, source_command_id,
    reference_document_id, action_type, quantity_delta, quantity_before, quantity_after,
    unit_cost, unit_price, currency, approval_status, execution_status, audit_lock,
    idempotency_key, notes, metadata, created_by, updated_by
  ) VALUES (
    COALESCE(v_item.tenant_id, p_tenant_id), p_stock_item_id, p_import_order_id, v_item.supply_document_id, p_source_command_id,
    p_reference_document_id, p_action, v_new_on - v_on_hand, v_on_hand, v_new_on,
    COALESCE(p_unit_cost, v_item.unit_cost), COALESCE(p_unit_price, v_item.unit_price), COALESCE(p_currency, v_item.currency, 'USD'),
    CASE WHEN p_action = 'ADJUST_WITH_APPROVAL' THEN 'APPROVED' ELSE 'NOT_REQUIRED' END, 'EXECUTED', true,
    p_idempotency_key, p_reason,
    jsonb_build_object(
      'requestedQuantity', p_quantity::text,
      'reservationRef', p_reservation_ref,
      'reservedBefore', v_reserved,
      'reservedAfter', v_new_res,
      'availableAfter', v_new_on - v_new_res,
      'approval', p_approval,
      'correlationId', p_correlation_id,
      'source', p_source
    ),
    p_actor_id, p_actor_id
  ) RETURNING * INTO v_ledger;

  -- 7. Update balances on the locked item row.
  UPDATE public.diaspora_stock_items
    SET quantity_on_hand = v_new_on, quantity_reserved = v_new_res, updated_by = p_actor_id, updated_at = v_ts
    WHERE id = p_stock_item_id
    RETURNING * INTO v_item;

  -- 8. CRITICAL audit row in the same transaction (rolls back with everything else on failure).
  v_seal := encode(digest(
    COALESCE(p_actor_id,'system') || '|STOCK_' || p_action || '|diaspora_stock_item|' || p_stock_item_id::text || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    import_order_id, tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    p_import_order_id, v_item.tenant_id, p_actor_id, 'STOCK_' || p_action, 'diaspora_stock_item', p_stock_item_id::text,
    jsonb_build_object('quantity_on_hand', v_on_hand, 'quantity_reserved', v_reserved),
    jsonb_build_object('quantity_on_hand', v_new_on, 'quantity_reserved', v_new_res),
    jsonb_build_object('ledgerEntryId', v_ledger.id, 'action', p_action, 'quantity', p_quantity, 'source', p_source),
    v_seal
  );

  RETURN jsonb_build_object(
    'ledgerEntry', to_jsonb(v_ledger),
    'stockItem', to_jsonb(v_item),
    'idempotentReplay', false,
    'balances', jsonb_build_object('onHand', v_new_on, 'reserved', v_new_res, 'available', v_new_on - v_new_res)
  );
END;
$$;

-- Only the backend service role may execute this function.
REVOKE ALL ON FUNCTION public.diaspora_append_stock_movement_atomic(
  uuid, text, uuid, boolean, text, numeric, text, uuid, text, uuid, uuid, numeric, numeric, text, text, jsonb, text, text
) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_append_stock_movement_atomic(
      uuid, text, uuid, boolean, text, numeric, text, uuid, text, uuid, uuid, numeric, numeric, text, text, jsonb, text, text
    ) TO service_role;
  END IF;
END;
$grant$;

-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_append_stock_movement_atomic(
  uuid, text, uuid, boolean, text, numeric, text, uuid, text, uuid, uuid, numeric, numeric, text, text, jsonb, text, text
);
