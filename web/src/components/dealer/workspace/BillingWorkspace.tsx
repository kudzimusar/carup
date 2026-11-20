/**
 * RX05-C — Dealer OS · Billing readiness (unified presentation of /dealers/billing).
 *
 * Presentation only: `DealerBillingReadiness` keeps the single read of /dealer/commercial-readiness.
 * Nothing here can start, imply or simulate a payment: there is no plan picker, price, checkout or
 * "Pay" control. Live payments are always shown as NOT active, and the readiness checklist lists the
 * recorded activation requirements without claiming any of them is met.
 */
import { Circle, CreditCard, Landmark, Receipt, ShieldOff } from 'lucide-react'
import { dealerDate } from '@/lib/dealerDates'
import { DealerObjectHeader } from './DealerObjectHeader'
import { EmptyState } from './EmptyState'
import { StatusChip } from './StatusChip'
import { humanizeCode } from './format'
import { WS_CARD, WS_EYEBROW, WS_HINT, WS_SECTION_TITLE } from './workspaceStyles'

export interface BillingReadinessView {
  finance_status: string
  selectable_dealer_plans: unknown[]
  external_gates: string[]
  flows: Array<{ code: string; payer: string; beneficiary: string; status: string }>
  canonical_pay03b_billing_readback: {
    state: string
    subscriptions: Array<{ subscription_id: string; status: string | null; paid_through: string | null }> | null
    invoices: Array<{ invoice_id: string; status: string | null; payment_status: string; anomaly: string | null }> | null
  }
}

export interface BillingWorkspaceProps {
  state: 'loading' | 'ready' | 'denied'
  data: BillingReadinessView | null
  onRetry: () => void
}

