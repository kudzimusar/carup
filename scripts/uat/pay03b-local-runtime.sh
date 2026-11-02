#!/usr/bin/env bash
# CARUP-PAY-03B-LR01 — launcher for the isolated PAY-03B local UAT runtime (dedicated carup-pay03b-supabase stack).
#
#   PAY03B_EXPECTED_SHA=<candidate> pay03b-local-runtime.sh <worktree> preflight
#   PAY03B_EXPECTED_SHA=<candidate> pay03b-local-runtime.sh <worktree> backend --simulator
#   PAY03B_EXPECTED_SHA=<candidate> PAY03B_LEVEL2_AUTHORIZATION=<file> pay03b-local-runtime.sh <worktree> backend --stripe-sandbox
#   PAY03B_EXPECTED_SHA=<candidate> pay03b-local-runtime.sh <worktree> web
#
# --simulator       Level 1 (authorized by the directive): the clearly labelled LOCAL PROVIDER SIMULATOR is the
#                   provider; the Stripe key is a NON-FUNCTIONAL `sk_test_` placeholder, so nothing can reach
#                   Stripe. Billing periods are accelerated (PAY03B_SIM_PERIOD_SECONDS, default 180).
# --stripe-sandbox  Level 2 ONLY with a recorded Owner authorization file. Prompts (hidden) for the CarUp Japan
#                   sandbox `sk_test_` key and the Stripe CLI `whsec_` secret; neither is echoed, written or in argv.
#
# Containment: the backend runs under `env -i` with an explicit allowlist from <worktree>/backend,
# where no dotfile exists, so nothing inherited from the Owner's shell or a Production `.env` can reach
# it. Supabase must resolve to the dedicated PAY-03B stack (127.0.0.1:55321). Occupied ports are refused,
# never killed (PAY-01C keeps 5017, PAY-03A used 5031/5183).
set -euo pipefail
umask 077

readonly SUPABASE_ROOT="$HOME/carup-pay03b-supabase"
readonly BACKEND_PORT=5041
readonly WEB_PORT=5193
readonly EVIDENCE_ROOT="$HOME/carup-launch-evidence/pay03b"
readonly WEB_ORIGIN="http://127.0.0.1:${WEB_PORT}"
readonly API_ORIGIN="http://127.0.0.1:${BACKEND_PORT}"
readonly STRIPE_ACCOUNT='acct_1UVnGaEjgXqvlsJk'

fail() { echo "PAY-03B local runtime: $*" >&2; exit 1; }

# The Supabase CLI shells out to `docker`; Docker Desktop installs it outside the default PATH.
export PATH="$PATH:/usr/local/bin:$HOME/.docker/bin"

[ "$#" -ge 2 ] || fail 'usage: <worktree> preflight | backend --simulator|--stripe-sandbox | web'
WT="$(cd "$1" && pwd)"; ROLE="$2"; MODE="${3:-}"
EXPECTED_SHA="${PAY03B_EXPECTED_SHA:-}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'PAY03B_EXPECTED_SHA must be the full 40-hex candidate commit.'
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
  # F-ENV-1: the Supabase CLI loads `.env` from the CURRENT directory and honours SUPABASE_PROJECT_ID from
  # the environment. Run from the operator's CarUp checkout it resolved the PRODUCTION project ref
  # from that checkout's `.env`. Always run it from the stack's own directory under
  # `env -i`, so neither the caller's directory nor shell can steer which project it resolves.
  status_json="$(cd "$SUPABASE_ROOT" && env -i PATH="$PATH" HOME="$HOME" \
      supabase status --workdir "$SUPABASE_ROOT" --output json 2>/dev/null)" \
    || fail 'local Supabase status unavailable; start it with scripts/uat/pay03b-local-stack.sh start.'
  API_URL="$(jq -er '.API_URL' <<<"$status_json")" || fail 'no API_URL.'
  SERVICE_ROLE_KEY="$(jq -er '.SERVICE_ROLE_KEY | select(length > 20)' <<<"$status_json")" || fail 'no service-role key.'
  ANON_KEY="$(jq -er '.ANON_KEY | select(length > 20)' <<<"$status_json")" || fail 'no anon key.'
  unset status_json
  case "$API_URL" in http://127.0.0.1:55321|http://localhost:55321) ;; *) fail "Supabase resolved to $API_URL, not the dedicated PAY-03B stack." ;; esac
  curl -fsS --max-time 5 "$API_URL/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null || fail 'local PostgREST unavailable.'
}

