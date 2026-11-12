/**
 * RX-02A S1-4A — Temporary display-only fixture adapters (DEV-only).
 *
 * WHY THESE EXIST: the S1-3 truth components (PR #264) are not yet merged to
 * main, so this prototype cannot consume them. These adapters are a clearly
 * documented, THROWAWAY stand-in for money / trust / evidence / identity /
 * status presentation. They are replaced by the S1-3 truth components in
 * S1-4B once PR #264 merges — they must NOT be copied forward as a second
 * production implementation.
 *
 * Truthfulness rules enforced here:
 *  • money always renders currency + fixture labelling (tabular-nums)
 *  • trust NEVER renders a score, percentage, or "verified" wording
 *  • evidence lines always show actor · source · time, all fictional
 *  • public identity withholds the VIN
 */
import type { ReactNode } from 'react'
import { FICTIONAL_FIXTURE_NOTICE } from './fixtures'

const TONE_CLASSES: Record<string, string> = {
  success: 'border-status-success bg-status-success-soft text-status-success',
  warning: 'border-status-warning bg-status-warning-soft text-status-warning',
  danger: 'border-status-danger bg-status-danger-soft text-status-danger',
  info: 'border-status-info bg-status-info-soft text-status-info',
  neutral: 'border-status-neutral bg-status-neutral-soft text-status-neutral',
}

/** Small chip marking any rendered value as a fictional fixture. */
export function FixtureNotice({ children }: { children?: ReactNode }) {
  return (
    <span
      data-testid="fixture-notice"
      className="inline-flex items-center gap-1 rounded-control border border-dashed border-carup-line-strong px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-carup-text-3"
    >
      {children ?? FICTIONAL_FIXTURE_NOTICE}
    </span>
  )
}

interface FixtureMoneyProps {
  amountText: string
  currency: string
  source: string
}

/** Fixture money — amount + currency + source, never presented as real value. */
export function FixtureMoney({ amountText, currency, source }: FixtureMoneyProps) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-mono text-lg font-semibold tabular-nums" data-testid="fixture-money-amount">
        {amountText}
      </span>
      <span className="text-xs font-medium uppercase text-carup-text-3" data-testid="fixture-money-currency">
        {currency} · fixture
      </span>
      <span className="sr-only">Fictional fixture amount from {source}</span>
    </span>
  )
}

interface FixtureTrustChipProps {
  state: 'evaluated' | 'partial' | 'stale' | 'not-evaluated' | 'insufficient-data' | 'unavailable'
  label: string
  sourceCount?: number
}

const TRUST_TONE: Record<FixtureTrustChipProps['state'], keyof typeof TONE_CLASSES> = {
  evaluated: 'info',
  partial: 'info',
  stale: 'warning',
  'not-evaluated': 'neutral',
  'insufficient-data': 'neutral',
  unavailable: 'danger',
}

/**
 * Fixture trust state — tone chip ONLY. Never a score, never "verified".
 */
export function FixtureTrustChip({ state, label, sourceCount }: FixtureTrustChipProps) {
  return (
    <span
      data-testid="fixture-trust-chip"
      data-trust-state={state}
      className={`inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[TRUST_TONE[state]]}`}
    >
      {label}
      {typeof sourceCount === 'number' && (
        <span className="font-mono tabular-nums text-[10px]">· {sourceCount} fixture source{sourceCount === 1 ? '' : 's'}</span>
      )}
    </span>
  )
}

interface FixtureEvidenceLineProps {
  actor: string
  source: string
  time: string
}

/** Fixture evidence — actor · source · time, always labelled fictional. */
export function FixtureEvidenceLine({ actor, source, time }: FixtureEvidenceLineProps) {
  return (
    <li data-testid="fixture-evidence-row" className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-medium">{actor}</span>
      <span className="text-carup-text-3">·</span>
      <span className="text-carup-text-2">{source}</span>
      <span className="text-carup-text-3">·</span>
      <span className="font-mono text-xs tabular-nums text-carup-text-3">{time}</span>
    </li>
  )
}

interface FixtureVehicleIdentityProps {
  title: string
  reference: string
  /** When true (public surfaces) the VIN is withheld, never rendered. */
  publicSafe: boolean
  meta?: string[]
}

/** Fixture vehicle identity — VIN withheld on public surfaces. */
export function FixtureVehicleIdentity({ title, reference, publicSafe, meta = [] }: FixtureVehicleIdentityProps) {
  return (
    <div data-testid="fixture-vehicle-identity">
      <p className="text-base font-semibold">{title}</p>
      <p className="font-mono text-xs tabular-nums text-carup-text-3">{reference}</p>
      {meta.length > 0 && <p className="mt-1 text-sm text-carup-text-2">{meta.join(' · ')}</p>}
      {publicSafe && <p className="mt-1 text-xs text-carup-text-3">VIN withheld on public surfaces</p>}
    </div>
  )
}

interface FixtureStatusBadgeProps {
  label: string
  tone: keyof typeof TONE_CLASSES
}

/** Fixture status badge. */
export function FixtureStatusBadge({ label, tone }: FixtureStatusBadgeProps) {
  return (
    <span
      data-testid="fixture-status-badge"
      className={`inline-flex items-center rounded-control border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  )
}
