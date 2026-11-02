#!/usr/bin/env bash
# CARUP-PAY-03B-LR01 — disposable PostgreSQL certification of the canonical payment, PAY-03A report-commerce and
# PAY-03B migration chain. Used verbatim by .github/workflows/pay03b-dealer-business-subscriptions-ci.yml and by
# local runs against a throwaway container.
#
#   baseline-first  base chain -> certified PAY-01C/PAY-02/PAY-03A smokes -> fingerprint the canonical money and
#                   entitlement rows -> apply PAY-03B migrations -> prove the fingerprint is unchanged (historical
#                   PAY-01C/PAY-03A transactions preserved) -> PAY-03B smokes.
#   pay03b-first    base chain -> PAY-03B migrations -> certified PAY-01C/PAY-02/PAY-03A smokes (they must still
#                   pass on the PAY-03B writers) -> PAY-03B smokes.
#
# Refuses anything but a local disposable database named pay01c_sandbox_ci: never staging, never production,
# never the PAY-01C/PAY-03A evidence stack on 127.0.0.1:54322.
set -euo pipefail

mode="${1:-}"
case "$mode" in baseline-first|pay03b-first) ;; *) echo "usage: $0 baseline-first|pay03b-first" >&2; exit 2 ;; esac

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

fail() { echo "PAY03B_CERT_REFUSED: $*" >&2; exit 1; }
[ "${PAY03B_DISPOSABLE_PG:-}" = '1' ] || fail 'set PAY03B_DISPOSABLE_PG=1 to confirm the target is a throwaway database.'
[ "${PGDATABASE:-}" = 'pay01c_sandbox_ci' ] || fail "PGDATABASE must be pay01c_sandbox_ci (got '${PGDATABASE:-}')."
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) fail "PGHOST must be 127.0.0.1 or localhost (got '${PGHOST:-}')." ;; esac
[ "${PGPORT:-5432}" != '54322' ] || fail 'port 54322 is the protected PAY-01C/PAY-03A evidence stack.'
prod_ref="$(printf '%s' vhmn ajoe icas aigi ophh)"
staging_ref="$(printf '%s' eoye nigw evnx wwhy haer)"
case "${PGHOST:-}${PGUSER:-}${DATABASE_URL:-}${SUPABASE_URL:-}" in *"$prod_ref"*|*"$staging_ref"*) fail 'production/staging reference in the environment.' ;; esac

psql_q() { psql -X -v ON_ERROR_STOP=1 -q "$@"; }
apply() { sed '/^-- +migrate Down/,$d' "$1" | psql_q >/dev/null; echo "applied $(basename "$1")"; }

test "$(psql -X -Atc 'select current_database()')" = 'pay01c_sandbox_ci' || fail 'database identity mismatch.'
if [ "$(psql -X -Atc "select to_regclass('public.payment_transactions') is not null")" = 't' ]; then
  fail 'database is not empty; start from a fresh disposable database.'
fi

echo '== roles and auth helpers'
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
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
SQL

base_chain() {
  echo '== base chain (Phase 6, PAY-01A, PAY-01C, PAY-02, canonical vehicle/report schema, PAY-03A)'
  apply database/migrations/011_phase6_schema.sql
  apply database/migrations/20261029181000_carup_pay01a_stripe_sandbox.sql
  apply database/migrations/20261030223000_carup_pay01c_demo_product.sql
  apply database/migrations/20261031143000_carup_pay02_commercial_foundation.sql
  psql_q -f database/migrations/supabase_schema.sql >/dev/null; echo 'applied supabase_schema.sql'
  apply database/migrations/002_multi_tenant_and_auth_schema.sql
  apply database/migrations/20260624140000_listing_publication_lifecycle.sql
  apply database/migrations/014_passport_evidence_architecture.sql
  apply database/migrations/015_vehicle_evidence_timeline.sql
  apply database/migrations/20260603233640_governance_foundation_trust_audit_events.sql
  apply database/migrations/20260621120000_vehicle_life_evidence_taxonomy_provenance.sql
  apply database/migrations/20260621130000_external_source_ingestion.sql
  apply database/migrations/20260621140000_ai_temporal_disclosure_intelligence.sql
  apply database/migrations/20260621150000_report_versions.sql
  apply database/migrations/20260624120000_vehicle_trust_security_hardening.sql
  psql_q -c "GRANT SELECT ON TABLE public.users, public.vehicle_ownership_history TO authenticated;"
  apply database/migrations/20261031160000_carup_pay03a_real_report_commerce.sql
  apply database/migrations/20261101100000_carup_pay03a_refund_suspension_and_lock_order.sql
}

