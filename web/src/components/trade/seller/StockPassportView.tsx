/**
 * RX-06 Trade — the stock passport as a provenance-first document (unified /diaspora/stock/:id/passport).
 *
 * Every fact says where it came from: entered by the seller (not verified), recorded by CarUp (the
 * sealed ledger, timestamps, verification and trust as CarUp recorded them), or not recorded at all.
 * Read-only: there is no edit affordance anywhere. Fed by DiasporaStockPassport's own reads.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, RefreshCw } from 'lucide-react'
import type { DiasporaStockItem, DiasporaSupplyDocument } from '@/types'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { DeskHeader, DeskPulse, DeskState, Provenance, ReadFailureState } from './DeskPrimitives'
import { DESK_EYEBROW, DESK_INK_SECONDARY, DESK_PANEL, DESK_PRIMARY, DESK_SECONDARY } from './deskStyles'
import { humanize, money, numberOrNull, shortRef, signed, when } from './deskFormat'
import { balancesOf, exportTone, ledgerLine, newestFirst, publicationTone, supplyDocTone, verificationTone } from './stockDesk'
import { PASSPORT_SECTIONS, type StockPassportModel } from './stockPassport'

const PAGE = 'mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8'

type Source = 'seller' | 'default' | 'carup' | 'none'
// 'default': the server fills condition (USED) and currency (USD) when the seller leaves them blank, and
// the record does not say which happened — so the label says both.
const SOURCE_LABEL: Record<Source, string> = { seller: 'Seller-entered', default: 'Seller-entered or CarUp default', carup: 'Recorded by CarUp', none: '' }

export function StockPassportView({ model }: { model: StockPassportModel }) {
  if (model.authLoading || (model.loading && !model.hasLoaded)) {
    return <div className={PAGE}><DeskState kind="loading" title="Opening the stock passport…" testId="trade-passport-loading" /></div>
  }
  if (!model.isAuthenticated) {
    return (
      <div className={PAGE}>
        <DeskState kind="signin" title="Sign in to view this stock passport" testId="trade-passport-signin"
          action={<Link to="/login" className={DESK_PRIMARY}>Sign in</Link>}>
          A stock passport is shown to signed-in trade accounts only.
        </DeskState>
      </div>
    )
  }
  if (model.failure) {
    const back = <Link to="/diaspora/stock" className={DESK_SECONDARY}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to stock</Link>
    return (
      <div className={`${PAGE} space-y-3`} data-testid="trade-passport-failed" data-kind={model.failure.kind}>
        {model.failure.kind === 'unavailable'
          ? (
            <DeskState kind="unavailable" title="This stock item was not found" action={back}>
              It may have been removed, or the link points at an item you cannot see. Nothing was changed.
            </DeskState>
          )
          : <ReadFailureState failure={model.failure} what="This stock passport" onRetry={model.onRefresh}
              deniedHint="This account does not have access to this stock item." />}
        {model.failure.kind !== 'unavailable' && <div>{back}</div>}
      </div>
    )
  }
  const item = model.item
  if (!item) {
    return <div className={PAGE}><DeskState kind="empty" title="No passport to show yet" testId="trade-passport-empty" onRetry={model.onRefresh} retryLabel="Load it" /></div>
  }

  const b = balancesOf(item)
  const ledgerCount = model.ledger ? model.ledger.length : null
  return (
    <div className={PAGE} data-testid="trade-passport" aria-busy={model.loading}>
      <DeskHeader
        testId="trade-passport-header"
        eyebrow="Trade · Stock passport"
        title={item.part_name}
        description="What is recorded about this stock line, who recorded it, and whether CarUp has verified it. Read-only."
        meta={(
          <>
            <span className="font-mono text-xs text-white/70" data-testid="trade-passport-id">{item.id}</span>
            <StatusChip tone={publicationTone(item.publication_status)}>{humanize(item.publication_status, 'Private')}</StatusChip>
            <StatusChip tone={verificationTone(item.verification_status)} testId="trade-passport-verification">CarUp verification: {humanize(item.verification_status, 'not recorded')}</StatusChip>
            <StatusChip tone={exportTone(item.export_readiness_status)}>Export: {humanize(item.export_readiness_status, 'not recorded')}</StatusChip>
          </>
        )}
        actions={(
          <>
            <Link to="/diaspora/stock" className={DESK_INK_SECONDARY} data-testid="trade-passport-back"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Stock</Link>
            <button type="button" className={DESK_INK_SECONDARY} onClick={model.onRefresh} disabled={model.loading} data-testid="trade-passport-refresh">
              <RefreshCw className={`h-4 w-4 ${model.loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /> {model.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        )}
        pulse={(
          <DeskPulse testId="trade-passport-pulse" scope="As recorded" items={[
            { label: 'on hand', value: b.onHand },
            { label: 'reserved', value: b.reserved },
            { label: 'available', value: b.available },
            { label: ledgerCount === null ? 'ledger not readable' : ledgerCount === 1 ? 'ledger movement' : 'ledger movements', value: ledgerCount ?? '—' },
          ]} />
        )}
      />

      <nav aria-label="Passport sections" className="relative -mx-1 mt-4 overflow-x-auto px-1 pb-1 lg:hidden" data-testid="trade-passport-jump">
        <ul className="flex gap-1.5">
          {PASSPORT_SECTIONS.map((s) => (
            <li key={s.id} className="shrink-0">
              <a href={`#passport-${s.id}`} className="inline-flex min-h-11 items-center rounded-full border border-carup-line bg-carup-bg-raised px-3 text-sm font-semibold text-carup-text-2 hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">{s.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-4 grid items-start gap-6 lg:mt-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Passport contents" className="sticky top-24 hidden lg:block">
          <p className={DESK_EYEBROW}>Contents</p>
          <ol className="mt-2 space-y-0.5 border-l border-carup-line">
            {PASSPORT_SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#passport-${s.id}`} className="-ml-px flex min-h-11 items-center gap-2 border-l-2 border-transparent pl-3 text-sm font-semibold text-carup-text-2 hover:border-carup-line-strong hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                  <span className="font-mono text-[11px] text-carup-text-3">{String(i + 1).padStart(2, '0')}</span>{s.label}
                </a>
              </li>
            ))}
          </ol>
          <div className="mt-5 space-y-2 text-xs leading-5 text-carup-text-2">
            <p className="font-semibold text-carup-text">Reading the sources</p>
            <p><span className="font-semibold text-carup-text">Seller-entered</span> — typed by the seller; CarUp has not checked it unless a verification says so.</p>
            <p><span className="font-semibold text-carup-text">Seller-entered or CarUp default</span> — CarUp fills condition and currency when the seller leaves them blank; the record does not say which happened.</p>
            <p><span className="font-semibold text-carup-text">Recorded by CarUp</span> — written by CarUp&apos;s systems (ledger, timestamps, verification).</p>
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          <PassportSection n={1} id="identity" title="Identity" chips={<><Provenance kind="seller" /><StatusChip tone={verificationTone(item.verification_status)}>CarUp verification: {humanize(item.verification_status, 'not recorded')}</StatusChip></>}>
            <Facts rows={[
              { label: 'Part name', value: item.part_name, source: 'seller' },
              { label: 'SKU', value: item.sku, mono: true, source: 'seller' },
              { label: 'Part number', value: item.part_number, mono: true, source: 'seller' },
              { label: 'OEM number', value: item.oem_number, mono: true, source: 'seller' },
              { label: 'Aftermarket number', value: item.aftermarket_number, mono: true, source: 'seller' },
              { label: 'Condition', value: item.condition ? humanize(item.condition) : null, source: 'default' },
            ]} testId="trade-passport-identity" />
          </PassportSection>

          <PassportSection n={2} id="seller" title="Seller / supplier" chips={<Provenance kind="recorded" label="Trade profile · verification and trust as CarUp recorded them" />}>
            <SellerBlock model={model} item={item} />
          </PassportSection>

          <PassportSection n={3} id="source" title="Provenance & source" chips={<Provenance kind="seller" />}>
            <Facts rows={[
              { label: 'Origin', value: [item.origin_city, item.origin_country].filter(Boolean).join(', ') || null, source: 'seller' },
              { label: 'Warehouse', value: item.warehouse_location, source: 'seller' },
            ]} testId="trade-passport-source" />
            <div className="mt-4 border-t border-carup-line pt-4">
              <p className="text-sm font-semibold text-carup-text">Linked supply document</p>
              <div className="mt-2"><SupplyDocBlock item={item} docs={model.supplyDocs} testId="trade-passport-supply" /></div>
            </div>
          </PassportSection>

          <PassportSection n={4} id="fit" title="Compatibility" chips={<Provenance kind="seller" />}>
            <Facts rows={[
              { label: 'Vehicle make', value: item.vehicle_make, source: 'seller' },
              { label: 'Vehicle model', value: item.vehicle_model, source: 'seller' },
              { label: 'Year range', value: item.vehicle_year_min || item.vehicle_year_max ? `${item.vehicle_year_min ?? '—'} – ${item.vehicle_year_max ?? '—'}` : null, source: 'seller' },
            ]} testId="trade-passport-fit" />
          </PassportSection>

          <PassportSection n={5} id="price" title="Price" chips={<Provenance kind="seller" />}>
            <Facts rows={[{ label: 'Unit price', value: money(item.unit_price, item.currency), source: 'seller' }]} testId="trade-passport-price" />
            <p className="mt-3 text-xs leading-5 text-carup-text-3">The seller&apos;s price per unit, as entered. CarUp does not add or estimate freight, duty or fees here.</p>
          </PassportSection>

          <PassportSection n={6} id="ledger" title="Quantity & reservation ledger" chips={<Provenance kind="recorded" label="Sealed ledger · recorded by CarUp" />}>
            <dl className="grid grid-cols-3 gap-3" data-testid="trade-passport-balances">
              {([['On hand', b.onHand], ['Reserved', b.reserved], ['Available', b.available]] as const).map(([label, value]) => (
                <div key={label} className="rounded-control bg-carup-bg-surface px-3 py-2">
                  <dt className="text-xs text-carup-text-3">{label}</dt>
                  <dd className="font-mono text-xl font-semibold tabular-nums text-carup-text">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4"><PassportLedger model={model} /></div>
          </PassportSection>

          <PassportSection n={7} id="documents" title="Documents & verification">
            <SupplyDocBlock item={item} docs={model.supplyDocs} testId="trade-passport-documents" />
            <p className="mt-3 flex items-start gap-2 text-sm text-carup-text-2" data-testid="trade-passport-photos">
              <Camera className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
              Photos are not supported for stock lines yet, so there are none to show — this is not a missing upload.
            </p>
          </PassportSection>

          <PassportSection n={8} id="audit" title="Matches & audit" chips={<Provenance kind="recorded" />}>
            <Facts rows={[
              { label: 'Record id', value: item.id, mono: true, source: 'carup' },
              { label: 'Created', value: when(item.created_at ?? null), source: 'carup' },
              { label: 'Last changed', value: when(item.updated_at ?? null), source: 'carup' },
            ]} testId="trade-passport-audit" />
            <p className="mt-3 text-sm leading-6 text-carup-text-2" data-testid="trade-passport-matches">
              Matching against buyer demand is shown to buyers on their own demand orders; it is not fetched here. The ledger above is the sealed audit trail of every quantity change; the full per-item audit record is retained server-side.
            </p>
          </PassportSection>
        </div>
      </div>
    </div>
  )
}

function PassportSection({ n, id, title, chips, children }: { n: number; id: string; title: string; chips?: ReactNode; children: ReactNode }) {
  return (
    <section id={`passport-${id}`} aria-labelledby={`passport-${id}-title`} className={`${DESK_PANEL} scroll-mt-24 p-4 sm:p-5`} data-testid={`trade-passport-section-${id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h2 id={`passport-${id}-title`} className="flex items-baseline gap-2 text-base font-semibold text-carup-text">
          <span className="font-mono text-xs text-carup-text-3">{String(n).padStart(2, '0')}</span>{title}
        </h2>
        {chips && <div className="flex flex-wrap items-center gap-1.5">{chips}</div>}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  )
}

function Facts({ rows, testId }: { rows: Array<{ label: string; value: ReactNode; mono?: boolean; source: Source }>; testId?: string }) {
  return (
    <dl className="divide-y divide-carup-line" data-testid={testId}>
      {rows.map((r) => {
        const missing = r.value === null || r.value === undefined || r.value === ''
        return (
          <div key={r.label} className="grid gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4">
            <dt className="text-sm text-carup-text-2">{r.label}</dt>
            <dd className={missing ? 'text-sm text-carup-text-3' : r.mono ? 'font-mono text-[13px] text-carup-text [overflow-wrap:anywhere]' : 'text-sm font-medium text-carup-text [overflow-wrap:anywhere]'}>
              {missing ? 'Not recorded' : r.value}
            </dd>
            <dd className="text-[11px] font-semibold uppercase tracking-[0.1em] text-carup-text-3">{missing ? '' : SOURCE_LABEL[r.source]}</dd>
          </div>
        )
      })}
    </dl>
  )
}

function SellerBlock({ model, item }: { model: StockPassportModel; item: DiasporaStockItem }) {
  const p = model.profile
  if (p) {
    const trust = numberOrNull(p.trust_score)
    const rating = numberOrNull(p.rating_average)
    return (
      <div data-testid="trade-passport-seller">
        <div className="mb-3 flex flex-wrap gap-1.5">
          <StatusChip tone={verificationTone(p.verification_status)} testId="trade-passport-seller-verification">Profile verification: {humanize(p.verification_status, 'not recorded')}</StatusChip>
        </div>
        <Facts rows={[
          { label: 'Display name', value: p.display_name, source: 'seller' },
          { label: 'Profile type', value: p.profile_type ? humanize(p.profile_type) : null, source: 'carup' },
          { label: 'Based in', value: [p.city, p.country].filter(Boolean).join(', ') || null, source: 'seller' },
          { label: 'Trust score', value: trust === null ? 'Not scored' : String(trust), source: 'carup' },
          { label: 'Completed shipments', value: p.completed_shipments_count ?? null, source: 'carup' },
          { label: 'Disputes', value: p.dispute_count ?? null, source: 'carup' },
          { label: 'Rating average', value: rating === null ? null : String(rating), source: 'carup' },
        ]} />
      </div>
    )
  }
  if (model.profileFailed) {
    return (
      <DeskState kind="failed" compact title="The seller's trade profile could not be read" onRetry={model.onRefresh} testId="trade-passport-seller-failed">
        This is not a report that the seller has no profile — the read failed. Linked profile <span className="font-mono">{shortRef(item.seller_trade_profile_id)}</span>.
      </DeskState>
    )
  }
  if (item.seller_trade_profile_id) {
    return <p className="text-sm text-carup-text-2" data-testid="trade-passport-seller-hidden">A trade profile is linked (<span className="font-mono">{shortRef(item.seller_trade_profile_id)}</span>) but none was returned to this account.</p>
  }
  return <p className="text-sm text-carup-text-2" data-testid="trade-passport-seller-none">No seller trade profile is linked to this stock line.</p>
}

function SupplyDocBlock({ item, docs, testId }: { item: DiasporaStockItem; docs: DiasporaSupplyDocument[] | null; testId: string }) {
  if (!item.supply_document_id) {
    return <p className="text-sm text-carup-text-2" data-testid={`${testId}-none`}>No supply document is linked to this stock line.</p>
  }
  if (docs === null) {
    return (
      <DeskState kind="failed" compact title="The linked supply document could not be read" testId={`${testId}-failed`}>
        Linked document <span className="font-mono">{shortRef(item.supply_document_id)}</span>. This is not a report that it is missing — the read failed.
      </DeskState>
    )
  }
  const doc = docs.find((d) => d.id === item.supply_document_id) ?? null
  if (!doc) {
    return <p className="text-sm text-carup-text-2" data-testid={`${testId}-hidden`}>Linked document <span className="font-mono">{shortRef(item.supply_document_id)}</span> is not visible to this account.</p>
  }
  return (
    <div className="rounded-control bg-carup-bg-surface p-3" data-testid={testId}>
      <p className="text-sm font-semibold text-carup-text"><span className="font-mono">{doc.document_number}</span> <span className="font-normal text-carup-text-2">— {doc.title}</span></p>
      <p className="mt-0.5 text-xs text-carup-text-3">
        {[doc.origin_city, doc.origin_country].filter(Boolean).join(', ') || 'Origin not recorded'}
        {doc.valid_until ? ` · valid until ${when(doc.valid_until) ?? doc.valid_until}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusChip tone={supplyDocTone(doc.status)}>{humanize(doc.status)}</StatusChip>
        <StatusChip tone={verificationTone(doc.verification_status)}>CarUp verification: {humanize(doc.verification_status, 'not recorded')}</StatusChip>
        <Provenance kind="seller" label="Seller-issued document" />
      </div>
    </div>
  )
}

function PassportLedger({ model }: { model: StockPassportModel }) {
  if (model.ledger === null) {
    return (
      <DeskState kind="failed" compact title="The movement ledger could not be read" onRetry={model.onRefresh} testId="trade-passport-ledger-failed">
        The balances above come from the stock line itself. This is not a report of an untouched ledger.
      </DeskState>
    )
  }
  const rows = newestFirst(model.ledger).map(ledgerLine)
  if (rows.length === 0) return <p className="text-sm text-carup-text-2" data-testid="trade-passport-ledger-empty">No movements recorded.</p>
  const by = (id: string | null) => (!id ? 'Not recorded' : id === model.viewerId ? 'You' : `Account ${shortRef(id)}`)
  return (
    <ol className="space-y-3 border-l border-carup-line pl-4" data-testid="trade-passport-ledger">
      {rows.map((r) => (
        <li key={r.id} className="relative min-w-0" data-testid={`trade-passport-ledger-row-${r.id}`}>
          <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-carup-line-strong ring-2 ring-carup-bg-raised" />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-semibold text-carup-text">{humanize(r.action)} <span className="font-mono font-normal text-carup-text-2">{signed(r.delta)}</span></p>
            <p className="text-[12px] text-carup-text-3">{when(r.at) ?? 'Time not recorded'} · {by(r.by)}</p>
          </div>
          <p className="mt-0.5 font-mono text-[12px] tabular-nums text-carup-text-2">
            on hand {r.onHandBefore ?? '—'} → {r.onHandAfter ?? '—'}
            {r.reservedAfter !== null ? ` · reserved ${r.reservedBefore ?? '—'} → ${r.reservedAfter}` : ''}
          </p>
          {r.reason && <p className="mt-0.5 text-xs text-carup-text-2 [overflow-wrap:anywhere]">“{r.reason}”</p>}
        </li>
      ))}
    </ol>
  )
}
