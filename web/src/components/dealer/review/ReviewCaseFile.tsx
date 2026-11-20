/**
 * RX05-D — the independent reviewer case file: one calm, evidence-first composition shared by the
 * eight /admin/dealer-* workbenches when they render inside the unified ReviewWorkbench chrome.
 *
 *   Queue → Case (header) → Evidence → Decision → Audit
 *
 * Presentation only. Every page keeps its own data reads, state, validation and API calls; these
 * components only arrange what the page already has. In particular:
 *  - a decision's submit control is passed in by the page with the page's OWN `disabled` rule;
 *    the requirement list here is a read-out of those same conditions, never a second authority;
 *  - the reviewer password field is the page's unchanged `ReviewerStepUpField`, placed in a slot;
 *  - "not verified" provenance is shown on applicant / dealer / buyer / source material until a
 *    decision exists, and a status is toned green only for a recorded positive decision
 *    (see reviewTone.ts);
 *  - what the applicant (or the public) can see is kept in its own labelled region, apart from
 *    internal reviewer notes.
 * No scenes, hero art, cinematic backgrounds or marketing chrome — plain token surfaces only.
 */
import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Circle, Eye, FileClock, KeyRound, Lock, RefreshCw } from 'lucide-react'
import { dealerDateTime } from '@/lib/dealerDates'
import { humanizeStatus, reviewAge, reviewStatusTone, type ReviewTone } from './reviewTone'

/* ───────────────────────── shared class strings (tokens only) ───────────────────────── */

export const REVIEW_LABEL = 'block text-sm font-semibold text-carup-text'
export const REVIEW_HINT = 'mt-1 text-xs leading-5 text-carup-text-2'
export const REVIEW_FIELD =
  'mt-1 block w-full min-h-11 rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 py-2 text-sm text-carup-text ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ' +
  'disabled:cursor-not-allowed disabled:bg-carup-bg-surface disabled:text-carup-text-3 aria-[invalid=true]:border-status-danger'
export const REVIEW_PRIMARY =
  'inline-flex min-h-11 w-full max-w-full items-center justify-center gap-2 whitespace-normal rounded-control bg-carup-action px-4 py-2 ' +
  'text-center text-sm font-semibold leading-snug text-carup-action-on transition-colors hover:bg-carup-action-hover ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:bg-carup-bg-surface-2 disabled:text-carup-text-3'
export const REVIEW_SECONDARY =
  'inline-flex min-h-11 max-w-full items-center justify-center gap-2 whitespace-normal rounded-control bg-carup-bg-raised px-4 py-2 ' +
  'text-center text-sm font-semibold leading-snug text-carup-text ring-1 ring-carup-line-strong transition-colors hover:bg-carup-bg-surface ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ' +
  'disabled:cursor-not-allowed disabled:text-carup-text-3 disabled:ring-carup-line disabled:hover:bg-carup-bg-raised'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3'
const PANEL = 'rounded-card bg-carup-bg-raised ring-1 ring-carup-line'

/* ───────────────────────── status & provenance ───────────────────────── */

const TONE_CLASS: Record<ReviewTone, string> = {
  pending: 'bg-status-neutral-soft text-status-neutral',
  attention: 'bg-status-warning-soft text-status-warning',
  negative: 'bg-status-danger-soft text-status-danger',
  positive: 'bg-status-success-soft text-status-success',
  neutral: 'bg-carup-bg-surface text-carup-text-2',
}
const TONE_DOT: Record<ReviewTone, string> = {
  pending: 'border border-status-neutral',
  attention: 'bg-status-warning',
  negative: 'bg-status-danger',
  positive: 'bg-status-success',
  neutral: 'border border-carup-text-3',
}

