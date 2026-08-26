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

-- Reconciliation scans "announced != current", which cannot be expressed as an index predicate.
-- This index makes the never-announced population cheap to find, which is the common backlog.
CREATE INDEX IF NOT EXISTS idx_vehicles_trust_unannounced
  ON public.vehicles (vin)
  WHERE trust_presentation_announced_fingerprint IS NULL;

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
BEGIN
  IF NEW.event_type = 'marketplace.inquiry.created' THEN
    v_inquiry_id := NULLIF(NEW.payload ->> 'inquiryId', '');
    IF v_inquiry_id IS NOT NULL THEN
      NEW.dedupe_key := 'marketplace.inquiry.created:' || v_inquiry_id;
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
