import { Mail } from 'lucide-react'
import type { JourneyDocumentDelivery, JourneyParties } from '@/hooks/useTradeLogisticsApi'
import { originLabel, partyLines } from '../capDisplay'
import { when } from '../journeyDisplay'
import { CapSection, Fact, Unshown } from './ui'

/**
 * §23.4 — where the ORIGINAL documents were sent and what is known about them, in the sender's own words.
 *
 * The sender's status phrase is the headline. A tracking number, a courier and a time appear only where one was supplied; where none was, the page
 * says "Not recorded" rather than leaving a gap that reads as an omission by CarUp. The sender's accompanying message is kept (it is theirs) but folded
 * away, because beside "Tracking number: Not recorded" it would read as a contradiction the sender, not CarUp, made.
 */
export function DocumentDelivery({ delivery, parties }: { delivery: JourneyDocumentDelivery | undefined; parties: JourneyParties | undefined }) {
  if (!delivery) return null
  const icon = <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  if (delivery.availability !== 'composed') {
    return <CapSection id="cap-delivery" title="Document delivery and tracking" icon={icon}><Unshown availability={delivery.availability} note={delivery.note} testId="cap-delivery-unshown" /></CapSection>
  }
  const address = parties?.availability === 'composed' ? parties.items.find((p) => p.role === 'DOCUMENT_DELIVERY') : undefined
  return (
    <CapSection id="cap-delivery" title="Document delivery and tracking" icon={icon}>
      {delivery.items.length ? (
        <ul className="mt-3 space-y-3">
          {delivery.items.map((d, i) => (
            <li key={`${d.status}-${i}`} className="min-w-0 rounded-lg border border-slate-200 p-3" data-testid={`cap-dispatch-${i}`}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid={`cap-dispatch-status-${i}`}>{d.status_reported_text || d.status_label}</p>
                <span className="inline-flex shrink-0 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-800">{d.status_label}</span>
              </div>
              <p className="mt-0.5 min-w-0 break-words text-sm text-slate-700">{d.document_labels.join(', ') || 'Documents'}</p>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Fact label="Tracking number" value={d.tracking_number} />
                <Fact label="Courier" value={d.courier} />
                <Fact label="Sent" value={d.dispatched_at ? when(d.dispatched_at) : null} />
                <Fact label="Delivered" value={d.delivered_at ? when(d.delivered_at) : null} />
              </dl>
              <p className="mt-2 min-w-0 break-words text-xs text-slate-500">{originLabel(d.origin, d.source_label)}{d.observed_at ? ` · as of ${when(d.observed_at)}` : ''}</p>
              {d.message ? (
                <details className="mt-2 min-w-0 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold">Message from the sender</summary>
                  <p className="mt-1 min-w-0 break-words" data-testid={`cap-dispatch-message-${i}`}>{d.message}</p>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="cap-delivery-none">No document dispatch is recorded for this purchase yet.</p>
      )}

      {address || delivery.contact ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {address ? (
            <div className="min-w-0 rounded-lg border border-slate-200 p-3" data-testid="cap-delivery-address">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{address.role_label}</p>
              <p className="mt-1 min-w-0 break-words text-sm font-semibold text-slate-900">{address.name}</p>
              <ul className="mt-1 space-y-0.5">{partyLines(address).map((l) => <li key={l} className="min-w-0 break-words text-sm text-slate-700">{l}</li>)}</ul>
            </div>
          ) : null}
          {delivery.contact ? (
            <div className="min-w-0 rounded-lg border border-slate-200 p-3" data-testid="cap-delivery-contact">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document centre</p>
              <p className="mt-1 min-w-0 break-words text-sm font-semibold text-slate-900">{delivery.contact.name}</p>
              <ul className="mt-1 space-y-0.5">{partyLines({ address: null, city: delivery.contact.city, country: delivery.contact.country, phone: delivery.contact.phone, email: delivery.contact.email }).map((l) => <li key={l} className="min-w-0 break-words text-sm text-slate-700">{l}</li>)}</ul>
              <p className="mt-1.5 min-w-0 break-words text-xs text-slate-600">{delivery.contact.note}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="cap-delivery-note">{delivery.note}</p>
    </CapSection>
  )
}
