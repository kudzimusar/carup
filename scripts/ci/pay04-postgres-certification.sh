#!/usr/bin/env bash
# CARUP-PAY-04-LR01 — disposable PostgreSQL certification of the INTEGRATED Payments + Garage schema and the PAY-04
# migrations. Used verbatim by .github/workflows/pay04-garage-payments-ci.yml and by local runs against a throwaway
# container. The two lineages meet for the first time in PAY-04, so both orders in which a real database can receive
# them are certified:
#
#   payments-first  common base -> Payments chain (PAY-01A..PAY-03B) -> Garage chain -> OPS07 history
#   garage-first    common base -> Garage chain -> OPS07 history -> Payments chain
#
# garage-first is the order a Garage-lineage database (for example canonical staging, which already runs Garage 1.0)
# would receive the Payments migrations. Each mode runs two phases, each on an EMPTY database:
#
#   Phase 1 (upgrade)    lineages + the certified PAY smokes + pre-PAY-04 OPS07 history (made only through OPS07
#                        functions) -> fingerprint -> PAY-04 migrations -> the fingerprint must be unchanged: no OPS07
#                        row, derived invoice balance or canonical payment is rewritten.
#   Phase 2 (behaviour)  lineages + OPS07 history -> PAY-04 migrations -> the certified PAY smokes (they must still pass
#                        on the PAY-04-extended F5 functions) -> the PAY-04 smokes.
#
# The script never connects to a shared database: it refuses anything but a local disposable database named
# pay01c_sandbox_ci (the name the certified PAY smokes require), never staging, never production, never the
# PAY-01C/PAY-03A evidence stack on 127.0.0.1:54322. It drops and re-creates that disposable database between phases.
#
# Supabase platform objects (auth.uid/role/jwt, storage.buckets, two default SELECT grants) are provided as
# clearly-labelled stand-ins, exactly as a hosted Supabase project provides them. No CarUp migration is replaced or
# edited by a stand-in; one (20260811132100) contributes only its labelled, verbatim domain_events dedupe block.
set -euo pipefail

mode="${1:-}"
case "$mode" in payments-first|garage-first) ;; *) echo "usage: $0 payments-first|garage-first" >&2; exit 2 ;; esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

fail() { echo "PAY04_CERT_REFUSED: $*" >&2; exit 1; }
[ "${PAY04_DISPOSABLE_PG:-}" = '1' ] || fail 'set PAY04_DISPOSABLE_PG=1 to confirm the target is a throwaway database.'
[ "${PGDATABASE:-}" = 'pay01c_sandbox_ci' ] || fail "PGDATABASE must be pay01c_sandbox_ci (got '${PGDATABASE:-}')."
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) fail "PGHOST must be 127.0.0.1 or localhost (got '${PGHOST:-}')." ;; esac
[ "${PGPORT:-5432}" != '54322' ] || fail 'port 54322 is the protected PAY-01C/PAY-03A evidence stack.'
prod_ref="$(printf '%s' vhmn ajoe icas aigi ophh)"
staging_ref="$(printf '%s' eoye nigw evnx wwhy haer)"
case "${PGHOST:-}${PGUSER:-}${DATABASE_URL:-}${SUPABASE_URL:-}" in *"$prod_ref"*|*"$staging_ref"*) fail 'production/staging reference in the environment.' ;; esac

psql_q() { psql -X -v ON_ERROR_STOP=1 -q "$@"; }
M=database/migrations
apply() { sed '/^-- +migrate Down/,$d' "$M/$1" | psql_q >/dev/null 2>"${TMPDIR:-/tmp}/pay04-apply.err" \
  || { cat "${TMPDIR:-/tmp}/pay04-apply.err" >&2; fail "migration $1 did not apply."; }; echo "applied $1"; }

