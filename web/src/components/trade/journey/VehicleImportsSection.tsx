/**
 * RX06-LR04 CAP S1c — the owner's Vehicle Passport › "Trade & imports" (see vehicleImports.ts for the rules).
 * Renders nothing unless the vehicle is on an import order this account may open, or the check itself failed.
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { OWNER_FOCUS } from '@/components/owner/OwnerPageHeader'
import { formatDay, shortRef, statusLabel, type Read } from '../order/orderModel'
import { describeVehicleImports } from './vehicleImports'
import type { Journey } from './journeyTypes'

const ROW_LINK = `flex min-h-11 items-center justify-between gap-3 rounded-md text-carup-text hover:text-carup-action-hover ${OWNER_FOCUS}`

export function VehicleImportsSection({ read }: { read: Read<Journey> }) {
  const view = describeVehicleImports(read)
  if (!view) return null
  return (
    <section className="rounded-2xl bg-carup-bg-raised p-5 ring-1 ring-carup-line" aria-labelledby="passport-imports-title" data-testid="passport-imports" data-state={view.kind}>
      <h2 id="passport-imports-title" className="text-[15px] font-semibold text-carup-text">Trade &amp; imports</h2>
      {view.kind === 'single' && (
        <>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">CarUp’s movement record</p>
          <div className="mt-1"><StatusChip tone={view.tone} testId="passport-imports-state">{view.headline}</StatusChip></div>
          {view.reportedLine && <p className="mt-2 text-[13px] leading-5 text-carup-text-2" data-testid="passport-imports-reported">{view.reportedLine}</p>}
          <p className="mt-2 text-[13px] leading-5 text-carup-text-2">This vehicle is on an import order. What CarUp recorded, and what others report, is on its Journey &amp; arrival.</p>
          <ul className="mt-1 text-[14px]">
            <li><Link to={view.journeyHref} className={ROW_LINK} data-testid="passport-imports-journey">Journey &amp; arrival<ArrowRight className="h-3.5 w-3.5 shrink-0 text-carup-text-3" aria-hidden="true" /></Link></li>
            <li><Link to={view.orderHref} className={ROW_LINK} data-testid="passport-imports-order">Import order <span className="sr-only">{shortRef(view.orderId)}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-carup-text-3" aria-hidden="true" /></Link></li>
          </ul>
        </>
      )}
      {view.kind === 'multiple' && (
        <>
          <p className="mt-2 text-[13px] leading-5 text-carup-text-2">More than one import order includes this vehicle. Choose the one you want to open.</p>
          <ul className="mt-1 text-[14px]">
            {view.candidates.map(c => (
              <li key={c.orderId}>
                <Link to={c.href} className={ROW_LINK} data-testid="passport-imports-candidate">
                  <span className="min-w-0">
                    <span className="font-semibold">Order <code className="font-mono text-[13px]">{shortRef(c.orderId)}</code></span>
                    <span className="block text-[12px] text-carup-text-3">{statusLabel(c.status)}{formatDay(c.createdAt) ? ` · started ${formatDay(c.createdAt)}` : ''}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-carup-text-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {view.kind === 'unavailable' && (
        <div className="mt-2 space-y-2" data-testid="passport-imports-unavailable" role="status">
          <p className="text-[14px] font-semibold text-carup-text">Import status unavailable</p>
          <p className="text-[13px] leading-5 text-carup-text-2">CarUp could not check this vehicle’s import orders just now. This is not a report that there are none.</p>
          {view.onRetry && (
            <button type="button" onClick={view.onRetry} className={`inline-flex min-h-11 items-center rounded-md text-[14px] font-semibold text-carup-action underline-offset-4 hover:underline ${OWNER_FOCUS}`} data-testid="passport-imports-retry">
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  )
}
