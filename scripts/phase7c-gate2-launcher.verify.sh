#!/usr/bin/env bash
#
# Deterministic verification for scripts/start-phase7c-gate2-mobile.sh.
#
# Exercises every guard branch of the Gate 2 launcher without starting Expo and
# without touching the real mobile/.env.local (each case uses an isolated temp env
# file via PHASE7C_GATE2_ENV_FILE). Dependency resolution is driven with
# PHASE7C_GATE2_REQUIRE_MODULES so both the resolvable and unresolvable branches
# are proven regardless of whether the mobile workspace is installed.
#
# Exit 0 iff all cases pass.
#
set -uo pipefail

LAUNCHER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start-phase7c-gate2-mobile.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
SENTINEL="SUPERSECRET_TOKEN_DEADBEEF"

write_env() { # <file> <api_url> <allow_localhost> <allow_dev>
  printf 'EXPO_PUBLIC_API_URL=%s\nEXPO_PUBLIC_ALLOW_LOCALHOST_API=%s\nEXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK=%s\n' \
    "$2" "$3" "$4" > "$1"
}

# run <env_file> <min_free_mb> <require_modules> <flags...>  -> sets OUT, CODE
run() {
  local ef="$1" minmb="$2" mods="$3"; shift 3
  OUT="$(PHASE7C_GATE2_ENV_FILE="$ef" \
        PHASE7C_GATE2_MIN_FREE_MB="$minmb" \
        PHASE7C_GATE2_REQUIRE_MODULES="$mods" \
        PHASE7C_GATE2_SKIP_INSTALL=true \
        bash "$LAUNCHER" "$@" 2>&1)"
  CODE=$?
}

expect() { # <desc> <pass|fail> <code>
  local desc="$1" want="$2" code="$3"
  if { [ "$want" = pass ] && [ "$code" -eq 0 ]; } || { [ "$want" = fail ] && [ "$code" -ne 0 ]; }; then
    printf 'ok     - %s (exit=%s, expected=%s)\n' "$desc" "$code" "$want"; PASS=$((PASS+1))
  else
    printf 'NOT OK - %s (exit=%s, expected=%s)\n' "$desc" "$code" "$want"; FAIL=$((FAIL+1))
  fi
}

echo "== Phase 7C Gate 2 launcher — deterministic verification =="

# 1. Missing env file -> template created PREFILLED with the release staging
#    backend, so verify-only passes immediately (no owner hand-edit needed).
EF="$TMP/missing.env"; rm -f "$EF"
run "$EF" 0 fs --verify-only
expect "1. missing env file -> prefilled template accepted" pass "$CODE"
if [ -f "$EF" ] && grep -q "carup-backend-staging-git-release" "$EF"; then
  echo "ok     - 1b. template created with the RELEASE staging backend"; PASS=$((PASS+1))
else
  echo "NOT OK - 1b. template missing or not prefilled with the release alias"; FAIL=$((FAIL+1))
fi

# 2. Valid existing env.
EF="$TMP/valid.env"; write_env "$EF" "https://carup-backend-staging.vercel.app" false false
run "$EF" 0 fs --verify-only
expect "2. valid existing env accepted" pass "$CODE"

# 3. Incompatible backend (http, not https).
EF="$TMP/http.env"; write_env "$EF" "http://carup-backend-staging.vercel.app" false false
run "$EF" 0 fs --verify-only
expect "3. incompatible (non-https) backend rejected" fail "$CODE"

# 4. Localhost backend.
EF="$TMP/local.env"; write_env "$EF" "https://localhost:5001" false false
run "$EF" 0 fs --verify-only
expect "4. localhost backend rejected" fail "$CODE"

# 4b. 0.0.0.0 / 127.0.0.1 variants.
EF="$TMP/zero.env"; write_env "$EF" "https://0.0.0.0:8081" false false
run "$EF" 0 fs --verify-only
expect "4b. 0.0.0.0 backend rejected" fail "$CODE"

# 5. Dev fallback enabled.
EF="$TMP/devfb.env"; write_env "$EF" "https://carup-backend-staging.vercel.app" false true
run "$EF" 0 fs --verify-only
expect "5. dev-user fallback enabled rejected" fail "$CODE"

# 5b. Localhost-api fallback enabled.
EF="$TMP/lhfb.env"; write_env "$EF" "https://carup-backend-staging.vercel.app" true false
run "$EF" 0 fs --verify-only
expect "5b. localhost-api fallback enabled rejected" fail "$CODE"

# 6. Low disk.
EF="$TMP/valid6.env"; write_env "$EF" "https://carup-backend-staging.vercel.app" false false
run "$EF" 99999999 fs --verify-only
expect "6. low disk rejected" fail "$CODE"

# 7. Unresolved dependency.
EF="$TMP/valid7.env"; write_env "$EF" "https://carup-backend-staging.vercel.app" false false
run "$EF" 0 "__no_such_module_zzz__" --verify-only
expect "7. unresolved dependency rejected" fail "$CODE"

# 8. Verify-only success — passes AND does not start Expo.
EF="$TMP/valid8.env"; write_env "$EF" "https://carup-backend-staging.vercel.app" false false
run "$EF" 0 fs --verify-only
expect "8. verify-only success" pass "$CODE"
if printf '%s' "$OUT" | grep -q "Starting Expo"; then
  echo "NOT OK - 8b. verify-only must NOT start Expo"; FAIL=$((FAIL+1))
else
  echo "ok     - 8b. verify-only did not start Expo"; PASS=$((PASS+1))
fi

# 9. Verify-only failure (bad prereq under --verify-only returns non-zero).
EF="$TMP/valid9.env"; write_env "$EF" "https://localhost:9999" false false
run "$EF" 0 fs --verify-only
expect "9. verify-only failure returns non-zero" fail "$CODE"

# 10. No secret output — a token in the URL query and an extra secret line must
#     never appear in the launcher's output.
EF="$TMP/secret.env"
{
  echo "EXPO_PUBLIC_API_URL=https://carup-backend-staging.vercel.app/?token=$SENTINEL"
  echo "EXPO_PUBLIC_ALLOW_LOCALHOST_API=false"
  echo "EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK=false"
  echo "SESSION_SECRET=$SENTINEL"
} > "$EF"
run "$EF" 0 fs --verify-only
expect "10. secret-bearing env still validates" pass "$CODE"
if printf '%s' "$OUT" | grep -q "$SENTINEL"; then
  echo "NOT OK - 10b. secret value leaked to output"; FAIL=$((FAIL+1))
else
  echo "ok     - 10b. no secret value in output"; PASS=$((PASS+1))
fi

echo "-----------------------------------------------------------"
echo "TOTAL: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
