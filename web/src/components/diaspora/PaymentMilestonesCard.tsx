import { useMemo, useState } from 'react'
import { ClipboardCheck, Loader2, Plus, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Payment-milestone recording card, shared by the import-order detail page and the Order Passport.
 *
 * A milestone is a NON-CUSTODIAL reference record — the buyer/seller declaring an off-platform
 * payment step happened or is due. CarUp never moves money here. Any user with access to the order
 * (owner/participant/tenant-admin/reviewer) may record one; the backend is the authority boundary
 * (authorization, PENDING-only status for non-privileged callers, cumulative-amount cap vs the
 * accepted quote or order budget, idempotency). Submissions carry a per-submit idempotency key and
 * an inline confirm step, so a double-click or retry cannot create a duplicate financial record.
 */

const MILESTONE_TYPE_OPTIONS = [
  { value: 'DEPOSIT', label: 'Deposit' },
  { value: 'BALANCE_DUE', label: 'Balance due' },
  { value: 'SHIPPING_FEE', label: 'Shipping fee' },
  { value: 'CUSTOMS_DUTY', label: 'Customs duty' },
  { value: 'FINAL_PAYMENT', label: 'Final payment' },
  { value: 'OTHER', label: 'Other' },
]

const ACTIVE_STATUSES = new Set(['PENDING', 'CONFIRMED'])

export interface MilestoneLike {
  id: string
  milestone_type?: string | null
  amount?: number | string | null
  currency?: string | null
  status?: string | null
  due_date?: string | null
}

export interface QuoteLike {
  id: string
  status?: string | null
  quote_amount?: number | string | null
  quote_currency?: string | null
}

interface PaymentMilestonesCardProps {
  orderId: string
  milestones: MilestoneLike[]
  quotes?: QuoteLike[]
  budgetAmount?: number | string | null
  budgetCurrency?: string | null
  onRefresh: () => Promise<void>
  defaultOpen?: boolean
}

function humanizeMilestone(value?: string | null) {
  if (!value) return '—'
  return value.toLowerCase().split('_').map(part => (part ? part[0].toUpperCase() + part.slice(1) : part)).join(' ')
}

// Per-submit idempotency key so a retried/double-clicked submission cannot create a duplicate
// financial reference record (backend de-dupes on (import_order_id, idempotency_key)).
function genMilestoneKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function formatAmount(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PaymentMilestonesCard({ orderId, milestones, quotes = [], budgetAmount, budgetCurrency, onRefresh, defaultOpen = false }: PaymentMilestonesCardProps) {
  const { addDiasporaPaymentMilestone } = useCarUpApi()
  const [open, setOpen] = useState(defaultOpen)
  const [milestoneType, setMilestoneType] = useState('DEPOSIT')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(budgetCurrency || 'USD')
  const [reference, setReference] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [actionError, setActionError] = useState('')

  // Cap resolution mirrors the backend: an ACCEPTED quote's amount if one exists, else the order
  // budget. Totals count only active (PENDING/CONFIRMED) milestones, summed per currency.
  const { totalsByCurrency, cap } = useMemo(() => {
    const totals = new Map<string, number>()
    for (const m of milestones) {
      const status = String(m.status || '').toUpperCase()
      if (!ACTIVE_STATUSES.has(status)) continue
      const cur = (m.currency || 'USD').toUpperCase()
      const amt = Number(m.amount)
      if (!Number.isFinite(amt)) continue
      totals.set(cur, (totals.get(cur) || 0) + amt)
    }
    const acceptedQuote = quotes.find(q => String(q.status || '').toUpperCase() === 'ACCEPTED')
    let resolvedCap: { amount: number; currency: string; source: string } | null = null
    if (acceptedQuote && Number.isFinite(Number(acceptedQuote.quote_amount))) {
      resolvedCap = { amount: Number(acceptedQuote.quote_amount), currency: (acceptedQuote.quote_currency || 'USD').toUpperCase(), source: 'accepted quote' }
    } else if (budgetAmount != null && Number.isFinite(Number(budgetAmount))) {
      resolvedCap = { amount: Number(budgetAmount), currency: (budgetCurrency || 'USD').toUpperCase(), source: 'order budget' }
    }
    return { totalsByCurrency: totals, cap: resolvedCap }
  }, [milestones, quotes, budgetAmount, budgetCurrency])

  const remaining = cap ? cap.amount - (totalsByCurrency.get(cap.currency) || 0) : null

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
      await addDiasporaPaymentMilestone(orderId, {
        milestone_type: milestoneType,
        amount: numericAmount,
        currency: currency.trim().toUpperCase() || 'USD',
        external_reference: reference.trim() || undefined,
        idempotency_key: genMilestoneKey(),
      })
      setResult('Milestone recorded (reference only — no payment was processed).')
      setAmount('')
      setReference('')
      await onRefresh()
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Could not record milestone'
      setActionError(message.length > 220 ? `${message.slice(0, 220)}…` : message)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white" data-testid="diaspora-order-payment-milestones">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        data-testid="diaspora-milestones-toggle"
      >
        <span className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <ClipboardCheck className="h-4 w-4 text-orange-600" /> Payment milestones
          {milestones.length > 0 && <Badge variant="secondary">{milestones.length}</Badge>}
        </span>
        <span className="text-sm text-orange-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4">
          <Alert className="border-blue-200 bg-blue-50" data-testid="diaspora-milestones-noncustodial-notice">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              Milestones are a record only. CarUp does not hold, transfer, or process any funds for
              these payments — arrange and settle them directly with your counterparty.
            </AlertDescription>
          </Alert>

          {milestones.length > 0 ? (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-100" data-testid="diaspora-milestones-list">
              {milestones.map(m => (
                <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm" data-testid="diaspora-milestone-row">
                  <span className="font-medium text-gray-900">{humanizeMilestone(m.milestone_type)}</span>
                  <span className="text-gray-600">{m.currency} {m.amount}</span>
                  <Badge variant="outline">{m.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500" data-testid="diaspora-milestones-empty">No payment milestones recorded yet.</p>
          )}

          {/* Totals + remaining balance vs the accepted quote / budget cap */}
          <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700" data-testid="diaspora-milestones-totals" aria-live="polite">
            {totalsByCurrency.size === 0
              ? <span>No active (pending/confirmed) milestone amounts yet.</span>
              : [...totalsByCurrency.entries()].map(([cur, total]) => (
                  <div key={cur} className="flex flex-wrap items-center justify-between gap-2">
                    <span>Active total: <span className="font-medium">{formatAmount(total, cur)}</span></span>
                    {cap && cap.currency === cur && remaining != null && (
                      <span data-testid="diaspora-milestones-remaining">
                        Remaining vs {cap.source} ({formatAmount(cap.amount, cap.currency)}):{' '}
                        <span className={remaining < 0 ? 'font-medium text-red-700' : 'font-medium text-green-700'}>
                          {formatAmount(remaining, cap.currency)}
                        </span>
                      </span>
                    )}
                  </div>
                ))}
            {cap && totalsByCurrency.size === 0 && (
              <div data-testid="diaspora-milestones-remaining">
                Remaining vs {cap.source}: <span className="font-medium">{formatAmount(cap.amount, cap.currency)}</span>
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm text-gray-700">
              Milestone type
              <select
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={milestoneType}
                onChange={event => { setMilestoneType(event.target.value); setConfirming(false) }}
                data-testid="diaspora-milestone-type"
              >
                {MILESTONE_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700">
              Amount
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={event => { setAmount(event.target.value); setConfirming(false) }}
                className="mt-1"
                data-testid="diaspora-milestone-amount"
              />
            </label>
            <label className="text-sm text-gray-700">
              Currency
              <Input
                value={currency}
                onChange={event => { setCurrency(event.target.value); setConfirming(false) }}
                className="mt-1"
                maxLength={3}
                data-testid="diaspora-milestone-currency"
              />
            </label>
            <label className="text-sm text-gray-700">
              Reference (optional)
              <Input
                value={reference}
                onChange={event => setReference(event.target.value)}
                className="mt-1"
                placeholder="e.g. bank transfer id"
                data-testid="diaspora-milestone-reference"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !amount.trim()}
              onClick={submit}
              data-testid="diaspora-milestone-submit"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {confirming ? `Confirm ${currency.trim().toUpperCase() || 'USD'} ${amount || '0'} ${humanizeMilestone(milestoneType)}` : 'Record milestone'}
            </Button>
            {confirming && (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} data-testid="diaspora-milestone-cancel-confirm">
                Cancel
              </Button>
            )}
          </div>

          <p aria-live="polite" className="text-sm">
            {result && <span className="font-medium text-green-700" data-testid="diaspora-milestone-result">{result}</span>}
            {actionError && <span className="font-medium text-red-700" data-testid="diaspora-milestone-error">{actionError}</span>}
          </p>
        </div>
      )}
    </div>
  )
}
