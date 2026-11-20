/**
 * RX05-C — Dealer OS · Staff & access (unified presentation of /dealers/staff).
 *
 * Presentation only: `DealerStaffConsole` keeps every read and write (invite, accept, revoke,
 * branch-scope grant/revoke, scoped branch hours) and its receipt checks. Who has access, their
 * role, their branch grants and every invitation state (pending / accepted / revoked) come from the
 * server's records. Branch choice here is only the parameter of an owner grant that the server
 * re-verifies; it never authorizes anything on the client.
 *
 * Destructive actions (revoke invitation/membership, revoke branch scope) sit behind an explicit
 * inline confirmation step.
 */
import { useState, type ReactNode } from 'react'
import { Building2, KeyRound, UserPlus, Users, X } from 'lucide-react'
import { dealerDate, dealerDateTime } from '@/lib/dealerDates'
import { DealerObjectHeader } from './DealerObjectHeader'
import { EmptyState, WorkspaceNotice } from './EmptyState'
import { StatusChip, type StatusTone } from './StatusChip'
import { toneFor } from './statusTone'
import { humanizeCode } from './format'
import {
  WS_CARD, WS_DANGER, WS_EYEBROW, WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_SECONDARY, WS_SECTION_TITLE,
} from './workspaceStyles'

export interface StaffInvitationView {
  invite_id: string
  invited_user_id?: string
  organization_id?: string
  requested_role: string
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED'
  created_at: string
  expires_at: string
}
export interface StaffMemberView { user_id: string; role: string; joined_at: string }
export interface StaffScopedBranchView {
  scope_id: string; branch_id: string; permission: string; name: string; address: string
  opening_hours_text: string | null
}
export interface StaffOwnerScopeView { scope_id: string; invite_id: string; branch_id: string; permission: string; status: 'ACTIVE' | 'REVOKED' }

export interface StaffWorkspaceProps<B extends StaffScopedBranchView = StaffScopedBranchView> {
  signedIn: boolean
  /** The signed-in account, only to mark "You" in the member list. */
  currentUserId?: string
  loaded: boolean
  staff: { members: StaffMemberView[]; invitations: StaffInvitationView[] } | null
  mine: StaffInvitationView[]
  myBranches: B[]
  ownerScopes: StaffOwnerScopeView[]
  ownerBranches: { id: string; name: string | null }[]
  recipient: string
  setRecipient: (value: string) => void
  scopeBranchId: string
  setScopeBranchId: (value: string) => void
  scopeReason: string
  setScopeReason: (value: string) => void
  staffHours: Record<string, string>
  setStaffHour: (scopeId: string, value: string) => void
  busy: boolean
  error: string
  notice: string
  onInvite: () => void
  onAccept: (inviteId: string) => void
  onRevoke: (inviteId: string) => void
  onGrantScope: (inviteId: string) => void
  onRevokeScope: (scopeId: string) => void
  onSaveHours: (branch: B) => void
  onReload: () => void
}

const INVITE_TONES: Record<string, StatusTone> = { PENDING: 'warning', ACCEPTED: 'info', REVOKED: 'neutral' }
const INVITE_LABELS: Record<string, string> = { PENDING: 'Pending acceptance', ACCEPTED: 'Accepted', REVOKED: 'Revoked' }
const SCOPE_TONES: Record<string, StatusTone> = { ACTIVE: 'info', REVOKED: 'neutral' }
const PERMISSION_LABELS: Record<string, string> = { EDIT_BRANCH_DETAILS: 'Edit branch details', VIEW_BRANCH: 'View branch' }

function Initial({ id }: { id: string }) {
  return (
    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-carup-raw-ink text-sm font-semibold uppercase text-carup-raw-paper">
      {(id.trim()[0] || '?')}
    </span>
  )
}

function ConfirmBlock({ children, confirmLabel, onConfirm, onCancel, busy, testId }: {
  children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy: boolean; testId?: string
}) {
  return (
    <div role="group" aria-label="Confirm revocation" data-testid={testId} className="mt-3 rounded-control border border-status-danger bg-status-danger-soft p-3">
      <p className="text-sm leading-6 text-carup-text">{children}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={WS_DANGER} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className={WS_SECONDARY} disabled={busy} onClick={onCancel}>Keep access</button>
      </div>
    </div>
  )
}

