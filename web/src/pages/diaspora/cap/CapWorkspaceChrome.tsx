import {
  WORKSPACE_SECTIONS,
  WorkspaceChrome,
  importOrderPath,
  roleCanOpen,
  useWorkspaceRole,
  vehiclePassportPath,
  workspaceCrumb,
  workspaceDefinition,
  type WorkspaceAction,
  type WorkspaceCrumb,
} from '@/components/workspace'
import type { Journey } from '@/hooks/useTradeLogisticsApi'
import { vehicleTitle } from '../journeyDisplay'

/** The page's own name, the same words as its eyebrow, so the trail ends on what the heading above it says. */
const PAGE_NAME = 'Journey & arrival'

/**
 * T11-CAP-LR01-R3 — where the import journey sits, and the ways out of it. CHROME ONLY: nothing in the journey's
 * content, wording or evidence is read or changed here.
 *
 *   Trade & Imports / Import Orders / <the vehicle's order> / Journey & arrival
 *   ← Back to import order                                   View Vehicle Passport →
 *
 * Every link is offered only if this role can open its destination (the registry's rule), so a dealer or
 * reviewer who may read the journey is never handed a link to an owner-only page. A step the viewer cannot open
 * stays in the trail as plain text, so the trail is still complete. The Passport link needs more than a role: it
 * is passed in only once the order endpoint has shown this viewer owns the vehicle (see useOrderVehicleLink).
 *
 * `journey` is null while the page is in its "could not be read" state: the trail is then generic, and says
 * nothing about an order or vehicle the viewer was refused.
 */
export function CapWorkspaceChrome({ journey, vehicleVin }: { journey: Journey | null; vehicleVin: string | null }) {
  const role = useWorkspaceRole()
  const open = (path: string | null) => (path && roleCanOpen(role, path) ? path : undefined)

  const orderId = journey?.subject.order_id || null
  const listHref = open(WORKSPACE_SECTIONS.importOrders.href)
  const orderHref = orderId ? open(importOrderPath(orderId)) : undefined
  const passportHref = vehicleVin ? open(vehiclePassportPath(vehicleVin)) : undefined

  const trail: WorkspaceCrumb[] = [
    { ...workspaceCrumb('trade'), href: open(workspaceDefinition('trade').root) },
    { label: WORKSPACE_SECTIONS.importOrders.label, href: listHref },
  ]
  // The vehicle names the order (a UUID names nothing). With no single order — the chooser — it is the vehicle's trail.
  if (journey) trail.push({ label: vehicleTitle(journey.asset), href: orderHref })
  trail.push({ label: PAGE_NAME })

  const parent = orderHref
    ? { href: orderHref, label: 'Back to import order' }
    : listHref
      ? { href: listHref, label: 'Back to import orders' }
      : null

  const exits: WorkspaceAction[] = passportHref
    ? [{ label: 'View Vehicle Passport', href: passportHref, testId: 'cap-vehicle-passport-link' }]
    : []

  return <WorkspaceChrome workspace="trade" breadcrumbs={trail} parent={parent} exits={{ label: 'Elsewhere for this vehicle', actions: exits }} />
}
