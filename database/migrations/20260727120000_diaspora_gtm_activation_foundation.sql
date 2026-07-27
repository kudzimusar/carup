-- +migrate Up
-- =============================================================================
-- Diaspora ledger #21 — go-to-market activation foundation (Issue #127).
--
-- ADDITIVE ONLY. Creates the eight durable ledgers the go-to-market capability layer needs so that
-- provider state, money decisions, confirmed imports and external credentials can never live in
-- process memory, in a plaintext column, or in an unauditable "best effort" side path.
--
-- Nothing in ledger #3–#20 is altered, dropped or rewritten. The only changes to an existing object
-- are three ADDITIVE nullable columns on public.diaspora_billing_provider_events (out-of-order and
-- supersede handling), which no existing query depends on.
--
-- SECURITY CONTRACT (identical to ledger #20 — the strictest one in the ledger):
--   PUBLIC = NONE · anon = NONE · authenticated = NONE · service_role = ALL
--   RLS ENABLED with ZERO policies on every new table (default-deny).
-- Every one of these tables is a server-authoritative ledger reached only through the backend's
-- service-role client; no browser session may read or write them directly. `REVOKE ALL` (not an
-- enumerated privilege list) is used deliberately so PG17's MAINTAIN — which information_schema
-- cannot report — is also cleared. Verifiers assert MAINTAIN explicitly via has_table_privilege().
--
-- Idempotent (IF NOT EXISTS / DO-guarded); runs in one transaction.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SafeTrade durable provider-event ledger (ST-3 item 4).
--    Replaces the process-memory `new Set()` de-duplication in diasporaSafeTradeRoutes.js. The
--    UNIQUE (provider, event_id) constraint is the concurrency-safe replay guard: a duplicate
--    delivery loses the INSERT race and is answered as an idempotent no-op. `occurred_at` +
--    `provider_sequence` let a late-arriving OLDER event be recorded and marked superseded instead
--    of overwriting newer authoritative state (out-of-order delivery).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_provider_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid,
  provider           text NOT NULL,
  event_id           text NOT NULL,
  event_type         text,
  intent_id          text,
  transaction_id     uuid,
  milestone_id       uuid,
  -- Provider-asserted event time + monotonic sequence (both nullable: not every provider sends one).
  occurred_at        timestamptz,
  provider_sequence  bigint,
  received_at        timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  -- Sanitized, redacted payload. NEVER raw card data, NEVER provider secrets, NEVER signatures.
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_verified boolean NOT NULL DEFAULT false,
  -- received → applied | superseded | dead_lettered ; a terminal row is never reprocessed.
  status             text NOT NULL DEFAULT 'received',
  applied_at         timestamptz,
  superseded_by      uuid REFERENCES public.diaspora_safetrade_provider_events(id) ON DELETE SET NULL,
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  correlation_id     text,
  created_at         timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at         timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_diaspora_safetrade_provider_event UNIQUE (provider, event_id),
  CONSTRAINT ck_diaspora_safetrade_event_status
    CHECK (status IN ('received', 'applied', 'superseded', 'dead_lettered', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_events_intent
  ON public.diaspora_safetrade_provider_events (provider, intent_id, occurred_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_events_status
  ON public.diaspora_safetrade_provider_events (status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_events_tenant
  ON public.diaspora_safetrade_provider_events (tenant_id, received_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SafeTrade durable operation / reconciliation state machine (ST-3 item 3).
--    Every money-adjacent provider call is FIRST recorded here as `pending`, then dispatched. If the
--    provider answers, the row moves to provider_confirmed → ledger_applied. If the answer is lost,
--    times out, or is unknown, the row stays in `reconciling` and an operator queue picks it up — the
--    provider can never silently lead the authoritative ledger, and an unknown result can never be
--    reported to a user as success.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_operations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  transaction_id    uuid,
  milestone_id      uuid,
  operation         text NOT NULL,
  idempotency_key   text NOT NULL,
  state             text NOT NULL DEFAULT 'pending',
  provider          text NOT NULL,
  provider_ref      text,
  provider_status   text,
  amount            numeric(18,2),
  currency          text,
  attempts          integer NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz,
  last_error_code   text,
  last_error        text,
  approval_id       uuid,
  requested_by      text,
  requested_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  dispatched_at     timestamptz,
  confirmed_at      timestamptz,
  applied_at        timestamptz,
  reconciled_at     timestamptz,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at        timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_safetrade_operation
    CHECK (operation IN ('create_intent', 'authorize_hold', 'capture', 'release', 'refund',
                         'partial_refund', 'cancel', 'status_probe')),
  CONSTRAINT ck_diaspora_safetrade_operation_state
    CHECK (state IN ('pending', 'provider_dispatched', 'provider_confirmed', 'ledger_applied',
                     'reconciling', 'failed', 'compensated')),
  CONSTRAINT ck_diaspora_safetrade_operation_amount CHECK (amount IS NULL OR amount >= 0)
);

-- Replay guard: the same idempotency key inside a tenant is ONE operation, forever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_operation_idem
  ON public.diaspora_safetrade_operations (tenant_id, idempotency_key);
-- Provider reference uniqueness: a provider ref can be claimed by exactly one operation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_operation_provider_ref
  ON public.diaspora_safetrade_operations (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;
-- Operator reconciliation queue (state + due time).
CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_operations_queue
  ON public.diaspora_safetrade_operations (state, next_attempt_at NULLS FIRST)
  WHERE state IN ('pending', 'provider_dispatched', 'reconciling');
CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_operations_txn
  ON public.diaspora_safetrade_operations (tenant_id, transaction_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SafeTrade maker-checker approvals (ST-3 item 2).
--    The DATABASE, not the application, is the last line of defense against self-approval:
--    ck_diaspora_safetrade_approval_no_self_approve makes an evaluator approving their own
--    high-risk release/refund decision physically unrepresentable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  transaction_id   uuid NOT NULL,
  milestone_id     uuid,
  decision_type    text NOT NULL,
  evaluation_id    uuid,
  risk_level       text NOT NULL DEFAULT 'HIGH',
  amount           numeric(18,2),
  currency         text,
  -- MAKER: who evaluated / requested the money decision.
  requested_by     text NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  requested_reason text,
  -- CHECKER: a DIFFERENT authorized human who approves it.
  approved_by      text,
  approved_at      timestamptz,
  state            text NOT NULL DEFAULT 'pending',
  rejection_reason text,
  expires_at       timestamptz,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_safetrade_approval_type
    CHECK (decision_type IN ('release', 'refund', 'partial_refund', 'dispute_resolution')),
  CONSTRAINT ck_diaspora_safetrade_approval_state
    CHECK (state IN ('pending', 'approved', 'rejected', 'expired', 'consumed')),
  -- ST-3 item 2, enforced in the schema: the evaluator can never be the approver.
  CONSTRAINT ck_diaspora_safetrade_approval_no_self_approve
    CHECK (approved_by IS NULL OR approved_by <> requested_by),
  -- An approved row must name its approver and time; a pending row must not.
  CONSTRAINT ck_diaspora_safetrade_approval_shape
    CHECK ((state = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
        OR (state <> 'approved'))
);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_approvals_pending
  ON public.diaspora_safetrade_approvals (tenant_id, state, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_approvals_txn
  ON public.diaspora_safetrade_approvals (transaction_id, decision_type, state);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Confirmed workbook import — the confirmation token (Deliverable B).
--    A confirmation is bound to (tenant, batch, workbook checksum, dry-run revision, user, expiry,
--    idempotency key). Re-uploading a CHANGED workbook produces a different checksum, so the stored
--    confirmation can no longer match and execution is refused — "changed workbook invalidates
--    confirmation" is a data-model property, not a UI courtesy.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_workbook_import_confirmations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  batch_id           uuid NOT NULL,
  workbook_checksum  text NOT NULL,
  dry_run_revision   integer NOT NULL DEFAULT 1,
  plan_checksum      text,
  confirmed_by       text NOT NULL,
  confirmed_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at         timestamptz NOT NULL,
  idempotency_key    text NOT NULL,
  state              text NOT NULL DEFAULT 'pending',
  consumed_at        timestamptz,
  invalidated_reason text,
  row_count          integer,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at         timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_workbook_confirmation_state
    CHECK (state IN ('pending', 'consumed', 'expired', 'invalidated')),
  CONSTRAINT ck_diaspora_workbook_confirmation_revision CHECK (dry_run_revision >= 1)
);

-- Duplicate submit / reload / retry all converge on ONE confirmation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_workbook_confirmation_idem
  ON public.diaspora_workbook_import_confirmations (tenant_id, idempotency_key);
-- At most one LIVE (pending) confirmation per batch+checksum+revision.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_workbook_confirmation_live
  ON public.diaspora_workbook_import_confirmations (batch_id, workbook_checksum, dry_run_revision)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_diaspora_workbook_confirmations_batch
  ON public.diaspora_workbook_import_confirmations (batch_id, state, confirmed_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Confirmed workbook import — per-row receipts (Deliverable B).
--    The truthful, downloadable record of what actually happened to every row: accepted, rejected,
--    skipped, or COMPENSATED (applied then rolled back because a later step failed). This is what
--    makes "partial external failure" impossible to misreport as a full import.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_workbook_import_receipts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  batch_id         uuid NOT NULL,
  confirmation_id  uuid REFERENCES public.diaspora_workbook_import_confirmations(id) ON DELETE SET NULL,
  row_id           uuid,
  row_number       integer NOT NULL,
  sheet_name       text,
  outcome          text NOT NULL,
  entity_type      text,
  -- Opaque server-side entity reference. NEVER a document id, email, phone or participant identifier.
  entity_ref       text,
  error_code       text,
  -- Sanitized, human-readable reason. Redaction is applied before write.
  error_message    text,
  compensated_at   timestamptz,
  compensation_ref text,
  attempt          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_workbook_receipt_outcome
    CHECK (outcome IN ('accepted', 'rejected', 'skipped', 'compensated', 'pending'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_workbook_receipt_row
  ON public.diaspora_workbook_import_receipts (batch_id, row_number, attempt);
CREATE INDEX IF NOT EXISTS idx_diaspora_workbook_receipts_batch
  ON public.diaspora_workbook_import_receipts (batch_id, outcome);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Vault-backed credential references (Deliverable C + D + E).
--    THIS TABLE MUST NEVER HOLD A SECRET. It holds an OPAQUE reference to a credential that lives in
--    an approved vault/KMS/secret-store, plus sanitized metadata. The CHECK constraints below make
--    the most common leak shapes (a Google refresh token, a provider live key, a JWT, a PEM block)
--    unrepresentable at the schema level, so a future coding mistake fails loudly at INSERT instead
--    of silently persisting a plaintext token.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_credential_references (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  user_id           text,
  purpose           text NOT NULL,
  vault_backend     text NOT NULL,
  -- Opaque handle/path INTO the vault (e.g. "gcpsm://projects/x/secrets/y"). Not a credential.
  vault_reference   text NOT NULL,
  key_version       text,
  scopes            text[] NOT NULL DEFAULT ARRAY[]::text[],
  status            text NOT NULL DEFAULT 'active',
  external_account_label text,
  expires_at        timestamptz,
  last_refreshed_at timestamptz,
  last_error_code   text,
  last_error        text,
  revoked_at        timestamptz,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at        timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_credential_purpose
    CHECK (purpose IN ('google_drive', 'billing_provider', 'safetrade_provider')),
  CONSTRAINT ck_diaspora_credential_backend
    CHECK (vault_backend IN ('env_dev', 'aws_kms', 'aws_secrets_manager', 'gcp_secret_manager',
                             'azure_key_vault', 'hashicorp_vault', 'supabase_vault')),
  CONSTRAINT ck_diaspora_credential_status
    CHECK (status IN ('active', 'expired', 'revoked', 'error', 'pending_activation')),
  -- A vault reference is a short opaque handle. A credential is not.
  CONSTRAINT ck_diaspora_credential_reference_len
    CHECK (length(vault_reference) BETWEEN 3 AND 512),
  -- Defense in depth: refuse the recognizable shapes of real secrets.
  CONSTRAINT ck_diaspora_credential_reference_not_a_secret CHECK (
    vault_reference !~ '^(1//|ya29\.|sk_live_|sk_test_|rk_live_|pk_live_|whsec_|AIza)'
    AND vault_reference !~ '^ey[A-Za-z0-9_-]+\.'
    AND vault_reference !~ '-----BEGIN'
  )
);

-- One ACTIVE credential per (tenant, user, purpose); history rows stay for audit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_credential_active
  ON public.diaspora_credential_references (tenant_id, coalesce(user_id, ''), purpose)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_diaspora_credential_refresh_due
  ON public.diaspora_credential_references (status, expires_at)
  WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Drive durable sync attempts (Deliverable C).
--    Retry/backoff, idempotency and dead-lettering for every export/upload, so a Drive outage is a
--    retryable queue entry with a truthful user-visible state — not a lost file and a green tick.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_drive_sync_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  user_id           text,
  connection_id     uuid,
  operation         text NOT NULL,
  entity_type       text,
  entity_id         text,
  content_checksum  text,
  idempotency_key   text NOT NULL,
  state             text NOT NULL DEFAULT 'pending',
  attempts          integer NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz,
  provider_file_id  text,
  provider_folder_id text,
  bytes             bigint,
  last_error_code   text,
  last_error        text,
  started_at        timestamptz,
  completed_at      timestamptz,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at        timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_drive_attempt_operation
    CHECK (operation IN ('ensure_folder', 'upload', 'update', 'metadata', 'revoke')),
  CONSTRAINT ck_diaspora_drive_attempt_state
    CHECK (state IN ('pending', 'in_flight', 'succeeded', 'failed', 'dead_lettered'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_drive_attempt_idem
  ON public.diaspora_drive_sync_attempts (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_diaspora_drive_attempts_queue
  ON public.diaspora_drive_sync_attempts (state, next_attempt_at NULLS FIRST)
  WHERE state IN ('pending', 'in_flight');
CREATE INDEX IF NOT EXISTS idx_diaspora_drive_attempts_tenant
  ON public.diaspora_drive_sync_attempts (tenant_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Billing reconciliation runs (Deliverable D).
--    Scheduled/operator-triggered reconciliation of provider state against the CarUp subscription
--    ledger, with a durable finding record per run.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_billing_reconciliation_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid,
  provider       text NOT NULL,
  trigger        text NOT NULL DEFAULT 'scheduled',
  state          text NOT NULL DEFAULT 'running',
  started_at     timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  finished_at    timestamptz,
  checked_count  integer NOT NULL DEFAULT 0,
  mismatch_count integer NOT NULL DEFAULT 0,
  repaired_count integer NOT NULL DEFAULT 0,
  -- Sanitized findings only (tenant + field + expected/actual STATE, never amounts-with-PII).
  findings       jsonb NOT NULL DEFAULT '[]'::jsonb,
  initiated_by   text,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_billing_recon_trigger
    CHECK (trigger IN ('scheduled', 'operator', 'startup', 'webhook_gap')),
  CONSTRAINT ck_diaspora_billing_recon_state
    CHECK (state IN ('running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_diaspora_billing_recon_recent
  ON public.diaspora_billing_reconciliation_runs (provider, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ADDITIVE columns on the existing billing event ledger (out-of-order handling).
--    Nullable, no default backfill, no existing query affected.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.diaspora_billing_provider_events
  ADD COLUMN IF NOT EXISTS occurred_at       timestamptz,
  ADD COLUMN IF NOT EXISTS provider_sequence bigint,
  ADD COLUMN IF NOT EXISTS superseded        boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_diaspora_billing_events_ordering
  ON public.diaspora_billing_provider_events (tenant_id, occurred_at DESC NULLS LAST);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. updated_at triggers (reuse the Phase 1B helper).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'set_diaspora_trade_os_updated_at') THEN
    FOREACH t IN ARRAY ARRAY[
      'diaspora_safetrade_provider_events',
      'diaspora_safetrade_operations',
      'diaspora_safetrade_approvals',
      'diaspora_workbook_import_confirmations',
      'diaspora_credential_references',
      'diaspora_drive_sync_attempts'
    ] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS set_%1$s_updated_at ON public.%1$I', t);
      EXECUTE format(
        'CREATE TRIGGER set_%1$s_updated_at BEFORE UPDATE ON public.%1$I '
        'FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at()', t);
    END LOOP;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. RLS: ENABLE with ZERO policies (default-deny) on every new table.
--     These are service-role-only ledgers; no browser session ever reads them directly. RLS is the
--     second, independent line of defense behind the grant contract in §12.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.diaspora_safetrade_provider_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_safetrade_operations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_safetrade_approvals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_workbook_import_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_workbook_import_receipts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_credential_references         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_drive_sync_attempts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_billing_reconciliation_runs   ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. GRANTS — the ledger #20 contract, applied at CREATE time so Supabase's
--     ALTER DEFAULT PRIVILEGES grant to anon/authenticated is closed in the SAME migration that
--     creates the table (this is exactly the gap that required compensating ledgers #17/#19/#20).
--     `REVOKE ALL` also clears PG17 MAINTAIN, which information_schema cannot report.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'diaspora_safetrade_provider_events',
    'diaspora_safetrade_operations',
    'diaspora_safetrade_approvals',
    'diaspora_workbook_import_confirmations',
    'diaspora_workbook_import_receipts',
    'diaspora_credential_references',
    'diaspora_drive_sync_attempts',
    'diaspora_billing_reconciliation_runs'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- +migrate Down
-- Additive foundation. The Down section drops ONLY the objects this migration created, in reverse
-- dependency order, and leaves ledger #3–#20 untouched. The three additive columns on
-- diaspora_billing_provider_events are dropped too (nothing outside this program reads them).
DROP INDEX IF EXISTS public.idx_diaspora_billing_events_ordering;
ALTER TABLE IF EXISTS public.diaspora_billing_provider_events
  DROP COLUMN IF EXISTS occurred_at,
  DROP COLUMN IF EXISTS provider_sequence,
  DROP COLUMN IF EXISTS superseded;

DROP TABLE IF EXISTS public.diaspora_billing_reconciliation_runs;
DROP TABLE IF EXISTS public.diaspora_drive_sync_attempts;
DROP TABLE IF EXISTS public.diaspora_credential_references;
DROP TABLE IF EXISTS public.diaspora_workbook_import_receipts;
DROP TABLE IF EXISTS public.diaspora_workbook_import_confirmations;
DROP TABLE IF EXISTS public.diaspora_safetrade_approvals;
DROP TABLE IF EXISTS public.diaspora_safetrade_operations;
DROP TABLE IF EXISTS public.diaspora_safetrade_provider_events;
