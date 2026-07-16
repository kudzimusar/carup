-- +migrate Up
-- Referral V1 Stage 4 privacy hardening.
--
-- The inquiry-to-referral-lead recovery event is persisted in domain_events.
-- Keep only the identifiers and controlled classification hints required to
-- reconstruct the canonical referral lead. Never persist buyer contact fields,
-- free-form inquiry text, risk metadata, seller ids, or the full inquiry row in
-- the general outbox payload.
--
-- This migration also redacts existing staging/test outbox rows. That redaction
-- is intentionally irreversible; the source marketplace_inquiries row remains
-- the authorized source of truth for seller/admin follow-up.

CREATE OR REPLACE FUNCTION public.minimize_referral_bridge_outbox_payload(input_payload jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'inquiry', pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'id', input_payload #>> '{inquiry,id}',
          'listing_id', input_payload #>> '{inquiry,listing_id}',
          'inquiry_type', input_payload #>> '{inquiry,inquiry_type}',
          'source_channel', input_payload #>> '{inquiry,source_channel}',
          'referral_code', input_payload #>> '{inquiry,referral_code}',
          'buyer_id', input_payload #>> '{inquiry,buyer_id}',
          'seller_tenant_id', input_payload #>> '{inquiry,seller_tenant_id}',
          -- Controlled, non-user-authored classifier text used only if the
          -- synchronous bridge fails and the outbox worker has to recover.
          'message', CASE input_payload #>> '{inquiry,inquiry_type}'
            WHEN 'vehicle_purchase_interest' THEN 'buy vehicle'
            WHEN 'vehicle_inspection_request' THEN 'vehicle inspection'
            WHEN 'part_quote_request' THEN 'find parts'
            WHEN 'garage_service_request' THEN 'mechanic service'
            WHEN 'import_quote_request' THEN 'buy vehicle import'
            WHEN 'container_space_interest' THEN 'container space request'
            WHEN 'dealer_stock_request' THEN 'supplier quote vehicle stock'
            WHEN 'sell_my_car_request' THEN 'sell vehicle'
            WHEN 'trade_in_request' THEN 'sell vehicle trade in'
            WHEN 'diaspora_vehicle_request' THEN 'buy vehicle import'
            WHEN 'diaspora_parts_request' THEN 'find parts import'
            WHEN 'family_purchase_support' THEN 'buy vehicle family support'
            ELSE 'local marketplace request'
          END
        )
      ),
      'actor', pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'actor_user_id', COALESCE(
            input_payload #>> '{actor,actor_user_id}',
            input_payload #>> '{actor,id}'
          ),
          'id', COALESCE(
            input_payload #>> '{actor,id}',
            input_payload #>> '{actor,actor_user_id}'
          ),
          'actor_type', COALESCE(
            input_payload #>> '{actor,actor_type}',
            'user'
          )
        )
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_referral_bridge_outbox_payload_minimization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.event_type = 'marketplace.inquiry.referral_bridge_requested' THEN
    NEW.payload := public.minimize_referral_bridge_outbox_payload(NEW.payload);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_minimize_referral_bridge_outbox_payload ON public.domain_events;
CREATE TRIGGER trg_minimize_referral_bridge_outbox_payload
BEFORE INSERT OR UPDATE OF event_type, payload
ON public.domain_events
FOR EACH ROW
EXECUTE FUNCTION public.enforce_referral_bridge_outbox_payload_minimization();

UPDATE public.domain_events
SET payload = public.minimize_referral_bridge_outbox_payload(payload)
WHERE event_type = 'marketplace.inquiry.referral_bridge_requested';

-- +migrate Down
DROP TRIGGER IF EXISTS trg_minimize_referral_bridge_outbox_payload ON public.domain_events;
DROP FUNCTION IF EXISTS public.enforce_referral_bridge_outbox_payload_minimization();
DROP FUNCTION IF EXISTS public.minimize_referral_bridge_outbox_payload(jsonb);
