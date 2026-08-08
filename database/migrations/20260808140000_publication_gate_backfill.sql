-- Publication gate backfill — preserve today's marketplace visibility while the
-- read path starts enforcing publication_status.
--
-- Context: 20260624140000 introduced publication_status (NOT NULL DEFAULT 'draft')
-- but no code path ever advanced it, and the public marketplace read path never
-- filtered on it — so every listing created since is 'draft' AND publicly visible.
-- The advancement pass adds the read-path filter (publishable|published only) and
-- seller publish/unpublish endpoints. Without this backfill, deploying the filter
-- would instantly hide every currently-visible listing.
--
-- This promotes exactly the rows that are publicly visible today (public
-- availability statuses) out of pre-publication states into 'published',
-- preserving observed behavior. New listings start at 'draft' and go through the
-- real completeness-gated publish flow.

-- +migrate Up
UPDATE vehicles
   SET publication_status = 'published'
 WHERE publication_status IN ('draft', 'identity_complete', 'documents_submitted', 'review_pending')
   AND status IN ('Available', 'Reserved', 'available', 'reserved', 'ACTIVE', 'RESERVED');

-- +migrate Down
-- Irreversible data promotion: the per-row pre-backfill publication_status is not
-- recorded. Restoring requires point-in-time backup. Intentionally a no-op.
SELECT 1;
