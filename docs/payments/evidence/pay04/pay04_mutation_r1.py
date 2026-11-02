#!/usr/bin/env python3
"""CARUP-PAY-04 review remediation — mutation pass.

Each mutant re-introduces ONE fixed defect by an exact string replacement (asserted to occur exactly once), runs the
killer that is supposed to catch it, records KILLED / SURVIVED with the first failing assertion, then restores the file.
Runs ONLY in the detached worktree ~/carup-pay04-mut against the disposable PostgreSQL on 127.0.0.1:55432.
"""
import json, os, subprocess, sys, time

MUT = os.path.expanduser('~/carup-pay04-mut')
OUT = os.path.expanduser('~/carup-launch-evidence/pay04/mutation-r1')
os.makedirs(OUT, exist_ok=True)
PW = subprocess.run(['/usr/local/bin/docker', 'inspect', 'carup-pay03b-sqltest', '--format',
                     '{{range .Config.Env}}{{println .}}{{end}}'], capture_output=True, text=True).stdout
PW = next(l.split('=', 1)[1] for l in PW.splitlines() if l.startswith('POSTGRES_PASSWORD='))
ENV = dict(os.environ, PATH='/opt/homebrew/opt/node@22/bin:' + os.environ['PATH'], PGPASSWORD=PW, PAY04_DISPOSABLE_PG='1',
           PGHOST='127.0.0.1', PGPORT='55432', PGUSER='postgres', PGDATABASE='pay01c_sandbox_ci',
           PAY04_TEST_PGURL=f'postgresql://postgres:{PW}@127.0.0.1:55432/pay01c_sandbox_ci')
PROV = 'database/migrations/20261102110000_carup_pay04_garage_provider_payments.sql'
INTEG = 'database/migrations/20261102100000_carup_pay04_garage_invoice_integrity.sql'
SVC = 'backend/services/payment/pay04GaragePaymentService.js'
INV = 'backend/services/garageOperations/garageInvoiceService.js'
SIM = 'backend/services/payment/pay04GarageSimulator.js'
LIB = 'web/src/lib/pay04GaragePayments.ts'
PANEL = 'web/src/components/garage/hub/ProviderPaymentsPanel.tsx'
PAYUI = 'web/src/components/owner/serviceJourney/InvoicePayment.tsx'
OPS = 'web/src/pages/dashboard/admin/GaragePaymentsOperator.tsx'
WEB_TESTS = ['src/lib/pay04GaragePayments.test.ts', 'src/components/owner/serviceJourney/InvoicePayment.test.tsx',
             'src/components/garage/hub/ProviderPaymentsPanel.test.tsx', 'src/pages/dashboard/admin/GaragePaymentsOperator.test.tsx',
             'src/lib/pay04ProvenanceLabels.test.tsx']

