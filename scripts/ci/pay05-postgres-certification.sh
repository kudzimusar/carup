#!/usr/bin/env bash
# CARUP-PAY-05-LR01 — disposable PostgreSQL certification of the PAY-05 Paynow migration on the integrated
# Payments + Garage + PAY-04 schema, in both orders a real database can receive the lineages (payments-first,
# garage-first). It reuses every step of scripts/ci/pay04-postgres-certification.sh verbatim (sourced as a library,
# with the same refusals: a local disposable pay01c_sandbox_ci only, never staging, never production, never 54322).
#
#   Phase 1 (upgrade)    lineages + certified PAY smokes + OPS07 history -> PAY-04 -> PAY-04 smokes (real PAY-04 money:
#                        collections, allocations, receipts, discrepancies) -> fingerprint -> PAY-05 -> fingerprint must be
#                        unchanged: PAY-05 rewrites no row of OPS07, the canonical ledger or PAY-04.
#                        PAY-05's own writers then make real rows -> fingerprint -> R1 -> fingerprint must be unchanged.
#   Phase 2 (behaviour)  lineages -> PAY-04 -> PAY-05 -> R1 -> the certified PAY smokes and the PAY-04 smokes (they must still
#                        pass on the replaced functions) -> the PAY-05 smoke -> the R1 smoke.
set -euo pipefail
mode="${1:-}"
PAY04_CERT_LIBRARY=1
# shellcheck source=scripts/ci/pay04-postgres-certification.sh
. "$(cd "$(dirname "$0")" && pwd)/pay04-postgres-certification.sh" "$mode"

pay05_chain() {
  echo '== PAY-05 migration'
  apply 20261103100000_carup_pay05_zimbabwe_paynow_collections.sql
}

pay05_r1_chain() {
  echo '== PAY-05-R1 migration'
  apply 20261104100000_carup_pay05_r1_financial_integrity.sql
}

# The money PAY-05 itself wrote: R1 rewrites none of it (columns R1 added are outside this list by design).
pay05_fingerprint() {
  psql -X -At <<'SQL'
SELECT md5(concat_ws('#',
  (SELECT string_agg(concat_ws('|', o.seq, o.collection_id, o.via, o.provider_status, o.amount_minor, o.outcome), ',' ORDER BY o.seq) FROM public.pay05_paynow_observations o),
  (SELECT string_agg(concat_ws('|', t.collection_id, t.initiation_state, t.provider_status, t.hold_released_at, t.settled_off_platform_at), ',' ORDER BY t.collection_id) FROM public.pay05_paynow_transactions t),
  (SELECT string_agg(concat_ws('|', i.id, i.status, i.currency, i.integration_id, i.credential_fingerprint), ',' ORDER BY i.id) FROM public.pay05_merchant_integrations i)
));
SQL
}

pay04_fingerprint() {
  psql -X -At <<'SQL'
SELECT md5(concat_ws('#',
  (SELECT string_agg(to_jsonb(m)::text, ',' ORDER BY m.id) FROM public.pay04_garage_merchant_accounts m),
  (SELECT string_agg(to_jsonb(c)::text, ',' ORDER BY c.id) FROM public.pay04_garage_collections c),
  (SELECT string_agg(to_jsonb(a)::text, ',' ORDER BY a.seq) FROM public.pay04_garage_payment_allocations a),
  (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.pay04_garage_provider_receipts r),
  (SELECT string_agg(to_jsonb(e)::text, ',' ORDER BY e.seq) FROM public.pay04_garage_collection_events e),
  (SELECT string_agg(to_jsonb(d)::text, ',' ORDER BY d.id) FROM public.pay04_garage_payment_discrepancies d),
  (SELECT string_agg(concat_ws('|', m.invoice_id::text, m.paid_amount::text, m.provider_reserved::text, m.uncommitted_balance::text,
     m.payment_status), ',' ORDER BY m.invoice_id)
   FROM public.garage_invoices i CROSS JOIN LATERAL public.pay04_invoice_money(i.id) m)
));
SQL
}

echo "#### Phase 1 ($mode): upgrade — PAY-05 rewrites no OPS07, canonical-ledger or PAY-04 row"
reset_db
lineages with-pay-smokes
pay04_chain
run_sql pay04-garage-invoice-integrity-postgres-smoke.sql
run_sql pay04-garage-provider-payments-postgres-smoke.sql
before="$(fingerprint)/$(pay04_fingerprint)"
pay05_chain
after="$(fingerprint)/$(pay04_fingerprint)"
[ "$before" = "$after" ] || fail "PAY-05 rewrote OPS07, canonical-ledger or PAY-04 rows ($before != $after)."
echo "OPS07, canonical payments, PAY-04 money and derived balances preserved across PAY-05: $after"
# R1 on a database holding real PAY-05 rows made by PAY-05's own writers: it applies, and rewrites nothing.
run_sql pay05-r1-upgrade-seed.sql
before_r1="$(fingerprint)/$(pay04_fingerprint)/$(pay05_fingerprint)"
pay05_r1_chain
after_r1="$(fingerprint)/$(pay04_fingerprint)/$(pay05_fingerprint)"
[ "$before_r1" = "$after_r1" ] || fail "PAY-05-R1 rewrote OPS07, canonical-ledger, PAY-04 or PAY-05 rows ($before_r1 != $after_r1)."
echo "OPS07, canonical payments, PAY-04 and PAY-05 money preserved across PAY-05-R1: $after_r1"
run_sql pay05-r1-upgrade-check.sql

echo "#### Phase 2 ($mode): behaviour — certified PAY and PAY-04 smokes on the PAY-05 functions, then the PAY-05 smoke"
reset_db
lineages
pay04_chain
pay05_chain
pay05_r1_chain
pay_smokes 'after PAY-04, PAY-05 and R1 (the F5 and PAY-04 extensions must regress nothing)'
echo '== PAY-04 smokes (on the PAY-05-replaced functions)'
run_sql pay04-garage-invoice-integrity-postgres-smoke.sql
run_sql pay04-garage-provider-payments-postgres-smoke.sql
echo '== PAY-05 smoke'
run_sql pay05-paynow-collections-postgres-smoke.sql
echo '== PAY-05-R1 smoke'
run_sql pay05-r1-financial-integrity-postgres-smoke.sql
echo "PAY05_POSTGRES_CERTIFICATION_PASS ($mode)"