pay03b_chain() {
  echo '== PAY-03B migrations'
  apply database/migrations/20261101120000_carup_pay03b_f5_payment_reconciliation_hold.sql
  apply database/migrations/20261101130000_carup_pay03b_business_subscriptions.sql
}

run_smoke() {
  local file="$1" log
  log="$(mktemp)"
  if ! psql -X -v ON_ERROR_STOP=1 -q -f "backend/tests/sql/$file" >"$log" 2>&1; then
    cat "$log" >&2
    rm -f "$log"
    fail "smoke $file failed."
  fi
  grep -E 'NOTICE' "$log" || true
  rm -f "$log"
}

legacy_smokes() {
  echo '== certified PAY-01C / PAY-02 / PAY-03A smokes'
  run_smoke pay01c-demo-postgres-smoke.sql
  run_smoke pay02-foundation-postgres-smoke.sql
  run_smoke pay03a-real-report-postgres-smoke.sql
}

pay03b_smokes() {
  echo '== PAY-03B smokes'
  run_smoke pay03b-f5-reconciliation-postgres-smoke.sql
  run_smoke pay03b-subscriptions-postgres-smoke.sql
  run_smoke pay03b-remediation-postgres-smoke.sql
}

# Fingerprint the ORIGINAL columns of the canonical money/entitlement rows (later migrations may add columns).
fingerprint() {
  psql -X -At <<'SQL'
SELECT md5(concat_ws('#',
  (SELECT string_agg(concat_ws('|', reference, gateway, amount::text, currency, status, pay01a_actor_id,
     pay01a_request_key, pay01a_account_id, pay01a_checkout_id, pay01a_intent_id, pay01a_refund_id,
     pay02_quote_id::text, pay02_product_code, pay02_settlement_status, created_at::text, updated_at::text), ',' ORDER BY reference)
   FROM public.payment_transactions),
  (SELECT string_agg(concat_ws('|', event_id, reference, event_type, resulting_state, observed_at::text), ',' ORDER BY event_id)
   FROM public.pay01a_stripe_event_receipts),
  (SELECT string_agg(concat_ws('|', id::text, buyer_id, payment_reference, granted_at::text, revoked_at::text), ',' ORDER BY id)
   FROM public.pay01c_demo_orders),
  (SELECT string_agg(concat_ws('|', id::text, status, payment_reference, total_minor::text, updated_at::text), ',' ORDER BY id)
   FROM public.pay02_commercial_quotes),
  (SELECT string_agg(concat_ws('|', id::text, entitlement_status, report_version_id::text, report_content_hash,
     granted_at::text, revoked_at::text, updated_at::text), ',' ORDER BY id) FROM public.pay02_report_orders),
  (SELECT string_agg(concat_ws('|', id::text, revoked::text, correction_notice), ',' ORDER BY id) FROM public.report_versions)
));
SQL
}

base_chain
if [ "$mode" = 'baseline-first' ]; then
  legacy_smokes
  before="$(fingerprint)"
  pay03b_chain
  after="$(fingerprint)"
  [ "$before" = "$after" ] || fail "PAY-03B migrations rewrote historical canonical rows ($before != $after)."
  echo "historical canonical rows preserved across PAY-03B migrations: fingerprint $after"
  pay03b_smokes
else
  pay03b_chain
  legacy_smokes
  pay03b_smokes
fi
echo "PAY03B_POSTGRES_CERTIFICATION_PASS ($mode)"
