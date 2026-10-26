import { Users } from 'lucide-react'
import type { JourneyParties, JourneyParty } from '@/hooks/useTradeLogisticsApi'
import { originLabel, partyLines } from '../capDisplay'
import { CapSection, Unshown } from './ui'

function PartyCard({ party }: { party: JourneyParty }) {
  const lines = partyLines(party)
  return (
    <li className="min-w-0 rounded-lg border border-slate-200 p-3" data-testid={`cap-party-${party.role}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{party.role_label}</p>
      <p className="mt-1 min-w-0 break-words text-sm font-semibold text-slate-900">{party.name}</p>
      {lines.length ? (
        <ul className="mt-1 space-y-0.5">
          {lines.map((line) => <li key={line} className="min-w-0 break-words text-sm text-slate-700">{line}</li>)}
        </ul>
      ) : null}
      {party.note ? <p className="mt-1 min-w-0 break-words text-xs text-slate-600">{party.note}</p> : null}
      <p className="mt-1.5 min-w-0 break-words text-xs text-slate-500">{originLabel(party.origin, party.source_label)}</p>
    </li>
  )
}

/**
 * §23.3 — who the paperwork names as consignee and notify party. Declared, not verified: the section says so, and says that naming a party changes
 * nothing about who the buyer is. Personal contact details that were deliberately never stored are not drawn — the party's note says where they live.
 */
export function TransactionParties({ parties }: { parties: JourneyParties | undefined }) {
  if (!parties) return null
  if (parties.availability !== 'composed') {
    return <CapSection id="cap-parties" title="Consignee and notify party" icon={<Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}><Unshown availability={parties.availability} note={parties.note} testId="cap-parties-unshown" /></CapSection>
  }
  const shown = parties.items.filter((p) => p.role === 'CONSIGNEE' || p.role === 'NOTIFY_PARTY')
  return (
    <CapSection id="cap-parties" title="Consignee and notify party" icon={<Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}>
      {shown.length ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">{shown.map((p) => <PartyCard key={p.role} party={p} />)}</ul>
      ) : (
        <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="cap-parties-none">No consignee or notify party is recorded for this purchase yet.</p>
      )}
      <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="cap-parties-note">{parties.note}</p>
    </CapSection>
  )
}
