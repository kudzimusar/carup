import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, RotateCw, Search } from 'lucide-react'
import { DataState, EvidenceLine, type DataStateKind } from '@/components/truth'
import { buildLoginRedirect } from '@/lib/returnTo'
import { cn } from '@/lib/utils'
import {
  READ_SOURCE_LABELS,
  READ_SOURCE_ORDER,
  describeReadOutcome,
  type ReadLedger,
  type VehicleDetailFailure,
} from '@/lib/vehicleDetailReadOutcome'

/**
 * TI-27 — Vehicle Detail read states, composed as a SHOWROOM STAGE rather than a centred icon card.
 *
 * The live detail page is a two-region stage: the gallery on the left, the buyer decision panel on
 * the right. Its failure and loading states keep that geometry so a buyer is never dropped into a
 * different-looking page when something goes wrong:
 *
 *   ┌ masthead (navy band: where you are, what you asked for) ──────────────────────────┐
 *   │ ┌ identifier plate (gallery slot) ┐  ┌ decision panel ──────────────────────────┐ │
 *   │ │  REQUESTED                       │  │  h1 — what CarUp can honestly say         │ │
 *   │ │  [ GFC27-0… ]                    │  │  DataState — the read outcome + 1 action  │ │
 *   │ │  ● status strip                  │  │  secondary routes (search · sign-in)      │ │
 *   │ └──────────────────────────────────┘  │  What CarUp checked — EvidenceLine ledger │ │
 *   │                                       └──────────────────────────────────────────┘ │
 *
 * Truth rules carried by this file (tested in VehicleDetail.ti27.test.tsx):
 *   - an unanswered read never renders as "not found" or "doesn't exist";
 *   - "not found" copy is non-enumerable ("no public listing"), because the listing service returns
 *     the same 404 for missing, unpublished and private listings;
 *   - the guest plate-search refusal is offered as a way to WIDEN the search, never as the reason;
 *   - sign-in links carry the full return path (pathname + query) through the safe returnTo helper;
 *   - the requested identifier is echoed only because the visitor supplied it; no inventory fact
 *     (owner, seller, status, price) is ever named in a failure state.
 */

const MAX_IDENTIFIER_CHARS = 32

function displayIdentifier(identifier: string): string {
  let decoded = identifier
  try { decoded = decodeURIComponent(identifier) } catch { /* keep raw */ }
  return decoded.length > MAX_IDENTIFIER_CHARS ? `${decoded.slice(0, MAX_IDENTIFIER_CHARS - 1)}…` : decoded
}

