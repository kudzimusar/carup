import type { ReactNode } from 'react'
import type { RateMetric } from '@/lib/garageBusiness'

/**
 * Small shared pieces of the Garage operations view.
 *
 * What they hold to:
 *  - a metric shows the server's own `definition` ("how this is counted") beside it;
 *  - a metric the server marks `not_measured` shows its REASON and nothing numeric — no number, no
 *    percentage, no 0 — because "not measured" is a different fact from "measured as zero".
 */

export function HowCounted({ definition }: { definition?: string | null }) {
  if (!definition) return null
  return (
    <details className="mt-1 text-xs text-gray-500">
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-2">How this is counted</summary>
      <p className="pb-2 max-w-prose">{definition}</p>
    </details>
  )
}

export function NotMeasured({ reason }: { reason?: string | null }) {
  return (
    <span data-testid="not-measured-value">
      <span className="font-medium text-gray-700">Not measured</span>
      {reason && <span className="mt-1 block text-sm font-normal text-gray-600">{reason}</span>}
    </span>
  )
}

/** One labelled figure with its definition. `children` is the value. */
export function Metric({ label, definition, testId, children }: {
  label: string
  definition?: string | null
  testId?: string
  children: ReactNode
}) {
  return (
    <div className="py-3 border-b border-gray-100" data-testid={testId}>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold">{children}</dd>
      <HowCounted definition={definition} />
    </div>
  )
}

/** A rate: shown only when the server measured it. Otherwise the reason, with no number at all. */
export function RateValue({ metric }: { metric: RateMetric }) {
  if (metric.state !== 'measured') return <NotMeasured reason={metric.reason} />
  return (
    <span>
      {metric.rate}%
      <span className="ml-2 text-sm font-normal text-gray-600">({metric.numerator} of {metric.denominator})</span>
    </span>
  )
}

export function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} data-testid={`ops-section-${id}`} className="border-t border-gray-200 pt-6">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">{title}</h2>
      {intro && <p className="mt-1 text-sm text-gray-600 max-w-prose">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function whenText(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
  } catch {
    return value
  }
}

export function dateTimeText(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  } catch {
    return value
  }
}

export function humanizeKey(key: string): string {
  return key.replaceAll('_', ' ')
}