# A verbatim slice of a migration, from the first line containing $2 to the first line after it containing $3.
apply_block() {
  awk -v from="$2" -v to="$3" 'index($0, from) { on = 1 } on { print } on && index($0, to) { exit }' "$M/$1" > "${TMPDIR:-/tmp}/pay04-block.sql"
  [ -s "${TMPDIR:-/tmp}/pay04-block.sql" ] || fail "block '$2' not found in $1."
  psql_q -f "${TMPDIR:-/tmp}/pay04-block.sql" >/dev/null || fail "block of $1 did not apply."
  echo "applied block of $1"
}

# Each phase starts from an EMPTY pay01c_sandbox_ci: the certified PAY smokes create fixed identities, so they run
# exactly once per database. Roles are cluster-wide; schemas and stand-ins are per database.
reset_db() {
  psql -X -q -v ON_ERROR_STOP=1 -d postgres -c 'DROP DATABASE IF EXISTS pay01c_sandbox_ci WITH (FORCE);' \
    -c 'CREATE DATABASE pay01c_sandbox_ci;' >/dev/null
  test "$(psql -X -Atc 'select current_database()')" = 'pay01c_sandbox_ci' || fail 'database identity mismatch.'
  test "$(psql -X -Atc "select to_regclass('public.payment_transactions') is null")" = 't' || fail 'database is not empty.'
  echo '== Supabase platform stand-ins (roles, auth.uid/role/jwt, storage.buckets)'
  for role in anon authenticated service_role; do
    psql_q -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$role') THEN CREATE ROLE $role NOLOGIN; END IF; END \$\$;"
  done
  psql_q <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
SQL
}

test "$(psql -X -Atc 'select current_database()')" = 'pay01c_sandbox_ci' || fail 'database identity mismatch.'

common_base() {
  echo '== common base (Phase 6 money table, platform schema, canonical vehicle/report schema)'
  apply 011_phase6_schema.sql
  psql_q -f "$M/supabase_schema.sql" >/dev/null; echo 'applied supabase_schema.sql'
  apply 002_multi_tenant_and_auth_schema.sql
  apply 010_phase5_schema.sql
  apply 20260624140000_listing_publication_lifecycle.sql
  apply 014_passport_evidence_architecture.sql
  apply 015_vehicle_evidence_timeline.sql
  apply 20260603233640_governance_foundation_trust_audit_events.sql
  apply 20260621120000_vehicle_life_evidence_taxonomy_provenance.sql
  apply 20260621130000_external_source_ingestion.sql
  apply 20260621140000_ai_temporal_disclosure_intelligence.sql
  apply 20260621150000_report_versions.sql
  apply 20260624120000_vehicle_trust_security_hardening.sql
  # Stand-in for Supabase's default privileges (as in pay03b-postgres-certification.sh): the report_versions RLS
  # policies read these two tables as the querying role.
  psql_q -c "GRANT SELECT ON TABLE public.users, public.vehicle_ownership_history TO authenticated;"
}

payments_chain() {
  echo '== Payments chain (PAY-01A, PAY-01C, PAY-02, PAY-03A, PAY-03B) — accepted parent c2d548ed'
  apply 20261029181000_carup_pay01a_stripe_sandbox.sql
  apply 20261030223000_carup_pay01c_demo_product.sql
  apply 20261031143000_carup_pay02_commercial_foundation.sql
  apply 20261031160000_carup_pay03a_real_report_commerce.sql
  apply 20261101100000_carup_pay03a_refund_suspension_and_lock_order.sql
  apply 20261101120000_carup_pay03b_f5_payment_reconciliation_hold.sql
  apply 20261101130000_carup_pay03b_business_subscriptions.sql
}

