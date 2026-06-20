-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Hardening H2: atomic quote acceptance RPC
--
-- Replaces the multi-call accept/reject/update loop with ONE transaction:
-- lock the order, validate authority, accept exactly one submitted quote, reject
-- sibling submitted quotes, stamp the order, and write a critical audit row.
-- Idempotent for the same accepted quote; conflicts on a different accepted quote.
--
-- Additive, backwards-compatible. NOT applied to production by this program.
-- =============================================================

CREATE OR REPLACE FUNCTION public.diaspora_accept_quote_atomic(
  p_order_id uuid,
  p_quote_id uuid,
  p_actor_id text,
  p_tenant_id uuid,
  p_actor_is_privileged boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.diaspora_import_orders%ROWTYPE;
  v_quote public.diaspora_import_quotes%ROWTYPE;
  v_meta jsonb;
  v_accepted_existing text;
  v_seal text;
  v_ts timestamptz := now();
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'DIASPORA_QUOTE/UNAUTHENTICATED'; END IF;

  -- 1. Lock the order.
  SELECT * INTO v_order FROM public.diaspora_import_orders
    WHERE id = p_order_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_QUOTE/NOT_FOUND_ORDER'; END IF;

  -- 2. Only the buyer/owner or a privileged actor may accept.
  IF NOT (p_actor_is_privileged OR v_order.buyer_id = p_actor_id OR v_order.created_by = p_actor_id) THEN
    RAISE EXCEPTION 'DIASPORA_QUOTE/FORBIDDEN';
  END IF;

  -- 3. Idempotency / conflict on already-accepted quote.
  v_accepted_existing := v_order.metadata #>> '{rfq,acceptedQuoteId}';
  IF v_accepted_existing IS NOT NULL THEN
    IF v_accepted_existing = p_quote_id::text THEN
      SELECT * INTO v_quote FROM public.diaspora_import_quotes WHERE id = p_quote_id;
      RETURN jsonb_build_object('order', to_jsonb(v_order), 'acceptedQuote', to_jsonb(v_quote), 'idempotentReplay', true);
    END IF;
    RAISE EXCEPTION 'DIASPORA_QUOTE/ALREADY_ACCEPTED_DIFFERENT';
  END IF;

  -- 4. Lock the selected quote and validate.
  SELECT * INTO v_quote FROM public.diaspora_import_quotes
    WHERE id = p_quote_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_QUOTE/NOT_FOUND_QUOTE'; END IF;
  IF v_quote.import_order_id <> p_order_id THEN RAISE EXCEPTION 'DIASPORA_QUOTE/QUOTE_NOT_IN_ORDER'; END IF;
  IF v_quote.status <> 'ISSUED' THEN RAISE EXCEPTION 'DIASPORA_QUOTE/NOT_SUBMITTED'; END IF;

  -- 5. Accept the chosen quote.
  UPDATE public.diaspora_import_quotes
    SET status = 'ACCEPTED', updated_by = p_actor_id, updated_at = v_ts
    WHERE id = p_quote_id RETURNING * INTO v_quote;

  -- 6. Reject sibling submitted quotes for this order.
  UPDATE public.diaspora_import_quotes
    SET status = 'REJECTED', updated_by = p_actor_id, updated_at = v_ts
    WHERE import_order_id = p_order_id AND id <> p_quote_id AND status = 'ISSUED' AND deleted_at IS NULL;

  -- 7. Stamp the order.
  v_meta := COALESCE(v_order.metadata, '{}'::jsonb);
  IF v_meta->'rfq' IS NULL THEN v_meta := jsonb_set(v_meta, '{rfq}', '{}'::jsonb, true); END IF;
  v_meta := jsonb_set(v_meta, '{rfq,acceptedQuoteId}', to_jsonb(p_quote_id::text), true);
  v_meta := jsonb_set(v_meta, '{rfq,acceptedAt}', to_jsonb(v_ts::text), true);
  UPDATE public.diaspora_import_orders
    SET metadata = v_meta, status = 'SELLER_ASSIGNED', updated_by = p_actor_id, updated_at = v_ts
    WHERE id = p_order_id RETURNING * INTO v_order;

  -- 8. Critical audit in the same transaction.
  v_seal := encode(digest(
    COALESCE(p_actor_id,'system') || '|RFQ_QUOTE_ACCEPTED|diaspora_import_quote|' || p_quote_id::text || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    import_order_id, tenant_id, actor_id, action, resource_type, resource_id, previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    p_order_id, v_order.tenant_id, p_actor_id, 'RFQ_QUOTE_ACCEPTED', 'diaspora_import_quote', p_quote_id::text,
    NULL, to_jsonb(v_quote), jsonb_build_object('orderId', p_order_id::text), v_seal
  );

  RETURN jsonb_build_object('order', to_jsonb(v_order), 'acceptedQuote', to_jsonb(v_quote), 'idempotentReplay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.diaspora_accept_quote_atomic(uuid, uuid, text, uuid, boolean) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_accept_quote_atomic(uuid, uuid, text, uuid, boolean) TO service_role;
  END IF;
END;
$grant$;

-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_accept_quote_atomic(uuid, uuid, text, uuid, boolean);
