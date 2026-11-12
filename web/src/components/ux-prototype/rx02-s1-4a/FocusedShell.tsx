/**
 * RX-02A S1-4A — FocusedShell prototype (DEV-only).
 *
 * Reduced chrome for single-task flows (auth / identity / seller-claim /
 * flow / review-decision): clear title + progress context, ONE primary
 * action, explicit back/exit behavior, and truthful validation presentation.
 * The prototype NEVER claims to save or complete anything — a valid submit
 * renders a clearly-labelled "prototype ends here" status note instead.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import type { ShellContext } from './contracts'
import { BrandMark } from './BrandMark'
import { FixtureNotice } from './fixtureDisplay'

export interface FocusedField {
  id: string
  label: string
  required: boolean
  inputMode?: 'text' | 'email' | 'tel' | 'numeric'
  hint?: string
}

export function FocusedShell({
  context,
  title,
  stepLabel,
  fields,
  primaryLabel,
  onBack,
  onExit,
  completionNote = 'Prototype ends here — nothing is submitted or saved.',
  children,
}: {
  context: ShellContext
  title: string
  stepLabel: string
  fields: FocusedField[]
  primaryLabel: string
  onBack?: () => void
  onExit: () => void
  completionNote?: string
  children?: ReactNode
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [complete, setComplete] = useState(false)
  const summaryRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      summaryRef.current?.focus()
    }
  }, [errors])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onExit])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    for (const f of fields) {
      if (f.required && !(values[f.id] ?? '').trim()) {
        next[f.id] = `${f.label} is required`
      }
    }
    setErrors(next)
    if (Object.keys(next).length === 0) {
      setComplete(true)
    } else {
      setComplete(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-carup-bg text-carup-text">
      <a
        href="#shell-focused-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-carup-action focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-carup-action-on"
      >
        Skip to content
      </a>

      {/* Reduced chrome: back + brand + explicit exit */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-carup-line bg-carup-bg-raised px-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            data-testid="shell-focused-back"
            className="flex h-11 w-11 items-center justify-center rounded-control text-carup-text-2 transition-colors hover:bg-carup-bg-surface hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">Back</span>
          </button>
        )}
        <BrandMark slot="focused-header" tone="light" compact />
        <span className="ml-auto">
          <button
            type="button"
            onClick={onExit}
            data-testid="shell-focused-exit"
            aria-label={`Exit — ${context.identity.displayName}`}
            className="flex h-11 w-11 items-center justify-center rounded-control text-carup-text-2 transition-colors hover:bg-carup-bg-surface hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </span>
      </header>

      <main id="shell-focused-main" tabIndex={-1} className="mx-auto w-full max-w-[480px] flex-1 px-4 py-8 outline-none">
        <p className="text-xs font-medium uppercase tracking-wider text-carup-text-3">{stepLabel}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={33}
          aria-label="Progress (illustrative in this prototype)"
          className="mt-4 h-1.5 w-full overflow-hidden rounded-chrome bg-carup-bg-surface-2"
        >
          <div className="h-full w-1/3 rounded-chrome bg-carup-action" />
        </div>
        <p className="mt-1 text-[10px] text-carup-text-3">Progress is illustrative in this prototype</p>

        {Object.keys(errors).length > 0 && (
          <div
            ref={el => {
              summaryRef.current = el
            }}
            role="alert"
            tabIndex={-1}
            data-testid="shell-focused-error-summary"
            className="mt-6 rounded-card border border-status-danger bg-status-danger-soft p-4 focus:outline-none"
          >
            <p className="text-sm font-semibold text-status-danger">
              {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? '' : 's'} need attention
            </p>
            <ul className="mt-2 list-inside list-disc text-sm text-status-danger">
              {Object.entries(errors).map(([id, message]) => (
                <li key={id}>
                  <a href={`#focused-field-${id}`} className="underline underline-offset-2">
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {complete ? (
          <div role="status" className="mt-6 rounded-card border border-carup-line bg-carup-bg-raised p-6">
            <p className="text-sm font-medium">{completionNote}</p>
            <p className="mt-2 text-xs text-carup-text-3">Fictional fixture — no data was sent anywhere.</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
            {fields.map(f => {
              const error = errors[f.id]
              return (
                <div key={f.id}>
                  <label htmlFor={`focused-field-${f.id}`} className="block text-sm font-medium">
                    {f.label}
                    {f.required && (
                      <span aria-hidden="true" className="ml-0.5 text-status-danger">*</span>
                    )}
                  </label>
                  {f.hint && (
                    <p id={`focused-field-${f.id}-hint`} className="mt-0.5 text-xs text-carup-text-3">
                      {f.hint}
                    </p>
                  )}
                  <input
                    id={`focused-field-${f.id}`}
                    type="text"
                    inputMode={f.inputMode}
                    aria-invalid={error ? 'true' : undefined}
                    aria-describedby={`${f.hint ? `focused-field-${f.id}-hint ` : ''}${error ? `focused-field-${f.id}-error` : ''}`.trim() || undefined}
                    value={values[f.id] ?? ''}
                    onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))}
                    className="mt-1.5 min-h-11 w-full rounded-control border border-carup-line bg-carup-bg-raised px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-carup-focus aria-[invalid=true]:border-status-danger"
                  />
                  {error && (
                    <p id={`focused-field-${f.id}-error`} className="mt-1 text-xs font-medium text-status-danger">
                      {error}
                    </p>
                  )}
                </div>
              )
            })}

            {children}

            {/* ONE primary action, sticky at the bottom of the focused column */}
            <div className="sticky bottom-4 pt-2">
              <button
                type="submit"
                data-testid="shell-focused-primary"
                className="flex min-h-12 w-full items-center justify-center rounded-control bg-carup-action px-4 text-sm font-semibold text-carup-action-on transition-colors hover:bg-carup-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
              >
                {primaryLabel}
              </button>
            </div>
          </form>
        )}
        <div className="pointer-events-none fixed bottom-2 left-2 z-40">
          <FixtureNotice>{`FocusedShell prototype · fictional fixture`}</FixtureNotice>
        </div>
      </main>
    </div>
  )
}
