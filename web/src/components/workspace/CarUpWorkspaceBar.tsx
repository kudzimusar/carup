import { useContext } from 'react'
import { Link } from 'react-router-dom'
import type { UserRole } from '@shared/types'
import { useAuth } from '@/context/AuthContext'
import { canRoleAccessRoute } from '@/config/featureRegistry'
import { cn } from '@/lib/utils'
import { WORKSPACES, type WorkspaceId } from './workspaceModel'
import { WorkspaceBarProvidedContext } from './workspaceBarContext'
import { WS_STYLE } from './workspaceStyles'

/**
 * The workspace layer: which of CarUp's three workspaces this page belongs to, and the way to the
 * others. It is the same component in the owner shell, the Trade shell and inside a page, so a user
 * can tell where they are without reading the address bar, and so "Trade & Imports" can never look
 * like one more tab on the Seller vehicle page.
 *
 * It is NAVIGATION, not authorization: a workspace is offered only if the role can open its root
 * (the same registry rule the shells already use), and the API still decides every read.
 *
 * Below `sm` the three names sit in an equal three-column grid so the active one is always on
 * screen — nothing scrolls sideways and nothing is hidden behind a menu.
 */
export function CarUpWorkspaceBar({
  active = null,
  tone = 'light',
  showAccount = true,
  className,
}: {
  /** The workspace this page belongs to. Omit on a page that belongs to none (the shared inbox). */
  active?: WorkspaceId | null
  tone?: 'light' | 'dark'
  /** The Trade shell already prints its own identity line, so it turns this off. */
  showAccount?: boolean
  className?: string
}) {
  const { user } = useAuth()
  // A shell that already drew the bar (the Trade shell) must not get a second one from the page.
  const providedByShell = useContext(WorkspaceBarProvidedContext)
  const role = ((user?.role as UserRole | undefined) ?? 'owner') as UserRole
  const dark = tone === 'dark'
  if (providedByShell) return null

  const entries = WORKSPACES.map((workspace) => ({
    workspace,
    isActive: workspace.id === active,
    reachable: canRoleAccessRoute(role, workspace.root),
  }))
    // A workspace the role cannot open is not offered — except the one the page is already in.
    .filter((entry) => entry.reachable || entry.isActive)

  const accountName = typeof user?.name === 'string' ? user.name.trim() : ''

  const itemBase = cn(
    'flex min-h-11 w-full items-center justify-center border-b-2 px-2 text-center text-[10px] font-black uppercase leading-tight tracking-[0.14em] transition-colors',
    'sm:justify-start sm:px-5 sm:text-[11px] sm:tracking-[0.18em]',
    WS_STYLE.focus,
    dark ? 'focus-visible:ring-offset-slate-950' : '',
  )
  const itemActive = dark ? 'border-orange-500 text-white' : 'border-orange-600 text-slate-950'
  const itemIdle = dark
    ? 'border-transparent text-slate-400 hover:border-slate-600 hover:text-orange-400'
    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-950'

  return (
    <nav
      aria-label="CarUp workspaces"
      data-testid="workspace-bar"
      data-active-workspace={active ?? ''}
      className={cn('flex items-stretch justify-between gap-4 border-b', dark ? 'border-slate-800' : 'border-slate-200', className)}
    >
      <ul className="grid min-w-0 flex-1 grid-cols-3 sm:flex sm:flex-none">
        {entries.map(({ workspace, isActive, reachable }) => {
          const classes = cn(itemBase, isActive ? itemActive : itemIdle)
          return (
            <li key={workspace.id} className="min-w-0 sm:shrink-0">
              {isActive && !reachable ? (
                <span aria-current="page" className={classes} data-testid={`workspace-${workspace.id}`}>
                  {workspace.label}
                </span>
              ) : (
                <Link
                  to={workspace.root}
                  aria-current={isActive ? 'page' : undefined}
                  title={workspace.summary}
                  className={classes}
                  data-testid={`workspace-${workspace.id}`}
                >
                  {workspace.label}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      {showAccount && accountName ? (
        <p
          className={cn('hidden items-center text-xs font-semibold sm:flex', dark ? 'text-slate-400' : 'text-slate-500')}
          data-testid="workspace-account"
        >
          {accountName}
        </p>
      ) : null}
    </nav>
  )
}
