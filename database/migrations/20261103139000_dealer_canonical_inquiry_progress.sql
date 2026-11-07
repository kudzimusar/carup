-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
  -- …and the Down of this same version refuses to run later in this transaction (whole-file apply).
  PERFORM set_config('carup.dealer_migration_up_v20261103139000', txid_current()::text, true);
END
$txnmark$;
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2 / review 4: SET LOCAL is a silent no-op outside a transaction block, so a
  -- section applied statement by statement in autocommit (plain `psql -f`, an interactive paste)
  -- would lose its bounds and could apply half-way. When the marker set just above is not this
  -- transaction's own, the statements are not sharing one transaction: make the REST OF THIS
  -- SESSION read-only and return WITHOUT raising (a raise would roll the setting back; ending the
  -- session would let an interactive psql reconnect and run the remaining statements). Every later
  -- change in this session then fails with SQLSTATE 25006, so nothing can be applied half-way.
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM txid_current()::text THEN
    PERFORM set_config('default_transaction_read_only', 'on', false);
    PERFORM set_config('transaction_read_only', 'on', true);
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: this session is now read-only. Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section (Up OR Down).';
    RETURN;
  END IF;
END
$txnguard$;
-- C15 D7: dealer-reported follow-up moves canonical Marketplace inquiry status.
-- Restrict this to NEW->CONTACTED and CONTACTED->QUALIFIED for clear-risk
-- inquiries owned by an independently activated dealer tenant. Neither state
-- establishes payment, a completed sale, or Communications delivery.
DO $$
BEGIN
 IF to_regclass('public.marketplace_inquiries') IS NULL OR
    to_regclass('public.dealer_approved_seed_links') IS NULL THEN
   RAISE EXCEPTION 'CANONICAL_MARKETPLACE_AND_DEALER_AUTHORITY_REQUIRED';
 END IF;
END;
$$;
CREATE TABLE dealer_canonical_inquiry_progress_events(
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 inquiry_id UUID NOT NULL REFERENCES marketplace_inquiries(id) ON DELETE RESTRICT,
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 dealer_profile_id UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 previous_status TEXT NOT NULL CHECK(previous_status IN('new','contacted')),
 next_status TEXT NOT NULL CHECK(next_status IN('contacted','qualified')),
 seller_reported_only BOOLEAN NOT NULL DEFAULT true CHECK(seller_reported_only=true),
 buyer_contact_delivery_verified BOOLEAN NOT NULL DEFAULT false CHECK(buyer_contact_delivery_verified=false),
 transaction_status_modified BOOLEAN NOT NULL DEFAULT false CHECK(transaction_status_modified=false),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((previous_status='new' AND next_status='contacted')
   OR (previous_status='contacted' AND next_status='qualified')),
 UNIQUE(inquiry_id,previous_status,next_status)
);
CREATE INDEX dealer_inquiry_progress_tenant_idx ON dealer_canonical_inquiry_progress_events(tenant_id,created_at DESC);
ALTER TABLE dealer_canonical_inquiry_progress_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_canonical_inquiry_progress_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_canonical_inquiry_progress_events TO service_role;
CREATE TRIGGER dealer_inquiry_progress_no_update BEFORE UPDATE ON dealer_canonical_inquiry_progress_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_inquiry_progress_no_delete BEFORE DELETE ON dealer_canonical_inquiry_progress_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE FUNCTION dealer_advance_marketplace_inquiry(
 p_profile_id UUID,p_owner_id TEXT,p_inquiry_id UUID,p_requested_status TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 l dealer_approved_seed_links%ROWTYPE;
 i marketplace_inquiries%ROWTYPE;
 v_previous TEXT;
 v_event UUID;
BEGIN
 -- Recheck claim, country-policy, company compliance, membership and expiry
 -- inside this same database transaction, never trusting a client tenant ID.
 l:=dealer_assert_staff_owner(p_profile_id,p_owner_id);
 SELECT * INTO i FROM marketplace_inquiries WHERE id=p_inquiry_id FOR UPDATE;
 IF NOT FOUND OR i.seller_tenant_id IS DISTINCT FROM l.tenant_id::TEXT
   OR i.risk_status IS DISTINCT FROM 'clear' THEN
   RAISE EXCEPTION 'INQUIRY_NOT_OWNED_OR_NOT_ELIGIBLE';
 END IF;
 IF NOT ((i.status='new' AND p_requested_status='contacted') OR
         (i.status='contacted' AND p_requested_status='qualified')) THEN
   RAISE EXCEPTION 'DEALER_INQUIRY_TRANSITION_REFUSED';
 END IF;
 v_previous:=i.status;
 UPDATE marketplace_inquiries SET status=p_requested_status,updated_at=now()
   WHERE id=i.id AND seller_tenant_id=l.tenant_id::TEXT;
 INSERT INTO dealer_canonical_inquiry_progress_events(
   inquiry_id,tenant_id,dealer_profile_id,actor_user_id,previous_status,next_status)
 VALUES(i.id,l.tenant_id,l.dealer_profile_id,p_owner_id,v_previous,p_requested_status)
 RETURNING event_id INTO v_event;
 RETURN jsonb_build_object(
   'inquiry_id',i.id,'previous_status',v_previous,
   'status',p_requested_status,'followup_event_id',v_event,
   'seller_reported_only',true,'buyer_contact_delivery_verified',false,
   'payment_or_transaction_status_modified',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_advance_marketplace_inquiry(UUID,TEXT,UUID,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_advance_marketplace_inquiry(UUID,TEXT,UUID,TEXT)
 TO service_role;
COMMENT ON FUNCTION dealer_advance_marketplace_inquiry(UUID,TEXT,UUID,TEXT)
 IS 'Atomic owner-authorized seller progress only; canonical inquiry state + immutable audit. Does not send messages, close deals or bypass risk moderation.';

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
END
$txnmark$;
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2 / review 4: SET LOCAL is a silent no-op outside a transaction block, so a
  -- section applied statement by statement in autocommit (plain `psql -f`, an interactive paste)
  -- would lose its bounds and could apply half-way. When the marker set just above is not this
  -- transaction's own, the statements are not sharing one transaction: make the REST OF THIS
  -- SESSION read-only and return WITHOUT raising (a raise would roll the setting back; ending the
  -- session would let an interactive psql reconnect and run the remaining statements). Every later
  -- change in this session then fails with SQLSTATE 25006, so nothing can be applied half-way.
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM txid_current()::text THEN
    PERFORM set_config('default_transaction_read_only', 'on', false);
    PERFORM set_config('transaction_read_only', 'on', true);
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: this session is now read-only. Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section (Up OR Down).';
    RETURN;
  END IF;
  -- R6 DBA review 4 R1: this version's Up ran earlier in THIS transaction — a whole file (Up then
  -- Down) was applied as one transaction, which would silently undo itself. Refuse loudly; the
  -- whole transaction rolls back.
  IF current_setting('carup.dealer_migration_up_v20261103139000', true) = txid_current()::text THEN
    RAISE EXCEPTION 'DEALER_MIGRATION_WHOLE_FILE_APPLY_REFUSED: the Up and the Down of 20261103139000 ran in one transaction'
      USING HINT = 'Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section.';
  END IF;
END
$txnguard$;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_canonical_inquiry_progress_events) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_INQUIRY_AUDIT';
 END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_advance_marketplace_inquiry(UUID,TEXT,UUID,TEXT);
DROP TABLE IF EXISTS dealer_canonical_inquiry_progress_events;
