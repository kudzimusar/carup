-- +migrate Up
-- =============================================================================
-- Diaspora ledger #26 — entitlement overrides can be revoked and re-granted (Issue #127).
--
-- Ledger #12 gave diaspora_user_entitlement_overrides a soft-delete column AND a
-- FULL unique constraint:
--
--   CONSTRAINT uq_diaspora_user_override UNIQUE (tenant_id, user_id, feature_key)
--
-- Note what that constraint does NOT say: it has no `WHERE deleted_at IS NULL`.
-- (The only deleted_at-aware index on the table, idx_diaspora_overrides_tenant_user,
-- is a plain lookup index — it is not unique and enforces nothing.) So the unique
-- slot for a (tenant, user, feature) triple stays occupied by the soft-deleted row
-- forever.
--
-- applyAdminOverride searched with `.is('deleted_at', null)`, could not see the
-- tombstone, took the INSERT branch, and hit 23505. The service turned that into
-- `DatabaseError: Failed to write entitlement override: duplicate key value ...`
-- — a 500 whose message names a constraint rather than the situation. So:
--
--   · an entitlement override, once revoked, could NEVER be granted again for that
--     user and feature — not by any admin, not through any code path;
--   · the only signal was a 500 that reads like a database fault, so the operator's
--     conclusion is "the system is broken", not "this grant is permanently blocked";
--   · and there was no revoke path in the service at all, so the soft-deleted rows
--     that trigger this arrive from data fixes and support tooling, where nobody is
--     watching for the consequence.
--
-- Two RPCs replace the read-then-branch-then-write sequence.
--
-- APPLY (grant / update / re-grant) is one statement plus a lock:
--
--   · the logical row is taken FOR UPDATE first — INCLUDING a soft-deleted one, which
--     is exactly the row the old code could not see. A concurrent apply blocks here
--     rather than racing;
--   · the write is INSERT ... ON CONFLICT ON CONSTRAINT uq_diaspora_user_override
--     DO UPDATE, which sets deleted_at = NULL. Re-granting RESTORES the existing
--     logical row instead of trying to create a second one. The lock is not
--     sufficient on its own: when NO row exists yet there is nothing to lock, and two
--     concurrent first-grants serialise on the unique index instead — ON CONFLICT is
--     what turns the loser of that race into an update rather than a 23505;
--   · 23505 therefore cannot reach the caller from this path at all.
--
-- REVOKE is the missing half, and it is a real state transition rather than a DELETE:
-- the row stays, deleted_at is stamped under the same lock, and the audit row is
-- written in the same transaction.
--
-- AUDIT distinguishes the four outcomes — GRANTED (new), UPDATED (value changed on a
-- live row), REGRANTED (a revoked override brought back) and REVOKED. A single
-- "APPLIED" action for all of them would make the one event that actually matters —
-- a capability coming back to life after somebody took it away — indistinguishable
-- from an ordinary edit. Every audit row is written INSIDE the transaction that made
-- the change, so an override cannot change state without its record.
--
-- TENANT/USER/FEATURE IDENTITY is the function's own input and is used verbatim in
-- the WHERE, the INSERT and the audit row. The caller supplies no row id and no
-- filter, so there is no shape of request that can reach another tenant's override.
--
-- Additive: no table, column, constraint, index, policy or grant from ledger #12 is
-- modified. service_role-only EXECUTE; search_path pinned to include `extensions` so
-- pgcrypto's digest() resolves for the audit seal, exactly as ledger #18 established.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.diaspora_apply_entitlement_override_atomic(
  p_tenant_id uuid,
  p_user_id text,
  p_feature_key text,
  p_value jsonb,
  p_actor_id text,
  p_reason text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_prev public.diaspora_user_entitlement_overrides%ROWTYPE;
  v_row public.diaspora_user_entitlement_overrides%ROWTYPE;
  v_existed boolean := false;
  v_outcome text;
  v_action text;
  v_seal text;
  v_ts timestamptz := now();
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/TENANT_REQUIRED';
  END IF;
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/USER_REQUIRED';
  END IF;
  IF p_feature_key IS NULL OR btrim(p_feature_key) = '' THEN
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/FEATURE_REQUIRED';
  END IF;
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/VALUE_REQUIRED';
  END IF;
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    -- An override changes a security decision. An unattributable one is not acceptable.
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/ACTOR_REQUIRED';
  END IF;

  -- 1. Lock the logical row, soft-deleted or not. This is the row the old read could
  --    not see, and locking it is what makes the outcome classification below stable.
  SELECT * INTO v_prev
    FROM public.diaspora_user_entitlement_overrides
   WHERE tenant_id = p_tenant_id
     AND user_id = p_user_id
     AND feature_key = p_feature_key
     FOR UPDATE;
  v_existed := FOUND;

  IF NOT v_existed THEN
    v_outcome := 'GRANTED';
  ELSIF v_prev.deleted_at IS NOT NULL THEN
    v_outcome := 'REGRANTED';
  ELSIF v_prev.value IS DISTINCT FROM p_value THEN
    v_outcome := 'UPDATED';
  ELSE
    v_outcome := 'UNCHANGED';
  END IF;

  -- 2. One statement covers all four cases. DO UPDATE clears deleted_at, which is the
  --    whole point: a re-grant revives the existing row rather than colliding with it.
  INSERT INTO public.diaspora_user_entitlement_overrides AS o (
    tenant_id, user_id, feature_key, value, reason, created_by, updated_by, deleted_at
  ) VALUES (
    p_tenant_id, p_user_id, p_feature_key, p_value, p_reason, p_actor_id, p_actor_id, NULL
  )
  ON CONFLICT ON CONSTRAINT uq_diaspora_user_override DO UPDATE
    SET value = EXCLUDED.value,
        reason = EXCLUDED.reason,
        updated_by = EXCLUDED.updated_by,
        updated_at = v_ts,
        deleted_at = NULL
  RETURNING * INTO v_row;

  -- 3. Audit, in the same transaction, naming what actually happened. REGRANTED is
  --    deliberately its own action: a capability returning after a revoke is the event
  --    an auditor is looking for, and it must not read as an ordinary edit.
  v_action := CASE v_outcome
    WHEN 'GRANTED' THEN 'ENTITLEMENT_OVERRIDE_GRANTED'
    WHEN 'REGRANTED' THEN 'ENTITLEMENT_OVERRIDE_REGRANTED'
    WHEN 'UPDATED' THEN 'ENTITLEMENT_OVERRIDE_UPDATED'
    ELSE 'ENTITLEMENT_OVERRIDE_REAPPLIED'
  END;

  v_seal := encode(digest(
    p_actor_id || '|' || v_action || '|diaspora_user_entitlement_override|'
      || v_row.id::text || '|' || v_ts::text,
    'sha256'), 'hex');

  INSERT INTO public.diaspora_import_audit_log (
    tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    p_tenant_id, p_actor_id, v_action,
    'diaspora_user_entitlement_override', v_row.id::text,
    CASE WHEN v_existed
      THEN jsonb_build_object('value', v_prev.value, 'revoked', v_prev.deleted_at IS NOT NULL,
                              'revokedAt', v_prev.deleted_at)
      ELSE NULL END,
    jsonb_build_object('value', v_row.value, 'revoked', false),
    jsonb_build_object(
      'featureKey', p_feature_key,
      'userId', p_user_id,
      'outcome', v_outcome,
      'reason', p_reason,
      'correlationId', p_correlation_id),
    v_seal
  );

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'action', v_action,
    'override', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.diaspora_revoke_entitlement_override_atomic(
  p_tenant_id uuid,
  p_user_id text,
  p_feature_key text,
  p_actor_id text,
  p_reason text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_prev public.diaspora_user_entitlement_overrides%ROWTYPE;
  v_row public.diaspora_user_entitlement_overrides%ROWTYPE;
  v_seal text;
  v_ts timestamptz := now();
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/TENANT_REQUIRED';
  END IF;
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/ACTOR_REQUIRED';
  END IF;

  SELECT * INTO v_prev
    FROM public.diaspora_user_entitlement_overrides
   WHERE tenant_id = p_tenant_id
     AND user_id = p_user_id
     AND feature_key = p_feature_key
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/OVERRIDE_NOT_FOUND';
  END IF;

  -- Already revoked: an idempotent no-op. Stamping deleted_at again would rewrite when
  -- the capability was actually withdrawn, which is the one fact this column carries.
  IF v_prev.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'ALREADY_REVOKED',
      'action', 'ENTITLEMENT_OVERRIDE_REVOKED',
      'idempotentReplay', true,
      'override', to_jsonb(v_prev));
  END IF;

  UPDATE public.diaspora_user_entitlement_overrides
     SET deleted_at = v_ts,
         reason = COALESCE(p_reason, reason),
         updated_by = p_actor_id,
         updated_at = v_ts
   WHERE id = v_prev.id
  RETURNING * INTO v_row;

  v_seal := encode(digest(
    p_actor_id || '|ENTITLEMENT_OVERRIDE_REVOKED|diaspora_user_entitlement_override|'
      || v_row.id::text || '|' || v_ts::text,
    'sha256'), 'hex');

  INSERT INTO public.diaspora_import_audit_log (
    tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    p_tenant_id, p_actor_id, 'ENTITLEMENT_OVERRIDE_REVOKED',
    'diaspora_user_entitlement_override', v_row.id::text,
    jsonb_build_object('value', v_prev.value, 'revoked', false),
    jsonb_build_object('value', v_row.value, 'revoked', true, 'revokedAt', v_row.deleted_at),
    jsonb_build_object(
      'featureKey', p_feature_key,
      'userId', p_user_id,
      'outcome', 'REVOKED',
      'reason', p_reason,
      'correlationId', p_correlation_id),
    v_seal
  );

  RETURN jsonb_build_object(
    'outcome', 'REVOKED',
    'action', 'ENTITLEMENT_OVERRIDE_REVOKED',
    'idempotentReplay', false,
    'override', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.diaspora_apply_entitlement_override_atomic(uuid, text, text, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_apply_entitlement_override_atomic(uuid, text, text, jsonb, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.diaspora_apply_entitlement_override_atomic(uuid, text, text, jsonb, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_apply_entitlement_override_atomic(uuid, text, text, jsonb, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.diaspora_revoke_entitlement_override_atomic(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_revoke_entitlement_override_atomic(uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.diaspora_revoke_entitlement_override_atomic(uuid, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_revoke_entitlement_override_atomic(uuid, text, text, text, text, text) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_apply_entitlement_override_atomic(uuid, text, text, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.diaspora_revoke_entitlement_override_atomic(uuid, text, text, text, text, text);
