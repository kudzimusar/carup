/**
 * RX04-C2 — PartSentry, unified presentation.
 *
 * One car at a time: its ledger integrity (from the page's own verify-ledger read), the entries
 * read from /partsentry/:vin (newest first, as the server orders them), and the existing
 * "log a repair" form. The container keeps every read, validation rule and write; this view only
 * presents them.
 *
 * Truth rules kept here:
 *  - integrity is shown only for the car it was checked for; a failed check is "Verification
 *    unavailable", never a pass; a passed check with no entries says so;
 *  - an entry with no review status is "Unreviewed" (dashed, not established), never verified;
 *  - a failed history read is an error state, never an empty ledger;
 *  - every figure is derived from the rows read: nothing is projected or estimated.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Copy, Loader2, Lock, Plus, ShieldAlert, ShieldCheck, ShieldQuestion, UserCheck, Wrench } from 'lucide-react'
import type { Vehicle } from '@/types'
import { DataState } from '@/components/truth'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION, OwnerPageHeader } from '@/components/owner/OwnerPageHeader'
import { StatusChip } from './CompanionParts'
import { passportHref, plural, recordedAmount, recordedDate, reviewStatus, vehicleName } from './companionFormat'

export type PartSentryEntry = {
  id: string | number
  vin: string
  part_name: string
  part_oem?: string
  action_type: string
  mileage: number
  timestamp: string
  verification_status?: string
}

export type LedgerIntegrity = 'checking' | 'verified' | 'failed' | 'unavailable'

export type RepairFormValues = {
  vin: string
  partName: string
  actionType: string
  description: string
  mileage: string
  partOem: string
}

const FIELD = `min-h-11 w-full rounded-control bg-carup-bg-raised px-3 text-[14px] text-carup-text ring-1 ring-carup-line placeholder:text-carup-text-3 ${OWNER_FOCUS}`
const LABEL = 'mb-1.5 block text-[13px] font-semibold text-carup-text'

function IntegrityPill({ state, entries }: { state: LedgerIntegrity; entries: number | null }) {
  const base = 'inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold'
  if (state === 'verified') {
    return (
      <span className={`${base} bg-status-success-soft text-status-success`} data-testid="partsentry-integrity" data-state="verified">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Integrity check passed{entries === 0 ? ' · no entries yet' : ''}
      </span>
    )
  }
  if (state === 'failed') {
    return (
      <span className={`${base} bg-status-danger-soft text-status-danger`} data-testid="partsentry-integrity" data-state="failed">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Integrity check failed
      </span>
    )
  }
  if (state === 'unavailable') {
    return (
      <span className={`${base} bg-status-warning-soft text-status-warning`} data-testid="partsentry-integrity" data-state="unavailable">
        <ShieldQuestion className="h-4 w-4" aria-hidden="true" /> Verification unavailable
      </span>
    )
  }
  return (
    <span className={`${base} text-white/70 ring-1 ring-white/25`} data-testid="partsentry-integrity" data-state="checking" role="status">
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Checking ledger integrity…
    </span>
  )
}

function LedgerEntry({ entry, copied, onCopy }: { entry: PartSentryEntry; copied: boolean; onCopy: (value: string) => void }) {
  const date = recordedDate(entry.timestamp)
  const mileage = recordedAmount(entry.mileage)
  const review = reviewStatus(entry.verification_status)
  // Owners read the full row (`select *`), which carries the work description they or the mechanic wrote.
  const rawDescription = (entry as { description?: unknown }).description
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : ''
  return (
    <li
      className="grid gap-x-4 gap-y-2 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_7rem_7.5rem_8rem] md:items-center"
      data-testid={`part-row-${entry.id}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Wrench className="h-4 w-4 shrink-0 text-carup-action-hover" aria-hidden="true" />
          <p className="min-w-0 text-[15px] font-semibold text-carup-text">{entry.part_name || <span className="italic text-carup-text-3">Part not named</span>}</p>
          <span className="rounded-full bg-carup-bg-surface px-2.5 py-0.5 text-[12px] font-semibold text-carup-text-2">{entry.action_type || 'Action not recorded'}</span>
        </div>
        {description && <p className="mt-1 text-[13px] leading-5 text-carup-text-2">{description}</p>}
      </div>
      <div className="min-w-0">
        <span className="text-[12px] text-carup-text-3 md:sr-only">OEM number </span>
        {entry.part_oem ? (
          <button
            type="button"
            onClick={() => onCopy(entry.part_oem!)}
            className={`inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-control px-1 font-mono text-[12px] text-carup-text hover:text-carup-action-hover md:min-h-9 ${OWNER_FOCUS}`}
            aria-label={`Copy OEM number ${entry.part_oem}`}
          >
            <span className="break-all">{entry.part_oem}</span>
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-status-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-carup-text-3" aria-hidden="true" />}
          </button>
        ) : (
          <span className="text-[13px] italic text-carup-text-3">Not recorded</span>
        )}
      </div>
      {/* Phone: odometer, date and review share one line; from md each is its own column (md:contents). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 md:contents">
        <p className="text-[13px] tabular-nums text-carup-text-2">
          <span className="text-carup-text-3 md:sr-only">Odometer </span>
          {mileage !== null ? `${mileage.toLocaleString()} km` : <span className="italic text-carup-text-3">Not recorded</span>}
        </p>
        <p className="text-[13px] tabular-nums text-carup-text-2">
          <span className="sr-only">Date </span>
          {date ? <time dateTime={date.iso}>{date.label}</time> : <span className="italic text-carup-text-3">Date not recorded</span>}
        </p>
        <div className="ml-auto md:ml-0 md:text-right">
          <StatusChip tone={review.tone}>{review.label}</StatusChip>
        </div>
      </div>
    </li>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-white/70">{label}</dt>
      <dd className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.01em]">{children}</dd>
    </div>
  )
}

function LogRepairDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  actionTypes,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: RepairFormValues
  onFormChange: (patch: Partial<RepairFormValues>) => void
  actionTypes: readonly string[]
  submitting: boolean
  onSubmit: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-card border-carup-line bg-carup-bg-raised text-carup-text sm:max-w-lg" data-testid="partsentry-log-dialog">
        <DialogHeader>
          <DialogTitle className="text-[19px] font-semibold tracking-[-0.01em] text-carup-text">Log a repair</DialogTitle>
          <DialogDescription className="text-[14px] leading-6 text-carup-text-2">
            This entry is written permanently to the car&rsquo;s PartSentry ledger, and the odometer reading you enter is recorded against the car.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={e => { e.preventDefault(); onSubmit() }}
        >
          <div>
            <label htmlFor="ps-vin" className={LABEL}>Vehicle VIN</label>
            <input id="ps-vin" value={form.vin} onChange={e => onFormChange({ vin: e.target.value })} className={`${FIELD} font-mono`} placeholder="17-character VIN" autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ps-part" className={LABEL}>Part name <span className="text-carup-text-3">(required)</span></label>
              <input id="ps-part" value={form.partName} onChange={e => onFormChange({ partName: e.target.value })} className={FIELD} placeholder="e.g. Brake pads" />
            </div>
            <div>
              <label htmlFor="ps-action" className={LABEL}>What was done <span className="text-carup-text-3">(required)</span></label>
              <select id="ps-action" value={form.actionType} onChange={e => onFormChange({ actionType: e.target.value })} className={FIELD}>
                {actionTypes.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ps-mileage" className={LABEL}>Odometer, km <span className="text-carup-text-3">(required)</span></label>
              <input id="ps-mileage" type="number" inputMode="numeric" min={0} value={form.mileage} onChange={e => onFormChange({ mileage: e.target.value })} className={`${FIELD} tabular-nums`} placeholder="e.g. 54000" />
            </div>
            <div>
              <label htmlFor="ps-oem" className={LABEL}>OEM part number <span className="text-carup-text-3">(optional)</span></label>
              <input id="ps-oem" value={form.partOem} onChange={e => onFormChange({ partOem: e.target.value })} className={`${FIELD} font-mono`} placeholder="e.g. 04465-0K040" />
            </div>
          </div>
          <div>
            <label htmlFor="ps-description" className={LABEL}>Work done <span className="text-carup-text-3">(required)</span></label>
            <textarea
              id="ps-description"
              value={form.description}
              onChange={e => onFormChange({ description: e.target.value })}
              rows={3}
              placeholder="Describe the repair — this is the record a future buyer will rely on."
              className={`${FIELD} resize-none py-2.5 leading-6`}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => onOpenChange(false)} disabled={submitting} className={`${OWNER_SECONDARY_ACTION} justify-center disabled:opacity-50`}>Cancel</button>
            <button type="submit" disabled={submitting} className={`${OWNER_PRIMARY_ACTION} justify-center disabled:opacity-60`} data-testid="partsentry-log-submit">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Recording…</> : <><Lock className="h-4 w-4" aria-hidden="true" /> Write to the ledger</>}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PartSentryView({
  vehicles,
  vehiclesState,
  onRetryVehicles,
  selectedVin,
  onSelectVin,
  entries,
  historyLoading,
  historyError,
  onRetryHistory,
  integrity,
  copiedValue,
  onCopy,
  dialogOpen,
  onDialogOpenChange,
  form,
  onFormChange,
  actionTypes,
  submitting,
  onSubmit,
}: {
  vehicles: Vehicle[]
  vehiclesState: 'loading' | 'ready' | 'error'
  onRetryVehicles: () => void
  selectedVin: string
  onSelectVin: (vin: string) => void
  entries: PartSentryEntry[]
  historyLoading: boolean
  historyError: string | null
  onRetryHistory: () => void
  integrity: LedgerIntegrity
  copiedValue: string | null
  onCopy: (value: string) => void
  dialogOpen: boolean
  onDialogOpenChange: (open: boolean) => void
  form: RepairFormValues
  onFormChange: (patch: Partial<RepairFormValues>) => void
  actionTypes: readonly string[]
  submitting: boolean
  onSubmit: () => void
}) {
  const selected = vehicles.find(v => v.vin === selectedVin) ?? null
  const historyRead = !historyLoading && !historyError
  const replaced = entries.filter(r => r.action_type === 'Replaced').length
  const checks = entries.filter(r => r.action_type === 'Inspected' || r.action_type === 'Diagnosed').length
  const latest = entries.map(r => recordedDate(r.timestamp)).filter(Boolean).sort((a, b) => b!.time - a!.time)[0] ?? null
  const fact = (value: ReactNode) => (historyRead ? value : historyLoading ? '…' : <span className="text-[14px] font-medium text-white/70">Not read</span>)
  const openLog = () => onDialogOpenChange(true)

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6" data-testid="partsentry-unified" data-presentation="rx04">
      <OwnerPageHeader
        title="PartSentry"
        description="A permanent, tamper-evident ledger of the parts fitted and repairs done on each of your cars — checked for integrity each time you open it."
        meta={vehiclesState === 'ready' && vehicles.length > 0 ? plural(vehicles.length, 'car') : undefined}
        actions={(
          <button type="button" onClick={openLog} className={OWNER_PRIMARY_ACTION} data-testid="partsentry-log-open">
            <Plus className="h-4 w-4" aria-hidden="true" /> Log a repair
          </button>
        )}
      />

      {vehiclesState === 'loading' && <DataState state="loading" subject="Your cars" />}
      {vehiclesState === 'error' && (
        <DataState
          state="error"
          subject="PartSentry"
          description="Your cars could not be read, so no ledger is shown. This is not an empty ledger."
          action={{ label: 'Try again', onClick: onRetryVehicles }}
        />
      )}

      {vehiclesState === 'ready' && vehicles.length === 0 && (
        <section className="rounded-card bg-carup-raw-ink px-6 py-10 text-white sm:px-10" data-testid="partsentry-no-cars">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">PartSentry</p>
          <h2 className="mt-2 text-[22px] font-bold tracking-[-0.02em]">No car to keep a ledger for yet</h2>
          <p className="mt-2 max-w-lg text-[15px] leading-6 text-white/75">Each car you own gets its own parts and repair ledger. Add a car to start one.</p>
          <Link to="/sell" className={`${OWNER_PRIMARY_ACTION} mt-5`}>Add a car <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section>
      )}

      {vehiclesState === 'ready' && vehicles.length > 0 && (
        <>
          {vehicles.length > 1 && (
            <div role="group" aria-label="Choose a car" className="carup-rail -mx-4 flex scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" data-testid="partsentry-car-switcher">
              {vehicles.map(v => {
                const active = v.vin === selectedVin
                return (
                  <button
                    key={v.vin}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectVin(v.vin)}
                    className={`flex min-h-14 shrink-0 flex-col items-start justify-center rounded-control px-4 py-2 text-left ring-1 transition ${OWNER_FOCUS} ${active ? 'bg-carup-raw-ink text-white ring-carup-raw-ink' : 'bg-carup-bg-raised text-carup-text ring-carup-line hover:ring-carup-text-3'}`}
                  >
                    <span className="text-[14px] font-semibold">{vehicleName(v)}</span>
                    <span className={`font-mono text-[11px] ${active ? 'text-white/70' : 'text-carup-text-3'}`}>{v.vin}</span>
                  </button>
                )
              })}
            </div>
          )}

          <section aria-labelledby="partsentry-car-title" className="rounded-card bg-carup-raw-ink p-5 text-white sm:p-7" data-testid="partsentry-ledger-hero">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">PartSentry ledger</p>
                <h2 id="partsentry-car-title" className="mt-1 text-[clamp(1.25rem,2.2vw,1.6rem)] font-semibold tracking-[-0.02em]">{vehicleName(selected)}</h2>
                <p className="break-all font-mono text-[12px] text-white/70">VIN {selectedVin || 'not selected'}</p>
              </div>
              <IntegrityPill state={integrity} entries={historyRead ? entries.length : null} />
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/15 pt-5 sm:grid-cols-4">
              <Fact label="Entries">{fact(entries.length)}</Fact>
              <Fact label="Parts replaced">{fact(replaced)}</Fact>
              <Fact label="Inspections & diagnoses">{fact(checks)}</Fact>
              <Fact label="Latest entry">{fact(latest ? <time dateTime={latest.iso} className="text-[17px]">{latest.label}</time> : <span className="text-[14px] font-medium text-white/70">None yet</span>)}</Fact>
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={openLog} className={OWNER_PRIMARY_ACTION}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Log a repair on this car
              </button>
              {selectedVin && (
                <Link to={passportHref(selectedVin)} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10 ${OWNER_FOCUS}`}>
                  Open Passport <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </div>
          </section>

          <section aria-labelledby="partsentry-entries-title">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="partsentry-entries-title" className="text-[17px] font-semibold tracking-[-0.01em] text-carup-text">
                Ledger entries {historyRead && <span className="ml-1 text-[13px] font-medium tabular-nums text-carup-text-3">{entries.length}</span>}
              </h2>
              {historyRead && entries.length > 0 && <span className="text-[12px] text-carup-text-3">Newest first</span>}
            </div>

            {historyLoading ? (
              <DataState state="loading" subject="Ledger entries" />
            ) : historyError ? (
              <div data-testid="parts-ledger-error">
                <DataState
                  state="error"
                  subject="Ledger entries"
                  description={<>The repair history for this car could not be read, so no entries are shown. This is not an empty ledger.<span className="mt-1 block text-[12px] text-carup-text-3">{historyError}</span></>}
                  action={{ label: 'Retry', onClick: onRetryHistory }}
                />
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-card bg-carup-bg-raised p-5 ring-1 ring-carup-line sm:p-6" data-testid="parts-ledger-empty">
                <p className="text-[15px] font-semibold text-carup-text">Nothing recorded on this car&rsquo;s ledger yet</p>
                <p className="mt-1 max-w-xl text-[14px] leading-6 text-carup-text-2">Log a part you replaced or a repair you had done, with the odometer reading at the time. It stays on the ledger permanently.</p>
                <button type="button" onClick={openLog} className={`${OWNER_SECONDARY_ACTION} mt-4`}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Log the first repair
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line">
                <div className="hidden border-b border-carup-line px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3 md:grid md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_7rem_7.5rem_8rem] md:gap-x-4" aria-hidden="true">
                  <span>Part &amp; work</span><span>OEM number</span><span>Odometer</span><span>Date</span><span className="text-right">Review</span>
                </div>
                <ol className="divide-y divide-carup-line" data-testid="owner-parts-table" aria-label="Ledger entries, newest first">
                  {entries.map(entry => <LedgerEntry key={entry.id} entry={entry} copied={copiedValue === entry.part_oem} onCopy={onCopy} />)}
                </ol>
              </div>
            )}
          </section>

          <section aria-labelledby="partsentry-how-title" className="rounded-card bg-carup-bg-surface p-5 sm:p-6" data-testid="partsentry-how">
            <h2 id="partsentry-how-title" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">How the ledger works</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-3">
              <li className="flex gap-3">
                <Lock className="mt-0.5 h-5 w-5 shrink-0 text-carup-action-hover" aria-hidden="true" />
                <div>
                  <p className="text-[14px] font-semibold text-carup-text">Permanent</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-carup-text-2">Each entry is written to the car&rsquo;s ledger for good, and its integrity is re-checked when you open this page.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-carup-action-hover" aria-hidden="true" />
                <div>
                  <p className="text-[14px] font-semibold text-carup-text">Who can write</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-carup-text-2">The car&rsquo;s owner, an authorised dealer or a certified mechanic. Anyone else is refused.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-carup-action-hover" aria-hidden="true" />
                <div>
                  <p className="text-[14px] font-semibold text-carup-text">Reviewed or not</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-carup-text-2">&ldquo;Unreviewed&rdquo; means the entry carries no review status yet. Only a recorded review shows as verified.</p>
                </div>
              </li>
            </ul>
          </section>
        </>
      )}

      <LogRepairDialog
        open={dialogOpen}
        onOpenChange={onDialogOpenChange}
        form={form}
        onFormChange={onFormChange}
        actionTypes={actionTypes}
        submitting={submitting}
        onSubmit={onSubmit}
      />
    </div>
  )
}
