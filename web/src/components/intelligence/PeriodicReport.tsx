/**
 * CarUp Intelligence 1.0 — I19 periodic summary and export.
 *
 * A report outlives the page that produced it, so the things the page would have
 * explained have to travel inside the file. Two of those matter most:
 *
 *   an unmeasured figure exports as the words NOT MEASURED, never as a blank —
 *   because a blank cell becomes a zero the moment somebody sums the column;
 *
 *   each row carries what the figure means and what it is NOT, because a reader
 *   opening a CSV has no tooltip to hover.
 *
 * The download is produced by the server so the exported bytes are the same bytes
 * the API would hand any other consumer — a client-side CSV would be a second
 * rendering of the same numbers, free to drift from the first.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Download, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'

interface ReportRow {
  key: string
  label: string
  value: number | null
  unit: string | null
  available: boolean
  reason: string | null
  means: string | null
  not: string | null
  calculation_version: string | null
}

interface ReportPayload {
  ok?: boolean
  availability?: string
  message?: string
  period?: string
  window_days?: number
  generated_at?: string
  rows?: ReportRow[]
  coverage?: { total: number; available: number; unavailable: number; note: string | null }
  report_version?: string
}

export default function PeriodicReport({ period = 'monthly' }: { period?: 'weekly' | 'monthly' }) {
  const { fetchMyReport } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<ReportPayload | null>(null)

  useEffect(() => {
    let cancelled = false
    // The reset is synchronous on purpose. It clears the previous payload before
    // the new request resolves, so a viewer never sees the last period's figures
    // sitting under this period's label — which on these surfaces would be exactly
    // the kind of misleading number the programme exists to remove. One extra
    // render on a window change is the right trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading')
    if (typeof fetchMyReport !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<ReportPayload>
    try {
      pending = Promise.resolve(fetchMyReport(period)) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: ReportPayload) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchMyReport, period])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="periodic-report-loading">
        <h3 className="text-sm font-semibold text-gray-700">Your summary</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || payload?.availability === 'unavailable') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="periodic-report-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Your summary</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="periodic-report-message">
            {payload?.message
              || 'This summary could not be produced. It is not a report of zero activity.'}
          </span>
        </p>
      </section>
    )
  }

  const rows = payload?.rows ?? []

  return (
    <section className="rounded-xl border bg-white p-5" data-testid="periodic-report">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            Your {payload?.period === 'weekly' ? 'weekly' : 'monthly'} summary
          </h3>
          <p className="text-xs text-gray-500">Covering the last {payload?.window_days ?? 30} days.</p>
        </div>
        {/* Server-rendered so the exported bytes are the API's own. */}
        <Button variant="outline" size="sm" className="gap-1" asChild>
          <a
            href={`/api/marketplace/my-report?period=${payload?.period || period}&format=csv`}
            data-testid="periodic-report-download"
          >
            <Download className="h-4 w-4" /> Download CSV
          </a>
        </Button>
      </div>

      {/* The gaps are stated before the numbers, not after them. */}
      {payload?.coverage?.note && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600"
           data-testid="periodic-report-coverage">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <span>{payload.coverage.note}</span>
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="periodic-report-table">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wider text-gray-500">
              <th className="py-2 pr-4">Metric</th>
              <th className="py-2 pr-4">Value</th>
              <th className="py-2">What it is not</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.key} data-testid={`report-row-${row.key}`}>
                <td className="py-2 pr-4 font-medium text-gray-900">{row.label}</td>
                <td className="py-2 pr-4" data-testid={`report-row-${row.key}-value`}>
                  {row.available
                    ? <span className="font-semibold text-gray-900">{row.value}</span>
                    : <span className="text-xs italic text-gray-500">Not measured</span>}
                </td>
                <td className="py-2 text-xs text-gray-600">{row.not}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 border-t pt-3 text-[11px] text-gray-400" data-testid="periodic-report-provenance">
        {payload?.report_version} · a metric shown as "Not measured" has no value in CarUp. It is not
        zero.
      </p>
    </section>
  )
}
