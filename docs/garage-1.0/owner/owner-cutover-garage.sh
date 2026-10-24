#!/bin/bash
# GARAGE-1.0-FINAL · OWNER ACTION 2 of 2 — move the four CANONICAL STAGING hosts from the current runtime (OPS03 · 07b60e5d) to the
# candidates deployed by OWNER ACTION 1, BACKEND FIRST (the communications worker's subscribers live there), then the web:
#     api-staging.carup.dev  +  carup-backend-staging.vercel.app   -> backend candidate
#     staging.carup.dev      +  carup-staging.vercel.app           -> web candidate
#
# Run it yourself in a normal Terminal window (not through Claude):   bash docs/garage-1.0/owner/owner-cutover-garage.sh
# See the guards pass without moving anything:   CHECK_ONLY=1 bash docs/garage-1.0/owner/owner-cutover-garage.sh
# Print the exact commands only:                  DRY_RUN=1  bash docs/garage-1.0/owner/owner-cutover-garage.sh
#
# · Staging projects only (team 11-11). The real CarUp Production project and its hosts are never named.
# · Refuses — moving nothing — unless owner-deploy-record.json says the candidates proved the exact build on the staging database with
#   the kill switch active and external sends disabled, AND each candidate still proves it right now.
# · ORDER MATTERS. The communications worker dead-letters an event it has no handler for (NO_CURRENT_SUBSCRIBER, 5 attempts). The API
#   emits garage.* events, so the backend (subscribers) is moved BEFORE the web exposes the screens that cause them.
# · It prints no secret. Non-secret record: docs/garage-1.0/owner/out/owner-cutover-record.json.
set -euo pipefail

STAGING_REF=eoyenigwevnxwwhyhaer
CANONICAL_API="https://api-staging.carup.dev/api"
BACKEND_HOSTS="api-staging.carup.dev carup-backend-staging.vercel.app"
WEB_HOSTS="staging.carup.dev carup-staging.vercel.app"
# the runtime being replaced — the rollback targets, not part of the cutover
OLD_BACKEND_HOST=carup-backend-staging-ix1pa2wni-11-11.vercel.app     # dpl_GTRNcuTikKL6u2MV7meiKdK9BwJK (OPS03 · 07b60e5d)
OLD_WEB_HOST=carup-staging-hpqpt2iah-11-11.vercel.app                   # dpl_7AQTQs1apayK5PrVUk3RDai88Dut (OPS03 · 07b60e5d)
NODE="${NODE:-/opt/homebrew/bin/node}"
VC="${VC:-$HOME/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/vc.js}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"; REC="$OUT/owner-deploy-record.json"; mkdir -p "$OUT"
LOG="$OUT/owner-cutover-$(date -u +%Y%m%dT%H%M%SZ).log"
die() { echo "REFUSED: $1 — nothing was moved"; exit 1; }
[ -x "$NODE" ] && [ -f "$VC" ] || die "Node ($NODE) or the Vercel CLI ($VC) is missing"
[ -f "$REC" ] || die "no owner-deploy-record.json — run owner-deploy-garage-candidate.sh first"

# 1 · what OWNER ACTION 1 deployed, and the sha it must still serve
read -r SHA BE_HOST WEB_HOST RECORD_OK <<< "$(python3 - "$REC" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print(r["source_sha"], r["backend"]["host"], r["web"]["host"], "yes" if r.get("candidates_prove_exact_build_on_staging") is True else "no")
PY
)"
[ "$RECORD_OK" = yes ] || die "the deploy record does not say the candidates proved the exact build"

probe_backend() {  # host → "sha deployment_id kill_switch external_sends supabase_ref consistent"
  curl -s --max-time 20 "https://$1/api/health" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("unreachable - - - - - -"); sys.exit()
b = d.get("build") or {}; o = (d.get("communications") or {}).get("outbound") or {}; db = d.get("database") or {}
print(b.get("commit_sha") or "-", b.get("deployment_id") or "-", o.get("kill_switch") or "-", o.get("external_sends") or "-", db.get("supabase_project_ref") or "-", db.get("consistent"))'
}
probe_web() {  # host → "sha api_base_url unpaired"
  curl -s --max-time 20 "https://$1/carup-provenance.json" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("unreachable - -"); sys.exit()
print(d.get("commit_sha") or "-", d.get("api_base_url") or "-", d.get("unpaired"))'
}

# 2 · the candidates must STILL prove the exact build
read -r c_sha c_id c_ks c_ext c_ref c_cons <<< "$(probe_backend "$BE_HOST")"
{ [ "$c_sha" = "$SHA" ] && [ "$c_ks" = active ] && [ "$c_ext" = disabled ] && [ "$c_ref" = "$STAGING_REF" ] && [ "$c_cons" = True ]; } \
  || die "the backend candidate no longer proves exact build + kill switch + staging database ($c_sha $c_ks $c_ext $c_ref $c_cons)"
read -r w_sha w_api w_unp <<< "$(probe_web "$WEB_HOST")"
{ [ "$w_sha" = "$SHA" ] && [ "$w_api" = "$CANONICAL_API" ] && [ "$w_unp" = False ]; } \
  || die "the web candidate no longer proves exact build + canonical API pairing ($w_sha $w_api $w_unp)"

