/**
 * RX-06 Trade — the seller's stock desk (unified presentation of /diaspora/stock).
 *
 *   ink desk header + one pulse line
 *   stock lines (a ledger of units with identity)  →  the selected line's file:
 *     identity · balances · next move · record a movement · publication · merchandising · ledger
 *   supply documents
 *
 * Fed entirely by DiasporaStockManager's own state and handlers. Quantities change only through
 * ledger movements; the publish check is a read-out of the server's gate, never a second authority.
 */
import { SignInLink } from '@/components/trade/core/SignInLink'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Boxes, Check, Circle, FileText, History, PackagePlus, Plus } from 'lucide-react'
import type { DiasporaStockItem, DiasporaSupplyDocument } from '@/types'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { TradeStill } from '@/components/media/rx06/TradeStill'
import {
  DeskHeader, DeskNotice, DeskPanel, DeskPulse, DeskState, NextMove, PhoneDock, Provenance, ReadFailureState, RefList,
} from './DeskPrimitives'
import {
  DESK_EYEBROW, DESK_FIELD, DESK_HINT, DESK_INK_PRIMARY, DESK_INK_SECONDARY, DESK_LABEL, DESK_PANEL, DESK_PRIMARY,
  DESK_ROW, DESK_SECONDARY, DESK_TEXT_ACTION,
} from './deskStyles'
import { humanize, money, shortRef, signed, when } from './deskFormat'
import {
  LEDGER_MOVES, STOCK_CONDITIONS, balancesOf, exportTone, isPublished, ledgerLine, moveOf, newestFirst, previewMove,
  publicationTone, publishChecks, revealBelowSplit, supplyDocTone, verificationTone, type Balances, type StockDeskModel,
} from './stockDesk'

const PAGE = 'mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8'

export function StockDeskView({ model }: { model: StockDeskModel }) {
  const [composerOpen, setComposerOpen] = useState(false)
  const fileRef = useRef<HTMLDivElement | null>(null)
  const selectedId = model.selected?.id ?? null

  // Below the list|file split the list and the selected line are separate screens: bring the file into view.
  useEffect(() => { if (selectedId) revealBelowSplit(fileRef.current) }, [selectedId])

  if (model.authLoading) {
    return <div className={PAGE}><DeskState kind="loading" title="Opening your stock desk…" testId="trade-stock-loading" /></div>
  }
  if (!model.isAuthenticated) {
    return (
      <div className={PAGE}>
        <DeskState kind="signin" title="Sign in to open your stock desk" testId="trade-stock-signin"
          action={<SignInLink className={DESK_PRIMARY}>Sign in</SignInLink>}>
          Stock lines, their ledgers and supply documents belong to a seller account.
        </DeskState>
      </div>
    )
  }
  if (!model.canView) {
    return (
      <div className={PAGE}>
        <DeskState kind="denied" title="Stock management is for seller and reviewer roles" testId="trade-stock-denied">
          This account is signed in as <strong className="text-carup-text">{humanize(model.role, 'an unrecognised role')}</strong>. Stock lines can be managed by dealers and by CarUp reviewers or administrators.
        </DeskState>
      </div>
    )
  }

  const { items, docs } = model
  const published = items.filter((i) => isPublished(i)).length
  const listUnread = Boolean(model.listFailure) && items.length === 0
  // RX06-LR04: nothing is counted before its read has answered — a pending read is never "0".
  const listPending = model.listLoading && items.length === 0 && !model.listFailure
  const docsPending = model.docsLoading && docs.length === 0 && !model.docsFailure
  // First run: the read SUCCEEDED and returned no stock lines. Only then does the editorial still
  // appear — it is never placed behind (or beside) stock units, ledgers or any recorded figure.
  const firstRun = items.length === 0 && !model.listLoading && !model.listFailure

  return (
    <div className={PAGE} data-testid="trade-stock-desk">
      <DeskHeader
        testId="trade-stock-header"
        eyebrow="Trade · Seller desk"
        title="Stock ledger"
        description="Every unit you hold, with a sealed ledger behind it. Quantities only change through recorded movements — never by editing a number."
        actions={(
          <>
            <button type="button" className={DESK_INK_PRIMARY} onClick={() => setComposerOpen(true)} data-testid="trade-stock-new">
              <Plus className="h-4 w-4" aria-hidden="true" /> <span className="sm:hidden">New line</span><span className="hidden sm:inline">New stock line</span>
            </button>
            <Link to="/diaspora/imports" className={DESK_INK_SECONDARY}>Import orders</Link>
          </>
        )}
        pulse={(
          <DeskPulse testId="trade-stock-pulse" scope={listUnread ? 'Stock not loaded' : listPending ? 'Reading your stock…' : 'In this read'}
            items={listUnread || listPending ? [] : [
              { label: items.length === 1 ? 'stock line' : 'stock lines', value: items.length, testId: 'trade-stock-pulse-lines' },
              { label: 'published', value: published, testId: 'trade-stock-pulse-published' },
              { label: model.docsFailure ? 'supply documents (not loaded)' : docsPending ? 'supply documents (reading…)' : docs.length === 1 ? 'supply document' : 'supply documents', value: model.docsFailure || docsPending ? '—' : docs.length },
            ]} />
        )}
      />

      {firstRun ? (
        <div className="mt-6 space-y-4">
          <FirstRunPanel onCompose={() => setComposerOpen(true)} />
          {composerOpen && <NewStockComposer model={model} onClose={() => setComposerOpen(false)} />}
        </div>
      ) : (
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className={`min-w-0 space-y-4 ${selectedId ? 'hidden xl:block' : ''}`}>
          {composerOpen && <NewStockComposer model={model} onClose={() => setComposerOpen(false)} />}
          <StockLinesPanel model={model} onCompose={() => setComposerOpen(true)} />
        </div>
        <div ref={fileRef} tabIndex={-1} className={`min-w-0 focus:outline-none ${selectedId ? '' : 'hidden xl:block'}`}>
          {model.selected
            ? <StockLineFile key={model.selected.id} model={model} item={model.selected} />
            : (
              <div className={`${DESK_PANEL} border-dashed p-6`} data-testid="trade-stock-no-line">
                <Boxes className="h-5 w-5 text-carup-text-3" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-carup-text">Choose a stock line</p>
                <p className="mt-1 max-w-prose text-sm leading-6 text-carup-text-2">
                  Its balances, the next move, the movement recorder, publication and its full ledger open here.
                </p>
              </div>
            )}
        </div>
      </div>
      )}

      <div className={selectedId ? 'hidden xl:block' : ''}>
        <SupplyDocsPanel model={model} />
      </div>

      {model.selected && <StockPhoneDock model={model} item={model.selected} />}
    </div>
  )
}

