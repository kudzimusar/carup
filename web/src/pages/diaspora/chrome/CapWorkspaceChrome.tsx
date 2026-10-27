import { vehiclePassportPath } from '@/components/workspace'
import type { Journey } from '@/hooks/useTradeLogisticsApi'
import { vehicleTitle } from '../journeyDisplay'
import { TradeOrderChrome } from './TradeOrderChrome'

/** The page's own name, the same words as its eyebrow, so the trail ends on what the heading above it says. */
const PAGE_NAME = 'Journey & arrival'

/**
 * T11-CAP-LR01-R3 — the import journey (CAP) is a page of an import order. CHROME ONLY: nothing in the journey's
 * content, wording or evidence is read or changed here.
 *
 *   Trade & Imports / Import Orders / <vehicle> / Journey & arrival
 *   ← Back to import order                                   View Vehicle Passport →
 *
 * The Passport link needs more than a role: `vehicleVin` is passed in only once the order endpoint has shown
 * this viewer owns the vehicle (see useOrderVehicle). `journey` is null while the page is in its "could not be
 * read" state: the trail is then generic and says nothing about an order or vehicle the viewer was refused.
 * With a vehicle but no single order (the chooser) the vehicle is a plain step in the trail and the way up is
 * the list.
 */
export function CapWorkspaceChrome({ journey, vehicleVin }: { journey: Journey | null; vehicleVin: string | null }) {
  return (
    <TradeOrderChrome
      orderId={journey?.subject.order_id || null}
      orderLabel={journey ? vehicleTitle(journey.asset) : null}
      page={PAGE_NAME}
      exitsLabel="Elsewhere for this vehicle"
      exits={vehicleVin ? [{ label: 'View Vehicle Passport', href: vehiclePassportPath(vehicleVin), testId: 'cap-vehicle-passport-link' }] : []}
    />
  )
}
