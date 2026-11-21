/**
 * RX-06 — Import Order › Payments. Payment milestones are NON-CUSTODIAL reference records: the buyer
 * or seller declares an off-platform payment step; CarUp never holds, moves or settles money here and
 * live payments are off. Same behaviour as the shared PaymentMilestonesCard: active totals per
 * currency, the cap (an accepted quote, else the budget) and what remains, an explicit confirm step,
 * and a fresh idempotency key per submission so a retry cannot duplicate a financial record.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import { WS_FIELD, WS_LABEL, WS_PRIMARY, WS_SECONDARY, WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import {
  MILESTONE_TYPE_OPTIONS,
  formatAmount,
  formatDay,
  milestonePayload,
  milestoneSummary,
  money,
  orderHref,
  recordStatusTone,
  sentence,
  timeOf,
  type TradeOrder,
} from './orderModel'
import type { ImportOrderActions, TradeViewer } from './orderViewTypes'
import { NotRecorded, Panel, Provenance } from './TradeKit'

export function OrderPaymentsPanel({ order, actions }: { order: TradeOrder; viewer: TradeViewer; actions?: ImportOrderActions }) {
  const milestones = [...(order.diaspora_payment_milestones ?? [])].sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0))
  const summary = milestoneSummary(milestones, order.diaspora_import_quotes, order.budget_amount, order.budget_currency)
  return (
    <div className="space-y-5" data-testid="trade-payments">
      <section className="rounded-card border border-carup-line-strong bg-carup-bg-raised p-4 sm:p-5" aria-labelledby="trade-payments-mode-title" data-testid="trade-payments-mode">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-carup-text-3" aria-hidden="true" />
          <h2 id="trade-payments-mode-title" className="text-base font-semibold text-carup-text">Payment mode</h2>
          <StatusChip tone="neutral" testId="trade-payments-live">Live payments: off</StatusChip>
          <StatusChip tone="info" testId="trade-payments-recording">Reference records only</StatusChip>
        </div>
        <p className="mt-2 text-sm leading-6 text-carup-text-2" data-testid="diaspora-milestones-noncustodial-notice">
          Milestones are a record only. CarUp does not hold, transfer or process any money for import orders, and live payment (LIVE_PAYMENT) is not switched on — arrange and settle payments directly with your counterparty. Sandbox payment simulation exists only inside SafeTrade, and is labelled there.
        </p>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="Payment milestones" eyebrow={`${milestones.length} recorded`} testId="diaspora-order-payment-milestones">
          {milestones.length === 0 ? (
            <p className="text-sm text-carup-text-2" data-testid="diaspora-milestones-empty">No payment milestones recorded yet.</p>
          ) : (
            <ul className="divide-y divide-carup-line" data-testid="diaspora-milestones-list">
              {milestones.map(m => (
                <li key={m.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4" data-testid="diaspora-milestone-row">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-carup-text">{sentence(m.milestone_type, 'Milestone')}</p>
                    <p className="text-xs text-carup-text-3">
                      Recorded {formatDay(m.created_at) ?? 'on a date not recorded'}
                      {m.due_date ? ` · due ${formatDay(m.due_date) ?? m.due_date}` : ''}
                      {m.external_reference ? <> · ref <code className="font-mono">{m.external_reference}</code></> : null}
                    </p>
                  </div>
                  <p className="text-base font-bold tabular-nums text-carup-text">{money(m.amount, m.currency) ?? <NotRecorded>Amount not recorded</NotRecorded>}</p>
                  <StatusChip tone={recordStatusTone(m.status)}>{sentence(m.status)}</StatusChip>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 rounded-control bg-carup-bg-surface px-3 py-2.5 text-sm text-carup-text-2" data-testid="diaspora-milestones-totals" aria-live="polite">
            {summary.totals.length === 0
              ? <p>No active (pending or confirmed) milestone amounts yet.</p>
              : summary.totals.map(t => (
                <p key={t.currency} className="flex flex-wrap items-center justify-between gap-2">
                  <span>Active total: <span className="font-semibold text-carup-text">{formatAmount(t.total, t.currency)}</span></span>
                  {summary.cap && summary.cap.currency === t.currency && summary.remaining !== null && (
                    <span data-testid="diaspora-milestones-remaining">
                      Remaining vs {summary.cap.source} ({formatAmount(summary.cap.amount, summary.cap.currency)}):{' '}
                      <span className={cn('font-semibold', summary.remaining < 0 ? 'text-status-danger' : 'text-carup-text')}>{formatAmount(summary.remaining, summary.cap.currency)}</span>
                    </span>
                  )}
                </p>
              ))}
            {summary.cap && summary.totals.length === 0 && (
              <p data-testid="diaspora-milestones-remaining">Remaining vs {summary.cap.source}: <span className="font-semibold text-carup-text">{formatAmount(summary.cap.amount, summary.cap.currency)}</span></p>
            )}
            {!summary.cap && <p className="mt-1 text-xs text-carup-text-3">No accepted quote or budget is recorded, so there is no cap to compare against.</p>}
          </div>
        </Panel>
        {actions?.recordMilestone ? (
          <RecordMilestone order={order} record={actions.recordMilestone} />
        ) : (
          <Panel title="Record a milestone" testId="trade-milestone-unavailable"><p className="text-sm text-carup-text-2">Recording is not available in this view.</p></Panel>
        )}
      </div>
      <p className="text-xs text-carup-text-3">The cap follows an accepted quote (see <Link className={cn(WS_TEXT_ACTION, 'min-h-0 px-0 text-xs')} to={orderHref(order.id, 'quotes')}>Quotes</Link>) or, without one, the budget on the request.</p>
    </div>
  )
}

function RecordMilestone({ order, record }: { order: TradeOrder; record: NonNullable<ImportOrderActions['recordMilestone']> }) {
  const [milestoneType, setMilestoneType] = useState('DEPOSIT')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(order.budget_currency || 'USD')
  const [reference, setReference] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [actionError, setActionError] = useState('')
  const typeLabel = MILESTONE_TYPE_OPTIONS.find(o => o.value === milestoneType)?.label ?? milestoneType

  const submit = async () => {
    if (busy) return
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setActionError('Enter a positive amount.')
      setConfirming(false)
      return
    }
    if (!confirming) {
      setActionError('')
      setResult('')
      setConfirming(true)
      return
    }
    setBusy(true)
    setResult('')
    setActionError('')
    try {
      await record(milestonePayload({ milestoneType, amount: numericAmount, currency, reference }))
      setResult('Milestone recorded (reference only — no payment was processed).')
      setAmount('')
      setReference('')
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Could not record milestone'
      setActionError(message.length > 220 ? `${message.slice(0, 220)}…` : message)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <Panel title="Record a milestone" eyebrow="A reference, not a payment" testId="trade-record-milestone">
      <div className="space-y-3">
        <label className="block"><span className={WS_LABEL}>Milestone type</span>
          <select className={WS_FIELD} value={milestoneType} onChange={e => { setMilestoneType(e.target.value); setConfirming(false) }} data-testid="diaspora-milestone-type">
            {MILESTONE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <label className="block min-w-0"><span className={WS_LABEL}>Amount</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" className={WS_FIELD} value={amount} onChange={e => { setAmount(e.target.value); setConfirming(false) }} data-testid="diaspora-milestone-amount" />
          </label>
          <label className="block"><span className={WS_LABEL}>Currency</span>
            <input className={cn(WS_FIELD, 'uppercase')} maxLength={3} value={currency} onChange={e => { setCurrency(e.target.value); setConfirming(false) }} data-testid="diaspora-milestone-currency" />
          </label>
        </div>
        <label className="block"><span className={WS_LABEL}>Reference (optional)</span>
          <input className={WS_FIELD} value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. bank transfer id" data-testid="diaspora-milestone-reference" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={WS_PRIMARY} disabled={busy || !amount.trim()} onClick={submit} data-testid="diaspora-milestone-submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {confirming ? `Confirm ${currency.trim().toUpperCase() || 'USD'} ${amount || '0'} ${typeLabel}` : 'Record milestone'}
          </button>
          {confirming && <button type="button" className={WS_SECONDARY} onClick={() => setConfirming(false)} data-testid="diaspora-milestone-cancel-confirm">Cancel</button>}
        </div>
        {confirming && <p className="text-xs text-carup-text-2"><Provenance kind="stated">Declared by your account</Provenance> Recording does not move money.</p>}
        <div aria-live="polite" className="space-y-2">
          {result && <WorkspaceNotice testId="diaspora-milestone-result">{result}</WorkspaceNotice>}
          {actionError && <WorkspaceNotice tone="danger" testId="diaspora-milestone-error">{actionError}</WorkspaceNotice>}
        </div>
      </div>
    </Panel>
  )
}