/* ───────────────────────── first run ───────────────────────── */

function FirstRunPanel({ onCompose }: { onCompose: () => void }) {
  return (
    <section aria-labelledby="trade-stock-empty-title" className={`${DESK_PANEL} overflow-hidden`} data-testid="trade-stock-empty">
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <TradeStill still="dealerForecourt" className="aspect-[16/9] w-full lg:aspect-auto lg:h-full lg:min-h-[19rem]"
          sizes="(min-width: 1024px) 55vw, 100vw" />
        <div className="flex flex-col justify-center p-5 sm:p-7">
          <p className={DESK_EYEBROW}>Empty ledger</p>
          <h2 id="trade-stock-empty-title" className="mt-2 text-xl font-bold tracking-[-0.015em] text-carup-text sm:text-2xl">No stock lines yet</h2>
          <p className="mt-2 max-w-prose text-sm leading-6 text-carup-text-2">
            A stock line is one part you sell, with a sealed ledger of every quantity change. Name the part and its opening quantity — the opening quantity becomes the line&apos;s first ledger movement, and the line stays private until you publish it.
          </p>
          <ol className="mt-4 space-y-1.5 text-sm text-carup-text">
            {['Create the line', 'Complete price, condition and fit', 'Publish to buyer matching'].map((step, i) => (
              <li key={step} className="flex items-center gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-carup-raw-ink font-mono text-[11px] font-semibold text-white" aria-hidden="true">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <div className="mt-5">
            <button type="button" className={DESK_PRIMARY} onClick={onCompose} data-testid="trade-stock-empty-create">
              <PackagePlus className="h-4 w-4" aria-hidden="true" /> Create the first stock line
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────── stock lines ───────────────────────── */

function StockLinesPanel({ model, onCompose }: { model: StockDeskModel; onCompose: () => void }) {
  const { items } = model
  let body: ReactNode
  if (items.length === 0 && model.listLoading) {
    body = <DeskState kind="loading" compact title="Loading your stock lines…" testId="trade-stock-list-loading" />
  } else if (items.length === 0 && model.listFailure) {
    body = <ReadFailureState failure={model.listFailure} what="Your stock lines" onRetry={model.onRetryList} compact testId="trade-stock-list-failed" />
  } else if (items.length === 0) {
    body = (
      <DeskState kind="empty" compact title="No stock lines yet" testId="trade-stock-list-empty"
        action={<button type="button" className={DESK_PRIMARY} onClick={onCompose}><PackagePlus className="h-4 w-4" aria-hidden="true" /> Create the first stock line</button>}>
        A stock line is one part you sell, with a ledger of every quantity change.
      </DeskState>
    )
  } else {
    body = (
      <>
        {model.listFailure && (
          <DeskNotice tone="warning" testId="trade-stock-list-stale">
            The list could not be refreshed, so this is the last list CarUp returned.{model.listFailure.message ? ` The server said: “${model.listFailure.message}”` : ''}
          </DeskNotice>
        )}
        <ul aria-label="Stock lines" className="divide-y divide-carup-line" data-testid="trade-stock-list">
          {items.map((item) => <StockLineRow key={item.id} item={item} selected={model.selected?.id === item.id} onSelect={() => model.onSelect(item)} />)}
        </ul>
      </>
    )
  }
  return (
    <section aria-label="Stock lines" className={`${DESK_PANEL} overflow-hidden`} data-testid="trade-stock-lines">
      <div className="flex items-center justify-between gap-2 border-b border-carup-line py-1 pl-4 pr-2">
        <h2 className="text-sm font-semibold text-carup-text">Stock lines{items.length > 0 && <span className="ml-1.5 font-normal text-carup-text-3">· {items.length}</span>}</h2>
        <button type="button" onClick={model.onRetryList} disabled={model.listLoading} className={DESK_TEXT_ACTION} data-testid="trade-stock-refresh">
          {model.listLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className={items.length === 0 ? 'p-3' : ''}>{body}</div>
    </section>
  )
}

function StockLineRow({ item, selected, onSelect }: { item: DiasporaStockItem; selected: boolean; onSelect: () => void }) {
  const b = balancesOf(item)
  const ref = item.sku || item.part_number || item.oem_number || null
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined} data-testid={`trade-stock-row-${item.id}`}
        className={`${DESK_ROW} px-4 py-3 ${selected ? 'bg-carup-action-soft shadow-[inset_3px_0_0_var(--carup-color-action)]' : ''}`}>
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block break-words text-sm font-semibold text-carup-text">{item.part_name}</span>
            <span className="mt-0.5 block font-mono text-[12px] text-carup-text-3">{ref ?? 'No SKU or part number recorded'}</span>
          </span>
          <StatusChip tone={publicationTone(item.publication_status)} className="shrink-0">{humanize(item.publication_status, 'Private')}</StatusChip>
        </span>
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[12px] tabular-nums text-carup-text-2">
          <span><span className="font-semibold text-carup-text">{b.onHand}</span> on hand</span>
          <span><span className="font-semibold text-carup-text">{b.reserved}</span> reserved</span>
          <span><span className="font-semibold text-carup-text">{b.available}</span> available</span>
        </span>
      </button>
    </li>
  )
}

function NewStockComposer({ model, onClose }: { model: StockDeskModel; onClose: () => void }) {
  const c = model.create
  const ids = useId()
  const docs = model.docs
  const docsUnread = Boolean(model.docsFailure) && docs.length === 0
  const docsPending = model.docsLoading && docs.length === 0 && !model.docsFailure
  return (
    <section aria-label="New stock line" className={`${DESK_PANEL} p-4 sm:p-5`} data-testid="trade-stock-composer">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={DESK_EYEBROW}>New stock line</p>
          <h2 className="mt-1 text-base font-semibold text-carup-text">Name the part and its opening quantity</h2>
        </div>
        <button type="button" className={DESK_TEXT_ACTION} onClick={onClose}>Close</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <div>
          <label htmlFor={`${ids}-name`} className={DESK_LABEL}>Part name</label>
          <input id={`${ids}-name`} className={DESK_FIELD} value={c.name} onChange={(e) => c.setName(e.target.value)} data-testid="trade-stock-create-name" />
        </div>
        <div>
          <label htmlFor={`${ids}-qty`} className={DESK_LABEL}>Opening quantity</label>
          <input id={`${ids}-qty`} type="number" min="0" inputMode="numeric" className={DESK_FIELD} value={c.qty} onChange={(e) => c.setQty(e.target.value)} data-testid="trade-stock-create-qty" />
        </div>
        <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <label htmlFor={`${ids}-doc`} className={DESK_LABEL}>Supply document <span className="font-normal text-carup-text-3">(optional)</span></label>
          <select id={`${ids}-doc`} className={DESK_FIELD} value={c.supplyDocId} onChange={(e) => c.setSupplyDocId(e.target.value)} data-testid="trade-stock-create-doc"
            disabled={docs.length === 0}>
            <option value="">{docsUnread ? 'Supply documents could not be read' : docsPending ? 'Reading your supply documents…' : docs.length === 0 ? 'No supply documents to link yet' : 'Not linked'}</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.document_number} — {d.title} ({humanize(d.status)})</option>)}
          </select>
          <p className={DESK_HINT}>A link can only be set when the line is created. A linked document must itself be published or verified before this line can be published.</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-carup-text-2">The opening quantity is recorded as the line&apos;s first ledger movement (Add · opening balance). The line starts private.</p>
      {c.error && (
        <div className="mt-3">
          <DeskNotice tone="danger" testId="trade-stock-create-error">
            {c.error}{' '}
            <button type="button" onClick={model.onRetryList} className="font-semibold text-carup-action underline underline-offset-4">Refresh the list</button> to see exactly what the server recorded.
          </DeskNotice>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={DESK_PRIMARY} onClick={c.onSubmit} disabled={c.busy} data-testid="trade-stock-create-submit">
          <PackagePlus className="h-4 w-4" aria-hidden="true" /> {c.busy ? 'Creating…' : 'Create stock line'}
        </button>
      </div>
    </section>
  )
}

/* ───────────────────────── the selected line ───────────────────────── */

function StockLineFile({ model, item }: { model: StockDeskModel; item: DiasporaStockItem }) {
  const b = balancesOf(item)
  const live = isPublished(item)
  const checks = publishChecks(item, model.docsFailure ? null : model.docs)
  const missing = checks.filter((c) => !c.met)
  const move = nextMoveOf(item, b, missing.map((c) => c.id))
  return (
    <article className="min-w-0 space-y-4" data-testid="trade-stock-file" data-stock-id={item.id}>
      <button type="button" onClick={model.onClearSelection} className={`${DESK_TEXT_ACTION} xl:hidden`} data-testid="trade-stock-back">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All stock lines
      </button>

      <header className={`${DESK_PANEL} p-4 sm:p-5`} data-testid="trade-stock-file-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={DESK_EYEBROW}>Stock line <span className="ml-1 font-mono normal-case tracking-normal">{shortRef(item.id)}</span></p>
            <h2 className="mt-1 break-words text-xl font-bold tracking-[-0.015em] text-carup-text sm:text-2xl">{item.part_name}</h2>
          </div>
          <Link to={`/diaspora/stock/${encodeURIComponent(item.id)}/passport`} className={DESK_SECONDARY} data-testid="trade-stock-open-passport">
            Open passport <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusChip tone={publicationTone(item.publication_status)} testId="trade-stock-publication">{humanize(item.publication_status, 'Private')}</StatusChip>
          <StatusChip tone={verificationTone(item.verification_status)}>Verification: {humanize(item.verification_status, 'not recorded')}</StatusChip>
          <StatusChip tone={exportTone(item.export_readiness_status)}>Export: {humanize(item.export_readiness_status, 'not recorded')}</StatusChip>
        </div>
        <div className="mt-4 border-t border-carup-line pt-3">
          <RefList testId="trade-stock-refs" items={[
            { label: 'SKU', value: item.sku },
            { label: 'Part no.', value: item.part_number },
            { label: 'OEM', value: item.oem_number },
            { label: 'Aftermarket', value: item.aftermarket_number },
          ]} />
        </div>
        <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-4 gap-y-2 text-sm" data-testid="trade-stock-facts">
          {([
            ['Unit price', money(item.unit_price, item.currency) ?? 'Not set'],
            ['Condition', humanize(item.condition, 'Not set')],
            ['Fits', [item.vehicle_make, item.vehicle_model].filter(Boolean).join(' ') || 'Not set'],
            ['Origin', [item.origin_city, item.origin_country].filter(Boolean).join(', ') || 'Not recorded'],
            ['Warehouse', item.warehouse_location || 'Not recorded'],
            ['Last changed', when(item.updated_at) ?? 'Not recorded'],
          ] as const).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-medium text-carup-text-3">{label}</dt>
              <dd className="mt-0.5 font-medium text-carup-text [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2"><Provenance kind="seller" label="Declared by the seller · condition and currency fall back to CarUp defaults · not verified" /></p>
      </header>

      <BalanceStrip balances={b} />

      <NextMove testId="trade-stock-next-move" title={move.title} usuallyWith="You — the seller" after={move.after}
        action={move.kind === 'publish'
          ? <button type="button" className={DESK_PRIMARY} onClick={model.publication.onToggle} disabled={model.publication.busy} data-testid="trade-stock-next-publish">{model.publication.busy ? 'Publishing…' : 'Publish this line'}</button>
          : <a href={move.kind === 'merch' ? '#trade-stock-merch' : '#trade-stock-move'} className={DESK_SECONDARY} data-testid="trade-stock-next-jump">{move.cta}</a>}>
        {move.body}
      </NextMove>

      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,21rem),1fr))] items-start gap-4">
        <MovementRecorder model={model} balances={b} />
        <div className="min-w-0 space-y-4">
          <PublicationPanel model={model} item={item} checks={checks} />
          {!live && <MerchandisingPanel model={model} />}
          {live && (
            <p className="rounded-card border border-dashed border-carup-line-strong p-4 text-sm leading-6 text-carup-text-2" data-testid="trade-stock-merch-locked">
              Merchandising details are locked while the line is published. Unpublish it to change price, condition or identity.
            </p>
          )}
        </div>
      </div>

      <LedgerHistory model={model} />
    </article>
  )
}

