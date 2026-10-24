import { History } from 'lucide-react'
import type { CaseHub } from '@/lib/garageBusiness'
import { caseEventLabel, caseStatusLabel, dateTimeLabel } from '@/lib/garageWorkspace'
import { HubSection } from './hubUi'

/** What has happened to this case, newest first, exactly as the case log recorded it. */
export function CaseHistory({ hub }: { hub: CaseHub }) {
  const events = [...hub.history].reverse()
  return (
    <HubSection id="history" title="Case history" testId="case-history">
      {events.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="case-history-empty">Nothing has been logged on this case yet.</p>
      ) : (
        <ol className="space-y-2" data-testid="case-history-list">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex items-start gap-2 text-sm" data-testid="case-history-event">
              <History className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="font-medium">{caseEventLabel(e.event_type)}</span>
                {e.from_status && e.to_status && (
                  <span className="text-gray-600"> — {caseStatusLabel(e.from_status)} to {caseStatusLabel(e.to_status)}</span>
                )}
                <span className="block text-xs text-gray-500">{dateTimeLabel(e.at)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </HubSection>
  )
}
