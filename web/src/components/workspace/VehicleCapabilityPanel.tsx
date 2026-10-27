import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VehicleCapabilities } from '@/types'
import { cn } from '@/lib/utils'
import {
  describeMarketplaceCapability,
  describeTradeImportCapability,
  type CapabilityAction,
  type CapabilityView,
} from './capabilityPresentation'
import { WS_STYLE } from './workspaceStyles'

function CapabilityCell({
  workspaceLabel,
  capability,
  view,
  actionTestId,
}: {
  workspaceLabel: string
  capability: 'marketplace' | 'trade-import'
  view: CapabilityView
  actionTestId: (action: CapabilityAction) => string
}) {
  const [primary, ...rest] = view.actions
  return (
    <div
      className={WS_STYLE.gridCell}
      data-testid={`capability-${capability}`}
      data-capability={capability}
      data-state={view.state}
    >
      <p className={WS_STYLE.gridLabel}>{workspaceLabel}</p>
      <p className={cn(WS_STYLE.gridValue, view.fault ? 'text-amber-800' : '')} role={view.fault ? 'status' : undefined}>
        {view.label}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{view.detail}</p>
      {primary ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">
          <Link
            to={primary.href}
            data-testid={actionTestId(primary)}
            className={cn(WS_STYLE.secondaryAction, WS_STYLE.focus)}
          >
            {primary.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {rest.map((action) => (
            <Link
              key={`${action.kind}|${action.href}`}
              to={action.href}
              data-testid={actionTestId(action)}
              className={cn('inline-flex min-h-11 items-center text-xs font-bold text-slate-600 hover:text-slate-950', WS_STYLE.focus)}
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The cells for a vehicle's capabilities, ready to sit inside an existing `gap-px` information grid
 * (My Garage embeds them next to "Relationship"; the Passport panel wraps them). Marketplace is
 * always present; Trade & Imports appears ONLY when the vehicle really has (or could not be
 * checked for) an import journey — a vehicle with none shows nothing about imports at all, so the
 * Serena never looks as if something is missing.
 */
export function VehicleCapabilityCells({
  vin,
  capabilities,
  actionTestId = (action) => `capability-action-${action.kind}`,
}: {
  vin: string
  capabilities: VehicleCapabilities | null | undefined
  /** Lets a host keep its own stable test ids (My Garage keeps `garage-manage-<vin>` and friends). */
  actionTestId?: (action: CapabilityAction) => string
}) {
  if (!capabilities) return null
  const marketplace = describeMarketplaceCapability(vin, capabilities.marketplace)
  const tradeImport = describeTradeImportCapability(vin, capabilities.trade_import)
  return (
    <>
      <CapabilityCell workspaceLabel="Marketplace" capability="marketplace" view={marketplace} actionTestId={actionTestId} />
      {tradeImport ? (
        <CapabilityCell workspaceLabel="Trade & Imports" capability="trade-import" view={tradeImport} actionTestId={actionTestId} />
      ) : null}
    </>
  )
}

/**
 * The Vehicle Passport's capability panel: the vehicle's two independent capabilities, side by
 * side, each with its own state and its own action. Neither cell reads the other — publication
 * does not change CAP, and an import order does not change the listing — which is the whole point
 * of showing them as two things instead of one row of unrelated buttons.
 */
export function VehicleCapabilityPanel({
  vin,
  capabilities,
  className,
}: {
  vin: string
  capabilities: VehicleCapabilities | null | undefined
  className?: string
}) {
  if (!capabilities) return null
  const hasTrade = describeTradeImportCapability(vin, capabilities.trade_import) !== null
  return (
    <section aria-labelledby="vehicle-capabilities-title" className={className} data-testid="vehicle-capability-panel">
      <h2 id="vehicle-capabilities-title" className={WS_STYLE.eyebrowQuiet}>What you can do with this vehicle</h2>
      <div className={cn(WS_STYLE.grid, 'mt-3 border border-slate-200', hasTrade ? 'sm:grid-cols-2' : '')}>
        <VehicleCapabilityCells vin={vin} capabilities={capabilities} />
      </div>
    </section>
  )
}