/** A status chip. The tone comes from reviewTone — a waiting/unverified status is never green. */
export function ReviewStatusChip({ status, label, testId }: { status?: string | null; label?: ReactNode; testId?: string }) {
  const tone = reviewStatusTone(status)
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-5 ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${TONE_DOT[tone]}`} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{label ?? humanizeStatus(status)}</span>
    </span>
  )
}

export type ProvenanceKind = 'applicant' | 'dealer' | 'buyer' | 'public' | 'source' | 'uploader' | 'reviewer' | 'server'
const PROVENANCE: Record<ProvenanceKind, { label: string; unverified: boolean }> = {
  applicant: { label: 'Submitted by applicant · not verified', unverified: true },
  dealer: { label: 'Declared by the dealership · not verified', unverified: true },
  buyer: { label: 'Submitted by buyer · not verified', unverified: true },
  public: { label: 'Submitted by a member of the public · not verified', unverified: true },
  source: { label: 'Imported from public sources · not verified', unverified: true },
  uploader: { label: 'Uploaded to the vehicle file · not verified', unverified: true },
  reviewer: { label: 'Reviewer finding', unverified: false },
  server: { label: 'Recorded by CarUp', unverified: false },
}

/** Where a piece of case material came from. Applicant/dealer/buyer/source material says "not verified". */
export function ProvenanceBadge({ kind, label }: { kind: ProvenanceKind; label?: string }) {
  const p = PROVENANCE[kind]
  const cls = p.unverified
    ? 'bg-status-warning-soft text-status-warning'
    : kind === 'reviewer' ? 'bg-status-info-soft text-status-info' : 'bg-carup-bg-surface text-carup-text-2'
  return (
    <span data-testid="review-provenance" data-provenance={kind} data-unverified={p.unverified ? 'true' : 'false'}
      className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[12px] font-semibold leading-5 [overflow-wrap:anywhere] ${cls}`}>
      {label ?? p.label}
    </span>
  )
}

/* ───────────────────────── page frame ───────────────────────── */

/** Workbench title, with what the decision does and does not do folded away. */
export function ReviewWorkbenchHeader({ eyebrow, title, summaryLabel = 'What this decision does — and does not do', children }: {
  eyebrow: string; title: string; summaryLabel?: string; children?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <p className={EYEBROW}>{eyebrow}</p>
        <h1 className="mt-1 text-xl font-bold tracking-[-0.01em] text-carup-text sm:text-2xl">{title}</h1>
      </div>
      {children && (
        <details className="max-w-xl text-xs text-carup-text-2" data-testid="review-workbench-scope">
          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-control font-semibold text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
            {summaryLabel}
          </summary>
          <div className="mt-1 space-y-2 leading-5">{children}</div>
        </details>
      )}
    </div>
  )
}

/** Sign-in / role refusal inside the workbench (the layout guard already ran; the API re-checks). */
export function ReviewAccessNotice({ children }: { children: ReactNode }) {
  return <p role="alert" className={`${PANEL} p-5 text-sm text-carup-text`}>{children}</p>
}

type MobileView = 'queue' | 'case'
const WorkbenchView = createContext<{ view: MobileView; openCase: () => void; backToQueue: () => void }>({
  view: 'queue', openCase: () => {}, backToQueue: () => {},
})

/**
 * Queue beside the case from `lg`; on phones the queue first, and choosing an item drills into the
 * case (with a way back). Controlled (`view` + `onViewChange`) or self-managed.
 */
export function ReviewWorkbenchGrid({ queue, children, view, onViewChange, testId, caseLabel = 'Selected case' }: {
  queue: ReactNode; children: ReactNode; view?: MobileView; onViewChange?: (v: MobileView) => void; testId?: string; caseLabel?: string
}) {
  const [own, setOwn] = useState<MobileView>('queue')
  const current = view ?? own
  const set = (v: MobileView) => { onViewChange?.(v); if (view === undefined) setOwn(v) }
  return (
    <WorkbenchView.Provider value={{ view: current, openCase: () => set('case'), backToQueue: () => set('queue') }}>
      <div data-testid={testId} data-mobile-view={current}
        className="grid min-w-0 items-start gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]">
        <div className={`min-w-0 ${current === 'case' ? 'hidden lg:block' : ''}`}>{queue}</div>
        <div className={`min-w-0 space-y-4 ${current === 'queue' ? 'hidden lg:block' : ''}`} aria-label={caseLabel} role="region">
          <button type="button" onClick={() => set('queue')} data-testid="review-back-to-queue"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control text-sm font-semibold text-carup-text-2 hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus lg:hidden">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to queue
          </button>
          {children}
        </div>
      </div>
    </WorkbenchView.Provider>
  )
}

