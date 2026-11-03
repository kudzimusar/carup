#!/usr/bin/env bash
# CARUP-PAY-05-LR01 — build (or upgrade in place) the disposable LOCAL UAT database for PAY-05.
#
# PAY-05 reuses the DEDICATED carup-pay04-supabase stack (PostgreSQL 127.0.0.1:56322; scripts/uat/pay04-local-stack.sh),
# so the accepted PAY-04 physical matrix and browser spec replay unchanged against the PAY-05 runtime. Never staging,
# never production, never the PAY-01C/PAY-03A stack on 54322 and never the PAY-03B stack on 55422.
#
#   1. The PAY-04 recipe, verbatim: scripts/uat/pay04-local-db-build.sh (idempotent through its migration ledger; it
#      refuses a migration whose file changed since it was applied).
#   2. The PAY-05 migration, recorded in the same ledger.
#   3. ONE explicit local-only alignment: enable the local Paynow PROTOCOL simulator in this disposable database
#      (public.pay05_runtime_guard.paynow_simulator_enabled). Real Paynow stays impossible: paynow_real_enabled carries a
#      CHECK (NOT paynow_real_enabled) that only a reviewed activation migration may drop.
#
# Run against a database that already holds PAY-04 UAT data, it is the upgrade path with real rows: the PAY-05 CHECK
# replacements on the PAY-04 tables must accept every existing row.
set -euo pipefail
umask 077

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$REPO_ROOT/database/migrations"
PGURL="${PAY05_UAT_PGURL:-postgresql://postgres:postgres@127.0.0.1:56322/postgres}"
WORK="$(mktemp -d -t pay05-db-build.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "PAY-05 local DB build: $*" >&2; exit 1; }

case "$PGURL" in
  postgresql://*@127.0.0.1:56322/postgres|postgresql://*@localhost:56322/postgres) ;;
  *) fail "refusing: only the dedicated local UAT stack (127.0.0.1:56322/postgres) may be built." ;;
esac
# Project refs assembled from fragments (repository convention: no literal production ref in executable paths).
PROD_REF="$(printf '%s' vhmn ajoe icas aigi ophh)"
STAGING_REF="$(printf '%s' eoye nigw evnx wwhy haer)"
case "$PGURL" in *"$PROD_REF"*|*"$STAGING_REF"*) fail 'refusing: production/staging reference.' ;; esac

q() { psql "$PGURL" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }

# 1. The accepted PAY-04 recipe, unchanged.
PAY04_UAT_PGURL="$PGURL" bash "$REPO_ROOT/scripts/uat/pay04-local-db-build.sh"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

# apply <version> <kind> <file-with-sql-to-run> <source-file-for-file-hash>  (the PAY-04 ledger's required semantics)
apply() {
  local version="$1" kind="$2" upfile="$3" srcfile="$4"
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
  else
    cat "$WORK/out.log" >&2
    fail "$version failed."
  fi
}

# 2. PAY-05.
PAY05_MIGRATION=20261103100000_carup_pay05_zimbabwe_paynow_collections.sql
[ -f "$MIG/$PAY05_MIGRATION" ] || fail "missing migration $PAY05_MIGRATION"
sed '/^-- +migrate Down/,$d' "$MIG/$PAY05_MIGRATION" > "$WORK/$PAY05_MIGRATION.up.sql"
echo "Applying PAY-05 to the local UAT database ($(q "select count(*) from public.garage_invoices") garage invoices, $(q "select count(*) from public.pay04_garage_collections") PAY-04 collections already present)…"
apply "$PAY05_MIGRATION" migration "$WORK/$PAY05_MIGRATION.up.sql" "$MIG/$PAY05_MIGRATION"

# 2b. PAY-05-R1, recorded the same way, forward from the frozen PAY-05 migration.
PAY05_R1_MIGRATION=20261104100000_carup_pay05_r1_financial_integrity.sql
[ -f "$MIG/$PAY05_R1_MIGRATION" ] || fail "missing migration $PAY05_R1_MIGRATION"
sed '/^-- +migrate Down/,$d' "$MIG/$PAY05_R1_MIGRATION" > "$WORK/$PAY05_R1_MIGRATION.up.sql"
apply "$PAY05_R1_MIGRATION" migration "$WORK/$PAY05_R1_MIGRATION.up.sql" "$MIG/$PAY05_R1_MIGRATION"

# 3. The ONLY place the Paynow protocol simulator is ever enabled: this disposable UAT database.
ALIGN="$WORK/pay05-001.sql"
cat > "$ALIGN" <<'SQL'
UPDATE public.pay05_runtime_guard SET paynow_simulator_enabled = true WHERE singleton;
SQL
apply local-alignment:pay05-001-enable-paynow-protocol-simulator local-alignment "$ALIGN" "$ALIGN"

[ "$(q "select paynow_simulator_enabled::text || '|' || paynow_real_enabled::text from public.pay05_runtime_guard where singleton")" = "true|false" ] \
  || fail 'the PAY-05 runtime guard is not simulator-on / real-off.'
q "NOTIFY pgrst, 'reload schema';" >/dev/null
echo "Done. Ledger: $(q "select count(*) from carup_uat.migration_ledger") entries; Paynow simulator ON, real Paynow OFF (CHECK-enforced)."
