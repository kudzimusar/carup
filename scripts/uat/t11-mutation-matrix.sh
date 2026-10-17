#!/usr/bin/env bash
# Trade OS T11.17 — the mutation matrix.
#
# Every guard T11 adds is broken on purpose, and a NAMED gate must go red. A guard nobody can break
# is a guard nobody has tested: three separate checks in T10 turned out to be unable to see what they
# claimed, and each was found this way and no other.
#
# Each mutation edits a file, runs one suite, and restores the file. Run from the repository root.
#
#   bash scripts/uat/t11-mutation-matrix.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

SHIP=backend/services/diaspora/diasporaShipmentService.js
AUTH=backend/services/diaspora/diasporaAuthorization.js
TRACK=backend/services/diaspora/shipmentTrackingService.js
WORKSPACE=web/src/pages/diaspora/ShipmentTimelineWorkspace.tsx
DISPLAY=web/src/pages/diaspora/trackingDisplay.ts
MIGRATION=database/migrations/20260915090000_trade_os_t11_timeline_append_only.sql

BACKEND_ENV="NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-role-key SUPABASE_ANON_KEY=test-anon-key JWT_SECRET=test-jwt-secret ALLOW_OCR_MOCK=true"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0; n=0

run_backend() {
  eval "$BACKEND_ENV" node --test "$@" 2>&1 | grep -E "^# fail" | awk '{print $3}'
}
# Runs the web suite and answers "how many failures", where "the suite never ran" counts as a
# failure of the RUNNER, not a pass.
#
# The first version of this passed `--reporter=basic`, which this vitest does not have. It died
# loading the reporter, ran zero tests, and exited 0 — so every web mutation "survived" while
# actually never being tested at all. That is exactly the defect this matrix exists to find, in the
# matrix itself. It now requires a "Tests N passed" line to be present before it will believe a run.
run_web() {
  local out; out="$(cd web && npx vitest run "$@" 2>&1)"
  if ! grep -qE "^ *Tests +[0-9]+ (passed|failed)" <<<"$out"; then
    echo "RUNNER-BROKE"; return
  fi
  grep -cE "^ *(FAIL|×|✗)" <<<"$out" || true
}
run_db() {
  node database/test/trade_os_t11_timeline_check.mjs >/dev/null 2>&1; echo $?
}

# mutate <name> <file> <perl-expr> <runner> <args...>
mutate() {
  local name="$1" file="$2" expr="$3" runner="$4"; shift 4
  n=$((n + 1))
  cp "$file" "$TMP/orig"
  perl -0pi -e "$expr" "$file"
  if cmp -s "$file" "$TMP/orig"; then
    cp "$TMP/orig" "$file"
    printf '  %-2s SKIPPED  %s\n' "$n" "$name — the mutation matched nothing; the code has moved"
    fail=$((fail + 1)); return
  fi
  local out; out="$($runner "$@")"
  cp "$TMP/orig" "$file"
  if [ "${out:-0}" != "0" ]; then
    printf '  %-2s RED      %s\n' "$n" "$name"
    pass=$((pass + 1))
  else
    printf '  %-2s SURVIVED %s\n' "$n" "$name"
    fail=$((fail + 1))
  fi
}

T11_BACKEND="backend/tests/trade-os-t11-shipment-authority.test.js backend/tests/trade-os-t11-tracking.test.js"

echo "── the observed time ──"
mutate "the timeline goes back to the unvalidated metadata path" "$SHIP" \
  's/\{ \.\.\.\(payload\.metadata \|\| \{\}\), event_time: observedAt \}/(payload.metadata || {})/' \
  run_backend $T11_BACKEND
mutate "the arrival column stamps now instead of what was observed" "$SHIP" \
  's/actual_arrival_date: observedAt/actual_arrival_date: now/' \
  run_backend $T11_BACKEND
mutate "a movement may be dated in the future" "$SHIP" \
  's/if \(when\.getTime\(\) > Date\.parse\(now\) \+ 60_000\) \{/if (false) {/' \
  run_backend $T11_BACKEND
mutate "only event_time is validated, as it was before" "$SHIP" \
  's/const stated = payload\.event_time\n    \|\| payload\.metadata\?\.event_time/const stated = payload.event_time/' \
  run_backend $T11_BACKEND