garage_chain() {
  echo '== Garage chain (identity, onboarding, service network, OPS01-OPS07, communications) — parent 69e12e21'
  apply 20260623143000_omnichannel_communication_engine.sql
  apply 20260811131500_communications_2_conversation_core.sql
  # Verbatim block of 20260811132100: the domain_events dedupe column and index that the Garage communications
  # migration (and PAY-04's notification trigger) key on. The rest of that migration attaches an outbox trigger to
  # marketplace_inquiries, a table no migration in this repository creates, so it cannot run on an empty database.
  apply_block 20260811132100_communications_2_reliability_closure.sql 'ALTER TABLE public.domain_events' 'WHERE dedupe_key IS NOT NULL;'
  apply 20260817120000_sa1_auth_action_tokens.sql
  apply 20260617120000_user_sessions_auth_contract_align.sql
  apply 20260710130000_partsentry_review_requests.sql
  apply 20261004160000_oc5a_tenant_users_role_catalogue.sql
  apply 20260613000000_phase7b_supabase_auth_and_identity.sql
  apply 20260605042424_verification_sessions_phase7b.sql
  apply 20261004170000_o2_x3_identity_lifecycle_events.sql
  apply 20261004170100_o2_x3_user_sessions_authentication_assurance.sql
  apply 20260918090000_ocr_c3_garage_applications.sql
  apply 20260918100000_ocr_c3_garage_application_evidence.sql
  apply 20260918110000_ocr_c3_garage_onboarding_rls.sql
  apply 20261004190000_gmo3_garage_application_decision.sql
  apply 20261004190100_gmo4_garage_business_activation.sql
  apply 20261004190200_gmo6_garage_invitations.sql
  apply 20261004190300_gmo7_garage_membership_guard.sql
  apply 20261004180000_service_network_s1_garage_identity.sql
  apply 20261004180100_service_network_s2_service_cases.sql
  apply 009_phase4_schema.sql
  apply 20261004160100_oc5a_work_order_owner_authorization.sql
  apply 20261004180300_service_network_s4_work_order_assignment.sql
  apply 20261004180400_service_network_s5_service_records.sql
  apply 20261004160200_oc5a_partsentry_attested_record_and_ledger_intents.sql
  apply 20261022130000_garage_ops01_multisite_workforce.sql
  apply 20261023111516_garage_ops02_customer_vehicle_relationship.sql
  apply 20261023140000_garage_ops03_appointments_scheduling_capacity.sql
  apply 20261024100000_garage_ops04_estimates_and_authorization.sql
  apply 20261024110000_garage_ops05_workshop_execution_gates.sql
  apply 20261024120000_garage_ops06_parts_stock.sql
  apply 20261024130000_garage_ops07_invoice_payment_receipt.sql
  apply 20261024140000_garage_communications_events_and_template.sql
}

pay04_chain() {
  echo '== PAY-04 migrations'
  apply 20261102100000_carup_pay04_garage_invoice_integrity.sql
  apply 20261102110000_carup_pay04_garage_provider_payments.sql
  apply 20261102120000_carup_pay04_garage_payment_notifications.sql
}

run_sql() {
  local file="$1" log
  log="$(mktemp)"
  if ! psql -X -v ON_ERROR_STOP=1 -q -f "backend/tests/sql/$file" >"$log" 2>&1; then
    cat "$log" >&2
    rm -f "$log"
    fail "$file failed."
  fi
  grep -E 'NOTICE' "$log" || true
  rm -f "$log"
}

pay_smokes() {
  echo "== certified PAY-01C / PAY-02 / PAY-03A / PAY-03B smokes ($1)"
  for f in pay01c-demo-postgres-smoke.sql pay02-foundation-postgres-smoke.sql pay03a-real-report-postgres-smoke.sql \
           pay03b-f5-reconciliation-postgres-smoke.sql pay03b-subscriptions-postgres-smoke.sql pay03b-remediation-postgres-smoke.sql; do
    run_sql "$f"
  done
}

