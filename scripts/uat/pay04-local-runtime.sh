#!/usr/bin/env bash
# CARUP-PAY-04-LR01 — launcher for the isolated PAY-04 local UAT runtime (dedicated carup-pay04-supabase stack).
#
#   PAY04_EXPECTED_SHA=<candidate> pay04-local-runtime.sh <worktree> preflight
#   PAY04_EXPECTED_SHA=<candidate> pay04-local-runtime.sh <worktree> backend
#   PAY04_EXPECTED_SHA=<candidate> pay04-local-runtime.sh <worktree> web
#
# Level 1 only (authorized by the PAY-04 directive): the provider is the clearly-labelled LOCAL GARAGE PAYMENT-PROVIDER
# SIMULATOR. No Stripe key exists in this runtime (PAY-01A and PAY-03B are disabled), so nothing can reach any provider.
#
# Containment: the backend runs under `env -i` with an explicit allowlist from <worktree>/backend, where no dotfile
# exists, so nothing inherited from the Owner's shell or a Production `.env` can reach it. Supabase must resolve to the
# dedicated PAY-04 stack (127.0.0.1:56321). Occupied ports are refused, never killed.
set -euo pipefail
umask 077

readonly SUPABASE_ROOT="$HOME/carup-pay04-supabase"
readonly BACKEND_PORT=5051
readonly WEB_PORT=5203
readonly EVIDENCE_ROOT="$HOME/carup-launch-evidence/pay04"
readonly WEB_ORIGIN="http://127.0.0.1:${WEB_PORT}"
readonly API_ORIGIN="http://127.0.0.1:${BACKEND_PORT}"

fail() { echo "PAY-04 local runtime: $*" >&2; exit 1; }

# The Supabase CLI shells out to `docker`; Docker Desktop installs it outside the default PATH.
export PATH="$PATH:/usr/local/bin:$HOME/.docker/bin"

[ "$#" -ge 2 ] || fail 'usage: <worktree> preflight | backend | web'
WT="$(cd "$1" && pwd)"; ROLE="$2"
EXPECTED_SHA="${PAY04_EXPECTED_SHA:-}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'PAY04_EXPECTED_SHA must be the full 40-hex candidate commit.'
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
  # The Supabase CLI loads `.env` from the CURRENT directory: always run it from the stack's own directory under
  # `env -i` (PAY-03B finding F-ENV-1), so neither the caller's directory nor shell can steer which project it resolves.
  status_json="$(cd "$SUPABASE_ROOT" && env -i PATH="$PATH" HOME="$HOME" \
      supabase status --workdir "$SUPABASE_ROOT" --output json 2>/dev/null)" \
    || fail 'local Supabase status unavailable; start it with scripts/uat/pay04-local-stack.sh start.'
  API_URL="$(jq -er '.API_URL' <<<"$status_json")" || fail 'no API_URL.'
  SERVICE_ROLE_KEY="$(jq -er '.SERVICE_ROLE_KEY | select(length > 20)' <<<"$status_json")" || fail 'no service-role key.'
  ANON_KEY="$(jq -er '.ANON_KEY | select(length > 20)' <<<"$status_json")" || fail 'no anon key.'
  unset status_json
  case "$API_URL" in http://127.0.0.1:56321|http://localhost:56321) ;; *) fail "Supabase resolved to $API_URL, not the dedicated PAY-04 stack." ;; esac
  curl -fsS --max-time 5 "$API_URL/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null || fail 'local PostgREST unavailable.'
}

require_free_port() {
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then fail "port $1 is occupied; refusing to touch another programme's process."; fi
}

verify_custody
resolve_local_supabase

case "$ROLE" in
  preflight)
    [ "$(curl -fsS --max-time 5 "$API_URL/rest/v1/pay04_runtime_guard?select=garage_simulator_enabled" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r '.[0].garage_simulator_enabled')" = true ] \
      || fail 'PAY-04 schema or simulator guard missing; run scripts/uat/pay04-local-db-build.sh.'
    echo "PAY-04 preflight OK: worktree $EXPECTED_SHA clean, no dotfiles, Supabase $API_URL reachable, PAY-04 schema present."
    ;;
  backend)
    require_free_port "$BACKEND_PORT"
    mkdir -p "$EVIDENCE_ROOT/simulator"
    SIM_SECRET="gsimsec_$(openssl rand -hex 16)"
    echo 'Level 1 runtime: LOCAL GARAGE PAYMENT-PROVIDER SIMULATOR. No provider key exists; nothing can reach a provider.'
    cd "$WT/backend"
    exec env -i \
      PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
      NODE_ENV=development CARUP_ENV=development PORT="$BACKEND_PORT" \
      SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
      JWT_SECRET="$(openssl rand -hex 32)" \
      CARUP_BUILD_SHA="$EXPECTED_SHA" \
      CARUP_PAY01A_ENABLED=false CARUP_PAY01C_ENABLED=false CARUP_PAY03B_ENABLED=false \
      CARUP_PAY04_ENABLED=true CARUP_PAY04_PROVIDER_MODE=local_simulator \
      CARUP_PAY04_SIMULATOR_STATE_FILE="$EVIDENCE_ROOT/simulator/state.json" \
      CARUP_PAY04_SIMULATOR_WEBHOOK_SECRET="$SIM_SECRET" \
      CARUP_PAY04_SIMULATOR_PUBLIC_ORIGIN="$API_ORIGIN" \
      CARUP_PAY04_RETURN_ORIGIN="$WEB_ORIGIN" \
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
