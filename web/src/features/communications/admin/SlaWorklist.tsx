// SLA worklist / overview for the Command Center (plan §7 SLA loop).
// At-a-glance triage surface: a summary row of SLA-state counts (breached/due-soon/healthy/paused)
// over a prioritised list of threads ordered breached → due_soon → others, each a button that opens
// the thread and carries an SLA badge toned by its state. Presentational — the page supplies the
// precomputed threads + counts + the onOpen handler, so this stays pure and unit-testable.

import { Gauge } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChannelIcon } from '../ChannelIcon'
import { titleCase } from '../communicationFormatting'

export interface SlaWorklistThread {
  id: string
  title: string
  channel?: string | null
  slaLabel?: string
  slaState?: string
  reference?: string
}

export interface SlaWorklistProps {
  threads: SlaWorklistThread[]
  counts?: { breached?: number; due_soon?: number; healthy?: number; paused?: number }
  onOpen: (id: string) => void
  loading?: boolean
}

const SLA_KEYS = ['breached', 'due_soon', 'healthy', 'paused'] as const
type SlaKey = typeof SLA_KEYS[number]

// Summary tiles: coloured dot + label, in triage priority order.
const SUMMARY: Array<{ key: SlaKey; label: string; dot: string; text: string }> = [
  { key: 'breached', label: 'Breached', dot: 'bg-red-500', text: 'text-red-600' },
  { key: 'due_soon', label: 'Due soon', dot: 'bg-amber-500', text: 'text-amber-600' },
  { key: 'healthy', label: 'Healthy', dot: 'bg-green-500', text: 'text-green-600' },
  { key: 'paused', label: 'Paused', dot: 'bg-gray-400', text: 'text-gray-500' },
]

// Per-state badge label + colour. Unknown states fall back to a title-cased label + gray tone.
const SLA_BADGE: Record<SlaKey, { label: string; className: string }> = {
  breached: { label: 'Breached', className: 'bg-red-100 text-red-700 border-red-200' },
  due_soon: { label: 'Due soon', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  healthy: { label: 'Healthy', className: 'bg-green-100 text-green-700 border-green-200' },
  paused: { label: 'Paused', className: 'bg-gray-100 text-gray-600 border-gray-200' },
}
const FALLBACK_BADGE = 'bg-gray-100 text-gray-600 border-gray-200'

function normalizeState(state?: string): string {
  return String(state || '').toLowerCase()
}

// breached (0) → due_soon (1) → everything else (2). Array.prototype.sort is stable, so threads
// within the same rank keep the caller's order.
function rank(state?: string): number {
  const key = normalizeState(state)
  return key === 'breached' ? 0 : key === 'due_soon' ? 1 : 2
}

export function SlaWorklist({ threads, counts, onOpen, loading = false }: SlaWorklistProps) {
  // Derive counts from the threads as a fallback when the page doesn't pass explicit totals.
  const derived: Record<SlaKey, number> = { breached: 0, due_soon: 0, healthy: 0, paused: 0 }
  for (const thread of threads) {
    const key = normalizeState(thread.slaState)
    if ((SLA_KEYS as readonly string[]).includes(key)) derived[key as SlaKey] += 1
  }
  const countFor = (key: SlaKey): number => counts?.[key] ?? derived[key]

  const ordered = [...threads].sort((a, b) => rank(a.slaState) - rank(b.slaState))

  return (
    <Card className="border-0 card-shadow" data-testid="sla-worklist">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Gauge className="w-4 h-4" aria-hidden /> SLA worklist
          {threads.length > 0 && <Badge variant="secondary" className="ml-auto">{threads.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* At-a-glance SLA-state counts. */}
        <div className="grid grid-cols-4 gap-2" data-testid="sla-summary">
          {SUMMARY.map((item) => (
            <div
              key={item.key}
              className="rounded-lg border p-2 text-center"
              data-testid={`sla-summary-${item.key}`}
              data-count={countFor(item.key)}
            >
              <div className={`text-lg font-semibold tabular-nums ${item.text}`}>{countFor(item.key)}</div>
              <div className="flex items-center justify-center gap-1 text-[10px] text-gray-500">
                <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} aria-hidden />{item.label}
              </div>
            </div>
          ))}
        </div>

        {/* Prioritised thread list. */}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading SLA worklist…</p>
        ) : ordered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No threads under SLA watch.</p>
        ) : (
          <ul className="space-y-1.5">
            {ordered.map((thread) => {
              const key = normalizeState(thread.slaState)
              const meta = SLA_BADGE[key as SlaKey]
              const badgeLabel = thread.slaLabel || meta?.label || titleCase(thread.slaState) || 'SLA'
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(thread.id)}
                    data-testid="sla-row"
                    data-sla-state={thread.slaState}
                    aria-label={`Open ${thread.title}${thread.reference ? ` (${thread.reference})` : ''}`}
                    className="w-full flex items-center gap-3 rounded-lg border p-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <ChannelIcon channel={thread.channel} size={16} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{thread.title}</p>
                      {thread.reference && <p className="text-[11px] text-gray-400 font-mono truncate">{thread.reference}</p>}
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${meta?.className || FALLBACK_BADGE}`}>{badgeLabel}</Badge>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
