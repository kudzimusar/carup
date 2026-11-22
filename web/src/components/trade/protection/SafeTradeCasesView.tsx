/**
 * RX-06 Protection — the unified SafeTrade case ledger (/diaspora/safetrade).
 *
 * Presentation only. The case list (participant / tenant scoped by the server), the server-side status
 * filter and the client-side role / order / dispute filters are the page container's own state and read
 * (DiasporaSafeTrade). Truth rules: SafeTrade is non-custodial and sandbox-only (the assurance notice is
 * always shown; totals are "declared", never "held"); a failed, refused, rate-limited or switched-off read
 * is never shown as "no cases".
 */
import { SignInLink } from '@/components/trade/core/SignInLink'
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_FIELD, WS_LABEL, WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import { SAFETRADE_LIFECYCLE_PHASES, designStateOf, formatMoney, stateLabel } from '@/components/diaspora/safetrade/safeTradeHelpers'
import { buildLoginRedirect } from '@/lib/returnTo'
import type { SafeTradeTransaction } from '@/types'
import { DeskHeader, DeskState, PulseLine, RefCode } from '@/components/trade/sourcing/TradeDesk'
import { failureKind, formatDay, plural } from '@/components/trade/sourcing/deskKit'
import { AssuranceNote } from './AssuranceNote'
import {
  RELATIONSHIP_LABEL, SAFETRADE_DB_STATUSES, caseTone, dbStatusOptionLabel, isDisputed, relationshipOf, type SafeTradeCasesModel,
} from './safeTradeDesk'

const caseHref = (id: string) => `/diaspora/safetrade/${encodeURIComponent(id)}`

export function SafeTradeCasesView({ model }: { model: SafeTradeCasesModel }) {
  const header = (
    <DeskHeader
      eyebrow="Trade · Protection"
      title="SafeTrade"
      description="Assurance for one trade between a buyer and a seller: eligibility checks, commitments, documents, delivery and disputes, coordinated case by case."
      meta={<StatusChip tone="warning" testId="trade-safetrade-sandbox-chip">Sandbox simulation · live payment off</StatusChip>}
    />
  )
  const frame = (body: ReactNode) => (
    <div className="min-w-0 space-y-5 sm:space-y-6" data-testid="trade-safetrade" data-presentation="trade-desk">{header}{body}</div>
  )

  if (!model.flagEnabled) {
    return frame(
      <DeskState kind="unavailable" title="SafeTrade is not switched on in this environment" testId="trade-safetrade-unavailable">
        An administrator can enable it. Nothing was loaded.
      </DeskState>,
    )
  }
  if (model.authLoading) return frame(<DeskState kind="loading" title="Checking your access…" testId="trade-safetrade-auth-loading" />)
  if (!model.signedIn) {
    return frame(
      <>
        <AssuranceNote />
        <DeskState kind="signin" title="Sign in to see your SafeTrade cases" action={<Link to={buildLoginRedirect('/diaspora/safetrade')} className={WS_PRIMARY}>Sign in</Link>} testId="trade-safetrade-signin">
          Cases are shown only to their buyer, seller and CarUp reviewers.
        </DeskState>
      </>,
    )
  }

  const f = model.filters
  const filtering = Boolean(f.status) || f.rel !== 'all' || f.disputedOnly || Boolean(f.order)
  const loading = model.loading || !model.answered
  const failed = !model.loading && model.error !== null

  return frame(
    <>
      <AssuranceNote />
      {/* Filters narrow a list; over an empty, unfiltered list they would only add noise. */}
      {(model.cases.length > 0 || filtering) && <Filters model={model} />}
      {loading && <DeskState kind="loading" title="Loading your SafeTrade cases…" testId="trade-safetrade-loading" />}
      {failed && <ListFailure model={model} />}
      {!loading && !failed && (
        model.filtered.length === 0 ? (
          filtering && model.cases.length > 0 ? (
            <DeskState kind="empty" title="No cases match these filters" testId="trade-safetrade-filtered-empty"
              action={<button type="button" className={WS_SECONDARY} onClick={() => { f.setStatus(''); f.setRel('all'); f.setDisputedOnly(false); f.setOrder('') }}>Clear filters</button>}>
              {plural(model.cases.length, 'case is', 'cases are')} hidden by the filters above.
            </DeskState>
          ) : filtering ? (
            <DeskState kind="empty" title="No cases match these filters" testId="trade-safetrade-filtered-empty"
              action={<button type="button" className={WS_SECONDARY} onClick={() => { f.setStatus(''); f.setRel('all'); f.setDisputedOnly(false); f.setOrder('') }}>Clear filters</button>}>
              The server returned no case with this status for your account.
            </DeskState>
          ) : (
            <DeskState
              kind="empty"
              title="No SafeTrade cases involve you yet"
              testId="trade-safetrade-empty"
              action={(
                <>
                  <Link to="/diaspora/rfq" className={WS_SECONDARY}>Sourcing requests</Link>
                  <Link to="/diaspora/trade-profile" className={WS_SECONDARY}>Trade profile</Link>
                </>
              )}
            >
              A case is opened for an import order once the buyer has accepted a seller’s quote and both trade profiles are verified — its eligibility check requires both.
              Opening a case is not offered on this page.
              <HowACaseMoves />
            </DeskState>
          )
        ) : (
          <>
            <PulseLine
              label="Cases at a glance"
              testId="trade-safetrade-pulse"
              items={[
                { label: model.filtered.length === 1 ? 'case' : 'cases', value: model.filtered.length, key: 'all' },
                { label: 'in dispute', value: model.filtered.filter(isDisputed).length, key: 'disputed' },
              ]}
            />
            <CaseLedger cases={model.filtered} viewerId={model.viewerId} />
          </>
        )
      )}
    </>,
  )
}