type Move = { kind: 'publish' | 'merch' | 'ledger'; title: string; body: string; after: string; cta: string }

function nextMoveOf(item: DiasporaStockItem, b: Balances, missing: string[]): Move {
  if (isPublished(item)) {
    return {
      kind: 'ledger', title: 'Keep the ledger true',
      body: 'This line is published. Record every receipt, reservation, release or write-off as a movement so buyers are matched against real availability.',
      after: 'Each movement is sealed into the ledger and the balances update.', cta: 'Record a movement',
    }
  }
  const detailGaps = missing.filter((m) => m !== 'available' && m !== 'supply-doc')
  if (detailGaps.length > 0) {
    return {
      kind: 'merch', title: 'Complete the details the publish check needs',
      body: `${detailGaps.length} ${detailGaps.length === 1 ? 'detail is' : 'details are'} still missing before this line can be published.`,
      after: 'Once saved, the line can be published to matching.', cta: 'Complete details',
    }
  }
  if (b.available <= 0) {
    return {
      kind: 'ledger', title: 'Add stock before publishing',
      body: 'Publishing needs at least one available unit, and quantities only change through the ledger.',
      after: 'Record an Add movement; the available balance updates from the ledger.', cta: 'Record a movement',
    }
  }
  if (missing.includes('supply-doc')) {
    return {
      kind: 'ledger', title: 'Publish the linked supply document first',
      body: 'This line is linked to a supply document that is not published or verified yet. The server refuses to publish the line until it is.',
      after: 'Publish the document in Supply documents below, then publish this line.', cta: 'Record a movement',
    }
  }
  return {
    kind: 'publish', title: 'Ready to publish',
    body: 'The recorded details meet the publish check. Publishing makes this line visible to demand matching; the server re-checks everything when you press it.',
    after: 'The line shows as Published; the ledger and quantities stay yours to keep true.', cta: 'Publish this line',
  }
}

