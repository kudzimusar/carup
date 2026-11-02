/**
 * OC-5D — the organisation a session acts for, chosen by the person.
 *
 * The server never picks one: login lists the memberships, and a session gains an organisation only
 * when the person selects it (PUT /api/auth/active-tenant), one tap even when there is only one. The
 * server re-verifies the selection on every request; when it stops holding (membership revoked,
 * organisation deactivated) the session says `tenant_context: 'revoked'` and the person is asked again.
 *
 * Three surfaces share one source of truth (`useAuth().user`):
 *   - OrganisationMenuSection — the "Acting for" block inside the account menu;
 *   - OrganisationBadge — the same block behind a compact control, for shells with no account menu;
 *   - ActiveOrganisationPrompt — a quiet banner when the person belongs to an organisation but is
 *     acting for themselves, or when the organisation they were acting for is no longer available.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Building2, ChevronDown, X } from 'lucide-react'
import type { TenantMembership } from '@shared/types'
import { useAuth } from '@/context/AuthContext'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

const ROLE_LABELS: Record<string, string> = {
  admin: 'administrator',
  mechanic: 'mechanic',
  dealer: 'dealer',
  member: 'member',
}

function roleLabel(role: string | null | undefined): string {
  if (!role) return 'member'
  return ROLE_LABELS[role] ?? role
}

function displayName(m: { name: string | null; id: string }): string {
  return m.name || 'Unnamed organisation'
}

function useSelectOrganisation() {
  const { selectActiveTenant } = useAuth()
  const [pending, setPending] = useState<string | null>(null)
  const choose = async (tenantId: string | null, label: string) => {
    setPending(tenantId ?? 'self')
    try {
      await selectActiveTenant(tenantId)
      toast.success(tenantId ? `You are now acting for ${label}.` : 'You are now acting for yourself.')
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Please try again.'
      toast.error(`Could not change organisation. ${message}`)
    } finally {
      setPending(null)
    }
  }
  return { choose, pending }
}

/** The "Acting for" block of the account menu. Renders nothing for a person with no memberships. */
export function OrganisationMenuSection() {
  const { user, refreshSession } = useAuth()
  const { choose, pending } = useSelectOrganisation()
  if (!user) return null
  const memberships: TenantMembership[] = user.memberships ?? []
  const activeId = user.active_tenant_id ?? null
  if (memberships.length === 0 && !activeId && !user.memberships_unavailable) return null

  const current = activeId ? (user.active_tenant?.name || memberships.find((m) => m.id === activeId)?.name || 'Your organisation') : 'Yourself'

  return (
    <div data-testid="organisation-menu">
      <div className="px-3 py-1.5 text-[10px] text-gray-400 font-bold uppercase tracking-wider">Acting for</div>
      <div className="px-3 pb-1.5 text-xs font-medium text-gray-900" data-testid="organisation-current">{current}</div>
      {user.memberships_unavailable && (
        <DropdownMenuItem
          className="cursor-pointer text-xs text-amber-700"
          onClick={() => { void refreshSession() }}
          data-testid="organisation-retry"
        >
          Your organisations could not be loaded. Retry
        </DropdownMenuItem>
      )}
      {memberships.map((m) => {
        if (m.id === activeId) return null
        if (!m.selectable) {
          return (
            <DropdownMenuItem key={m.id} disabled className="text-xs" data-testid={`organisation-unavailable-${m.id}`}>
              {displayName(m)} — not active
            </DropdownMenuItem>
          )
        }
        return (
          <DropdownMenuItem
            key={m.id}
            className="cursor-pointer text-xs"
            disabled={pending !== null}
            onClick={() => { void choose(m.id, displayName(m)) }}
            data-testid={`organisation-select-${m.id}`}
          >
            Act for {displayName(m)} ({roleLabel(m.role)})
          </DropdownMenuItem>
        )
      })}
      {activeId && (
        <DropdownMenuItem
          className="cursor-pointer text-xs"
          disabled={pending !== null}
          onClick={() => { void choose(null, 'yourself') }}
          data-testid="organisation-clear"
        >
          Act for yourself
        </DropdownMenuItem>
      )}
    </div>
  )
}

/** "Acting for …" with the switcher behind it — for the dashboard shells, which have no account menu. */
export function OrganisationBadge() {
  const { user } = useAuth()
  if (!user) return null
  const memberships = user.memberships ?? []
  if (memberships.length === 0 && !user.active_tenant_id && !user.memberships_unavailable) return null
  const label = user.active_tenant_id ? (user.active_tenant?.name || 'Your organisation') : 'Yourself'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-xs" aria-label={`Acting for ${label}. Change organisation`} data-testid="organisation-badge">
          <Building2 className="h-4 w-4" aria-hidden="true" />
          <span className="hidden max-w-[10rem] truncate sm:inline">{label}</span>
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <OrganisationMenuSection />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const DISMISS_KEY = 'carup_org_prompt_dismissed'

function readDismissed(userId: string): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === userId } catch { return false }
}

/**
 * A banner offering the person's organisations when they are acting for themselves — one tap to act
 * for one. Shown again (and not dismissible away) when the organisation they WERE acting for is no
 * longer available, because their requests for it are now refused.
 */
export function ActiveOrganisationPrompt() {
  const { user } = useAuth()
  const { choose, pending } = useSelectOrganisation()
  const [dismissedFor, setDismissedFor] = useState<string | null>(() => (user && readDismissed(user.id) ? user.id : null))
  if (!user || user.active_tenant_id) return null
  const selectable = (user.memberships ?? []).filter((m) => m.selectable)
  const revoked = user.tenant_context === 'revoked'
  if (selectable.length === 0 && !revoked) return null
  if (!revoked && dismissedFor === user.id) return null

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, user.id) } catch { /* per-tab convenience only */ }
    setDismissedFor(user.id)
  }

  return (
    <div
      role="region"
      aria-label="Choose an organisation"
      data-testid="organisation-prompt"
      className={`border-b px-4 py-2 text-sm ${revoked ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2">
        <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="mr-1" data-testid="organisation-prompt-message">
          {revoked
            ? 'Your access to the organisation you were acting for has changed.'
            : 'You are acting for yourself.'}
          {selectable.length > 0 ? ' To work for an organisation, choose it:' : ' You have no other organisation to act for.'}
        </span>
        {selectable.map((m) => (
          <Button
            key={m.id}
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={pending !== null}
            onClick={() => { void choose(m.id, displayName(m)) }}
            data-testid={`organisation-prompt-select-${m.id}`}
          >
            Act for {displayName(m)}
          </Button>
        ))}
        {!revoked && (
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto h-7 w-7"
            aria-label="Dismiss"
            onClick={dismiss}
            data-testid="organisation-prompt-dismiss"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}
