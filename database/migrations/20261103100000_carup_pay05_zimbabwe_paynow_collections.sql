-- +migrate Up
-- CARUP-PAY-05-LR01 — Zimbabwe collections: a garage's customer pays the GARAGE's own Paynow merchant integration.
--
-- Builds on PAY-04 (20261102110000) without a second ledger:
--   * A Paynow merchant is a pay04_garage_merchant_accounts row (gateway paynow_zimbabwe) with a legal profile
--     (pay05_merchant_profiles) and one integration per currency (pay05_merchant_integrations). Its integration key is
--     stored here only as AES-256-GCM ciphertext sealed by the backend; the key-encryption key never enters the database.
--   * The garage administrator registers it. A CarUp platform administrator who is neither the registrant nor a member of
--     the garage verifies it (reviewer separation, with an authenticated credential probe per integration), rejects it or
--     suspends it. Every step lands in an append-only audit.
--   * A Paynow checkout is a pay04_garage_collections row plus pay05_paynow_transactions (merchant trace, poll URL,
--     method). Every authenticated Paynow message is an append-only observation. Money moves only through the PAY-04
--     governed writer (pay04_apply_garage_provider_snapshot) or a PAY-04 discrepancy.
--   * Paynow documents no cancel, no expiry and no merchant refund API. A Paynow checkout therefore holds its room until
--     Paynow reports a terminal status; a lost initiation reply never "closes" until an authenticated trace finds
--     nothing; and an operator may release the hold of an unpaid, expired checkout only after a fresh authenticated read.
--     Late money then follows the PAY-04 unallocated-money path — never a double count.
--   * Disputed, an unrecognised status, money after close and a refund Paynow cannot quantify are operator reviews,
--     never silent state changes. Real Paynow (test or live) stays switched off by a constraint: enabling it is a
--     reviewed activation migration, not a runtime flag.
-- Nine accepted functions are replaced by byte-identical copies plus bounded Paynow hunks; every hunk is re-derived from
-- the accepted text by backend/tests/pay05-pay04-function-drift.test.js.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.pay04_garage_merchant_accounts') IS NULL
     OR to_regclass('public.pay04_garage_collections') IS NULL
     OR to_regprocedure('public.pay04_apply_garage_provider_snapshot(uuid,text,text,text,text,text,bigint,text,text,bigint,bigint,text[],text,text)') IS NULL
     OR to_regprocedure('public.pay04_record_discrepancy(public.pay04_garage_collections,text,numeric,jsonb,text,text)') IS NULL
     OR to_regprocedure('public.pay04_reproject_garage_collection(uuid,text,text)') IS NULL
     OR to_regprocedure('public.garage_ops03_assert_admin(uuid,text)') IS NULL
     OR to_regprocedure('public.pay03b_is_platform_admin(text)') IS NULL
     OR to_regprocedure('public.pay03b_payment_payer_conflict(text,text)') IS NULL THEN
    RAISE EXCEPTION 'PAY05_REQUIRES_PAY04_20261102110000';
  END IF;
END $$;

-- ─────────────────────────── 0. runtime guard ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay05_runtime_guard (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  -- the local Paynow PROTOCOL simulator (disposable environments only)
  paynow_simulator_enabled boolean NOT NULL DEFAULT false,
  -- real Paynow (test or live) needs Owner + provider authorization (issue #252, Checkpoint G): enabling it is a
  -- reviewed activation migration that drops this constraint, never a runtime switch
  paynow_real_enabled boolean NOT NULL DEFAULT false
    CONSTRAINT pay05_real_paynow_requires_activation_migration CHECK (NOT paynow_real_enabled),
  -- the operator's switch: Paynow collections on or off for every garage (an incident, a provider outage)
  paynow_available boolean NOT NULL DEFAULT true,
  availability_note text CHECK (availability_note IS NULL OR char_length(btrim(availability_note)) BETWEEN 10 AND 300),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL DEFAULT session_user
);
INSERT INTO public.pay05_runtime_guard (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;
DROP TRIGGER IF EXISTS trg_pay05_stamp_runtime_guard ON public.pay05_runtime_guard;
CREATE TRIGGER trg_pay05_stamp_runtime_guard BEFORE UPDATE ON public.pay05_runtime_guard
  FOR EACH ROW EXECUTE FUNCTION public.pay04_stamp_runtime_guard();

CREATE OR REPLACE FUNCTION public.pay05_mode_permitted(p_mode text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT CASE p_mode WHEN 'simulator' THEN paynow_simulator_enabled
                                      WHEN 'paynow_test' THEN paynow_real_enabled
                                      WHEN 'paynow_live' THEN paynow_real_enabled
                                      ELSE false END
                     FROM public.pay05_runtime_guard WHERE singleton), false);
$$;

-- ─────────────────────────── 1. PAY-04 tables admit the Paynow gateway (bounded, gateway-bound shapes) ───────────────────────────

CREATE OR REPLACE FUNCTION pg_temp.pay05_drop_column_checks(p_table regclass, p_column text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
  FOR v IN SELECT c.conname FROM pg_constraint c
            WHERE c.conrelid = p_table AND c.contype = 'c'
              AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = p_table AND a.attname = p_column)]::smallint[] LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table, v.conname);
  END LOOP;
END $$;

SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_merchant_accounts', 'gateway');
SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_merchant_accounts', 'merchant_reference');
SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_merchant_accounts', 'status');
ALTER TABLE public.pay04_garage_merchant_accounts
  ADD CONSTRAINT pay05_merchant_gateway CHECK (gateway IN ('pay04_garage_provider_simulator', 'paynow_zimbabwe')),
  ADD CONSTRAINT pay05_merchant_reference_by_gateway CHECK (
    (gateway = 'pay04_garage_provider_simulator' AND merchant_reference ~ '^gsim_merchant_[A-Za-z0-9_]{4,64}$')
    OR (gateway = 'paynow_zimbabwe' AND merchant_reference ~ '^pnm_[0-9a-f]{32}$')),
  ADD CONSTRAINT pay05_merchant_status_by_gateway CHECK (
    (gateway = 'pay04_garage_provider_simulator' AND status IN ('simulated', 'suspended'))
    OR (gateway = 'paynow_zimbabwe' AND status IN ('pending_verification', 'verified', 'suspended', 'rejected')));
DROP INDEX IF EXISTS public.uq_pay04_one_live_merchant_per_garage_gateway;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay04_one_live_merchant_per_garage_gateway
  ON public.pay04_garage_merchant_accounts (tenant_id, gateway) WHERE status NOT IN ('suspended', 'rejected');

SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_collections', 'gateway');
SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_collections', 'provider_checkout_id');
SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_collections', 'provider_payment_id');
ALTER TABLE public.pay04_garage_collections
  ADD CONSTRAINT pay05_collection_gateway CHECK (gateway IN ('pay04_garage_provider_simulator', 'paynow_zimbabwe')),
  ADD CONSTRAINT pay05_collection_provider_ids_by_gateway CHECK (
    (gateway = 'pay04_garage_provider_simulator'
       AND (provider_checkout_id IS NULL OR provider_checkout_id ~ '^gsim_co_[A-Za-z0-9_]+$')
       AND (provider_payment_id IS NULL OR provider_payment_id ~ '^sim_pi_gar_[A-Za-z0-9_]+$'))
    OR (gateway = 'paynow_zimbabwe'
       AND (provider_checkout_id IS NULL OR provider_checkout_id ~ '^pn_trace_[A-Za-z0-9]{8,32}$')
       AND (provider_payment_id IS NULL OR provider_payment_id ~ '^pn_poll_[0-9a-f]{40}$')));

SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_payment_discrepancies', 'discrepancy_type');
ALTER TABLE public.pay04_garage_payment_discrepancies ADD CONSTRAINT pay05_discrepancy_type CHECK (discrepancy_type IN (
  'unallocated_provider_money', 'amount_mismatch', 'currency_mismatch', 'merchant_mismatch', 'refund_after_resolution',
  -- PAY-05 (Paynow): money held in a dispute; a status word Paynow does not document; a refund Paynow cannot quantify;
  -- money Paynow took after CarUp had closed the payment
  'provider_disputed', 'provider_status_unrecognized', 'provider_refund_unquantified', 'provider_paid_after_close'));

SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_collection_events', 'event_type');
ALTER TABLE public.pay04_garage_collection_events ADD CONSTRAINT pay05_collection_event_type CHECK (event_type IN (
  'initiated', 'provider_attached', 'provider_observed', 'allocated', 'deallocated', 'receipt_issued', 'receipt_voided',
  'refund_requested', 'cancelled', 'discrepancy_opened', 'discrepancy_observed', 'discrepancy_resolved', 'hold_released'));

