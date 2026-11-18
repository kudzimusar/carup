#!/usr/bin/env bash
# Destructive to the named test database: only a disposable local carup_idv_test_* database is accepted.
set -euo pipefail
: "${CARUP_IDV_TEST_DATABASE_URL:?Set to a disposable LOCAL PostgreSQL URL}"
[[ "${CARUP_IDV_TEST_DISPOSABLE:-}" == 'yes' ]] || { echo 'Set CARUP_IDV_TEST_DISPOSABLE=yes.' >&2; exit 2; }
python3 - <<'PY'
import os, sys, urllib.parse
u = urllib.parse.urlsplit(os.environ['CARUP_IDV_TEST_DATABASE_URL'])
if u.scheme not in ('postgres', 'postgresql') or u.hostname not in ('localhost', '127.0.0.1', '::1') or not u.path.lstrip('/').startswith('carup_idv_test_') or u.query or u.fragment:
    sys.exit('Refusing nonlocal or non-disposable database URL.')
PY
PSQL=(psql -X -v ON_ERROR_STOP=1 "$CARUP_IDV_TEST_DATABASE_URL")
[[ "$("${PSQL[@]}" -Atqc "SELECT CASE WHEN to_regclass('public.verification_sessions') IS NULL AND to_regclass('public.trust_audit_events') IS NULL THEN 'empty' ELSE 'occupied' END")" == empty ]] || { echo 'Refusing nonempty test database.' >&2; exit 2; }
[[ "$("${PSQL[@]}" -Atqc "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")" == 3 ]] || { echo 'Disposable cluster must have anon, authenticated and service_role roles provisioned.' >&2; exit 2; }
script_dir="$(cd "$(dirname "$0")/../../.." && pwd)"
# Only the Supabase storage bucket catalogue is stubbed; the CarUp tables,
# constraints, grants and policies come from the repository migration files.
"${PSQL[@]}" -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean);
SQL
# Run foundational DDL without its example seed data.
awk '/^-- SEED DATA$/{exit} {print}' "$script_dir/database/migrations/supabase_schema.sql" | "${PSQL[@]}" -q
awk '/^-- \+migrate Down$/{exit} {print}' "$script_dir/database/migrations/011_phase6_schema.sql" | "${PSQL[@]}" -q
awk '/^-- \+migrate Down$/{exit} {print}' "$script_dir/database/migrations/20260621170000_outbox_dead_letter.sql" | "${PSQL[@]}" -q
for migration in \
  20260613000000_phase7b_supabase_auth_and_identity.sql \
  20260605042424_verification_sessions_phase7b.sql \
  20260613020000_verification_admin_review.sql \
  20260618030000_verification_ocr_provenance.sql \
  20260618040000_verification_case_management.sql \
  20260618050000_verification_evidence_trust_columns.sql \
  20260603233640_governance_foundation_trust_audit_events.sql \
  20261117210000_identity_applicant_ocr_confirmation.sql \
  20261117220000_identity_atomic_submission_claim.sql \
  20261117230000_identity_decision_outbox_atomic.sql \
  20261118010000_identity_reviewer_independence.sql; do
  "${PSQL[@]}" -q -f "$script_dir/database/migrations/$migration"
