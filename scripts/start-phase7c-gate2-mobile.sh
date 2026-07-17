#!/usr/bin/env bash
#
# CarUp — Phase 7C Gate 2 mobile launcher.
#
# Prepares and starts the CarUp mobile app for the Phase 7C owner physical-device
# verification test. It is safe-by-default: it refuses to run against anything other
# than a deployed staging backend, never overwrites an existing mobile/.env.local,
# and never prints secrets or the contents of the env file.
#
# Usage:
#   ./scripts/start-phase7c-gate2-mobile.sh              # LAN start (default)
#   ./scripts/start-phase7c-gate2-mobile.sh --tunnel     # Expo tunnel fallback
#   ./scripts/start-phase7c-gate2-mobile.sh --verify-only # run all checks, do not start Expo
#   ./scripts/start-phase7c-gate2-mobile.sh --help
#
# Exit codes: 0 = success; non-zero = an unmet prerequisite (each failure is fatal).
#
# Testability / overrides (all optional; used by the shell verification script and
# for non-standard environments — never required in normal owner use):
#   PHASE7C_GATE2_MIN_FREE_MB       Minimum free disk in MB (default 2500).
#   PHASE7C_GATE2_ENV_FILE          Path to the env file to create/validate
#                                   (default: <repo>/mobile/.env.local).
#   PHASE7C_GATE2_REQUIRE_MODULES   Space-separated module specifiers to resolve
#                                   (default: the four Gate 2 critical modules).
#   PHASE7C_GATE2_SKIP_INSTALL      If "true", skip the focused install step.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Output helpers. Fatal errors always exit non-zero.
# ---------------------------------------------------------------------------
log()  { printf '  %s\n' "$*"; }
info() { printf '\n=== %s ===\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { printf '\nABORT: %s\n' "$*" >&2; exit 1; }

MODE_START=1          # 1 = start Expo, 0 = verify only
EXPO_HOST_MODE="lan"  # lan | tunnel

# ---------------------------------------------------------------------------
# Argument parsing.
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --verify-only) MODE_START=0 ;;
    --tunnel)      EXPO_HOST_MODE="tunnel" ;;
    --lan)         EXPO_HOST_MODE="lan" ;;
    -h|--help)
      sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $arg (see --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# 1 + 2. Locate and confirm the CarUp repository (works from root or mobile/).
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

is_carup_repo() {
  # A CarUp monorepo checkout has a root package.json named "carup-monorepo"
  # and a mobile/ workspace with an Expo entrypoint.
  local root="$1"
  [ -f "$root/package.json" ] || return 1
  [ -d "$root/mobile" ] || return 1
  node -e 'const p=require(process.argv[1]);process.exit(p.name==="carup-monorepo"?0:1)' \
    "$root/package.json" 2>/dev/null || return 1
  return 0
}

if ! is_carup_repo "$REPO_ROOT"; then
  # Allow invocation from an arbitrary CWD inside the repo (e.g. mobile/).
  if git -C "$PWD" rev-parse --show-toplevel >/dev/null 2>&1; then
    CANDIDATE="$(git -C "$PWD" rev-parse --show-toplevel)"
    if is_carup_repo "$CANDIDATE"; then REPO_ROOT="$CANDIDATE"; fi
  fi
fi
is_carup_repo "$REPO_ROOT" || die "not inside the CarUp monorepo (expected a root package.json named 'carup-monorepo' and a mobile/ workspace)."

MOBILE_DIR="$REPO_ROOT/mobile"
ENV_FILE="${PHASE7C_GATE2_ENV_FILE:-$MOBILE_DIR/.env.local}"
info "Phase 7C Gate 2 launcher"
log "repo:   $REPO_ROOT"
log "mobile: $MOBILE_DIR"
log "mode:   $([ "$MODE_START" -eq 1 ] && echo "start ($EXPO_HOST_MODE)" || echo "verify-only")"

# ---------------------------------------------------------------------------
# 3 + 4 + 5. Free-disk check before any installation.
# ---------------------------------------------------------------------------
MIN_FREE_MB="${PHASE7C_GATE2_MIN_FREE_MB:-2500}"
info "Disk space"
FREE_MB="$(df -m "$REPO_ROOT" | awk 'NR==2 {print $4}')"
[ -n "$FREE_MB" ] || die "could not determine free disk space."
log "free: ${FREE_MB} MB  (required: ${MIN_FREE_MB} MB)"
if [ "$FREE_MB" -lt "$MIN_FREE_MB" ]; then
  die "insufficient free disk: ${FREE_MB} MB < ${MIN_FREE_MB} MB. Free space or lower PHASE7C_GATE2_MIN_FREE_MB only if you understand the risk."
fi
log "disk OK"

# ---------------------------------------------------------------------------
# 6 + 7. Create mobile/.env.local ONLY when missing; never overwrite.
# ---------------------------------------------------------------------------
info "Environment file"
if [ -f "$ENV_FILE" ]; then
  log "existing env file found — will validate (contents never printed)."
else
  log "no env file — writing a safe template (you must set the staging URL before Gate 2)."
  umask 177
  cat > "$ENV_FILE" <<'TEMPLATE'
# CarUp Phase 7C Gate 2 — mobile environment (git-ignored; never commit).
# Set EXPO_PUBLIC_API_URL to the DEPLOYED STAGING backend URL (https, not localhost).
# Prefilled with the CURRENT release staging backend (branch alias of
# release/phase7c-verification-production). The old PR #72 alias from the
# earlier owner guide is superseded - do not use it.
EXPO_PUBLIC_API_URL=https://carup-backend-staging-git-release-phase-81c126-pay-pass-project.vercel.app
# Safety posture for a physical-device Gate 2 run — keep both disabled.
EXPO_PUBLIC_ALLOW_LOCALHOST_API=false
EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK=false
TEMPLATE
  log "env template written to mobile/.env.local (prefilled with the release staging backend)."
fi

# ---------------------------------------------------------------------------
# 8 + 9 + 10 + 11 + 12. Validate the env file WITHOUT printing its contents.
# Read values in a subshell scoped to this file only; report booleans/host, never values.
# ---------------------------------------------------------------------------
info "Environment validation"

# Extract a single KEY=VALUE from the env file without sourcing it (avoids executing
# arbitrary content) and without echoing the value anywhere.
env_get() {
  local key="$1"
  # Last matching assignment wins; strip surrounding quotes and inline comments.
  grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -1 \
    | sed -E "s/^[[:space:]]*${key}=//; s/[[:space:]]*#.*$//; s/^\"//; s/\"$//; s/^'//; s/'$//" \
    | tr -d '\r'
}

API_URL="$(env_get EXPO_PUBLIC_API_URL || true)"
ALLOW_LOCALHOST="$(env_get EXPO_PUBLIC_ALLOW_LOCALHOST_API || true)"
ALLOW_DEV_FALLBACK="$(env_get EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK || true)"

[ -n "$API_URL" ] || die "EXPO_PUBLIC_API_URL is not set in the env file (required: a deployed staging backend URL)."

case "$API_URL" in
  *REPLACE-WITH-DEPLOYED-STAGING-BACKEND*)
    die "EXPO_PUBLIC_API_URL still holds the placeholder. Set it to the deployed staging backend URL, then re-run." ;;
