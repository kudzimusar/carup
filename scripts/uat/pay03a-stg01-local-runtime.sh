#!/usr/bin/env bash
# CARUP-PAY-03A-STG01-FINAL — Owner-operated launcher for the isolated PAY-03A local UAT runtime.
#
#   PAY03A_EXPECTED_SHA=<candidate> pay03a-stg01-local-runtime.sh <worktree> preflight
#   PAY03A_EXPECTED_SHA=<candidate> pay03a-stg01-local-runtime.sh <worktree> backend --stage5
#   PAY03A_EXPECTED_SHA=<candidate> pay03a-stg01-local-runtime.sh <worktree> backend --stage6
#   PAY03A_EXPECTED_SHA=<candidate> pay03a-stg01-local-runtime.sh <worktree> web
#
# --stage5  Before any financial authorization. The Stripe key is a deliberately NON-FUNCTIONAL
#           `sk_test_` placeholder: every pre-provider refusal (400/401/404/422) is exercised for real,
#           and any path that reaches Stripe fails at account verification, so no Checkout session,
#           charge or refund can be created.
# --stage6  Only after the Owner's explicit financial authorization. Prompts (hidden) for the CarUp
#           Japan sandbox `sk_test_` key and the Stripe CLI `whsec_` listener secret; neither is echoed,
#           written to disk or placed in argv.
#
# Containment: the backend runs under `env -i` with an explicit allowlist from <worktree>/backend,
# where no dotfile exists, so nothing inherited from the Owner's shell or a Production `.env` can reach
# it. Supabase must resolve to the authorized local stack (127.0.0.1:54321). Occupied ports are refused,
# never killed (the PAY-01C runtime keeps 5017).
set -euo pipefail
umask 077

readonly SUPABASE_ROOT='/private/tmp/carup-pay01a-supabase'
readonly BACKEND_PORT=5031
readonly WEB_PORT=5183
readonly WEB_ORIGIN="http://127.0.0.1:${WEB_PORT}"
readonly API_ORIGIN="http://127.0.0.1:${BACKEND_PORT}"
readonly STRIPE_ACCOUNT='acct_1UVnGaEjgXqvlsJk'

fail() { echo "PAY-03A local runtime: $*" >&2; exit 1; }

[ "$#" -ge 2 ] || fail 'usage: <worktree> preflight | backend --stage5|--stage6 | web'
WT="$(cd "$1" && pwd)"; ROLE="$2"; MODE="${3:-}"
EXPECTED_SHA="${PAY03A_EXPECTED_SHA:-}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'PAY03A_EXPECTED_SHA must be the full 40-hex candidate commit.'
case "$WT" in *' '*) fail 'worktree path must not contain spaces (import.meta.url entrypoint guards).' ;; esac

for tool in git supabase jq curl node npx lsof openssl; do command -v "$tool" >/dev/null || fail "missing tool: $tool"; done

verify_custody() {
  local actual; actual="$(git -C "$WT" rev-parse HEAD 2>/dev/null)" || fail 'worktree is not a Git checkout.'
  [ "$actual" = "$EXPECTED_SHA" ] || fail "worktree is at $actual, not the candidate $EXPECTED_SHA."
  [ -z "$(git -C "$WT" status --porcelain)" ] || fail 'worktree has uncommitted changes.'
  local dot; dot="$(find "$WT" "$WT/backend" "$WT/web" -maxdepth 1 \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' 2>/dev/null | head -1)"
  [ -z "$dot" ] || fail "dotfile present ($dot); the runtime must not inherit dotfile configuration."
}

resolve_local_supabase() {
  local status_json
  status_json="$(supabase status --workdir "$SUPABASE_ROOT" --output json 2>/dev/null)" \
    || fail 'local Supabase status unavailable; start the isolated stack.'
  API_URL="$(jq -er '.API_URL' <<<"$status_json")" || fail 'no API_URL.'
  SERVICE_ROLE_KEY="$(jq -er '.SERVICE_ROLE_KEY | select(length > 20)' <<<"$status_json")" || fail 'no service-role key.'
  ANON_KEY="$(jq -er '.ANON_KEY | select(length > 20)' <<<"$status_json")" || fail 'no anon key.'
  unset status_json
  case "$API_URL" in http://127.0.0.1:54321|http://localhost:54321) ;; *) fail "Supabase resolved to $API_URL, not the local stack." ;; esac
  curl -fsS --max-time 5 "$API_URL/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null || fail 'local PostgREST unavailable.'
}

require_free_port() {
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then fail "port $1 is occupied; refusing to touch another programme's process."; fi
}

verify_custody
resolve_local_supabase

case "$ROLE" in
  preflight)
    echo "PAY-03A preflight OK: worktree $EXPECTED_SHA clean, no dotfiles, Supabase $API_URL reachable."
    ;;
  backend)
    require_free_port "$BACKEND_PORT"
    case "$MODE" in
      --stage5)
        STRIPE_KEY='sk_test_PAY03A_STAGE5_NO_PROVIDER_ACCESS'
        WEBHOOK_SECRET='whsec_PAY03AStage5NoProviderAccess'
        echo 'Stage 5 runtime: NO provider access (placeholder test key; no Checkout session can be created).'
        ;;
      --stage6)
        read -r -s -p 'CarUp Japan sandbox sk_test API key: ' STRIPE_KEY; printf '\n'
        read -r -s -p 'Stripe CLI whsec listener secret: ' WEBHOOK_SECRET; printf '\n'
        [[ "$STRIPE_KEY" =~ ^sk_test_ ]] || fail 'refusing: a test-only Stripe secret key (sk_test_) is required.'
        [[ "$WEBHOOK_SECRET" =~ ^whsec_[A-Za-z0-9]+$ ]] || fail 'refusing: a Stripe CLI webhook signing secret is required.'
        ;;
      *) fail 'backend requires --stage5 or --stage6.' ;;
    esac
    cd "$WT/backend"
    exec env -i \
      PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
      NODE_ENV=development CARUP_ENV=development PORT="$BACKEND_PORT" \
      SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
      JWT_SECRET="$(openssl rand -hex 32)" \
      CARUP_BUILD_SHA="$EXPECTED_SHA" \
      CARUP_PAY01A_ENABLED=true CARUP_PAY01C_ENABLED=false \
      CARUP_PAY02_ENABLED=true CARUP_PAY03A_ENABLED=true \
      CARUP_PAY01A_STRIPE_ACCOUNT_ID="$STRIPE_ACCOUNT" \
      CARUP_PAY01A_RETURN_ORIGIN="$WEB_ORIGIN" \
      CARUP_PAY01A_STRIPE_SECRET_KEY="$STRIPE_KEY" \
      CARUP_PAY01A_STRIPE_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
      node server.js
    ;;
  web)
    require_free_port "$WEB_PORT"
    cd "$WT/web"
    env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
      CARUP_BUILD_SHA="$EXPECTED_SHA" VITE_API_URL="$API_ORIGIN" \
      VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
      npx vite build --logLevel warn
    jq -e --arg sha "$EXPECTED_SHA" '.commit_sha == $sha' dist/carup-provenance.json >/dev/null \
      || fail 'built bundle does not carry the candidate SHA.'
    exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
      npx vite preview --host 127.0.0.1 --port "$WEB_PORT" --strictPort
    ;;
  *) fail "unknown role $ROLE" ;;
esac