/** The real lifecycle a case follows (the shared lifecycle order and labels), as a teaching strip. */
function HowACaseMoves() {
  const happy = SAFETRADE_LIFECYCLE_PHASES.slice(0, 11)
  return (
    <div className="mt-4" data-testid="trade-safetrade-how">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-carup-text-3">How a case moves</p>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {happy.map((state, i) => (
          <li key={state} className="inline-flex items-center gap-1.5 rounded-full border border-carup-line bg-carup-bg-surface px-2.5 py-1 text-xs text-carup-text-2">
            <span className="font-mono text-[11px] text-carup-text-3" aria-hidden="true">{i + 1}</span>{stateLabel(state)}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs leading-5 text-carup-text-3">Payment steps are a sandbox simulation. A dispute, suspension, cancellation or refund can interrupt any case.</p>
    </div>
  )
}

function ListFailure({ model }: { model: SafeTradeCasesModel }) {
  const kind = failureKind(model.failure ? { status: model.failure.status, message: model.failure.message ?? model.error } : { status: null, message: model.error })
  if (kind === 'limited') return <DeskState kind="limited" title="Too many requests right now" onRetry={model.onRetry} retryLabel="Retry now" testId="trade-safetrade-failed">Your cases could not be read because of the shared request limit. Nothing is retried automatically — wait about a minute, then retry.</DeskState>
  if (kind === 'missing') return <DeskState kind="unavailable" title="SafeTrade is not switched on for this server" testId="trade-safetrade-failed">The server answered that SafeTrade is not enabled (404). This is not a report that you have no cases.</DeskState>
  if (kind === 'tenant') return <DeskState kind="tenant" title="A tenant context is required to view SafeTrade cases" testId="trade-safetrade-failed">Your account carries no trading tenant, and the server scopes cases by tenant.</DeskState>
  if (kind === 'denied') return <DeskState kind="denied" title="The server refused SafeTrade cases to this account" testId="trade-safetrade-failed">This is a permission answer (403), not an empty list.</DeskState>
  if (kind === 'session') return <DeskState kind="signin" title="Your session ended" action={<SignInLink className={WS_PRIMARY}>Sign in again</SignInLink>} testId="trade-safetrade-failed">Sign in again to see your cases.</DeskState>
  return <DeskState kind="failed" title="Your SafeTrade cases could not be loaded" onRetry={model.onRetry} testId="trade-safetrade-failed">This is not a report that you have none. Nothing on any case has changed.</DeskState>
}

