-- +migrate Up
-- CarUp Email Experience 1.0 — final source hardening.
--
-- One governed package, three additive changes. Nothing here rewrites existing data, and nothing
-- here touches production.
--
--   G5-D1  email_reply_tokens.version DEFAULT 1 -> 2   (configuration drift; the application has
--          minted v2 since G5. Existing v1 rows are UNTOUCHED — credentials already delivered to
--          inboxes must keep resolving until their own expiry.)
--   G5-D3  DROP the redundant non-unique index on token_hash. The UNIQUE constraint on the same
--          column already provides an equivalent unique btree; the extra index serves no query the
--          unique one cannot and costs a write on the table's hottest column.
--   R5-D1  ADD vehicles.trust_presentation_announced_fingerprint. The durable marker that makes a
--          lost Trust announcement recoverable rather than permanently lost.
--
-- STAGING ONLY in this change. Production application is a separate, separately authorised step.

BEGIN;

-- ---------------------------------------------------------------------------
-- G5-D1 — future implicit inserts default to the current application version.
-- ---------------------------------------------------------------------------
-- Only the DEFAULT changes. No UPDATE, no backfill: a v1 row is a v1 credential, and rewriting its
-- version would misdescribe a token that is still in somebody's inbox.
ALTER TABLE public.email_reply_tokens
  ALTER COLUMN version SET DEFAULT 2;

COMMENT ON COLUMN public.email_reply_tokens.version IS
  'Token generation. 1 = random (pre-G5, unrecoverable raw value). 2 = derived from the row id via '
  'HMAC with CARUP_EMAIL_REPLY_TOKEN_SECRET, so the trusted server can reproduce it while the '
  'database still stores only a hash. Live v1 rows remain valid until their own expiry.';

-- ---------------------------------------------------------------------------
-- G5-D3 — remove the duplicate token_hash index.
-- ---------------------------------------------------------------------------
-- `token_hash text NOT NULL UNIQUE` already creates email_reply_tokens_token_hash_key: a UNIQUE
-- btree on exactly (token_hash), no predicate, default opclass, same ordering. Equality lookup —
-- the only access pattern this column has — is served identically by it.
--
-- CONCURRENTLY is deliberately NOT used: it cannot run inside a transaction block, and this package
-- is transactional so a partial application cannot leave the schema half-changed. The table is
-- small (single-digit rows in staging) so the brief lock is not material.
DROP INDEX IF EXISTS public.idx_email_reply_tokens_hash;

-- ---------------------------------------------------------------------------
-- R5-D1 — the durable Trust announcement marker.
-- ---------------------------------------------------------------------------
-- The defect: refreshCanonicalTrust wrote the canonical cache, then emitted
-- vehicle.trust.presentation_changed, and swallowed a failure of that emit. If the outbox insert
-- failed the customer-visible change was lost PERMANENTLY, because the next refresh would compare
-- against the already-written cache, find no material change, and never reconstruct the event.
--
-- This column records the fingerprint of the presentation that was actually ANNOUNCED. The
-- comparison is therefore "what did we tell them?" rather than "what did we last write?", so an
-- announcement that never happened is still outstanding and is retried. It is also the idempotency
-- key: reconciling the same transition twice produces the same fingerprint and emits once.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS trust_presentation_announced_fingerprint text;

COMMENT ON COLUMN public.vehicles.trust_presentation_announced_fingerprint IS
  'SHA-256 of the audience-safe Trust presentation last ANNOUNCED to the vehicle owner via '
  'vehicle.trust.presentation_changed. NULL means never announced. Compared against the current '
  'presentation fingerprint so a failed announcement is recoverable rather than permanently lost.';

-- The reconciliation scan reads an EXPLICIT work flag (below), never "marker IS NULL", so this
-- index exists only to make the never-announced population cheap for operational inspection.
CREATE INDEX IF NOT EXISTS idx_vehicles_trust_unannounced
  ON public.vehicles (vin)
  WHERE trust_presentation_announced_fingerprint IS NULL;

