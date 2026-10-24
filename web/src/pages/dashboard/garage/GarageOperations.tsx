import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { OperationsSummary } from '@/lib/garageBusiness'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'
import { dateTimeText, whenText } from '@/components/garage/operations/OperationsParts'
import { MoneySection } from '@/components/garage/operations/MoneySection'
import { InvoicesSection, type InvoiceStatusFilter, type InvoicesPayload } from '@/components/garage/operations/InvoicesSection'
import {
  AppointmentsSection, EstimatesSection, NotMeasuredSection, PartsSection, WorkSection,
} from '@/components/garage/operations/SummarySections'

const WINDOWS = [7, 30, 90] as const
type WindowDays = (typeof WINDOWS)[number]

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function isCompleteSummary(res: OperationsSummary | null | undefined): res is OperationsSummary {
  return Boolean(res && res.work && res.appointments && res.estimates && res.money && res.parts && Array.isArray(res.not_measured))
}

/**
 * How the workshop is running, for the garage ADMIN — counted by the server from the garage's own
 * records over a 7, 30 or 90 day window.
 *
 * What this page will not do: invent a figure. Every number is the server's, with its own definition
 * one tap away; a figure the server marks "not measured" shows its reason and no number; money stays
 * per currency; and the things CarUp deliberately does not calculate are listed, with why.
 */
export default function GarageOperations() {
  const { fetchGarageOperationsSummary, fetchGarageInvoices } = useCarUpApi()
  const { user } = useAuth()
  const isAdmin = user?.active_tenant?.role === 'admin'

  const [windowDays, setWindowDays] = useState<WindowDays>(30)
  const [summary, setSummary] = useState<OperationsSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatusFilter>('all')
  const [invoices, setInvoices] = useState<InvoicesPayload | null>(null)
  const [invoiceState, setInvoiceState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [invoiceError, setInvoiceError] = useState<string | null>(null)

  const summarySeq = useRef(0)
  const invoiceSeq = useRef(0)

  const loadSummary = useCallback(async (days: WindowDays) => {
    const seq = ++summarySeq.current
    setState('loading'); setError(null); setSummary(null)
    try {
      const res = await fetchGarageOperationsSummary(days)
      if (!isCompleteSummary(res)) throw new Error('The operations summary is incomplete')
      if (seq !== summarySeq.current) return
      setSummary(res); setState('ready')
    } catch (e) {
      if (seq !== summarySeq.current) return
      setError(messageOf(e, 'The operations summary could not be loaded')); setState('error')
    }
  }, [fetchGarageOperationsSummary])

  const loadInvoices = useCallback(async (status: InvoiceStatusFilter) => {
    const seq = ++invoiceSeq.current
    setInvoiceState('loading'); setInvoiceError(null)
    try {
      const res = await fetchGarageInvoices(status === 'all' ? undefined : status)
      if (!res || !Array.isArray(res.invoices) || !res.summary) throw new Error('The invoice list is incomplete')
      if (seq !== invoiceSeq.current) return
      setInvoices(res as InvoicesPayload); setInvoiceState('ready')
    } catch (e) {
      if (seq !== invoiceSeq.current) return
      setInvoiceError(messageOf(e, 'The invoices could not be loaded')); setInvoiceState('error')
    }
  }, [fetchGarageInvoices])

  useEffect(() => { if (isAdmin) void loadSummary(windowDays) }, [isAdmin, loadSummary, windowDays])
  useEffect(() => { if (isAdmin) void loadInvoices(invoiceStatus) }, [isAdmin, loadInvoices, invoiceStatus])

  const back = (
    <Link to="/garage">
      <Button variant="outline" className="min-h-11"><ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />Workshop</Button>
    </Link>
  )

  if (!isAdmin) {
    return (
      <div className={SN_PAGE}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold">Operations</h1>
          {back}
        </div>
        <p className="text-sm text-gray-700" data-testid="operations-admin-only">
          The operations view is for the garage administrator.
        </p>
      </div>
    )
  }

  return (
    <div className={SN_PAGE}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Operations</h1>
          <p className="text-gray-500">How the workshop is running, counted from your own records</p>
        </div>
        {back}
      </div>

      <div role="group" aria-label="Time window" className="flex flex-wrap gap-2" data-testid="operations-window">
        {WINDOWS.map((days) => (
          <Button
            key={days} variant={windowDays === days ? 'default' : 'outline'} className="min-h-11"
            aria-pressed={windowDays === days} onClick={() => setWindowDays(days)}
          >
            {`Last ${days} days`}
          </Button>
        ))}
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          <span>Loading the last {windowDays} days…</span>
        </div>
      )}

      {state === 'error' && (
        <Card data-testid="operations-load-error"><CardContent className="p-6 text-center">
          <p className="font-semibold">The operations view could not be loaded</p>
          {error && <p className="text-sm text-gray-700 mt-1">{error}</p>}
          <p className="text-sm text-gray-500 mt-1">This is a loading problem, not a statement that nothing happened.</p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => { void loadSummary(windowDays) }}>Try again</Button>
        </CardContent></Card>
      )}

      {state === 'ready' && summary && (
        <>
          <p className="text-sm text-gray-600" data-testid="operations-window-dates">
            {summary.window_days} days, from {whenText(summary.window.from)} to {whenText(summary.window.to)}. Counted {dateTimeText(summary.generated_at)}.
          </p>
          {summary.truncated && (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="operations-truncated">
              This view covers the most recent records only. Older records were not included, so these figures are incomplete.
            </div>
          )}
          <WorkSection work={summary.work} />
          <AppointmentsSection appointments={summary.appointments} />
          <EstimatesSection estimates={summary.estimates} />
          <MoneySection money={summary.money} />
          <PartsSection parts={summary.parts} />
        </>
      )}

      <InvoicesSection
        state={invoiceState} data={invoices} error={invoiceError} status={invoiceStatus}
        onStatusChange={setInvoiceStatus} onRetry={() => { void loadInvoices(invoiceStatus) }}
      />

      {state === 'ready' && summary && <NotMeasuredSection entries={summary.not_measured} />}
    </div>
  )
}
