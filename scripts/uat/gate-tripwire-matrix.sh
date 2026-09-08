#!/usr/bin/env bash
# Deployed-staging gate — tripwire matrix.
#
# An integration gate has to prove TWO things, and they are different:
#   · its INFRASTRUCTURE works — it refuses an ungoverned or stale pairing;
#   · its PRODUCT ASSERTIONS MATTER — weakening one turns a suite red.
#
# The first six break the pairing resolver. The last three weaken a real assertion in the security,
# T5 and T2 suites and require the corresponding gate to notice.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

RESOLVER=scripts/ci/resolve-governed-preview-pair.mjs
SEC=tests/agents/34-diaspora-staging-browser-security.spec.ts
T5=tests/agents/45-trade-os-container-demo-staging.spec.ts
T2=tests/agents/46-trade-os-rfq2-staging.spec.ts

ENVV="NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-role-key SUPABASE_ANON_KEY=test-anon-key JWT_SECRET=test-jwt-secret ALLOW_OCR_MOCK=true"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0; n=0

run_resolver() { eval "$ENVV" node --test backend/tests/ci-governed-preview-pair.test.js 2>&1 | grep -E "^# fail" | awk '{print $3}'; }
# A weakened deployed assertion is proved by TYPE-CHECKING plus the suite's own compile gate: the
# specs run against deployed staging, which this matrix must not do concurrently (see the
# remediation record §8). So the assertion mutations are proved by a grep-gate that the CI job
# itself runs, not by a second live browser run racing the first.
run_assertion_guard() { node scripts/ci/assert-gate-assertions-intact.mjs >/dev/null 2>&1; echo $?; }

mutate() {
  local name="$1" file="$2" expr="$3" runner="$4"
  n=$((n + 1)); cp "$file" "$TMP/orig"; perl -0pi -e "$expr" "$file"
  if cmp -s "$file" "$TMP/orig"; then cp "$TMP/orig" "$file"
    printf '  %-2s SKIPPED  %s\n' "$n" "$name — matched nothing"; fail=$((fail + 1)); return; fi
  local out; out="$($runner)"; cp "$TMP/orig" "$file"
  if [ "${out:-0}" != "0" ]; then printf '  %-2s RED      %s\n' "$n" "$name"; pass=$((pass + 1))
  else printf '  %-2s SURVIVED %s\n' "$n" "$name"; fail=$((fail + 1)); fi
}

echo "── infrastructure: the pairing must be governed ──"
mutate "the pairing manifest is missing"        "$RESOLVER" 's/  if \(!frontend \|\| !backend\) \{/  if (false) {/'                                          run_resolver
mutate "FE\/BE SHA mismatch is tolerated"        "$RESOLVER" 's/if \(provenance\.commit_sha !== sha\)/if (false)/'                                            run_resolver
mutate "a stale BACKEND is tolerated"            "$RESOLVER" 's/if \(backendSha !== sha\)/if (false)/'                                                        run_resolver
mutate "unpaired:true is tolerated"              "$RESOLVER" 's/if \(provenance\.unpaired !== false\)/if (provenance.unpaired === true)/'                     run_resolver
mutate "a PRODUCTION origin is accepted"         "$RESOLVER" 's/const PRODUCTION_MARKERS = \[/const PRODUCTION_MARKERS = []; const UNUSED = [/'               run_resolver
mutate "the frontend may call ANY backend"       "$RESOLVER" 's/if \(strip\(provenance\.api_base_url\) !== strip\(backend\)\)/if (false)/'                    run_resolver

echo "── the product assertions must matter ──"
# Deleting the no-payload assertion is the real weakening: a bare 404 would then satisfy the denial
# probe on its own, which is exactly what "404 is never authorization evidence" forbids.
mutate "a SECURITY assertion is weakened"        "$SEC" 's/      expect\(body, `\$\{p\} must not leak record data`\)\.not\.toMatch\([^\n]*\n//'                run_assertion_guard
mutate "a T5 invariant is weakened"              "$T5"  "s/'diaspora-container-capacity-line'\)\)\.toContainText/'diaspora-container-capacity-line')).not.toContainText/" run_assertion_guard
mutate "a T2 authority assertion is weakened"    "$T2"  "s/expect\(createdRes\.status\(\)\)\.toBe\(201\)/expect([200, 201, 202]).toContain(createdRes.status())/" run_assertion_guard

echo
echo "{\"mutations\":$n,\"red\":$pass,\"survived\":$fail,\"ok\":$([ "$fail" -eq 0 ] && echo true || echo false)}"
[ "$fail" -eq 0 ]
