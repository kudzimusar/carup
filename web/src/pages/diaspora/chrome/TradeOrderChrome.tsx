import {
  WORKSPACE_SECTIONS,
  WorkspaceChrome,
  importOrderPath,
  roleCanOpen,
  useWorkspaceRole,
  workspaceCrumb,
  workspaceDefinition,
  type WorkspaceAction,
  type WorkspaceCrumb,
} from '@/components/workspace'

/**
 * T11-CAP-LR01-R3 — where a page that hangs off an import order sits, and the way back up.
 *
 *   Trade & Imports / Import Orders / <the order, named by its vehicle> / <this page>
 *   ← Back to import order                                      <adjacent capabilities →>
 *
 * With no `page` the ORDER is the page: the trail ends on it and the way up is the list.
 *
 * Every link — trail, way up and exits — is offered only if the viewer's role can open its destination (the
 * registry's rule). A step the role cannot open stays in the trail as plain text, so the trail is complete and
 * no one is handed a link that the router would turn away. This is chrome: it never reads or decides what the
 * page below it shows.
 */
export function TradeOrderChrome({
  orderId,
  orderLabel,
  page,
  exits = [],
  exitsLabel = 'Elsewhere for this order',
  hideParent = false,
  className,
}: {
  /** The import order this page belongs to. Null when it belongs to none (a vehicle with several orders, a read that failed). */
  orderId: string | null
  /** What the order is called in the trail — normally its vehicle. Null leaves the step out: nothing is known that may be shown. */
  orderLabel: string | null
  /** This page's own name. Null/omitted means the order itself is the page. */
  page?: string | null
  /** Adjacent capabilities. Each is dropped unless the role can open it. */
  exits?: WorkspaceAction[]
  exitsLabel?: string
  /** For a page that already carries its own labelled control back to the order, so there is one and not two. */
  hideParent?: boolean
  className?: string
}) {
  const role = useWorkspaceRole()
  const open = (path: string | null | undefined) => (path && roleCanOpen(role, path) ? path : undefined)

  const listHref = open(WORKSPACE_SECTIONS.importOrders.href)
  const orderHref = orderId ? open(importOrderPath(orderId)) : undefined

  const trail: WorkspaceCrumb[] = [
    { ...workspaceCrumb('trade'), href: open(workspaceDefinition('trade').root) },
    { label: WORKSPACE_SECTIONS.importOrders.label, href: listHref },
  ]
  // The order is the page when no page is named; it then needs a name even if the caller had none to offer.
  const label = orderLabel ?? (page ? null : 'Import order')
  if (label) trail.push({ label, href: page ? orderHref : undefined })
  if (page) trail.push({ label: page })

  const parent = page && orderHref
    ? { href: orderHref, label: 'Back to import order' }
    : listHref
      ? { href: listHref, label: 'Back to import orders' }
      : null

  const reachable = exits.filter((exit) => roleCanOpen(role, exit.href))

  return (
    <WorkspaceChrome
      workspace="trade"
      breadcrumbs={trail}
      parent={hideParent ? null : parent}
      exits={{ label: exitsLabel, actions: reachable }}
      className={className}
    />
  )
}