function BalanceStrip({ balances }: { balances: Balances }) {
  const total = Math.max(balances.onHand, 0)
  const reservedPct = total > 0 ? Math.min(100, Math.max(0, (balances.reserved / total) * 100)) : 0
  return (
    <section aria-label="Balances" className={`${DESK_PANEL} p-4 sm:p-5`} data-testid="trade-stock-balances">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={DESK_EYEBROW}>Balances</p>
        <Provenance kind="recorded" label="From the ledger · recorded by CarUp" />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {([['On hand', balances.onHand, 'onhand'], ['Reserved', balances.reserved, 'reserved'], ['Available', balances.available, 'available']] as const).map(([label, value, id]) => (
          <div key={id} className="min-w-0">
            <dt className="text-xs font-medium text-carup-text-3">{label}</dt>
            <dd className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-carup-text sm:text-3xl" data-testid={`trade-stock-balance-${id}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-carup-bg-surface-2" aria-hidden="true">
        <span className="bg-carup-text-3" style={{ width: `${reservedPct}%` }} />
        <span className="bg-carup-raw-orange-signal" style={{ width: `${total > 0 ? 100 - reservedPct : 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-carup-text-3">Bar: reserved (grey) and available (orange) within what is on hand.</p>
    </section>
  )
}

function MovementRecorder({ model, balances }: { model: StockDeskModel; balances: Balances }) {
  const m = model.movement
  const ids = useId()
  const qty = Number(m.qty)
  const preview = previewMove(balances, m.action, qty)
  const chosen = moveOf(m.action)
  return (
    <section id="trade-stock-move" aria-label="Record a movement" className={`${DESK_PANEL} scroll-mt-24 p-4 sm:p-5`} data-testid="trade-stock-move">
      <p className={DESK_EYEBROW}>Ledger</p>
      <h3 className="mt-1 text-base font-semibold text-carup-text">Record a movement</h3>
      <p className="mt-1 text-sm leading-6 text-carup-text-2">Quantities are never typed over. Choose what happened and how many units.</p>
      <fieldset className="mt-3">
        <legend className={DESK_LABEL}>What happened</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
          {LEDGER_MOVES.map((mv) => (
            <label key={mv.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control bg-carup-bg-raised px-3 py-2 text-sm text-carup-text ring-1 ring-carup-line transition-colors hover:ring-carup-line-strong has-[:checked]:bg-carup-action-soft has-[:checked]:ring-carup-action has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-carup-focus">
              <input type="radio" name={`${ids}-action`} value={mv.id} checked={m.action === mv.id} onChange={() => m.setAction(mv.id)}
                className="h-4 w-4 shrink-0 accent-carup-action focus-visible:outline-none" data-testid={`trade-stock-move-${mv.id}`} />
              <span className="min-w-0 leading-tight">{mv.label}</span>
            </label>
          ))}
        </div>
        {chosen && <p className="mt-2 text-xs leading-5 text-carup-text-2"><strong className="text-carup-text">{chosen.effect}.</strong> {chosen.detail}</p>}
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-3">
        <div className="w-32">
          <label htmlFor={`${ids}-qty`} className={DESK_LABEL}>Units</label>
          <input id={`${ids}-qty`} type="number" min="0" inputMode="numeric" className={DESK_FIELD} value={m.qty} onChange={(e) => m.setQty(e.target.value)} data-testid="trade-stock-move-qty" />
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={`${ids}-reason`} className={DESK_LABEL}>Reason <span className="font-normal text-carup-text-3">(optional)</span></label>
          <input id={`${ids}-reason`} className={DESK_FIELD} value={m.reason} onChange={(e) => m.setReason(e.target.value)} maxLength={500} aria-describedby={`${ids}-reason-hint`} data-testid="trade-stock-move-reason" />
          <p id={`${ids}-reason-hint`} className={DESK_HINT}>Kept on the ledger line.</p>
        </div>
      </div>
      {preview && (
        <p className="mt-3 rounded-control bg-carup-bg-surface px-3 py-2 font-mono text-[12.5px] leading-6 text-carup-text-2" data-testid="trade-stock-move-preview">
          If recorded: on hand {balances.onHand} → <strong className="text-carup-text">{preview.next.onHand}</strong> · reserved {balances.reserved} → <strong className="text-carup-text">{preview.next.reserved}</strong> · available {balances.available} → <strong className="text-carup-text">{preview.next.available}</strong>
          {preview.refused && <span className="mt-1 block font-sans text-xs font-semibold text-status-warning">{preview.refused}</span>}
        </p>
      )}
      {m.error && <div className="mt-3"><DeskNotice tone="danger" testId="trade-stock-move-error">{m.error}</DeskNotice></div>}
      <button type="button" className={`${DESK_PRIMARY} mt-4 w-full sm:w-auto`} onClick={m.onSubmit} disabled={m.busy} data-testid="trade-stock-move-submit">
        {m.busy ? 'Recording…' : `Record ${chosen ? chosen.label.toLowerCase() : 'movement'}`}
      </button>
      <p className="mt-2 text-xs leading-5 text-carup-text-3">Each movement carries a one-time key, so a double tap records it once.</p>
    </section>
  )
}

function PublicationPanel({ model, item, checks }: { model: StockDeskModel; item: DiasporaStockItem; checks: ReturnType<typeof publishChecks> }) {
  const p = model.publication
  const live = isPublished(item)
  return (
    <section aria-label="Publication" className={`${DESK_PANEL} p-4 sm:p-5`} data-testid="trade-stock-publication-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={DESK_EYEBROW}>Publication</p>
          <h3 className="mt-1 text-base font-semibold text-carup-text">{live ? 'Published to matching' : 'Not published'}</h3>
        </div>
        <StatusChip tone={publicationTone(item.publication_status)}>{humanize(item.publication_status, 'Private')}</StatusChip>
      </div>
      {!live && (
        <div className="mt-3 rounded-control bg-carup-bg-surface p-3" data-testid="trade-stock-publish-checks">
          <p className="text-xs font-semibold text-carup-text">What the publish check looks for</p>
          <ul className="mt-2 space-y-1.5">
            {checks.map((c) => (
              <li key={c.id} data-met={c.met ? 'true' : 'false'} className={`flex items-start gap-2 text-xs leading-5 ${c.met ? 'text-carup-text-2' : 'text-carup-text'}`}>
                {c.met
                  ? <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-carup-text" aria-label="present" />
                  : <Circle className="mt-0.5 h-3.5 w-3.5 flex-none text-carup-text-3" aria-label="still needed" />}
                <span className="min-w-0">{c.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-4 text-carup-text-3">A read-out of the recorded line. The server runs the real check when you publish.</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={p.onToggle} disabled={p.busy} className={live ? DESK_SECONDARY : DESK_PRIMARY} data-testid={live ? 'trade-stock-unpublish' : 'trade-stock-publish'}>
          {p.busy ? 'Updating…' : live ? 'Unpublish' : 'Publish'}
        </button>
      </div>
      <div aria-live="polite" className="mt-2 space-y-2">
        {p.message && <DeskNotice testId="trade-stock-publish-result">{p.message}</DeskNotice>}
        {p.error && <DeskNotice tone="danger" testId="trade-stock-publish-error">{p.error}</DeskNotice>}
      </div>
    </section>
  )
}

function MerchandisingPanel({ model }: { model: StockDeskModel }) {
  const f = model.merch
  const ids = useId()
  return (
    <section id="trade-stock-merch" aria-label="Merchandising details" className={`${DESK_PANEL} scroll-mt-24 p-4 sm:p-5`} data-testid="trade-stock-merch">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={DESK_EYEBROW}>Merchandising</p>
          <h3 className="mt-1 text-base font-semibold text-carup-text">Details buyers are matched on</h3>
        </div>
        <Provenance kind="seller" />
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
        <div>
          <label htmlFor={`${ids}-price`} className={DESK_LABEL}>Unit price</label>
          <input id={`${ids}-price`} type="number" min="0" step="0.01" inputMode="decimal" className={DESK_FIELD} value={f.unitPrice} onChange={(e) => f.setUnitPrice(e.target.value)} data-testid="trade-stock-merch-price" />
        </div>
        <div>
          <label htmlFor={`${ids}-currency`} className={DESK_LABEL}>Currency</label>
          <input id={`${ids}-currency`} className={`${DESK_FIELD} font-mono uppercase`} value={f.currency} onChange={(e) => f.setCurrency(e.target.value.toUpperCase())} maxLength={3} data-testid="trade-stock-merch-currency" />
        </div>
        <div>
          <label htmlFor={`${ids}-condition`} className={DESK_LABEL}>Condition</label>
          <select id={`${ids}-condition`} className={DESK_FIELD} value={f.condition} onChange={(e) => f.setCondition(e.target.value)} data-testid="trade-stock-merch-condition">
            <option value="">Not recorded</option>
            {STOCK_CONDITIONS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-make`} className={DESK_LABEL}>Vehicle make</label>
          <input id={`${ids}-make`} className={DESK_FIELD} value={f.vehicleMake} onChange={(e) => f.setVehicleMake(e.target.value)} data-testid="trade-stock-merch-make" />
        </div>
        <div className="col-span-full">
          <label htmlFor={`${ids}-part`} className={DESK_LABEL}>Part number</label>
          <input id={`${ids}-part`} className={`${DESK_FIELD} font-mono`} value={f.partNumber} onChange={(e) => f.setPartNumber(e.target.value)} data-testid="trade-stock-merch-part" />
          <p className={DESK_HINT}>Publishing needs a vehicle make, a part number or an OEM number.</p>
        </div>
      </div>
      <button type="button" className={`${DESK_SECONDARY} mt-4`} onClick={f.onSave} disabled={f.saving} data-testid="trade-stock-merch-save">
        {f.saving ? 'Saving…' : 'Save details'}
      </button>
      <p className="mt-2 text-xs leading-5 text-carup-text-3">Saved against the version you opened: if someone else changed the line meanwhile, the server refuses and asks you to reload.</p>
      <div aria-live="polite" className="mt-2 space-y-2">
        {f.message && <DeskNotice testId="trade-stock-merch-result">{f.message}</DeskNotice>}
        {f.error && <DeskNotice tone="danger" testId="trade-stock-merch-error">{f.error}</DeskNotice>}
      </div>
    </section>
  )
}

function LedgerHistory({ model }: { model: StockDeskModel }) {
  const rows = newestFirst(model.ledger).map(ledgerLine)
  const by = (id: string | null) => (!id ? 'Not recorded' : id === model.viewerId ? 'You' : `Account ${shortRef(id)}`)
  return (
    <DeskPanel testId="trade-stock-ledger" eyebrow="Sealed ledger" title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-carup-text-3" aria-hidden="true" />Ledger history</span>}
      provenance={<Provenance kind="recorded" />}
      description="Every quantity change on this line, newest first, exactly as the ledger recorded it.">
      {model.ledgerUnreadable ? (
        <DeskState kind="failed" compact title="The movement ledger could not be loaded" onRetry={model.onRetryLedger} testId="trade-stock-ledger-failed">
          This is not a report of an untouched ledger — the read failed. The balances above come from the stock line itself.
        </DeskState>
      ) : rows.length === 0 ? (
        <p className="text-sm text-carup-text-2" data-testid="trade-stock-ledger-empty">No movements recorded yet.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[40rem] text-left text-sm" data-testid="trade-stock-ledger-table">
              <thead>
                <tr className="border-b border-carup-line text-[11px] uppercase tracking-[0.12em] text-carup-text-3">
                  <th scope="col" className="py-2 pr-3 font-semibold">When</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Movement</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">On hand</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Reserved</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Reason</th>
                  <th scope="col" className="py-2 font-semibold">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-carup-line">
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`trade-stock-ledger-row-${r.id}`} className="align-top">
                    <td className="py-2.5 pr-3 text-carup-text-2">{when(r.at) ?? 'Time not recorded'}</td>
                    <td className="py-2.5 pr-3 font-semibold text-carup-text">{humanize(r.action)}</td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-carup-text">{r.onHandBefore ?? '—'} → {r.onHandAfter ?? '—'} <span className="text-carup-text-3">({signed(r.delta)})</span></td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-carup-text">{r.reservedBefore === null && r.reservedAfter === null ? <span className="font-sans text-xs text-carup-text-3">not recorded</span> : `${r.reservedBefore ?? '—'} → ${r.reservedAfter ?? '—'}`}</td>
                    <td className="py-2.5 pr-3 text-carup-text-2 [overflow-wrap:anywhere]">{r.reason ?? '—'}</td>
                    <td className="py-2.5 text-carup-text-2">{by(r.by)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ol className="space-y-2 md:hidden" data-testid="trade-stock-ledger-cards">
            {rows.map((r) => (
              <li key={r.id} className="rounded-control bg-carup-bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-carup-text">{humanize(r.action)}</p>
                  <p className="font-mono text-sm tabular-nums text-carup-text">{signed(r.delta)}</p>
                </div>
                <p className="mt-1 font-mono text-[12px] tabular-nums text-carup-text-2">on hand {r.onHandBefore ?? '—'} → {r.onHandAfter ?? '—'}{r.reservedAfter !== null ? ` · reserved ${r.reservedBefore ?? '—'} → ${r.reservedAfter}` : ''}</p>
                {r.reason && <p className="mt-1 text-xs text-carup-text-2 [overflow-wrap:anywhere]">“{r.reason}”</p>}
                <p className="mt-1 text-[12px] text-carup-text-3">{when(r.at) ?? 'Time not recorded'} · {by(r.by)}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </DeskPanel>
  )
}

/* ───────────────────────── supply documents ───────────────────────── */

function SupplyDocsPanel({ model }: { model: StockDeskModel }) {
  const s = model.supply
  const ids = useId()
  // A read failure and an action refusal can share the legacy message slot; show the read once.
  const actionError = s.error && (!model.docsFailure || s.error !== model.docsFailure.message) ? s.error : ''
  return (
    <DeskPanel className="mt-6" testId="trade-stock-supply" eyebrow="Provenance"
      title={<span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-carup-text-3" aria-hidden="true" />Supply documents</span>}
      provenance={<Provenance kind="seller" label="Seller-issued · verification is CarUp's" />}
      description="The documents your stock comes from (catalogues, supplier invoices, packing lists). Publishing one needs its number, title and origin country.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {model.docsFailure && model.docs.length === 0 ? (
            <ReadFailureState failure={model.docsFailure} what="Your supply documents" onRetry={model.onRetryDocs} compact testId="trade-stock-supply-failed" />
          ) : model.docsLoading && model.docs.length === 0 ? (
            <p className="text-sm text-carup-text-2" role="status" data-testid="trade-stock-supply-loading">Reading your supply documents…</p>
          ) : model.docs.length === 0 ? (
            <p className="text-sm text-carup-text-2" data-testid="trade-stock-supply-empty">No supply documents yet. A draft you create here stays private until you publish it.</p>
          ) : (
            <ul className="divide-y divide-carup-line" data-testid="trade-stock-supply-list">
              {model.docs.map((d) => <SupplyDocRow key={d.id} doc={d} busy={s.busyId === d.id} onPublish={() => s.onPublish(d)} onUnpublish={() => s.onUnpublish(d)} />)}
            </ul>
          )}
          {actionError && <div className="mt-3"><DeskNotice tone="danger" testId="trade-stock-supply-error">{actionError}</DeskNotice></div>}
        </div>
        <div className="min-w-0 rounded-card bg-carup-bg-surface p-4" data-testid="trade-stock-supply-create">
          <p className="text-sm font-semibold text-carup-text">New draft document</p>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor={`${ids}-num`} className={DESK_LABEL}>Document number</label>
              <input id={`${ids}-num`} className={`${DESK_FIELD} font-mono`} value={s.number} onChange={(e) => s.setNumber(e.target.value)} data-testid="trade-stock-supply-number" />
            </div>
            <div>
              <label htmlFor={`${ids}-title`} className={DESK_LABEL}>Title</label>
              <input id={`${ids}-title`} className={DESK_FIELD} value={s.title} onChange={(e) => s.setTitle(e.target.value)} data-testid="trade-stock-supply-title" />
            </div>
            <div>
              <label htmlFor={`${ids}-origin`} className={DESK_LABEL}>Origin country <span className="font-normal text-carup-text-3">(needed to publish)</span></label>
              <input id={`${ids}-origin`} className={DESK_FIELD} value={s.origin} onChange={(e) => s.setOrigin(e.target.value)} data-testid="trade-stock-supply-origin" />
            </div>
          </div>
          <button type="button" className={`${DESK_SECONDARY} mt-4 w-full`} onClick={s.onCreate} disabled={s.submitting} data-testid="trade-stock-supply-submit">
            {s.submitting ? 'Saving…' : 'Create draft document'}
          </button>
        </div>
      </div>
    </DeskPanel>
  )
}

function SupplyDocRow({ doc, busy, onPublish, onUnpublish }: { doc: DiasporaSupplyDocument; busy: boolean; onPublish: () => void; onUnpublish: () => void }) {
  const live = doc.status === 'PUBLISHED'
  const validity = [doc.valid_from ? `from ${when(doc.valid_from) ?? doc.valid_from}` : null, doc.valid_until ? `until ${when(doc.valid_until) ?? doc.valid_until}` : null].filter(Boolean).join(' ')
  const place = [doc.origin_city, doc.origin_country].filter(Boolean).join(', ')
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`trade-stock-supply-row-${doc.id}`}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-carup-text"><span className="font-mono">{doc.document_number}</span> <span className="font-normal text-carup-text-2">— {doc.title}</span></p>
        <p className="mt-0.5 text-xs text-carup-text-3">{place || 'Origin not recorded'}{validity ? ` · valid ${validity}` : ''}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <StatusChip tone={supplyDocTone(doc.status)}>{humanize(doc.status)}</StatusChip>
          <StatusChip tone={verificationTone(doc.verification_status)}>Verification: {humanize(doc.verification_status, 'not recorded')}</StatusChip>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {live
          ? <button type="button" className={DESK_SECONDARY} onClick={onUnpublish} disabled={busy} data-testid={`trade-stock-supply-unpublish-${doc.id}`}>{busy ? 'Updating…' : 'Unpublish'}</button>
          : <button type="button" className={DESK_SECONDARY} onClick={onPublish} disabled={busy} data-testid={`trade-stock-supply-publish-${doc.id}`}>{busy ? 'Updating…' : 'Publish'}</button>}
      </div>
    </li>
  )
}

/* ───────────────────────── phone dock ───────────────────────── */

function StockPhoneDock({ model, item }: { model: StockDeskModel; item: DiasporaStockItem }) {
  const b = balancesOf(item)
  const missing = publishChecks(item, model.docsFailure ? null : model.docs).filter((c) => !c.met).map((c) => c.id)
  const move = nextMoveOf(item, b, missing)
  return (
    <PhoneDock active label={<><span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">Next move</span>{move.title}</>}>
      {move.kind === 'publish'
        ? <button type="button" className={DESK_PRIMARY} onClick={model.publication.onToggle} disabled={model.publication.busy} data-testid="trade-stock-dock-publish">{model.publication.busy ? 'Publishing…' : 'Publish'}</button>
        : <a href={move.kind === 'merch' ? '#trade-stock-merch' : '#trade-stock-move'} className={DESK_PRIMARY} data-testid="trade-stock-dock-jump">{move.kind === 'merch' ? 'Details' : 'Record'}</a>}
    </PhoneDock>
  )
}
