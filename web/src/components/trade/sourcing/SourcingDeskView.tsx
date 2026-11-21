/**
 * RX-06 Sourcing — the unified Reverse RFQ desk (/diaspora/rfq).
 *
 * Presentation only. Every read and write is the page container's own (DiasporaReverseRfq): the
 * buyer-order list, one order's detail + quotes + matches, publish, accept, and — for sellers — the open
 * requests and the quote submission. This view only arranges them as a sourcing desk:
 *   buyer lane:  compose → your requests (stage) → one request: next move, quote ledger, matches, facts
 *   seller lane: open requests → quote in place
 * Truth rules: only returned values (no invented prices, dates, delivery promises or conversions),
 * a failed read is never shown as "none", and a denied / rate-limited read says so.
 */
import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Loader2, Send, Store } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import { revealOnPhone } from '@/components/dealer/workspace/format'
import {
  WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_ROW, WS_SECONDARY,
} from '@/components/dealer/workspace/workspaceStyles'
import { statusLabel } from '@/components/trade/core/importOrderLifecycle'
import type { DiasporaBuyerOrder, DiasporaMatchCandidate, DiasporaQuote } from '@/types'
import {
  DeskHeader, DeskPanel, DeskState, EditorialEmpty, Fact, InlineConfirm, NextMove, PulseLine, RefCode, RouteGlyph,
  SegmentedTabs, SourceChip, TabPanel,
} from './TradeDesk'
import { failureKind, formatAmount, formatDay, humanizeCode, plural, roleWords, type ReadState } from './deskKit'
import {
  RFQ_STAGE, demandTitle, partNumberOf, quoteRows, quoteSpread, requestNextMove, rfqStage, stageCounts,
  urgencyOf, yearSpan, type QuoteRow, type RfqDetailRead, type SourcingDeskModel,
} from './rfqDesk'
import { SourcingGuestExplainer } from './SourcingGuestExplainer'

type Lane = 'buyer' | 'seller'

export function SourcingDeskView({ model }: { model: SourcingDeskModel }) {
  const { isBuyer, isSeller } = model
  const [lane, setLane] = useState<Lane>(isBuyer ? 'buyer' : 'seller')

  if (model.authLoading) {
    return (
      <div className="min-w-0" data-testid="trade-rfq" data-presentation="trade-desk">
        <DeskState kind="loading" title="Checking your access to sourcing requests…" testId="trade-rfq-auth-loading" />
      </div>
    )
  }

  if (!model.signedIn) {
    // LR02: a guest learns how sourcing requests work (static; nothing is read) instead of a dead end.
    return (
      <div className="min-w-0" data-testid="trade-rfq" data-presentation="trade-desk">
        <SourcingGuestExplainer />
      </div>
    )
  }

  if (!isBuyer && !isSeller) {
    return (
      <div className="min-w-0 space-y-5" data-testid="trade-rfq" data-presentation="trade-desk">
        <DeskHeader eyebrow="Trade · Sourcing" title="Sourcing requests" />
        <DeskState kind="denied" title="Sourcing requests need a buying or a selling role" testId="trade-rfq-denied">
          Your account ({roleWords(model.role)}) can neither publish requests nor quote on them. Nothing was loaded.
          The server checks the role again on every request, so this page cannot be used to get around it.
        </DeskState>
      </div>
    )
  }

  const both = isBuyer && isSeller
  const activeLane: Lane = both ? lane : isBuyer ? 'buyer' : 'seller'
  const counts = stageCounts(model.buyer.orders)

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6" data-testid="trade-rfq" data-presentation="trade-desk">
      <DeskHeader
        eyebrow="Trade · Sourcing"
        title="Sourcing requests"
        description={both
          ? 'Publish parts requests, quote on other traders’ requests, and accept the quote you choose. Every amount and date is exactly what a buyer or seller entered — CarUp adds no freight, duty or fees and converts no currency.'
          : isBuyer
            ? 'Ask sellers for parts, compare their quotes and accept one. Every amount and date is exactly what a buyer or seller entered — CarUp adds no freight, duty or fees and converts no currency.'
            : 'Quote on the parts buyers have asked for. The buyer sees your quote exactly as you enter it — CarUp adds no freight, duty or fees and converts no currency.'}
        meta={(
          <>
            {isBuyer && <SourceChip testId="trade-rfq-can-request">You can publish requests</SourceChip>}
            {isSeller && <SourceChip testId="trade-rfq-can-quote">You can quote on open requests</SourceChip>}
          </>
        )}
        actions={(
          <>
            <Link to="/diaspora/containers" className={WS_SECONDARY}>Shared containers</Link>
            {isSeller && <Link to="/diaspora/stock" className={WS_SECONDARY}><Store className="h-4 w-4" aria-hidden="true" />Stock</Link>}
          </>
        )}
      />

      {both && (
        <SegmentedTabs<Lane>
          idBase="trade-rfq-lane"
          label="Sourcing lanes"
          value={activeLane}
          onChange={setLane}
          testId="trade-rfq-lanes"
          tabs={[
            { key: 'buyer', label: 'Your requests', count: model.buyer.read.phase === 'ready' ? model.buyer.orders.length : null },
            { key: 'seller', label: 'Quote on open requests', count: model.seller.read.phase === 'ready' ? model.seller.rfqs.length : null },
          ]}
        />
      )}

      {model.notice && model.notice.lane === activeLane && (
        <div aria-live="polite">
          <WorkspaceNotice tone={model.notice.tone} testId="trade-rfq-notice">{model.notice.text}</WorkspaceNotice>
        </div>
      )}

      {activeLane === 'buyer' ? (
        both
          ? <TabPanel idBase="trade-rfq-lane" tabKey="buyer"><BuyerLane model={model} counts={counts} /></TabPanel>
          : <BuyerLane model={model} counts={counts} />
      ) : (
        both
          ? <TabPanel idBase="trade-rfq-lane" tabKey="seller"><SellerLane model={model} /></TabPanel>
          : <SellerLane model={model} />
      )}
    </div>
  )
}

