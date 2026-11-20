/**
 * RX05-C — Dealer OS · Inventory (unified presentation of /dealers/stock).
 *
 * Presentation only. `DealerTenantInventory` keeps every read, write, receipt check, session-switch
 * guard and rate-limit decision; this view receives its state and handlers as props and adds only UI
 * state (which vehicle is open, whether the add-vehicle panel is shown).
 *
 * Layout: a compact, scannable vehicle list → a vehicle detail with ONE next step. On phones the
 * list and the detail are separate screens; from `lg` they sit side by side.
 *
 * Vehicle visibility is shown as three explicit, separate states derived from recorded fields:
 *   Private draft (neutral) → Prepared · awaiting CarUp checks (warning) → Public on Marketplace
 *   (success — only when the canonical publication state says `published`).
 * Vehicle photographs are not part of this inventory read, so none are shown or implied.
 */
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Car, ChevronLeft, ChevronRight, ImageOff, Plus, Search, X } from 'lucide-react'
import DealerVinListingPanel from '@/components/dealer/DealerVinListingPanel'
import { DealerObjectHeader } from './DealerObjectHeader'
import { EmptyState, WorkspaceNotice } from './EmptyState'
import { StatusChip, type StatusTone } from './StatusChip'
import { humanizeCode, revealOnPhone, vehicleName } from './format'
import {
  WS_CARD, WS_DD, WS_DT, WS_EYEBROW, WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_ROW,
  WS_SECONDARY, WS_SECTION_TITLE, WS_TEXT_ACTION,
} from './workspaceStyles'

export interface InventoryVehicleView {
  vin: string
  make: string | null
  model: string | null
  year: number | null
  recorded_mileage: number | null
  recorded_lifecycle_state: string | null
  recorded_marketplace_publication_state: string | null
  listing_candidate_prepared?: boolean
  declared_price?: number | null
  declared_currency?: string | null
  listing_structural_precheck: { result: string; blocking_reason_codes: string[] }
}

type Setter = (value: string) => void

export interface InventoryWorkspaceProps<V extends InventoryVehicleView = InventoryVehicleView> {
  status: 'loading' | 'ready' | 'denied' | 'unavailable'
  inventory: { owner_tenant_id: string; returned_count: number; entries: V[] } | null
  filtered: V[]
  search: string
  onSearch: Setter
  draft: {
    vin: string; make: string; model: string; year: string; mileage: string
    setVin: Setter; setMake: Setter; setModel: Setter; setYear: Setter; setMileage: Setter
    saving: boolean; notice: string; error: string; readWarning: string
    onSubmit: () => void
  }
  edit: {
    vin: string; make: string; model: string; year: string; mileage: string
    setMake: Setter; setModel: Setter; setYear: Setter; setMileage: Setter
    saving: boolean; notice: string; error: string
    onBegin: (vehicle: V) => void
    onSave: () => void
    onCancel: () => void
  }
  pendingPrecheckVin: string
  openListingVin: string
  onToggleListing: (vin: string) => void
  branches: { id: string; name: string | null }[] | null
  userId?: string
  token?: string | null
  onRetry: () => void
  onListingChanged: () => void
}

/** The same editability rule the legacy card applies (Pending lifecycle + draft publication). */
const isEditable = (v: InventoryVehicleView) =>
  v.recorded_lifecycle_state === 'Pending' && v.recorded_marketplace_publication_state === 'draft'

function visibilityOf(v: InventoryVehicleView): { tone: StatusTone; label: string; key: string } {
  const state = v.recorded_marketplace_publication_state
  if (state === 'published') return { tone: 'success', label: 'Public on Marketplace', key: 'public' }
  if (state === 'draft' || !state) {
    return v.listing_candidate_prepared
      ? { tone: 'warning', label: 'Prepared · awaiting CarUp checks', key: 'prepared' }
      : { tone: 'neutral', label: 'Private draft', key: 'private' }
  }
  return { tone: 'neutral', label: humanizeCode(state), key: 'other' }
}

function precheckOf(v: InventoryVehicleView, pendingVin: string): { tone: StatusTone; label: string } {
  if (pendingVin === v.vin) return { tone: 'warning', label: 'Precheck not re-run since edit' }
  if (v.listing_structural_precheck.result === 'REQUIRES_DATA_CORRECTION') return { tone: 'warning', label: 'Data needs correction' }
  return { tone: 'neutral', label: 'Data precheck clear' }
}