/* ───────────────────────── queue ───────────────────────── */

export type ReviewQueueState = 'loading' | 'unavailable' | 'empty' | 'ready'

/**
 * The queue column. A refused or failed read is said plainly and is never drawn as an empty queue;
 * a genuinely empty queue says what that means and that nothing was approved automatically.
 */
export function ReviewQueuePanel({
  title = 'Queue', count, onRefresh, refreshLabel = 'Refresh queue', refreshDisabled, state, loadingText = 'Loading the queue…',
  unavailableMessage, unavailableTestId, onRetry, emptyTitle, emptyBody, listLabel, intro, toolbar, footer, children, testId, ariaLabel,
}: {
  title?: string; count?: number | string | null; onRefresh?: () => void; refreshLabel?: string; refreshDisabled?: boolean
  state: ReviewQueueState; loadingText?: string; unavailableMessage?: ReactNode; unavailableTestId?: string; onRetry?: () => void
  emptyTitle: string; emptyBody?: ReactNode; listLabel: string; intro?: ReactNode; toolbar?: ReactNode; footer?: ReactNode
  children?: ReactNode; testId?: string; ariaLabel?: string
}) {
  return (
    <section aria-label={ariaLabel ?? listLabel} data-testid={testId} data-queue-state={state} className={`${PANEL} overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 border-b border-carup-line py-1 pl-4 pr-2">
        <h2 className="text-sm font-semibold text-carup-text">{title}{count !== undefined && count !== null && <span className="ml-1.5 font-normal text-carup-text-3">· {count}</span>}</h2>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={refreshDisabled}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm font-semibold text-carup-text-2 hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus disabled:cursor-not-allowed disabled:text-carup-text-3">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{refreshLabel}
          </button>
        )}
      </div>
      {toolbar}
      {intro && <div className="border-b border-carup-line px-4 py-2.5 text-xs leading-5 text-carup-text-2">{intro}</div>}
      {state === 'loading' && <p className="px-4 py-5 text-sm text-carup-text-2" role="status">{loadingText}</p>}
      {state === 'unavailable' && (
        <div role="alert" data-testid={unavailableTestId} className="m-3 rounded-control bg-status-danger-soft p-3 text-sm text-status-danger">
          <p>{unavailableMessage} This is not an empty queue.</p>
          {(onRetry ?? onRefresh) && (
            <button type="button" onClick={onRetry ?? onRefresh} className={`${REVIEW_SECONDARY} mt-3`}>Try again</button>
          )}
        </div>
      )}
      {state === 'empty' && (
        <div className="px-4 py-6" data-testid="review-queue-empty">
          <FileClock className="h-5 w-5 text-carup-text-3" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-carup-text">{emptyTitle}</p>
          {emptyBody && <p className="mt-1 text-sm leading-6 text-carup-text-2">{emptyBody}</p>}
        </div>
      )}
      {state === 'ready' && <ul aria-label={listLabel} className="divide-y divide-carup-line lg:max-h-[70vh] lg:overflow-y-auto">{children}</ul>}
      {footer}
    </section>
  )
}

/** Segmented switch between two queues of one workbench (e.g. legal review / final activation). */
export function ReviewQueueTabs<T extends string>({ tabs, active, onChange, label }: {
  tabs: ReadonlyArray<{ id: T; label: string; count?: number | null }>; active: T; onChange: (id: T) => void; label: string
}) {
  return (
    <div role="group" aria-label={label} className="grid gap-1 border-b border-carup-line p-2" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map(t => (
        <button key={t.id} type="button" aria-pressed={active === t.id} onClick={() => onChange(t.id)} data-testid={`review-queue-tab-${t.id}`}
          className={`min-h-11 rounded-control px-2 py-1.5 text-center text-xs font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
            active === t.id ? 'bg-carup-raw-ink text-carup-raw-paper' : 'text-carup-text-2 hover:bg-carup-bg-surface hover:text-carup-text'}`}>
          {t.label}{t.count !== undefined && t.count !== null && <span className="ml-1 font-normal">· {t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** One queue entry: what it is, its state, how long it has waited. Opens the case on phones. */
export function ReviewQueueItem({ selected, onSelect, title, status, statusLabel, meta, since, sinceLabel = 'Filed', flag, testId }: {
  selected: boolean; onSelect: () => void; title: ReactNode; status?: string | null; statusLabel?: ReactNode
  meta?: ReactNode[]; since?: string | null; sinceLabel?: string; flag?: ReactNode; testId?: string
}) {
  const { openCase } = useContext(WorkbenchView)
  const age = reviewAge(since)
  return (
    <li>
      <button type="button" aria-current={selected ? 'true' : undefined} data-testid={testId}
        onClick={() => { onSelect(); openCase() }}
        className={`block w-full min-h-11 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-carup-focus ${
          selected ? 'bg-carup-action-soft shadow-[inset_3px_0_0_var(--carup-color-action)]' : 'hover:bg-carup-bg-surface'}`}>
        <span className="block break-words text-sm font-semibold text-carup-text">{title}</span>
        {(status !== undefined || statusLabel) && <span className="mt-1.5 flex flex-wrap items-center gap-1.5"><ReviewStatusChip status={status} label={statusLabel} /></span>}
        {meta?.filter(Boolean).map((m, i) => <span key={i} className="mt-1 block break-words text-[12px] text-carup-text-3">{m}</span>)}
        {since !== undefined && <span className="mt-1 block text-[12px] text-carup-text-3">{sinceLabel} {dealerDateTime(since)}{age ? ` · ${age}` : ''}</span>}
        {flag && <span className="mt-1 block text-[12px] font-semibold text-status-warning">{flag}</span>}
      </button>
    </li>
  )
}

/* ───────────────────────── case ───────────────────────── */

export type ReviewFact = { label: string; value: ReactNode; mono?: boolean }

export function ReviewFacts({ items, className = '' }: { items: ReviewFact[]; className?: string }) {
  return (
    <dl className={`grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 ${className}`}>
      {items.map(f => (
        <div key={f.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">{f.label}</dt>
          <dd className={`mt-0.5 text-carup-text ${f.mono ? 'font-mono text-xs [overflow-wrap:anywhere]' : 'font-medium [overflow-wrap:anywhere]'}`}>{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Case identity: what it is, its current state, who/when. */
export function ReviewCaseHeader({ eyebrow, title, status, statusLabel, facts, testId, children }: {
  eyebrow: string; title: ReactNode; status?: string | null; statusLabel?: ReactNode; facts?: ReviewFact[]; testId?: string; children?: ReactNode
}) {
  return (
    <header data-testid={testId} className={`${PANEL} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={EYEBROW}>{eyebrow}</p>
          <h2 className="mt-1 break-words text-lg font-semibold text-carup-text sm:text-xl">{title}</h2>
        </div>
        {(status !== undefined || statusLabel) && <ReviewStatusChip status={status} label={statusLabel} testId="review-case-status" />}
      </div>
      {facts && facts.length > 0 && <ReviewFacts items={facts} className="mt-4 border-t border-carup-line pt-3 xl:grid-cols-3" />}
      {children}
    </header>
  )
}