MUTANTS = [
  # ---- database (killer: the integrated certification, payments-first) ----
  ('D01 later provider refund ignored after a final resolution', PROV, 'cert',
   'v_refunded := greatest(verified_minor, coalesce(p_collection.observed_refunded_minor, 0));', 'v_refunded := verified_minor;'),
  ('D02 pending refunds of a final partial refund not held', PROV, 'cert',
   'held_minor := greatest(p_collection.amount_minor - v_refunded, 0) - counted_minor;', 'held_minor := 0;'),
  ('D03 a stop / CarUp expiry releases the room before the provider confirms', PROV, 'cert',
   "             WHEN p.status IN ('pending', 'refund_pending', 'reconciliation_hold')\n",
   "             WHEN (p.status = 'pending' AND c.cancelled_at IS NULL AND c.expires_at > clock_timestamp())\n               OR p.status IN ('refund_pending', 'reconciliation_hold')\n"),
  ('D04 a live checkout binds to a closed collection', PROV, 'cert',
   "  IF v_c.cancelled_at IS NOT NULL OR v_c.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'PAY04_COLLECTION_CLOSED'; END IF;\n", ''),
  ('D05 an unattached stop leaves the canonical payment pending', PROV, 'cert',
   "  IF v_c.provider_payment_id IS NULL THEN\n    PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled'",
   "  IF false THEN\n    PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled'"),
  ('D06 a mismatch on counted money is recorded but not re-projected', PROV, 'cert',
   "      v_projection := public.pay04_reproject_garage_collection(v_c.id, 'provider_mismatch', p_event_id);\n      RETURN jsonb_build_object('applied', false, 'refused', 'amount_mismatch'",
   "      RETURN jsonb_build_object('applied', false, 'refused', 'amount_mismatch'"),
  ('D07 money counts while a mismatch is open', PROV, 'cert',
   "               AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch')) THEN\n    v_target := 0;\n  END IF;",
   "               AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch')) THEN\n    NULL;\n  END IF;"),
  ('D08 off-platform-settled money starts counting when room appears', PROV, 'cert',
   '    v_target := least(v_target, v_current);', '    NULL;'),
  ('D09 a stale "uncounted" flag never closes itself', PROV, 'cert',
   '  ELSIF v_target > 0 AND v_alloc = v_target THEN', '  ELSIF false THEN'),
  ('D10 an operator closure does not re-project', PROV, 'cert',
   "  RETURN to_jsonb(v_d) || jsonb_build_object('projection',\n    public.pay04_reproject_garage_collection(v_d.collection_id, 'discrepancy_resolved', NULL));",
   '  RETURN to_jsonb(v_d);'),
  ('D11 a billed part can be reversed', INTEG, 'cert',
   "    RAISE EXCEPTION 'PAY04_PART_USAGE_INVOICED';", '    NULL;'),
  ('D12 CarUp closes an ATTACHED expired collection without the provider', PROV, 'cert',
   "  IF v_c.provider_payment_id IS NOT NULL THEN RAISE EXCEPTION 'PAY04_COLLECTION_ATTACHED'; END IF;\n", ''),
  # ---- services (killer: the real-PG service suite on a clean certified database) ----
  ('J01 a stopped-but-unconfirmed checkout reads as "stopped"', SVC, 'realpg',
   "    if (collection.cancelled_at) return 'stopping';", "    if (collection.cancelled_at) return 'stopped';"),
  ('J02 every provider row says "confirmed"', SVC, 'realpg',
   '      source_label: PAY04_LABELS.providerChannel,', '      source_label: PAY04_LABELS.providerSource,'),
  ('J03 the customer card shows other payers\' provider payments', INV, 'realpg',
   'await loadInvoiceParts(client, invoices.map((i) => i.id), { payerUserId: userId })', 'await loadInvoiceParts(client, invoices.map((i) => i.id))'),
  ('J04 a refused refund is reported as sent', SVC, 'realpg',
   "  if (providerError && out.payment_status === 'paid') throw new Pay04Error('PAY04_PROVIDER_REFUND_REFUSED', 502);\n", ''),
  ('J05 one provider refund key per collection', SVC, 'realpg',
   'idempotencyKey: `pay04-refund-${collection.id}-${Number(requested?.request_seq) || 1}`', 'idempotencyKey: `pay04-refund-${collection.id}`'),
  ('J06 a stop is recorded although the provider could not be reached', SVC, 'realpg',
   "    } catch {\n      throw new Pay04Error('PAY04_PROVIDER_CANCEL_UNAVAILABLE', 502);\n    }", '    } catch {\n      closed = null;\n    }'),
  ('J07 a new payment does not read expired checkouts first', SVC, 'realpg',
   '  if (!prior) await refreshClosingCollections({ db, env, provider, invoiceId: invoice.id });\n', ''),
  ('J08 an amount-less retry uses the current balance', SVC, 'realpg',
   '(prior && prior.invoice_id === invoice.id ? pay04Money(prior.amount, prior.currency) : money.uncommitted_balance)', 'money.uncommitted_balance'),
  ('J09 the F5 operator path accepts another merchant\'s evidence', SVC, 'realpg',
   '  if (!account || truth.merchantReference !== account.merchant_reference) {', '  if (false) {'),
  ('J10 a reversal does not re-project provider money', INV, 'realpg',
   '  await reprojectInvoiceRoom({ db: client, env: deps.env ?? process.env, invoiceId: pay.invoice_id });\n', ''),
  ('J11 the customer\'s stop response carries internal references', SVC, 'realpg',
   '  return forCustomer(await cancelCollection(db, env, provider, collection, userId,', '  return (await cancelCollection(db, env, provider, collection, userId,'),
  ('J12 a void does not read expired checkouts first', INV, 'realpg',
   '  await refreshClosingCollections({ db: client, env: deps.env ?? process.env, provider: deps.provider ?? null, invoiceId: String(invoiceId) });\n', ''),
  ('J13 the invoice label ignores provider money', INV, 'realpg',
   '  if (provider) return PAY04_LABELS.providerSource;\n', ''),
  ('J14 the provider takes money after the expiry it was given', SIM, 'realpg',
   "      const expired = this.expireIfDue(state, c);\n      if (expired) return { events: [expired], status: 'expired' };\n", ''),
  ('J15 the Garage Hub (closeout) invoice carries no provider activity', INV, 'realpg',
   '    out.invoice = { ...view, provider_history: await providerHistoryOf(client, view) };', '    out.invoice = view;'),
  # ---- web (killer: the PAY-04 vitest files) ----
  ('W01 raw PAY04_ codes reach people', LIB, 'vitest',
   '  if (!code) return message\n  return PAY04_ERROR_TEXT[code] ?? ', '  if (!code || code) return message\n  return PAY04_ERROR_TEXT[code] ?? '),
  ('W02 any amount is sent unchecked', LIB, 'vitest',
   '  const scale = ZERO_DECIMAL.has(currency) ? 0 : 2\n  const text = raw.trim()', '  return null\n  const scale = ZERO_DECIMAL.has(currency) ? 0 : 2\n  const text = raw.trim()'),
  ('W03 "nothing was charged" before the provider confirms', LIB, 'vitest',
   "  if (state === 'stopping' || state === 'expired') {", "  if (state === 'stopping' || state === 'expired' || false) {\n    return { tone: 'warn', text: 'This checkout ended without a payment. Nothing was charged.' }\n  }\n  if (false) {"),
  ('W04 a changed amount reuses the request key', PAYUI, 'vitest',
   'onChange={(e) => { setAmount(e.target.value); setKey(newIdempotencyKey()); setProblem(null) }}', 'onChange={(e) => { setAmount(e.target.value); setProblem(null) }}'),
  ('W05 stop acts on one tap', PAYUI, 'vitest',
   "onClick={() => { setStopAsk(p.id); setStopError(null) }} data-testid=\"my-provider-payment-stop\"", "onClick={() => void stop(p.id)} data-testid=\"my-provider-payment-stop\""),
  ('W06 a check does not refresh the invoice card', PAYUI, 'vitest',
   '      await load()\n      onChanged?.()\n    } catch {', '      await load()\n    } catch {'),
  ('W07 the hub shows a provider refusal as a raw code', PANEL, 'vitest',
   "  fn().catch((e: unknown) => { throw new Error(pay04ErrorText(e instanceof Error ? e.message : '')) })",
   "  fn().catch((e: unknown) => { throw e })"),
  ('W09 the Garage Hub payment step says "recorded by the garage" while provider money counts', 'web/src/lib/garageWorkspace.ts', 'vitest',
   'detail: live ? (live.money ? paymentStatusLabel(live) : PAYMENT_STATUS_LABEL[live.payment_status]) : null',
   'detail: live ? PAYMENT_STATUS_LABEL[live.payment_status] : null'),
  ('W10 the garage invoices list calls provider money "Recorded payments"', 'web/src/components/garage/operations/InvoicesSection.tsx', 'vitest',
   '{paymentsShown && inv.status === \'issued\' && (inv.money && Number(inv.money.provider_paid) > 0 ? (',
   '{paymentsShown && inv.status === \'issued\' && (false ? ('),
  ('W08 the later-refund flag offers the wrong closure', OPS, 'vitest',
   "  refund_after_resolution: [\n", "  refund_after_resolution_disabled: [\n"),
]