/* ── Read states shared by both lanes ──────────────────────────────────────────────────────── */

function ReadFailure({ read, what, onRetry, testId }: { read: ReadState; what: string; onRetry: () => void; testId: string }) {
  const kind = failureKind(read)
  if (kind === 'denied') {
    return (
      <DeskState kind="denied" title={`The server refused to show ${what} to this account`} testId={testId}>
        This is a permission answer (403), not an empty list. Ask a CarUp administrator if you expected access.
      </DeskState>
    )
  }
  if (kind === 'limited') {
    return (
      <DeskState kind="limited" title="Too many requests right now" onRetry={onRetry} retryLabel="Retry now" testId={testId}>
        The shared request limit was reached, so {what} could not be read. Nothing is retried automatically — wait about a minute, then retry.
      </DeskState>
    )
  }
  if (kind === 'missing') {
    return (
      <DeskState kind="unavailable" title="Sourcing requests are not available on this server" testId={testId}>
        The server answered “not found” (404) for {what}. The feature may be switched off here. This is not a report that you have none.
      </DeskState>
    )
  }
  if (kind === 'session') {
    return (
      <DeskState kind="signin" title="Your session ended" action={<Link to="/login" className={WS_PRIMARY}>Sign in again</Link>} testId={testId}>
        Sign in again to see {what}.
      </DeskState>
    )
  }
  return (
    <DeskState kind="failed" title={`${what.charAt(0).toUpperCase()}${what.slice(1)} could not be loaded`} onRetry={onRetry} testId={testId}>
      This is not a report that there are none. Nothing about your requests has changed.
    </DeskState>
  )
}

/* ── Buyer lane ────────────────────────────────────────────────────────────────────────────── */