function NextStep({ title, children, action, testId }: { title: string; children: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-card border border-carup-line-strong bg-carup-bg p-4">
      <p className={WS_EYEBROW}>Next step</p>
      <p className="mt-1 text-sm font-semibold text-carup-text">{title}</p>
      <p className="mt-1 text-sm leading-6 text-carup-text-2">{children}</p>
      {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

export function InventoryWorkspace<V extends InventoryVehicleView>(props: InventoryWorkspaceProps<V>) {
  const { status, inventory, filtered, search, onSearch, draft, edit, pendingPrecheckVin, openListingVin,
    onToggleListing, branches, userId, token, onRetry, onListingChanged } = props
  const [addOpen, setAddOpen] = useState(false)
  const [selectedVin, setSelectedVin] = useState('')
  const [phoneDetail, setPhoneDetail] = useState(false)
  const detailRef = useRef<HTMLHeadingElement>(null)
  const listingRef = useRef<HTMLDivElement>(null)

  const selected = filtered.find(v => v.vin === selectedVin) ?? filtered[0] ?? null
  const showDetailOnPhone = phoneDetail && selected !== null

  function open(vin: string) {
    setSelectedVin(vin)
    setPhoneDetail(true)
    window.requestAnimationFrame(() => revealOnPhone(detailRef.current))
  }
  function openListing(vin: string) {
    if (openListingVin !== vin) onToggleListing(vin)
    window.requestAnimationFrame(() => listingRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }))
  }

  const notices = (
    <>
      {draft.notice && <WorkspaceNotice testId="dealer-ws-draft-notice">{draft.notice}</WorkspaceNotice>}
      {draft.error && <WorkspaceNotice tone="warning">{draft.error}</WorkspaceNotice>}
      {draft.readWarning && <WorkspaceNotice tone="warning">{draft.readWarning}</WorkspaceNotice>}
      {edit.notice && <WorkspaceNotice testId="dealer-ws-edit-notice">{edit.notice}</WorkspaceNotice>}
    </>
  )

  return (
    <div className="space-y-5 text-carup-text" data-testid="dealer-ws-inventory" data-presentation="dealer-workspace-inventory">
      <DealerObjectHeader
        eyebrow="Dealer OS · Inventory"
        title="Inventory"
        description="Your dealership's vehicles exactly as CarUp records them. A vehicle stays private until it passes CarUp's own Marketplace checks."
        meta={status === 'ready' && inventory ? (
          <>
            <StatusChip testId="dealer-ws-stock-count">{inventory.returned_count} {inventory.returned_count === 1 ? 'vehicle' : 'vehicles'} in this read</StatusChip>
            <span className="text-xs text-carup-text-3">First page only · total stock is not calculated · no synthetic vehicles added</span>
          </>
        ) : undefined}
        actions={status === 'ready' ? (
          <button
            type="button"
            className={addOpen ? WS_SECONDARY : WS_PRIMARY}
            aria-expanded={addOpen}
            aria-controls="dealer-ws-add-vehicle"
            data-testid="dealer-ws-add-vehicle-toggle"
            onClick={() => setAddOpen(o => !o)}
          >
            {addOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {addOpen ? 'Close' : 'Add vehicle'}
          </button>
        ) : undefined}
      />

      {status === 'loading' && <EmptyState kind="loading" title="Loading your dealership's vehicles…" testId="dealer-ws-stock-loading" />}
      {status === 'denied' && (
        <EmptyState kind="denied" title="Inventory needs an approved dealership" testId="dealer-ws-stock-denied">
          An active, independently approved dealership owner and tenant membership is required.
          An unclaimed research listing or unaudited dealer role does not grant inventory access.
        </EmptyState>
      )}
      {status === 'unavailable' && (
        <EmptyState kind="error" title="Inventory could not be loaded" onRetry={onRetry} testId="dealer-ws-stock-error">
          The inventory service could not be reached or verified. This outage does not mean your
          dealership or stock is inactive or empty.
        </EmptyState>
      )}

      {status === 'ready' && inventory && (
        <>
          {addOpen && (
            <section id="dealer-ws-add-vehicle" aria-labelledby="dealer-ws-add-vehicle-title" className={`${WS_CARD} p-4 sm:p-5`} data-testid="dealer-ws-add-vehicle">
              <h2 id="dealer-ws-add-vehicle-title" className={WS_SECTION_TITLE}>Add a vehicle as a private draft</h2>
              <p className={WS_HINT}>
                Saves the VIN to your dealership's own records only. It grants no seller authority, listing
                approval, title, duty clearance, finance or payment permission.
              </p>
              <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e => { e.preventDefault(); draft.onSubmit() }}>
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className={WS_LABEL} htmlFor="private-draft-vin">VIN — 17 characters</label>
                  <input
                    id="private-draft-vin" className={`${WS_FIELD} font-mono uppercase`}
                    required maxLength={17} minLength={17} pattern="[A-HJ-NPR-Z0-9]{17}"
                    title="17 letters and digits. VINs never contain the letters I, O or Q."
                    aria-describedby="private-draft-vin-hint" autoComplete="off" value={draft.vin}
                    onChange={e => draft.setVin(e.target.value.toUpperCase())}
                  />
                  <p id="private-draft-vin-hint" className={WS_HINT}>Letters and digits only. VINs never use I, O or Q.</p>
                </div>
                <div>
                  <label className={WS_LABEL} htmlFor="private-draft-make">Manufacturer</label>
                  <input id="private-draft-make" className={WS_FIELD} required minLength={2} maxLength={80}
                    value={draft.make} onChange={e => draft.setMake(e.target.value)} />
                </div>
                <div>
                  <label className={WS_LABEL} htmlFor="private-draft-model">Model</label>
                  <input id="private-draft-model" className={WS_FIELD} required minLength={1} maxLength={100}
                    value={draft.model} onChange={e => draft.setModel(e.target.value)} />
                </div>
                <div>
                  <label className={WS_LABEL} htmlFor="private-draft-year">Model year</label>
                  <input id="private-draft-year" className={WS_FIELD} required type="number" min={1950}
                    max={new Date().getFullYear() + 1} value={draft.year} onChange={e => draft.setYear(e.target.value)} />
                </div>
                <div>
                  <label className={WS_LABEL} htmlFor="private-draft-mileage">Odometer (km) · your declaration</label>
                  <input id="private-draft-mileage" type="number" required min={0} max={2000000} step={1}
                    placeholder="Recorded kilometres" className={WS_FIELD}
                    value={draft.mileage} onChange={e => draft.setMileage(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={draft.saving} className={`${WS_PRIMARY} w-full`}>
                    {draft.saving ? 'Saving…' : 'Register private VIN draft'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {notices}

          {inventory.entries.length === 0 ? (
            <EmptyState
              title="No vehicles recorded yet"
              testId="dealer-ws-stock-empty"
              action={!addOpen ? (
                <button type="button" className={WS_PRIMARY} onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add your first vehicle
                </button>
              ) : undefined}
            >
              Add a vehicle by its VIN to create a private draft. It stays private to your dealership until it
              passes CarUp's Marketplace checks. This read does not tell us about stock you hold outside CarUp.
            </EmptyState>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
              <section
                aria-labelledby="dealer-ws-stock-list-title"
                className={`${WS_CARD} overflow-hidden ${showDetailOnPhone ? 'hidden lg:block' : ''}`}
                data-testid="dealer-ws-stock-list"
              >
                <div className="border-b border-carup-line p-3 sm:p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 id="dealer-ws-stock-list-title" className={WS_SECTION_TITLE}>Vehicles</h2>
                    <span className="text-xs text-carup-text-3">{filtered.length} of {inventory.entries.length} shown</span>
                  </div>
                  <label htmlFor="tenant-stock-search" className="sr-only">Search the loaded vehicle records</label>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-carup-text-3" aria-hidden="true" />
                    <input
                      id="tenant-stock-search" type="search" className={`${WS_FIELD} pl-9`}
                      value={search} onChange={e => onSearch(e.target.value)} placeholder="Search VIN, make or model"
                    />
                  </div>
                </div>
                {filtered.length === 0 ? (
                  <div className="p-4">
                    <EmptyState compact title="No vehicle on this page matches your search">
                      <button type="button" className={WS_TEXT_ACTION} onClick={() => onSearch('')}>Clear search</button>
                    </EmptyState>
                  </div>
                ) : (
                  <ul className="divide-y divide-carup-line">
                    {filtered.map(v => {
                      const vis = visibilityOf(v)
                      const pre = precheckOf(v, pendingPrecheckVin)
                      const active = selected?.vin === v.vin
                      return (
                        <li key={v.vin}>
                          <button
                            type="button"
                            onClick={() => open(v.vin)}
                            aria-current={active ? 'true' : undefined}
                            data-testid={`dealer-ws-stock-row-${v.vin}`}
                            className={`${WS_ROW} relative px-4 py-3 ${active ? 'lg:bg-carup-bg-surface' : ''}`}
                          >
                            {active && <span aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-[3px] bg-carup-action lg:block" />}
                            <span className="flex items-start gap-3">
                              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-control bg-carup-bg-surface text-carup-text-2" aria-hidden="true">
                                <Car className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="line-clamp-2 text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{vehicleName(v)}</span>
                                <span className="block font-mono text-xs text-carup-text-3 [overflow-wrap:anywhere]">{v.vin}</span>
                                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <StatusChip tone={vis.tone} testId={`dealer-ws-visibility-${v.vin}`}>{vis.label}</StatusChip>
                                  <StatusChip tone={pre.tone}>{pre.label}</StatusChip>
                                  {v.listing_candidate_prepared && v.declared_price != null && (
                                    <span className="text-xs font-semibold text-carup-text-2">
                                      {v.declared_currency} {v.declared_price.toLocaleString('en-US')}
                                    </span>
                                  )}
                                </span>
                              </span>
                              <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-carup-text-3 lg:hidden" aria-hidden="true" />
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {selected && (
                <VehicleDetail
                  key={selected.vin}
                  vehicle={selected}
                  className={showDetailOnPhone ? '' : 'hidden lg:block'}
                  headingRef={detailRef}
                  listingRef={listingRef}
                  onBack={() => setPhoneDetail(false)}
                  onOpenListing={openListing}
                  {...{ edit, pendingPrecheckVin, openListingVin, onToggleListing, branches, userId, token, onRetry, onListingChanged }}
                  tenantId={inventory.owner_tenant_id}
                />
              )}
            </div>
          )}

          <p className="text-xs leading-5 text-carup-text-3">
            Publication, ownership evidence and per-VIN checks are controlled by CarUp's Seller Authority and
            Marketplace publication checks. This workspace can only prepare dealer-declared listing facts; it cannot
            publish an unverified car or verify its own documents.
          </p>
        </>
      )}
    </div>
  )
}

function VehicleDetail<V extends InventoryVehicleView>({
  vehicle: v, className, headingRef, listingRef, onBack, onOpenListing, edit, pendingPrecheckVin, openListingVin,
  onToggleListing, branches, userId, token, onRetry, onListingChanged, tenantId,
}: Pick<InventoryWorkspaceProps<V>, 'edit' | 'pendingPrecheckVin' | 'openListingVin' | 'onToggleListing' | 'branches' | 'userId' | 'token' | 'onRetry' | 'onListingChanged'> & {
  vehicle: V
  className: string
  headingRef: RefObject<HTMLHeadingElement | null>
  listingRef: RefObject<HTMLDivElement | null>
  onBack: () => void
  onOpenListing: (vin: string) => void
  tenantId: string
}) {
  const vis = visibilityOf(v)
  const pre = precheckOf(v, pendingPrecheckVin)
  const editable = isEditable(v)
  const editing = edit.vin === v.vin
  const precheckPending = pendingPrecheckVin === v.vin
  const needsCorrection = v.listing_structural_precheck.result === 'REQUIRES_DATA_CORRECTION'
  const listingOpen = openListingVin === v.vin
  const editButton = (
    <button type="button" onClick={() => edit.onBegin(v)} aria-label={'Edit private draft ' + v.vin} className={WS_SECONDARY}>
      Edit private draft details
    </button>
  )

  // ONE next step, from recorded fields only.
  let next: { key: string; title: string; body: ReactNode; action?: ReactNode }
  if (precheckPending) {
    next = {
      key: 'recheck', title: 'Re-run the data precheck',
      body: 'Your correction was saved. Structural listing eligibility has not been rechecked since the edit; reload when the inventory read is available. No publication rights are granted.',
      action: <button type="button" className={WS_SECONDARY} onClick={onRetry}>Reload inventory</button>,
    }
  } else if (needsCorrection && editable) {
    next = {
      key: 'edit', title: 'Correct the flagged data',
      body: "CarUp's existing Marketplace rules found missing or invalid listing data on this private draft.",
      action: editing ? undefined : editButton,
    }
  } else if (needsCorrection) {
    next = {
      key: 'blocked', title: 'Data needs correction before listing',
      body: "CarUp's existing Marketplace rules found missing or invalid listing data. Only private pending drafts can be corrected in Dealer OS.",
    }
  } else if (vis.key === 'public') {
    next = {
      key: 'public', title: 'Live on the Marketplace',
      body: 'Buyers can find this vehicle. You can remove it from public search in Marketplace checks at any time.',
      action: (
        <Link to={`/marketplace/listing/${v.vin}`} className={WS_SECONDARY}>
          View the public listing <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ),
    }
  } else if (vis.key === 'prepared') {
    next = {
      key: 'checks', title: "Complete CarUp's publication checks",
      body: 'Your listing facts are saved and still private. Open Marketplace checks to see what CarUp still needs, such as an ownership document for independent review.',
      action: !listingOpen ? <button type="button" className={WS_PRIMARY} onClick={() => onOpenListing(v.vin)}>Open Marketplace checks</button> : undefined,
    }
  } else {
    next = {
      key: 'prepare', title: 'Declare the listing facts',
      body: 'Add the price, branch, registration stage and buyer-facing location. They are saved as your declaration and stay private until CarUp\'s checks pass.',
      action: !listingOpen ? <button type="button" className={WS_PRIMARY} onClick={() => onOpenListing(v.vin)}>Open Marketplace checks</button> : undefined,
    }
  }

  return (
    <article
      aria-labelledby="dealer-ws-vehicle-title"
      data-testid={`dealer-ws-vehicle-${v.vin}`}
      className={`${WS_CARD} min-w-0 ${className}`}
    >
      <div className="border-b border-carup-line p-4 sm:p-5">
        <button type="button" onClick={onBack} className={`${WS_TEXT_ACTION} -ml-1 mb-1 lg:hidden`}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> All vehicles
        </button>
        <p className={WS_EYEBROW}>Vehicle</p>
        <h2 id="dealer-ws-vehicle-title" ref={headingRef} tabIndex={-1} className="mt-1 scroll-mt-36 text-xl font-bold tracking-[-0.02em] text-carup-text outline-none sm:text-2xl">
          {vehicleName(v)}
        </h2>
        <p className="mt-1 font-mono text-xs text-carup-text-2 [overflow-wrap:anywhere]">VIN {v.vin}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <StatusChip tone={vis.tone} testId="dealer-ws-vehicle-visibility">{vis.label}</StatusChip>
          <StatusChip tone={pre.tone}>{pre.label}</StatusChip>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <NextStep title={next.title} action={next.action} testId={`dealer-ws-next-step-${next.key}`}>{next.body}</NextStep>

        {editing ? (
          <section aria-labelledby="dealer-ws-edit-title" className="rounded-card border border-carup-line-strong p-4" data-testid="dealer-ws-edit-form">
            <h3 id="dealer-ws-edit-title" className={WS_SECTION_TITLE}>Correct private VIN draft</h3>
            <p className={WS_HINT}>
              VIN {v.vin} cannot change. Only make, model, model year and your odometer declaration are editable.
              Seller Authority, public listing, payment, title and duty verification stay unavailable here.
            </p>
            <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); edit.onSave() }}>
              <div>
                <label htmlFor="edit-private-make" className={WS_LABEL}>Manufacturer</label>
                <input id="edit-private-make" required minLength={2} maxLength={80} className={WS_FIELD}
                  value={edit.make} onChange={e => edit.setMake(e.target.value)} />
              </div>
              <div>
                <label htmlFor="edit-private-model" className={WS_LABEL}>Model</label>
                <input id="edit-private-model" required minLength={1} maxLength={100} className={WS_FIELD}
                  value={edit.model} onChange={e => edit.setModel(e.target.value)} />
              </div>
              <div>
                <label htmlFor="edit-private-year" className={WS_LABEL}>Model year</label>
                <input id="edit-private-year" required type="number" min={1950} max={new Date().getFullYear() + 1}
                  className={WS_FIELD} value={edit.year} onChange={e => edit.setYear(e.target.value)} />
              </div>
              <div>
                <label htmlFor="edit-private-mileage" className={WS_LABEL}>Odometer (km) · your declaration</label>
                <input id="edit-private-mileage" type="number" required min={0} max={2000000} step={1}
                  className={WS_FIELD} value={edit.mileage} onChange={e => edit.setMileage(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button type="submit" disabled={edit.saving} className={WS_PRIMARY}>
                  {edit.saving ? 'Saving…' : 'Save private draft correction'}
                </button>
                <button type="button" disabled={edit.saving} onClick={edit.onCancel} className={WS_SECONDARY}>Cancel correction</button>
              </div>
            </form>
            {edit.error && <div className="mt-3"><WorkspaceNotice tone="warning">{edit.error}</WorkspaceNotice></div>}
          </section>
        ) : (
          <section aria-labelledby="dealer-ws-facts-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="dealer-ws-facts-title" className={WS_SECTION_TITLE}>Recorded facts</h3>
              {editable && next.key !== 'edit' && editButton}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div><dt className={WS_DT}>Lifecycle</dt><dd className={WS_DD}>{v.recorded_lifecycle_state || 'Not recorded'}</dd></div>
              <div><dt className={WS_DT}>Marketplace publication</dt><dd className={WS_DD}>{v.recorded_marketplace_publication_state || 'Not recorded'}</dd></div>
              <div>
                <dt className={WS_DT}>Odometer · not verified</dt>
                <dd className={WS_DD}>{v.recorded_mileage == null ? 'Not recorded' : v.recorded_mileage.toLocaleString('en-US') + ' km'}</dd>
              </div>
              <div>
                <dt className={WS_DT}>Asking price · declared</dt>
                <dd className={WS_DD} data-testid={v.listing_candidate_prepared ? 'dealer-declared-price-' + v.vin : undefined}>
                  {v.listing_candidate_prepared && v.declared_price != null
                    ? `${v.declared_currency ?? ''} ${v.declared_price.toLocaleString('en-US')}`.trim()
                    : 'Not declared'}
                </dd>
              </div>
            </dl>
          </section>
        )}

        <section aria-labelledby="dealer-ws-precheck-title" className="border-t border-carup-line pt-4">
          <h3 id="dealer-ws-precheck-title" className={WS_SECTION_TITLE}>Structural listing precheck</h3>
          {precheckPending ? (
            <p className="mt-2 text-sm leading-6 text-status-warning" role="status">
              The private correction has been confirmed by the server. Structural listing eligibility has not been
              rechecked since the edit.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm leading-6 text-carup-text-2">
                {needsCorrection
                  ? 'The existing Marketplace rules identified missing or invalid listing data.'
                  : 'Recorded fields pass the existing Marketplace data-shape precheck.'}
              </p>
              {v.listing_structural_precheck.blocking_reason_codes.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Blocking reasons">
                  {v.listing_structural_precheck.blocking_reason_codes.map(code => (
                    <li key={code}><StatusChip tone="warning">{code.replaceAll('_', ' ')}</StatusChip></li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="mt-2 text-xs leading-5 text-carup-text-3">
            Seller Authority and Vehicle Passport review: not evaluated. This data check cannot publish, verify
            ownership or process a payment, even when no structural issues remain.
          </p>
        </section>

        <section aria-labelledby={`dealer-ws-listing-title-${v.vin}`} className="border-t border-carup-line pt-4">
          <div ref={listingRef} className="flex scroll-mt-28 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 id={`dealer-ws-listing-title-${v.vin}`} className={WS_SECTION_TITLE}>Marketplace checks</h3>
              <p className="mt-0.5 text-xs leading-5 text-carup-text-3">CarUp's own publication checks, incl. Seller Authority and independent document review.</p>
            </div>
            <button
              type="button"
              aria-expanded={listingOpen}
              aria-label={'Marketplace listing for ' + v.vin}
              onClick={() => onToggleListing(v.vin)}
              className={WS_SECONDARY}
            >
              {listingOpen ? 'Close Marketplace listing' : 'Marketplace listing'}
            </button>
          </div>
          {listingOpen && userId && token && (branches === null
            ? <p role="status" className="mt-3 text-sm text-carup-text-2">Loading your branches…</p>
            : <DealerVinListingPanel vin={v.vin} tenantId={tenantId} userId={userId} token={token} branches={branches} onChanged={onListingChanged} />)}
        </section>

        <section aria-labelledby="dealer-ws-photos-title" className="border-t border-carup-line pt-4">
          <h3 id="dealer-ws-photos-title" className={`flex items-center gap-2 ${WS_SECTION_TITLE}`}>
            <ImageOff className="h-4 w-4 text-carup-text-3" aria-hidden="true" /> Photos
          </h3>
          <p className="mt-1 text-sm leading-6 text-carup-text-2" data-testid="dealer-ws-vehicle-photos-unavailable">
            This inventory read does not include vehicle photographs, so none are shown here. Ownership documents
            you send in Marketplace checks are received privately for independent review — they are not photos for buyers.
          </p>
        </section>

        <p className="text-xs leading-5 text-carup-text-3">
          Tenant association does not prove current seller authority, legal title, import duty clearance,
          buyer-trust approval or physical branch location.
        </p>
      </div>
    </article>
  )
}