function clockLabel(at: Date | null): string | null {
  if (!at) return null
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Back through history when the visitor arrived from inside CarUp — that restores their exact
 *  Marketplace search URL (filters live in the query). Otherwise a plain Marketplace link. */
function useBackToSearch(): { canGoBack: boolean; goBack: () => void } {
  const navigate = useNavigate()
  const historyIndex = typeof window !== 'undefined'
    ? (window.history.state as { idx?: unknown } | null)?.idx
    : undefined
  return {
    canGoBack: typeof historyIndex === 'number' && historyIndex > 0,
    goBack: () => navigate(-1),
  }
}

// ── Shared stage chrome ────────────────────────────────────────────────────────────────────────

function Masthead({ identifier }: { identifier: string }) {
  return (
    <div className="border-b border-carup-raw-ink-2 bg-carup-raw-ink text-carup-raw-paper">
      <nav aria-label="Breadcrumb" className="section-padding mx-auto flex max-w-[1440px] items-center gap-2 py-4 text-[13px] text-carup-raw-line-strong">
        <Link to="/" className="rounded-chrome hover:text-carup-raw-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-carup-raw-orange-signal">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to="/marketplace" className="rounded-chrome hover:text-carup-raw-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-carup-raw-orange-signal">Marketplace</Link>
        <span aria-hidden="true">/</span>
        <span className="min-w-0 truncate font-mono text-carup-raw-paper" data-testid="read-state-breadcrumb-id">
          {displayIdentifier(identifier)}
        </span>
      </nav>
    </div>
  )
}

type PlateTone = 'neutral' | 'signal' | 'quiet'

function IdentifierPlate({
  identifier,
  statusLabel,
  tone,
  busy = false,
}: {
  identifier: string
  statusLabel: string
  tone: PlateTone
  busy?: boolean
}) {
  return (
    <div
      className="relative flex min-h-[188px] flex-col justify-between overflow-hidden rounded-card bg-carup-raw-navy p-5 text-carup-raw-paper sm:min-h-[260px] sm:p-7 lg:sticky lg:top-24 lg:aspect-[16/11] lg:min-h-0"
      data-testid="read-state-plate"
    >
      {/* Drafting grid: a technical surface, not decoration — it is the empty gallery slot. */}
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full text-carup-raw-ink-2" preserveAspectRatio="none">
        <defs>
          <pattern id="ti27-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ti27-grid)" />
      </svg>

      <p className="relative font-mono text-[11px] uppercase tracking-[0.22em] text-carup-raw-line-strong">
        Requested identifier
      </p>

      <div className="relative my-6 self-start">
        {busy ? (
          <div aria-hidden="true" className="h-12 w-56 max-w-full animate-pulse rounded-control bg-carup-raw-ink-2 sm:h-14 sm:w-72" />
        ) : (
          <p
            className="max-w-full break-all rounded-control border-2 border-carup-raw-line-strong px-4 py-2 font-mono text-[22px] font-semibold leading-tight tracking-[0.08em] sm:text-[30px]"
            data-testid="read-state-identifier"
          >
            {displayIdentifier(identifier)}
          </p>
        )}
      </div>

      <p className="relative flex items-center gap-2 text-[13px] font-medium" data-testid="read-state-plate-status">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-2.5 w-2.5 rounded-full',
            tone === 'signal' && 'bg-carup-raw-orange-signal',
            tone === 'neutral' && 'bg-carup-raw-line-strong',
            tone === 'quiet' && 'animate-pulse bg-carup-raw-line-strong',
          )}
        />
        {statusLabel}
      </p>
    </div>
  )
}

function Stage({ identifier, plate, children, state }: { identifier: string; plate: ReactNode; children: ReactNode; state: string }) {
  return (
    <div className="min-h-screen bg-carup-bg text-carup-text" data-testid="vehicle-detail-read-state" data-read-state={state}>
      <Masthead identifier={identifier} />
      <div className="section-padding mx-auto grid max-w-[1440px] gap-6 py-6 sm:gap-8 sm:py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
        {plate}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}

function ReadLedgerList({ ledger, checkedAt }: { ledger: ReadLedger; checkedAt: Date | null }) {
  const rows = READ_SOURCE_ORDER.filter((source) => ledger[source])
  if (rows.length === 0) return null
  const at = clockLabel(checkedAt)
  return (
    <section aria-labelledby="ti27-ledger-heading" className="mt-8 border-t border-carup-line pt-5" data-testid="read-state-ledger">
      <h2 id="ti27-ledger-heading" className="font-mono text-[11px] uppercase tracking-[0.2em] text-carup-text-3">
        What CarUp checked
      </h2>
      <div className="mt-3 space-y-1.5">
        {rows.map((source) => (
          <div key={source} data-testid={`read-ledger-${source}`}>
            <EvidenceLine actor="CarUp" source={READ_SOURCE_LABELS[source]} at={at} status={describeReadOutcome(ledger[source])} />
          </div>
        ))}
      </div>
    </section>
  )
}

function LookupAnother({ onLookup }: { onLookup: (identifier: string) => void }) {
  const [value, setValue] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = value.trim()
    if (next) onLookup(next)
  }
  return (
    <form onSubmit={submit} className="mt-6 flex max-w-md gap-2" role="search" aria-label="Look up another vehicle">
      <label htmlFor="ti27-lookup" className="sr-only">VIN, chassis, plate or temporary ID</label>
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-carup-text-3" />
        <input
          id="ti27-lookup"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="VIN, chassis or plate"
          className="h-11 w-full rounded-control border border-carup-line-strong bg-carup-bg-raised pl-9 pr-3 text-[14px] text-carup-text placeholder:text-carup-text-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-carup-focus"
        />
      </div>
      <button
        type="submit"
        className="h-11 shrink-0 rounded-control border border-carup-line-strong bg-carup-bg-raised px-4 text-[14px] font-medium text-carup-text hover:bg-carup-bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-carup-focus"
      >
        Look up
      </button>
    </form>
  )
}

const primaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-carup-action px-5 text-[14px] font-semibold text-carup-action-on hover:bg-carup-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carup-focus'
const quietLink =
  'inline-flex min-h-11 items-center gap-2 rounded-control px-1 text-[14px] font-medium text-carup-text underline decoration-carup-line-strong underline-offset-4 hover:decoration-carup-action focus-visible:outline focus-visible:outline-2 focus-visible:outline-carup-focus'

// ── Loading ───────────────────────────────────────────────────────────────────────────────────

export function VehicleDetailLoadingStage({ identifier, slow }: { identifier: string; slow: boolean }) {
  return (
    <Stage
      identifier={identifier}
      state="loading"
      plate={<IdentifierPlate identifier={identifier} statusLabel="Reading CarUp's vehicle records" tone="quiet" busy />}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-carup-text-3">Vehicle detail</p>
      <div aria-hidden="true" className="mt-3 h-9 w-4/5 animate-pulse rounded-control bg-carup-bg-surface-2" />
      <DataState state="loading" subject="Vehicle detail" className="mt-6" />
      <p aria-live="polite" className="mt-4 min-h-[1.5em] text-[13px] text-carup-text-2" data-testid="read-state-slow-notice">
        {slow ? 'Still waiting for CarUp’s vehicle records. Nothing has been concluded about this car yet.' : ''}
      </p>
    </Stage>
  )
}

// ── Failure ───────────────────────────────────────────────────────────────────────────────────

interface FailureCopy {
  headline: string
  plateStatus: string
  tone: PlateTone
  dataState: DataStateKind
  subject: string
  description: string
  retry: boolean
}

function failureCopy(failure: VehicleDetailFailure, isAuthenticated: boolean): FailureCopy {
  switch (failure.kind) {
    case 'not-found':
      return {
        headline: 'No public listing at this address',
        plateStatus: 'No public listing',
        tone: 'neutral',
        dataState: 'empty',
        subject: 'Public listing',
        description:
          'CarUp’s marketplace and vehicle passport both answered, and neither holds a public listing for this identifier. ' +
          'A car can leave public view when it is sold or withdrawn, and links can be mistyped.',
        retry: false,
      }
    case 'ambiguous':
      return {
        headline: 'More than one vehicle matches',
        plateStatus: 'Several matches',
        tone: 'signal',
        dataState: 'empty',
        subject: 'Public listing',
        description: 'This identifier matches more than one vehicle, so CarUp won’t guess which one you meant. Search by the full VIN instead.',
        retry: false,
      }
    case 'forbidden':
      return {
        headline: 'This listing isn’t open to your account',
        plateStatus: 'Restricted',
        tone: 'signal',
        dataState: 'forbidden',
        subject: 'Listing',
        description: isAuthenticated
          ? 'CarUp refused this read for the account you are signed in with. That is a statement about access, not about the car.'
          : 'CarUp refused this read without a signed-in account. That is a statement about access, not about the car.',
        retry: false,
      }
    case 'session-expired':
      return {
        headline: 'Your session ended while this page loaded',
        plateStatus: 'Session ended',
        tone: 'signal',
        dataState: 'error',
        subject: 'Vehicle detail',
        description: 'CarUp signed you out on this device because the session was no longer valid. Retry to load the public view, or sign in again.',
        retry: true,
      }
    case 'unavailable':
    default: {
      const base = { tone: 'signal' as const, dataState: 'error' as const, subject: 'Vehicle detail', retry: true }
      switch (failure.cause) {
        case 'network':
          return {
            ...base,
            headline: 'CarUp can’t be reached right now',
            plateStatus: 'Unreachable',
            description:
              'Your device couldn’t reach CarUp’s vehicle records. Check your connection and retry — this address is kept, so nothing is lost. ' +
              'This says nothing about whether the car is still listed.',
          }
        case 'timeout':
          return {
            ...base,
            headline: 'This is taking longer than it should',
            plateStatus: 'No reply in time',
            description:
              'CarUp’s vehicle records haven’t answered within the time we allow. Nothing has been concluded about this car — retry, or come back shortly.',
          }
        case 'rate-limited':
          return {
            ...base,
            headline: 'Too many lookups — pausing briefly',
            plateStatus: 'Paused',
            description: 'CarUp received many vehicle lookups from this connection in a short time. Wait a moment, then retry.',
          }
        case 'server':
          return {
            ...base,
            headline: 'We couldn’t load this listing',
            plateStatus: 'Service error',
            description:
              'CarUp’s vehicle service returned an error. The problem is on our side, and it doesn’t mean the listing was removed.',
          }
        default:
          return {
            ...base,
            headline: 'We couldn’t load this listing',
            plateStatus: 'No usable answer',
            description: 'CarUp received an answer it couldn’t interpret, so nothing has been concluded about this car.',
          }
      }
    }
  }
}

