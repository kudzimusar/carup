-- +migrate Up
-- =============================================================================
-- Diaspora ledger #19 — Phase 8/9/10 client-role grant hardening (compensating).
-- Owner-authorized 2026-07-26: "APPROVE #19 PHASE-8/9/10 HARDENING".
--
-- Root cause: #12/#13/#14/#15 ran `REVOKE ALL ... FROM PUBLIC` on their tables but never revoked the
-- `anon`/`authenticated` roles directly. Supabase grants new public-schema tables to those roles via
-- ALTER DEFAULT PRIVILEGES (direct role grants, not PUBLIC), so the PUBLIC-only revoke left anon with
-- full table privileges on all 19 Phase 8/9/10 tables. RLS gated every path (each table is
-- SELECT-policy-only for authenticated; anon matches no policy), so nothing was exposed — this closes
-- the grant layer to match the SEC-DB-1/SEC-DB-2 contract: anon=NONE, authenticated=SELECT-only
-- (RLS-scoped), service_role full.
--
-- ACL statements only: no data, columns, constraints, indexes, policies, functions, or flags are
-- touched. Every table is named explicitly (no discovery). Idempotent; runs in one transaction.
--
-- authenticated uses `REVOKE ALL` + explicit `GRANT SELECT` (not an enumerated revoke list): the
-- owner-listed INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER are all covered by ALL, and so is
-- PG17's MAINTAIN — which information_schema cannot report, so an enumerated revoke would leave
-- authenticated with invisible maintenance rights that every information_schema-based gate would
-- miss. Verifiers check MAINTAIN explicitly via has_table_privilege().
-- =============================================================================

