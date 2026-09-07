import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Loader2, Wrench, ArrowRight } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'

export type GarageMembership = {
  tenantId: string
  tenantName: string | null
  tenantType: string | null
  tenantStatus: string | null
  role: string | null
  canOperate: boolean
}

/**
 * GMO-5 — entering a garage you belong to.
 *
 * Two things this closes.
 *
 * A founder whose application was approved while they were signed in previously had to log out and
 * back in before their workspace appeared, because the active membership was only ever resolved at
 * login. Switching here re-establishes the context on the spot.
 *
 * And a person may belong to several garages (PO-6). Login picks the oldest one; every other garage
 * was unreachable until there was somewhere to choose. That is this.
 *
 * The switch itself is the existing governed `POST /api/auth/switch-role`, which re-verifies the
 * membership server-side. Nothing here grants anything — it chooses between contexts the server
 * already says exist, and `canOperate` is the server's answer, not a judgment made in the browser.
 */
export default function GarageContextSwitcher({
  compact = false, onEntered,
}: { compact?: boolean; onEntered?: () => void }) {
  const { user, switchRole } = useAuth()
  const { fetchMyMemberships } = useCarUpApi()
  const navigate = useNavigate()

  const [garages, setGarages] = useState<GarageMembership[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [entering, setEntering] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchMyMemberships()
      .then((res: { garages?: GarageMembership[] }) => { setGarages(res?.garages ?? []); setState('ready') })
      // A failed read must never render as "you belong to no garage" — that is the exact lie this
      // codebase has already shipped once.
      .catch(() => setState('error'))
  }, [fetchMyMemberships])

  useEffect(() => { load() }, [load])

  async function enter(g: GarageMembership) {
    setEntering(g.tenantId); setError(null)
    try {
      // The platform role is unchanged — a garage admin is not a CarUp admin. What the switch
      // establishes is the TENANT context this person is a verified member of.
      await switchRole((user?.role ?? 'owner') as never, g.tenantId)
      onEntered?.()
      navigate('/garage')
    } catch (e) {
      setError(
        e instanceof Error
          ? `We could not open ${g.tenantName ?? 'that garage'}: ${e.message}`
          : 'That garage could not be opened just now.',
      )
    } finally { setEntering(null) }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-gray-600" role="status" aria-live="polite">
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
        Looking for your garages…
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm" data-testid="garages-error">
        <p className="font-medium text-gray-900">We could not check which garages you belong to.</p>
        <p className="text-gray-600 mt-1">This is a loading problem — it does not mean you belong to none.</p>
        <Button variant="outline" size="sm" className="min-h-11 mt-3" onClick={() => { setState('loading'); load() }}>
          Try again
        </Button>
      </div>
    )
  }

  const list = garages ?? []
  if (list.length === 0) return null

  const operable = list.filter((g) => g.canOperate)

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'} data-testid="garage-context-switcher">
      {!compact && list.length > 1 && (
        <p className="text-sm text-gray-600">
          You work with more than one garage. Choose the one you want to open.
        </p>
      )}

      <ul className="space-y-2" data-testid="garage-list">
        {list.map((g) => {
          const active = user?.active_tenant_id === g.tenantId
          return (
            <li key={g.tenantId}>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3" data-testid="garage-item">
                <div className="min-w-0 flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-orange-500 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{g.tenantName ?? 'Unnamed garage'}</p>
                    <p className="text-xs text-gray-500">
                      {/* The role held IN that garage — never presented as a CarUp-wide role. */}
                      {g.role ? `Your role here: ${g.role}` : 'Your role here is not recorded'}
                      {active && ' · currently open'}
                    </p>
                  </div>
                </div>

                {g.canOperate ? (
                  <Button
                    size="sm" className="min-h-11 bg-orange-500 hover:bg-orange-600"
                    onClick={() => enter(g)} disabled={entering !== null}
                    data-testid="enter-garage"
                  >
                    {entering === g.tenantId ? 'Opening…' : (active ? 'Open' : 'Switch to this garage')}
                    <ArrowRight className="w-4 h-4 ml-1" aria-hidden="true" />
                  </Button>
                ) : (
                  <span className="text-xs text-gray-500" data-testid="cannot-operate">
                    You belong to this garage but cannot work in it yet.
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {operable.length === 0 && (
        <p className="text-xs text-gray-500" data-testid="no-operable-garage">
          None of these give you a workshop to open yet. Whoever runs the garage can change your role.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="enter-garage-error">
          {error}
        </p>
      )}
    </div>
  )
}
