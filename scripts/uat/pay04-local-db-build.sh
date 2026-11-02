#!/usr/bin/env bash
# CARUP-PAY-04-LR01 — build the disposable LOCAL UAT database on the DEDICATED carup-pay04-supabase stack
# (PostgreSQL 127.0.0.1:56322; see scripts/uat/pay04-local-stack.sh). Never staging, never production, never the
# PAY-01C/PAY-03A evidence stack on 54322 and never the PAY-03B stack on 55422.
#
# Recipe = the PAY-03B local recipe verbatim (its ledger, drift detection and alignments; it is proven to run the whole
# CarUp app), then the Garage chain exactly as scripts/ci/pay04-postgres-certification.sh applies it (the domain_events
# dedupe block of 20260811132100 verbatim), then the three PAY-04 migrations, and ONE explicit local-only alignment
# that enables the PAY-04 garage-provider simulator in this disposable database (public.pay04_runtime_guard).
# The PAY-03B simulator is NOT enabled here.
set -euo pipefail
umask 077

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$REPO_ROOT/database/migrations"
PGURL="${PAY04_UAT_PGURL:-postgresql://postgres:postgres@127.0.0.1:56322/postgres}"
WORK="$(mktemp -d -t pay04-db-build.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "PAY-04 local DB build: $*" >&2; exit 1; }

case "$PGURL" in
  postgresql://*@127.0.0.1:56322/postgres|postgresql://*@localhost:56322/postgres) ;;
  *) fail "refusing: only the dedicated PAY-04 stack (127.0.0.1:56322/postgres) may be built." ;;
esac
# Project refs assembled from fragments (repository convention: no literal production ref in executable paths).
PROD_REF="$(printf '%s' vhmn ajoe icas aigi ophh)"
STAGING_REF="$(printf '%s' eoye nigw evnx wwhy haer)"
case "$PGURL" in *"$PROD_REF"*|*"$STAGING_REF"*) fail 'refusing: production/staging reference.' ;; esac

