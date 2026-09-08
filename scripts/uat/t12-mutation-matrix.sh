#!/usr/bin/env bash
# Trade OS T12 — the mutation matrix.
#
# The fifteen mutations the owner named, plus the ones this phase's own defects earned a place for.
# Each breaks a guard on purpose; a NAMED gate must go red.
#
# The T11 matrix found two defects in ITSELF — a reporter flag that made vitest run zero tests and
# exit 0, and an expression that silently matched nothing. Both lessons are built in here: the web
# runner refuses to believe a run without a "Tests N passed" line, and a mutation that changes no
# bytes is reported SKIPPED rather than counted as a pass.
#
#   bash scripts/uat/t12-mutation-matrix.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

CASE=backend/services/diaspora/customsCaseService.js
PROJ=backend/services/diaspora/customsProjectionService.js
DOCINTEL=backend/services/document-intelligence/documentIntelligenceService.js
TRUST=backend/services/trustGraph/trustGraphService.js
DISPLAY=web/src/pages/diaspora/customsDisplay.ts
WORKSPACE=web/src/pages/diaspora/CustomsDestinationWorkspace.tsx
SHIP=backend/services/diaspora/diasporaShipmentService.js
MIGRATION=database/migrations/20260917090000_trade_os_t12_customs_destination.sql

BACKEND_ENV="NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-role-key SUPABASE_ANON_KEY=test-anon-key JWT_SECRET=test-jwt-secret ALLOW_OCR_MOCK=true"
T12_BACKEND="backend/tests/trade-os-t12-customs-authority.test.js backend/tests/trade-os-t12-registry-authority.test.js"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0; n=0

run_backend() { eval "$BACKEND_ENV" node --test "$@" 2>&1 | grep -E "^# fail" | awk '{print $3}'; }
run_web() {
  local out; out="$(cd web && npx vitest run "$@" 2>&1)"
  if ! grep -qE "^ *Tests +[0-9]+ (passed|failed)" <<<"$out"; then echo "RUNNER-BROKE"; return; fi
  grep -cE "^ *(FAIL|×|✗)" <<<"$out" || true
}
run_db() { node database/test/trade_os_t12_customs_check.mjs >/dev/null 2>&1; echo $?; }

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
  if [ "${out:-0}" != "0" ]; then printf '  %-2s RED      %s\n' "$n" "$name"; pass=$((pass + 1))
  else printf '  %-2s SURVIVED %s\n' "$n" "$name"; fail=$((fail + 1)); fi
}

echo "── 1-2 · the forgery comes back ──"
mutate "OCR approval writes a ZIMRA declaration again" "$DOCINTEL" \
  "s/      const timestamp = new Date\(\)\.toISOString\(\);/      const timestamp = new Date().toISOString();\n      if (ocrDoc.document_type === 'customs_declaration') { await supabase.from('zimra_declarations').insert({ vin }); }/" \
  run_backend $T12_BACKEND
mutate "OCR approval writes a CVR ownership record again" "$DOCINTEL" \
  "s/      const timestamp = new Date\(\)\.toISOString\(\);/      const timestamp = new Date().toISOString();\n      if (ocrDoc.document_type === 'registration_book') { await supabase.from('cvr_ownership_records').insert({ vin }); }/" \
  run_backend $T12_BACKEND

echo "── 3-4 · the client clears its own goods ──"
mutate "the client self-clears — the importer may assert anything" "$CASE" \
  "s/  if \(!WHO_MAY_ASSERT\[eventType\]\.includes\(relationship\)\) \{/  if (false) {/" \
  run_backend $T12_BACKEND
mutate "the client sets a ZIMRA assessment" "$CASE" \
  "s/  ASSESSMENT_EVIDENCE_RECEIVED: \['APPOINTED_CLEARING_AGENT', 'CONTAINER_OPERATOR'/  ASSESSMENT_EVIDENCE_RECEIVED: ['IMPORTER', 'APPOINTED_CLEARING_AGENT', 'CONTAINER_OPERATOR'/" \
  run_backend $T12_BACKEND

echo "── 5 · unknown becomes zero ──"
mutate "an unassessed duty renders as zero" "$PROJ" \
  "s/      amount: null,\n      currency: null,\n      headline: 'Not yet assessed',/      amount: 0,\n      currency: 'USD',\n      headline: 'Duty: 0',/" \
  run_backend $T12_BACKEND