/** Placeholder for the case column when nothing is selected or the queue is empty. */
export function ReviewNoCase({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <div className={`${PANEL} p-6`} data-testid="review-no-case">
      <p className="text-sm font-semibold text-carup-text">{title}</p>
      {body && <p className="mt-1 max-w-prose text-sm leading-6 text-carup-text-2">{body}</p>}
    </div>
  )
}

/**
 * Evidence → Decision → Audit. One column on phones in that order; from `xl` the decision sits
 * beside the evidence and the audit trail runs under the evidence.
 */
export function ReviewCaseBody({ evidence, decision, audit }: { evidence: ReactNode; decision?: ReactNode; audit?: ReactNode }) {
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr]">
      <div className="min-w-0 space-y-4">{evidence}</div>
      {decision && <div className="min-w-0 space-y-4 xl:row-span-2">{decision}</div>}
      {audit && <div className="min-w-0 space-y-4 xl:self-start">{audit}</div>}
    </div>
  )
}

/** A titled block of case material with its provenance. */
export function ReviewSection({ title, provenance, provenanceLabel, description, children, testId, ariaLabel }: {
  title: string; provenance?: ProvenanceKind; provenanceLabel?: string; description?: ReactNode; children?: ReactNode; testId?: string; ariaLabel?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={ariaLabel ? undefined : id} aria-label={ariaLabel} data-testid={testId} className={`${PANEL} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="text-base font-semibold text-carup-text">{title}</h3>
        {provenance && <ProvenanceBadge kind={provenance} label={provenanceLabel} />}
      </div>
      {description && <div className="mt-1 text-sm leading-6 text-carup-text-2">{description}</div>}
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  )
}

export type ReviewAudience = 'applicant' | 'public' | 'dealer' | 'buyer' | 'uploader'
const AUDIENCE_WHO: Record<ReviewAudience, string> = {
  applicant: 'the applicant', public: 'the public', dealer: 'the dealership', buyer: 'the buyer', uploader: 'the uploader',
}
const AUDIENCE_TITLE: Record<ReviewAudience, string> = {
  applicant: 'Applicant-facing summary',
  public: 'Public-facing summary',
  dealer: 'Dealer-facing summary',
  buyer: 'Buyer-facing summary',
  uploader: 'Uploader-facing summary',
}

/**
 * Two labelled regions that never mix: what the applicant (or the public) can see about this case,
 * and the reviewer's internal notes. Stacked on phones, side by side from `md`.
 */
export function ReviewAudienceSplit({ audience = 'applicant', facingNote, facing, internalNote, internal }: {
  audience?: ReviewAudience; facingNote: ReactNode; facing?: ReactNode; internalNote?: ReactNode; internal?: ReactNode
}) {
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <section aria-label={AUDIENCE_TITLE[audience]} data-testid="review-facing-summary" data-audience={audience}
        className="min-w-0 rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line">
        <p className={`flex items-center gap-1.5 ${EYEBROW}`}><Eye className="h-3.5 w-3.5" aria-hidden="true" />{AUDIENCE_TITLE[audience]}</p>
        <p className="mt-1.5 text-xs leading-5 text-carup-text-2">{facingNote}</p>
        {facing && <div className="mt-3">{facing}</div>}
      </section>
      <section aria-label="Internal reviewer notes" data-testid="review-internal-notes"
        className="min-w-0 rounded-card border border-dashed border-carup-line-strong bg-carup-bg-surface p-4">
        <p className={`flex items-center gap-1.5 ${EYEBROW}`}><Lock className="h-3.5 w-3.5" aria-hidden="true" />Internal reviewer notes</p>
        <p className="mt-1.5 text-xs leading-5 text-carup-text-2">{internalNote ?? `Reviewer workbench only — kept apart from anything ${AUDIENCE_WHO[audience]} sees.`}</p>
        {internal && <div className="mt-3">{internal}</div>}
      </section>
    </div>
  )
}

/* ───────────────────────── decision ───────────────────────── */

/**
 * Decision options as explicit, fully readable choices (a native select truncates long decision
 * labels in the decision column). The page owns the value; this only renders it.
 */
export function ReviewChoice<T extends string>({ id, legend, value, onChange, options, disabled }: {
  id: string; legend: string; value: T | ''; onChange: (value: T) => void
  options: ReadonlyArray<readonly [T, string]>; disabled?: boolean
}) {
  return (
    <fieldset id={id} data-testid={`${id}-choice`} disabled={disabled} className="min-w-0">
      <legend className={REVIEW_LABEL}>{legend}</legend>
      <div className="mt-1.5 space-y-1.5">
        {options.map(([option, label]) => (
          <label key={option} htmlFor={`${id}-${option}`}
            className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-control bg-carup-bg-raised px-3 py-2.5 text-sm leading-5 text-carup-text ring-1 ring-carup-line transition-colors hover:ring-carup-line-strong has-[:checked]:bg-carup-action-soft has-[:checked]:ring-carup-action has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-carup-focus">
            <input id={`${id}-${option}`} type="radio" name={id} value={option} checked={value === option}
              onChange={() => onChange(option)} className="mt-0.5 h-4 w-4 shrink-0 accent-carup-action focus-visible:outline-none" />
            <span className="min-w-0">{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}


/** Read-out of the page's own submit conditions. It never enables anything by itself. */
export function ReviewRequirements({ items, title = 'Before this decision can be recorded' }: { items: { label: ReactNode; met: boolean }[]; title?: string }) {
  if (!items.length) return null
  return (
    <div data-testid="review-requirements" className="rounded-control bg-carup-bg-surface p-3">
      <p className="text-xs font-semibold text-carup-text">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((r, i) => (
          <li key={i} data-met={r.met ? 'true' : 'false'} className={`flex items-start gap-2 text-xs leading-5 ${r.met ? 'text-carup-text-2' : 'text-carup-text'}`}>
            {r.met
              ? <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-carup-text" aria-label="done" />
              : <Circle className="mt-0.5 h-3.5 w-3.5 flex-none text-carup-text-3" aria-label="still needed" />}
            <span className="min-w-0">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The password step-up block. `children` is the page's unchanged ReviewerStepUpField (+ label). */
export function ReviewStepUp({ children, note, actions, title = 'Step-up', testId = 'review-step-up' }: {
  children: ReactNode; note?: ReactNode; actions?: ReactNode; title?: string; testId?: string
}) {
  return (
    <div data-testid={testId} className="space-y-3 rounded-card bg-carup-bg-surface p-4 ring-1 ring-carup-line">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-carup-text"><KeyRound className="h-4 w-4 text-carup-text-2" aria-hidden="true" />{title}</p>
      {children}
      {note && <div className="text-xs leading-5 text-carup-text-2">{note}</div>}
      {actions}
    </div>
  )
}

/** Required decision reason with a live count against the page's own minimum. */
export function ReviewReasonField({ id, label, value, onChange, min, max = 3000, audience, disabled, minHeight = 'min-h-32' }: {
  id: string; label: ReactNode; value: string; onChange: (v: string) => void; min: number; max?: number
  audience?: ReactNode; disabled?: boolean; minHeight?: string
}) {
  const len = value.trim().length
  return (
    <div data-testid="review-reason">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={id} className={REVIEW_LABEL}>{label}</label>
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">Required</span>
      </div>
      {audience && <p id={`${id}-audience`} data-testid="review-reason-audience" className={REVIEW_HINT}>{audience}</p>}
      <textarea id={id} required minLength={min} maxLength={max} value={value} disabled={disabled}
        aria-describedby={audience ? `${id}-audience ${id}-count` : `${id}-count`}
        onChange={e => onChange(e.target.value)} className={`${REVIEW_FIELD} ${minHeight}`} />
      <p id={`${id}-count`} className={`mt-1 text-right text-[12px] tabular-nums ${len >= min ? 'text-carup-text-3' : 'text-carup-text-2'}`}>
        {len} / {min} minimum
      </p>
    </div>
  )
}

/** The decision panel: options, the required reason, what is still missing, and ONE submit. */
export function ReviewDecisionPanel({ title, description, children, requirements, submit, footnote, testId, ariaLabel }: {
  title: string; description?: ReactNode; children?: ReactNode; requirements?: { label: ReactNode; met: boolean }[]
  submit: ReactNode; footnote?: ReactNode; testId?: string; ariaLabel?: string
}) {
  return (
    <section aria-label={ariaLabel ?? title} data-testid={testId ?? 'review-decision-panel'}
      className="space-y-4 rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line-strong sm:p-5">
      <div>
        <p className={EYEBROW}>Decision</p>
        <h3 className="mt-1 text-lg font-semibold text-carup-text">{title}</h3>
        {description && <div className="mt-1 text-sm leading-6 text-carup-text-2">{description}</div>}
      </div>
      {children}
      {requirements && <ReviewRequirements items={requirements} />}
      {submit}
      {footnote && <div className="text-xs leading-5 text-carup-text-3">{footnote}</div>}
    </section>
  )
}

/** A further, separately reasoned action of the same case, folded so the main decision stays primary. */
export function ReviewMoreAction({ title, summary, children, testId }: { title: string; summary?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <details data-testid={testId} className="group rounded-card bg-carup-bg-raised ring-1 ring-carup-line">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-card px-4 py-3 text-sm font-semibold text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
        <span className="min-w-0">{title}{summary && <span className="mt-0.5 block text-xs font-normal leading-5 text-carup-text-2">{summary}</span>}</span>
        <span aria-hidden="true" className="text-carup-text-3 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-3 border-t border-carup-line px-4 pb-4 pt-3">{children}</div>
    </details>
  )
}

/** Server receipt or refusal for the last action. */
export function ReviewMessages({ notice, error, errorPrefix }: { notice?: ReactNode; error?: ReactNode; errorPrefix?: string }) {
  return (
    <>
      {notice ? <p role="status" data-testid="review-notice" className="rounded-card bg-carup-bg-surface p-4 text-sm leading-6 text-carup-text ring-1 ring-carup-line [overflow-wrap:anywhere]">{notice}</p> : null}
      {error ? <p role="alert" data-testid="review-error" className="rounded-card bg-status-danger-soft p-4 text-sm leading-6 text-status-danger [overflow-wrap:anywhere]">{errorPrefix}{error}</p> : null}
    </>
  )
}

/* ───────────────────────── audit ───────────────────────── */

export type ReviewAuditEntry = { id: string; title: ReactNode; at?: string | null; actor?: ReactNode; detail?: ReactNode; status?: string | null }

/** Only what the API returned for this case, newest first when timestamps exist. */
export function ReviewAuditTrail({ entries, empty, note, testId, title = 'Audit trail' }: {
  entries: ReviewAuditEntry[]; empty: ReactNode; note?: ReactNode; testId?: string; title?: string
}) {
  const sorted = [...entries].sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0))
  return (
    <section aria-label={title} data-testid={testId ?? 'review-audit-trail'} className={`${PANEL} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-carup-text">{title}</h3>
        <ProvenanceBadge kind="server" />
      </div>
      {note && <p className="mt-1 text-xs leading-5 text-carup-text-2">{note}</p>}
      {sorted.length === 0
        ? <p className="mt-3 text-sm text-carup-text-2">{empty}</p>
        : (
          <ol className="mt-3 space-y-3 border-l border-carup-line pl-4">
            {sorted.map(e => (
              <li key={e.id} className="relative min-w-0">
                <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-carup-line-strong ring-2 ring-carup-bg-raised" />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{e.title}</p>
                  {e.status && <ReviewStatusChip status={e.status} />}
                </div>
                <p className="mt-0.5 text-[12px] text-carup-text-3">
                  {e.at ? dealerDateTime(e.at) : 'Time not recorded'}{e.actor ? <> · {e.actor}</> : null}
                </p>
                {e.detail && <div className="mt-1 text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]">{e.detail}</div>}
              </li>
            ))}
          </ol>
        )}
    </section>
  )
}
