-- +migrate Up
-- OC-5R REL-03B-5 — truthful historical outbox quarantine.
--
-- "quarantined" means the historical event is preserved but intentionally excluded
-- from current delivery because subsequent authority reconciliation proved it is
-- obsolete, duplicate, audit-only, or retired.
--
-- It does NOT mean:
--   processed
--   delivery failed
--   business action completed
--   customer notified

ALTER TABLE public.domain_events
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_reason text,
  ADD COLUMN IF NOT EXISTS quarantine_metadata jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.domain_events'::regclass
      AND conname = 'domain_events_quarantined_requires_provenance'
  ) THEN
    ALTER TABLE public.domain_events
      ADD CONSTRAINT domain_events_quarantined_requires_provenance
      CHECK (
        status <> 'quarantined'
        OR (
          quarantined_at IS NOT NULL
          AND NULLIF(BTRIM(quarantine_reason), '') IS NOT NULL
        )
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.domain_events.quarantined_at IS
  'When a preserved historical outbox event was intentionally removed from current delivery authority.';

COMMENT ON COLUMN public.domain_events.quarantine_reason IS
  'Governed reason code for historical quarantine; quarantine is neither processed nor failed delivery.';

COMMENT ON COLUMN public.domain_events.quarantine_metadata IS
  'Operator provenance for historical quarantine; payload content is not copied here.';

COMMENT ON CONSTRAINT domain_events_quarantined_requires_provenance ON public.domain_events IS
  'A quarantined historical event must carry timestamp and governed reason provenance.';
