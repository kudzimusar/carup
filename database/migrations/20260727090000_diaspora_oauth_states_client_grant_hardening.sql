-- +migrate Up
-- =============================================================================
-- Diaspora ledger #20 — diaspora_oauth_states client-role grant hardening (compensating).
-- Owner-authorized 2026-07-27: "APPROVE #20 DIASPORA OAUTH STATES GRANT HARDENING".
--
-- Root cause (same class as #19): the H6 migration (#10) only ENABLEd RLS on
-- public.diaspora_oauth_states — it granted nothing and revoked nothing — so every privilege the
-- table carries came from Supabase's ALTER DEFAULT PRIVILEGES, which grants new public-schema
-- tables directly to anon/authenticated/service_role. The table has ZERO policies (RLS
-- default-deny) and is a service-role-only one-time OAuth state nonce store, so nothing was
-- exposed; this closes the grant layer to match the intended contract: anon=NONE,
-- authenticated=NONE, service_role full.
--
-- ACL statements only: no data, columns, constraints, indexes, policies, functions, or flags are
-- touched. REVOKE ALL (not an enumerated list) also clears PG17 MAINTAIN, which
-- information_schema cannot report. Idempotent; runs in one transaction.
-- =============================================================================
REVOKE ALL ON TABLE public.diaspora_oauth_states FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_oauth_states FROM anon;
REVOKE ALL ON TABLE public.diaspora_oauth_states FROM authenticated;
GRANT ALL ON TABLE public.diaspora_oauth_states TO service_role;

-- +migrate Down
-- Tightening only. Reversing would re-open client grants on the nonce store; mirrors #17/#19.
-- Restore-from-backup under explicit authorization if ever required.
