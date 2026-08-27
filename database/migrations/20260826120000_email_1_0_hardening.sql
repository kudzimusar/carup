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
-- EXPLICIT RECOVERY WORK — the root correction.
-- ---------------------------------------------------------------------------
-- The previous design INFERRED outstanding work after the fact: "verified after a watermark", or
-- "announced-fingerprint is NULL and the position was evaluated after a watermark". Every one of the
-- four defects that design produced came from that single choice:
--
--   * a timestamp-only recompute moved a HISTORICAL vehicle past the watermark while its marker was
--     still NULL, so a routine reevaluation would have mailed a retroactive Trust change;
--   * the LIMIT was applied to inferred candidates and the "already handled" test ran afterwards in
--     JavaScript, so a settled prefix re-occupied the batch every minute and genuinely lost work
--     behind it was never reached;
--   * a permanently non-actionable row could hold the front of that queue forever;
--   * and the watermark itself became a client-writable security surface.
--
-- Inference is replaced by explicit durable state. A row is pending because something DECLARED it
-- pending, in the same transaction as the change that made it pending. Historical rows default
-- FALSE and are never backfilled, so baseline is guaranteed BY CONSTRUCTION rather than by a
-- comparison that some later write can invalidate.
--
-- The flags are set by DATABASE TRIGGERS, not by the application. The marker and the state
-- transition then cannot diverge, no deployment ordering can open a gap, and the existing auth and
-- Trust writers keep working unchanged — neither has to learn about a new column.

-- R1 --------------------------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_welcome_reconcile_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.email_welcome_reconcile_required IS
  'Internal. TRUE when this account''s user.email.verified work item still needs reconstruction or '
  'confirmation. Set only by trigger on the NULL -> NOT NULL email_verified_at transition, so every '
  'account verified before this migration stays FALSE and receives no retroactive Welcome.';

CREATE OR REPLACE FUNCTION public.email_welcome_reconcile_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- ONLY the transition. Re-verifying an already-verified address, or any other update to the row,
  -- must not re-queue a Welcome the account has already had.
  IF OLD.email_verified_at IS NULL AND NEW.email_verified_at IS NOT NULL THEN
    NEW.email_welcome_reconcile_required := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_email_welcome_reconcile ON public.users;
CREATE TRIGGER trg_users_email_welcome_reconcile
  BEFORE UPDATE OF email_verified_at ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.email_welcome_reconcile_flag();

CREATE INDEX IF NOT EXISTS idx_users_welcome_reconcile_pending
  ON public.users (id)
  WHERE email_welcome_reconcile_required;

-- R5 --------------------------------------------------------------------------------------------
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS trust_presentation_reconcile_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vehicles.trust_presentation_reconcile_required IS
  'Internal. TRUE when the persisted customer-visible Trust position materially moved and that '
  'change has not yet been reconciled into an announcement. Set only by trigger, only on a MATERIAL '
  'change. A timestamp-only recompute does not set it, and historical rows stay FALSE.';

CREATE OR REPLACE FUNCTION public.trust_presentation_reconcile_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- This function is NOT a second Trust authority. It computes nothing and decides nothing about
  -- what a score should be. It answers exactly one question: did the PERSISTED customer-visible
  -- position materially move?
  --
  -- `vin` is identity, not presentation. `trust_evaluated_at` is when the calculation last ran, not
  -- what it concluded — including it is precisely the defect this replaces, because a routine
  -- recompute that changes nothing a customer can see would then look like news.
  --
  -- IS DISTINCT FROM throughout: several of these are nullable, and two are jsonb, where plain `<>`
  -- would treat a NULL transition as "unknown" and silently skip a real change.
  IF NEW.trust_score              IS DISTINCT FROM OLD.trust_score
     OR NEW.trust_band                IS DISTINCT FROM OLD.trust_band
     OR NEW.trust_confidence          IS DISTINCT FROM OLD.trust_confidence
     OR NEW.trust_evidence_basis      IS DISTINCT FROM OLD.trust_evidence_basis
     OR NEW.trust_known_limitations   IS DISTINCT FROM OLD.trust_known_limitations
     OR NEW.trust_calculation_version IS DISTINCT FROM OLD.trust_calculation_version
  THEN
    NEW.trust_presentation_reconcile_required := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicles_trust_presentation_reconcile ON public.vehicles;
CREATE TRIGGER trg_vehicles_trust_presentation_reconcile
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.trust_presentation_reconcile_flag();

CREATE INDEX IF NOT EXISTS idx_vehicles_trust_reconcile_pending
  ON public.vehicles (vin)
  WHERE trust_presentation_reconcile_required;

-- ---------------------------------------------------------------------------
-- These flags are SERVICE-ONLY authority.
-- ---------------------------------------------------------------------------
-- A client that could set them could manufacture reconciliation work — an arbitrary Welcome or an
-- arbitrary Trust announcement. A client that could clear them could silently suppress a real one.
-- Supabase grants anon/authenticated broad privileges on public-schema tables by default, so the
-- revoke has to be explicit; this repository already establishes that pattern in
-- 20260814090000_issue101_p0_rls_and_view_hardening.sql. Column-level so nothing else changes.
REVOKE UPDATE (email_welcome_reconcile_required) ON public.users FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (trust_presentation_reconcile_required, trust_presentation_announced_fingerprint)
  ON public.vehicles FROM PUBLIC, anon, authenticated;

-- CREATE FUNCTION grants EXECUTE to PUBLIC BY DEFAULT, and granting one role does not remove that.
-- Both functions above run as trigger bodies only; nothing should be able to call them directly, and
-- a caller who could would be able to stamp reconciliation work onto any row. This repository's
-- `db-anon-grant-posture` gate caught the omission — it treats any CREATE FUNCTION on a protected
-- table as an indirect exposure until the file revokes it explicitly, which is the correct default.
REVOKE ALL ON FUNCTION public.email_welcome_reconcile_flag()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trust_presentation_reconcile_flag()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.communication_domain_event_dedupe_key()
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

COMMIT;