done
# Repeat the four candidate migrations to verify their idempotent installation.
"${PSQL[@]}" -q -f "$script_dir/database/migrations/20261117210000_identity_applicant_ocr_confirmation.sql"
"${PSQL[@]}" -q -f "$script_dir/database/migrations/20261117220000_identity_atomic_submission_claim.sql"
"${PSQL[@]}" -q -f "$script_dir/database/migrations/20261117230000_identity_decision_outbox_atomic.sql"
"${PSQL[@]}" -q -f "$script_dir/database/migrations/20261118010000_identity_reviewer_independence.sql"
"${PSQL[@]}" -q <<'SQL'
INSERT INTO users(id,name,email,role,join_date) VALUES ('test-owner','Synthetic User','synthetic@example.invalid','owner','2026-01-01');
INSERT INTO verification_sessions(id,user_id,document_type,status,version,front_storage_path,selfie_storage_path) VALUES ('11111111-1111-4111-8111-111111111111','test-owner','passport','uploaded',1,'fixture/front','fixture/selfie');
DO $$ BEGIN
  IF has_function_privilege('anon','public.confirm_verification_ocr_fields(uuid,text,integer,uuid,jsonb)','EXECUTE') OR
     has_function_privilege('authenticated','public.confirm_verification_ocr_fields(uuid,text,integer,uuid,jsonb)','EXECUTE') OR
     NOT has_function_privilege('service_role','public.confirm_verification_ocr_fields(uuid,text,integer,uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Incorrect RPC grants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.verification_applicant_confirmations'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Confirmation RLS not enabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role' AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION 'Disposable service_role needs the Supabase RLS bypass property';
  END IF;
  IF has_function_privilege('anon','public.claim_verification_ocr_submission(uuid,text,integer,text,text,text,text,text,text)','EXECUTE') OR
     has_function_privilege('authenticated','public.record_verification_decision_atomic(uuid,integer,jsonb,jsonb,text,text,text,text)','EXECUTE') OR
     NOT has_function_privilege('service_role','public.claim_verification_ocr_submission(uuid,text,integer,text,text,text,text,text,text)','EXECUTE') OR
     has_function_privilege('service_role','public.record_verification_decision_atomic(uuid,integer,jsonb,jsonb,text,text,text,text)','EXECUTE') OR
     has_function_privilege('anon','public.record_verification_decision_with_event_atomic(uuid,integer,jsonb,jsonb,text,text,text,text)','EXECUTE') OR
     NOT has_function_privilege('service_role','public.record_verification_decision_with_event_atomic(uuid,integer,jsonb,jsonb,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Incorrect atomic RPC grants';
  END IF;
END $$;
SQL
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
for i in 1 2; do
  "${PSQL[@]}" -Atqc "WITH c AS MATERIALIZED (SELECT claim_verification_ocr_submission('11111111-1111-4111-8111-111111111111','test-owner',1,'uploaded','owner',NULL,NULL,NULL,NULL) AS r) SELECT r->>'id' FROM c WHERE r IS NOT NULL" > "$tmpdir/claim-$i" &
done
wait
[[ "$(cat "$tmpdir"/claim-* | wc -l | tr -d ' ')" == 1 ]] || { echo 'Concurrent submission claim failed.' >&2; exit 1; }
"${PSQL[@]}" -q -c "UPDATE verification_sessions SET status='pending_manual_review', ocr_execution_status='provider_succeeded', ocr_started_at=now(), ocr_result='{\"first_name\":\"Test\"}'::jsonb WHERE id='11111111-1111-4111-8111-111111111111'"
for i in 1 2; do
  key="22222222-2222-4222-8222-22222222222$i"
  "${PSQL[@]}" -Atqc "SELECT confirm_verification_ocr_fields('11111111-1111-4111-8111-111111111111','test-owner',2,'$key','{\"first_name\":\"Test\",\"last_name\":\"Person\",\"national_id_number\":\"X\"}'::jsonb)->>'code'" > "$tmpdir/confirm-$i" &
done
wait
[[ "$(grep -hxc OK "$tmpdir"/confirm-* | awk '{s+=$1} END {print s+0}')" == 1 ]] || { echo 'Concurrent confirmation claim failed.' >&2; exit 1; }
[[ "$("${PSQL[@]}" -Atqc "SELECT count(*) FROM verification_applicant_confirmations")" == 1 ]] || exit 1
[[ "$("${PSQL[@]}" -Atqc "SELECT count(*) FROM trust_audit_events WHERE event_type='VERIFICATION_OCR_APPLICANT_CONFIRMED'")" == 1 ]] || exit 1
"${PSQL[@]}" -q <<'SQL'
DO $$ DECLARE row_id uuid; key_id uuid; payload jsonb; result jsonb; BEGIN
  SELECT idempotency_key, applicant_fields INTO key_id, payload FROM verification_applicant_confirmations LIMIT 1;
  result := confirm_verification_ocr_fields('11111111-1111-4111-8111-111111111111','test-owner',2,key_id,payload);
  IF result->>'code' <> 'OK' OR NOT (result->>'replayed')::boolean THEN RAISE EXCEPTION 'Lost response replay failed'; END IF;
  result := confirm_verification_ocr_fields('11111111-1111-4111-8111-111111111111','test-owner',2,key_id,payload || '{"first_name":"Changed"}'::jsonb);
  IF result->>'code' <> 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'Changed payload replay accepted'; END IF;
  result := confirm_verification_ocr_fields('11111111-1111-4111-8111-111111111111','other-user',2,key_id,payload);
  IF result->>'code' <> 'NOT_FOUND' THEN RAISE EXCEPTION 'Cross-user access allowed'; END IF;
  SELECT id INTO row_id FROM verification_applicant_confirmations LIMIT 1;
  IF (SELECT original_observations->>'first_name' FROM verification_applicant_confirmations WHERE id=row_id) <> 'Test' THEN RAISE EXCEPTION 'Original OCR evidence lost'; END IF;
END $$;
INSERT INTO verification_sessions(id,user_id,document_type,status,version,ocr_execution_status,ocr_started_at,ocr_result)
  VALUES ('33333333-3333-4333-8333-333333333333','test-owner','passport','pending_manual_review',4,'provider_succeeded',now(),'{"first_name":"Before"}');
INSERT INTO verification_sessions(id,user_id,document_type,status,version,front_storage_path,selfie_storage_path)
  VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','test-owner','passport','uploaded',1,'fixture/front','fixture/selfie');
CREATE FUNCTION test_reject_identity_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
CREATE TRIGGER test_audit_failure BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION test_reject_identity_audit();
DO $$ BEGIN
  BEGIN
    PERFORM confirm_verification_ocr_fields('33333333-3333-4333-8333-333333333333','test-owner',4,'44444444-4444-4444-8444-444444444444','{"first_name":"After"}');
    RAISE EXCEPTION 'expected audit failure did not occur';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'injected audit failure' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM verification_applicant_confirmations WHERE session_id='33333333-3333-4333-8333-333333333333') OR
     (SELECT version FROM verification_sessions WHERE id='33333333-3333-4333-8333-333333333333') <> 4 THEN
    RAISE EXCEPTION 'Audit failure was not atomic';
  END IF;
  BEGIN
    PERFORM claim_verification_ocr_submission('cccccccc-cccc-4ccc-8ccc-cccccccccccc','test-owner',1,'uploaded','owner',NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'expected audit failure did not occur';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'injected audit failure' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM verification_sessions WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') <> 'uploaded' OR
     (SELECT version FROM verification_sessions WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') <> 1 THEN
    RAISE EXCEPTION 'Submission claim audit failure was not atomic';
  END IF;
END $$;
DROP TRIGGER test_audit_failure ON trust_audit_events;
DROP FUNCTION test_reject_identity_audit();
SQL
# Race a reviewer decision against applicant confirmation at the same version.
"${PSQL[@]}" -Atqc "SELECT confirm_verification_ocr_fields('33333333-3333-4333-8333-333333333333','test-owner',4,'55555555-5555-4555-8555-555555555555','{\"first_name\":\"After\"}') ->> 'code'" > "$tmpdir/confirm-review-race" &
"${PSQL[@]}" -Atqc "UPDATE verification_sessions SET status='rejected', version=version+1 WHERE id='33333333-3333-4333-8333-333333333333' AND status='pending_manual_review' AND version=4 RETURNING id" > "$tmpdir/reviewer-race" &
wait
if grep -qx OK "$tmpdir/confirm-review-race" && test -s "$tmpdir/reviewer-race"; then
  echo 'Both competing operations succeeded.' >&2; exit 1
fi
[[ "$("${PSQL[@]}" -Atqc "SELECT version FROM verification_sessions WHERE id='33333333-3333-4333-8333-333333333333'")" == 5 ]] || exit 1
node "$script_dir/backend/tests/integration/identity-postgres-reviewer-race.mjs"
echo 'PASS: selected real-migration, grants, concurrency, replay, ownership and audit-rollback checks on disposable PostgreSQL.'