echo "── the order of events ──"
mutate "an observation may precede the movement before it" "$SHIP" \
  's/  assertObservationIsNotBackdated\(observedAt, await lastObservedMovement\(id\)\);\n//' \
  run_backend $T11_BACKEND
mutate "the creation record is counted as a movement" "$SHIP" \
  's/\.find\(\(e\) => !e\?\.metadata\?\.created\)/[0]/' \
  run_backend $T11_BACKEND
mutate "the timeline may be rewound to an earlier stage" "$SHIP" \
  's/  if \(to < from\) \{/  if (false) {/' \
  run_backend $T11_BACKEND

echo "── who may move a shipment ──"
mutate "the container is not consulted for authority" "$SHIP" \
  's/  if \(containerId\) \{/  if (false) {/' \
  run_backend $T11_BACKEND
mutate "any container grants authority, not the shipment's own" "$SHIP" \
  's/if \(container && isSailingOperator\(container, context\)\) return;/if (container) return;/' \
  run_backend $T11_BACKEND
mutate "the coordinator of a sailing is not its operator" "$AUTH" \
  's/  if \(coordinator && userId && coordinator === userId\) return true;\n//' \
  run_backend $T11_BACKEND
mutate "sailing-operator authority stops being scoped by tenant" "$AUTH" \
  's/return isPlatformAdmin\(userContext\) \|\| isPlatformReviewer\(userContext\) \|\| isTenantAdminForRecord\(container, userContext\);\n\}/return true;\n}/' \
  run_backend $T11_BACKEND

echo "── a shipment must come from a load ──"
mutate "an unfinished load is good enough to sail" "$SHIP" \
  "s/'COMPLETED'/'IN_PROGRESS'/" \
  run_backend $T11_BACKEND

echo "── the T12 firewall ──"
mutate "a movement action writes a customs purchase status again" "$SHIP" \
  's/const SHIPMENT_TO_IMPORT_STATUS = Object\.freeze\(\{/const SHIPMENT_TO_IMPORT_STATUS = Object.freeze({\n  CUSTOMS_HOLD: IMPORT_ORDER_STATUSES.CUSTOMS_IN_PROGRESS,\n  RELEASED: IMPORT_ORDER_STATUSES.RELEASED,/' \
  run_backend $T11_BACKEND
mutate "the operator screen offers to record a customs release" "$WORKSPACE" \
  "s/hint: string \}> = \[/hint: string }> = [\n  { value: 'RELEASED', label: 'Released', hint: 'Released.' },\n  { value: 'COMPLETED', label: 'Completed', hint: 'Completed.' },/" \
  run_web src/pages/diaspora/ShipmentTimelineWorkspace.test.tsx
mutate "a customs hold is worded as a customs decision" "$DISPLAY" \
  "s/CUSTOMS_HOLD: 'Held at customs'/CUSTOMS_HOLD: 'Cleared customs'/" \
  run_web src/pages/diaspora/trackingDisplay.test.ts

echo "── what a page is allowed to claim ──"
mutate "a plan in the past reads as a departure" "$DISPLAY" \
  "s/      headline: 'Not recorded as departed',\n      detail: /      headline: 'Departed',\n      detail: /" \
  run_web src/pages/diaspora/trackingDisplay.test.ts
mutate "a participant not in the load is shown the journey anyway" "$TRACK" \
  's/state: TRACKING_STATES\.NOT_LOADED,/state: TRACKING_STATES.IN_TRANSIT,/' \
  run_backend $T11_BACKEND

echo "── the database keeps the history ──"
mutate "the append-only guard is dropped from the migration" "$MIGRATION" \
  's/^CREATE TRIGGER trg_shipment_stage_event_guard/-- CREATE TRIGGER trg_shipment_stage_event_guard/m' \
  run_db
mutate "stage events become hard-deletable" "$MIGRATION" \
  's/^CREATE TRIGGER trg_shipment_stage_event_no_delete/-- CREATE TRIGGER trg_shipment_stage_event_no_delete/m' \
  run_db

echo
echo "{\"mutations\":$n,\"red\":$pass,\"survived\":$fail,\"ok\":$([ "$fail" -eq 0 ] && echo true || echo false)}"
[ "$fail" -eq 0 ]