-- ---------------------------------------------------------------------------
-- PRIVATE RECONCILIATION WORK QUEUE — the final root correction.
-- ---------------------------------------------------------------------------
-- Two designs preceded this one, and each failed for a reason worth recording.
--
-- The first INFERRED outstanding work from timestamps ("verified after a watermark"), which made a
-- routine Trust recompute look like news, let a settled prefix starve the batch, and turned the
-- watermark itself into a client-writable table.
--
-- The second stored explicit boolean flags ON THE PUBLIC TABLES. That fixed inference but failed on
-- privilege reality: PostgreSQL privileges are ADDITIVE, and live staging grants anon/authenticated
-- table-level UPDATE on public.users, so a column-level revoke on a users flag was inert — a client
-- could manufacture a Welcome or suppress one. And its final "SET flag = false" was unconditional,
-- so a material change landing mid-reconciliation had its freshly-declared work silently wiped.
--
-- So reconciliation work now lives in its OWN service-only table. Not a column on a client-reachable
-- table whose grant posture this programme does not own, but a row in a table where the entire
-- privilege surface is defined here: RLS enabled, every client privilege revoked. Rows are created
-- by database triggers in the same transaction as the state change that created the work, carry a
-- GENERATION and a material FINGERPRINT, and are retired only by an atomic conditional delete that
-- names both — so a newer generation created mid-flight survives the older worker's retirement.
--
-- Historical state creates NO rows: the triggers fire only on post-migration transitions, and this
-- migration performs no backfill. Baseline is a property of construction, not of comparison.
CREATE TABLE IF NOT EXISTS public.communication_reconciliation_work (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_type text NOT NULL CHECK (work_type IN ('user_email_verified', 'vehicle_trust_presentation')),
  subject_id text NOT NULL,
  -- Monotonic per logical work item. A material change UPSERTS generation+1 onto the existing row
  -- rather than growing an unbounded pile, and retirement compares it so an in-flight worker can
  -- never retire work it has not seen.
  generation bigint NOT NULL DEFAULT 1,
  -- The material identity of the state that created this generation (R5 only; NULL for R1).
  -- An optimistic-concurrency token computed in SQL over the same material columns the trigger
  -- compares — deliberately NOT the application's trustPresentationFingerprint, which remains the
  -- sole announcement/dedupe identity. This one only has to change when the material state does.
  work_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  -- Exactly one CURRENT logical pending work item per subject.
  CONSTRAINT uq_communication_reconciliation_work UNIQUE (work_type, subject_id)
);

COMMENT ON TABLE public.communication_reconciliation_work IS
  'Internal service-only reconciliation work queue for CarUp Communications. Rows are enqueued by '
  'database triggers on canonical state transitions and retired by the scheduled worker with an '
  'atomic generation+fingerprint compare. No client role holds any privilege on this table.';

-- The scheduled scan: WHERE work_type = $1 ORDER BY subject_id LIMIT n.
CREATE INDEX IF NOT EXISTS idx_communication_reconciliation_work_scan
  ON public.communication_reconciliation_work (work_type, subject_id);

-- SERVICE ONLY. RLS on with no policies means even a stray future grant admits zero rows, and the
-- revokes remove the Supabase default privileges outright. Both layers, because privilege posture
-- on public-schema tables is exactly where the previous design failed.
ALTER TABLE public.communication_reconciliation_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_reconciliation_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.communication_reconciliation_work FROM PUBLIC, anon, authenticated;

