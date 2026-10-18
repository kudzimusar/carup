/**
 * CA-OWNER-02 — leaving Corporate Admin for the operational Admin is an explicit transition between two authority models.
 *
 * Corporate Admin is admitted by the server from persistent Corporate memberships and permissions; the operational Admin
 * is authorised by the platform role (users.role). The link names where it goes and the line under it — announced as the
 * link's description — says what changes, so the Owner never crosses without knowing. The destination carries the arrival
 * marker (adminArrival) so the operational Admin can say where the visit came from. Nothing here decides access.
 */
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { OPERATIONAL_ADMIN_FROM_CORPORATE } from '@/components/admin/adminArrival'

const NOTE = 'Leaves Corporate Admin. Operational Admin works on live operational records under your platform role — Corporate permissions do not apply there.'

const TONE = {
  /** On the dark identity bar's Account panel. */
  dark: {
    link: 'inline-flex min-h-[40px] items-center gap-1.5 rounded border border-slate-600 px-3 text-xs font-medium hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400 max-sm:min-h-11',
    note: 'text-[11px] leading-snug text-slate-300',
  },
  /** At the foot of the light navigation rail (a full-width 44 px target, CA-K3-01-R2 D-2). */
  light: {
    link: '-mx-2 flex min-h-[44px] items-center gap-1.5 rounded px-2 font-medium text-slate-700 underline-offset-2 hover:bg-slate-50 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500',
    note: 'text-[11px] leading-snug text-slate-600',
  },
} as const

export function OperationalAdminTransition({ tone, testId, onNavigate, className }: {
  tone: keyof typeof TONE
  testId: string
  onNavigate?: () => void
  className?: string
}) {
  const noteId = useId()
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <Link to={OPERATIONAL_ADMIN_FROM_CORPORATE} onClick={onNavigate} aria-describedby={noteId} className={TONE[tone].link} data-testid={testId}>
        Open Operational Admin
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </Link>
      <p id={noteId} className={TONE[tone].note} data-testid={`${testId}-note`}>{NOTE}</p>
    </div>
  )
}