require_free_port() {
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then fail "port $1 is occupied; refusing to touch another programme's process."; fi
}

verify_custody
resolve_local_supabase

case "$ROLE" in
  preflight)
    [ "$(curl -fsS --max-time 5 "$API_URL/rest/v1/pay03b_subscription_plans?select=plan_code&limit=1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq length)" = 1 ] \
      || fail 'PAY-03B schema missing; run scripts/uat/pay03b-local-db-build.sh.'
    echo "PAY-03B preflight OK: worktree $EXPECTED_SHA clean, no dotfiles, Supabase $API_URL reachable, PAY-03B schema present."
    ;;
  backend)
    require_free_port "$BACKEND_PORT"
    PROVIDER_MODE=''
    LEVEL2_CLOCK=''
    case "$MODE" in
      --simulator)
        STRIPE_KEY='sk_test_PAY03B_LEVEL1_NO_PROVIDER_ACCESS'
        WEBHOOK_SECRET="$(printf 'whsec%s' '_PAY03BLevel1NoProviderAccess')"
        PROVIDER_MODE='local_simulator'
        mkdir -p "$EVIDENCE_ROOT/simulator"
        SIM_SECRET="simsec_$(openssl rand -hex 16)"
        echo 'Level 1 runtime: LOCAL PROVIDER SIMULATOR (not Stripe). Placeholder Stripe key; nothing can reach Stripe.'
        ;;
      --stripe-sandbox)
        [ -f "${PAY03B_LEVEL2_AUTHORIZATION:-}" ] || fail 'Level 2 requires PAY03B_LEVEL2_AUTHORIZATION=<recorded Owner authorization file>.'
        read -r -s -p 'CarUp Japan sandbox sk_test API key: ' STRIPE_KEY; printf '\n'
        read -r -s -p 'Stripe CLI whsec listener secret: ' WEBHOOK_SECRET; printf '\n'
        [[ "$STRIPE_KEY" =~ ^sk_test_ ]] || fail 'refusing: a test-only Stripe secret key (sk_test_) is required.'
        [[ "$WEBHOOK_SECRET" =~ ^whsec_[A-Za-z0-9]+$ ]] || fail 'refusing: a Stripe CLI webhook signing secret is required.'
        SIM_SECRET=''
        # Provision exactly the authorized sandbox objects (idempotent); the key travels only in the environment.
        (cd "$WT" && env -i PATH="$PATH" HOME="$HOME" PAY03B_STRIPE_SECRET="$STRIPE_KEY" node scripts/uat/pay03b-stripe-sandbox-provision.mjs) \
          || fail 'Level 2 provisioning failed.'
        LEVEL2_CLOCK="$(cat "$EVIDENCE_ROOT/level2-clock-id")"
        ;;
      *) fail 'backend requires --simulator or --stripe-sandbox.' ;;
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
      CARUP_PAY03B_ENABLED=true CARUP_PAY03B_PROVIDER_MODE="$PROVIDER_MODE" \
      CARUP_PAY03B_SIMULATOR_STATE_FILE="$EVIDENCE_ROOT/simulator/state.json" \
      CARUP_PAY03B_SIMULATOR_WEBHOOK_SECRET="$SIM_SECRET" \
      CARUP_PAY03B_SIMULATOR_PERIOD_SECONDS="${PAY03B_SIM_PERIOD_SECONDS:-180}" \
      CARUP_PAY03B_SIMULATOR_PUBLIC_ORIGIN="$API_ORIGIN" \
      CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT=true \
      CARUP_PAY03B_STRIPE_TEST_CLOCK_ID="${LEVEL2_CLOCK:-}" \
      CARUP_PAY03B_LEVEL2_AUTHORIZATION_FILE="${PAY03B_LEVEL2_AUTHORIZATION:-}" \
      CARUP_PAY03B_LEVEL2_LEDGER_FILE="$EVIDENCE_ROOT/level2-ledger.json" \
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