mutate "an absent amount is defaulted, the way the forgery defaulted 50000" "$CASE" \
  "s/  if \(value === undefined \|\| value === null \|\| String\(value\)\.trim\(\) === ''\) return null;\n  const n = Number\(value\);\n  if \(!Number\.isFinite\(n\) \|\| n < 0\)/  if (value === undefined || value === null || String(value).trim() === '') return 50000;\n  const n = Number(value);\n  if (!Number.isFinite(n) || n < 0)/" \
  run_backend $T12_BACKEND

echo "── 6 · an agent report renders as an authority fact ──"
mutate "an agent-typed amount is headlined as the assessment" "$PROJ" \
  "s/    headline: isAuthority \? 'Assessment amount' : 'Agent-reported amount',/    headline: 'Assessment amount',/" \
  run_backend $T12_BACKEND
mutate "an attributed claim drops the attribution from its sentence" "$PROJ" \
  "s/    \? \`\\\$\{base\.charAt\(0\)\.toUpperCase\(\)\}\\\$\{base\.slice\(1\)\}\.\`\n    : \`\\\$\{wording\.prefix\} \\\$\{base\}\.\`;/    ? \`\\\${base.charAt(0).toUpperCase()}\\\${base.slice(1)}.\`\n    : \`\\\${base.charAt(0).toUpperCase()}\\\${base.slice(1)}.\`;/" \
  run_backend $T12_BACKEND

echo "── 7 · T6 reference FX becomes customs FX ──"
mutate "a rate no longer needs a source" "$CASE" \
  "s/    if \(!payload\.customs_rate_source\) throw new ValidationError\('A customs exchange rate must name its source\. A rate with no source is a fabrication\.'\);//" \
  run_backend $T12_BACKEND
mutate "a rate no longer needs an effective date" "$CASE" \
  "s/    if \(!payload\.customs_rate_effective_from\) throw new ValidationError\('A customs exchange rate must state the date it takes effect\. ZIMRA publishes these for a stated period\.'\);//" \
  run_backend $T12_BACKEND

echo "── 8-9 · presence becomes proof ──"
mutate "document presence becomes release" "$PROJ" \
  "s/  { key: 'RELEASE', label: 'Release', satisfiedBy: \['RELEASE_EVIDENCE_RECEIVED'\]/  { key: 'RELEASE', label: 'Release', satisfiedBy: ['RELEASE_EVIDENCE_RECEIVED', 'DOCUMENT_PROVIDED']/" \
  run_backend $T12_BACKEND
mutate "a payment receipt becomes a confirmed payment" "$PROJ" \
  "s/    headline: 'Payment evidence received',/    headline: 'Duty paid',/" \
  run_backend $T12_BACKEND
mutate "an authority claim no longer needs its document" "$CASE" \
  "s/  if \(sourceKind === 'AUTHORITY_DOCUMENT' && !evidenceDocumentId\) \{/  if (false) {/" \
  run_backend $T12_BACKEND

echo "── 10-11 · authority and privacy ──"
mutate "a foreign agent succeeds — any appointment confers authority" "$CASE" \
  "s/  if \(appointment && userId && String\(appointment\.agent_user_id \|\| ''\) === userId\) \{/  if (appointment) {/" \
  run_backend $T12_BACKEND
mutate "an ENDED appointment still confers authority" "$CASE" \
  "s/\.eq\('case_id', kase\.id\)\.eq\('status', 'ACTIVE'\)\.is\('deleted_at', null\)\.maybeSingle\(\);/.eq('case_id', kase.id).is('deleted_at', null).maybeSingle();/" \
  run_backend $T12_BACKEND
mutate "a co-loader reads another participant's case" "$PROJ" \
  "s/  if \(!owns\) \{/  if (false) {/" \
  run_backend $T12_BACKEND

echo "── 12-13 · the phase boundaries ──"
mutate "T12 rewrites T11 movement — the coupling comes back" "$SHIP" \
  's/const SHIPMENT_TO_IMPORT_STATUS = Object\.freeze\(\{/const SHIPMENT_TO_IMPORT_STATUS = Object.freeze({\n  RELEASED: IMPORT_ORDER_STATUSES.RELEASED,/' \
  run_backend backend/tests/trade-os-t11-shipment-authority.test.js
