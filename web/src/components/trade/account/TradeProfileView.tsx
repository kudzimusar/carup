/**
 * RX-06 Account — the unified trade profile desk (/diaspora/trade-profile).
 *
 * Presentation only. Reading your own profiles, creating and editing one (with the optimistic
 * concurrency check), resubmitting a rejected one, and — for CarUp reviewers — the pending-review queue
 * with verify / suspend are all the page container's own reads and handlers (DiasporaTradeProfile).
 * Truth rules: submitted is never verified (only VERIFIED is green), every status says what it allows,
 * a 429 is never retried automatically, and a failed read is never shown as "no profile".
 */
import { useId, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Ban, BadgeCheck, Check, CircleDashed, Loader2, MapPin, PencilLine, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_DANGER, WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import type { DiasporaTradeProfile } from '@/types'
import { DeskHeader, DeskPanel, DeskState, Fact, InlineConfirm, NextMove, PulseLine, RefCode, SourceChip } from '@/components/trade/sourcing/TradeDesk'
import { failureKind, formatDay, plural } from '@/components/trade/sourcing/deskKit'
import {
  ROLE_TYPE_OPTIONS, profileNextMove, profileStatus, roleTypeLabel, type ProfileStatusGuide, type TradeProfileModel,
} from './tradeProfile'

const STATUS_ORDER = ['PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'FLAGGED', 'SUSPENDED'] as const

export function TradeProfileView({ model }: { model: TradeProfileModel }) {
  const roleRef = useRef<HTMLSelectElement | null>(null)
  const countryRef = useRef<HTMLInputElement | null>(null)
  const [resubmitting, setResubmitting] = useState<string | null>(null)

  const answered = model.ownRead.phase === 'ready' || model.ownRead.phase === 'failed' || model.rateLimited
  const showLoading = model.authLoading || model.loading || !answered
  const listReady = !model.loading && model.ownRead.phase === 'ready' && !model.rateLimited && !model.loadError
  const move = listReady ? profileNextMove(model.own) : null

  async function resubmit(id: string) {
    if (resubmitting) return
    setResubmitting(id)
    try { await model.onResubmit(id) } finally { setResubmitting(null) }
  }

  function edit(profile: DiasporaTradeProfile) {
    model.onEdit(profile)
    // The details form is below the cards on phones; take the person to it.
    window.requestAnimationFrame(() => countryRef.current?.focus())
  }

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6" data-testid="trade-profile" data-presentation="trade-desk">
      <DeskHeader
        eyebrow="Trade · Account"
        title="Trade profile"
        description="Your trading identity on CarUp: the role you trade in and where you trade from. A CarUp reviewer verifies it — you cannot verify yourself, and submitted is not verified."
        meta={model.isReviewer ? <SourceChip testId="trade-profile-reviewer-chip">You also review other traders’ profiles</SourceChip> : undefined}
      />

      {showLoading && <DeskState kind="loading" title="Loading your trade profile…" testId="trade-profile-loading" />}

      {!model.loading && model.rateLimited && (
        <DeskState kind="limited" title="Too many requests right now" onRetry={model.onRetry} retryLabel="Retry now" testId="trade-profile-limited">
          You reached the shared request limit. Nothing is retried automatically — wait about a minute, then retry. Your profile has not changed.
        </DeskState>
      )}

      {!model.loading && !model.rateLimited && model.ownRead.phase === 'failed' && <OwnFailure model={model} />}

      {listReady && model.own.length === 0 && (
        <DeskState
          kind="empty"
          title="You have no trade profile yet"
          testId="trade-profile-empty"
          action={<button type="button" className={WS_SECONDARY} onClick={() => roleRef.current?.focus()} data-testid="trade-profile-next-create">Go to the details form</button>}
        >
          Create one with the details form below. It is recorded as submitted and waits for a CarUp reviewer — you cannot verify it yourself.
        </DeskState>
      )}

      {listReady && model.own.length > 0 && (
        <>
          <PulseLine
            label="Your profiles at a glance"
            testId="trade-profile-pulse"
            items={[
              { label: model.own.length === 1 ? 'profile' : 'profiles', value: model.own.length, key: 'all' },
              { label: 'verified', value: model.own.filter((p) => profileStatus(p.verification_status).key === 'VERIFIED').length, key: 'verified' },
              { label: 'awaiting review', value: model.own.filter((p) => profileStatus(p.verification_status).key === 'PENDING_REVIEW').length, key: 'pending' },
            ]}
          />
          {move && (
            <NextMove
              testId="trade-profile-next"
              title={move.title}
              usuallyWith={move.usuallyWith}
              after={move.after}
              action={move.resubmitId ? (
                <button type="button" className={WS_PRIMARY} disabled={resubmitting !== null || model.submittingReviewId !== null} onClick={() => void resubmit(move.resubmitId as string)} data-testid="trade-profile-next-resubmit">
                  {resubmitting === move.resubmitId && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  Resubmit for review
                </button>
              ) : undefined}
            />
          )}
          <section aria-labelledby="trade-profile-own-h" className="space-y-3">
            <h2 id="trade-profile-own-h" className="text-base font-semibold text-carup-text">Your profiles</h2>
            <ul className="grid gap-4 md:grid-cols-2" data-testid="trade-profile-own-list">
              {model.own.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  editing={model.form.editingId === p.id}
                  resubmitting={resubmitting === p.id || model.submittingReviewId === p.id}
                  onEdit={() => edit(p)}
                  onResubmit={() => void resubmit(p.id)}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {!model.authLoading && <ProfileForm model={model} roleRef={roleRef} countryRef={countryRef} ownUnknown={!showLoading && !listReady} />}

      <StatusGuide />

      {model.isReviewer && <ReviewQueue model={model} />}
    </div>
  )
}

function OwnFailure({ model }: { model: TradeProfileModel }) {
  const kind = failureKind(model.ownRead)
  if (kind === 'denied') return <DeskState kind="denied" title="The server refused to show trade profiles to this account" testId="trade-profile-failed">This is a permission answer (403), not a report that you have no profile.</DeskState>
  if (kind === 'missing') return <DeskState kind="unavailable" title="Trade profiles are not available on this server" testId="trade-profile-failed">The server answered “not found” (404). This is not a report that you have no profile.</DeskState>
  if (kind === 'session') return <DeskState kind="signin" title="Your session ended" action={<Link to="/login" className={WS_PRIMARY}>Sign in again</Link>} testId="trade-profile-failed">Sign in again to see your trade profile.</DeskState>
  return (
    <DeskState kind="failed" title="Your trade profile could not be loaded" onRetry={model.onRetry} testId="trade-profile-failed">
      This is not a report that you have no profile. Nothing about it has changed.
    </DeskState>
  )
}

function VerificationPath({ guide }: { guide: ProfileStatusGuide }) {
  if (!guide.step) {
    return (
      <p className="rounded-control bg-status-danger-soft px-3 py-2 text-xs leading-5 text-carup-text" data-testid="trade-profile-path-exception">
        <strong className="font-semibold">{guide.label}.</strong> The path cannot show where this profile stood before; a reviewer’s record holds that.
      </p>
    )
  }
  const { at, blocked } = guide.step
  const steps = ['Submitted', blocked ? guide.label : 'CarUp review', 'Verified']
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Verification path" data-testid="trade-profile-path">
      {steps.map((label, i) => {
        const done = i < at || (i === at && at === 2)
        const current = i === at && at !== 2
        const stopped = current && blocked
        return (
          <li key={i} className="min-w-0" aria-current={current ? 'step' : undefined}>
            <span
              aria-hidden="true"
              className={cn('block h-1.5 rounded-full', done ? (i === 2 ? 'bg-status-success' : 'bg-carup-text') : stopped ? 'bg-status-danger' : current ? '' : 'bg-carup-line')}
              style={current && !stopped ? { background: 'var(--carup-raw-orange-signal)' } : undefined}
            />
            <span className={cn('mt-1.5 flex items-center gap-1 text-xs', done || current ? 'font-semibold text-carup-text' : 'text-carup-text-3')}>
              {done ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : stopped ? <X className="h-3 w-3 shrink-0 text-status-danger" aria-hidden="true" /> : current ? null : <CircleDashed className="h-3 w-3 shrink-0" aria-hidden="true" />}
              <span className="truncate">{label}</span>
            </span>
            <span className="sr-only">{done ? 'done' : stopped ? 'stopped here' : current ? 'in progress' : 'not reached'}</span>
          </li>
        )
      })}
    </ol>
  )
}

function ProfileCard({ profile, editing, resubmitting, onEdit, onResubmit }: {
  profile: DiasporaTradeProfile
  editing: boolean
  resubmitting: boolean
  onEdit: () => void
  onResubmit: () => void
}) {
  const guide = profileStatus(profile.verification_status)
  const meta = (profile.metadata || {}) as Record<string, unknown>
  const reviewRequested = typeof meta.reviewRequestedAt === 'string' ? formatDay(meta.reviewRequestedAt) : null
  const suspension = meta.suspension && typeof meta.suspension === 'object' ? (meta.suspension as Record<string, unknown>) : null
  const suspensionReason = guide.key === 'SUSPENDED' && typeof suspension?.reason === 'string' ? suspension.reason : null
  const place = [profile.city, profile.country].filter(Boolean).join(', ')
  return (
    <li className={cn('flex min-w-0 flex-col rounded-card border p-4 sm:p-5', editing ? 'border-carup-line-strong bg-carup-bg-surface' : 'border-carup-line bg-carup-bg-raised')} data-testid="trade-profile-card" data-status={guide.key}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">{roleTypeLabel(profile.role_type)}</p>
        <StatusChip tone={guide.tone} testId="trade-profile-card-status">{guide.label}</StatusChip>
      </div>
      <h3 className="mt-2 flex items-start gap-1.5 text-lg font-bold leading-snug text-carup-text [overflow-wrap:anywhere]">
        <MapPin className="mt-1 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
        {place || 'Location not recorded'}
      </h3>
      <div className="mt-3"><VerificationPath guide={guide} /></div>
      <p className="mt-3 text-sm leading-6 text-carup-text-2">{guide.meaning}</p>
      <p className="mt-1 text-xs leading-5 text-carup-text-2" data-testid="trade-profile-card-allows"><span className="font-semibold text-carup-text">What this allows: </span>{guide.allows}</p>
      {suspensionReason && <p className="mt-2 rounded-control bg-status-danger-soft px-3 py-2 text-xs text-carup-text">Reason recorded by the reviewer: {suspensionReason}</p>}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-carup-line pt-3">
        <Fact label="Organisation" value={profile.organization_id || null} mono />
        <Fact label="Profile reference" value={<RefCode value={profile.id} label="Profile" />} />
        <Fact label="Submitted" value={formatDay(profile.created_at ?? null)} />
        <Fact label="Last changed" value={formatDay(profile.updated_at ?? null)} />
        {reviewRequested && <Fact label="Review requested" value={reviewRequested} />}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
        {guide.key === 'REJECTED' && (
          <button type="button" className={WS_PRIMARY} disabled={resubmitting} onClick={onResubmit} data-testid="trade-profile-resubmit">
            {resubmitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            Resubmit for review
          </button>
        )}
        <button type="button" className={WS_SECONDARY} onClick={onEdit} aria-pressed={editing} data-testid="trade-profile-edit">
          <PencilLine className="h-4 w-4" aria-hidden="true" />{editing ? 'Editing below' : 'Edit details'}
        </button>
      </div>
    </li>
  )
}

function ProfileForm({ model, roleRef, countryRef, ownUnknown }: {
  model: TradeProfileModel
  roleRef: RefObject<HTMLSelectElement | null>
  countryRef: RefObject<HTMLInputElement | null>
  /** The own-profile read has not succeeded, so this form cannot know what already exists. */
  ownUnknown: boolean
}) {
  const f = model.form
  const id = useId()
  const editing = Boolean(f.editingId)
  return (
    <DeskPanel title={editing ? 'Edit profile details' : 'Create a trade profile'} testId="trade-profile-form">
      <form noValidate onSubmit={(e) => { e.preventDefault(); void f.onSubmit() }} className="space-y-4">
        {ownUnknown && !editing && (
          <p className="rounded-control border border-status-warning bg-status-warning-soft px-3 py-2.5 text-sm text-carup-text" data-testid="trade-profile-form-unknown">
            Your existing profiles could not be read, so this form cannot show whether you already have one for a role and country. The server refuses a duplicate.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={`${id}-role`} className={WS_LABEL}>Role</label>
            <select ref={roleRef} id={`${id}-role`} className={WS_FIELD} value={f.roleType} onChange={(e) => f.setRoleType(e.target.value)} disabled={editing} data-testid="trade-profile-role">
              {ROLE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {editing && <p className={WS_HINT}>The role of an existing profile cannot be changed.</p>}
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-org`} className={WS_LABEL}>Organisation <span className="font-normal text-carup-text-3">· optional</span></label>
            <input id={`${id}-org`} className={WS_FIELD} value={f.org} onChange={(e) => f.setOrg(e.target.value)} data-testid="trade-profile-org" />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-country`} className={WS_LABEL}>Country <span className="font-normal text-carup-text-3">· required</span></label>
            <input ref={countryRef} id={`${id}-country`} className={WS_FIELD} value={f.country} onChange={(e) => f.setCountry(e.target.value)} autoComplete="country-name" aria-required="true" data-testid="trade-profile-country" />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-city`} className={WS_LABEL}>City <span className="font-normal text-carup-text-3">· required</span></label>
            <input id={`${id}-city`} className={WS_FIELD} value={f.city} onChange={(e) => f.setCity(e.target.value)} autoComplete="address-level2" aria-required="true" data-testid="trade-profile-city" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={WS_PRIMARY} disabled={f.saving} data-testid="trade-profile-submit">
            {f.saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <BadgeCheck className="h-4 w-4" aria-hidden="true" />}
            {f.saving ? 'Saving…' : editing ? 'Save changes' : 'Create profile'}
          </button>
          {editing && <button type="button" className={WS_SECONDARY} onClick={f.onCancel} data-testid="trade-profile-cancel">Cancel editing</button>}
        </div>
        <p className={WS_HINT}>
          {editing
            ? 'Saving changes only these details — never the verification status. If a reviewer changed the profile while you were editing, it is reloaded instead of overwritten.'
            : 'A new profile is recorded as submitted and waits for a CarUp reviewer. One profile per role and country.'}
        </p>
        <div aria-live="polite" className="empty:hidden">
          {f.result && <p className="rounded-control border border-status-info bg-status-info-soft px-3 py-2.5 text-sm text-carup-text" role="status" data-testid="trade-profile-result">{f.result}</p>}
          {f.error && <p className="rounded-control border border-status-danger bg-status-danger-soft px-3 py-2.5 text-sm text-carup-text" role="alert" data-testid="trade-profile-error">{f.error}</p>}
        </div>
      </form>
    </DeskPanel>
  )
}

function StatusGuide() {
  return (
    <DeskPanel title="What each status means" eyebrow="Verification" testId="trade-profile-guide">
      <ul className="divide-y divide-carup-line">
        {STATUS_ORDER.map((key) => {
          const g = profileStatus(key)
          return (
            <li key={key} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[17rem_minmax(0,1fr)]">
              <div><StatusChip tone={g.tone}>{g.label}</StatusChip></div>
              <p className="text-sm leading-6 text-carup-text-2"><span className="text-carup-text">{g.meaning}</span> {g.allows}</p>
            </li>
          )
        })}
      </ul>
    </DeskPanel>
  )
}

function ReviewQueue({ model }: { model: TradeProfileModel }) {
  const q = model.queue
  const [suspending, setSuspending] = useState<string | null>(null)
  const answered = q.read.phase === 'ready' || q.read.phase === 'failed' || q.rateLimited
  async function verify(id: string) { await q.onVerify(id) }
  async function suspend(id: string) {
    try { await q.onSuspend(id) } finally { setSuspending(null) }
  }
  return (
    <DeskPanel eyebrow="CarUp review" title="Profiles awaiting review" testId="trade-profile-queue">
      <p className="mb-3 text-sm leading-6 text-carup-text-2">Your decision is recorded against the profile. Verify only after checking the trader; suspend blocks the profile until a reviewer lifts it.</p>
      {(q.loading || !answered) && <DeskState compact kind="loading" title="Loading the review queue…" testId="trade-profile-queue-loading" />}
      {!q.loading && q.rateLimited && (
        <DeskState compact kind="limited" title="Too many requests right now" onRetry={q.onRetry} retryLabel="Retry now" testId="trade-profile-queue-limited">Nothing is retried automatically — wait about a minute, then retry.</DeskState>
      )}
      {!q.loading && !q.rateLimited && q.read.phase === 'failed' && (
        failureKind(q.read) === 'denied'
          ? <DeskState compact kind="denied" title="The server refused the review queue to this account" testId="trade-profile-queue-failed">This is a permission answer (403), not an empty queue.</DeskState>
          : <DeskState compact kind="failed" title="The review queue could not be loaded" onRetry={q.onRetry} testId="trade-profile-queue-failed">This is not a report that no profiles are waiting.</DeskState>
      )}
      {!q.loading && q.read.phase === 'ready' && !q.rateLimited && !q.error && (
        q.items.length === 0 ? (
          <DeskState compact kind="empty" title="No profiles are awaiting review" testId="trade-profile-queue-empty">A profile appears here when a trader creates or resubmits one.</DeskState>
        ) : (
          <ul className="divide-y divide-carup-line" data-testid="trade-profile-queue-list">
            <li className="pb-2 text-xs text-carup-text-3">{plural(q.items.length, 'profile')} waiting</li>
            {q.items.map((p) => {
              const g = profileStatus(p.verification_status)
              const busy = q.busyId === p.id
              return (
                <li key={p.id} className="py-3" data-testid="trade-profile-queue-row">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-carup-text [overflow-wrap:anywhere]">{roleTypeLabel(p.role_type)} · {[p.city, p.country].filter(Boolean).join(', ') || 'Location not recorded'}</p>
                      <p className="mt-0.5 text-xs text-carup-text-3">Submitted {formatDay(p.created_at ?? null) ?? '(date not recorded)'} · <RefCode value={p.id} label="Profile" /></p>
                    </div>
                    <StatusChip tone={g.tone}>{g.label}</StatusChip>
                  </div>
                  {suspending === p.id ? (
                    <div className="mt-3">
                      <InlineConfirm
                        tone="danger"
                        title="Suspend this profile?"
                        confirm={<button type="button" className={WS_DANGER} disabled={q.busyId !== null} onClick={() => void suspend(p.id)} data-testid="trade-profile-suspend-confirm">{busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}<Ban className="h-4 w-4" aria-hidden="true" />Suspend</button>}
                        cancel={<button type="button" className={WS_SECONDARY} disabled={q.busyId !== null} onClick={() => setSuspending(null)}>Keep it pending</button>}
                      >
                        The trader cannot resubmit a suspended profile; only a reviewer can lift it. The reason recorded is “Suspended by reviewer”.
                      </InlineConfirm>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
                      <button type="button" className={WS_PRIMARY} disabled={q.busyId !== null} onClick={() => void verify(p.id)} data-testid="trade-profile-verify">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <BadgeCheck className="h-4 w-4" aria-hidden="true" />}Verify
                      </button>
                      <button type="button" className={WS_DANGER} disabled={q.busyId !== null} onClick={() => setSuspending(p.id)} data-testid="trade-profile-suspend">Suspend…</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )
      )}
      <p aria-live="polite" className="mt-3 text-sm font-medium text-carup-text empty:hidden" data-testid="trade-profile-review-message">{q.message}</p>
    </DeskPanel>
  )
}