function BuyerLane({ model, counts }: { model: SourcingDeskModel; counts: ReturnType<typeof stageCounts> }) {
  const { buyer } = model
  const composeRef = useRef<HTMLInputElement | null>(null)
  const ready = buyer.read.phase === 'ready'
  const loading = buyer.read.phase === 'idle' || buyer.read.phase === 'loading'
  const firstDraft = buyer.orders.find((o) => rfqStage(o) === 'draft') ?? null
  const firstOpen = buyer.orders.find((o) => rfqStage(o) === 'open') ?? null

  return (
    <div className="space-y-5">
      {ready && (
        <PulseLine
          label="Your requests at a glance"
          testId="trade-rfq-pulse"
          items={[
            { label: buyer.orders.length === 1 ? 'request' : 'requests', value: buyer.orders.length, key: 'all' },
            { label: 'draft', value: counts.draft, key: 'draft' },
            { label: 'open to sellers', value: counts.open, key: 'open' },
            { label: 'accepted', value: counts.accepted, key: 'accepted' },
          ]}
        />
      )}

      {ready && !buyer.selected && (
        buyer.orders.length === 0 ? (
          <NextMove
            testId="trade-rfq-next"
            title="Compose your first parts request"
            usuallyWith="You"
            after="It is saved as a draft. Sellers see it only after you publish it."
            action={<button type="button" className={WS_PRIMARY} onClick={() => composeRef.current?.focus()}>Compose a request<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
          />
        ) : firstDraft ? (
          <NextMove
            testId="trade-rfq-next"
            title={`Publish “${demandTitle(firstDraft)}” so sellers can quote`}
            detail={`${plural(counts.draft, 'request is', 'requests are')} still drafts. Sellers cannot see a draft.`}
            usuallyWith="You"
            after="Sellers see the request in their open requests and can submit quotes."
            action={<button type="button" className={WS_PRIMARY} onClick={() => buyer.onSelect(firstDraft)}>Open this request<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
          />
        ) : firstOpen ? (
          <NextMove
            testId="trade-rfq-next"
            title="Open a published request to compare its quotes"
            detail={`${plural(counts.open, 'request is', 'requests are')} open to sellers.`}
            usuallyWith="Sellers, then you"
            after="Submitted quotes appear in the request's ledger. Accepting one rejects the others."
            action={<button type="button" className={WS_PRIMARY} onClick={() => buyer.onSelect(firstOpen)}>Open “{demandTitle(firstOpen)}”<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
          />
        ) : (
          <NextMove
            testId="trade-rfq-next"
            title="Every request has an accepted quote"
            usuallyWith="You"
            after="Accepted requests continue as import orders. Compose a new request whenever you need parts."
            action={<button type="button" className={WS_SECONDARY} onClick={() => composeRef.current?.focus()}>Compose a request</button>}
          />
        )
      )}

      <ComposePanel model={model} inputRef={composeRef} />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:items-start">
        <div className="min-w-0">
          <DeskPanel title="Your requests" testId="trade-rfq-requests">
            {loading && <DeskState compact kind="loading" title="Loading your requests…" testId="trade-rfq-requests-loading" />}
            {buyer.read.phase === 'failed' && <ReadFailure read={buyer.read} what="your requests" onRetry={buyer.onRetry} testId="trade-rfq-requests-failed" />}
            {ready && buyer.orders.length === 0 && (
              <EditorialEmpty still="auctionYard" layout="stack">
                <DeskState bare kind="empty" title="No requests yet" testId="trade-rfq-requests-empty">
                  A request is created when you record one above. It stays a draft — visible only to you — until you publish it.
                </DeskState>
              </EditorialEmpty>
            )}
            {ready && buyer.orders.length > 0 && <RequestList model={model} />}
          </DeskPanel>
        </div>
        <div className="min-w-0">
          {buyer.selected ? (
            <RequestDetail key={buyer.selected.id} model={model} order={buyer.selected} />
          ) : (
            ready && buyer.orders.length > 0 && (
              <DeskState compact kind="empty" title="Open a request to see its quotes" testId="trade-rfq-detail-empty">
                Each request keeps its own quote ledger, the parts stock it matches and every recorded fact.
              </DeskState>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function ComposePanel({ model, inputRef }: { model: SourcingDeskModel; inputRef: RefObject<HTMLInputElement | null> }) {
  const c = model.buyer.compose
  const id = useId()
  return (
    <DeskPanel title="Compose a parts request" testId="trade-rfq-compose">
      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); c.onSubmit() }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <div className="min-w-0">
            <label htmlFor={`${id}-origin`} className={WS_LABEL}>Origin country <span className="font-normal text-carup-text-3">· required</span></label>
            <input ref={inputRef} id={`${id}-origin`} className={WS_FIELD} value={c.origin} onChange={(e) => c.setOrigin(e.target.value)} autoComplete="country-name" aria-required="true" placeholder="e.g. Japan" data-testid="trade-rfq-compose-origin" />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-make`} className={WS_LABEL}>Make <span className="font-normal text-carup-text-3">· optional</span></label>
            <input id={`${id}-make`} className={WS_FIELD} value={c.make} onChange={(e) => c.setMake(e.target.value)} data-testid="trade-rfq-compose-make" />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-model`} className={WS_LABEL}>Model <span className="font-normal text-carup-text-3">· optional</span></label>
            <input id={`${id}-model`} className={WS_FIELD} value={c.model} onChange={(e) => c.setModel(e.target.value)} data-testid="trade-rfq-compose-model" />
          </div>
          <button type="submit" className={cn(WS_PRIMARY, 'whitespace-nowrap sm:col-span-3 sm:justify-self-start lg:col-span-1')} disabled={c.creating} data-testid="trade-rfq-compose-submit">
            {c.creating ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {c.creating ? 'Recording…' : 'Record request'}
          </button>
        </div>
        <p className={cn(WS_HINT, 'mt-0 max-w-3xl')}>
          Recorded as a <strong className="font-semibold text-carup-text-2">parts</strong> request with Zimbabwe as the destination, and kept as a draft until you publish it.
          Importing a whole vehicle? <Link to="/diaspora/imports/new" className="font-semibold text-carup-action underline-offset-4 hover:underline">Start an import</Link>.
        </p>
      </form>
    </DeskPanel>
  )
}

function RequestList({ model }: { model: SourcingDeskModel }) {
  const { buyer } = model
  const [publishing, setPublishing] = useState<string | null>(null)
  async function publish(order: DiasporaBuyerOrder) {
    if (publishing) return
    setPublishing(order.id)
    try { await buyer.onPublish(order) } finally { setPublishing(null) }
  }
  return (
    <ul className="-mx-2 divide-y divide-carup-line" data-testid="trade-rfq-request-list">
      {buyer.orders.map((order) => {
        const stage = rfqStage(order)
        const meta = RFQ_STAGE[stage]
        const selected = buyer.selected?.id === order.id
        const years = yearSpan(order.requested_year_min, order.requested_year_max)
        return (
          <li key={order.id} className="py-2" data-testid="trade-rfq-request-row" data-stage={stage}>
            <button
              type="button"
              className={cn(WS_ROW, 'rounded-control px-2 py-2', selected && 'bg-carup-bg-surface')}
              aria-current={selected ? 'true' : undefined}
              onClick={() => buyer.onSelect(order)}
              data-testid="trade-rfq-request-open"
            >
              <span className="flex flex-wrap items-start justify-between gap-2">
                <StatusChip tone={meta.tone} testId="trade-rfq-request-stage">{meta.label}</StatusChip>
                <span className="text-xs text-carup-text-3">
                  {humanizeCode(order.order_type, 'Type not recorded')} · {formatDay(typeof order.created_at === 'string' ? order.created_at : null) ?? 'date not recorded'}
                </span>
              </span>
              <span className="mt-1.5 block font-semibold text-carup-text [overflow-wrap:anywhere]">
                {demandTitle(order)}{years && <span className="font-normal text-carup-text-2"> · {years}</span>}
                {selected && <span className="sr-only"> (open)</span>}
              </span>
              <span className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <RouteGlyph size="sm" from={order.origin_country} to={order.destination_country} />
                <RefCode value={order.id} label="Request" />
              </span>
            </button>
            {stage === 'draft' && (
              <div className="mt-1.5 px-2">
                <button
                  type="button"
                  className={WS_SECONDARY}
                  disabled={publishing !== null}
                  onClick={() => void publish(order)}
                  data-testid="trade-rfq-request-publish"
                >
                  {publishing === order.id && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  Publish to sellers
                </button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ── One request ───────────────────────────────────────────────────────────────────────────── */

type DetailTab = 'quotes' | 'matches' | 'facts'

function RequestDetail({ model, order }: { model: SourcingDeskModel; order: DiasporaBuyerOrder }) {
  const { buyer } = model
  const ref = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const [tab, setTab] = useState<DetailTab>('quotes')
  const [publishing, setPublishing] = useState(false)
  useEffect(() => { revealOnPhone(ref.current) }, [])

  const detail: RfqDetailRead = buyer.detail.orderId === order.id ? buyer.detail : { phase: 'loading', orderId: order.id }
  const detailReady = detail.phase === 'ready' || (detail.phase === 'failed' && detail.stage === 'matches')
  const rows = detailReady ? quoteRows(buyer.quotes, buyer.acceptedQuoteId) : []
  const stage = rfqStage(order)
  const meta = RFQ_STAGE[stage]
  const move = detailReady ? requestNextMove(order, rows) : null
  const years = yearSpan(order.requested_year_min, order.requested_year_max)
  const budget = formatAmount(order.budget_amount ?? null, order.budget_currency ?? null)

  async function publish() {
    if (publishing) return
    setPublishing(true)
    try { await buyer.onPublish(order) } finally { setPublishing(false) }
  }

  return (
    <article ref={ref} tabIndex={-1} aria-labelledby={titleId} className="min-w-0 space-y-4 rounded-card focus-visible:outline-none" data-testid="trade-rfq-detail" data-stage={stage}>
      <header className="rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={meta.tone} testId="trade-rfq-detail-stage">{meta.label}</StatusChip>
          <span className="text-xs text-carup-text-3">Request</span>
          <RefCode value={order.id} label="Request" testId="trade-rfq-detail-ref" />
        </div>
        <h2 id={titleId} className="mt-2 text-xl font-bold leading-tight tracking-[-0.02em] text-carup-text [overflow-wrap:anywhere] sm:text-2xl">
          {demandTitle(order)}{years && <span className="font-semibold text-carup-text-2"> · {years}</span>}
        </h2>
        <div className="mt-2">
          <RouteGlyph
            from={[order.origin_city, order.origin_country].filter(Boolean).join(', ') || null}
            to={[order.destination_city, order.destination_country].filter(Boolean).join(', ') || null}
            testId="trade-rfq-detail-route"
          />
        </div>
        <p className="mt-2 text-sm text-carup-text-2">{meta.meaning}</p>
      </header>

      {detail.phase === 'loading' || detail.phase === 'idle' ? (
        <DeskState kind="loading" title="Loading this request's quotes…" testId="trade-rfq-detail-loading" />
      ) : detail.phase === 'failed' && detail.stage !== 'matches' ? (
        <ReadFailure read={detail} what="this request" onRetry={() => buyer.onSelect(order)} testId="trade-rfq-detail-failed" />
      ) : move && (
        <NextMove
          testId="trade-rfq-detail-next"
          title={move.title}
          usuallyWith={move.usuallyWith}
          after={move.after}
          action={
            move.kind === 'publish' ? (
              <button type="button" className={WS_PRIMARY} onClick={() => void publish()} disabled={publishing} data-testid="trade-rfq-detail-publish">
                {publishing && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                Publish to sellers
              </button>
            ) : move.kind === 'accepted' ? (
              <Link to={`/diaspora/imports/${encodeURIComponent(order.id)}`} className={WS_PRIMARY} data-testid="trade-rfq-detail-import-link">
                Open the import order<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : move.kind === 'compare' ? (
              <button type="button" className={WS_SECONDARY} onClick={() => setTab('quotes')}>Go to the quote ledger</button>
            ) : undefined
          }
        />
      )}

      {detailReady && (
        <div className="space-y-3">
          <SegmentedTabs<DetailTab>
            idBase={`trade-rfq-detail-${order.id}`}
            label="Request sections"
            value={tab}
            onChange={setTab}
            testId="trade-rfq-detail-tabs"
            tabs={[
              { key: 'quotes', label: 'Quotes', count: rows.length },
              { key: 'matches', label: 'Matching stock', count: stage === 'draft' || detail.phase === 'failed' ? null : buyer.matches.length },
              { key: 'facts', label: 'Request facts' },
            ]}
          />
          <TabPanel idBase={`trade-rfq-detail-${order.id}`} tabKey={tab}>
            {tab === 'quotes' && <QuoteLedger rows={rows} quotes={buyer.quotes} stage={stage} onAccept={buyer.onAccept} />}
            {tab === 'matches' && (
              detail.phase === 'failed' ? (
                <ReadFailure read={detail} what="the matching stock" onRetry={() => buyer.onSelect(order)} testId="trade-rfq-matches-failed" />
              ) : (
                <MatchLedger matches={buyer.matches} published={stage !== 'draft'} />
              )
            )}
            {tab === 'facts' && (
              <DeskPanel testId="trade-rfq-facts">
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Fact label="Order type" value={humanizeCode(order.order_type)} />
                  <Fact label="Make and model" value={[order.requested_make, order.requested_model].filter(Boolean).join(' ') || null} />
                  <Fact label="Model years" value={years} />
                  <Fact label="Part number" value={partNumberOf(order)} mono />
                  <Fact label="Urgency" value={urgencyOf(order)} />
                  <Fact label="Your stated budget" value={budget} source={<SourceChip>Entered by you · not a quote</SourceChip>} />
                  <Fact label="Origin" value={[order.origin_city, order.origin_country].filter(Boolean).join(', ') || null} />
                  <Fact label="Destination" value={[order.destination_city, order.destination_country].filter(Boolean).join(', ') || null} />
                  <Fact label="Published to sellers" value={formatDay(order.metadata?.rfq?.publishedAt ?? null)} />
                  <Fact label="Quote accepted" value={formatDay(order.metadata?.rfq?.acceptedAt ?? null)} />
                  <Fact label="Order status" value={statusLabel(order.status)} testId="trade-rfq-facts-status" />
                  <Fact label="Recorded" value={formatDay(typeof order.created_at === 'string' ? order.created_at : null)} />
                </dl>
              </DeskPanel>
            )}
          </TabPanel>
        </div>
      )}
    </article>
  )
}

function QuoteLedger({ rows, quotes, stage, onAccept }: {
  rows: QuoteRow[]
  quotes: DiasporaQuote[]
  stage: ReturnType<typeof rfqStage>
  onAccept: (quote: DiasporaQuote) => void | Promise<void>
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)
  const { spreads, unpriced } = quoteSpread(rows)

  async function accept(id: string) {
    const quote = quotes.find((q) => q.id === id)
    if (!quote || accepting) return
    setAccepting(id)
    try { await onAccept(quote) } finally { setAccepting(null); setConfirmId(null) }
  }

  if (rows.length === 0) {
    return (
      <DeskState compact kind="empty" title="No quotes yet" testId="trade-rfq-quotes-empty">
        {stage === 'draft'
          ? 'Sellers cannot quote on a draft. Publish the request first.'
          : 'A quote appears here as soon as a seller submits one. CarUp does not create or estimate quotes.'}
      </DeskState>
    )
  }

  return (
    <div className="space-y-3" data-testid="trade-rfq-quotes">
      <div className="flex flex-wrap items-center gap-2 text-sm text-carup-text-2" data-testid="trade-rfq-quote-spread">
        {spreads.map((s) => (
          <span key={s.currency} className="rounded-control border border-carup-line bg-carup-bg-surface px-2 py-1">
            <span className="font-semibold tabular-nums text-carup-text">{s.low === s.high ? s.low : `${s.low} – ${s.high}`}</span>
            <span className="ml-1 text-carup-text-3">across {plural(s.count, 'quote')}</span>
          </span>
        ))}
        {unpriced > 0 && <span className="text-carup-text-3">{plural(unpriced, 'quote')} without a recorded amount</span>}
      </div>
      <p className="text-xs leading-5 text-carup-text-3">
        Amounts are compared only within one currency. A seller’s quote covers what that seller stated — freight, insurance and duty are never added or estimated here.
      </p>

      {/* One responsive ledger: each quote's figures on one line, its terms beneath, the decision at the end. */}
      <ul className="space-y-3" data-testid="trade-rfq-quote-ledger">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn('grid gap-3 rounded-card border p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center', r.accepted ? 'border-status-success bg-status-success-soft' : 'border-carup-line bg-carup-bg-raised')}
            data-testid="trade-rfq-quote-row"
            data-status={r.rawStatus}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="text-xl font-bold tabular-nums text-carup-text">{r.amount ?? <span className="text-sm font-normal text-carup-text-3">Amount not recorded</span>}</p>
                <StatusChip tone={r.status.tone} className="shrink-0 whitespace-nowrap">{r.status.label}</StatusChip>
              </div>
              <p className="mt-0.5 text-xs text-carup-text-3"><RefCode value={r.id} label="Quote" /> · {r.received ? `received ${r.received}` : 'received date not recorded'}</p>
              <dl className="mt-3 grid max-w-lg grid-cols-3 gap-3 text-xs">
                <div className="min-w-0"><dt className="text-carup-text-3">Valid until</dt><dd className="mt-0.5 font-semibold text-carup-text">{r.validUntil ?? <span className="font-normal text-carup-text-3">Not stated</span>}</dd></div>
                <div className="min-w-0"><dt className="text-carup-text-3">Lead time</dt><dd className="mt-0.5 font-semibold text-carup-text">{r.leadTimeDays !== null ? plural(r.leadTimeDays, 'day') : <span className="font-normal text-carup-text-3">Not stated</span>}</dd></div>
                <div className="min-w-0"><dt className="text-carup-text-3">Terms</dt><dd className="mt-0.5 font-semibold text-carup-text [overflow-wrap:anywhere]">{r.shippingTerms ?? <span className="font-normal text-carup-text-3">Not stated</span>}</dd></div>
              </dl>
              <QuoteScope row={r} />
            </div>
            <div className="md:justify-self-end">
              <QuoteDecision row={r} confirmId={confirmId} accepting={accepting} onAsk={setConfirmId} />
            </div>
          </li>
        ))}
      </ul>

      {confirmId && (
        <InlineConfirm
          testId="trade-rfq-accept-confirm"
          title="Accept this quote?"
          confirm={(
            <button type="button" className={WS_PRIMARY} disabled={accepting !== null} onClick={() => void accept(confirmId)} data-testid="trade-rfq-accept-confirm-yes">
              {accepting && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              Accept quote <span className="font-mono text-xs">{confirmId.slice(0, 8)}</span>
            </button>
          )}
          cancel={<button type="button" className={WS_SECONDARY} onClick={() => setConfirmId(null)} disabled={accepting !== null}>Keep comparing</button>}
        >
          The server accepts exactly this quote and rejects the other submitted quotes in the same step. This cannot be undone from this page. No payment is taken.
        </InlineConfirm>
      )}
    </div>
  )
}

function QuoteScope({ row }: { row: QuoteRow }) {
  if (row.inclusions.length === 0 && row.exclusions.length === 0) return null
  return (
    <div className="mt-2 space-y-1 text-xs text-carup-text-2">
      {row.inclusions.length > 0 && <p><span className="font-semibold text-carup-text">Includes:</span> {row.inclusions.join(', ')}</p>}
      {row.exclusions.length > 0 && <p><span className="font-semibold text-carup-text">Excludes:</span> {row.exclusions.join(', ')}</p>}
    </div>
  )
}

function QuoteDecision({ row, confirmId, accepting, onAsk }: { row: QuoteRow; confirmId: string | null; accepting: string | null; onAsk: (id: string) => void }) {
  if (row.accepted) {
    return <span className="inline-flex items-center gap-1 text-sm font-semibold text-status-success" data-testid="trade-rfq-quote-accepted"><Check className="h-4 w-4" aria-hidden="true" />Accepted by you</span>
  }
  if (!row.acceptable) return null
  return (
    <button
      type="button"
      className={cn(WS_SECONDARY, 'w-full md:w-auto')}
      disabled={accepting !== null || confirmId === row.id}
      onClick={() => onAsk(row.id)}
      data-testid="trade-rfq-quote-accept"
    >
      Accept…
    </button>
  )
}

function MatchLedger({ matches, published }: { matches: DiasporaMatchCandidate[]; published: boolean }) {
  if (!published) {
    return (
      <DeskState compact kind="empty" title="Matching starts when the request is published" testId="trade-rfq-matches-unpublished">
        Once published, CarUp lists published parts stock that matches the request, each with the reasons it matched.
      </DeskState>
    )
  }
  if (matches.length === 0) {
    return (
      <DeskState compact kind="empty" title="No published stock matches this request yet" testId="trade-rfq-matches-empty">
        Matches come from sellers’ published stock with available quantity. New stock is matched the next time you open the request.
      </DeskState>
    )
  }
  return (
    <div className="space-y-2" data-testid="trade-rfq-matches">
      <p className="text-xs leading-5 text-carup-text-3">
        A deterministic score from recorded fields (make, model, years, part number, availability, export readiness) — not a recommendation, and not a quote.
      </p>
      <ul className="space-y-2">
        {matches.map((m) => {
          const listed = formatAmount(m.unitPrice ?? null, m.currency ?? null)
          return (
            <li key={m.stockItemId} className="rounded-card border border-carup-line bg-carup-bg-raised p-4" data-testid="trade-rfq-match-row">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-carup-text [overflow-wrap:anywhere]">{m.partName}</p>
                  <p className="mt-0.5 text-xs text-carup-text-3">
                    {m.sku ? <span className="font-mono">{m.sku}</span> : 'SKU not recorded'}
                    {(m.vehicleMake || m.vehicleModel) && <> · fits {[m.vehicleMake, m.vehicleModel].filter(Boolean).join(' ')}</>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-carup-text">Score {m.score}</p>
                  <p className="text-xs text-carup-text-3">{plural(Number(m.available) || 0, 'unit')} available</p>
                </div>
              </div>
              {listed && <p className="mt-2 text-sm text-carup-text-2">Listed at <span className="font-semibold tabular-nums text-carup-text">{listed}</span> <SourceChip className="ml-1">Seller’s stock listing</SourceChip></p>}
              {m.reasons.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Why it matched">
                  {m.reasons.map((reason) => <li key={reason} className="rounded-full bg-carup-bg-surface px-2 py-0.5 text-xs text-carup-text-2">{reason}</li>)}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ── Seller lane ───────────────────────────────────────────────────────────────────────────── */

function SellerLane({ model }: { model: SourcingDeskModel }) {
  const { seller } = model
  const loading = seller.read.phase === 'idle' || seller.read.phase === 'loading'
  const ready = seller.read.phase === 'ready'
  const id = useId()
  return (
    <div className="space-y-5">
      {ready && (
        <PulseLine label="Open requests at a glance" testId="trade-rfq-seller-pulse" items={[{ label: seller.rfqs.length === 1 ? 'open request you can quote on' : 'open requests you can quote on', value: seller.rfqs.length }]} />
      )}
      <DeskPanel title="Open requests" testId="trade-rfq-open-requests">
        <p className="mb-3 text-sm leading-6 text-carup-text-2">
          Requests buyers have published and not yet settled. A quote is submitted in US dollars — the server’s default currency for this form — and goes to the buyer as submitted.
        </p>
        {loading && <DeskState compact kind="loading" title="Loading open requests…" testId="trade-rfq-open-loading" />}
        {seller.read.phase === 'failed' && <ReadFailure read={seller.read} what="the open requests" onRetry={seller.onRetry} testId="trade-rfq-open-failed" />}
        {ready && seller.rfqs.length === 0 && (
          <EditorialEmpty still="auctionYard">
            <DeskState bare kind="empty" title="No open requests right now" testId="trade-rfq-open-empty">
              A request appears here when a buyer publishes one. Requests with an accepted quote leave this list.
            </DeskState>
          </EditorialEmpty>
        )}
        {ready && seller.rfqs.length > 0 && (
          <ul className="space-y-3" data-testid="trade-rfq-open-list">
            {seller.rfqs.map((order) => {
              const years = yearSpan(order.requested_year_min, order.requested_year_max)
              const part = partNumberOf(order)
              const urgency = urgencyOf(order)
              const fieldId = `${id}-${order.id}`
              const busy = seller.quotingId === order.id
              return (
                <li key={order.id} className="rounded-card border border-carup-line bg-carup-bg-raised p-4" data-testid="trade-rfq-open-row">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-carup-text [overflow-wrap:anywhere]">{demandTitle(order)}{years && <span className="font-normal text-carup-text-2"> · {years}</span>}</p>
                      <div className="mt-1"><RouteGlyph size="sm" from={order.origin_country} to={order.destination_country} /></div>
                    </div>
                    <RefCode value={order.id} label="Request" />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                    <div><dt className="text-carup-text-3">Part number</dt><dd className="mt-0.5 font-mono font-medium text-carup-text">{part ?? <span className="font-sans text-carup-text-3">Not stated</span>}</dd></div>
                    <div><dt className="text-carup-text-3">Urgency</dt><dd className="mt-0.5 font-semibold text-carup-text">{urgency ?? <span className="font-normal text-carup-text-3">Not stated</span>}</dd></div>
                    <div><dt className="text-carup-text-3">Published</dt><dd className="mt-0.5 font-semibold text-carup-text">{formatDay(order.metadata?.rfq?.publishedAt ?? null) ?? <span className="font-normal text-carup-text-3">Not recorded</span>}</dd></div>
                  </dl>
                  <form
                    noValidate
                    className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
                    onSubmit={(e) => { e.preventDefault(); seller.onQuote(order) }}
                  >
                    <div className="min-w-0 sm:w-48">
                      <label htmlFor={fieldId} className={WS_LABEL}>Your quote (USD)</label>
                      <input
                        id={fieldId}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        className={WS_FIELD}
                        value={seller.amounts[order.id] || ''}
                        onChange={(e) => seller.setAmount(order.id, e.target.value)}
                        data-testid="trade-rfq-open-amount"
                      />
                    </div>
                    <button type="submit" className={WS_PRIMARY} disabled={busy} data-testid="trade-rfq-open-submit">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                      {busy ? 'Submitting…' : 'Submit quote'}
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>
        )}
      </DeskPanel>
      <p className="text-xs leading-5 text-carup-text-3">
        Your submitted quotes are not listed on this page; the buyer sees each one in their request’s quote ledger.
      </p>
    </div>
  )
}