function Filters({ model }: { model: SafeTradeCasesModel }) {
  const f = model.filters
  const id = useId()
  const [open, setOpen] = useState(false)
  const active = [Boolean(f.status), f.rel !== 'all', Boolean(f.order), f.disputedOnly].filter(Boolean).length
  return (
    <div className="space-y-2">
      {/* Phones: the filters fold away behind one control so the cases stay within reach. */}
      <button type="button" className={cn(WS_SECONDARY, 'w-full sm:hidden')} aria-expanded={open} aria-controls={`${id}-filters`} onClick={() => setOpen((o) => !o)} data-testid="trade-safetrade-filters-toggle">
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{open ? 'Hide filters' : 'Filter cases'}{active > 0 ? ` · ${active} active` : ''}
      </button>
    <section id={`${id}-filters`} aria-label="Filter cases" className={cn(open ? 'grid' : 'hidden', 'gap-3 rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:grid sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end')} data-testid="trade-safetrade-filters">
      <div className="min-w-0">
        <label htmlFor={`${id}-status`} className={WS_LABEL}>Status <span className="font-normal text-carup-text-3">· asks the server</span></label>
        <select id={`${id}-status`} className={WS_FIELD} value={f.status} onChange={(e) => f.setStatus(e.target.value)} data-testid="trade-safetrade-filter-status">
          <option value="">Any status</option>
          {SAFETRADE_DB_STATUSES.map((code) => <option key={code} value={code}>{dbStatusOptionLabel(code)}</option>)}
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor={`${id}-rel`} className={WS_LABEL}>Your role</label>
        <select id={`${id}-rel`} className={WS_FIELD} value={f.rel} onChange={(e) => f.setRel(e.target.value as 'all' | 'buyer' | 'seller')} data-testid="trade-safetrade-filter-rel">
          <option value="all">Any role</option>
          <option value="buyer">As buyer</option>
          <option value="seller">As seller</option>
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor={`${id}-order`} className={WS_LABEL}>Linked import order</label>
        <input id={`${id}-order`} className={cn(WS_FIELD, 'font-mono')} value={f.order} onChange={(e) => f.setOrder(e.target.value)} placeholder="Order reference" data-testid="trade-safetrade-filter-order" />
      </div>
      <label htmlFor={`${id}-disputed`} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 text-sm font-semibold text-carup-text">
        <input id={`${id}-disputed`} type="checkbox" className="h-4 w-4 accent-[var(--carup-color-action)]" checked={f.disputedOnly} onChange={(e) => f.setDisputedOnly(e.target.checked)} data-testid="trade-safetrade-filter-disputed" />
        Disputed only
      </label>
    </section>
    </div>
  )
}

function CaseLedger({ cases, viewerId }: { cases: SafeTradeTransaction[]; viewerId: string | null }) {
  return (
    <>
      <div className="relative hidden overflow-x-auto rounded-card border border-carup-line bg-carup-bg-raised md:block">
        <table className="w-full min-w-[760px] text-left text-sm" data-testid="trade-safetrade-table">
          <caption className="sr-only">SafeTrade cases you can see</caption>
          <thead className="bg-carup-bg-surface text-xs font-semibold text-carup-text-2">
            <tr>
              <th scope="col" className="px-4 py-2.5">Case</th>
              <th scope="col" className="px-4 py-2.5">State</th>
              <th scope="col" className="px-4 py-2.5">Linked order</th>
              <th scope="col" className="px-4 py-2.5 text-right">Declared total</th>
              <th scope="col" className="px-4 py-2.5">You</th>
              <th scope="col" className="px-4 py-2.5">Updated</th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-carup-line">
            {cases.map((c) => {
              const state = designStateOf(c)
              return (
                <tr key={c.id} data-testid={`trade-safetrade-row-${c.id}`}>
                  <td className="px-4 py-3"><RefCode value={c.id} label="Case" className="text-carup-text" /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <StatusChip tone={caseTone(c)} testId={`trade-safetrade-row-${c.id}-state`}>{stateLabel(state)}</StatusChip>
                    </div>
                  </td>
                  <td className="px-4 py-3"><RefCode value={c.import_order_id} label="Import order" /></td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-carup-text">{formatMoney(c.total_amount, c.currency)}</td>
                  <td className="px-4 py-3 text-carup-text-2">{RELATIONSHIP_LABEL[relationshipOf(c, viewerId)]}</td>
                  <td className="px-4 py-3 text-carup-text-2">{formatDay(c.updated_at ?? c.created_at ?? null) ?? 'Not recorded'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={caseHref(c.id)} className="inline-flex min-h-11 items-center gap-1 rounded-control px-2 font-semibold text-carup-action underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus" aria-label={`Open case ${c.id.slice(0, 8)}`}>
                      Open<ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden" data-testid="trade-safetrade-cards">
        {cases.map((c) => {
          const state = designStateOf(c)
          return (
            <li key={c.id}>
              <Link to={caseHref(c.id)} className="block rounded-card border border-carup-line bg-carup-bg-raised p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus" data-testid={`trade-safetrade-card-${c.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <StatusChip tone={caseTone(c)}>{stateLabel(state)}</StatusChip>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-carup-text-3" aria-hidden="true" />
                </div>
                <p className="mt-2 text-lg font-bold tabular-nums text-carup-text">{formatMoney(c.total_amount, c.currency)} <span className="text-xs font-normal text-carup-text-3">declared</span></p>
                <p className="mt-1 text-xs text-carup-text-3">Case <RefCode value={c.id} label="Case" /> · order <RefCode value={c.import_order_id} label="Import order" /></p>
                <p className="mt-1 text-xs text-carup-text-2">{RELATIONSHIP_LABEL[relationshipOf(c, viewerId)]} · updated {formatDay(c.updated_at ?? c.created_at ?? null) ?? 'date not recorded'}</p>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="text-xs leading-5 text-carup-text-3">A declared total is what the case records as the trade value. It is not money CarUp holds.</p>
    </>
  )
}
