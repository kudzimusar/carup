#!/usr/bin/env bash
# CARUP-PAY-05-LR01 — launcher for the isolated PAY-05 local UAT runtime (dedicated carup-pay04-supabase stack, reused).
#
#   PAY05_EXPECTED_SHA=<candidate> pay05-local-runtime.sh <worktree> preflight
#   PAY05_EXPECTED_SHA=<candidate> pay05-local-runtime.sh <worktree> simulator   (the LOCAL Paynow protocol simulator)
#   PAY05_EXPECTED_SHA=<candidate> pay05-local-runtime.sh <worktree> backend     [PAY05_UAT_TTL_SECONDS=5..3600]
#   PAY05_EXPECTED_SHA=<candidate> pay05-local-runtime.sh <worktree> web
#
# Level 1 only. Paynow is the clearly-labelled LOCAL PAYNOW PROTOCOL SIMULATOR on 127.0.0.1:5071 (it speaks Paynow's
# documented merchant protocol; nothing in this runtime can reach www.paynow.co.zw: the adapter refuses every real
# mode and the database guard forbids real Paynow). The PAY-04 garage-provider simulator stays on beside it so the
# accepted PAY-04 matrix replays against this candidate. No Stripe key exists (PAY-01A/01C/03B are disabled).
#
# Containment (as PAY-04): every process runs under `env -i` with an explicit allowlist, from directories without
# dotfiles; Supabase must resolve to the dedicated stack (127.0.0.1:56321); occupied ports are refused, never killed.
# Secrets of this disposable runtime (the credential-vault KEK, the simulator control token) live 0600 under
# ~/carup-launch-evidence/pay05/runtime, outside the repository, and are never printed.
set -euo pipefail
umask 077

readonly SUPABASE_ROOT="$HOME/carup-pay04-supabase"
readonly BACKEND_PORT=5051
readonly WEB_PORT=5203
# never a WHATWG fetch "bad port" (5060/5061 are SIP): fetch, and so CarUp's adapter, refuses to connect to one
readonly SIM_PORT=5071
readonly EVIDENCE_ROOT="$HOME/carup-launch-evidence/pay05"
readonly RUNTIME_DIR="$EVIDENCE_ROOT/runtime"
readonly PAY04_EVIDENCE_ROOT="$HOME/carup-launch-evidence/pay04"
readonly WEB_ORIGIN="http://127.0.0.1:${WEB_PORT}"
readonly API_ORIGIN="http://127.0.0.1:${BACKEND_PORT}"
readonly SIM_ORIGIN="http://127.0.0.1:${SIM_PORT}"

fail() { echo "PAY-05 local runtime: $*" >&2; exit 1; }

# The Supabase CLI shells out to `docker`; Docker Desktop installs it outside the default PATH.
export PATH="$PATH:/usr/local/bin:$HOME/.docker/bin"

[ "$#" -ge 2 ] || fail 'usage: <worktree> preflight | simulator | backend | web'
WT="$(cd "$1" && pwd)"; ROLE="$2"
EXPECTED_SHA="${PAY05_EXPECTED_SHA:-}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'PAY05_EXPECTED_SHA must be the full 40-hex candidate commit.'
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
  case "$API_URL" in http://127.0.0.1:56321|http://localhost:56321) ;; *) fail "Supabase resolved to $API_URL, not the dedicated local stack." ;; esac
  curl -fsS --max-time 5 "$API_URL/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null || fail 'local PostgREST unavailable.'
}

require_free_port() {
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then fail "port $1 is occupied; refusing to touch another programme's process."; fi
}

# The runtime's credential-vault key: 32 random bytes, generated ONCE (sealed integration keys must survive restarts).
runtime_kek() {
  mkdir -p "$RUNTIME_DIR"; chmod 700 "$EVIDENCE_ROOT" "$RUNTIME_DIR"
  [ -s "$RUNTIME_DIR/credential-kek" ] || openssl rand -base64 32 | tr -d '\n' > "$RUNTIME_DIR/credential-kek"
  chmod 600 "$RUNTIME_DIR/credential-kek"
  cat "$RUNTIME_DIR/credential-kek"
}

verify_custody
resolve_local_supabase

