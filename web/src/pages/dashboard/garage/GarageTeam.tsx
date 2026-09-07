import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, UserPlus, Copy, Check, X, UserMinus } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SN_PAGE, SN_FORM_COLUMN } from '@/lib/serviceNetworkLayout'

type Invitation = {
  id: string
  invited_email: string
  invited_name: string | null
  role: string
  expires_at: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  created_at: string
}

const STATUS_TONE: Record<Invitation['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-green-100 text-green-800',
  revoked: 'bg-gray-100 text-gray-700',
  expired: 'bg-gray-100 text-gray-700',
}

type Member = {
  membershipId: string
  userId: string
  displayName: string | null
  email: string | null
  role: string | null
  joinedAt: string | null
  removable: boolean
}

const STATUS_LABEL: Record<Invitation['status'], string> = {
  pending: 'Waiting for them',
  accepted: 'Joined',
  revoked: 'Cancelled',
  expired: 'Expired',
}

/**
 * GMO-6 — the garage's own people.
 *
 * The link is shown exactly once, on the screen, and never again. That is not an inconvenience to
 * design around — it is the reason the token can be stored hashed, so that a leaked database, backup
 * or query log reveals who was invited but never how to accept. A garage that loses the link cancels
 * and invites again.
 *
 * The page also does not pretend CarUp sent anything. Delivery is the garage's to do, by whatever
 * they and their mechanic already use, and saying otherwise would leave someone waiting for a
 * message that never arrives.
 */
