-- +migrate Up
-- CarUp Intelligence 1.0 — I17: next-best-action suppression state.
--
-- WHY A TABLE AT ALL. The recommendation rules themselves are pure functions of
-- the authoritative data — given the same inputs they produce the same output, so
-- nothing about a recommendation needs storing to be reproducible. What DOES need
-- storing is the one thing that is not derivable: whether a human has already
-- seen, acted on, or dismissed this advice.
--
-- Without that, "suppression/cooldown" is a claim rather than a mechanism, and a
-- surface would repeat the same nag every render. This table therefore records
-- ONLY the interaction, never the recommendation's content.
--
-- WHY A FINGERPRINT AND NOT THE PAYLOAD. Storing the rendered recommendation
-- would create a second, staler copy of a number whose authority lives elsewhere —
-- the mistake `vehicle_listing_summaries` was dropped for. The fingerprint is a
-- hash of (rule, subject, the evidence that triggered it), so re-firing on
-- MATERIALLY CHANGED evidence is possible while an unchanged nag stays suppressed.
--
-- NOT AUTHORITY. Nothing here decides anything. A missing row means "not yet
-- shown", which is exactly what a first render should conclude.

CREATE TABLE IF NOT EXISTS intelligence_recommendation_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which rule, and who it is about. `subject_type` is the scope kind
  -- ('listing', 'seller', 'tenant', 'platform') and `subject_id` its identifier.
  rule_key          TEXT NOT NULL,
  subject_type      TEXT NOT NULL,
  subject_id        TEXT NOT NULL,

  -- Hash of the evidence that produced this recommendation. Same evidence means
  -- the same advice, so suppression holds; materially different evidence is a new
  -- recommendation and may fire again.
  evidence_fingerprint TEXT NOT NULL,

  -- The interaction, which is the only non-derivable part.
  first_emitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_emitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emitted_count     INTEGER NOT NULL DEFAULT 1 CHECK (emitted_count >= 0),
  dismissed_at      TIMESTAMPTZ,
  acted_at          TIMESTAMPTZ,
  -- Set when a viewer asks for it later; a null value means no active snooze.
  snoozed_until     TIMESTAMPTZ,

  -- Server-derived at write time; never taken from a caller.
  actor_user_id     TEXT,
  tenant_id         TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_recommendation_subject_type_chk
    CHECK (subject_type IN ('listing', 'seller', 'tenant', 'platform'))
);

-- One live state row per rule per subject per evidence shape. This is what makes
-- suppression idempotent: a repeated evaluation updates rather than accumulates.
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_recommendation_state_unique_idx
  ON intelligence_recommendation_state (rule_key, subject_type, subject_id, evidence_fingerprint);

-- The read path: "what is currently suppressed for this subject".
CREATE INDEX IF NOT EXISTS intelligence_recommendation_state_subject_idx
  ON intelligence_recommendation_state (subject_type, subject_id, rule_key);

CREATE INDEX IF NOT EXISTS intelligence_recommendation_state_snooze_idx
  ON intelligence_recommendation_state (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- Service-only, matching every other Intelligence table: RLS enabled AND forced,
-- zero policies, no anon/authenticated grants. The API layer is the boundary.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE intelligence_recommendation_state ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE intelligence_recommendation_state FORCE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE intelligence_recommendation_state FROM anon';
  EXECUTE 'REVOKE ALL ON TABLE intelligence_recommendation_state FROM authenticated';
  EXECUTE 'REVOKE ALL ON TABLE intelligence_recommendation_state FROM PUBLIC';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE intelligence_recommendation_state TO service_role';
END $$;

COMMENT ON TABLE intelligence_recommendation_state IS
  'I17 suppression/cooldown state only. Records that a recommendation was shown, dismissed or acted on — never the recommendation itself, which is always recomputed from authoritative data.';

COMMENT ON COLUMN intelligence_recommendation_state.evidence_fingerprint IS
  'Hash of the evidence that triggered the rule. Unchanged evidence stays suppressed; materially changed evidence is a new recommendation.';

-- +migrate Down
DROP TABLE IF EXISTS intelligence_recommendation_state;