mutate "T12 writes a vehicle authority record" "$CASE" \
  "s/const EVENTS = 'diaspora_customs_events';/const EVENTS = 'diaspora_customs_events';\nconst CVR = 'cvr_ownership_records';/" \
  run_backend $T12_BACKEND

echo "── 14-15 · cargo kind and the destination handoffs ──"
mutate "general cargo is forced through the vehicle flow" "$PROJ" \
  "s/    vehicle: kase\.cargo_kind !== 'VEHICLE' \? null : \{/    vehicle: false ? null : {/" \
  run_backend $T12_BACKEND
mutate "a gateway arrival becomes the final delivery" "$PROJ" \
  "s/    delivered_at: at\(delivery\),/    delivered_at: at(delivery) || at(gateway),/" \
  run_backend $T12_BACKEND
mutate "the destination collapses into the gateway" "$PROJ" \
  "s/      arrived_at: at\(destination\), observed: Boolean\(destination\),/      arrived_at: at(destination) || at(gateway), observed: Boolean(destination || gateway),/" \
  run_backend $T12_BACKEND

echo "── the surfaces ──"
mutate "the operator screen offers to declare the goods cleared" "$DISPLAY" \
  "s/export const RECORDABLE_CUSTOMS_EVENTS: Array<\{ value: string; label: string; hint: string; needsSource: boolean \}> = \[/export const RECORDABLE_CUSTOMS_EVENTS: Array<{ value: string; label: string; hint: string; needsSource: boolean }> = [\n  { value: 'CLEARED', label: 'Cleared', hint: 'Cleared.', needsSource: false },/" \
  run_web src/pages/diaspora/customsDisplay.test.ts
mutate "an unassessed duty is displayed as a dash" "$DISPLAY" \
  "s/      amount: 'Not yet assessed',/      amount: '—',/" \
  run_web src/pages/diaspora/customsDisplay.test.ts
mutate "a licence reference is presented as verified" "$DISPLAY" \
  "s/export const LICENCE_UNVERIFIED =\n  'CarUp has not verified this licence reference with the authority\. It is what the appointing party supplied\.'/export const LICENCE_UNVERIFIED =\n  'Licensed clearing agent, verified.'/" \
  run_web src/pages/diaspora/customsDisplay.test.ts
mutate "an unsourced customs rate is shown anyway" "$DISPLAY" \
  "s/      headline: 'Customs exchange rate: not recorded',/      headline: 'Customs exchange rate 13.5',/" \
  run_web src/pages/diaspora/customsDisplay.test.ts

echo "── the database ──"
mutate "the authority-claim constraint is dropped" "$MIGRATION" \
  "s/  CONSTRAINT customs_event_authority_claim_needs_evidence CHECK \(\n    source_kind <> 'AUTHORITY_DOCUMENT' OR evidence_document_id IS NOT NULL\n  \)/  CONSTRAINT customs_event_authority_claim_needs_evidence CHECK (true)/" \
  run_db
mutate "the rate-provenance constraint is dropped" "$MIGRATION" \
  "s/  CONSTRAINT customs_event_rate_has_provenance CHECK \(\n    customs_rate_value IS NULL\n    OR \(customs_rate_source IS NOT NULL AND customs_rate_effective_from IS NOT NULL\)\n  \)/  CONSTRAINT customs_event_rate_has_provenance CHECK (true)/" \
  run_db
mutate "the append-only guard is dropped" "$MIGRATION" \
  "s/^CREATE TRIGGER trg_customs_event_guard/-- CREATE TRIGGER trg_customs_event_guard/m" \
  run_db
mutate "customs events become hard-deletable" "$MIGRATION" \
  "s/^CREATE TRIGGER trg_customs_event_no_delete/-- CREATE TRIGGER trg_customs_event_no_delete/m" \
  run_db
mutate "a vehicle-registration event type is added to the vocabulary" "$MIGRATION" \
  "s/    'DELIVERY_OBSERVED'\n  \)\),/    'DELIVERY_OBSERVED',\n    'VEHICLE_REGISTRATION'\n  )),/" \
  run_db

echo
echo "{\"mutations\":$n,\"red\":$pass,\"survived\":$fail,\"ok\":$([ "$fail" -eq 0 ] && echo true || echo false)}"
[ "$fail" -eq 0 ]
