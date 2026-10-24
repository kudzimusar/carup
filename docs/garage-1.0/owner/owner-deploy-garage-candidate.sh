#!/bin/bash
# GARAGE-1.0-FINAL · OWNER ACTION 1 of 2 — deploy the exact final source to the PRODUCTION TARGET of the two STAGING Vercel
# projects WITHOUT moving any domain (--skip-domain):
#     carup-backend-staging  (prj_ddsVeXDxxHxyMAaZxX4v5ORya27W, directory backend)   -> the API and the communications worker code
#     carup-staging          (prj_auYmL5hA2ppWA15jdTK4GAdy3AYm,  directory web)       -> the web app, built for the canonical API host
#
# Run it yourself in a normal Terminal window (not through Claude):   bash docs/garage-1.0/owner/owner-deploy-garage-candidate.sh
# Dry run (prints every guard result and the exact commands, deploys nothing):   DRY_RUN=1 bash docs/garage-1.0/owner/owner-deploy-garage-candidate.sh
#
# · It can only reach the two STAGING projects: each deploy uses a Vercel link that names exactly one project, checked by id, name,
#   directory and org before anything is deployed. The real CarUp Production project is never named.
# · --skip-domain: api-staging.carup.dev, carup-backend-staging.vercel.app, staging.carup.dev and carup-staging.vercel.app all stay on
#   the current runtime. Nothing is promoted by this script (that is OWNER ACTION 2).
# · The database already carries the GARAGE-1.0 migrations (tip 20261024140000); this script changes no database.
# · It prints no secret. A non-secret record is written to docs/garage-1.0/owner/out/owner-deploy-record.json.
set -euo pipefail

SHA=8353dbdd7eb9382d210d8f9eff48a7300ec36224
REF=feat/garage-1.0-final-business-os-completion
BACKEND_PROJECT_ID=prj_ddsVeXDxxHxyMAaZxX4v5ORya27W
WEB_PROJECT_ID=prj_auYmL5hA2ppWA15jdTK4GAdy3AYm
ORG_ID=team_InL2Jmsg4dbG0rFY8nxriTha
CANONICAL_API="https://api-staging.carup.dev/api"
STAGING_REF=eoyenigwevnxwwhyhaer
SRC_REPO="${SRC_REPO:-$HOME/carup-garage-final}"
WT="${WT:-$HOME/carup-garage-owner-deploy}"
NODE="${NODE:-/opt/homebrew/bin/node}"
VC="${VC:-$HOME/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/vc.js}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"; mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRY="${DRY_RUN:-}"

die() { echo "REFUSED: $1 — nothing was deployed"; exit 1; }
# (the sentinel is written split so that stamping the SHA above cannot also rewrite this guard)
[ "$SHA" != "__FINAL_""SHA__" ] || die "this script has not been stamped with the final commit"
[ -x "$NODE" ] && [ -f "$VC" ] || die "Node ($NODE) or the Vercel CLI ($VC) is missing"

# 1 · a clean worktree at the exact commit
[ -d "$WT" ] || git -C "$SRC_REPO" worktree add --detach "$WT" "$SHA" > /dev/null
[ "$(git -C "$WT" rev-parse HEAD)" = "$SHA" ] || die "$WT is not at $SHA"
[ -z "$(git -C "$WT" status --porcelain --untracked-files=no)" ] || die "$WT has local changes"
git -C "$SRC_REPO" merge-base --is-ancestor "$SHA" "origin/$REF" 2>/dev/null || die "$SHA is not on origin/$REF (push it first)"

link() {  # link <project-id> <project-name> <directory>   → writes a repo.json naming exactly that one project, then verifies it
  mkdir -p "$WT/.vercel"
  python3 - "$WT/.vercel/repo.json" "$1" "$2" "$3" "$ORG_ID" <<'PY'
import json, sys
path, pid, name, directory, org = sys.argv[1:6]
json.dump({"remoteName": "origin", "projects": [{"id": pid, "name": name, "directory": directory, "orgId": org}]}, open(path, "w"), indent=2)
d = json.load(open(path)); p = d["projects"]
sys.exit(0 if len(p) == 1 and p[0]["id"] == pid and p[0]["name"] == name and p[0]["directory"] == directory and p[0]["orgId"] == org else 1)
PY
}

deploy() {  # deploy <dir> <log> <extra args...>
  local dir="$1" log="$2"; shift 2
  if [ -n "$DRY" ]; then echo "DRY_RUN: (cd $WT/$dir && $NODE $VC deploy --prod --skip-domain --scope 11-11 --non-interactive $*)"; return 0; fi
  ( cd "$WT/$dir" && "$NODE" "$VC" deploy --prod --skip-domain --scope 11-11 --non-interactive "$@" ) 2>&1 | tee "$log"
}

echo "Source:  $SHA (clean worktree $WT, on origin/$REF)"
echo "Target:  Vercel projects carup-backend-staging + carup-staging, production target, --skip-domain (no host moves)"

