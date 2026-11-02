import { useCallback, useEffect, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { formatMoney } from '@/lib/garageBusiness'
import { pay04ErrorText, MONEY_ACTION_BUTTON_CLASS, PAYMENT_METHOD_OPTIONS, type GarageFinancialOverview, type GaragePaymentInstructionsView } from '@/lib/pay04GaragePayments'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'
import PaynowConnection from '@/components/garage/PaynowConnection'

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? pay04ErrorText(e.message) : fallback
}

const isOverview = (v: GarageFinancialOverview | null | undefined): v is GarageFinancialOverview =>
  Boolean(v && Array.isArray(v.currencies) && v.provider && typeof v.truncated === 'boolean')

/**
 * CARUP-PAY-04 — the garage's own money, for the garage ADMIN.
 *
 * Every figure is the server's, per currency, never summed across currencies, and every source is named: what the
 * garage recorded as received, what its payment provider confirmed, what is still owed and what is in flight. This
 * is the garage's revenue; nothing here says CarUp received or holds it. A section that fails to load says so.
 */
export default function GaragePayments() {
  const { fetchGarageFinancialOverview, fetchGaragePaymentInstructions, saveGaragePaymentInstructions } = useCarUpApi()
  const { user } = useAuth()
  const isAdmin = user?.active_tenant?.role === 'admin'
  const uid = useId()

  const [overview, setOverview] = useState<GarageFinancialOverview | null>(null)
  const [overviewState, setOverviewState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [instructions, setInstructions] = useState<GaragePaymentInstructionsView | null>(null)
  const [instructionsState, setInstructionsState] = useState<'loading' | 'ready' | 'error'>('loading')

  const [payee, setPayee] = useState('')
  const [text, setText] = useState('')
  const [methods, setMethods] = useState<string[]>([])
  const [currencies, setCurrencies] = useState('USD')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null)

  // The first statement of each load is the awaited read: state changes only after it answers (never synchronously
  // inside the mount effect). Retry buttons mark the section as loading first.
  const applyOverview = useCallback((res: GarageFinancialOverview | null | undefined) => {
    if (!isOverview(res)) throw new Error('The payments overview is incomplete')
    setOverview(res); setOverviewError(null); setOverviewState('ready')
  }, [])
  const failOverview = useCallback((e: unknown) => {
    setOverviewError(messageOf(e, 'The payments overview could not be loaded')); setOverviewState('error')
  }, [])
  const applyInstructions = useCallback((res: GaragePaymentInstructionsView | null | undefined) => {
    if (!res || !Array.isArray(res.history)) throw new Error('Unexpected instructions response')
    setInstructions(res)
    if (res.active) {
      setPayee(res.active.payee_name); setText(res.active.instructions); setMethods(res.active.accepted_methods)
      setCurrencies(res.active.currencies.join(', '))
    }
    setInstructionsState('ready')
  }, [])

  // Reads are subscriptions: state changes only in their callbacks, after the server answers.
  const loadOverview = useCallback(() => {
    fetchGarageFinancialOverview().then(applyOverview).catch(failOverview)
  }, [fetchGarageFinancialOverview, applyOverview, failOverview])
  const loadInstructions = useCallback(() => {
    fetchGaragePaymentInstructions().then(applyInstructions).catch(() => setInstructionsState('error'))
  }, [fetchGaragePaymentInstructions, applyInstructions])

  useEffect(() => {
    if (!isAdmin) return
    let live = true
    fetchGarageFinancialOverview().then((r) => { if (live) applyOverview(r) }).catch((e) => { if (live) failOverview(e) })
    fetchGaragePaymentInstructions().then((r) => { if (live) applyInstructions(r) }).catch(() => { if (live) setInstructionsState('error') })
    return () => { live = false }
  }, [isAdmin, fetchGarageFinancialOverview, fetchGaragePaymentInstructions, applyOverview, failOverview, applyInstructions])

  const save = async () => {
    setSaving(true); setSaveMessage(null)
    try {
      const res = await saveGaragePaymentInstructions({
        payee_name: payee.trim(), instructions: text.trim(), accepted_methods: methods,
        currencies: currencies.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
      })
      setInstructions(res)
      setSaveMessage({ ok: true, text: `Saved as version ${res.active?.version}. Customers now see these instructions on unpaid invoices.` })
    } catch (e) {
      setSaveMessage({ ok: false, text: messageOf(e, 'The instructions were not saved.') })
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className={SN_PAGE}>
        <h1 className="text-2xl font-bold">Invoices and payments</h1>
        <p className="text-gray-700" data-testid="garage-payments-admin-only">Only a garage administrator can see the garage’s money.</p>
      </div>
    )
  }

  return (
    <div className={SN_PAGE} data-testid="garage-payments-page">
      <div>
        <h1 className="text-2xl font-bold">Invoices and payments</h1>
        <p className="text-gray-500">Your garage’s invoices and the money received against them, per currency</p>
      </div>

      <section aria-labelledby={`${uid}-money`} className="space-y-3" data-testid="garage-money-section">
        <h2 id={`${uid}-money`} className="text-lg font-semibold">Money by currency</h2>
        {overviewState === 'loading' && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</p>}
        {overviewState === 'error' && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900" data-testid="garage-money-error">
            <p>{overviewError}. This is a loading problem, not a statement that nothing is owed or received.</p>
            <Button variant="outline" className="mt-2 min-h-11" onClick={() => { setOverviewState('loading'); loadOverview() }}>Try again</Button>
          </div>
        )}
        {overviewState === 'ready' && overview && (
          <>
            {overview.currencies.length === 0 ? (
              <p className="text-sm text-gray-700" data-testid="garage-money-empty">You have not issued an invoice yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {overview.currencies.map((c) => (
                  <Card key={c.currency} data-testid="garage-money-currency" data-currency={c.currency}>
                    <CardContent className="p-4">
                      <h3 className="font-semibold">{c.currency}</h3>
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between gap-2"><dt>Invoiced (live invoices)</dt><dd className="tabular-nums">{formatMoney(c.invoiced, c.currency)}</dd></div>
                        <div className="flex justify-between gap-2"><dt>Recorded by the garage</dt><dd className="tabular-nums" data-testid="overview-declared">{formatMoney(c.declared_paid, c.currency)}</dd></div>
                        <div className="flex justify-between gap-2"><dt>Confirmed by your payment provider</dt><dd className="tabular-nums" data-testid="overview-provider">{formatMoney(c.provider_paid, c.currency)}</dd></div>
                        <div className="flex justify-between gap-2"><dt>Still owed</dt><dd className="tabular-nums" data-testid="overview-outstanding">{formatMoney(c.outstanding, c.currency)}</dd></div>
                        <div className="flex justify-between gap-2"><dt>With the provider — in progress or under review (not counted)</dt><dd className="tabular-nums">{formatMoney(c.in_flight, c.currency)}</dd></div>
                      </dl>
                      <p className="mt-2 text-xs text-gray-600">
                        {c.counts.issued} live invoice(s): {c.counts.paid} paid, {c.counts.partially_paid} partly paid, {c.counts.unpaid} unpaid · {c.counts.voided} voided
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {overview.truncated && <p className="text-xs text-amber-800" data-testid="garage-money-truncated">Only your most recent {overview.invoice_count} invoices are counted here.</p>}
            <p className="text-xs text-gray-600" data-testid="garage-money-owner-note">{overview.revenue_owner_note}</p>
            {overview.open_discrepancies > 0 && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900" data-testid="garage-money-discrepancies">
                {overview.open_discrepancies === 1 ? '1 provider-payment exception is under review' : `${overview.open_discrepancies} provider-payment exceptions are under review`}
                {' '}— the money it concerns is not counted until it is resolved. CarUp operations has been alerted.
              </p>
            )}
            <div className="rounded-lg border p-3 text-sm" data-testid="garage-provider-status">
              <p className="font-medium">Online payments</p>
              {overview.provider.connected ? (
                <p>
                  Connected: {overview.provider.display_name} ({overview.provider.currencies.join(', ')}){' '}
                  {overview.provider.simulated && <Badge variant="outline">Simulated provider — test environment, no real money</Badge>}
                </p>
              ) : (
                <p>Not connected. Customers pay you directly using your payment instructions below.</p>
              )}
            </div>
          </>
        )}
      </section>

      <PaynowConnection />

      <section aria-labelledby={`${uid}-instr`} className="space-y-3 border-t pt-6" data-testid="garage-instructions-section">
        <h2 id={`${uid}-instr`} className="text-lg font-semibold">Payment instructions for your customers</h2>
        <p className="text-sm text-gray-600">Your own words on how to pay you. Customers see them on unpaid invoices, with a note that CarUp does not receive, hold or verify this money.</p>
        {instructionsState === 'loading' && <p role="status" className="text-sm">Loading…</p>}
        {instructionsState === 'error' && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900" data-testid="garage-instructions-error">
            <p>Your payment instructions could not be loaded. Nothing has been changed.</p>
            <Button variant="outline" className="mt-2 min-h-11" onClick={() => { setInstructionsState('loading'); loadInstructions() }}>Try again</Button>
          </div>
        )}
        {instructionsState === 'ready' && (
          <div className="space-y-3">
            <p className="text-sm" data-testid="garage-instructions-version">
              {instructions?.active ? `Published version ${instructions.active.version}` : 'Not published yet'}
            </p>
            <div>
              <label htmlFor={`${uid}-payee`} className="block text-sm font-medium">Pay to (your business name)</label>
              <input id={`${uid}-payee`} className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm" value={payee} onChange={(e) => setPayee(e.target.value)} data-testid="instructions-payee" />
            </div>
            <div>
              <label htmlFor={`${uid}-text`} className="block text-sm font-medium">How to pay</label>
              <textarea id={`${uid}-text`} rows={4} className="w-full rounded-lg border border-gray-300 p-3 text-sm" value={text} onChange={(e) => setText(e.target.value)} data-testid="instructions-text-input" />
            </div>
            <fieldset>
              <legend className="text-sm font-medium">Ways you accept payment</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <label key={m.value} className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={methods.includes(m.value)} data-testid={`instructions-method-${m.value}`}
                      onChange={(e) => setMethods((cur) => (e.target.checked ? [...cur, m.value] : cur.filter((x) => x !== m.value)))} />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor={`${uid}-cur`} className="block text-sm font-medium">Currencies (comma separated)</label>
              <input id={`${uid}-cur`} className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm" value={currencies} onChange={(e) => setCurrencies(e.target.value)} data-testid="instructions-currencies" />
            </div>
            {saveMessage && (
              <p role={saveMessage.ok ? 'status' : 'alert'} className={`rounded-lg p-3 text-sm ${saveMessage.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`} data-testid="instructions-save-message">
                {saveMessage.text}
              </p>
            )}
            <Button className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={saving} onClick={() => void save()} data-testid="instructions-save">
              {saving ? 'Saving…' : instructions?.active ? 'Publish a new version' : 'Publish instructions'}
            </Button>
            {instructions && instructions.history.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer min-h-11 flex items-center">Earlier versions ({instructions.history.length})</summary>
                <ul className="mt-2 space-y-2" data-testid="instructions-history">
                  {instructions.history.map((h) => (
                    <li key={h.id} className="rounded-md border bg-gray-50 p-2">Version {h.version}: {h.payee_name} — replaced {h.superseded_at ? new Date(h.superseded_at).toLocaleString() : ''}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