before() { for h in $1; do read -r s id _ _ _ _ <<< "$(probe_backend "$h")"; printf ' %s=%s@%s' "$h" "${s:0:8}" "$id"; done; }
BEFORE_BE="$(before "$BACKEND_HOSTS")"
BEFORE_WEB=""; for h in $WEB_HOSTS; do read -r s _ _ <<< "$(probe_web "$h")"; BEFORE_WEB="$BEFORE_WEB $h=${s:0:8}"; done
echo "Candidates certified and live: backend $BE_HOST ($c_id) · web $WEB_HOST · build ${SHA:0:8}"
echo "Before (backend):$BEFORE_BE"
echo "Before (web):    $BEFORE_WEB"
[ "${CHECK_ONLY:-}" = 1 ] && { echo "CHECK_ONLY: all preconditions hold; nothing was moved."; exit 0; }

alias_set() {  # alias_set <candidate-host> <canonical-host>
  if [ -n "${DRY_RUN:-}" ]; then echo "DRY_RUN: $NODE $VC alias set $1 $2 --scope 11-11 --non-interactive"; return 0; fi
  "$NODE" "$VC" alias set "$1" "$2" --scope 11-11 --non-interactive 2>&1 | tee -a "$LOG"
}

# 3 · BACKEND first, verified through the canonical hosts before the web is touched
RCS=""; set +e
for h in $BACKEND_HOSTS; do echo "Moving $h -> $BE_HOST"; alias_set "$BE_HOST" "$h"; RCS="$RCS $h=$?"; done
set -e
[ -n "${DRY_RUN:-}" ] && { echo "DRY_RUN complete: guards passed, nothing was moved."; exit 0; }
BE_OK=0; POST_BE=""
for i in $(seq 1 12); do
  POST_BE=""; good=1
  for h in $BACKEND_HOSTS; do
    read -r s id ks ext ref cons <<< "$(probe_backend "$h")"
    POST_BE="$POST_BE $h=${s:0:8}@$id@kill_switch:$ks@external_sends:$ext"
    { [ "$s" = "$SHA" ] && [ "$ks" = active ] && [ "$ext" = disabled ] && [ "$ref" = "$STAGING_REF" ] && [ "$cons" = True ]; } || good=0
  done
  [ "$good" = 1 ] && { BE_OK=1; break; }; sleep 5
done
if [ "$BE_OK" != 1 ]; then
  echo "BACKEND CUTOVER NOT VERIFIED:$POST_BE (alias exits:$RCS) — the web was NOT touched."
  echo "Rollback, ONLY if asked:"; for h in $BACKEND_HOSTS; do echo "  $NODE $VC alias set $OLD_BACKEND_HOST $h --scope 11-11 --non-interactive"; done
  exit 1
fi
echo "BACKEND CUTOVER VERIFIED through the canonical hosts:$POST_BE"

# 4 · then the web
WRCS=""; set +e
for h in $WEB_HOSTS; do echo "Moving $h -> $WEB_HOST"; alias_set "$WEB_HOST" "$h"; WRCS="$WRCS $h=$?"; done
set -e
WEB_OK=0; POST_WEB=""
for i in $(seq 1 12); do
  POST_WEB=""; good=1
  for h in $WEB_HOSTS; do
    read -r s api unp <<< "$(probe_web "$h")"
    POST_WEB="$POST_WEB $h=${s:0:8}@$api"
    { [ "$s" = "$SHA" ] && [ "$api" = "$CANONICAL_API" ] && [ "$unp" = False ]; } || good=0
  done
  [ "$good" = 1 ] && { WEB_OK=1; break; }; sleep 5
done

python3 - <<PY
import json
json.dump({"at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "sha": "$SHA", "backend_candidate": "$BE_HOST", "web_candidate": "$WEB_HOST",
           "before": {"backend": "$BEFORE_BE".split(), "web": "$BEFORE_WEB".split()},
           "after": {"backend": "$POST_BE".split(), "web": "$POST_WEB".split()},
           "alias_cli_exit_codes": {"backend": "$RCS".split(), "web": "$WRCS".split()},
           "backend_verified_through_canonical_hosts": $BE_OK == 1, "web_verified_through_canonical_hosts": $WEB_OK == 1,
           "rollback_targets": {"backend": "$OLD_BACKEND_HOST", "web": "$OLD_WEB_HOST"}, "log": "$(basename "$LOG")"},
          open("$OUT/owner-cutover-record.json", "w"), indent=2)
PY
echo
if [ "$WEB_OK" = 1 ]; then
  echo "CUTOVER VERIFIED through the canonical hosts."
  echo "  backend:$POST_BE"
  echo "  web:    $POST_WEB"
  echo
  echo "Still to do (see docs/garage-1.0/GARAGE_1_0_OWNER_CUTOVER_RUNBOOK.md):"
  echo "  1. re-run the physical UAT against the canonical hosts (a bounded credential window; the spec already supports it)"
  echo "  2. replay the 21 garage.* events the old worker dead-lettered (EventWorker.reprocessDeadLetters, eventType filter) — Moderator's call"
else
  echo "WEB CUTOVER NOT VERIFIED:$POST_WEB (alias exits:$WRCS). The backend is already moved and verified."
  echo "Rollback of the web ONLY, if asked:"; for h in $WEB_HOSTS; do echo "  $NODE $VC alias set $OLD_WEB_HOST $h --scope 11-11 --non-interactive"; done
  exit 1
fi