-- ─────────────────────────── 2. the garage's Paynow merchant: legal profile, integrations, audit ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay05_merchant_profiles (
  merchant_account_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_name text NOT NULL CHECK (char_length(btrim(legal_entity_name)) BETWEEN 2 AND 160),
  registration_number text CHECK (registration_number IS NULL OR registration_number ~ '^[A-Za-z0-9/ .-]{2,40}$'),
  settlement_bank_name text NOT NULL CHECK (char_length(btrim(settlement_bank_name)) BETWEEN 2 AND 80),
  settlement_account_last4 text NOT NULL CHECK (settlement_account_last4 ~ '^[0-9]{4}$'),
  settlement_account_holder text NOT NULL CHECK (char_length(btrim(settlement_account_holder)) BETWEEN 2 AND 160),
  attestation text NOT NULL CHECK (char_length(btrim(attestation)) BETWEEN 20 AND 600),
  attested_by text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pay05_profile_merchant_fk FOREIGN KEY (merchant_account_id, tenant_id)
    REFERENCES public.pay04_garage_merchant_accounts(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.pay05_merchant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  merchant_account_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('simulator', 'paynow_test', 'paynow_live')),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  integration_id text NOT NULL CHECK (integration_id ~ '^[0-9]{1,12}$'),
  methods text[] NOT NULL CHECK (cardinality(methods) BETWEEN 1 AND 5
    AND methods <@ ARRAY['web', 'ecocash', 'onemoney', 'innbucks', 'omari']::text[]),
  -- the integration key, sealed by the backend (AES-256-GCM, AAD-bound to this row's identity); never plaintext
  credential_ciphertext text NOT NULL CHECK (credential_ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$' AND char_length(credential_ciphertext) <= 1024),
  credential_iv text NOT NULL CHECK (credential_iv ~ '^[A-Za-z0-9+/]{16}$'),
  credential_tag text NOT NULL CHECK (credential_tag ~ '^[A-Za-z0-9+/]{22}==$'),
  credential_key_version smallint NOT NULL CHECK (credential_key_version >= 1),
  credential_fingerprint text NOT NULL CHECK (credential_fingerprint ~ '^[0-9a-f]{16}$'),
  status text NOT NULL CHECK (status IN ('pending_verification', 'verified', 'suspended', 'rejected')),
  registered_by text NOT NULL,
  registered_role text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_by text,
  verified_role text,
  verified_at timestamptz,
  verification_evidence jsonb,
  closed_by text,
  closed_reason text,
  closed_at timestamptz,
  CONSTRAINT pay05_integration_merchant_fk FOREIGN KEY (merchant_account_id, tenant_id)
    REFERENCES public.pay04_garage_merchant_accounts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pay05_integration_id_tenant_unique UNIQUE (id, tenant_id),
  -- Paynow: "InnBucks is a USD only payment option"
  CONSTRAINT pay05_innbucks_usd_only CHECK (NOT ('innbucks' = ANY (methods)) OR currency = 'USD'),
  CONSTRAINT pay05_integration_verified_truth CHECK (
    (verified_at IS NULL) = (verified_by IS NULL) AND (verified_at IS NULL) = (verified_role IS NULL)
    AND (verified_at IS NULL) = (verification_evidence IS NULL)
    AND (status <> 'verified' OR verified_at IS NOT NULL)),
  CONSTRAINT pay05_integration_closed_truth CHECK (
    (status IN ('suspended', 'rejected')) = (closed_at IS NOT NULL AND closed_by IS NOT NULL AND closed_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay05_one_live_integration_per_currency
  ON public.pay05_merchant_integrations (merchant_account_id, currency) WHERE status IN ('pending_verification', 'verified');
-- one live owner per Paynow integration ID: garage B can never register garage A's integration
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay05_integration_id_one_live_owner
  ON public.pay05_merchant_integrations (mode, integration_id) WHERE status IN ('pending_verification', 'verified');

CREATE TABLE IF NOT EXISTS public.pay05_merchant_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid,
  merchant_account_id uuid,
  integration_row_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'merchant_registered', 'integration_registered', 'merchant_verified', 'integration_verified', 'merchant_rejected',
    'integration_rejected', 'merchant_suspended', 'integration_suspended', 'availability_changed', 'hold_released')),
  actor text NOT NULL,
  actor_role text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_pay05_audit_merchant ON public.pay05_merchant_audit_events (merchant_account_id, seq);

-- ─────────────────────────── 3. Paynow transactions, observations, provider errors ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay05_paynow_transactions (
  collection_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  integration_row_id uuid NOT NULL,
  merchant_trace text NOT NULL UNIQUE CHECK (merchant_trace ~ '^[A-Za-z0-9]{8,32}$'),
  method text NOT NULL CHECK (method IN ('web', 'ecocash', 'onemoney', 'innbucks', 'omari')),
  phone_masked text CHECK (phone_masked IS NULL OR phone_masked ~ '^07[0-9]\*{5}[0-9]{2}$'),
  initiation_state text NOT NULL CHECK (initiation_state IN ('sending', 'attached', 'refused', 'unknown', 'traced_absent')),
  poll_url text CHECK (poll_url IS NULL OR (poll_url ~ '^https?://[^\s]+$' AND char_length(poll_url) <= 600)),
  browser_url text CHECK (browser_url IS NULL OR (browser_url ~ '^https?://[^\s]+$' AND char_length(browser_url) <= 600)),
  remote_otp_url text CHECK (remote_otp_url IS NULL OR (remote_otp_url ~ '^https?://[^\s]+$' AND char_length(remote_otp_url) <= 600)),
  instructions text CHECK (instructions IS NULL OR char_length(instructions) <= 500),
  authorization_code text CHECK (authorization_code IS NULL OR authorization_code ~ '^[A-Za-z0-9]{4,32}$'),
  authorization_expires text CHECK (authorization_expires IS NULL OR char_length(authorization_expires) <= 40),
  otp_reference text CHECK (otp_reference IS NULL OR char_length(otp_reference) <= 64),
  paynow_reference text CHECK (paynow_reference IS NULL OR char_length(paynow_reference) <= 64),
  provider_status text CHECK (provider_status IS NULL OR provider_status IN (
    'created', 'sent', 'awaiting_delivery', 'delivered', 'paid', 'cancelled', 'failed', 'disputed', 'refunded', 'unrecognized')),
  provider_status_at timestamptz,
  provider_error text CHECK (provider_error IS NULL OR char_length(provider_error) <= 160),
  -- the SHA-256 of the last signed status update applied: Paynow's messages carry no sequence number, so an identical
  -- message right after itself is a resend (a duplicate), and after a different one it is a new event
  last_status_update_hash text CHECK (last_status_update_hash IS NULL OR last_status_update_hash ~ '^[0-9a-f]{64}$'),
  trace_absent_count integer NOT NULL DEFAULT 0 CHECK (trace_absent_count >= 0),
  first_trace_absent_at timestamptz,
  hold_released_at timestamptz,
  hold_released_by text,
  hold_release_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pay05_tx_collection_fk FOREIGN KEY (collection_id, tenant_id)
    REFERENCES public.pay04_garage_collections(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pay05_tx_integration_fk FOREIGN KEY (integration_row_id, tenant_id)
    REFERENCES public.pay05_merchant_integrations(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pay05_tx_hold_release_truth CHECK (
    (hold_released_at IS NULL) = (hold_released_by IS NULL) AND (hold_released_at IS NULL) = (hold_release_reason IS NULL)),
  CONSTRAINT pay05_tx_attached_truth CHECK ((initiation_state = 'attached') = (poll_url IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.pay05_paynow_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  event_id text UNIQUE CHECK (event_id IS NULL OR event_id ~ '^evt_pn_[0-9a-f]{40}$'),
  via text NOT NULL CHECK (via IN ('status_update', 'poll', 'trace', 'otp_reply')),
  provider_status text NOT NULL CHECK (provider_status IN (
    'created', 'sent', 'awaiting_delivery', 'delivered', 'paid', 'cancelled', 'failed', 'disputed', 'refunded', 'unrecognized')),
  raw_status text CHECK (raw_status IS NULL OR char_length(raw_status) <= 160),
  amount_minor bigint,
  paynow_reference text CHECK (paynow_reference IS NULL OR char_length(paynow_reference) <= 64),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pay05_observation_collection_fk FOREIGN KEY (collection_id, tenant_id)
    REFERENCES public.pay04_garage_collections(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pay05_observations_collection ON public.pay05_paynow_observations (collection_id, seq);

CREATE TABLE IF NOT EXISTS public.pay05_provider_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid,
  collection_id uuid,
  merchant_account_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'callback_signature_invalid', 'callback_binding_mismatch', 'callback_malformed', 'provider_unreachable',
    'provider_refused', 'provider_unauthenticated', 'provider_url_refused', 'provider_unexpected', 'poll_failed',
    'trace_failed', 'otp_rejected', 'credential_probe_failed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(detail::text) <= 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_pay05_provider_errors_recent ON public.pay05_provider_errors (created_at DESC);

-- ─────────────────────────── 4. guards ───────────────────────────

DROP TRIGGER IF EXISTS trg_pay05_audit_append_only ON public.pay05_merchant_audit_events;
CREATE TRIGGER trg_pay05_audit_append_only BEFORE UPDATE OR DELETE ON public.pay05_merchant_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.pay04_append_only();
DROP TRIGGER IF EXISTS trg_pay05_observations_append_only ON public.pay05_paynow_observations;
CREATE TRIGGER trg_pay05_observations_append_only BEFORE UPDATE OR DELETE ON public.pay05_paynow_observations
  FOR EACH ROW EXECUTE FUNCTION public.pay04_append_only();
DROP TRIGGER IF EXISTS trg_pay05_provider_errors_append_only ON public.pay05_provider_errors;
CREATE TRIGGER trg_pay05_provider_errors_append_only BEFORE UPDATE OR DELETE ON public.pay05_provider_errors
  FOR EACH ROW EXECUTE FUNCTION public.pay04_append_only();
DROP TRIGGER IF EXISTS trg_pay05_profiles_immutable ON public.pay05_merchant_profiles;
CREATE TRIGGER trg_pay05_profiles_immutable BEFORE UPDATE OR DELETE ON public.pay05_merchant_profiles
  FOR EACH ROW EXECUTE FUNCTION public.pay04_append_only();

-- An integration's identity and sealed key never change; it is verified or closed once.
CREATE OR REPLACE FUNCTION public.pay05_guard_integration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY05_INTEGRATION_IMMUTABLE'; END IF;
  IF NOT ((OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected', 'suspended'))
          OR (OLD.status = 'verified' AND NEW.status = 'suspended'))
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.merchant_account_id IS DISTINCT FROM OLD.merchant_account_id OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.integration_id IS DISTINCT FROM OLD.integration_id
     OR NEW.methods IS DISTINCT FROM OLD.methods OR NEW.credential_ciphertext IS DISTINCT FROM OLD.credential_ciphertext
     OR NEW.credential_iv IS DISTINCT FROM OLD.credential_iv OR NEW.credential_tag IS DISTINCT FROM OLD.credential_tag
     OR NEW.credential_key_version IS DISTINCT FROM OLD.credential_key_version
     OR NEW.credential_fingerprint IS DISTINCT FROM OLD.credential_fingerprint
     OR NEW.registered_by IS DISTINCT FROM OLD.registered_by OR NEW.registered_role IS DISTINCT FROM OLD.registered_role
     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
     OR (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at
         OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verification_evidence IS DISTINCT FROM OLD.verification_evidence)) THEN
    RAISE EXCEPTION 'PAY05_INTEGRATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay05_guard_integration ON public.pay05_merchant_integrations;
CREATE TRIGGER trg_pay05_guard_integration BEFORE UPDATE OR DELETE ON public.pay05_merchant_integrations
  FOR EACH ROW EXECUTE FUNCTION public.pay05_guard_integration();

-- A Paynow transaction's identity is fixed; its poll URL and hold release are written once; its initiation state only
-- moves forward.
CREATE OR REPLACE FUNCTION public.pay05_guard_paynow_transaction()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY05_TRANSACTION_IMMUTABLE'; END IF;
  IF NEW.collection_id IS DISTINCT FROM OLD.collection_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.integration_row_id IS DISTINCT FROM OLD.integration_row_id OR NEW.merchant_trace IS DISTINCT FROM OLD.merchant_trace
     OR NEW.method IS DISTINCT FROM OLD.method OR NEW.phone_masked IS DISTINCT FROM OLD.phone_masked
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.poll_url IS NOT NULL AND NEW.poll_url IS DISTINCT FROM OLD.poll_url)
     OR (OLD.hold_released_at IS NOT NULL AND (NEW.hold_released_at IS DISTINCT FROM OLD.hold_released_at
         OR NEW.hold_released_by IS DISTINCT FROM OLD.hold_released_by OR NEW.hold_release_reason IS DISTINCT FROM OLD.hold_release_reason))
     OR NOT (NEW.initiation_state = OLD.initiation_state
             OR (OLD.initiation_state = 'sending' AND NEW.initiation_state IN ('attached', 'refused', 'unknown'))
             OR (OLD.initiation_state = 'unknown' AND NEW.initiation_state IN ('attached', 'traced_absent'))) THEN
    RAISE EXCEPTION 'PAY05_TRANSACTION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay05_guard_paynow_transaction ON public.pay05_paynow_transactions;
CREATE TRIGGER trg_pay05_guard_paynow_transaction BEFORE UPDATE OR DELETE ON public.pay05_paynow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.pay05_guard_paynow_transaction();

-- ─────────────────────────── 5. helpers the replaced PAY-04 functions consult ───────────────────────────

CREATE OR REPLACE FUNCTION public.pay05_hold_released(p_collection_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.pay05_paynow_transactions WHERE collection_id = p_collection_id AND hold_released_at IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.pay05_initiation_unresolved(p_collection_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.pay05_paynow_transactions
                  WHERE collection_id = p_collection_id AND initiation_state IN ('sending', 'unknown'));
$$;

CREATE OR REPLACE FUNCTION public.pay05_verified_integration(p_merchant_account_id uuid, p_currency text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT i.id FROM public.pay05_merchant_integrations i
   WHERE i.merchant_account_id = p_merchant_account_id AND i.currency = p_currency AND i.status = 'verified'
     AND public.pay05_mode_permitted(i.mode)
   ORDER BY i.verified_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.pay05_latest_provider_status(p_collection_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT provider_status FROM public.pay05_paynow_transactions WHERE collection_id = p_collection_id;
$$;

-- ─────────────────────────── 6. accepted functions, replaced by exact copies + bounded Paynow hunks ───────────────────────────

-- pay04_gateway_permitted: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_gateway_permitted(p_gateway text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (p_gateway = 'pay04_garage_provider_simulator'
     AND coalesce((SELECT garage_simulator_enabled FROM public.pay04_runtime_guard WHERE singleton), false))
      -- PAY-05: the garage's own Paynow integration, while CarUp has Paynow available in a permitted mode
      OR (p_gateway = 'paynow_zimbabwe'
          AND coalesce((SELECT paynow_available AND (paynow_simulator_enabled OR paynow_real_enabled)
                          FROM public.pay05_runtime_guard WHERE singleton), false));
$$;


-- pay04_guard_merchant_account: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_guard_merchant_account()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY04_MERCHANT_ACCOUNT_IMMUTABLE'; END IF;
  IF NOT ((OLD.gateway = 'pay04_garage_provider_simulator' AND OLD.status = 'simulated' AND NEW.status = 'suspended')
          -- PAY-05: a Paynow merchant is verified or rejected once, and may always be suspended
          OR (OLD.gateway = 'paynow_zimbabwe' AND OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected', 'suspended'))
          OR (OLD.gateway = 'paynow_zimbabwe' AND OLD.status = 'verified' AND NEW.status = 'suspended'))
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.gateway IS DISTINCT FROM OLD.gateway
     OR NEW.merchant_reference IS DISTINCT FROM OLD.merchant_reference OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NEW.currencies IS DISTINCT FROM OLD.currencies OR NEW.authority_note IS DISTINCT FROM OLD.authority_note
     OR NEW.registered_by IS DISTINCT FROM OLD.registered_by OR NEW.registered_role IS DISTINCT FROM OLD.registered_role
     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at THEN
    RAISE EXCEPTION 'PAY04_MERCHANT_ACCOUNT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

-- pay04_invoice_money: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_invoice_money(p_invoice_id uuid)
RETURNS TABLE (
  invoice_id uuid, currency text, invoice_status text, total_amount numeric, declared_paid numeric, provider_paid numeric,
  paid_amount numeric, balance_amount numeric, provider_reserved numeric, uncommitted_balance numeric, payment_status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH inv AS (SELECT * FROM public.garage_invoices WHERE id = p_invoice_id),
  d AS (SELECT COALESCE(sum(CASE WHEN r.kind = 'payment' THEN r.amount ELSE -r.amount END), 0) AS net
          FROM public.garage_payment_records r WHERE r.invoice_id = p_invoice_id),
  a AS (SELECT COALESCE(sum(CASE WHEN x.kind = 'allocation' THEN x.amount ELSE -x.amount END), 0) AS net
          FROM public.pay04_garage_payment_allocations x WHERE x.invoice_id = p_invoice_id),
  -- A pending checkout stays reserved until the PROVIDER says it is closed: a stop or CarUp's own expiry is not proof
  -- that it cannot still be paid. Refunds in progress, holds and disagreeing evidence are reserved too, and so are the
  -- pending refunds of a final partial refund (they may still fail and the money come back).
  r AS (
    SELECT COALESCE(sum(CASE
             WHEN (p.status IN ('pending', 'refund_pending', 'reconciliation_hold')
                   -- PAY-05: an operator released this unpaid Paynow checkout's hold after an authenticated read
                   AND NOT (p.status = 'pending' AND public.pay05_hold_released(c.id)))
               OR EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q
                           WHERE q.collection_id = c.id AND q.status = 'open'
                             AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch',
                                                        'provider_disputed', 'provider_status_unrecognized'))
               THEN greatest(c.amount - public.pay04_collection_allocated(c.id), 0)
             WHEN p.status = 'partially_refunded'
               THEN coalesce((SELECT x.held_minor FROM public.pay04_partial_refund_position(c) x), 0)::numeric
                    / (10 ^ c.currency_scale)::numeric
             ELSE 0 END), 0) AS reserved
      FROM public.pay04_garage_collections c
      JOIN public.payment_transactions p ON p.reference = c.payment_reference
     WHERE c.invoice_id = p_invoice_id)
  SELECT inv.id, inv.currency, inv.status, inv.total_amount::numeric(14,2), d.net::numeric(14,2), a.net::numeric(14,2),
         (d.net + a.net)::numeric(14,2), (inv.total_amount - d.net - a.net)::numeric(14,2), r.reserved::numeric(14,2),
         greatest(inv.total_amount - d.net - a.net - r.reserved, 0)::numeric(14,2),
         CASE WHEN inv.status = 'voided' THEN 'voided'
              WHEN d.net + a.net = 0 THEN 'unpaid'
              WHEN d.net + a.net < inv.total_amount THEN 'partially_paid'
              ELSE 'paid' END
    FROM inv, d, a, r;
$$;


-- pay03b_payment_transition_target: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay03b_payment_transition_target(
  p_row public.payment_transactions,
  p_amount_minor bigint,
  p_status text,
  p_intent_id text,
  p_refund_id text,
  p_refunded_minor bigint,
  p_pending_refund_minor bigint,
  p_refund_ids text[],
  p_mismatch text,
  p_detected_via text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_target text := p_status;
  v_retained boolean := false;
  v_ref text;
  v_intent_pattern text;
  v_refund_pattern text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded', 'reconciliation_hold') THEN
    RAISE EXCEPTION 'PAY01A_STATUS_INVALID';
  END IF;
  IF p_detected_via IS NOT NULL AND p_detected_via NOT IN ('signed_webhook', 'provider_readback') THEN
    RAISE EXCEPTION 'PAY03B_DETECTION_SOURCE_INVALID';
  END IF;

  -- A held or finally-revoked payment never returns to an access-granting state from a provider observation;
  -- only a provider-confirmed full refund (or the operator resolution RPC) moves it.
  IF p_row.status = 'reconciliation_hold' THEN
    IF p_status = 'refunded' THEN
      v_target := 'refunded';
    ELSIF p_status IN ('paid', 'refund_pending', 'reconciliation_hold') THEN
      v_target := 'reconciliation_hold';
      v_retained := p_status <> 'reconciliation_hold';
    ELSE
      RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
    END IF;
  ELSIF p_row.status = 'partially_refunded' THEN
    IF p_status = 'refunded' THEN
      v_target := 'refunded';
    ELSIF p_status IN ('paid', 'refund_pending', 'reconciliation_hold') THEN
      v_target := 'partially_refunded';
      v_retained := true;
    ELSE
      RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
    END IF;
  ELSIF NOT (
    (p_row.status = 'pending' AND p_status IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'paid' AND p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'refund_pending' AND p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'refunded' AND p_status = 'refunded')
    OR (p_row.status = 'cancelled' AND p_status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
  END IF;

  -- Provider identifier shapes are bound to the payment's gateway (the local UAT simulator never passes as Stripe).
  v_intent_pattern := CASE WHEN p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator') THEN '^sim_pi_[A-Za-z0-9_]+$'
                           -- PAY-05: a Paynow payment is identified by its poll URL (pn_poll_<sha256 prefix>)
                           WHEN p_row.gateway = 'paynow_zimbabwe' THEN '^pn_poll_[0-9a-f]{40}$'
                           ELSE '^pi_[A-Za-z0-9_]+$' END;
  v_refund_pattern := CASE WHEN p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator') THEN '^sim_re_[A-Za-z0-9_]+$'
                           -- PAY-05: Paynow issues no refund identifiers (refunds happen in its dashboard): none can match
                           WHEN p_row.gateway = 'paynow_zimbabwe' THEN '^pn_refund_[0-9a-f]{40}$'
                           ELSE '^(re|pyr)_[A-Za-z0-9_]+$' END;
  -- Leaving a hold (or a final partial refund) for 'refunded' requires the provider's full-refund evidence: a caller
  -- without amounts (for example the legacy PAY-01A writer) cannot close an exception as a "provider full refund".
  IF p_row.status IN ('reconciliation_hold', 'partially_refunded') AND v_target = 'refunded'
     AND (p_refunded_minor IS DISTINCT FROM p_amount_minor OR coalesce(p_pending_refund_minor, 0) <> 0) THEN
    RAISE EXCEPTION 'PAY03B_FULL_REFUND_EVIDENCE_REQUIRED';
  END IF;

  IF p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold') AND
    (p_intent_id IS NULL OR p_intent_id !~ v_intent_pattern) THEN
    RAISE EXCEPTION 'PAY01A_PAYMENT_INTENT_REQUIRED';
  END IF;
  IF p_row.pay01a_intent_id IS NOT NULL AND p_intent_id IS NOT NULL
     AND p_intent_id IS DISTINCT FROM p_row.pay01a_intent_id THEN
    RAISE EXCEPTION 'PAY01A_PAYMENT_INTENT_CHANGE_REFUSED';
  END IF;
  IF p_refund_id IS NOT NULL AND p_refund_id !~ v_refund_pattern THEN
    RAISE EXCEPTION 'PAY01A_REFUND_REFERENCE_INVALID';
  END IF;
  IF p_row.pay01a_refund_id IS NOT NULL AND p_refund_id IS NOT NULL AND p_refund_id <> p_row.pay01a_refund_id THEN
    RAISE EXCEPTION 'PAY01A_REFUND_REFERENCE_CHANGE_REFUSED';
  END IF;

  -- Policy-conflict evidence must be complete and internally consistent before it can hold a payment.
  IF p_status = 'reconciliation_hold' THEN
    IF p_mismatch IS NULL OR p_mismatch NOT IN ('partial_refund_succeeded', 'partial_refund_pending')
       OR p_amount_minor IS NULL OR p_amount_minor <= 0
       OR p_refunded_minor IS NULL OR p_pending_refund_minor IS NULL
       OR p_refunded_minor < 0 OR p_pending_refund_minor < 0
       OR p_refunded_minor + p_pending_refund_minor > p_amount_minor
       OR (p_mismatch = 'partial_refund_succeeded'
           AND (p_refunded_minor <= 0 OR p_refunded_minor >= p_amount_minor))
       OR (p_mismatch = 'partial_refund_pending'
           AND (p_refunded_minor <> 0 OR p_pending_refund_minor <= 0 OR p_pending_refund_minor >= p_amount_minor))
       OR p_refund_ids IS NULL OR cardinality(p_refund_ids) = 0
       OR p_detected_via IS NULL
       OR p_refund_id IS NOT NULL THEN
      RAISE EXCEPTION 'PAY03B_RECONCILIATION_EVIDENCE_INVALID';
    END IF;
    FOREACH v_ref IN ARRAY p_refund_ids LOOP
      IF v_ref IS NULL OR v_ref !~ v_refund_pattern THEN
        RAISE EXCEPTION 'PAY03B_RECONCILIATION_EVIDENCE_INVALID';
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('target_status', v_target, 'hold_retained', v_retained);
END $$;



-- pay04_reproject_garage_collection: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_reproject_garage_collection(p_collection_id uuid, p_cause text, p_event_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_inv public.garage_invoices%ROWTYPE;
  v_receipt public.pay04_garage_provider_receipts%ROWTYPE;
  v_target numeric;
  v_current numeric;
  v_alloc numeric;
  v_delta numeric;
  v_room numeric;
  v_declared numeric;
  v_provider numeric;
  v_pos record;
  v_unallocated numeric;
  v_receipt_out jsonb := NULL;
  v_discrepancy jsonb := NULL;
  v_actor text;
BEGIN
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  SELECT * INTO v_inv FROM public.garage_invoices WHERE id = v_c.invoice_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference;
  v_actor := 'provider:' || v_c.gateway;
  PERFORM set_config('carup.pay04_writer', 'on', true);

  IF v_p.status = 'paid' THEN
    v_target := v_c.amount;
  ELSIF v_p.status = 'partially_refunded' THEN
    -- the operator's verified final partial refund is a floor, never a licence to ignore what the provider reports later
    SELECT * INTO v_pos FROM public.pay04_partial_refund_position(v_c);
    IF v_pos.verified_minor IS NULL THEN RAISE EXCEPTION 'PAY04_PARTIAL_REFUND_EVIDENCE_MISSING'; END IF;
    v_target := (v_pos.counted_minor::numeric / (10 ^ v_c.currency_scale)::numeric)::numeric(14,2);
    IF v_pos.extra_minor > 0 THEN
      v_discrepancy := public.pay04_record_discrepancy(v_c, 'refund_after_resolution',
        (v_pos.extra_minor::numeric / (10 ^ v_c.currency_scale)::numeric)::numeric(14,2),
        jsonb_build_object('verified_refunded_minor', v_pos.verified_minor, 'observed_refunded_minor', v_c.observed_refunded_minor,
                           'observed_pending_refund_minor', v_c.observed_pending_refund_minor, 'cause', p_cause),
        'reprojection', p_event_id);
    END IF;
  ELSE
    -- pending, cancelled, refund_pending, refunded, reconciliation_hold: nothing counts (fail closed)
    v_target := 0;
  END IF;
  -- nothing counts while the provider's own evidence disagrees with the collection (a later mismatch un-counts)
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id AND q.status = 'open'
               -- PAY-05: nor while Paynow holds it in a dispute or reported a status no one has reviewed
               AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch', 'provider_disputed',
                                          'provider_status_unrecognized')) THEN
    v_target := 0;
  END IF;

  v_current := public.pay04_collection_allocated(v_c.id);
  -- money an operator settled OFF the platform never starts counting here, even if room appears later
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id
               AND q.discrepancy_type = 'unallocated_provider_money' AND q.status = 'resolved' AND q.resolution = 'settled_off_platform') THEN
    v_target := least(v_target, v_current);
  END IF;
  IF v_inv.status <> 'issued' THEN
    v_alloc := least(v_current, v_target);
  ELSE
    SELECT COALESCE(sum(CASE WHEN kind = 'payment' THEN amount ELSE -amount END), 0) INTO v_declared
      FROM public.garage_payment_records WHERE invoice_id = v_inv.id;
    SELECT COALESCE(sum(CASE WHEN kind = 'allocation' THEN amount ELSE -amount END), 0) INTO v_provider
      FROM public.pay04_garage_payment_allocations WHERE invoice_id = v_inv.id;
    v_room := v_inv.total_amount - v_declared - (v_provider - v_current);
    v_alloc := greatest(least(v_target, v_room), 0);
  END IF;
  v_delta := v_alloc - v_current;
  IF v_delta > 0 THEN
    INSERT INTO public.pay04_garage_payment_allocations (tenant_id, invoice_id, collection_id, kind, amount, currency, cause, provider_event_id)
    VALUES (v_c.tenant_id, v_c.invoice_id, v_c.id, 'allocation', v_delta, v_c.currency, p_cause, p_event_id);
    PERFORM public.pay04_log(v_c, 'allocated', v_actor, jsonb_build_object('amount', v_delta::text, 'cause', p_cause));
  ELSIF v_delta < 0 THEN
    INSERT INTO public.pay04_garage_payment_allocations (tenant_id, invoice_id, collection_id, kind, amount, currency, cause, provider_event_id)
    VALUES (v_c.tenant_id, v_c.invoice_id, v_c.id, 'deallocation', -v_delta, v_c.currency, p_cause, p_event_id);
    PERFORM public.pay04_log(v_c, 'deallocated', v_actor, jsonb_build_object('amount', (-v_delta)::text, 'cause', p_cause));
  END IF;

  SELECT * INTO v_receipt FROM public.pay04_garage_provider_receipts
   WHERE collection_id = v_c.id AND status = 'issued' FOR UPDATE;
  IF FOUND AND (v_alloc = 0 OR v_receipt.amount <> v_alloc) THEN
    UPDATE public.pay04_garage_provider_receipts SET status = 'voided', voided_at = clock_timestamp(), void_reason = p_cause
     WHERE id = v_receipt.id;
    PERFORM public.pay04_log(v_c, 'receipt_voided', v_actor,
      jsonb_build_object('receipt_number', v_receipt.receipt_number, 'amount', v_receipt.amount::text, 'cause', p_cause));
    v_receipt_out := jsonb_build_object('voided', v_receipt.receipt_number);
    v_receipt := NULL;
  END IF;
  IF v_alloc > 0 AND v_receipt.id IS NULL THEN
    INSERT INTO public.pay04_garage_provider_receipts (
      tenant_id, receipt_number, invoice_id, collection_id, payment_reference, amount, currency, payment_source, status)
    VALUES (v_c.tenant_id, public.garage_ops07_next_number(v_c.tenant_id, 'receipt'), v_c.invoice_id, v_c.id,
      v_c.payment_reference, v_alloc, v_c.currency, 'provider_confirmed', 'issued')
    RETURNING * INTO v_receipt;
    PERFORM public.pay04_log(v_c, 'receipt_issued', v_actor,
      jsonb_build_object('receipt_number', v_receipt.receipt_number, 'amount', v_receipt.amount::text));
    v_receipt_out := coalesce(v_receipt_out, '{}'::jsonb) || jsonb_build_object('issued', v_receipt.receipt_number);
  END IF;

  v_unallocated := v_target - v_alloc;
  IF v_unallocated > 0 THEN
    v_discrepancy := public.pay04_record_discrepancy(v_c, 'unallocated_provider_money', v_unallocated,
      jsonb_build_object('payment_status', v_p.status, 'counted_target', v_target::text, 'allocated', v_alloc::text,
                         'invoice_status', v_inv.status, 'cause', p_cause), 'reprojection', p_event_id);
  END IF;
  IF v_p.status = 'refunded' THEN
    UPDATE public.pay04_garage_payment_discrepancies SET
      status = 'resolved', resolution = 'refunded_to_customer', resolved_by = v_actor, resolved_role = 'provider_confirmation',
      resolution_note = 'Provider confirmed a full refund of this payment to the customer.', resolved_at = clock_timestamp()
    WHERE collection_id = v_c.id AND discrepancy_type IN ('unallocated_provider_money', 'refund_after_resolution', 'provider_disputed') AND status = 'open';
    IF FOUND THEN
      PERFORM public.pay04_log(v_c, 'discrepancy_resolved', v_actor,
        jsonb_build_object('discrepancy_type', 'unallocated_provider_money|refund_after_resolution|provider_disputed', 'resolution', 'refunded_to_customer'));
    END IF;
  ELSIF v_target > 0 AND v_alloc = v_target THEN
    -- the money now counts in full: an "uncounted money" flag left from before is stale, close it with the reason
    UPDATE public.pay04_garage_payment_discrepancies SET
      status = 'resolved', resolution = 'counted_on_invoice', resolved_by = v_actor, resolved_role = 'reprojection',
      resolution_note = 'The provider money now counts on the invoice.', resolved_at = clock_timestamp()
    WHERE collection_id = v_c.id AND discrepancy_type = 'unallocated_provider_money' AND status = 'open';
    IF FOUND THEN
      PERFORM public.pay04_log(v_c, 'discrepancy_resolved', v_actor,
        jsonb_build_object('discrepancy_type', 'unallocated_provider_money', 'resolution', 'counted_on_invoice'));
    END IF;
  END IF;
  PERFORM set_config('carup.pay04_writer', '', true);
  RETURN jsonb_build_object('counted_target', v_target, 'allocated', v_alloc, 'delta', v_delta, 'unallocated', v_unallocated,
    'receipt', v_receipt_out, 'discrepancy', v_discrepancy);
END $$;


-- pay04_begin_garage_collection: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_begin_garage_collection(
  p_invoice_id uuid, p_payer_user_id text, p_amount numeric, p_currency text, p_idempotency_key text,
  p_ttl_seconds integer DEFAULT 1800)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inv public.garage_invoices%ROWTYPE;
  v_existing public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_acct public.pay04_garage_merchant_accounts%ROWTYPE;
  v_payment public.payment_transactions%ROWTYPE;
  v_m record;
  v_scale integer;
BEGIN
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'PAY04_IDEMPOTENCY_KEY_INVALID';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 1 AND 3600 THEN RAISE EXCEPTION 'PAY04_COLLECTION_TTL_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || coalesce(p_invoice_id::text, '')));
  SELECT * INTO v_inv FROM public.garage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_INVOICE_NOT_FOUND'; END IF;

  SELECT * INTO v_existing FROM public.pay04_garage_collections
   WHERE payer_user_id = trim(p_payer_user_id) AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.invoice_id <> p_invoice_id OR v_existing.amount <> p_amount OR v_existing.currency <> upper(coalesce(p_currency, '')) THEN
      RAISE EXCEPTION 'PAY04_IDEMPOTENCY_CONFLICT';
    END IF;
    SELECT * INTO v_m FROM public.pay04_invoice_money(p_invoice_id);
    RETURN jsonb_build_object('collection', to_jsonb(v_existing), 'payment_reference', v_existing.payment_reference,
      'replayed', true, 'money', to_jsonb(v_m));
  END IF;

  IF v_inv.status <> 'issued' THEN RAISE EXCEPTION 'PAY04_INVOICE_NOT_PAYABLE'; END IF;
  IF NOT public.pay04_is_invoice_customer(v_inv.id, trim(p_payer_user_id)) THEN RAISE EXCEPTION 'PAY04_PAYER_NOT_CUSTOMER'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id = v_inv.tenant_id AND user_id = trim(p_payer_user_id)) THEN
    RAISE EXCEPTION 'PAY04_PAYER_IS_GARAGE_MEMBER';
  END IF;
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts
   WHERE tenant_id = v_inv.tenant_id AND (status = 'simulated' OR (gateway = 'paynow_zimbabwe' AND status = 'verified'))
   ORDER BY registered_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_GARAGE_MERCHANT_NOT_AVAILABLE'; END IF;
  IF NOT public.pay04_gateway_permitted(v_acct.gateway) THEN RAISE EXCEPTION 'PAY04_GATEWAY_NOT_PERMITTED'; END IF;
  IF upper(coalesce(p_currency, '')) <> v_inv.currency THEN RAISE EXCEPTION 'PAY04_CURRENCY_MISMATCH'; END IF;
  IF NOT (v_inv.currency = ANY (v_acct.currencies)) THEN RAISE EXCEPTION 'PAY04_MERCHANT_CURRENCY_UNSUPPORTED'; END IF;
  -- PAY-05: a Paynow merchant collects a currency only through its own verified integration for that currency
  IF v_acct.gateway = 'paynow_zimbabwe' AND public.pay05_verified_integration(v_acct.id, v_inv.currency) IS NULL THEN
    RAISE EXCEPTION 'PAY04_MERCHANT_CURRENCY_UNSUPPORTED';
  END IF;
  v_scale := public.garage_ops04_currency_scale(v_inv.currency);
  IF v_scale IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, v_scale) THEN
    RAISE EXCEPTION 'PAY04_AMOUNT_INVALID';
  END IF;
  SELECT * INTO v_m FROM public.pay04_invoice_money(v_inv.id);
  IF p_amount > v_m.uncommitted_balance THEN
    RAISE EXCEPTION 'PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE'
      USING DETAIL = format('uncommitted=%s reserved=%s', v_m.uncommitted_balance, v_m.provider_reserved);
  END IF;

  INSERT INTO public.payment_transactions (
    gateway, amount, currency, reference, status, pay01a_actor_id, pay01a_account_id,
    pay02_product_code, pay02_product_version, pay02_commercial_category, pay02_funds_owner,
    pay02_legal_beneficiary, pay02_settlement_status)
  VALUES (v_acct.gateway, p_amount, v_inv.currency, 'pay04_gar_' || gen_random_uuid()::text, 'pending',
    trim(p_payer_user_id), v_acct.merchant_reference,
    'gar.invoice.customer_payment', 1, 'category_b_third_party', 'garage_business_tenant',
    'tenant:' || v_inv.tenant_id::text, 'not_applicable_sandbox')
  RETURNING * INTO v_payment;
  INSERT INTO public.pay04_garage_collections (
    tenant_id, invoice_id, merchant_account_id, gateway, payer_user_id, currency, currency_scale, amount, amount_minor,
    payment_reference, idempotency_key, expires_at)
  VALUES (v_inv.tenant_id, v_inv.id, v_acct.id, v_acct.gateway, trim(p_payer_user_id), v_inv.currency, v_scale, p_amount,
    round(p_amount * (10 ^ v_scale))::bigint, v_payment.reference, p_idempotency_key,
    clock_timestamp() + make_interval(secs => p_ttl_seconds))
  RETURNING * INTO v_c;
  PERFORM public.pay04_log(v_c, 'initiated', trim(p_payer_user_id),
    jsonb_build_object('amount', p_amount::text, 'currency', v_inv.currency, 'merchant_account_id', v_acct.id,
                       'expires_at', v_c.expires_at));
  SELECT * INTO v_m FROM public.pay04_invoice_money(v_inv.id);
  RETURN jsonb_build_object('collection', to_jsonb(v_c), 'payment_reference', v_payment.reference, 'replayed', false,
    'money', to_jsonb(v_m));
END $$;


-- pay04_cancel_garage_collection: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_cancel_garage_collection(p_collection_id uuid, p_actor_user_id text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  IF trim(coalesce(p_actor_user_id, '')) <> v_probe.payer_user_id AND NOT EXISTS (
       SELECT 1 FROM public.tenants t JOIN public.tenant_users tu ON tu.tenant_id = t.id
        WHERE t.id = v_probe.tenant_id AND t.type = 'garage' AND t.status = 'active'
          AND tu.user_id = trim(p_actor_user_id) AND tu.role = 'admin') THEN
    RAISE EXCEPTION 'PAY04_CANCEL_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'PAY04_REASON_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  IF v_c.cancelled_at IS NOT NULL THEN RETURN jsonb_build_object('replayed', true, 'collection', to_jsonb(v_c)); END IF;
  IF v_p.status <> 'pending' THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_CANCELLABLE' USING DETAIL = v_p.status; END IF;
  UPDATE public.pay04_garage_collections SET cancelled_at = clock_timestamp(), cancelled_by = trim(p_actor_user_id),
         cancel_reason = btrim(p_reason)
   WHERE id = v_c.id RETURNING * INTO v_c;
  -- PAY-05: a Paynow request whose reply was lost may exist at Paynow: it is held like a live checkout, never closed here
  IF v_c.provider_payment_id IS NULL AND NOT public.pay05_initiation_unresolved(v_c.id) THEN
    PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now() WHERE reference = v_p.reference;
  END IF;
  PERFORM public.pay04_log(v_c, 'cancelled', trim(p_actor_user_id), jsonb_build_object('reason', btrim(p_reason),
    'closed_without_provider', v_c.provider_payment_id IS NULL AND NOT public.pay05_initiation_unresolved(v_c.id)));
  RETURN jsonb_build_object('replayed', false, 'collection', to_jsonb(v_c),
    'payment_status', CASE WHEN v_c.provider_payment_id IS NULL AND NOT public.pay05_initiation_unresolved(v_c.id)
                           THEN 'cancelled' ELSE v_p.status END);
END $$;


-- pay04_close_expired_unattached_collection: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_close_expired_unattached_collection(p_collection_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  IF v_c.provider_payment_id IS NOT NULL THEN RAISE EXCEPTION 'PAY04_COLLECTION_ATTACHED'; END IF;
  -- PAY-05: a Paynow request whose reply was lost may exist at Paynow: it closes only after authenticated traces find nothing
  IF public.pay05_initiation_unresolved(v_c.id) THEN RAISE EXCEPTION 'PAY05_INITIATION_UNRESOLVED'; END IF;
  IF v_p.status <> 'pending' THEN RETURN jsonb_build_object('replayed', true, 'payment_status', v_p.status); END IF;
  IF v_c.expires_at > clock_timestamp() THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_EXPIRED'; END IF;
  PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now() WHERE reference = v_p.reference;
  IF v_c.cancelled_at IS NULL THEN
    UPDATE public.pay04_garage_collections SET cancelled_at = clock_timestamp(), cancelled_by = 'system:expiry',
           cancel_reason = 'Expired before the provider checkout existed'
     WHERE id = v_c.id RETURNING * INTO v_c;
  END IF;
  PERFORM public.pay04_log(v_c, 'cancelled', 'system:expiry', jsonb_build_object('reason', 'expired before reaching the provider',
    'closed_without_provider', true));
  RETURN jsonb_build_object('replayed', false, 'payment_status', 'cancelled', 'collection', to_jsonb(v_c));
END $$;


-- pay04_resolve_garage_payment_discrepancy: accepted text of 20261102110000 + the PAY-05 hunks marked "PAY-05" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_resolve_garage_payment_discrepancy(
  p_discrepancy_id uuid, p_resolution text, p_actor_id text, p_actor_role text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_d public.pay04_garage_payment_discrepancies%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY04_RESOLUTION_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_note, ''))) < 10 THEN RAISE EXCEPTION 'PAY04_RESOLUTION_NOTE_REQUIRED'; END IF;
  SELECT * INTO v_d FROM public.pay04_garage_payment_discrepancies WHERE id = p_discrepancy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_DISCREPANCY_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_d.invoice_id::text));
  SELECT * INTO v_d FROM public.pay04_garage_payment_discrepancies WHERE id = p_discrepancy_id FOR UPDATE;
  IF v_d.status <> 'open' THEN RAISE EXCEPTION 'PAY04_DISCREPANCY_NOT_OPEN'; END IF;
  IF public.pay03b_payment_payer_conflict(v_d.payment_reference, trim(p_actor_id)) THEN
    RAISE EXCEPTION 'PAY04_RESOLUTION_SELF_DEALING_REFUSED';
  END IF;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = v_d.collection_id;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_d.payment_reference;
  IF p_resolution = 'refunded_to_customer' THEN
    IF v_p.status <> 'refunded' THEN RAISE EXCEPTION 'PAY04_RESOLUTION_REQUIRES_PROVIDER_REFUND'; END IF;
  ELSIF p_resolution = 'settled_off_platform' THEN
    IF v_d.discrepancy_type NOT IN ('unallocated_provider_money', 'provider_paid_after_close') THEN RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID'; END IF;
  ELSIF p_resolution = 'provider_corrected' THEN
    IF v_d.discrepancy_type NOT IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch', 'provider_disputed',
                                    'provider_status_unrecognized') THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
    -- PAY-05: a dispute is over only when Paynow itself reports the payment Paid again
    IF v_d.discrepancy_type = 'provider_disputed' AND public.pay05_latest_provider_status(v_d.collection_id) IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER';
    END IF;
  ELSIF p_resolution = 'acknowledged' THEN
    -- the invoice already counts only what the provider says the garage keeps; the operator records the review
    IF v_d.discrepancy_type NOT IN ('refund_after_resolution', 'provider_status_unrecognized', 'provider_refund_unquantified',
                                    'provider_paid_after_close') THEN RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID'; END IF;
  ELSE
    RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
  END IF;
  UPDATE public.pay04_garage_payment_discrepancies SET status = 'resolved', resolution = p_resolution,
    resolved_by = trim(p_actor_id), resolved_role = p_actor_role, resolution_note = btrim(p_note), resolved_at = clock_timestamp()
   WHERE id = v_d.id RETURNING * INTO v_d;
  PERFORM public.pay04_log(v_c, 'discrepancy_resolved', trim(p_actor_id),
    jsonb_build_object('discrepancy_id', v_d.id, 'discrepancy_type', v_d.discrepancy_type, 'resolution', p_resolution));
  -- the closure can change what counts (a mismatch closed as corrected lets the money count again): re-project now,
  -- in the shared lock order (the invoice lock is held; the reference lock next)
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_d.payment_reference));
  RETURN to_jsonb(v_d) || jsonb_build_object('projection',
    public.pay04_reproject_garage_collection(v_d.collection_id, 'discrepancy_resolved', NULL));
END $$;


-- ─────────────────────────── 7. PAY-05 governed writers (service_role only) ───────────────────────────

CREATE OR REPLACE FUNCTION public.pay05_integration_view(p_row public.pay05_merchant_integrations)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', p_row.id, 'merchant_account_id', p_row.merchant_account_id, 'mode', p_row.mode,
    'currency', p_row.currency, 'integration_id', p_row.integration_id, 'methods', to_jsonb(p_row.methods),
    'credential_fingerprint', p_row.credential_fingerprint, 'status', p_row.status, 'registered_by', p_row.registered_by,
    'registered_at', p_row.registered_at, 'verified_by', p_row.verified_by, 'verified_at', p_row.verified_at,
    'closed_reason', p_row.closed_reason, 'closed_at', p_row.closed_at);
$$;

CREATE OR REPLACE FUNCTION public.pay05_audit(
  p_tenant_id uuid, p_merchant_account_id uuid, p_integration_row_id uuid, p_event text, p_actor text, p_role text, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.pay05_merchant_audit_events (tenant_id, merchant_account_id, integration_row_id, event_type, actor, actor_role, detail)
  VALUES (p_tenant_id, p_merchant_account_id, p_integration_row_id, p_event, p_actor, p_role, coalesce(p_detail, '{}'::jsonb));
  INSERT INTO public.trust_audit_events (event_type, trust_fact, new_value, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route)
  VALUES ('PAYNOW_' || upper(p_event), 'service_relationship',
    jsonb_build_object('merchant_account_id', p_merchant_account_id, 'integration_row_id', p_integration_row_id) || coalesce(p_detail, '{}'::jsonb),
    CASE WHEN p_actor LIKE 'provider:%' OR p_actor LIKE 'system:%' THEN NULL ELSE p_actor END, p_role, p_tenant_id::text,
    CASE WHEN p_actor LIKE 'provider:%' OR p_actor LIKE 'system:%' THEN 'system' ELSE 'user' END, '/api/payments/pay05');
END $$;

-- 7a. The garage administrator connects the garage's OWN Paynow merchant (pending CarUp verification).
-- The backend chooses the merchant account id: each integration key was sealed with it in the additional authenticated
-- data before this row existed.
CREATE OR REPLACE FUNCTION public.pay05_register_paynow_merchant(
  p_tenant_id uuid, p_merchant_account_id uuid, p_actor_id text, p_display_name text, p_profile jsonb, p_integrations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_acct public.pay04_garage_merchant_accounts%ROWTYPE;
  v_int public.pay05_merchant_integrations%ROWTYPE;
  v_item jsonb;
  v_currencies text[] := '{}';
  v_out jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    PERFORM public.garage_ops03_assert_admin(p_tenant_id, trim(p_actor_id));
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'PAY05_MERCHANT_AUTHORITY_REFUSED';
  END;
  IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN RAISE EXCEPTION 'PAY05_PROFILE_INVALID'; END IF;
  IF p_integrations IS NULL OR jsonb_typeof(p_integrations) <> 'array' OR jsonb_array_length(p_integrations) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'PAY05_INTEGRATIONS_INVALID';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_integrations) LOOP
    IF coalesce(v_item->>'currency', '') NOT IN ('USD', 'ZWG') THEN RAISE EXCEPTION 'PAY05_CURRENCY_NOT_SUPPORTED'; END IF;
    IF NOT public.pay05_mode_permitted(v_item->>'mode') THEN RAISE EXCEPTION 'PAY05_MODE_NOT_PERMITTED'; END IF;
    IF (v_item->>'currency') = ANY (v_currencies) THEN RAISE EXCEPTION 'PAY05_DUPLICATE_CURRENCY'; END IF;
    v_currencies := v_currencies || (v_item->>'currency');
  END LOOP;
  IF p_merchant_account_id IS NULL THEN RAISE EXCEPTION 'PAY05_MERCHANT_ID_REQUIRED'; END IF;
  BEGIN
    INSERT INTO public.pay04_garage_merchant_accounts (
      id, tenant_id, gateway, merchant_reference, display_name, currencies, status, authority_note, registered_by, registered_role)
    VALUES (p_merchant_account_id, p_tenant_id, 'paynow_zimbabwe', 'pnm_' || replace(gen_random_uuid()::text, '-', ''), btrim(p_display_name),
      (SELECT array_agg(c ORDER BY c) FROM unnest(v_currencies) AS c), 'pending_verification',
      'The garage connected its own Paynow merchant integration; pending CarUp verification.', trim(p_actor_id), 'garage_admin')
    RETURNING * INTO v_acct;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'PAY05_MERCHANT_ALREADY_CONNECTED';
  END;
  INSERT INTO public.pay05_merchant_profiles (
    merchant_account_id, tenant_id, legal_entity_name, registration_number, settlement_bank_name, settlement_account_last4,
    settlement_account_holder, attestation, attested_by)
  VALUES (v_acct.id, p_tenant_id, btrim(p_profile->>'legal_entity_name'), nullif(btrim(coalesce(p_profile->>'registration_number', '')), ''),
    btrim(p_profile->>'settlement_bank_name'), p_profile->>'settlement_account_last4', btrim(p_profile->>'settlement_account_holder'),
    btrim(p_profile->>'attestation'), trim(p_actor_id));
  PERFORM public.pay05_audit(p_tenant_id, v_acct.id, NULL, 'merchant_registered', trim(p_actor_id), 'garage_admin',
    jsonb_build_object('merchant_reference', v_acct.merchant_reference, 'currencies', to_jsonb(v_acct.currencies),
                       'legal_entity_name', btrim(p_profile->>'legal_entity_name')));
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_integrations) LOOP
    BEGIN
      INSERT INTO public.pay05_merchant_integrations (
        tenant_id, merchant_account_id, mode, currency, integration_id, methods, credential_ciphertext, credential_iv,
        credential_tag, credential_key_version, credential_fingerprint, status, registered_by, registered_role)
      VALUES (p_tenant_id, v_acct.id, v_item->>'mode', v_item->>'currency', v_item->>'integration_id',
        ARRAY(SELECT DISTINCT jsonb_array_elements_text(v_item->'methods') ORDER BY 1), v_item->>'ciphertext', v_item->>'iv',
        v_item->>'tag', (v_item->>'key_version')::smallint, v_item->>'fingerprint', 'pending_verification', trim(p_actor_id),
        'garage_admin')
      RETURNING * INTO v_int;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PAY05_INTEGRATION_ALREADY_REGISTERED';
    END;
    PERFORM public.pay05_audit(p_tenant_id, v_acct.id, v_int.id, 'integration_registered', trim(p_actor_id), 'garage_admin',
      jsonb_build_object('currency', v_int.currency, 'integration_id', v_int.integration_id, 'mode', v_int.mode,
                         'methods', to_jsonb(v_int.methods), 'credential_fingerprint', v_int.credential_fingerprint));
    v_out := v_out || jsonb_build_array(public.pay05_integration_view(v_int));
  END LOOP;
  RETURN jsonb_build_object('merchant', to_jsonb(v_acct), 'integrations', v_out);
END $$;

-- 7b. A CarUp platform administrator — not the registrant, not a member of the garage — verifies, rejects or suspends.
CREATE OR REPLACE FUNCTION public.pay05_assert_independent_reviewer(
  p_acct public.pay04_garage_merchant_accounts, p_actor_id text, p_actor_role text)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_VERIFICATION_AUTHORITY_REFUSED';
  END IF;
  IF trim(p_actor_id) = p_acct.registered_by
     OR EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id = p_acct.tenant_id AND user_id = trim(p_actor_id))
     OR EXISTS (SELECT 1 FROM public.pay05_merchant_integrations WHERE merchant_account_id = p_acct.id AND registered_by = trim(p_actor_id)) THEN
    RAISE EXCEPTION 'PAY05_REVIEWER_SEPARATION_REQUIRED';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pay05_verify_paynow_merchant(
  p_merchant_account_id uuid, p_actor_id text, p_actor_role text, p_evidence jsonb, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acct public.pay04_garage_merchant_accounts%ROWTYPE; v_int public.pay05_merchant_integrations%ROWTYPE; v_count integer := 0;
BEGIN
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts WHERE id = p_merchant_account_id FOR UPDATE;
  IF NOT FOUND OR v_acct.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_MERCHANT_NOT_FOUND'; END IF;
  PERFORM public.pay05_assert_independent_reviewer(v_acct, p_actor_id, p_actor_role);
  IF char_length(btrim(coalesce(p_note, ''))) < 10 THEN RAISE EXCEPTION 'PAY05_REASON_REQUIRED'; END IF;
  IF v_acct.status <> 'pending_verification' THEN RAISE EXCEPTION 'PAY05_MERCHANT_NOT_PENDING' USING DETAIL = v_acct.status; END IF;
  IF coalesce(p_evidence->>'legal_identity_reviewed', '') <> 'true' OR coalesce(p_evidence->>'settlement_account_reviewed', '') <> 'true' THEN
    RAISE EXCEPTION 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE';
  END IF;
  FOR v_int IN SELECT * FROM public.pay05_merchant_integrations
                 WHERE merchant_account_id = v_acct.id AND status = 'pending_verification' FOR UPDATE LOOP
    -- each integration's ID and key were proved together by an authenticated Paynow reply (the backend's credential probe)
    IF coalesce(p_evidence->'credential_probes'->v_int.id::text->>'result', '') <> 'authenticated'
       OR coalesce(p_evidence->'credential_probes'->v_int.id::text->>'credential_fingerprint', '') <> v_int.credential_fingerprint THEN
      RAISE EXCEPTION 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE';
    END IF;
    UPDATE public.pay05_merchant_integrations SET status = 'verified', verified_by = trim(p_actor_id), verified_role = p_actor_role,
      verified_at = clock_timestamp(), verification_evidence = jsonb_build_object('credential_probe', p_evidence->'credential_probes'->v_int.id::text,
        'note', btrim(p_note))
     WHERE id = v_int.id RETURNING * INTO v_int;
    PERFORM public.pay05_audit(v_acct.tenant_id, v_acct.id, v_int.id, 'integration_verified', trim(p_actor_id), p_actor_role,
      jsonb_build_object('currency', v_int.currency, 'probe', p_evidence->'credential_probes'->v_int.id::text));
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE'; END IF;
  UPDATE public.pay04_garage_merchant_accounts SET status = 'verified' WHERE id = v_acct.id RETURNING * INTO v_acct;
  PERFORM public.pay05_audit(v_acct.tenant_id, v_acct.id, NULL, 'merchant_verified', trim(p_actor_id), p_actor_role,
    jsonb_build_object('legal_identity_reviewed', true, 'settlement_account_reviewed', true, 'note', btrim(p_note),
                       'integrations_verified', v_count));
  RETURN jsonb_build_object('merchant', to_jsonb(v_acct), 'integrations_verified', v_count);
END $$;

CREATE OR REPLACE FUNCTION public.pay05_reject_paynow_merchant(
  p_merchant_account_id uuid, p_actor_id text, p_actor_role text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acct public.pay04_garage_merchant_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts WHERE id = p_merchant_account_id FOR UPDATE;
  IF NOT FOUND OR v_acct.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_MERCHANT_NOT_FOUND'; END IF;
  PERFORM public.pay05_assert_independent_reviewer(v_acct, p_actor_id, p_actor_role);
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'PAY05_REASON_REQUIRED'; END IF;
  IF v_acct.status <> 'pending_verification' THEN RAISE EXCEPTION 'PAY05_MERCHANT_NOT_PENDING' USING DETAIL = v_acct.status; END IF;
  UPDATE public.pay05_merchant_integrations SET status = 'rejected', closed_by = trim(p_actor_id), closed_reason = btrim(p_reason),
    closed_at = clock_timestamp() WHERE merchant_account_id = v_acct.id AND status = 'pending_verification';
  UPDATE public.pay04_garage_merchant_accounts SET status = 'rejected' WHERE id = v_acct.id RETURNING * INTO v_acct;
  PERFORM public.pay05_audit(v_acct.tenant_id, v_acct.id, NULL, 'merchant_rejected', trim(p_actor_id), p_actor_role,
    jsonb_build_object('reason', btrim(p_reason)));
  RETURN jsonb_build_object('merchant', to_jsonb(v_acct));
END $$;

-- Suspension: a CarUp platform administrator, or the garage's own administrator (disconnecting its account).
CREATE OR REPLACE FUNCTION public.pay05_suspend_paynow_merchant(
  p_merchant_account_id uuid, p_actor_id text, p_actor_role text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acct public.pay04_garage_merchant_accounts%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts WHERE id = p_merchant_account_id FOR UPDATE;
  IF NOT FOUND OR v_acct.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_MERCHANT_NOT_FOUND'; END IF;
  IF coalesce(p_actor_role, '') IN ('admin', 'super_admin') AND public.pay03b_is_platform_admin(p_actor_id) THEN
    v_role := p_actor_role;
  ELSIF EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id = v_acct.tenant_id AND user_id = trim(p_actor_id) AND role = 'admin') THEN
    v_role := 'garage_admin';
  ELSE
    RAISE EXCEPTION 'PAY05_MERCHANT_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'PAY05_REASON_REQUIRED'; END IF;
  IF v_acct.status IN ('suspended', 'rejected') THEN RETURN jsonb_build_object('merchant', to_jsonb(v_acct), 'replayed', true); END IF;
  UPDATE public.pay05_merchant_integrations SET status = 'suspended', closed_by = trim(p_actor_id), closed_reason = btrim(p_reason),
    closed_at = clock_timestamp() WHERE merchant_account_id = v_acct.id AND status IN ('pending_verification', 'verified');
  UPDATE public.pay04_garage_merchant_accounts SET status = 'suspended', suspended_by = trim(p_actor_id),
    suspended_reason = btrim(p_reason), suspended_at = clock_timestamp() WHERE id = v_acct.id RETURNING * INTO v_acct;
  PERFORM public.pay05_audit(v_acct.tenant_id, v_acct.id, NULL, 'merchant_suspended', trim(p_actor_id), v_role,
    jsonb_build_object('reason', btrim(p_reason)));
  RETURN jsonb_build_object('merchant', to_jsonb(v_acct), 'replayed', false);
END $$;

CREATE OR REPLACE FUNCTION public.pay05_set_paynow_availability(p_available boolean, p_actor_id text, p_actor_role text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_guard public.pay05_runtime_guard%ROWTYPE;
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_AVAILABILITY_AUTHORITY_REFUSED';
  END IF;
  IF p_available IS NULL OR char_length(btrim(coalesce(p_note, ''))) NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'PAY05_REASON_REQUIRED'; END IF;
  UPDATE public.pay05_runtime_guard SET paynow_available = p_available, availability_note = btrim(p_note) WHERE singleton
  RETURNING * INTO v_guard;
  PERFORM public.pay05_audit(NULL, NULL, NULL, 'availability_changed', trim(p_actor_id), p_actor_role,
    jsonb_build_object('paynow_available', p_available, 'note', btrim(p_note)));
  RETURN jsonb_build_object('paynow_available', v_guard.paynow_available, 'paynow_simulator_enabled', v_guard.paynow_simulator_enabled,
    'paynow_real_enabled', v_guard.paynow_real_enabled, 'note', v_guard.availability_note, 'updated_at', v_guard.updated_at);
END $$;

-- 7c. Before CarUp sends anything to Paynow: one durable intent per collection, with its merchant trace. A collection is
--     never sent twice — a retry replays this row, and a lost reply is recovered by trace.
CREATE OR REPLACE FUNCTION public.pay05_record_paynow_sending(
  p_collection_id uuid, p_merchant_trace text, p_method text, p_phone_masked text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_int public.pay05_merchant_integrations%ROWTYPE;
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = v_c.id FOR UPDATE;
  IF FOUND THEN
    -- one Paynow request per collection, ever: a retry gets the existing request back, never a second one
    RETURN jsonb_build_object('replayed', true, 'transaction', to_jsonb(v_tx));
  END IF;
  IF v_p.status <> 'pending' OR v_c.provider_payment_id IS NOT NULL OR v_c.cancelled_at IS NOT NULL OR v_c.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'PAY05_COLLECTION_NOT_SENDABLE';
  END IF;
  SELECT * INTO v_int FROM public.pay05_merchant_integrations
   WHERE id = public.pay05_verified_integration(v_c.merchant_account_id, v_c.currency);
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY05_INTEGRATION_UNAVAILABLE'; END IF;
  IF p_method IS NULL OR NOT (p_method = ANY (v_int.methods)) THEN RAISE EXCEPTION 'PAY05_METHOD_NOT_AVAILABLE'; END IF;
  INSERT INTO public.pay05_paynow_transactions (collection_id, tenant_id, integration_row_id, merchant_trace, method, phone_masked, initiation_state)
  VALUES (v_c.id, v_c.tenant_id, v_int.id, p_merchant_trace, p_method, p_phone_masked, 'sending')
  RETURNING * INTO v_tx;
  RETURN jsonb_build_object('replayed', false, 'transaction', to_jsonb(v_tx), 'integration_row_id', v_int.id);
END $$;

-- 7d. Bind Paynow's poll URL once (after the adapter verified the reply). Unlike a simulator checkout, a Paynow request
--     cannot be cancelled, so a still-pending collection is bound even if it was stopped or its time ran out meanwhile:
--     the room stays held and a late payment is still seen.
CREATE OR REPLACE FUNCTION public.pay05_attach_paynow_collection(
  p_collection_id uuid, p_merchant_trace text, p_poll_url text, p_payment_id text, p_reply jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_checkout text := 'pn_trace_' || coalesce(p_merchant_trace, '');
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = v_c.id FOR UPDATE;
  IF NOT FOUND OR v_tx.merchant_trace IS DISTINCT FROM p_merchant_trace THEN RAISE EXCEPTION 'PAY05_TRACE_MISMATCH'; END IF;
  IF coalesce(p_payment_id, '') !~ '^pn_poll_[0-9a-f]{40}$' OR coalesce(p_poll_url, '') !~ '^https?://[^\s]+$' THEN
    RAISE EXCEPTION 'PAY05_PROVIDER_REFERENCE_INVALID';
  END IF;
  IF v_c.provider_payment_id IS NOT NULL THEN
    IF v_c.provider_payment_id <> p_payment_id OR v_tx.poll_url IS DISTINCT FROM p_poll_url THEN
      RAISE EXCEPTION 'PAY05_PROVIDER_REFERENCE_CHANGE_REFUSED';
    END IF;
    RETURN jsonb_build_object('replayed', true, 'collection_id', v_c.id);
  END IF;
  IF v_p.status <> 'pending' OR v_tx.initiation_state NOT IN ('sending', 'unknown') THEN RAISE EXCEPTION 'PAY05_COLLECTION_CLOSED'; END IF;
  UPDATE public.pay04_garage_collections SET provider_checkout_id = v_checkout, provider_payment_id = p_payment_id
   WHERE id = v_c.id RETURNING * INTO v_c;
  UPDATE public.payment_transactions SET pay01a_checkout_id = v_checkout, pay01a_intent_id = p_payment_id, updated_at = now()
   WHERE reference = v_c.payment_reference AND pay01a_intent_id IS NULL AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_CANONICAL_PAYMENT_BINDING_REFUSED'; END IF;
  UPDATE public.pay05_paynow_transactions SET initiation_state = 'attached', poll_url = p_poll_url,
    browser_url = p_reply->>'browser_url', remote_otp_url = p_reply->>'remote_otp_url',
    instructions = left(p_reply->>'instructions', 500), authorization_code = p_reply->>'authorization_code',
    authorization_expires = left(p_reply->>'authorization_expires', 40), otp_reference = left(p_reply->>'otp_reference', 64),
    paynow_reference = left(p_reply->>'paynow_reference', 64), provider_error = NULL, updated_at = clock_timestamp()
   WHERE collection_id = v_c.id RETURNING * INTO v_tx;
  PERFORM public.pay04_log(v_c, 'provider_attached', 'provider:paynow_zimbabwe',
    jsonb_build_object('provider_checkout_id', v_checkout, 'provider_payment_id', p_payment_id, 'method', v_tx.method,
                       'recovered_by_trace', p_reply->>'recovered_by_trace'));
  RETURN jsonb_build_object('replayed', false, 'collection_id', v_c.id, 'method', v_tx.method);
END $$;

-- 7e. Paynow refused the request (nothing exists at Paynow) or its reply could not be authenticated (something may).
CREATE OR REPLACE FUNCTION public.pay05_mark_paynow_initiation(p_collection_id uuid, p_state text, p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_probe public.pay04_garage_collections%ROWTYPE; v_tx public.pay05_paynow_transactions%ROWTYPE;
BEGIN
  IF p_state NOT IN ('refused', 'unknown') THEN RAISE EXCEPTION 'PAY05_INITIATION_STATE_INVALID'; END IF;
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY05_TRANSACTION_NOT_FOUND'; END IF;
  IF v_tx.initiation_state = p_state THEN RETURN jsonb_build_object('replayed', true, 'initiation_state', v_tx.initiation_state); END IF;
  IF v_tx.initiation_state <> 'sending' THEN RAISE EXCEPTION 'PAY05_INITIATION_STATE_INVALID' USING DETAIL = v_tx.initiation_state; END IF;
  UPDATE public.pay05_paynow_transactions SET initiation_state = p_state, provider_error = left(p_error, 160), updated_at = clock_timestamp()
   WHERE collection_id = p_collection_id RETURNING * INTO v_tx;
  RETURN jsonb_build_object('replayed', false, 'initiation_state', v_tx.initiation_state);
END $$;

-- 7f. An authenticated trace result for a request whose reply was lost. Two authenticated "NotFound" answers at least a
--     minute apart resolve it as absent (the collection may then close as never reaching Paynow).
CREATE OR REPLACE FUNCTION public.pay05_record_paynow_trace_absent(p_collection_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_probe public.pay04_garage_collections%ROWTYPE; v_tx public.pay05_paynow_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY05_TRANSACTION_NOT_FOUND'; END IF;
  IF v_tx.initiation_state NOT IN ('sending', 'unknown') THEN
    RETURN jsonb_build_object('replayed', true, 'initiation_state', v_tx.initiation_state);
  END IF;
  UPDATE public.pay05_paynow_transactions SET
    trace_absent_count = trace_absent_count + 1,
    first_trace_absent_at = coalesce(first_trace_absent_at, clock_timestamp()),
    initiation_state = CASE WHEN initiation_state = 'sending' THEN 'unknown'
                            WHEN trace_absent_count + 1 >= 2 AND first_trace_absent_at <= clock_timestamp() - interval '60 seconds'
                              THEN 'traced_absent'
                            ELSE initiation_state END,
    updated_at = clock_timestamp()
   WHERE collection_id = p_collection_id RETURNING * INTO v_tx;
  RETURN jsonb_build_object('replayed', false, 'initiation_state', v_tx.initiation_state, 'trace_absent_count', v_tx.trace_absent_count);
END $$;

-- 7g. THE Paynow observation writer: every authenticated Paynow message for a collection (signed status update, poll,
--     trace, O'mari OTP reply) is recorded, then applied through the PAY-04 writer — or turned into a review.
CREATE OR REPLACE FUNCTION public.pay05_apply_paynow_observation(
  p_collection_id uuid, p_via text, p_event_id text, p_provider_status text, p_raw_status text, p_amount_minor bigint,
  p_reference text, p_paynow_reference text, p_payment_id text, p_message_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_acct public.pay04_garage_merchant_accounts%ROWTYPE;
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_obs uuid;
  v_event_collection uuid;
  v_via text;
  v_money boolean;
  v_snapshot text;
  v_result jsonb;
  v_disc jsonb := NULL;
  v_amount numeric;
BEGIN
  IF p_via NOT IN ('status_update', 'poll', 'trace', 'otp_reply') THEN RAISE EXCEPTION 'PAY05_OBSERVATION_SOURCE_INVALID'; END IF;
  IF (p_via = 'status_update') <> (p_message_hash IS NOT NULL AND p_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PAY05_OBSERVATION_IDENTITY_INVALID';
  END IF;
  IF p_provider_status NOT IN ('created', 'sent', 'awaiting_delivery', 'delivered', 'paid', 'cancelled', 'failed', 'disputed',
                               'refunded', 'unrecognized') THEN
    RAISE EXCEPTION 'PAY05_PROVIDER_STATUS_INVALID';
  END IF;
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  -- the lock order every garage-collection writer shares: invoice -> payment reference -> rows
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = v_c.id FOR UPDATE;
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts WHERE id = v_c.merchant_account_id;
  IF v_tx.collection_id IS NULL OR v_c.provider_payment_id IS NULL OR v_tx.initiation_state IS DISTINCT FROM 'attached' THEN
    RAISE EXCEPTION 'PAY05_COLLECTION_NOT_ATTACHED';
  END IF;
  -- evidence that does not belong to THIS collection is refused, never applied
  IF p_payment_id IS DISTINCT FROM v_c.provider_payment_id OR p_reference IS DISTINCT FROM v_c.payment_reference THEN
    RAISE EXCEPTION 'PAY05_PROVIDER_BINDING_MISMATCH';
  END IF;

  INSERT INTO public.pay05_paynow_observations (tenant_id, collection_id, event_id, via, provider_status, raw_status, amount_minor, paynow_reference)
  VALUES (v_c.tenant_id, v_c.id, p_event_id, p_via, p_provider_status, left(p_raw_status, 160), p_amount_minor, left(p_paynow_reference, 64))
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO v_obs;
  IF v_obs IS NULL THEN
    SELECT collection_id INTO v_event_collection FROM public.pay05_paynow_observations WHERE event_id = p_event_id;
    IF v_event_collection IS DISTINCT FROM v_c.id THEN RAISE EXCEPTION 'PAY05_EVENT_CROSS_COLLECTION_REPLAY'; END IF;
    RETURN jsonb_build_object('applied', false, 'duplicate_event', true, 'payment_status', v_p.status, 'provider_status', v_tx.provider_status);
  END IF;
  UPDATE public.pay05_paynow_transactions SET provider_status = p_provider_status, provider_status_at = clock_timestamp(),
    paynow_reference = coalesce(paynow_reference, left(p_paynow_reference, 64)),
    last_status_update_hash = coalesce(p_message_hash, last_status_update_hash), updated_at = clock_timestamp()
   WHERE collection_id = v_c.id RETURNING * INTO v_tx;

  v_via := CASE WHEN p_via = 'status_update' THEN 'signed_webhook' ELSE 'provider_readback' END;
  v_money := p_provider_status IN ('paid', 'awaiting_delivery', 'delivered', 'disputed');
  v_amount := CASE WHEN p_amount_minor IS NULL THEN NULL ELSE (p_amount_minor::numeric / (10 ^ v_c.currency_scale)::numeric)::numeric(14,2) END;

  IF v_money AND p_amount_minor IS DISTINCT FROM v_c.amount_minor THEN
    v_disc := public.pay04_record_discrepancy(v_c, 'amount_mismatch', v_amount,
      jsonb_build_object('observed_amount_minor', p_amount_minor, 'expected_amount_minor', v_c.amount_minor,
                         'observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'refused', 'amount_mismatch', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_mismatch', NULL));
  ELSIF v_money AND v_p.status = 'cancelled' THEN
    -- Paynow took money after CarUp had closed this payment: never counted here; an operator settles it
    v_disc := public.pay04_record_discrepancy(v_c, 'provider_paid_after_close', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id,
                         'payment_status', v_p.status), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'refused', 'paid_after_close', 'discrepancy', v_disc);
  ELSIF p_provider_status = 'disputed' THEN
    v_disc := public.pay04_record_discrepancy(v_c, 'provider_disputed', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id,
                         'payment_status', v_p.status), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'review', 'provider_disputed', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_disputed', NULL));
  ELSE
    v_snapshot := CASE p_provider_status
      WHEN 'paid' THEN 'paid'
      WHEN 'refunded' THEN 'refunded'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'failed' THEN 'cancelled'
      WHEN 'unrecognized' THEN NULL
      ELSE 'pending' END;
    IF v_snapshot IS NULL
       OR NOT ((v_p.status = 'pending' AND v_snapshot IN ('pending', 'paid', 'cancelled', 'refunded'))
               OR (v_p.status = 'paid' AND v_snapshot IN ('paid', 'refunded'))
               OR (v_p.status = 'refunded' AND v_snapshot = 'refunded')
               OR (v_p.status = 'cancelled' AND v_snapshot = 'cancelled')) THEN
      -- a word Paynow does not document, or a step backwards: recorded for an operator, never applied
      v_disc := public.pay04_record_discrepancy(v_c, 'provider_status_unrecognized', v_amount,
        jsonb_build_object('observed_status', p_provider_status, 'raw_status', left(p_raw_status, 160), 'via', p_via,
                           'event_id', p_event_id, 'payment_status', v_p.status), v_via, p_event_id);
      v_result := jsonb_build_object('applied', false, 'review', 'provider_status_unrecognized', 'discrepancy', v_disc,
        'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_status_unrecognized', NULL));
    ELSE
      IF v_snapshot = 'paid' THEN
        -- Paynow reports the money released again: an open dispute is over (the provider says so)
        UPDATE public.pay04_garage_payment_discrepancies SET status = 'resolved', resolution = 'provider_corrected',
          resolved_by = 'provider:paynow_zimbabwe', resolved_role = 'provider_confirmation',
          resolution_note = 'Paynow reports the payment Paid again: the dispute is over.', resolved_at = clock_timestamp()
         WHERE collection_id = v_c.id AND discrepancy_type = 'provider_disputed' AND status = 'open';
        IF FOUND THEN
          PERFORM public.pay04_log(v_c, 'discrepancy_resolved', 'provider:paynow_zimbabwe',
            jsonb_build_object('discrepancy_type', 'provider_disputed', 'resolution', 'provider_corrected'));
        END IF;
      END IF;
      v_result := public.pay04_apply_garage_provider_snapshot(
        v_c.id, v_snapshot, v_c.provider_payment_id, NULL, NULL, NULL, p_amount_minor, v_c.currency, v_acct.merchant_reference,
        CASE WHEN v_snapshot = 'refunded' THEN v_c.amount_minor ELSE NULL END,
        CASE WHEN v_snapshot = 'refunded' THEN 0 ELSE NULL END, NULL, NULL, v_via);
      IF v_snapshot = 'refunded' THEN
        -- Paynow's "Refunded" carries no amount and partial refunds are undocumented: CarUp counts nothing for this
        -- payment and asks an operator to confirm the refund in the merchant's Paynow records
        v_disc := public.pay04_record_discrepancy(v_c, 'provider_refund_unquantified', v_amount,
          jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id), v_via, p_event_id);
      END IF;
    END IF;
  END IF;
  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object('observation_id', v_obs, 'provider_status', p_provider_status,
    'discrepancy', coalesce(v_disc, v_result->'discrepancy'),
    'payment_status', (SELECT status FROM public.payment_transactions WHERE reference = v_c.payment_reference));
END $$;

-- 7h. An operator releases the room held by an UNPAID Paynow checkout that Paynow cannot cancel: only once the
--     collection's own time has run out and a fresh authenticated read (poll or trace, within 15 minutes) shows it
--     unpaid. The payment stays pending and watched: if Paynow later reports it paid, the money counts if room remains,
--     and otherwise becomes PAY-04 unallocated provider money for an operator — never a double count.
CREATE OR REPLACE FUNCTION public.pay05_release_paynow_hold(p_collection_id uuid, p_actor_id text, p_actor_role text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_obs public.pay05_paynow_observations%ROWTYPE;
  v_m record;
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_RELEASE_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'PAY05_REASON_REQUIRED'; END IF;
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  IF public.pay03b_payment_payer_conflict(v_probe.payment_reference, trim(p_actor_id)) THEN RAISE EXCEPTION 'PAY05_RELEASE_SELF_DEALING_REFUSED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = v_c.id FOR UPDATE;
  IF NOT FOUND OR v_tx.initiation_state <> 'attached' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_ATTACHED'; END IF;
  IF v_tx.hold_released_at IS NOT NULL THEN RETURN jsonb_build_object('replayed', true, 'hold_released_at', v_tx.hold_released_at); END IF;
  IF v_p.status <> 'pending' THEN RAISE EXCEPTION 'PAY05_HOLD_NOT_RELEASABLE' USING DETAIL = v_p.status; END IF;
  IF v_c.expires_at > clock_timestamp() THEN RAISE EXCEPTION 'PAY05_HOLD_NOT_RELEASABLE' USING DETAIL = 'not_expired'; END IF;
  SELECT * INTO v_obs FROM public.pay05_paynow_observations
   WHERE collection_id = v_c.id AND via IN ('poll', 'trace') ORDER BY seq DESC LIMIT 1;
  IF NOT FOUND OR v_obs.observed_at < clock_timestamp() - interval '15 minutes' OR v_obs.provider_status NOT IN ('created', 'sent') THEN
    RAISE EXCEPTION 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_UNPAID_READ';
  END IF;
  UPDATE public.pay05_paynow_transactions SET hold_released_at = clock_timestamp(), hold_released_by = trim(p_actor_id),
    hold_release_reason = btrim(p_reason), updated_at = clock_timestamp()
   WHERE collection_id = v_c.id RETURNING * INTO v_tx;
  PERFORM public.pay04_log(v_c, 'hold_released', trim(p_actor_id), jsonb_build_object('reason', btrim(p_reason),
    'last_provider_status', v_obs.provider_status, 'observed_at', v_obs.observed_at));
  PERFORM public.pay05_audit(v_c.tenant_id, v_c.merchant_account_id, v_tx.integration_row_id, 'hold_released', trim(p_actor_id),
    p_actor_role, jsonb_build_object('collection_id', v_c.id, 'reason', btrim(p_reason), 'last_provider_status', v_obs.provider_status));
  SELECT * INTO v_m FROM public.pay04_invoice_money(v_c.invoice_id);
  RETURN jsonb_build_object('replayed', false, 'hold_released_at', v_tx.hold_released_at, 'money', to_jsonb(v_m));
END $$;

-- 7i. Provider errors an operator must see (never a secret: codes, HTTP status, Paynow's own error text).
CREATE OR REPLACE FUNCTION public.pay05_record_provider_error(
  p_kind text, p_tenant_id uuid, p_collection_id uuid, p_merchant_account_id uuid, p_detail jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.pay05_provider_errors (kind, tenant_id, collection_id, merchant_account_id, detail)
  VALUES (p_kind, p_tenant_id, p_collection_id, p_merchant_account_id, coalesce(p_detail, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ─────────────────────────── 8. privacy and least privilege ───────────────────────────

ALTER TABLE public.pay05_runtime_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay05_merchant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay05_merchant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay05_merchant_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay05_paynow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay05_paynow_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay05_provider_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pay05_runtime_guard, public.pay05_merchant_profiles, public.pay05_merchant_integrations,
  public.pay05_merchant_audit_events, public.pay05_paynow_transactions, public.pay05_paynow_observations, public.pay05_provider_errors
  FROM PUBLIC, anon, authenticated, service_role;
-- The backend reads (including the SEALED key, which only the backend's KEK opens). Every write goes through the writers.
GRANT SELECT ON TABLE public.pay05_runtime_guard, public.pay05_merchant_profiles, public.pay05_merchant_integrations,
  public.pay05_merchant_audit_events, public.pay05_paynow_transactions, public.pay05_paynow_observations, public.pay05_provider_errors
  TO service_role;

REVOKE ALL ON FUNCTION
  public.pay05_guard_integration(), public.pay05_guard_paynow_transaction(), public.pay05_hold_released(uuid),
  public.pay05_initiation_unresolved(uuid), public.pay05_verified_integration(uuid,text), public.pay05_latest_provider_status(uuid),
  public.pay05_integration_view(public.pay05_merchant_integrations),
  public.pay05_audit(uuid,uuid,uuid,text,text,text,jsonb),
  public.pay05_assert_independent_reviewer(public.pay04_garage_merchant_accounts,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.pay05_mode_permitted(text),
  public.pay05_register_paynow_merchant(uuid,uuid,text,text,jsonb,jsonb),
  public.pay05_verify_paynow_merchant(uuid,text,text,jsonb,text),
  public.pay05_reject_paynow_merchant(uuid,text,text,text),
  public.pay05_suspend_paynow_merchant(uuid,text,text,text),
  public.pay05_set_paynow_availability(boolean,text,text,text),
  public.pay05_record_paynow_sending(uuid,text,text,text),
  public.pay05_attach_paynow_collection(uuid,text,text,text,jsonb),
  public.pay05_mark_paynow_initiation(uuid,text,text),
  public.pay05_record_paynow_trace_absent(uuid),
  public.pay05_apply_paynow_observation(uuid,text,text,text,text,bigint,text,text,text,text),
  public.pay05_release_paynow_hold(uuid,text,text,text),
  public.pay05_record_provider_error(text,uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.pay05_mode_permitted(text),
  public.pay05_register_paynow_merchant(uuid,uuid,text,text,jsonb,jsonb),
  public.pay05_verify_paynow_merchant(uuid,text,text,jsonb,text),
  public.pay05_reject_paynow_merchant(uuid,text,text,text),
  public.pay05_suspend_paynow_merchant(uuid,text,text,text),
  public.pay05_set_paynow_availability(boolean,text,text,text),
  public.pay05_record_paynow_sending(uuid,text,text,text),
  public.pay05_attach_paynow_collection(uuid,text,text,text,jsonb),
  public.pay05_mark_paynow_initiation(uuid,text,text),
  public.pay05_record_paynow_trace_absent(uuid),
  public.pay05_apply_paynow_observation(uuid,text,text,text,text,bigint,text,text,text,text),
  public.pay05_release_paynow_hold(uuid,text,text,text),
  public.pay05_record_provider_error(text,uuid,uuid,uuid,jsonb)
  TO service_role;

COMMIT;

-- +migrate Down
-- PAY-05 never deletes merchant evidence, sealed credentials, Paynow observations or payment evidence in an automatic
-- rollback, and never restores a PAY-04 function that would ignore a Paynow hold or review (the PAY-04 / F5 rule).
DO $$ BEGIN RAISE EXCEPTION 'PAY05_RETAIN_PAYMENT_EVIDENCE'; END $$;
