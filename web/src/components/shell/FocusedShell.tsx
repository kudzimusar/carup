/**
 * RX-02A S1-4B — FocusedShell (production-intent, default-OFF candidate).
 *
 * Reduced chrome for focused interactions (auth, account recovery, KYC,
 * checkout, review decisions): back + brand + explicit exit, an optional
 * step/progress indicator, and a single prioritized content column. No public
 * bottom bar or marketing footer during a critical task. Renders the REAL page
 * (its own form, validation, submit and error handling) as `children` — this
 * shell supplies layout and chrome only, so nothing the page does is stubbed
 * or short-circuited.
 *
 * Derived from the independently approved S1-4A prototype (pull request 266) with the
 * fictional demo form, the DEV-only fixture notice and prototype labelling
 * removed. The identity shown is the REAL session (or a generic visitor).
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import type { ShellIdentity } from './contracts'
import { BrandMark } from './BrandMark'

export function FocusedShell({
  identity,
  title,
  stepLabel,
  progress,
  onBack,
  onExit,
  children,
}: {
  identity: ShellIdentity
  /** Page title rendered in the focused header. */
  title: string
  /** Optional step label, e.g. "Step 1 of 3" or "Sign in". */
  stepLabel?: string
  /** Optional progress 0–100; renders a determinate progressbar when provided. */
  progress?: number
  onBack?: () => void
  onExit: () => void
  children?: ReactNode
}) {
  const mainRef = useRef<HTMLElement | null>(null)

  // Move focus to the focused main region on mount so keyboard/AT users land
  // on the task content, not on the chrome.
  useEffect(() => {
    mainRef.current?.focus()
  }, [])

  // Escape exits the focused task — but NEVER while the user is typing in a
  // form control (inadvertent abort of an in-progress/unsaved task, R2-5).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      onExit()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onExit])

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
            aria-label={`Exit — ${identity.displayName}`}
            className="flex h-11 w-11 items-center justify-center rounded-control text-carup-text-2 transition-colors hover:bg-carup-bg-surface hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </span>
      </header>

      <main
        id="shell-focused-main"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-[480px] flex-1 px-4 py-8 outline-none"
      >
        {stepLabel && (
          <p className="text-xs font-medium uppercase tracking-wider text-carup-text-3">{stepLabel}</p>
        )}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {typeof progress === 'number' && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.max(0, Math.min(100, Math.round(progress)))}
            aria-label="Progress"
            className="mt-4 h-1.5 w-full overflow-hidden rounded-chrome bg-carup-bg-surface-2"
          >
            <div
              className="h-full rounded-chrome bg-carup-action"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