esac

# Parse scheme + host with pure parameter expansion so no path/query/fragment
# (which may carry tokens) is ever echoed. Only the bare host is logged.
case "$API_URL" in
  *://*) scheme="${API_URL%%://*}" ;;
  *)     die "EXPO_PUBLIC_API_URL is not a valid URL (missing scheme://)." ;;
esac
rest="${API_URL#*://}"      # strip "scheme://"
authority="${rest%%/*}"     # drop path
authority="${authority%%\?*}"  # drop query (may contain a token)
authority="${authority%%#*}"   # drop fragment
host="${authority%%:*}"     # drop :port
[ "$scheme" = "https" ] || die "EXPO_PUBLIC_API_URL must use https (a deployed staging backend). Rejected scheme: '${scheme}'."
case "$host" in
  localhost|127.0.0.1|0.0.0.0|"")
    die "EXPO_PUBLIC_API_URL points at a local/dev host ('${host}'). A physical device needs the deployed staging backend." ;;
esac
log "API host accepted: ${host} (https)"

# 11. Local-development fallbacks must be disabled.
if [ "$ALLOW_LOCALHOST" = "true" ]; then
  die "EXPO_PUBLIC_ALLOW_LOCALHOST_API=true is not allowed for a Gate 2 device run. Set it to false."