export function BillingWorkspace({ state, data, onRetry }: BillingWorkspaceProps) {
  const readback = data?.canonical_pay03b_billing_readback
  return (
    <div className="space-y-5 text-carup-text" data-testid="dealer-ws-billing" data-presentation="dealer-workspace-billing">
      <DealerObjectHeader
        eyebrow="Dealer OS · Billing"
        title="Billing readiness"
        description="What must be in place before your dealership can pay CarUp for a plan. Payments are not live: nothing on this page can charge you or take a payment."
        meta={state === 'ready' && data ? (
          <>
            <StatusChip tone="warning" testId="dealer-ws-billing-live">Live payments not active</StatusChip>
            <StatusChip testId="dealer-ws-billing-initiation">Payment initiation disabled</StatusChip>
          </>
        ) : undefined}
      />

      {state === 'loading' && <EmptyState kind="loading" title="Checking your dealership's billing status…" testId="dealer-ws-billing-loading" />}
      {state === 'denied' && (
        <EmptyState kind="error" title="Billing status is unavailable" onRetry={onRetry} testId="dealer-ws-billing-denied">
          An active legal dealership and tenant membership is required before business billing status can be
          inspected, or the status could not be read right now. No payment has been initiated.
        </EmptyState>
      )}

      {state === 'ready' && data && readback && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <section aria-labelledby="dealer-ws-billing-checklist-title" className={`${WS_CARD} p-4 sm:p-5`} data-testid="dealer-ws-billing-checklist">
              <p className={WS_EYEBROW}>Readiness checklist</p>
              <h2 id="dealer-ws-billing-checklist-title" className="mt-1 text-lg font-bold tracking-[-0.01em]">Before dealer plans can open</h2>
              <p className={`${WS_HINT} max-w-2xl`}>
                CarUp has not opened dealer billing. Every requirement below must be in place first. These are CarUp-side
                approvals — there is no plan to choose and nothing to pay today.
              </p>
              {data.external_gates.length === 0 ? (
                <p className="mt-3 text-sm text-carup-text-2">No activation requirements were returned in this read.</p>
              ) : (
                <ol className="mt-4 divide-y divide-carup-line rounded-card border border-carup-line">
                  {data.external_gates.map((gate, i) => (
                    <li key={gate} className="flex items-start gap-3 px-3 py-3 sm:px-4" data-testid={`dealer-ws-billing-gate-${i}`}>
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-sm text-carup-text [overflow-wrap:anywhere]">{humanizeCode(gate)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="dealer-ws-billing-records-title" className={`${WS_CARD} p-4 sm:p-5`} data-testid="dealer-ws-billing-records">
              <h2 id="dealer-ws-billing-records-title" className={`flex items-center gap-2 ${WS_SECTION_TITLE}`}>
                <Receipt className="h-4 w-4 text-carup-text-3" aria-hidden="true" /> Subscription &amp; invoice records
              </h2>
              <p className={WS_HINT}>
                Read-only records, only when the separately governed subscription tables exist. This view never initiates,
                verifies or settles payments and cannot grant a subscription.
              </p>
              <p className="mt-2 text-xs font-semibold text-carup-text-2 [overflow-wrap:anywhere]">Record authority: {humanizeCode(readback.state)}</p>
              {readback.subscriptions === null ? (
                <div className="mt-3">
                  <EmptyState compact title="Billing records are unavailable" testId="dealer-ws-billing-records-unavailable">
                    No invoice or payment total may be inferred from that absence.
                  </EmptyState>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-carup-text-2">
                    {readback.subscriptions.length} subscription record(s) in this scoped read — not a payment count.
                  </p>
                  {readback.subscriptions.map(item => (
                    <div key={item.subscription_id} className="rounded-control border border-carup-line p-3 text-sm">
                      <p className="font-semibold [overflow-wrap:anywhere]">Subscription {item.subscription_id}</p>
                      <p className="mt-1 text-carup-text-2">Status: {item.status || 'Not determined'} · Paid-through record: {dealerDate(item.paid_through)}</p>
                      <p className="mt-1 text-xs text-carup-text-3">A recorded provider state alone is never verified current entitlement.</p>
                    </div>
                  ))}
                  {readback.invoices?.map(invoice => (
                    <div key={invoice.invoice_id} className="rounded-control border border-carup-line p-3 text-sm">
                      <p className="font-semibold [overflow-wrap:anywhere]">Invoice {invoice.invoice_id}</p>
                      <p className="mt-1 text-carup-text-2">Provider record: {invoice.status || 'Not determined'} · Payment status: {invoice.payment_status}</p>
                      {invoice.anomaly && <p className="mt-1 text-status-warning">Reconciliation exception: {invoice.anomaly}</p>}
                      <p className="mt-1 text-xs text-carup-text-3">No settlement, receipt, refund or entitlement is certified by this view.</p>
                    </div>
                  ))}
                  <p className="text-xs text-carup-text-3">Capped at 25 recent subscriptions and 100 recent invoices — not an audited statement.</p>
                </div>
              )}
            </section>

            <section aria-labelledby="dealer-ws-billing-flows-title" className={`${WS_CARD} overflow-hidden`} data-testid="dealer-ws-billing-flows">
              <div className="border-b border-carup-line px-4 py-3 sm:px-5">
                <h2 id="dealer-ws-billing-flows-title" className={`flex items-center gap-2 ${WS_SECTION_TITLE}`}>
                  <Landmark className="h-4 w-4 text-carup-text-3" aria-hidden="true" /> Money flows kept separate
                </h2>
                <p className={WS_HINT}>Your dealership paying CarUp is legally distinct from buyers paying you and garage customers paying a garage.</p>
              </div>
              <ul className="divide-y divide-carup-line">
                {data.flows.map(flow => (
                  <li key={flow.code} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{humanizeCode(flow.code)}</p>
                      <p className="mt-0.5 text-xs leading-5 text-carup-text-2 [overflow-wrap:anywhere]">
                        Payer: {humanizeCode(flow.payer)} → Merchant: {humanizeCode(flow.beneficiary)}
                      </p>
                    </div>
                    <StatusChip className="justify-self-start sm:justify-self-end" tone={flow.status.startsWith('BLOCKED') ? 'warning' : 'neutral'}>{humanizeCode(flow.status)}</StatusChip>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside aria-labelledby="dealer-ws-billing-position-title" className="order-first min-w-0 space-y-4 lg:sticky lg:top-24 lg:order-none">
            <section className="rounded-card bg-carup-raw-ink p-4 text-carup-raw-paper sm:p-5" data-testid="dealer-ws-billing-position">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                <CreditCard className="h-3.5 w-3.5" aria-hidden="true" /> Current position
              </p>
              <h2 id="dealer-ws-billing-position-title" className="mt-2 text-lg font-bold">Dealer subscriptions cannot be purchased yet</h2>
              <dl className="mt-4 grid gap-3">
                {[
                  ['Commercial authority', humanizeCode(data.finance_status)],
                  ['Approved selectable plans', `${data.selectable_dealer_plans.length} — not priced or certified`],
                  ['Payment initiation', 'Disabled'],
                  ['Invoice and receipt history', 'Not available — not zero'],
                ].map(([label, value]) => (
                  <div key={label} className="border-t border-white/[0.12] pt-3">
                    <dt className="text-xs text-white/70">{label}</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-white [overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <p className="flex items-start gap-2 text-xs leading-5 text-carup-text-3">
              <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              No Stripe, Paynow, mobile money or merchant request is made on this page. A paid plan can never confer
              company, legal, buyer-trust or VIN listing verification.
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}

