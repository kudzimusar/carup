/**
 * RX04-D — Seller Studio: one composition for the guest draft (/sell) and the account draft
 * (/dashboard/sell-vehicle). Each page keeps its own form state, validation, autosave, identity
 * checks, uploads and submission; this frame only arranges them:
 *
 *   heading (the vehicle, once named) · stepper (jump back to any finished step) · the page's step
 *   content · ONE action bar (sticky on phones) · beside it, the real buyer card and what is left.
 *
 * I-03 "Intelligent Seller Studio": what is left is computed by lib/sellerReadiness from the rules the
 * page already enforces and the existing listing-quality checks — never a score, never a Trust or
 * verification claim. Publication readiness stays with governed evidence review.
 */
import type { ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Circle, Loader2 } from 'lucide-react'
import type { ReadinessItem, SellerReadiness } from '@/lib/sellerReadiness'

export interface StudioAction {
  label: ReactNode
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  testId?: string
  /** A forward arrow for step navigation; omitted on a final save. */
  forward?: boolean
}

interface SellerStudioFrameProps {
  /** Small label above the heading, e.g. "Private draft · not public". */
  eyebrow: string
  title: string
  description?: string
  /** Facts under the heading: VIN, autosave state, path. */
  meta?: ReactNode
  /** Secondary heading control (e.g. change vehicle path). */
  headerAction?: ReactNode
  steps: ReadonlyArray<{ label: string; note?: string }>
  step: number
  onStepSelect: (index: number) => void
  notices?: ReactNode
  readiness: SellerReadiness
  /** The real buyer card for this draft (omitted on a step that already shows it). */
  preview?: ReactNode
  /** What the seller still controls or must know (privacy, Trust, evidence). */
  context?: ReactNode
  /** Publication pointer copy — governed, never computed here. */
  publishNote: ReactNode
  back?: StudioAction
  primary?: StudioAction
  children: ReactNode
  testId?: string
  heroTestId?: string
}

const ACTION_PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-carup-action px-5 text-sm font-semibold text-carup-action-on transition-colors hover:bg-carup-action-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'
const ACTION_SECONDARY = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text ring-1 ring-carup-line transition-colors hover:bg-carup-bg-surface disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus'

