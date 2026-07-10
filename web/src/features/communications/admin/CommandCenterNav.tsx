// Section navigation for the Command Center nested routes (plan §5).
// Renders addressable, deep-linkable section tabs (Inbox / Queues / Recovery / SLA / Audit /
// Providers / Settings) as router links so each surface survives a refresh and is shareable.

import { Link } from 'react-router-dom'
import { FileClock, Inbox, LayoutGrid, LifeBuoy, Radio, Settings, Timer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { COMMAND_CENTER_SECTIONS, type CommandCenterSection } from './commandCenterSections'

const SECTION_META: Record<CommandCenterSection, { label: string; Icon: LucideIcon }> = {
  inbox: { label: 'Inbox', Icon: Inbox },
  queues: { label: 'Queues', Icon: LayoutGrid },
  recovery: { label: 'Recovery', Icon: LifeBuoy },
  sla: { label: 'SLA', Icon: Timer },
  audit: { label: 'Audit', Icon: FileClock },
  providers: { label: 'Providers', Icon: Radio },
  settings: { label: 'Settings', Icon: Settings },
}

export interface CommandCenterNavProps {
  /** Base path of the Command Center, e.g. "/admin/communications". */
  basePath: string
  active: CommandCenterSection
  /** Optional per-section counters (e.g. recovery total, sla breaches). */
  badges?: Partial<Record<CommandCenterSection, number>>
}

export function CommandCenterNav({ basePath, active, badges = {} }: CommandCenterNavProps) {
  return (
    <nav className="flex flex-wrap gap-1 border-b pb-2" aria-label="Command Center sections" data-testid="command-center-nav">
      {COMMAND_CENTER_SECTIONS.map((section) => {
        const { label, Icon } = SECTION_META[section]
        const to = section === 'inbox' ? basePath : `${basePath}/${section}`
        const isActive = active === section
        const badge = badges[section]
        return (
          <Link
            key={section}
            to={to}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`section-${section}`}
            data-active={isActive ? 'true' : undefined}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${isActive ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Icon className="w-4 h-4" aria-hidden />
            {label}
            {typeof badge === 'number' && badge > 0 && (
              <span className={`text-[10px] font-semibold tabular-nums rounded-full px-1.5 ${isActive ? 'bg-white/20' : 'bg-gray-200 text-gray-600'}`}>{badge}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