# Every OPS07 row (original columns) and every invoice's derived balance, plus the canonical money rows.
fingerprint() {
  psql -X -At <<'SQL'
SELECT md5(concat_ws('#',
  (SELECT string_agg(concat_ws('|', id::text, tenant_id::text, invoice_number, status, currency, total_amount::text, line_count::text,
     customer_note, internal_note, estimate_id::text, issued_at::text, voided_at::text, void_reason), ',' ORDER BY id)
   FROM public.garage_invoices),
  (SELECT string_agg(concat_ws('|', id::text, invoice_id::text, line_no::text, category, description, quantity::text, unit_price::text,
     line_total::text, source_kind, source_id::text), ',' ORDER BY id) FROM public.garage_invoice_lines),
  (SELECT string_agg(concat_ws('|', id::text, invoice_id::text, kind, amount::text, currency, method, reference, paid_at::text, source,
     reverses_payment_id::text, reason, recorded_at::text, idempotency_key), ',' ORDER BY id) FROM public.garage_payment_records),
  (SELECT string_agg(concat_ws('|', id::text, receipt_number, invoice_id::text, payment_id::text, amount::text, payment_source, status,
     issued_at::text, voided_at::text), ',' ORDER BY id) FROM public.garage_receipts),
  (SELECT string_agg(concat_ws('|', id::text, invoice_id::text, event_type, actor_user_id, detail::text, created_at::text), ',' ORDER BY id)
   FROM public.garage_invoice_events),
  (SELECT string_agg(concat_ws('|', tenant_id::text, doc_type, last_number::text), ',' ORDER BY tenant_id, doc_type)
   FROM public.garage_document_counters),
  (SELECT string_agg(concat_ws('|', i.id::text, b.total_amount::text, b.paid_amount::text, b.balance_amount::text, b.payment_status), ',' ORDER BY i.id)
   FROM public.garage_invoices i CROSS JOIN LATERAL public.garage_ops07_invoice_balance(i.id) b),
  (SELECT string_agg(concat_ws('|', reference, gateway, amount::text, currency, status, pay01a_actor_id, pay01a_account_id,
     pay01a_intent_id, pay01a_refund_id, pay02_product_code, pay02_settlement_status, created_at::text, updated_at::text), ',' ORDER BY reference)
   FROM public.payment_transactions)
));
SQL
}

# The two lineages in the order this mode names, ending with the pre-PAY-04 OPS07 history.
lineages() {
  common_base
  if [ "$mode" = 'payments-first' ]; then
    payments_chain
    [ "${1:-}" = 'with-pay-smokes' ] && pay_smokes 'on the Payments chain, before the Garage chain'
    garage_chain
    run_sql pay04-ops07-history-seed.sql
  else
    garage_chain
    run_sql pay04-ops07-history-seed.sql
    payments_chain
    [ "${1:-}" = 'with-pay-smokes' ] && pay_smokes 'on a Garage-lineage database'
  fi
  return 0
}

# PAY-05 (and later packages) source this file with PAY04_CERT_LIBRARY=1 to reuse every step above verbatim and run
# their own phases; run directly, it certifies PAY-04 exactly as before.
if [ "${PAY04_CERT_LIBRARY:-}" != '1' ]; then
  echo "#### Phase 1 ($mode): upgrade — PAY-04 preserves OPS07 history, derived balances and canonical payments"
  reset_db
  lineages with-pay-smokes
  before="$(fingerprint)"
  pay04_chain
  after="$(fingerprint)"
  [ "$before" = "$after" ] || fail "PAY-04 migrations rewrote OPS07 history, a derived balance or a canonical payment ($before != $after)."
  echo "OPS07 history, derived balances and canonical payments preserved across PAY-04: fingerprint $after"

  echo "#### Phase 2 ($mode): behaviour — certified PAY smokes on the PAY-04 writers, then the PAY-04 smokes"
  reset_db
  lineages
  pay04_chain
  pay_smokes 'after PAY-04 (the F5 extension must regress nothing)'
  echo '== PAY-04 smokes'
  run_sql pay04-garage-invoice-integrity-postgres-smoke.sql
  run_sql pay04-garage-provider-payments-postgres-smoke.sql
  echo "PAY04_POSTGRES_CERTIFICATION_PASS ($mode)"
fi
