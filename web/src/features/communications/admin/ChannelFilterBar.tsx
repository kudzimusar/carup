// Channel filter/queue bar for the Command Center inbox (docs §5/§6).
// Registry-driven chips with live per-channel counts; selecting one narrows the inbox to that
// channel. Only channels that currently have threads are shown, most-active first, plus "All".

import { ChannelIcon } from '../ChannelIcon'
import { getChannel } from '../channelRegistry'

export interface ChannelFilterBarProps {
  counts: Record<string, number>
  active: string | null
  onSelect: (channel: string | null) => void
}

function chipClass(isActive: boolean): string {
  return `flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
    isActive ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
  }`
}

export function ChannelFilterBar({ counts, active, onSelect }: ChannelFilterBarProps) {
  const entries = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by channel">
      <button type="button" onClick={() => onSelect(null)} aria-pressed={active === null} className={chipClass(active === null)}>
        All
      </button>
      {entries.map(([channel, n]) => (
        <button
          key={channel}
          type="button"
          onClick={() => onSelect(active === channel ? null : channel)}
          aria-pressed={active === channel}
          title={getChannel(channel).label}
          className={chipClass(active === channel)}
        >
          <ChannelIcon channel={channel} size={12} decorative colored={active !== channel} />
          {getChannel(channel).shortLabel}
          <span className="tabular-nums opacity-70">{n}</span>
        </button>
      ))}
    </div>
  )
}