function Stepper({ steps, step, onStepSelect }: Pick<SellerStudioFrameProps, 'steps' | 'step' | 'onStepSelect'>) {
  return (
    <nav aria-label="Listing steps" data-testid="seller-studio-stepper">
      <ol className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {steps.map((item, index) => {
          const done = index < step
          const current = index === step
          const bar = current ? 'bg-carup-action' : done ? 'bg-carup-text' : 'bg-carup-line'
          const body = (
            <>
              <span className={`block h-1 rounded-full ${bar}`} aria-hidden="true" />
              <span className="mt-2 flex items-center gap-1.5">
                <span
                  className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-semibold ${
                    current ? 'bg-carup-action text-carup-action-on' : done ? 'bg-carup-text text-carup-bg-raised' : 'bg-carup-bg-surface-2 text-carup-text-3'
                  }`}
                  aria-hidden="true"
                >
                  {done ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className={`truncate text-xs font-semibold ${current ? 'text-carup-text' : done ? 'text-carup-text-2' : 'text-carup-text-3'} ${current ? '' : 'hidden sm:inline'}`}>
                  {item.label}
                </span>
              </span>
            </>
          )
          return (
            <li key={item.label} className="min-w-0" data-testid={`seller-studio-step-${index}`} data-state={current ? 'current' : done ? 'done' : 'upcoming'}>
              {done ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(index)}
                  className="block w-full rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                  aria-label={`Go back to step ${index + 1}: ${item.label}`}
                >
                  {body}
                </button>
              ) : (
                <div aria-current={current ? 'step' : undefined}>{body}</div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function ReadinessRow({ item, step, steps, onStepSelect, showHint }: {
  item: ReadinessItem
  step: number
  steps: ReadonlyArray<{ label: string }>
  onStepSelect: (index: number) => void
  showHint?: boolean
}) {
  const reachable = item.step < step
  const here = item.step === step
  return (
    <li className="flex items-start gap-2.5 py-2" data-testid={`seller-readiness-item-${item.key}`} data-done={item.done ? 'true' : 'false'}>
      <span className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-full ${item.done ? 'bg-status-success text-carup-action-on' : 'text-carup-text-3'}`} aria-hidden="true">
        {item.done ? <Check className="h-3 w-3" /> : <Circle className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${item.done ? 'text-carup-text-2' : 'font-medium text-carup-text'}`}>
          {item.label}
          <span className="sr-only">{item.done ? ' — done' : ' — still needed'}</span>
        </span>
        {!item.done && showHint && item.hint && <span className="mt-0.5 block text-xs leading-5 text-carup-text-2">{item.hint}</span>}
      </span>
      {!item.done && (
        reachable ? (
          <button
            type="button"
            onClick={() => onStepSelect(item.step)}
            className="flex-none rounded-control px-1.5 text-xs font-semibold text-carup-action underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
          >
            Fix in {steps[item.step]?.label ?? `step ${item.step + 1}`}
          </button>
        ) : (
          <span className="flex-none text-xs text-carup-text-3">{here ? 'This step' : `Step ${item.step + 1}`}</span>
        )
      )}
    </li>
  )
}

export function SellerReadinessPanel({ readiness, step, steps, onStepSelect, publishNote }: {
  readiness: SellerReadiness
  step: number
  steps: ReadonlyArray<{ label: string }>
  onStepSelect: (index: number) => void
  publishNote: ReactNode
}) {
  const required = readiness.required.length
  const stronger = readiness.stronger.length
  const strongerOpen = readiness.stronger.filter(item => !item.done)
  return (
    <section
      id="seller-readiness"
      className="rounded-card border border-carup-line bg-carup-bg-raised p-5"
      aria-labelledby="seller-readiness-title"
      data-testid="seller-readiness"
    >
      <h2 id="seller-readiness-title" className="text-sm font-semibold text-carup-text">What&rsquo;s left</h2>
      <p className="mt-1 text-xs leading-5 text-carup-text-2">Counted from the checks this form already makes. Not a score, and not a Trust result.</p>

      <div className="mt-4" data-testid="seller-readiness-required" data-done={readiness.requiredDone} data-total={required}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-2">To save the draft</h3>
          <span className="text-xs font-semibold text-carup-text">{readiness.requiredDone} of {required}</span>
        </div>
        <ul className="mt-1 divide-y divide-carup-line">
          {readiness.required.map(item => (
            <ReadinessRow key={item.key} item={item} step={step} steps={steps} onStepSelect={onStepSelect} />
          ))}
        </ul>
      </div>

      <div className="mt-5" data-testid="seller-readiness-stronger" data-done={readiness.strongerDone} data-total={stronger}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-2">To make the listing stronger</h3>
          <span className="text-xs font-semibold text-carup-text">{readiness.strongerDone} of {stronger}</span>
        </div>
        <ul className="mt-1 divide-y divide-carup-line">
          {[...readiness.stronger.filter(item => item.done), ...strongerOpen].map(item => (
            <ReadinessRow
              key={item.key}
              item={item}
              step={step}
              steps={steps}
              onStepSelect={onStepSelect}
              showHint={strongerOpen.indexOf(item) > -1 && strongerOpen.indexOf(item) < 2}
            />
          ))}
        </ul>
      </div>

      <div className="mt-5 rounded-control bg-carup-bg-surface p-3" data-testid="seller-readiness-publish">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-2">To publish</h3>
        <div className="mt-1 text-xs leading-5 text-carup-text-2">{publishNote}</div>
      </div>
    </section>
  )
}

export function SellerStudioFrame({
  eyebrow, title, description, meta, headerAction, steps, step, onStepSelect, notices, readiness, preview, context,
  publishNote, back, primary, children, testId, heroTestId,
}: SellerStudioFrameProps) {
  const current = steps[step]
  return (
    <div className="space-y-5 lg:space-y-6" data-testid={testId}>
      <header className="space-y-3" data-testid={heroTestId}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-carup-text-2">{eyebrow}</p>
          {headerAction}
        </div>
        <h1 className="text-[clamp(1.6rem,3vw,2.4rem)] font-bold leading-tight tracking-[-0.03em] text-carup-text" data-testid="seller-studio-title">
          {title}
        </h1>
        {description && <p className="max-w-3xl text-sm leading-6 text-carup-text-2">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-carup-text-2">{meta}</div>}
      </header>

      <Stepper steps={steps} step={step} onStepSelect={onStepSelect} />

      <a
        href="#seller-readiness"
        className="flex items-center justify-between gap-3 rounded-control border border-carup-line bg-carup-bg-raised px-4 py-3 text-sm lg:hidden"
        data-testid="seller-readiness-summary"
      >
        <span className="text-carup-text">
          <span className="font-semibold">{readiness.requiredDone} of {readiness.required.length}</span> needed to save
          <span className="text-carup-text-2"> · {readiness.strongerDone} of {readiness.stronger.length} to strengthen</span>
        </span>
        <span className="text-xs font-semibold text-carup-action">What&rsquo;s left</span>
      </a>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
        <div className="min-w-0 space-y-4">
          {notices}
          <section className="rounded-card border border-carup-line bg-carup-bg-raised" aria-labelledby="seller-studio-step-title">
            <div className="border-b border-carup-line px-4 py-4 sm:px-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Step {step + 1} of {steps.length}</p>
              <h2 id="seller-studio-step-title" className="mt-1 text-lg font-semibold text-carup-text">{current?.label}</h2>
              {current?.note && <p className="mt-0.5 text-sm text-carup-text-2">{current.note}</p>}
            </div>
            <div className="seller-studio-fields space-y-4 px-4 py-5 sm:px-6">{children}</div>
            {(back || primary) && (
              <div
                className="sticky bottom-0 z-20 flex items-center justify-between gap-3 rounded-b-card border-t border-carup-line bg-carup-bg-raised px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 lg:static"
                data-testid="seller-studio-actions"
              >
                {back ? (
                  <button type="button" className={ACTION_SECONDARY} onClick={back.onClick} disabled={back.disabled} data-testid={back.testId}>
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {back.label}
                  </button>
                ) : <span />}
                {primary && (
                  <button
                    type="button"
                    className={ACTION_PRIMARY}
                    onClick={primary.onClick}
                    disabled={primary.disabled}
                    aria-busy={primary.busy ? true : undefined}
                    data-testid={primary.testId}
                  >
                    {primary.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {primary.label}
                    {!primary.busy && primary.forward !== false && <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-20" aria-label="Your listing as buyers will see it">
          {preview && (
            <section className="rounded-card border border-carup-line bg-carup-bg-surface p-4" data-testid="seller-studio-preview">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-carup-text">Buyer preview</h2>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">Not public</span>
              </div>
              <div className="mx-auto max-w-sm">{preview}</div>
            </section>
          )}
          <SellerReadinessPanel readiness={readiness} step={step} steps={steps} onStepSelect={onStepSelect} publishNote={publishNote} />
          {context}
        </aside>
      </div>
    </div>
  )
}
