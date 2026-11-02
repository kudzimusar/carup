import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { formatMoney } from '@/lib/garageBusiness'
import { activityActor, DISCREPANCY_LABEL, minorToMajor, PROVIDER_EVENT_LABEL, type GarageMerchantAccount, type GaragePaymentExceptions, type ProviderActivity, pay04ErrorText } from '@/lib/pay04GaragePayments'

function Trail({ history }: { history?: ProviderActivity[] }) {
  if (!history?.length) return null
  return (
    <details className="mt-2 text-xs" data-testid="operator-trail">
      <summary className="min-h-11 flex items-center cursor-pointer">Audit trail ({history.length})</summary>
      <ol className="mt-1 space-y-1">
        {history.map((e, i) => (
          <li key={`${e.created_at}-${i}`}>{new Date(e.created_at).toLocaleString()} · {PROVIDER_EVENT_LABEL[e.event_type] ?? e.event_type} · {activityActor(e.actor)}</li>
        ))}
      </ol>
    </details>
  )
}

/** Operators read the refusal in words and keep its code for support. */
function messageOf(e: unknown, fallback: string): string {
  if (!(e instanceof Error) || !e.message) return fallback
  const code = /\bPAY04_[A-Z0-9_]+\b/.exec(e.message)?.[0]
  return code ? `${pay04ErrorText(code)} (${code})` : e.message
}
const RESOLUTIONS: Record<string, Array<{ value: string; label: string }>> = {
  unallocated_provider_money: [
    { value: 'refunded_to_customer', label: 'Refunded to the customer (provider-confirmed refund required)' },
    { value: 'settled_off_platform', label: 'Settled with the customer outside CarUp (explain in the note)' },
  ],
  // the invoice already counts only what the provider says the garage keeps; the operator records the review
  refund_after_resolution: [
    { value: 'acknowledged', label: 'Reviewed: the invoice counts only what the provider says the garage keeps (explain in the note)' },
    { value: 'refunded_to_customer', label: 'Refunded to the customer (provider-confirmed full refund required)' },
  ],
  default: [{ value: 'provider_corrected', label: 'Provider corrected its report (verify first)' }],
}

/**
 * CARUP-PAY-04 — the platform operator's view of garage payments: what needs a decision and whose merchant
 * identity collects. Operators govern evidence; they never move garage money. Every resolution is re-checked in the
 * database (platform administrator, not the payer, not a member of the garage, written note).
 */