# 2 · backend first (it carries the communications worker's subscribers)
link "$BACKEND_PROJECT_ID" carup-backend-staging backend || die "the backend Vercel link does not name only carup-backend-staging"
BLOG="$OUT/owner-deploy-backend-$STAMP.log"
set +e
deploy backend "$BLOG" --build-env CARUP_BUILD_SHA="$SHA" --build-env CARUP_BUILD_REF="$REF" --env CARUP_BUILD_SHA="$SHA" --env CARUP_BUILD_REF="$REF"
BRC=$?
set -e

# 3 · web, built for the canonical API host (so moving api-staging later needs no web rebuild)
link "$WEB_PROJECT_ID" carup-staging web || die "the web Vercel link does not name only carup-staging"
WLOG="$OUT/owner-deploy-web-$STAMP.log"
set +e
deploy web "$WLOG" --build-env CARUP_BUILD_SHA="$SHA" --build-env CARUP_BUILD_REF="$REF" --build-env VITE_API_URL="$CANONICAL_API"
WRC=$?
set -e

if [ -n "$DRY" ]; then echo "DRY_RUN complete: guards passed, no deployment was made."; exit 0; fi

BURL="$(grep -oE 'https://carup-backend-staging-[a-z0-9]+-11-11\.vercel\.app' "$BLOG" | head -1 || true)"
WURL="$(grep -oE 'https://carup-staging-[a-z0-9]+-11-11\.vercel\.app' "$WLOG" | head -1 || true)"
[ -n "$BURL" ] && [ -n "$WURL" ] || { echo "DEPLOY DID NOT COMPLETE (backend exit $BRC, web exit $WRC). If the output says \"Not authorized\", run this script once more; otherwise paste the last 5 lines of each log in $OUT."; exit 1; }

# 4 · prove each candidate serves exactly the build, on the STAGING database, with the kill switch active and external sends disabled
BH="$(curl -s --max-time 30 "$BURL/api/health" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("unreachable - - - - -"); sys.exit()
b = d.get("build") or {}; o = (d.get("communications") or {}).get("outbound") or {}; db = d.get("database") or {}
print(b.get("commit_sha") or "-", b.get("deployment_id") or "-", o.get("kill_switch") or "-", o.get("external_sends") or "-", db.get("supabase_project_ref") or "-", db.get("consistent"))')"
read -r b_sha b_id b_ks b_ext b_ref b_cons <<< "$BH"
WP="$(curl -s --max-time 30 "$WURL/carup-provenance.json" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("unreachable - -"); sys.exit()
print(d.get("commit_sha") or "-", d.get("api_base_url") or "-", d.get("unpaired"))')"
read -r w_sha w_api w_unp <<< "$WP"
OK=1
[ "$b_sha" = "$SHA" ] && [ "$b_ref" = "$STAGING_REF" ] && [ "$b_ext" = disabled ] && [ "$b_ks" = active ] && [ "$b_cons" = True ] || OK=0
[ "$w_sha" = "$SHA" ] && [ "$w_api" = "$CANONICAL_API" ] && [ "$w_unp" = False ] || OK=0

python3 - "$OUT/owner-deploy-record.json" <<PY
import json
json.dump({"at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "source_sha": "$SHA", "source_ref": "$REF",
           "backend": {"url": "$BURL", "host": "${BURL#https://}", "deployment_id": "$b_id", "health": {"sha": "$b_sha", "kill_switch": "$b_ks", "external_sends": "$b_ext", "supabase_project_ref": "$b_ref", "database_consistent": "$b_cons"}, "cli_exit": $BRC},
           "web": {"url": "$WURL", "host": "${WURL#https://}", "api_base_url": "$w_api", "provenance_sha": "$w_sha", "unpaired": "$w_unp", "cli_exit": $WRC},
           "candidates_prove_exact_build_on_staging": $OK == 1, "target": "production target of the staging projects (--skip-domain)"},
          open("$OUT/owner-deploy-record.json", "w"), indent=2)
PY
echo
if [ "$OK" = 1 ]; then
  echo "DEPLOYED (not promoted):"
  echo "  backend $BURL  ($b_id)  build ${b_sha:0:8}  kill switch $b_ks  external sends $b_ext  database $b_ref"
  echo "  web     $WURL  build ${w_sha:0:8}  api $w_api"
  echo "Next: bash docs/garage-1.0/owner/owner-cutover-garage.sh   (CHECK_ONLY=1 first if you want to see its guards pass without moving anything)"
else
  echo "CANDIDATES DO NOT PROVE THE EXACT BUILD — do not cut over."
  echo "  backend: sha=$b_sha ref=$b_ref sends=$b_ext kill_switch=$b_ks consistent=$b_cons"
  echo "  web:     sha=$w_sha api=$w_api unpaired=$w_unp"
  exit 1
fi
