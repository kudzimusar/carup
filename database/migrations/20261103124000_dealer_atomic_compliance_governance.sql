-- +migrate Up
SET LOCAL carup.dealer_migration_txn = 'on';
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2: SET LOCAL is a silent no-op outside a transaction block, so a migration
  -- run statement by statement in autocommit (plain `psql -f`) would lose its lock_timeout and
  -- could apply half-way. Refuse, and end the session so the client cannot run the remaining
  -- statements. Apply with backend/scripts/dealership/applyDealerMigrations.mjs or
  -- `psql -1 -v ON_ERROR_STOP=1` (one transaction per migration section).
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: use the dealership migration runner or psql -1 -v ON_ERROR_STOP=1';
    BEGIN
      PERFORM pg_terminate_backend(pg_backend_pid());
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION';
  END IF;
END
$txnguard$;
-- CARUP-DEALER-ONB-001 D2/C10 — repair the legacy two-write dealer
-- governance path. This is an additive RPC over EXISTING canonical
-- dealer_profiles / dealer_compliance_requirements / dealer_compliance_decisions.
-- No tenant, role, source, vehicle, payment or publication grant is made.
CREATE OR REPLACE FUNCTION dealer_record_atomic_compliance_decision(
  p_dealer_id UUID, p_reviewer_id TEXT, p_decision TEXT,
  p_requirement_key TEXT, p_reason TEXT, p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
  v_profile dealer_profiles%ROWTYPE;
  v_reviewer users%ROWTYPE;
  v_requirement dealer_compliance_requirements%ROWTYPE;
  v_event dealer_compliance_decisions%ROWTYPE;
  v_expiry TIMESTAMPTZ;
BEGIN
  IF p_decision NOT IN ('approve_requirement','reject_requirement','request_more_info',
                       'restrict','suspend','reinstate','set_expiry')
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 40 AND 3000
    OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'INVALID_COMPLIANCE_GOVERNANCE_DECISION';
  END IF;

  SELECT * INTO v_profile FROM dealer_profiles WHERE id=p_dealer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_DEALER_PROFILE'; END IF;
  SELECT * INTO v_reviewer FROM users WHERE id=p_reviewer_id;
  IF NOT FOUND OR v_reviewer.is_verified IS DISTINCT FROM true
      OR v_reviewer.role NOT IN ('admin','reviewer','platform_admin','super_admin')
      OR v_reviewer.id=v_profile.user_id THEN
    RAISE EXCEPTION 'INDEPENDENT_COMPLIANCE_REVIEWER_REQUIRED';
  END IF;

  IF p_decision IN ('approve_requirement','reject_requirement','request_more_info') THEN
    IF length(btrim(coalesce(p_requirement_key,'')))<2 THEN
      RAISE EXCEPTION 'REQUIREMENT_KEY_REQUIRED';
    END IF;
    SELECT * INTO v_requirement FROM dealer_compliance_requirements
      WHERE dealer_id=p_dealer_id AND requirement_key=p_requirement_key
      ORDER BY created_at,id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REQUIREMENT_NOT_REGISTERED'; END IF;
  END IF;

  IF p_decision='set_expiry' THEN
    IF NOT p_payload ? 'expiry_date' OR
       jsonb_typeof(p_payload->'expiry_date')<>'string' OR
       length(coalesce(p_payload->>'expiry_date','')) NOT BETWEEN 10 AND 40 THEN
       RAISE EXCEPTION 'VALID_EXPIRY_DATE_REQUIRED';
    END IF;
    BEGIN
      v_expiry := (p_payload->>'expiry_date')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'VALID_EXPIRY_DATE_REQUIRED';
    END;
  END IF;

  -- Reinstate cannot flip a legally unverified, expired, investigated or
  -- requirement-blocked company to an active public-eligible posture.
  IF p_decision='reinstate' THEN
    IF v_profile.identity_status<>'verified'
      OR v_profile.compliance_review_state<>'passed'
      OR v_profile.investigation_state<>'none'
      OR (v_profile.expiry_date IS NOT NULL AND v_profile.expiry_date<=now())
      OR EXISTS (
        SELECT 1 FROM dealer_compliance_requirements r
         WHERE r.dealer_id=p_dealer_id AND r.is_blocking
           AND r.status NOT IN ('verified','not_applicable')
      ) THEN
      RAISE EXCEPTION 'REINSTATEMENT_COMPLIANCE_GATE_FAILED';
    END IF;
  END IF;

  INSERT INTO dealer_compliance_decisions(
    dealer_id,decision,requirement_key,actor_id,actor_role,reason,payload
  ) VALUES (
    p_dealer_id,p_decision,nullif(btrim(p_requirement_key),''),
    v_reviewer.id,v_reviewer.role,btrim(p_reason),p_payload
  ) RETURNING * INTO v_event;

  IF p_decision IN ('approve_requirement','reject_requirement','request_more_info') THEN
    UPDATE dealer_compliance_requirements SET status=CASE p_decision
      WHEN 'approve_requirement' THEN 'verified'
      WHEN 'reject_requirement' THEN 'rejected' ELSE 'pending' END,
      updated_at=now()
     WHERE id=v_requirement.id;
  ELSIF p_decision='restrict' THEN
    UPDATE dealer_profiles SET restriction_state='restricted',updated_at=now()
     WHERE id=p_dealer_id;
  ELSIF p_decision='suspend' THEN
    UPDATE dealer_profiles SET suspension_state='suspended',
      active_state='inactive',updated_at=now() WHERE id=p_dealer_id;
  ELSIF p_decision='reinstate' THEN
    UPDATE dealer_profiles SET suspension_state='none',
      restriction_state='none',active_state='active',updated_at=now()
     WHERE id=p_dealer_id;
  ELSIF p_decision='set_expiry' THEN
    UPDATE dealer_profiles SET expiry_date=v_expiry,updated_at=now()
     WHERE id=p_dealer_id;
  END IF;

  SELECT * INTO v_profile FROM dealer_profiles WHERE id=p_dealer_id;
  RETURN jsonb_build_object(
    'decision',to_jsonb(v_event),'profile',to_jsonb(v_profile),
    'audit_atomic',true,'tenant_activated',false,'business_verified_by_decision',false
  );
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_atomic_compliance_decision(UUID,TEXT,TEXT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_atomic_compliance_decision(UUID,TEXT,TEXT,TEXT,TEXT,JSONB)
  TO service_role;

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
SET LOCAL carup.dealer_migration_txn = 'on';
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2: SET LOCAL is a silent no-op outside a transaction block, so a migration
  -- run statement by statement in autocommit (plain `psql -f`) would lose its lock_timeout and
  -- could apply half-way. Refuse, and end the session so the client cannot run the remaining
  -- statements. Apply with backend/scripts/dealership/applyDealerMigrations.mjs or
  -- `psql -1 -v ON_ERROR_STOP=1` (one transaction per migration section).
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: use the dealership migration runner or psql -1 -v ON_ERROR_STOP=1';
    BEGIN
      PERFORM pg_terminate_backend(pg_backend_pid());
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION';
  END IF;
END
$txnguard$;
DROP FUNCTION IF EXISTS dealer_record_atomic_compliance_decision(UUID,TEXT,TEXT,TEXT,TEXT,JSONB);