def run(cmd, cwd, timeout):
    t = time.time()
    p = subprocess.run(cmd, cwd=cwd, env=ENV, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout + p.stderr, round(time.time() - t)


def killer(kind):
    if kind == 'cert':
        rc, out, secs = run(['bash', 'scripts/ci/pay04-postgres-certification.sh', 'payments-first'], MUT, 1200)
        first = next((l for l in out.splitlines() if 'ERROR:' in l or 'PAY04_CERT_REFUSED' in l), '')
        return rc, first[:220], out, secs
    if kind == 'realpg':
        rc, out, secs = run(['node', '--test', '--test-concurrency=1', 'tests/pay04-garage-payments.test.js'], os.path.join(MUT, 'backend'), 900)
        fails = [l for l in out.splitlines() if l.startswith('not ok')]
        return (rc if fails or rc else 0), '; '.join(fails)[:220], out, secs
    rc, out, secs = run(['npx', 'vitest', 'run', *WEB_TESTS], os.path.join(MUT, 'web'), 900)
    fails = [l.strip() for l in out.splitlines() if l.strip().startswith('×')]
    return rc, '; '.join(fails)[:220], out, secs


def main(only=None):
    results = []
    kinds = [k for k in ('cert', 'realpg', 'vitest') if not only or k in only]
    for kind in kinds:
        if kind == 'realpg':
            # the service suite runs on a CLEAN certified database (the last DB mutant left its own behind)
            rc, first, out, secs = killer('cert')
            print(f'CLEAN cert before services: rc={rc} ({secs}s) {first}', flush=True)
            if rc != 0:
                return 1
        rc, first, out, secs = killer(kind)
        open(os.path.join(OUT, f'baseline-{kind}.log'), 'w').write(out)
        print(f'BASELINE {kind}: rc={rc} ({secs}s) {first}', flush=True)
        if rc != 0:
            print('baseline not green - stopping', flush=True)
            return 1
        for (mid, path, mkind, old, new) in MUTANTS:
            if mkind != kind:
                continue
            full = os.path.join(MUT, path)
            src = open(full).read()
            if src.count(old) != 1:
                results.append({'mutant': mid, 'killer': kind, 'result': 'NOT_APPLIED', 'occurrences': src.count(old)})
                print(f'{mid}: NOT_APPLIED ({src.count(old)} occurrences)', flush=True)
                continue
            open(full, 'w').write(src.replace(old, new))
            try:
                rc, first, out, secs = killer(kind)
            finally:
                open(full, 'w').write(src)
            open(os.path.join(OUT, mid.split()[0] + '.log'), 'w').write(out)
            verdict = 'KILLED' if rc != 0 else 'SURVIVED'
            results.append({'mutant': mid, 'killer': kind, 'result': verdict, 'seconds': secs, 'evidence': first})
            print(f'{mid}: {verdict} ({secs}s) {first}', flush=True)
    if 'cert' in kinds and 'realpg' not in kinds:
        rc, _, _, _ = killer('cert')
        print(f'RESTORE cert: rc={rc}', flush=True)
    clean = subprocess.run(['git', '-C', MUT, 'status', '--short'], capture_output=True, text=True).stdout.strip()
    json.dump({'worktree_head': subprocess.run(['git', '-C', MUT, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip(),
               'worktree_clean_after': clean == '', 'results': results}, open(os.path.join(OUT, 'results.json'), 'w'), indent=2)
    killed = sum(r['result'] == 'KILLED' for r in results)
    print(f'MUTATION SUMMARY: {killed}/{len(results)} killed; worktree clean after: {clean == ""}', flush=True)
    return 0 if killed == len(results) else 2


if __name__ == '__main__':
    sys.exit(main(set(sys.argv[1:]) or None))
