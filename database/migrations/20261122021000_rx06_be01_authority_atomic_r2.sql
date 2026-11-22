-- +migrate Up
-- CARUP-RX06-BE-01-P0 LR02 R2. Standalone on f269ec03; R1 NOT required.
-- F13/F15 atomic mutations, F1/F16/F17 order/audit authorization. PRIVATE. NO SHARED DB.
-- Quote issue, order status, and both critical audit facts commit/rollback as one statement.
-- This RPC is service_role-only and independently authorizes against database-held identities.
-- Operator applies directly to disposable PostgreSQL using psql ON_ERROR_STOP=1.
-- Safe to apply twice. SQL must be executed in a single transaction (BEGIN/COMMIT below).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.diaspora_quote_issue_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_order_id uuid NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  command_key text NOT NULL CHECK (length(command_key) BETWEEN 8 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  quote_id uuid NOT NULL UNIQUE REFERENCES public.diaspora_import_quotes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_order_id, actor_id, command_key)
);
ALTER TABLE public.diaspora_quote_issue_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_quote_issue_commands FROM PUBLIC, anon, authenticated;
DO $grant_commands$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT ON public.diaspora_quote_issue_commands TO service_role;
  END IF;
END $grant_commands$;

CREATE OR REPLACE FUNCTION public.diaspora_issue_import_quote_atomic(
  p_order_id uuid,
  p_actor_id text,
  p_quote jsonb,
  p_command_key text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $quote$
DECLARE
  v_order public.diaspora_import_orders%ROWTYPE;
  v_quote public.diaspora_import_quotes%ROWTYPE;
  v_existing public.diaspora_quote_issue_commands%ROWTYPE;
  v_actor_role text;
  v_is_privileged boolean;
  v_tenant_admin boolean;
  v_is_assigned boolean;
  v_seller text;
  v_amount numeric;
  v_currency text;
  v_inclusions jsonb;
  v_exclusions jsonb;
  v_metadata jsonb;
  v_valid_until timestamptz;
  v_payload_hash text;
  v_status_changed boolean;
  v_previous_status text;
  v_seal text;
  v_ts timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL OR length(p_actor_id) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RX06_QUOTE_AUTH_REQUIRED';
  END IF;
  IF p_quote IS NULL OR jsonb_typeof(p_quote) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_INVALID_PAYLOAD';
  END IF;
  IF p_command_key IS NOT NULL AND (
      length(p_command_key) NOT BETWEEN 8 AND 128 OR p_command_key !~ '^[A-Za-z0-9._:-]+$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_INVALID_COMMAND_KEY';
  END IF;
  IF length(p_quote::text) > 16384 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_PAYLOAD_TOO_LARGE';
  END IF;

  -- Serializes the entire command, including retries, status and audit writes.
  SELECT * INTO v_order FROM public.diaspora_import_orders
    WHERE id = p_order_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'RX06_QUOTE_ORDER_NOT_FOUND';
  END IF;

  v_previous_status := v_order.status;

  -- No authorization is inferred from an order id, seller_id, tenant header or client role.
  SELECT lower(role) INTO v_actor_role FROM public.users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RX06_QUOTE_AUTH_REQUIRED';
  END IF;
  v_is_privileged := v_actor_role IN (
    'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer');

  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users tu
     WHERE tu.user_id = p_actor_id AND tu.tenant_id = v_order.tenant_id
       AND lower(tu.role) IN ('admin','administrator','tenant_admin')
  ) INTO v_tenant_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.diaspora_import_order_participants p
     WHERE p.import_order_id = v_order.id AND p.user_id = p_actor_id
       AND p.deleted_at IS NULL
       AND p.tenant_id IS NOT DISTINCT FROM v_order.tenant_id
       AND lower(coalesce(p.verification_status,'active')) NOT IN
           ('cancelled','deleted','inactive','rejected','removed','revoked','suspended')
       AND p.participant_role IN ('seller','exporter','agent','dealer','company','coordinator')
  ) INTO v_is_assigned;

  IF NOT (v_is_privileged OR v_tenant_admin OR v_is_assigned) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RX06_QUOTE_ORDER_ACCESS_DENIED';
  END IF;

  v_seller := nullif(btrim(p_quote->>'seller_id'), '');
  IF NOT v_is_privileged THEN
    IF v_seller IS NOT NULL AND v_seller <> p_actor_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RX06_QUOTE_SELLER_SPOOFING';
    END IF;
    v_seller := p_actor_id;
  ELSIF v_seller IS NOT NULL AND v_seller <> p_actor_id AND NOT EXISTS (
      SELECT 1 FROM public.diaspora_import_order_participants pp
      WHERE pp.import_order_id = v_order.id AND pp.user_id = v_seller
        AND pp.deleted_at IS NULL AND pp.tenant_id IS NOT DISTINCT FROM v_order.tenant_id
        AND lower(coalesce(pp.verification_status,'active')) NOT IN
          ('cancelled','deleted','inactive','rejected','removed','revoked','suspended')
        AND pp.participant_role IN ('seller','exporter','dealer','company')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RX06_QUOTE_SELLER_NOT_ASSIGNED';
  END IF;

  IF (p_quote->>'quote_amount') IS NULL OR
     (p_quote->>'quote_amount') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_INVALID_AMOUNT';
  END IF;
  v_amount := (p_quote->>'quote_amount')::numeric;
  IF v_amount < 0.01 OR v_amount > 9999999999.99 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_INVALID_AMOUNT';
  END IF;
  v_currency := coalesce(nullif(p_quote->>'quote_currency',''),'USD');
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_INVALID_CURRENCY';
  END IF;
  v_inclusions := coalesce(p_quote->'inclusions', '[]'::jsonb);
  v_exclusions := coalesce(p_quote->'exclusions', '[]'::jsonb);
  v_metadata := coalesce(p_quote->'metadata', '{}'::jsonb);
  IF jsonb_typeof(v_inclusions) <> 'array' OR jsonb_typeof(v_exclusions) <> 'array'
     OR jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_INVALID_FIELDS';
  END IF;
  IF p_quote->>'valid_until' IS NOT NULL THEN
    v_valid_until := (p_quote->>'valid_until')::timestamptz;
  END IF;

  -- Scoped, persistent idempotency; exact command returns its original quote.
  -- Different payload with the same key conflicts even when the order is already quoted.
  v_payload_hash := encode(digest(
    jsonb_build_object('seller_id',v_seller,'quote_amount',v_amount,
      'quote_currency',v_currency,'valid_until',v_valid_until,'inclusions',v_inclusions,
      'exclusions',v_exclusions,'metadata',v_metadata)::text, 'sha256'), 'hex');
  IF p_command_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.diaspora_quote_issue_commands
      WHERE import_order_id = p_order_id AND actor_id = p_actor_id
        AND command_key = p_command_key;
    IF FOUND THEN
      IF v_existing.payload_hash <> v_payload_hash THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'RX06_QUOTE_IDEMPOTENCY_CONFLICT';
      END IF;
      SELECT * INTO v_quote FROM public.diaspora_import_quotes
        WHERE id = v_existing.quote_id AND deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'RX06_QUOTE_RECEIPT_MISSING';
      END IF;
      RETURN jsonb_build_object('order',to_jsonb(v_order),'quote',to_jsonb(v_quote),
        'idempotentReplay',true,'statusChanged',false);
    END IF;
  END IF;

  -- Only currently quote-issuing order states are legal for a NEW decision.
  -- Idempotent replay was intentionally resolved before this check.
  IF v_order.status NOT IN ('IMPORT_REQUESTED','QUOTE_ISSUED','SELLER_ASSIGNED') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_ILLEGAL_ORDER_STATE';
  END IF;
  v_status_changed := v_order.status <> 'QUOTE_ISSUED';

  -- The following writes, including audit, are one PostgreSQL transaction.
  INSERT INTO public.diaspora_import_quotes (
    import_order_id,tenant_id,seller_id,quote_amount,quote_currency,valid_until,
    inclusions,exclusions,metadata,created_by,updated_by
  ) VALUES (
    v_order.id,v_order.tenant_id,v_seller,v_amount,v_currency,v_valid_until,
    v_inclusions,v_exclusions,v_metadata,p_actor_id,p_actor_id
  ) RETURNING * INTO v_quote;

  IF v_status_changed THEN
    UPDATE public.diaspora_import_orders
       SET status = 'QUOTE_ISSUED',updated_by = p_actor_id,updated_at = v_ts,
           metadata = coalesce(metadata,'{}'::jsonb) ||
                      jsonb_build_object('last_transition',jsonb_build_object('quoteId',v_quote.id))
     WHERE id = v_order.id RETURNING * INTO v_order;
  END IF;

  v_seal := encode(digest(
      p_actor_id || '|QUOTE_ISSUED|diaspora_import_quote|' || v_quote.id::text || '|' || v_ts::text,
      'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    import_order_id,tenant_id,actor_id,action,resource_type,resource_id,
    previous_state,new_state,metadata,cryptographic_seal,ip_address,user_agent
  ) VALUES (
    v_order.id,v_order.tenant_id,p_actor_id,'QUOTE_ISSUED','diaspora_import_quote',v_quote.id::text,
    NULL,to_jsonb(v_quote),'{}'::jsonb,v_seal,left(p_ip_address,128),left(p_user_agent,512)
  );

  IF v_status_changed THEN
    v_seal := encode(digest(
      p_actor_id || '|IMPORT_ORDER_STATUS_CHANGED|diaspora_import_order|' || v_order.id::text || '|' || v_ts::text,
      'sha256'), 'hex');
    INSERT INTO public.diaspora_import_audit_log (
      import_order_id,tenant_id,actor_id,action,resource_type,resource_id,
      previous_state,new_state,metadata,cryptographic_seal,ip_address,user_agent
    ) VALUES (
      v_order.id,v_order.tenant_id,p_actor_id,'IMPORT_ORDER_STATUS_CHANGED',
      'diaspora_import_order',v_order.id::text,
      jsonb_build_object('status', v_previous_status),jsonb_build_object('status','QUOTE_ISSUED'),
      jsonb_build_object('quoteId',v_quote.id),v_seal,left(p_ip_address,128),left(p_user_agent,512)
    );
  END IF;

  -- Transactional outbox: no client-side event before commit, no orphaned event on rollback.
  IF v_status_changed THEN
    INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
    VALUES ('DIASPORA_QUOTE_ISSUED',
      jsonb_build_object('importOrderId',v_order.id,'status',v_order.status,
                         'actorId',p_actor_id,'quoteId',v_quote.id),
      'pending',0,v_order.tenant_id::text);
  END IF;

  IF p_command_key IS NOT NULL THEN
    INSERT INTO public.diaspora_quote_issue_commands (
      import_order_id,actor_id,command_key,payload_hash,quote_id
    ) VALUES (v_order.id,p_actor_id,p_command_key,v_payload_hash,v_quote.id);
  END IF;

  RETURN jsonb_build_object('order',to_jsonb(v_order),'quote',to_jsonb(v_quote),
    'idempotentReplay',false,'statusChanged',v_status_changed);
END;
$quote$;

REVOKE ALL ON FUNCTION public.diaspora_issue_import_quote_atomic(uuid,text,jsonb,text,text,text)
  FROM PUBLIC,anon,authenticated;
DO $grant_quote$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_issue_import_quote_atomic(uuid,text,jsonb,text,text,text)
      TO service_role;
  END IF;
END $grant_quote$;

-- Direct authenticated PostgREST table inserts/updates could bypass the governed
-- API transaction. All quote mutations in this architecture use the service role.
-- Do not revoke SELECT: order/participant read-models remain governed separately.
REVOKE INSERT, UPDATE, DELETE ON public.diaspora_import_quotes FROM anon, authenticated;


-- F15: seller assignment must not create a participant BEFORE authority is proven.
-- Same locked transaction handles record, status, mandatory audits, and outbox.
CREATE OR REPLACE FUNCTION public.diaspora_assign_import_seller_atomic(
  p_order_id uuid,
  p_actor_id text,
  p_seller_id text,
  p_role_type text DEFAULT 'seller',
  p_notes text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $assign$
DECLARE
  v_order public.diaspora_import_orders%ROWTYPE;
  v_part public.diaspora_import_order_participants%ROWTYPE;
  v_role text;
  v_reviewer boolean;
  v_tenant_admin boolean;
  v_owner boolean;
  v_old_status text;
  v_change boolean;
  v_seal text;
  v_ts timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='RX06_ASSIGN_AUTH_REQUIRED';
  END IF;
  IF p_seller_id IS NULL OR btrim(p_seller_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='RX06_ASSIGN_SELLER_REQUIRED';
  END IF;
  IF p_role_type IS NULL OR p_role_type NOT IN ('seller','exporter','agent','dealer','company','coordinator') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='RX06_ASSIGN_ROLE_INVALID';
  END IF;
  IF length(coalesce(p_notes,'')) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='RX06_ASSIGN_NOTES_TOO_LONG';
  END IF;
  SELECT * INTO v_order FROM public.diaspora_import_orders
    WHERE id=p_order_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='RX06_ASSIGN_ORDER_NOT_FOUND';
  END IF;
  v_old_status:=v_order.status;
  SELECT lower(role) INTO v_role FROM public.users WHERE id=p_actor_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='RX06_ASSIGN_AUTH_REQUIRED';
  END IF;
  v_reviewer := v_role IN ('platform_admin','super_admin','government','government_reviewer','reviewer');
  SELECT EXISTS(SELECT 1 FROM public.tenant_users tu
    WHERE tu.user_id=p_actor_id AND tu.tenant_id=v_order.tenant_id
    AND lower(tu.role) IN ('admin','administrator','tenant_admin')) INTO v_tenant_admin;
  v_owner := p_actor_id IN (coalesce(v_order.buyer_id,''),coalesce(v_order.created_by,''));
  IF NOT (v_reviewer OR v_tenant_admin OR v_owner) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='RX06_ASSIGN_ORDER_ACCESS_DENIED';
  END IF;
  IF v_order.status NOT IN ('IMPORT_REQUESTED','QUOTE_ISSUED','SELLER_ASSIGNED') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='RX06_ASSIGN_ILLEGAL_ORDER_STATE';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_seller_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='RX06_ASSIGN_SELLER_UNKNOWN';
  END IF;
  -- Never grant oneself a seller participant through this endpoint when one is the buyer.
  IF p_seller_id=p_actor_id AND v_owner AND NOT v_reviewer AND NOT v_tenant_admin THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='RX06_ASSIGN_SELF_SELLER_DENIED';
  END IF;
  SELECT * INTO v_part FROM public.diaspora_import_order_participants
    WHERE import_order_id=v_order.id AND user_id=p_seller_id AND participant_role=p_role_type
      AND tenant_id IS NOT DISTINCT FROM v_order.tenant_id
      AND deleted_at IS NULL
      AND lower(coalesce(verification_status,'active')) NOT IN
        ('cancelled','deleted','inactive','rejected','removed','revoked','suspended')
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('order',to_jsonb(v_order),'participant',to_jsonb(v_part),
      'idempotentReplay',true,'statusChanged',false);
  END IF;

  INSERT INTO public.diaspora_import_order_participants (
    tenant_id, import_order_id, user_id, participant_role, notes, created_by, updated_by
  ) VALUES (v_order.tenant_id,v_order.id,p_seller_id,p_role_type,p_notes,p_actor_id,p_actor_id)
  RETURNING * INTO v_part;

  v_change := v_order.status <> 'SELLER_ASSIGNED';
  IF v_change THEN
    UPDATE public.diaspora_import_orders
      SET status='SELLER_ASSIGNED', updated_by=p_actor_id, updated_at=v_ts,
          metadata=coalesce(metadata,'{}'::jsonb) ||
            jsonb_build_object('last_transition',jsonb_build_object('sellerId',p_seller_id))
      WHERE id=v_order.id RETURNING * INTO v_order;
  END IF;
  v_seal:=encode(digest(p_actor_id||'|SELLER_ASSIGNED|diaspora_import_order_participant|'||
        v_part.id::text||'|'||v_ts::text,'sha256'),'hex');
  INSERT INTO public.diaspora_import_audit_log(
    import_order_id,tenant_id,actor_id,action,resource_type,resource_id,
    new_state,metadata,cryptographic_seal,ip_address,user_agent)
  VALUES(v_order.id,v_order.tenant_id,p_actor_id,'SELLER_ASSIGNED',
    'diaspora_import_order_participant',v_part.id::text,
    to_jsonb(v_part),jsonb_build_object('sellerId',p_seller_id),v_seal,
    left(p_ip_address,128),left(p_user_agent,512));
  IF v_change THEN
    v_seal:=encode(digest(p_actor_id||'|IMPORT_ORDER_STATUS_CHANGED|diaspora_import_order|'||
      v_order.id::text||'|'||v_ts::text,'sha256'),'hex');
    INSERT INTO public.diaspora_import_audit_log(
      import_order_id,tenant_id,actor_id,action,resource_type,resource_id,
      previous_state,new_state,metadata,cryptographic_seal,ip_address,user_agent)
    VALUES(v_order.id,v_order.tenant_id,p_actor_id,'IMPORT_ORDER_STATUS_CHANGED',
      'diaspora_import_order',v_order.id::text,
      jsonb_build_object('status',v_old_status),jsonb_build_object('status',v_order.status),
      jsonb_build_object('sellerId',p_seller_id),v_seal,
      left(p_ip_address,128),left(p_user_agent,512));
  END IF;
  INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
  VALUES('DIASPORA_SELLER_ASSIGNED',
    jsonb_build_object('importOrderId',v_order.id,'status',v_order.status,
       'actorId',p_actor_id,'sellerId',p_seller_id),
    'pending',0,v_order.tenant_id::text);
  RETURN jsonb_build_object('order',to_jsonb(v_order),'participant',to_jsonb(v_part),
    'idempotentReplay',false,'statusChanged',v_change);
END;
$assign$;

-- Mandatory grant boundaries, repeatable without a migration ledger.
REVOKE ALL ON FUNCTION public.diaspora_assign_import_seller_atomic(uuid,text,text,text,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_assign_import_seller_atomic(uuid,text,text,text,text,text,text)
 TO service_role;
REVOKE ALL ON FUNCTION public.diaspora_issue_import_quote_atomic(uuid,text,jsonb,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_issue_import_quote_atomic(uuid,text,jsonb,text,text,text)
 TO service_role;

-- Supabase service-role API bypasses RLS. Stop direct authenticated REST from
-- bypassing the corrected owner, participant, quote and audit authority boundaries.
-- Direct reads of government-document raw rows are also closed: only the server's
-- access-checked category/status projection is public to an authorized actor.
REVOKE ALL ON public.diaspora_import_orders FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.diaspora_import_order_participants FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.diaspora_import_quotes FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.diaspora_import_audit_log FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.vehicle_government_documents FROM PUBLIC,anon,authenticated;
-- Service-role table permissions are verified explicitly by the execution operator.
-- Preserve existing service_role ownership/grants; never create new broad grants.

COMMIT;
-- +migrate Down
-- Deliberately no automatic down: security grants must not be silently restored.
-- Reversal requires explicit Owner approval, a reviewed data migration, and a
-- separate governance decision for historic command receipts and linked quotes.