-- R1 — a NULL -> NOT NULL email_verified_at transition enqueues welcome work. ------------------
-- Same transaction as the verification write, so the work record and the state change cannot
-- diverge and no deployment order can open a gap. Re-verification of an already-verified address
-- does not fire; nor does any unrelated update to the row. ON CONFLICT keeps one logical item.
CREATE OR REPLACE FUNCTION public.enqueue_email_welcome_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.email_verified_at IS NULL AND NEW.email_verified_at IS NOT NULL THEN
    INSERT INTO public.communication_reconciliation_work (work_type, subject_id)
    VALUES ('user_email_verified', NEW.id::text)
    ON CONFLICT ON CONSTRAINT uq_communication_reconciliation_work
    DO UPDATE SET updated_at = timezone('utc'::text, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_enqueue_welcome_reconciliation ON public.users;
CREATE TRIGGER trg_users_enqueue_welcome_reconciliation
  AFTER UPDATE OF email_verified_at ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_email_welcome_reconciliation();

-- R5 — a MATERIAL Trust presentation change enqueues announcement work. ------------------------
-- The comparison is the established material contract: the customer-visible stored position and
-- nothing else. `trust_evaluated_at` is when the calculation ran, not what it concluded — including
-- it is precisely the earlier defect, because a recompute that changes nothing a customer can see
-- would then look like news. `vin` is identity, not presentation. IS DISTINCT FROM throughout:
-- several columns are nullable and two are jsonb, where plain `<>` treats a NULL transition as
-- unknown and silently skips a real change. This function computes no score and decides nothing
-- about Trust; it answers only "did the persisted customer-visible position move?".
CREATE OR REPLACE FUNCTION public.enqueue_trust_presentation_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fingerprint text;
BEGIN
  IF NEW.trust_score              IS DISTINCT FROM OLD.trust_score
     OR NEW.trust_band                IS DISTINCT FROM OLD.trust_band
     OR NEW.trust_confidence          IS DISTINCT FROM OLD.trust_confidence
     OR NEW.trust_evidence_basis      IS DISTINCT FROM OLD.trust_evidence_basis
     OR NEW.trust_known_limitations   IS DISTINCT FROM OLD.trust_known_limitations
     OR NEW.trust_calculation_version IS DISTINCT FROM OLD.trust_calculation_version
  THEN
    -- The concurrency token for THIS material state. sha256 over the material columns in a fixed
    -- order; jsonb::text is deterministic because jsonb is stored normalised.
    v_fingerprint := encode(sha256(convert_to(concat_ws('|',
      coalesce(NEW.trust_score::text, ''),
      coalesce(NEW.trust_band, ''),
      coalesce(NEW.trust_confidence, ''),
      coalesce(NEW.trust_evidence_basis::text, ''),
      coalesce(NEW.trust_known_limitations::text, ''),
      coalesce(NEW.trust_calculation_version, '')
    ), 'UTF8')), 'hex');

    INSERT INTO public.communication_reconciliation_work (work_type, subject_id, generation, work_fingerprint)
    VALUES ('vehicle_trust_presentation', NEW.vin, 1, v_fingerprint)
    ON CONFLICT ON CONSTRAINT uq_communication_reconciliation_work
    DO UPDATE SET
      generation = public.communication_reconciliation_work.generation + 1,
      work_fingerprint = EXCLUDED.work_fingerprint,
      updated_at = timezone('utc'::text, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicles_enqueue_trust_reconciliation ON public.vehicles;
CREATE TRIGGER trg_vehicles_enqueue_trust_reconciliation
  AFTER UPDATE ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_trust_presentation_reconciliation();

-- CREATE FUNCTION grants EXECUTE to PUBLIC BY DEFAULT, and granting one role does not remove that.
-- These run as trigger bodies only; a caller able to invoke them directly could stamp work into the
-- queue. SECURITY DEFINER above is what lets the trigger write a table no client can touch even
-- when the triggering UPDATE runs as a client role — which makes revoking direct EXECUTE essential.
REVOKE ALL ON FUNCTION public.enqueue_email_welcome_reconciliation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_trust_presentation_reconciliation()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C3-A — durable database idempotency for the Trust announcement event.
-- ---------------------------------------------------------------------------
-- The marker above makes a LOST announcement recoverable. It does not make a REPEATED one harmless,
-- and those are different failures. If the outbox insert succeeds but the marker write does not,
-- the next refresh legitimately re-emits — and without a dedupe key that second insert becomes a
-- second row, a second notification, and a second Email about a Trust change the owner was already
-- told about.
--
-- `communication_domain_event_dedupe_key()` already exists and already derives a key, but only for
-- marketplace.inquiry.created. Every other event type — including this one — is left with a NULL
-- dedupe_key, and `idx_domain_events_dedupe_key` is a PARTIAL unique index over NOT NULL keys, so a
-- NULL key is exempt from it by construction.
--
-- The fingerprint is the identity that already exists. `trustPresentationFingerprint()` hashes the
-- audience-safe projection, so the same material presentation yields the same value and a
-- timestamp-only recomputation yields no event at all. Reusing it here means the database enforces
-- exactly the idempotency the producer already reasons about, rather than a second notion of
-- sameness that could drift from it.
--
-- Marketplace behaviour is preserved BYTE-FOR-BYTE: the same branch, the same key format, the same
-- NULLIF guard. This function is additive.
CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inquiry_id TEXT;
  v_fingerprint TEXT;
  v_recipient TEXT;
BEGIN
  IF NEW.event_type = 'marketplace.inquiry.created' THEN
    v_inquiry_id := NULLIF(NEW.payload ->> 'inquiryId', '');
    IF v_inquiry_id IS NOT NULL THEN
      NEW.dedupe_key := 'marketplace.inquiry.created:' || v_inquiry_id;
    END IF;
  ELSIF NEW.event_type = 'user.email.verified' THEN
    -- R1. One verification per account means one welcome work item per account; a replayed emit
    -- must recover the existing row rather than create a second piece of pending work.
    v_recipient := NULLIF(NEW.payload ->> 'recipientUserId', '');
    IF v_recipient IS NOT NULL THEN
      NEW.dedupe_key := 'user.email.verified:' || v_recipient;
    END IF;
  ELSIF NEW.event_type = 'vehicle.trust.presentation_changed' THEN
    -- No fingerprint means no identity. Leaving dedupe_key NULL keeps the row insertable rather
    -- than rejecting a Trust announcement over a missing idempotency hint — losing the event is a
    -- worse outcome than repeating it, and the producer will not emit without a fingerprint anyway.
    v_fingerprint := NULLIF(NEW.payload ->> 'presentation_fingerprint', '');
    IF v_fingerprint IS NOT NULL THEN
      NEW.dedupe_key := 'vehicle.trust.presentation_changed:' || v_fingerprint;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged and already installed by 20260811132100; it is re-asserted here
-- only so that applying this package to an environment that somehow lacks it is still correct.
DROP TRIGGER IF EXISTS trg_domain_events_communication_dedupe
  ON public.domain_events;
CREATE TRIGGER trg_domain_events_communication_dedupe
  BEFORE INSERT ON public.domain_events
  FOR EACH ROW
  EXECUTE FUNCTION public.communication_domain_event_dedupe_key();

-- Revoked AFTER the CREATE OR REPLACE above, so this package is also correct against a database
-- where the function does not yet pre-exist. CREATE FUNCTION grants EXECUTE to PUBLIC by default.
REVOKE ALL ON FUNCTION public.communication_domain_event_dedupe_key()
  FROM PUBLIC, anon, authenticated;

COMMIT;