export default function GarageTeam() {
  const {
    listGarageInvitations, createGarageInvitation, revokeGarageInvitation,
    listGarageMembers, removeGarageMember, changeGarageMemberRole,
  } = useCarUpApi()

  const [invitations, setInvitations] = useState<Invitation[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('mechanic')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ email: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [membersState, setMembersState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(() => {
    listGarageInvitations()
      .then((res: { invitations?: Invitation[] }) => { setInvitations(res?.invitations ?? []); setState('ready') })
      .catch(() => setState('error'))
  }, [listGarageInvitations])

  const loadMembers = useCallback(() => {
    listGarageMembers()
      .then((res: { members?: Member[] }) => { setMembers(res?.members ?? []); setMembersState('ready') })
      // Presenting an outage as "this garage has no members" would let an administrator conclude
      // their team had vanished.
      .catch(() => setMembersState('error'))
  }, [listGarageMembers])

  useEffect(() => { load(); loadMembers() }, [load, loadMembers])

  async function removeMember(userId: string, label: string) {
    setBusy(userId); setError(null)
    try { await removeGarageMember(userId); loadMembers() }
    catch (err) {
      setError(err instanceof Error ? `${label} was not removed: ${err.message}` : `${label} was not removed.`)
    } finally { setBusy(null) }
  }

  async function changeRole(userId: string, nextRole: string) {
    setBusy(userId); setError(null)
    try { await changeGarageMemberRole(userId, nextRole); loadMembers() }
    catch (err) {
      setError(err instanceof Error ? err.message : 'That role was not changed.')
    } finally { setBusy(null) }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy('invite'); setError(null); setIssued(null); setCopied(false)
    try {
      const res = await createGarageInvitation({ email: email.trim(), name: name.trim() || undefined, role })
      if (res?.token) {
        setIssued({
          email: email.trim(),
          link: `${window.location.origin}/join-garage?token=${encodeURIComponent(res.token)}`,
        })
      }
      setEmail(''); setName('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That invitation could not be created.')
    } finally { setBusy(null) }
  }

  async function revoke(id: string) {
    setBusy(id); setError(null)
    try { await revokeGarageInvitation(id); load() }
    catch (err) { setError(err instanceof Error ? err.message : 'That invitation could not be cancelled.') }
    finally { setBusy(null) }
  }

  async function copyLink() {
    if (!issued) return
    try { await navigator.clipboard.writeText(issued.link); setCopied(true) }
    catch { setCopied(false) }
  }

  return (
    <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Your team</h1>
        <p className="text-sm text-gray-600 mt-1">
          Invite the mechanics who work with you. They will be able to take jobs and record the work
          they do.
        </p>
      </div>

      <form onSubmit={invite} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3" data-testid="invite-form">
        <div>
          <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 mb-1">
            Their email address
          </label>
          <input
            id="invite-email" data-testid="invite-email" type="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
            placeholder="thabo@example.com"
          />
          <p className="text-xs text-gray-500 mt-1">
            They must sign in with this address to accept — that is what stops the link working for
            anyone else.
          </p>
        </div>

        <div>
          <label htmlFor="invite-name" className="block text-sm font-medium text-gray-700 mb-1">
            Their name <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="invite-name" data-testid="invite-name" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
          />
        </div>

        <div>
          <label htmlFor="invite-role" className="block text-sm font-medium text-gray-700 mb-1">
            What they will do here
          </label>
          <select
            id="invite-role" data-testid="invite-role" value={role} onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px] bg-white"
          >
            <option value="mechanic">Mechanic — takes jobs and records work</option>
            <option value="admin">Administrator — can also invite and manage the garage</option>
          </select>
        </div>

        <Button
          type="submit" className="min-h-11 bg-orange-500 hover:bg-orange-600"
          disabled={busy === 'invite' || !email.trim()} data-testid="send-invite"
        >
          <UserPlus className="w-4 h-4 mr-1" aria-hidden="true" />
          {busy === 'invite' ? 'Creating…' : 'Create invitation'}
        </Button>
      </form>

      {issued && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-5" data-testid="issued-link">
          <p className="font-medium text-orange-900">Send this link to {issued.email}</p>
          <p className="text-sm text-orange-900 mt-1">
            {/* Said plainly: the garage delivers it. Implying CarUp sent a message nobody sent
                leaves a mechanic waiting for something that will never arrive. */}
            CarUp has not sent them anything. Copy this link and send it however you normally reach
            them — it works once, and only for that email address.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <code className="text-xs bg-white border border-orange-200 rounded px-2 py-1 break-all flex-1 min-w-0" data-testid="invite-link">
              {issued.link}
            </code>
            <Button variant="outline" className="min-h-11" onClick={copyLink} data-testid="copy-link">
              {copied ? <Check className="w-4 h-4 mr-1" aria-hidden="true" /> : <Copy className="w-4 h-4 mr-1" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-orange-800 mt-2">
            You will not be able to see this link again. If you lose it, cancel the invitation and
            create a new one.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="invite-error">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5" data-testid="members-panel">
        <h2 className="font-medium text-gray-900">People who work here</h2>

        {membersState === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-gray-600 mt-3" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
            Loading…
          </div>
        )}

        {membersState === 'error' && (
          <div className="mt-3" data-testid="members-error">
            <p className="text-sm text-gray-900 font-medium">Your team could not be loaded.</p>
            <p className="text-sm text-gray-600">
              This is a loading problem — it does not mean your team is empty.
            </p>
            <Button variant="outline" size="sm" className="min-h-11 mt-2" onClick={() => { setMembersState('loading'); loadMembers() }}>
              Try again
            </Button>
          </div>
        )}

        {membersState === 'ready' && (
          <ul className="mt-3 space-y-2" data-testid="member-list">
            {(members ?? []).map((m) => {
              const label = m.displayName ?? m.email ?? 'This person'
              return (
                <li key={m.membershipId} className="flex flex-wrap items-center justify-between gap-2 border-b last:border-0 pb-2" data-testid="member-item">
                  <div className="min-w-0">
                    {/* A member whose name cannot be resolved is unnamed, never given an invented one. */}
                    <p className="text-sm text-gray-900 truncate">{m.displayName ?? <span className="text-gray-500">Unnamed member</span>}</p>
                    <p className="text-xs text-gray-500 truncate">{m.email ?? 'No email recorded'} · {m.role ?? 'role not recorded'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={m.role ?? 'mechanic'} data-testid="member-role"
                      onChange={(e) => changeRole(m.userId, e.target.value)}
                      disabled={busy === m.userId}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs min-h-[44px] bg-white"
                      aria-label={`Role for ${label}`}
                    >
                      <option value="mechanic">Mechanic</option>
                      <option value="admin">Administrator</option>
                    </select>
                    {m.removable ? (
                      <Button
                        variant="outline" size="sm" className="min-h-11 text-red-700 hover:text-red-800"
                        onClick={() => removeMember(m.userId, label)} disabled={busy === m.userId}
                        data-testid="remove-member"
                      >
                        <UserMinus className="w-4 h-4 mr-1" aria-hidden="true" /> Remove
                      </Button>
                    ) : (
                      // Server-derived. A garage with nobody who can manage it is one no product
                      // path can restore.
                      <span className="text-xs text-gray-500" data-testid="not-removable">
                        The only administrator
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
            {(members ?? []).length === 0 && (
              <li className="text-sm text-gray-600" data-testid="members-empty">
                It is just you so far.
              </li>
            )}
          </ul>
        )}

        <p className="text-xs text-gray-500 mt-3">
          Removing someone stops them taking new jobs here. The work they have already done stays on
          every car's service record.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Invitations</h2>

        {state === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-gray-600 mt-3" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
            Loading…
          </div>
        )}

        {state === 'error' && (
          <div className="mt-3" data-testid="invitations-error">
            <p className="text-sm text-gray-900 font-medium">These could not be loaded.</p>
            <p className="text-sm text-gray-600">
              This is a loading problem — it does not mean you have invited nobody.
            </p>
            <Button variant="outline" size="sm" className="min-h-11 mt-2" onClick={() => { setState('loading'); load() }}>
              Try again
            </Button>
          </div>
        )}

        {state === 'ready' && (invitations?.length ? (
          <ul className="mt-3 space-y-2" data-testid="invitation-list">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 border-b last:border-0 pb-2" data-testid="invitation-item">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 truncate">
                    {inv.invited_name ? `${inv.invited_name} · ` : ''}{inv.invited_email}
                  </p>
                  <p className="text-xs text-gray-500">as {inv.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_TONE[inv.status]} data-testid="invitation-status">
                    {STATUS_LABEL[inv.status]}
                  </Badge>
                  {inv.status === 'pending' && (
                    <Button
                      variant="outline" size="sm" className="min-h-11 text-red-700 hover:text-red-800"
                      onClick={() => revoke(inv.id)} disabled={busy === inv.id} data-testid="revoke-invite"
                    >
                      <X className="w-4 h-4 mr-1" aria-hidden="true" /> Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-600 mt-3" data-testid="invitations-empty">
            You have not invited anyone yet.
          </p>
        ))}
      </div>
    </div>
  )
}