export default function GaragePaymentsOperator() {
  const {
    fetchGaragePaymentExceptions, resolveGaragePaymentDiscrepancy, fetchGarageMerchantAccounts, registerGarageMerchantAccount,
    suspendGarageMerchantAccount,
  } = useCarUpApi()
  const uid = useId()
  const [exceptions, setExceptions] = useState<GaragePaymentExceptions | null>(null)
  const [exceptionsState, setExceptionsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [accounts, setAccounts] = useState<GarageMerchantAccount[] | null>(null)
  const [accountsState, setAccountsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState<{ id: string; resolution: string; note: string } | null>(null)
  const [form, setForm] = useState({ tenant_id: '', merchant_reference: '', display_name: '', currencies: 'USD', authority_note: '' })

  const applyExceptions = useCallback((res: GaragePaymentExceptions | null | undefined) => {
    if (!res || !Array.isArray(res.discrepancies) || !Array.isArray(res.reconciliation_holds)) { setExceptionsState('error'); return }
    setExceptions(res); setExceptionsState('ready')
  }, [])
  const applyAccounts = useCallback((res: { accounts: GarageMerchantAccount[] } | null | undefined) => {
    if (!res || !Array.isArray(res.accounts)) { setAccountsState('error'); return }
    setAccounts(res.accounts); setAccountsState('ready')
  }, [])
  // Reads are subscriptions: state changes only in their callbacks, after the server answers.
  const loadExceptions = useCallback(() => fetchGaragePaymentExceptions().then(applyExceptions, () => setExceptionsState('error')),
    [fetchGaragePaymentExceptions, applyExceptions])
  const loadAccounts = useCallback(() => fetchGarageMerchantAccounts().then(applyAccounts, () => setAccountsState('error')),
    [fetchGarageMerchantAccounts, applyAccounts])
  useEffect(() => {
    let live = true
    fetchGaragePaymentExceptions().then((r) => { if (live) applyExceptions(r) }, () => { if (live) setExceptionsState('error') })
    fetchGarageMerchantAccounts().then((r) => { if (live) applyAccounts(r) }, () => { if (live) setAccountsState('error') })
    return () => { live = false }
  }, [fetchGaragePaymentExceptions, fetchGarageMerchantAccounts, applyExceptions, applyAccounts])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMessage(null)
    try {
      await fn()
      setMessage({ ok: true, text: ok })
      await Promise.all([loadExceptions(), loadAccounts()])
      return true
    } catch (e) {
      setMessage({ ok: false, text: messageOf(e, 'The action was refused.') })
      return false
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-8 p-4 md:p-6" data-testid="garage-payments-operator">
      <div>
        <h1 className="text-2xl font-bold">Garage payments — operations</h1>
        <p className="text-sm text-gray-600">Garage money belongs to the garage. Operators review evidence and close exceptions; they never collect, hold or move it.</p>
        <Badge variant="outline" className="mt-2 whitespace-normal">Level 1: simulated garage payment provider only</Badge>
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`rounded-lg p-3 text-sm ${message.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`} data-testid="operator-message">
          {message.text}
        </p>
      )}

      <section aria-labelledby={`${uid}-exc`} className="space-y-3" data-testid="operator-exceptions">
        <h2 id={`${uid}-exc`} className="text-lg font-semibold">Needs a decision</h2>
        {exceptionsState === 'loading' && <p role="status" className="text-sm">Loading…</p>}
        {exceptionsState === 'error' && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900" data-testid="operator-exceptions-error">
            <p>Exceptions could not be loaded. This is not a statement that there are none.</p>
            <Button variant="outline" className="mt-2 min-h-11" onClick={() => { setExceptionsState('loading'); void loadExceptions() }}>Try again</Button>
          </div>
        )}
        {exceptionsState === 'ready' && exceptions && (
          <>
            {exceptions.discrepancies.length === 0 && exceptions.reconciliation_holds.length === 0 && (
              <p className="text-sm text-gray-700" data-testid="operator-exceptions-none">No open garage payment exceptions.</p>
            )}
            <ul className="space-y-3">
              {exceptions.discrepancies.map((d) => (
                <li key={d.id} className="rounded-lg border p-3 text-sm" data-testid="operator-discrepancy" data-type={d.type}>
                  <p className="font-medium">{DISCREPANCY_LABEL[d.type] ?? d.type}{d.amount ? ` — ${formatMoney(d.amount, d.currency)}` : ''}</p>
                  <p className="text-xs text-gray-600">{d.garage ?? 'Garage'} · detected via {d.detected_via.replace('_', ' ')} · {new Date(d.first_detected_at).toLocaleString()} · seen {d.observation_count}×</p>
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-xs" data-testid="operator-discrepancy-evidence">{JSON.stringify(d.evidence, null, 2)}</pre>
                  <Trail history={d.history} />
                  {resolving?.id === d.id ? (
                    <div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-3">
                      <label htmlFor={`${uid}-res-${d.id}`} className="block text-sm font-medium">Resolution</label>
                      <select id={`${uid}-res-${d.id}`} className="w-full min-h-11 rounded-lg border px-2" value={resolving.resolution}
                        onChange={(e) => setResolving({ ...resolving, resolution: e.target.value })} data-testid="operator-resolution">
                        {(RESOLUTIONS[d.type] ?? RESOLUTIONS.default).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      <label htmlFor={`${uid}-note-${d.id}`} className="block text-sm font-medium">Note (what you verified, at least 10 characters)</label>
                      <textarea id={`${uid}-note-${d.id}`} rows={3} className="w-full rounded-lg border p-2 text-sm" value={resolving.note}
                        onChange={(e) => setResolving({ ...resolving, note: e.target.value })} data-testid="operator-resolution-note" />
                      <div className="flex flex-wrap gap-2">
                        <Button className="min-h-11" disabled={busy || resolving.note.trim().length < 10} data-testid="operator-resolve-submit"
                          onClick={() => void act(() => resolveGaragePaymentDiscrepancy(d.id, { resolution: resolving.resolution, note: resolving.note.trim() }), 'Exception closed.').then((ok) => ok && setResolving(null))}>
                          Close this exception
                        </Button>
                        <Button variant="outline" className="min-h-11" onClick={() => setResolving(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="outline" className="mt-2 min-h-11" data-testid="operator-resolve"
                      onClick={() => setResolving({ id: d.id, resolution: (RESOLUTIONS[d.type] ?? RESOLUTIONS.default)[0].value, note: '' })}>
                      Resolve…
                    </Button>
                  )}
                </li>
              ))}
              {exceptions.reconciliation_holds.map((h) => (
                <li key={h.id} className="rounded-lg border border-red-200 p-3 text-sm" data-testid="operator-hold">
                  <p className="font-medium">Refund-policy hold (F5): {h.mismatch.replaceAll('_', ' ')}</p>
                  <p className="text-xs text-gray-600">{minorToMajor(h.payment_amount_minor, h.currency)} · refunded {minorToMajor(h.detected_refunded_minor, h.currency)} · refund pending {minorToMajor(h.detected_pending_refund_minor, h.currency)}</p>
                  <p className="mt-1 text-xs">Resolve it with a fresh provider read in the <Link className="underline" to="/admin/commercial-foundation">payment reconciliation console</Link>; the garage invoice is re-counted in the same step.</p>
                  <Trail history={h.history} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby={`${uid}-acc`} className="space-y-3 border-t pt-6" data-testid="operator-merchants">
        <h2 id={`${uid}-acc`} className="text-lg font-semibold">Garage merchant accounts</h2>
        {accountsState === 'loading' && <p role="status" className="text-sm">Loading…</p>}
        {accountsState === 'error' && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900" data-testid="operator-merchants-error">
            <p>Merchant accounts could not be loaded.</p>
            <Button variant="outline" className="mt-2 min-h-11" onClick={() => { setAccountsState('loading'); void loadAccounts() }}>Try again</Button>
          </div>
        )}
        {accountsState === 'ready' && accounts && (
          <ul className="space-y-2" data-testid="operator-merchant-list">
            {accounts.length === 0 && <li className="text-sm text-gray-700">No garage merchant accounts.</li>}
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm" data-testid="operator-merchant">
                <span>{a.display_name} · {a.merchant_reference} · {a.currencies.join(', ')} · <Badge variant="outline">{a.status}</Badge></span>
                {a.status === 'simulated' && (
                  <Button variant="outline" className="min-h-11" disabled={busy}
                    onClick={() => { const reason = window.prompt('Why suspend this merchant account? (at least 10 characters)'); if (reason) void act(() => suspendGarageMerchantAccount(a.id, reason), 'Merchant account suspended.') }}>
                    Suspend
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form className="grid gap-2 rounded-lg border p-3 md:grid-cols-2" data-testid="operator-merchant-form"
          onSubmit={(e) => { e.preventDefault(); void act(() => registerGarageMerchantAccount({ ...form, currencies: form.currencies.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) }), 'Simulated merchant account registered.') }}>
          <p className="md:col-span-2 text-sm font-medium">Register a SIMULATED garage merchant (test environments only)</p>
          {(['tenant_id', 'merchant_reference', 'display_name', 'currencies'] as const).map((field) => (
            <label key={field} className="text-sm">
              {{ tenant_id: 'Garage tenant id', merchant_reference: 'Merchant reference (gsim_merchant_…)', display_name: 'Display name', currencies: 'Currencies' }[field]}
              <input className="mt-1 w-full min-h-11 rounded-lg border px-2" value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} data-testid={`merchant-${field}`} />
            </label>
          ))}
          <label className="text-sm md:col-span-2">
            Authority note (why this simulation is authorized)
            <input className="mt-1 w-full min-h-11 rounded-lg border px-2" value={form.authority_note} onChange={(e) => setForm({ ...form, authority_note: e.target.value })} data-testid="merchant-authority_note" />
          </label>
          <Button type="submit" className="min-h-11 md:col-span-2" disabled={busy} data-testid="merchant-register">Register simulated merchant</Button>
        </form>
      </section>
    </div>
  )
}