export interface VehicleDetailFailureStageProps {
  identifier: string
  failure: VehicleDetailFailure
  ledger: ReadLedger
  checkedAt: Date | null
  isAuthenticated: boolean
  onRetry: () => void
  onLookup: (identifier: string) => void
}

export function VehicleDetailFailureStage({
  identifier,
  failure,
  ledger,
  checkedAt,
  isAuthenticated,
  onRetry,
  onLookup,
}: VehicleDetailFailureStageProps) {
  const location = useLocation()
  const { canGoBack, goBack } = useBackToSearch()
  const copy = failureCopy(failure, isAuthenticated)
  const loginHref = buildLoginRedirect(`${location.pathname}${location.search}`)
  const offerSignIn = !isAuthenticated && (failure.signInWidensSearch || failure.kind === 'forbidden' || failure.kind === 'session-expired')

  const backToSearch = canGoBack ? (
    <button type="button" onClick={goBack} className={copy.retry ? quietLink : primaryButton} data-testid="read-state-back">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to your search
    </button>
  ) : (
    <Link to="/marketplace" className={copy.retry ? quietLink : primaryButton} data-testid="read-state-back">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Browse the Marketplace
    </Link>
  )

  return (
    <Stage
      identifier={identifier}
      state={failure.kind}
      plate={<IdentifierPlate identifier={identifier} statusLabel={copy.plateStatus} tone={copy.tone} />}
    >
      <div data-testid="vehicle-detail-failure" data-failure-kind={failure.kind} data-failure-cause={failure.cause ?? ''}>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-carup-text-3">Vehicle detail</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-[1.15] tracking-[-0.01em] text-carup-text sm:text-[36px]">
          {copy.headline}
        </h1>

        <DataState
          state={copy.dataState}
          subject={copy.subject}
          description={copy.description}
          className="mt-6"
        />

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
          {copy.retry && (
            <button type="button" onClick={onRetry} className={primaryButton} data-testid="read-state-retry">
              <RotateCw aria-hidden="true" className="h-4 w-4" /> Try again
            </button>
          )}
          {backToSearch}
          {offerSignIn && (
            <Link to={loginHref} className={quietLink} data-testid="read-state-sign-in">
              {failure.signInWidensSearch ? 'Sign in to search by plate or temporary ID' : 'Sign in'}
            </Link>
          )}
        </div>

        <LookupAnother onLookup={onLookup} />
        <ReadLedgerList ledger={ledger} checkedAt={checkedAt} />
      </div>
    </Stage>
  )
}

// ── Partial (vehicle rendered, listing read did not answer) ─────────────────────────────────

export function VehicleDetailPartialNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mb-6" data-testid="vehicle-detail-partial">
      <DataState
        state="error"
        subject="Price and seller details"
        description="The marketplace listing didn’t answer, so price, seller and buying actions may be missing below. The vehicle record itself loaded."
        action={{ label: 'Retry listing details', onClick: onRetry }}
      />
    </div>
  )
}
