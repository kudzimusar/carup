import { MapPinned } from 'lucide-react'
import type { Journey } from '@/hooks/useTradeLogisticsApi'
import { originLabel, partyLines } from '../capDisplay'
import { destinationFacts } from '../journeyDisplay'
import { CapSection, Fact } from './ui'

/**
 * §23.7 — where the vehicle is going and who is named as its agent.
 *
 * The destination is a fact about the ORDER and the port of discharge a fact about the SHIPMENT: neither is the other, and neither is customs. An
 * agent named on the sender's paperwork is not a clearing agent appointed through CarUp, and the card says so; CarUp's own clearing agent, where one
 * has been appointed, is shown with the customs record.
 */
export function DestinationAgent({ journey }: { journey: Journey }) {
  const destination = destinationFacts(journey)
  const agent = journey.contacts?.parties?.availability === 'composed' ? journey.contacts.parties.items.find((p) => p.role === 'DESTINATION_AGENT') : undefined
  const clearing = journey.contacts?.agents && journey.contacts.agents.availability === 'composed' ? journey.contacts.agents.items : []
  if (!journey.transaction && !agent && !clearing.length) return null
  const lines = agent ? partyLines(agent) : []
  return (
    <CapSection id="cap-destination" title="Destination, delivery and agent" icon={<MapPinned className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}>
      {journey.transaction ? (
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="cap-destination-facts">
          <Fact label="Destination (on the order)" value={destination.place} />
          {destination.showPort ? <Fact label="Port of discharge (shipment record)" value={destination.port} /> : null}
        </dl>
      ) : null}
      {agent ? (
        <div className="mt-4 min-w-0 rounded-lg border border-slate-200 p-3" data-testid="cap-destination-agent">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{agent.role_label}</p>
          <p className="mt-1 min-w-0 break-words text-sm font-semibold text-slate-900">{agent.name}</p>
          {lines.length ? <ul className="mt-1 space-y-0.5">{lines.map((l) => <li key={l} className="min-w-0 break-words text-sm text-slate-700">{l}</li>)}</ul> : null}
          {agent.origin === 'external_report' ? (
            <p className="mt-1 min-w-0 break-words text-xs text-slate-600" data-testid="cap-destination-agent-note">
              The agent named on the sender&rsquo;s paperwork. This is not a clearing agent appointed through CarUp.
            </p>
          ) : null}
          <p className="mt-1.5 min-w-0 break-words text-xs text-slate-500">{originLabel(agent.origin, agent.source_label)}</p>
        </div>
      ) : null}
      {clearing.length ? (
        <ul className="mt-4 space-y-2" data-testid="cap-destination-clearing">
          {clearing.map((a, i) => (
            <li key={`${a.display_name}-${i}`} className="min-w-0 rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{a.role}</p>
              <p className="mt-1 min-w-0 break-words text-sm font-semibold text-slate-900">{a.display_name}</p>
              {a.note ? <p className="mt-0.5 min-w-0 break-words text-xs text-slate-600">{a.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </CapSection>
  )
}