q() { psql "$PGURL" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
[ "$(q "select count(*) from pg_roles where rolname in ('supabase_admin','service_role','authenticated','anon')")" = "4" ] \
  || fail 'target is not a Supabase local stack.'

q "create schema if not exists carup_uat;
   create table if not exists carup_uat.migration_ledger (
     version text primary key,
     kind text not null,
     file_sha256 text not null,
     up_sha256 text not null,
     applied_at timestamptz not null default clock_timestamp(),
     applied_by text not null default current_user,
     outcome text not null default 'applied' check (outcome in ('applied','skipped_optional_failure'))
   );
   revoke all on schema carup_uat from public, anon, authenticated;" >/dev/null

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

# apply <version> <kind> <required|optional> <file-with-sql-to-run> <source-file-for-file-hash>
apply() {
  local version="$1" kind="$2" mode="$3" upfile="$4" srcfile="$5"
  local file_sha up_sha recorded
  file_sha="$(sha "$srcfile")"; up_sha="$(sha "$upfile")"
  recorded="$(q "select file_sha256||'|'||outcome from carup_uat.migration_ledger where version = '$version'")"
  if [ -n "$recorded" ]; then
    [ "${recorded%%|*}" = "$file_sha" ] || fail "DRIFT: $version is recorded with a different file hash."
    echo "  = $version (${recorded##*|})"; return 0
  fi
  local single=(-1)
  if grep -qiE '^[[:space:]]*(BEGIN|COMMIT)[[:space:]]*;' "$upfile"; then single=(); fi
  if psql "$PGURL" -X -q -v ON_ERROR_STOP=1 ${single[@]+"${single[@]}"} -f "$upfile" >"$WORK/out.log" 2>&1; then
    q "insert into carup_uat.migration_ledger(version, kind, file_sha256, up_sha256) values ('$version','$kind','$file_sha','$up_sha')" >/dev/null
    echo "  + $version"
  elif [ "$mode" = optional ] && [ ${#single[@]} -eq 1 ]; then
    q "insert into carup_uat.migration_ledger(version, kind, file_sha256, up_sha256, outcome) values ('$version','$kind','$file_sha','$up_sha','skipped_optional_failure')" >/dev/null
    echo "  ~ $version (optional; rolled back: $(grep -m1 -E 'ERROR' "$WORK/out.log" | cut -c1-160))"
  else
    cat "$WORK/out.log" >&2
    fail "$version failed (required, or optional without single-transaction rollback)."
  fi
}

migration() {  # migration <file> [optional]
  local f="$MIG/$1" up="$WORK/$1.up.sql"
  [ -f "$f" ] || fail "missing migration $1"
  if [ "$1" = supabase_schema.sql ]; then cp "$f" "$up"; else sed '/^-- +migrate Down/,$d' "$f" > "$up"; fi
  apply "$1" migration "${2:-required}" "$up" "$f"
}

alignment() {  # alignment <version> <sql>
  local f="$WORK/$1.sql"; printf '%s\n' "$2" > "$f"
  apply "$1" local-alignment required "$f" "$f"
}

echo "Building PAY-04 local UAT database at $(q "select current_database()||' on '||version()" | cut -c1-60)…"

# Payment foundation a fresh stack lacks (the PAY-03A stack had these applied by hand before its ledger).
migration 011_phase6_schema.sql
migration 20261029181000_carup_pay01a_stripe_sandbox.sql
migration 20261030223000_carup_pay01c_demo_product.sql


migration 20261031143000_carup_pay02_commercial_foundation.sql
migration supabase_schema.sql
migration 002_multi_tenant_and_auth_schema.sql
migration 010_phase5_schema.sql
migration 012_storage_and_media_schema.sql
migration 013_zimbabwe_plate_and_owner_privacy.sql
migration 014_passport_evidence_architecture.sql
migration 015_vehicle_evidence_timeline.sql
migration 20260603132036_marketplace_listing_summary_infra.sql
migration 20260603233640_governance_foundation_trust_audit_events.sql
migration 20260604002000_trust_fact_requests_phase2a.sql
migration 20260613010000_users_password_hash.sql
# The PAY-01A sparse setup created user_sessions.id as uuid with no default; canonically it is TEXT.
# 20260617120000 sets a TEXT default only when NO default exists, which a uuid column rejects. Give the
# local uuid column a uuid default first (no type or data change) so that defensive branch is skipped.
alignment local-alignment:004-user-sessions-uuid-id-default \
"DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions'
             AND column_name='id' AND data_type='uuid' AND column_default IS NULL) THEN
    ALTER TABLE public.user_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END \$\$;"
migration 20260617120000_user_sessions_auth_contract_align.sql
migration 20260621120000_vehicle_life_evidence_taxonomy_provenance.sql
migration 20260621130000_external_source_ingestion.sql
migration 20260621140000_ai_temporal_disclosure_intelligence.sql
migration 20260621150000_report_versions.sql
migration 20260621160000_governance_disputes_corrections.sql
migration 20260624120000_vehicle_trust_security_hardening.sql
migration 20260624130000_vehicle_document_extractions.sql
migration 20260624140000_listing_publication_lifecycle.sql
migration 20260624150000_trust_change_log_immutability.sql optional
migration 20260626120000_source_verification_network.sql optional
migration 20260626140000_fraud_engine.sql
migration 20260626160000_eligibility_framework.sql optional
migration 20260626180000_escrow_trust_sessions.sql optional
migration 20260817140000_issue164_trust_cache_provenance.sql
# FINDING F-MIG-1 (Issue #164 surface, reported, not modified — the file is production-pinned): the
# pre-image of 20260818110000 runs `count(<col>)` for its 12 new columns inside an EXECUTEd query, and
# Postgres resolves column names at parse time even in a CASE branch that would not run, so the file fails
# on any database where those columns do not yet exist (a fresh install). Pre-create exactly the columns
# the migration declares (same names/types, nullable, no data); its own ADD COLUMN IF NOT EXISTS then
# no-ops and it applies every constraint and default change as written.
alignment local-alignment:005-issue164-p4-preimage-columns \
"ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS listing_city text,
  ADD COLUMN IF NOT EXISTS listing_province text,
  ADD COLUMN IF NOT EXISTS listing_country text,
  ADD COLUMN IF NOT EXISTS listing_location_source text,
  ADD COLUMN IF NOT EXISTS listing_location_visibility text,
  ADD COLUMN IF NOT EXISTS listing_location_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_country_source text,
  ADD COLUMN IF NOT EXISTS registration_authority_source text,
  ADD COLUMN IF NOT EXISTS registration_status_source text,
  ADD COLUMN IF NOT EXISTS plate_status_source text,
  ADD COLUMN IF NOT EXISTS current_seller_type_source text,
  ADD COLUMN IF NOT EXISTS currency_source text;"
migration 20260818110000_issue164_listing_location_provenance.sql
migration 20260828203000_passport_ownership_transfer_authority.sql optional
migration 20260902150000_vehicle_life_generic_compat_types.sql
migration 20260902160000_vehicle_seller_authority.sql

# 20260817120000_sa1 also seeds communication templates and cannot run alone; only this column is read.
alignment local-alignment:003-users-email-verified-at \
"ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;"

# Same GRANT the PAY-02/PAY-03A CI recipe applies immediately before the PAY-03A migration.
alignment ci-recipe:grant-authenticated-users-ownership \
"GRANT SELECT ON TABLE public.users, public.vehicle_ownership_history TO authenticated;"

migration 20261031160000_carup_pay03a_real_report_commerce.sql
migration 20261101100000_carup_pay03a_refund_suspension_and_lock_order.sql

# vehicle_media_references exists only in the CAP-R2 migration, whose other tables need the Trade OS
# diaspora schema. The governed-media route reports `not_loaded` without it, so apply ONLY its statements
# for this table (recorded-fact guard functions 42-78, table/indexes/check/triggers 447-537, RLS 557-559),
# extracted from the committed file's bytes and recorded against that file's SHA-256.
CAP_R2="$MIG/20260926090000_trade_os_cap_r2_customer_journey_authorities.sql"
sed -n '42,78p;447,537p;557,559p' "$CAP_R2" > "$WORK/cap-r2-media-subset.sql"
grep -q 'CREATE TABLE IF NOT EXISTS public.vehicle_media_references' "$WORK/cap-r2-media-subset.sql" \
  || fail 'CAP-R2 media subset line ranges no longer match the migration.'
apply local-alignment:006-cap-r2-vehicle-media-references-subset local-alignment required "$WORK/cap-r2-media-subset.sql" "$CAP_R2"

# PAY-03B: F5 reconciliation hold and the canonical business subscription authority.
migration 20261101120000_carup_pay03b_f5_payment_reconciliation_hold.sql
migration 20261101130000_carup_pay03b_business_subscriptions.sql

# ───── Garage chain (as scripts/ci/pay04-postgres-certification.sh garage_chain; already-applied entries are skipped) ─────
migration 20260623143000_omnichannel_communication_engine.sql
migration 20260811131500_communications_2_conversation_core.sql
# Verbatim block of 20260811132100 (the domain_events dedupe column/index); the rest of that migration needs
# marketplace_inquiries, which no migration in this repository creates.
awk 'index($0, "ALTER TABLE public.domain_events") { on = 1 } on { print } on && index($0, "WHERE dedupe_key IS NOT NULL;") { exit }' \
  "$MIG/20260811132100_communications_2_reliability_closure.sql" > "$WORK/comms2-dedupe-block.sql"
grep -q 'ADD COLUMN IF NOT EXISTS dedupe_key' "$WORK/comms2-dedupe-block.sql" || fail '20260811132100 dedupe block not found.'
apply local-alignment:pay04-001-comms2-domain-events-dedupe-block local-alignment required "$WORK/comms2-dedupe-block.sql" "$MIG/20260811132100_communications_2_reliability_closure.sql"
migration 20260817120000_sa1_auth_action_tokens.sql
migration 20260710130000_partsentry_review_requests.sql
migration 20261004160000_oc5a_tenant_users_role_catalogue.sql
migration 20260613000000_phase7b_supabase_auth_and_identity.sql
migration 20260605042424_verification_sessions_phase7b.sql
migration 20261004170000_o2_x3_identity_lifecycle_events.sql
migration 20261004170100_o2_x3_user_sessions_authentication_assurance.sql
migration 20260918090000_ocr_c3_garage_applications.sql
migration 20260918100000_ocr_c3_garage_application_evidence.sql
migration 20260918110000_ocr_c3_garage_onboarding_rls.sql
migration 20261004190000_gmo3_garage_application_decision.sql
migration 20261004190100_gmo4_garage_business_activation.sql
migration 20261004190200_gmo6_garage_invitations.sql
migration 20261004190300_gmo7_garage_membership_guard.sql
migration 20261004180000_service_network_s1_garage_identity.sql
migration 20261004180100_service_network_s2_service_cases.sql
migration 009_phase4_schema.sql
migration 20261004160100_oc5a_work_order_owner_authorization.sql
migration 20261004180300_service_network_s4_work_order_assignment.sql
migration 20261004180400_service_network_s5_service_records.sql
migration 20261004160200_oc5a_partsentry_attested_record_and_ledger_intents.sql
migration 20261022130000_garage_ops01_multisite_workforce.sql
migration 20261023111516_garage_ops02_customer_vehicle_relationship.sql
migration 20261023140000_garage_ops03_appointments_scheduling_capacity.sql
migration 20261024100000_garage_ops04_estimates_and_authorization.sql
migration 20261024110000_garage_ops05_workshop_execution_gates.sql
migration 20261024120000_garage_ops06_parts_stock.sql
migration 20261024130000_garage_ops07_invoice_payment_receipt.sql
migration 20261024140000_garage_communications_events_and_template.sql

# ───── PAY-04 ─────
migration 20261102100000_carup_pay04_garage_invoice_integrity.sql
migration 20261102110000_carup_pay04_garage_provider_payments.sql
migration 20261102120000_carup_pay04_garage_payment_notifications.sql

# The ONLY place the PAY-04 garage-provider simulator is ever enabled: this disposable UAT database.
alignment local-alignment:pay04-002-enable-garage-provider-simulator \
"UPDATE public.pay04_runtime_guard SET garage_simulator_enabled = true,
   note = 'Disposable PAY-04 local UAT database (carup-pay04-supabase, 127.0.0.1:56322) only.', updated_at = clock_timestamp()
 WHERE singleton;"

q "NOTIFY pgrst, 'reload schema';" >/dev/null
echo "Done. Ledger: $(q "select count(*) from carup_uat.migration_ledger") entries ($(q "select count(*) from carup_uat.migration_ledger where outcome <> 'applied'") optional skipped)."
