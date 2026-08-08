-- Referral V1 Stage-4 remediation: atomic idempotency for the marketplace inquiry → qualifiable lead bridge.
--
-- The bridge that turns an attributed marketplace inquiry into the qualifiable
-- `local_marketplace.lead_created` referral event uses a check-then-insert idempotency guard. Under
-- concurrent execution two callers can both pass the "no existing lead" check and both insert, producing
-- two leads for one inquiry. This partial unique index makes the database itself enforce the invariant:
--
--     one source inquiry  ->  at most one local_marketplace.lead_created event
--
-- It is scoped to inquiry-derived local-marketplace lead events only: existing/other lead events that
-- carry no `source_inquiry_id` are excluded by the WHERE clause, so no historical rows conflict.
--
-- Additive + idempotent (IF NOT EXISTS); enables no providers, issues no rewards, alters no data.
-- Apply to staging first; do NOT apply to production ahead of the Referral V1 production cutover (Stage 10).

CREATE UNIQUE INDEX IF NOT EXISTS referral_events_lead_source_inquiry_uidx
  ON public.referral_events ((metadata->>'source_inquiry_id'))
  WHERE event_type = 'local_marketplace.lead_created'
    AND (metadata->>'source_inquiry_id') IS NOT NULL;
