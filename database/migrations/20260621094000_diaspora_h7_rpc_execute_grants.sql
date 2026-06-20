-- +migrate Up
-- Restrict backend-only Diaspora atomic mutation RPCs to service_role.
-- Supabase may apply direct EXECUTE grants to API roles on new functions,
-- so revoking PUBLIC alone is not sufficient.

REVOKE ALL ON FUNCTION public.diaspora_append_stock_movement_atomic(uuid, text, uuid, boolean, text, numeric, text, uuid, text, uuid, uuid, numeric, numeric, text, text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_append_stock_movement_atomic(uuid, text, uuid, boolean, text, numeric, text, uuid, text, uuid, uuid, numeric, numeric, text, text, jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.diaspora_append_stock_movement_atomic(uuid, text, uuid, boolean, text, numeric, text, uuid, text, uuid, uuid, numeric, numeric, text, text, jsonb, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_append_stock_movement_atomic(uuid, text, uuid, boolean, text, numeric, text, uuid, text, uuid, uuid, numeric, numeric, text, text, jsonb, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.diaspora_accept_quote_atomic(uuid, uuid, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_accept_quote_atomic(uuid, uuid, text, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.diaspora_accept_quote_atomic(uuid, uuid, text, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_accept_quote_atomic(uuid, uuid, text, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.diaspora_approve_cargo_reservation_atomic(uuid, text, boolean, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_approve_cargo_reservation_atomic(uuid, text, boolean, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.diaspora_approve_cargo_reservation_atomic(uuid, text, boolean, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_approve_cargo_reservation_atomic(uuid, text, boolean, text, uuid) TO service_role;

-- +migrate Down
-- No automatic rollback: restoring API-role execution would weaken security.