fi
if [ "$ALLOW_DEV_FALLBACK" = "true" ]; then
  die "EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK=true is not allowed for a Gate 2 device run. Set it to false."
fi
log "local-development fallbacks disabled (localhost-api=off, dev-user-fallback=off)"

# ---------------------------------------------------------------------------
# 13 + 14. Focused mobile workspace install (low-disk friendly, workspace-preserving).
# Installs from the repo root with the workspace flag so hoisting/resolution is
# preserved; --verify-only and PHASE7C_GATE2_SKIP_INSTALL skip installation.
# ---------------------------------------------------------------------------
if [ "$MODE_START" -eq 1 ] && [ "${PHASE7C_GATE2_SKIP_INSTALL:-false}" != "true" ]; then
  info "Focused mobile install"
  if [ -d "$MOBILE_DIR/node_modules" ] && [ -d "$REPO_ROOT/node_modules" ]; then
    log "workspace already installed — skipping (delete node_modules to force a reinstall)."
  else
    log "installing the mobile workspace (no audit/fund; workspace resolution preserved)…"
    ( cd "$REPO_ROOT" && npm install --workspace mobile --no-audit --no-fund ) \
      || die "focused mobile install failed."
    log "install complete."
  fi
else
  info "Install (skipped)"
  log "verify-only / skip-install mode — not installing."
fi

# ---------------------------------------------------------------------------
# 15. Verify resolution of the Gate 2 critical modules (from the mobile CWD, so
# workspace hoisting is exercised exactly as the app resolves at runtime).
# ---------------------------------------------------------------------------
info "Dependency resolution"
DEFAULT_MODULES="expo-router/entry react-native-web semver/functions/satisfies react-native-reanimated"
REQUIRE_MODULES="${PHASE7C_GATE2_REQUIRE_MODULES:-$DEFAULT_MODULES}"
RESOLVE_FAILED=0
for mod in $REQUIRE_MODULES; do
  if ( cd "$MOBILE_DIR" && node -e 'require.resolve(process.argv[1])' "$mod" ) >/dev/null 2>&1; then
    log "resolved: $mod"
  else
    warn "UNRESOLVED: $mod"
    RESOLVE_FAILED=1
  fi
done
[ "$RESOLVE_FAILED" -eq 0 ] || die "one or more required modules did not resolve (run without --verify-only to install, or check the workspace)."

# ---------------------------------------------------------------------------
# 18. --verify-only stops here (does not start Expo).
# ---------------------------------------------------------------------------
if [ "$MODE_START" -eq 0 ]; then
  info "Verify-only: all prerequisites satisfied"
  log "env valid · disk OK · dependencies resolved. Expo was NOT started."
  exit 0
fi

# ---------------------------------------------------------------------------
# 16 + 17. Start Expo (LAN default; --tunnel fallback).
# ---------------------------------------------------------------------------
info "Starting Expo ($EXPO_HOST_MODE)"
cat <<CLEANUP
  To stop Expo: press Ctrl+C in this terminal.
  Cleanup:
    - stop the dev server with Ctrl+C
    - optional: rm -rf "$MOBILE_DIR/.expo" to clear the local Expo cache
    - your mobile/.env.local is preserved and never committed
CLEANUP
log "launching…"
if [ "$EXPO_HOST_MODE" = "tunnel" ]; then
  ( cd "$MOBILE_DIR" && npx expo start --tunnel )
else
  ( cd "$MOBILE_DIR" && npx expo start --lan )
fi