-- ── Phase 8 (#12): subscription / entitlement / usage / billing ──
REVOKE ALL ON TABLE public.diaspora_subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_subscriptions FROM anon;
REVOKE ALL ON TABLE public.diaspora_subscriptions FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_subscriptions TO authenticated;
GRANT ALL ON TABLE public.diaspora_subscriptions TO service_role;

REVOKE ALL ON TABLE public.diaspora_subscription_plans FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_subscription_plans FROM anon;
REVOKE ALL ON TABLE public.diaspora_subscription_plans FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_subscription_plans TO authenticated;
GRANT ALL ON TABLE public.diaspora_subscription_plans TO service_role;

REVOKE ALL ON TABLE public.diaspora_user_entitlement_overrides FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_user_entitlement_overrides FROM anon;
REVOKE ALL ON TABLE public.diaspora_user_entitlement_overrides FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_user_entitlement_overrides TO authenticated;
GRANT ALL ON TABLE public.diaspora_user_entitlement_overrides TO service_role;

REVOKE ALL ON TABLE public.diaspora_usage_meters FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_usage_meters FROM anon;
REVOKE ALL ON TABLE public.diaspora_usage_meters FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_usage_meters TO authenticated;
GRANT ALL ON TABLE public.diaspora_usage_meters TO service_role;

REVOKE ALL ON TABLE public.diaspora_usage_reservations FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_usage_reservations FROM anon;
REVOKE ALL ON TABLE public.diaspora_usage_reservations FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_usage_reservations TO authenticated;
GRANT ALL ON TABLE public.diaspora_usage_reservations TO service_role;

REVOKE ALL ON TABLE public.diaspora_billing_provider_events FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_billing_provider_events FROM anon;
REVOKE ALL ON TABLE public.diaspora_billing_provider_events FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_billing_provider_events TO authenticated;
GRANT ALL ON TABLE public.diaspora_billing_provider_events TO service_role;

-- ── Phase 9 (#13/#14): SafeTrade escrow overlay + disputes ──
REVOKE ALL ON TABLE public.diaspora_safetrade_transactions FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_transactions FROM anon;
REVOKE ALL ON TABLE public.diaspora_safetrade_transactions FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_safetrade_transactions TO authenticated;
GRANT ALL ON TABLE public.diaspora_safetrade_transactions TO service_role;

REVOKE ALL ON TABLE public.diaspora_safetrade_milestones FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_milestones FROM anon;
REVOKE ALL ON TABLE public.diaspora_safetrade_milestones FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_safetrade_milestones TO authenticated;
GRANT ALL ON TABLE public.diaspora_safetrade_milestones TO service_role;

REVOKE ALL ON TABLE public.diaspora_safetrade_release_evaluations FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_release_evaluations FROM anon;
REVOKE ALL ON TABLE public.diaspora_safetrade_release_evaluations FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_safetrade_release_evaluations TO authenticated;
GRANT ALL ON TABLE public.diaspora_safetrade_release_evaluations TO service_role;

REVOKE ALL ON TABLE public.diaspora_safetrade_disputes FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_disputes FROM anon;
REVOKE ALL ON TABLE public.diaspora_safetrade_disputes FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_safetrade_disputes TO authenticated;
GRANT ALL ON TABLE public.diaspora_safetrade_disputes TO service_role;

REVOKE ALL ON TABLE public.diaspora_safetrade_dispute_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_dispute_evidence FROM anon;
REVOKE ALL ON TABLE public.diaspora_safetrade_dispute_evidence FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_safetrade_dispute_evidence TO authenticated;
GRANT ALL ON TABLE public.diaspora_safetrade_dispute_evidence TO service_role;

REVOKE ALL ON TABLE public.diaspora_safetrade_delivery_confirmations FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_delivery_confirmations FROM anon;
REVOKE ALL ON TABLE public.diaspora_safetrade_delivery_confirmations FROM authenticated;
GRANT SELECT ON TABLE public.diaspora_safetrade_delivery_confirmations TO authenticated;
GRANT ALL ON TABLE public.diaspora_safetrade_delivery_confirmations TO service_role;

-- ── Phase 10 (#15): trade graph projection ──
REVOKE ALL ON TABLE public.trade_graph_nodes FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_nodes FROM anon;
REVOKE ALL ON TABLE public.trade_graph_nodes FROM authenticated;
GRANT SELECT ON TABLE public.trade_graph_nodes TO authenticated;
GRANT ALL ON TABLE public.trade_graph_nodes TO service_role;

REVOKE ALL ON TABLE public.trade_graph_edges FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_edges FROM anon;
REVOKE ALL ON TABLE public.trade_graph_edges FROM authenticated;
GRANT SELECT ON TABLE public.trade_graph_edges TO authenticated;
GRANT ALL ON TABLE public.trade_graph_edges TO service_role;

REVOKE ALL ON TABLE public.trade_graph_materialized_summaries FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_materialized_summaries FROM anon;
REVOKE ALL ON TABLE public.trade_graph_materialized_summaries FROM authenticated;
GRANT SELECT ON TABLE public.trade_graph_materialized_summaries TO authenticated;
GRANT ALL ON TABLE public.trade_graph_materialized_summaries TO service_role;

REVOKE ALL ON TABLE public.trade_graph_projection_checkpoints FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_projection_checkpoints FROM anon;
REVOKE ALL ON TABLE public.trade_graph_projection_checkpoints FROM authenticated;
GRANT SELECT ON TABLE public.trade_graph_projection_checkpoints TO authenticated;
GRANT ALL ON TABLE public.trade_graph_projection_checkpoints TO service_role;

REVOKE ALL ON TABLE public.trade_graph_processed_events FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_processed_events FROM anon;
REVOKE ALL ON TABLE public.trade_graph_processed_events FROM authenticated;
GRANT SELECT ON TABLE public.trade_graph_processed_events TO authenticated;
GRANT ALL ON TABLE public.trade_graph_processed_events TO service_role;

REVOKE ALL ON TABLE public.trade_graph_dead_letters FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_dead_letters FROM anon;
REVOKE ALL ON TABLE public.trade_graph_dead_letters FROM authenticated;
GRANT SELECT ON TABLE public.trade_graph_dead_letters TO authenticated;
GRANT ALL ON TABLE public.trade_graph_dead_letters TO service_role;

REVOKE ALL ON TABLE public.trade_graph_rebuilds FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_rebuilds FROM anon;
REVOKE ALL ON TABLE public.trade_graph_rebuilds FROM authenticated;
GRANT SELECT ON TABLE public.trade_graph_rebuilds TO authenticated;
GRANT ALL ON TABLE public.trade_graph_rebuilds TO service_role;

-- +migrate Down
-- Tightening only. Reversing would re-open anon/authenticated client grants (a security regression);
-- mirrors #17/#18. Restore-from-backup under explicit authorization if ever required.