case "$ROLE" in
  preflight)
    rest() { curl -fsS --max-time 5 "$API_URL/rest/v1/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"; }
    [ "$(rest 'pay04_runtime_guard?select=garage_simulator_enabled' | jq -r '.[0].garage_simulator_enabled')" = true ] \
      || fail 'PAY-04 schema or simulator guard missing; run scripts/uat/pay05-local-db-build.sh.'
    [ "$(rest 'pay05_runtime_guard?select=paynow_simulator_enabled,paynow_real_enabled' | jq -r '.[0] | "\(.paynow_simulator_enabled)|\(.paynow_real_enabled)"')" = 'true|false' ] \
      || fail 'PAY-05 schema or Paynow simulator guard missing; run scripts/uat/pay05-local-db-build.sh.'
    echo "PAY-05 preflight OK: worktree $EXPECTED_SHA clean, no dotfiles, Supabase $API_URL reachable, PAY-04 + PAY-05 schema present, Paynow simulator on, real Paynow off."
    ;;
  simulator)
    require_free_port "$SIM_PORT"
    mkdir -p "$RUNTIME_DIR"; chmod 700 "$EVIDENCE_ROOT" "$RUNTIME_DIR"
    # a fresh control token per simulator run (the simulator's state is in memory: a restart means re-running the seed)
    openssl rand -hex 24 | tr -d '\n' > "$RUNTIME_DIR/simulator-control-token"; chmod 600 "$RUNTIME_DIR/simulator-control-token"
    echo 'Level 1: LOCAL PAYNOW PROTOCOL SIMULATOR (loopback only; no real money moves).'
    cd "$WT"
    exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" NODE_ENV=development CARUP_ENV=development \
      node scripts/uat/pay05-paynow-simulator-server.mjs --port "$SIM_PORT" --control-token-file "$RUNTIME_DIR/simulator-control-token"
    ;;
  backend)
    require_free_port "$BACKEND_PORT"
    sim_rc=0; curl -fsS --max-time 3 -o /dev/null -X POST "$SIM_ORIGIN/__control/run-due" 2>/dev/null || sim_rc=$?
    # 403 without the token proves the simulator (not something else) is listening; curl -f exits 22 on it
    [ "$sim_rc" -eq 22 ] || fail "the Paynow protocol simulator is not answering on $SIM_ORIGIN; start the 'simulator' role first."
    mkdir -p "$PAY04_EVIDENCE_ROOT/simulator"
    KEK="$(runtime_kek)"
    SIM_SECRET="gsimsec_$(openssl rand -hex 16)"
    extra=()
    if [ -n "${PAY05_UAT_TTL_SECONDS:-}" ]; then
      [[ "$PAY05_UAT_TTL_SECONDS" =~ ^[0-9]+$ ]] && [ "$PAY05_UAT_TTL_SECONDS" -ge 5 ] && [ "$PAY05_UAT_TTL_SECONDS" -le 3600 ] \
        || fail 'PAY05_UAT_TTL_SECONDS must be 5..3600.'
      extra+=("CARUP_PAY04_UAT_COLLECTION_TTL_SECONDS=$PAY05_UAT_TTL_SECONDS")
    fi
    echo "Level 1 runtime: LOCAL PAYNOW PROTOCOL SIMULATOR ($SIM_ORIGIN) + LOCAL GARAGE PAYMENT-PROVIDER SIMULATOR. Collection TTL: ${PAY05_UAT_TTL_SECONDS:-1800 (accepted default)} s."
    cd "$WT/backend"
    exec env -i \
      PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
      NODE_ENV=development CARUP_ENV=development PORT="$BACKEND_PORT" \
      SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
      JWT_SECRET="$(openssl rand -hex 32)" \
      CARUP_BUILD_SHA="$EXPECTED_SHA" \
      CARUP_PAY01A_ENABLED=false CARUP_PAY01C_ENABLED=false CARUP_PAY03B_ENABLED=false \
      CARUP_PAY04_ENABLED=true CARUP_PAY04_PROVIDER_MODE=local_simulator \
      CARUP_PAY04_SIMULATOR_STATE_FILE="$PAY04_EVIDENCE_ROOT/simulator/state.json" \
      CARUP_PAY04_SIMULATOR_WEBHOOK_SECRET="$SIM_SECRET" \
      CARUP_PAY04_SIMULATOR_PUBLIC_ORIGIN="$API_ORIGIN" \
      CARUP_PAY04_RETURN_ORIGIN="$WEB_ORIGIN" \
      CARUP_PAY05_ENABLED=true CARUP_PAY05_PAYNOW_MODE=simulator \
      CARUP_PAY05_PAYNOW_SIMULATOR_ORIGIN="$SIM_ORIGIN" \
      CARUP_PAY05_RESULT_ORIGIN="$API_ORIGIN" \
      CARUP_PAY05_CREDENTIAL_KEK="$KEK" CARUP_PAY05_CREDENTIAL_KEK_VERSION=1 \
      ${extra[@]+"${extra[@]}"} \
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