export function StaffWorkspace<B extends StaffScopedBranchView>(props: StaffWorkspaceProps<B>) {
  const {
    signedIn, currentUserId, loaded, staff, mine, myBranches, ownerScopes, ownerBranches, recipient, setRecipient, scopeBranchId,
    setScopeBranchId, scopeReason, setScopeReason, staffHours, setStaffHour, busy, error, notice, onInvite, onAccept,
    onRevoke, onGrantScope, onRevokeScope, onSaveHours, onReload,
  } = props
  const [inviteOpen, setInviteOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'invite' | 'scope'; id: string } | null>(null)
  const [grantFor, setGrantFor] = useState<string | null>(null)

  // Every read failed (the page sets `error` only then, or after a failed action): nothing truthful to list.
  const nothingToShow = loaded && !staff && Boolean(error) && mine.length === 0 && myBranches.length === 0
  const pending = staff?.invitations.filter(i => i.status === 'PENDING').length ?? 0
  const activeScopes = ownerScopes.filter(s => s.status === 'ACTIVE')
  const branchName = (id: string) => ownerBranches.find(b => b.id === id)?.name || id
  const inviteeOf = (inviteId: string) => staff?.invitations.find(i => i.invite_id === inviteId)?.invited_user_id

  const ownCompact = Boolean(staff) && mine.length === 0 && myBranches.length === 0
  const ownSide = ownCompact ? (
    <div className="space-y-3">
      <section aria-labelledby="dealer-ws-own-title" className={`${WS_CARD} p-4 sm:p-5`} data-testid="dealer-ws-own-account">
        <h2 id="dealer-ws-own-title" className={WS_SECTION_TITLE}>Assigned to your account</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-6 text-carup-text-2">
          <li data-testid="dealer-ws-my-invitations">No invitations are currently assigned to your authenticated account.</li>
          <li data-testid="dealer-ws-my-branches">No active branch-operating scope was delegated to this account.</li>
        </ul>
      </section>
      <p className="text-xs leading-5 text-carup-text-3">
        Staff access is never access to dealer finances or vehicle selling. Branch details can only change with a
        separate current-owner grant, and never include seller, financial or compliance powers.
      </p>
    </div>
  ) : (
    <div className="space-y-5">
      <section aria-labelledby="dealer-ws-my-invites-title" className={`${WS_CARD} p-4 sm:p-5`} data-testid="dealer-ws-my-invitations">
        <h2 id="dealer-ws-my-invites-title" className={WS_SECTION_TITLE}>Invitations sent to your account</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-sm leading-6 text-carup-text-2">No invitations are currently assigned to your authenticated account.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {mine.map(i => (
              <li key={i.invite_id} className="rounded-control border border-carup-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">Organization: {i.organization_id}</p>
                  <StatusChip tone={toneFor(i.status, INVITE_TONES)}>{INVITE_LABELS[i.status] || i.status}</StatusChip>
                </div>
                <p className="mt-1 text-xs text-carup-text-2">Status: {i.status}; role: {i.requested_role}</p>
                <p className="text-xs text-carup-text-3">Invitation expires: {dealerDateTime(i.expires_at)}</p>
                {i.status === 'PENDING' && (
                  <button type="button" className={`${WS_PRIMARY} mt-3 w-full sm:w-auto`} disabled={busy} onClick={() => onAccept(i.invite_id)}>
                    Accept limited staff membership in canonical tenant
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dealer-ws-my-branches-title" className={`${WS_CARD} p-4 sm:p-5`} data-testid="dealer-ws-my-branches">
        <h2 id="dealer-ws-my-branches-title" className={WS_SECTION_TITLE}>Branch operations assigned to you</h2>
        <p className={WS_HINT}>Checked against the current legal owner, tenant and organization membership on every request.</p>
        {myBranches.length === 0 ? (
          <p className="mt-2 text-sm leading-6 text-carup-text-2">No active branch-operating scope was delegated to this account.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {myBranches.map(b => (
              <li key={b.scope_id} className="rounded-control border border-carup-line p-3">
                <p className="text-sm font-semibold">{b.name}</p>
                <p className="text-sm text-carup-text-2">{b.address}</p>
                <p className="mt-1 text-xs text-carup-text-3">Explicit scope: {b.permission}; never seller or payment rights.</p>
                {b.permission === 'EDIT_BRANCH_DETAILS' && (
                  <div className="mt-3">
                    <label className={WS_LABEL} htmlFor={'staff-branch-hours-' + b.scope_id}>Private opening hours for this branch</label>
                    <input id={'staff-branch-hours-' + b.scope_id} className={WS_FIELD} maxLength={350}
                      value={staffHours[b.scope_id] ?? b.opening_hours_text ?? ''}
                      onChange={e => setStaffHour(b.scope_id, e.target.value)} />
                    <button type="button" className={`${WS_SECONDARY} mt-2 w-full sm:w-auto`} disabled={busy} onClick={() => onSaveHours(b)}>
                      Save authorized branch operating details
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs leading-5 text-carup-text-3">
        Staff access is never access to dealer finances or vehicle selling. Branch details can only change with a
        separate current-owner grant, and never include seller, financial or compliance powers.
      </p>
    </div>
  )

  return (
    <div className="space-y-5 text-carup-text" data-testid="dealer-ws-staff" data-presentation="dealer-workspace-staff">
      <DealerObjectHeader
        eyebrow="Dealer OS · Staff"
        title="Staff & access"
        description="Who can work in your dealership's CarUp workspace. Staff are existing CarUp accounts you invite; they accept with their own account and never receive owner, selling or payment rights."
        meta={staff ? (
          <>
            <StatusChip testId="dealer-ws-staff-members-count">{staff.members.length} with access</StatusChip>
            {pending > 0 && <StatusChip tone="warning">{pending} pending {pending === 1 ? 'invitation' : 'invitations'}</StatusChip>}
            {activeScopes.length > 0 && <StatusChip tone="info">{activeScopes.length} branch {activeScopes.length === 1 ? 'grant' : 'grants'}</StatusChip>}
          </>
        ) : undefined}
        actions={staff ? (
          <button type="button" className={inviteOpen ? WS_SECONDARY : WS_PRIMARY} aria-expanded={inviteOpen} aria-controls="dealer-ws-invite"
            data-testid="dealer-ws-invite-toggle" onClick={() => setInviteOpen(o => !o)}>
            {inviteOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
            {inviteOpen ? 'Close' : 'Invite staff'}
          </button>
        ) : undefined}
      />

      {notice && <WorkspaceNotice testId="dealer-ws-staff-notice">{notice}</WorkspaceNotice>}
      {error && !nothingToShow && <WorkspaceNotice tone="danger">{error}</WorkspaceNotice>}

      {!signedIn && <EmptyState kind="denied" title="Sign in to manage or accept an invitation." />}
      {signedIn && !loaded && <EmptyState kind="loading" title="Reading your dealership's members and invitations…" testId="dealer-ws-staff-loading" />}
      {signedIn && nothingToShow && (
        <EmptyState kind="error" title="No dealership staff access to show" onRetry={onReload} testId="dealer-ws-staff-error">
          {error || 'Your account has no dealership owner access and no staff invitations.'} A failed read is not proof
          that your dealership has no staff.
        </EmptyState>
      )}

      {signedIn && loaded && !nothingToShow && (
        <div className={staff ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]' : 'max-w-2xl'}>
          {staff && (
            <div className="min-w-0 space-y-5">
              {inviteOpen && (
                <section id="dealer-ws-invite" aria-labelledby="dealer-ws-invite-title" className={`${WS_CARD} p-4 sm:p-5`} data-testid="dealer-ws-invite">
                  <h2 id="dealer-ws-invite-title" className={WS_SECTION_TITLE}>Invite a staff member</h2>
                  <p className={WS_HINT}>
                    Limited staff member only. Owner, management, financial, branch-scoped and VIN seller grants are not
                    delegated by this invitation. They must accept through their own CarUp account.
                  </p>
                  <form className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={e => { e.preventDefault(); onInvite() }}>
                    <div className="min-w-0 flex-1">
                      <label htmlFor="staff-existing-user" className={WS_LABEL}>Recipient's existing CarUp account ID</label>
                      <input id="staff-existing-user" className={WS_FIELD} value={recipient} maxLength={255}
                        onChange={e => setRecipient(e.target.value)} placeholder="Exact registered user account ID" autoComplete="off" />
                    </div>
                    <button type="submit" className={WS_PRIMARY} disabled={busy || recipient.trim().length < 2}>
                      Issue private staff invitation
                    </button>
                  </form>
                </section>
              )}

              <section aria-labelledby="dealer-ws-members-title" className={`${WS_CARD} overflow-hidden`} data-testid="dealer-ws-members">
                <div className="flex items-center gap-2 border-b border-carup-line px-4 py-3 sm:px-5">
                  <Users className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
                  <h2 id="dealer-ws-members-title" className={WS_SECTION_TITLE}>People with access</h2>
                </div>
                {staff.members.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-carup-text-2 sm:px-5">No tenant memberships recorded.</p>
                ) : (
                  <ul className="divide-y divide-carup-line">
                    {staff.members.map(m => {
                      const invites = staff.invitations.filter(i => i.invited_user_id === m.user_id).map(i => i.invite_id)
                      const grants = ownerScopes.filter(s => s.status === 'ACTIVE' && invites.includes(s.invite_id))
                      return (
                        <li key={m.user_id} className="flex items-start gap-3 px-4 py-3 sm:px-5" data-testid={`dealer-ws-member-${m.user_id}`}>
                          <Initial id={m.user_id} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <p className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{m.user_id}</p>
                              {currentUserId === m.user_id && <span className="rounded-full bg-carup-raw-ink px-2 py-0.5 text-[11px] font-semibold text-carup-raw-paper">You</span>}
                            </div>
                            <p className="mt-0.5 text-xs text-carup-text-2">Tenant role: {m.role} · Joined {dealerDate(m.joined_at)}</p>
                            {grants.length > 0 && (
                              <p className="mt-1.5 flex flex-wrap gap-1.5">
                                {grants.map(g => (
                                  <StatusChip key={g.scope_id} tone="info">
                                    {PERMISSION_LABELS[g.permission] || humanizeCode(g.permission)} · {branchName(g.branch_id)}
                                  </StatusChip>
                                ))}
                              </p>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section aria-labelledby="dealer-ws-invitations-title" className={`${WS_CARD} overflow-hidden`} data-testid="dealer-ws-invitations">
                <div className="flex items-center gap-2 border-b border-carup-line px-4 py-3 sm:px-5">
                  <UserPlus className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
                  <h2 id="dealer-ws-invitations-title" className={WS_SECTION_TITLE}>Invitations</h2>
                </div>
                {staff.invitations.length === 0 ? (
                  <div className="p-4 sm:p-5">
                    <EmptyState compact title="No invitations for this dealer.">
                      Invite an existing CarUp account to give them limited staff access. Nothing changes until they accept.
                    </EmptyState>
                  </div>
                ) : (
                  <ul className="divide-y divide-carup-line">
                    {staff.invitations.map(i => {
                      const confirming = confirm?.kind === 'invite' && confirm.id === i.invite_id
                      const granting = grantFor === i.invite_id
                      return (
                        <li key={i.invite_id} className="px-4 py-3 sm:px-5" data-testid={`dealer-ws-invitation-${i.invite_id}`}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold [overflow-wrap:anywhere]">{i.invited_user_id}</p>
                              <p className="mt-0.5 text-xs text-carup-text-2">Status: {i.status}; role: {i.requested_role}</p>
                              <p className="text-xs text-carup-text-3">Expires: {dealerDateTime(i.expires_at)}</p>
                            </div>
                            <StatusChip tone={toneFor(i.status, INVITE_TONES)} testId={`dealer-ws-invitation-status-${i.invite_id}`}>
                              {INVITE_LABELS[i.status] || i.status}
                            </StatusChip>
                          </div>
                          {!confirming && !granting && i.status !== 'REVOKED' && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {i.status === 'ACCEPTED' && ownerBranches.length > 0 && (
                                <button type="button" className={WS_SECONDARY} disabled={busy} onClick={() => { setGrantFor(i.invite_id); setConfirm(null) }}>
                                  <KeyRound className="h-4 w-4" aria-hidden="true" /> Grant branch editing…
                                </button>
                              )}
                              <button type="button" className={WS_DANGER} disabled={busy} onClick={() => { setConfirm({ kind: 'invite', id: i.invite_id }); setGrantFor(null) }}>
                                Revoke…
                              </button>
                            </div>
                          )}
                          {granting && (
                            <form
                              className="mt-3 space-y-3 rounded-control border border-carup-line-strong bg-carup-bg p-3"
                              onSubmit={e => { e.preventDefault(); onGrantScope(i.invite_id); setGrantFor(null) }}
                              aria-label="Approve branch-specific staff operations"
                            >
                              <p className="text-xs leading-5 text-carup-text-2">
                                Explicit legal-owner grant after the recipient accepted membership. Branch editing never grants
                                inventory, payment or public publication rights.
                              </p>
                              <div>
                                <label className={WS_LABEL} htmlFor="staff-branch-scope-branch">Branch to delegate</label>
                                <select id="staff-branch-scope-branch" className={WS_FIELD} value={scopeBranchId} onChange={e => setScopeBranchId(e.target.value)}>
                                  {ownerBranches.map(b => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={WS_LABEL} htmlFor="staff-branch-grant-reason">Record the operating delegation reason</label>
                                <input id="staff-branch-grant-reason" className={WS_FIELD} value={scopeReason} maxLength={1000}
                                  onChange={e => setScopeReason(e.target.value)} placeholder="Why this staff member may maintain these branch details" />
                                <p className={WS_HINT}>At least 16 characters. Kept in the authorization ledger.</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button type="submit" className={WS_PRIMARY} disabled={busy || scopeReason.trim().length < 16}>
                                  Grant limited branch edit access
                                </button>
                                <button type="button" className={WS_SECONDARY} onClick={() => setGrantFor(null)}>Cancel</button>
                              </div>
                            </form>
                          )}
                          {confirming && (
                            <ConfirmBlock
                              testId={`dealer-ws-revoke-confirm-${i.invite_id}`}
                              confirmLabel="Revoke invitation or staff membership"
                              busy={busy}
                              onConfirm={() => { onRevoke(i.invite_id); setConfirm(null) }}
                              onCancel={() => setConfirm(null)}
                            >
                              Revoke access for <strong className="[overflow-wrap:anywhere]">{i.invited_user_id}</strong>? This withdraws the
                              invitation or ends their limited staff membership, and is recorded.
                            </ConfirmBlock>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {ownerScopes.length > 0 && (
                <section aria-labelledby="dealer-ws-scopes-title" className={`${WS_CARD} overflow-hidden`} data-testid="dealer-ws-scope-ledger">
                  <div className="flex items-center gap-2 border-b border-carup-line px-4 py-3 sm:px-5">
                    <Building2 className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
                    <h2 id="dealer-ws-scopes-title" className={WS_SECTION_TITLE}>Branch editing grants</h2>
                  </div>
                  <ul className="divide-y divide-carup-line">
                    {ownerScopes.map(s => {
                      const confirming = confirm?.kind === 'scope' && confirm.id === s.scope_id
                      return (
                        <li key={s.scope_id} className="px-4 py-3 sm:px-5" data-testid={`dealer-ws-scope-${s.scope_id}`}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold [overflow-wrap:anywhere]">{branchName(s.branch_id)}</p>
                              <p className="mt-0.5 text-xs text-carup-text-2 [overflow-wrap:anywhere]">
                                {PERMISSION_LABELS[s.permission] || humanizeCode(s.permission)}
                                {inviteeOf(s.invite_id) ? ` · ${inviteeOf(s.invite_id)}` : ''}
                              </p>
                            </div>
                            <StatusChip tone={toneFor(s.status, SCOPE_TONES)}>{humanizeCode(s.status)}</StatusChip>
                          </div>
                          {s.status === 'ACTIVE' && !confirming && (
                            <button type="button" className={`${WS_DANGER} mt-3`} disabled={busy} onClick={() => { setConfirm({ kind: 'scope', id: s.scope_id }); setGrantFor(null) }}>
                              Revoke…
                            </button>
                          )}
                          {confirming && (
                            <ConfirmBlock
                              testId={`dealer-ws-scope-revoke-confirm-${s.scope_id}`}
                              confirmLabel="Revoke branch operating scope"
                              busy={busy}
                              onConfirm={() => { onRevokeScope(s.scope_id); setConfirm(null) }}
                              onCancel={() => setConfirm(null)}
                            >
                              Revoke branch editing for <strong>{branchName(s.branch_id)}</strong>? Their tenant membership stays as it is.
                            </ConfirmBlock>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}
          <aside aria-label="Your own access" className="min-w-0">
            {staff && !ownCompact && <p className={`${WS_EYEBROW} mb-2`}>Your own account</p>}
            {ownSide}
          </aside>
        </div>
      )}
    </div>
  )
}
