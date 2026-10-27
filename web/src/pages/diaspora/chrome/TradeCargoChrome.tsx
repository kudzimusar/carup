import {
  WORKSPACE_SECTIONS,
  WorkspaceChrome,
  roleCanOpen,
  useWorkspaceRole,
  workspaceCrumb,
  workspaceDefinition,
  type WorkspaceCrumb,
} from '@/components/workspace'

/** The subjects the import journey (CAP) can be opened for. Anything else has no journey to go up to. */
const JOURNEY_SUBJECTS = new Set(['import_order', 'cargo_reservation', 'shipment'])

const JOURNEY_NAME = 'Journey & arrival'

/**
 * T11-CAP-LR01-R3 — a page about one cargo booking's own movement or customs hangs off that booking's import
 * journey. These pages do not know the order (and must not go and find it), but the journey is addressable from
 * the booking, so the way up is the journey:
 *
 *   Trade & Imports / Journey & arrival / <this page>
 *   ← Back to journey & arrival
 *
 * Offered only if the role can open the journey. With no journey to go up to (a role that cannot open it, or a
 * subject the journey does not take) the trail is still complete as text and the way up is the order list, when
 * the role has one. CHROME ONLY: the page's content is neither read nor changed.
 */
export function TradeCargoChrome({
  subjectType,
  subjectId,
  page,
  className,
}: {
  subjectType: string
  subjectId: string
  page: string
  className?: string
}) {
  const role = useWorkspaceRole()
  const open = (path: string | null | undefined) => (path && roleCanOpen(role, path) ? path : undefined)

  const journeyPath = subjectId && JOURNEY_SUBJECTS.has(subjectType)
    ? `/diaspora/journey/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}`
    : null
  const journeyHref = open(journeyPath)
  const listHref = open(WORKSPACE_SECTIONS.importOrders.href)

  const trail: WorkspaceCrumb[] = [{ ...workspaceCrumb('trade'), href: open(workspaceDefinition('trade').root) }]
  if (journeyPath) trail.push({ label: JOURNEY_NAME, href: journeyHref })
  trail.push({ label: page })

  const parent = journeyHref
    ? { href: journeyHref, label: 'Back to journey & arrival' }
    : listHref
      ? { href: listHref, label: 'Back to import orders' }
      : null

  return <WorkspaceChrome workspace="trade" breadcrumbs={trail} parent={parent} className={className} />
}
