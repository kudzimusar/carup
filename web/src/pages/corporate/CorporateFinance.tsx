/**
 * CA-K3-01 — Finance landing (CA-UX-01 §13, CA-FIN-01). Corporate Finance & Accounting has no system
 * of record, so every accounting measure is blocked — never zero, never a placeholder currency, never
 * a product amount relabelled as finance. Product money facts are named as what they are and kept
 * in their own panel, explicitly NOT Corporate Finance results.
 */
import { CorporatePage, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { BlockedSlotList } from '@/components/corporate/TruthState'
import type { MetricSlot } from '@/lib/corporate/truthState'
import { CA_FIN_REASON, K2B_PENDING_REASON, NO_SOURCE, PENDING_FIN, PENDING_K2B } from './shared'

const STRATEGIC_SLOTS: Array<{ label: string; slot: MetricSlot; reason: string }> = [
  { label: 'GMV', slot: PENDING_FIN, reason: 'No completed-transaction accounting source; never summed from listings, deposits, quotes or sandbox settlements.' },
  { label: 'Recognized revenue', slot: PENDING_FIN, reason: 'No Corporate accounting recognition system of record.' },
  { label: 'Revenue by business unit', slot: PENDING_FIN, reason: CA_FIN_REASON },
  { label: 'Direct cost', slot: PENDING_FIN, reason: 'Fee configuration is not actual incurred cost.' },
  { label: 'Gross profit', slot: PENDING_FIN, reason: CA_FIN_REASON },
  { label: 'Gross margin', slot: PENDING_FIN, reason: CA_FIN_REASON },
  { label: 'Operating expense', slot: PENDING_FIN, reason: CA_FIN_REASON },
  { label: 'Operating profit', slot: PENDING_FIN, reason: CA_FIN_REASON },
  { label: 'Net profit', slot: PENDING_FIN, reason: CA_FIN_REASON },
  { label: 'Cash', slot: PENDING_FIN, reason: 'No bank or treasury authority. Custodial (escrow) money is not corporate cash.' },
  { label: 'Receivables', slot: PENDING_FIN, reason: CA_FIN_REASON },
  { label: 'Payables', slot: PENDING_FIN, reason: 'Referral reward payable status is not accounts payable.' },
  { label: 'Take rate', slot: PENDING_FIN, reason: CA_FIN_REASON },
  { label: 'Contribution margin', slot: PENDING_FIN, reason: CA_FIN_REASON },
]

const PRODUCT_MONEY_FACTS: Array<{ label: string; slot: MetricSlot; reason: string }> = [
  { label: 'Marketplace deposit workflow states', slot: PENDING_K2B, reason: 'A deposit is not a vehicle transaction value.' },
  { label: 'Finance applications (requested amounts)', slot: PENDING_K2B, reason: 'A requested amount is not a disbursement; an approval is not cash.' },
  { label: 'Trade quotes and requested budgets', slot: PENDING_K2B, reason: 'A quote is not a completed sale; an accepted quote is not a settlement.' },
  { label: 'Escrow sessions by provider mode (live / sandbox)', slot: PENDING_K2B, reason: 'Sandbox escrow is never a settlement, cash or revenue.' },
  { label: 'Subscription billing state (live / test)', slot: PENDING_K2B, reason: 'Test-mode billing is not live billing.' },
  { label: 'Referral reward obligations', slot: PENDING_K2B, reason: 'An accrued reward is not accounts payable.' },
]

const EXCEPTION_AREAS: Array<{ label: string; slot: MetricSlot; reason: string }> = [
  { label: 'Reconciliation mismatches', slot: NO_SOURCE, reason: 'No reconciliation ledger exists yet.' },
  { label: 'Period close exceptions', slot: NO_SOURCE, reason: 'No period close process exists yet.' },
  { label: 'Unreconciled settlements', slot: NO_SOURCE, reason: 'No live settlement authority exists yet.' },
  { label: 'Receivable / payable aging', slot: NO_SOURCE, reason: 'No receivable or payable ledger exists yet.' },
  { label: 'Bank reconciliation', slot: NO_SOURCE, reason: 'No bank or treasury authority exists yet.' },
]

export default function CorporateFinance() {
  return (
    <CorporatePage
      id="finance"
      intro={<>Finance — Corporate Finance & Accounting. Product financial facts exist; corporate accounting authority does not yet exist. This destination is not the customer-facing Finance, Payments & Insurance business unit.</>}
    >
      <Section label="A" title="Accounting authority" testId="finance-authority">
        <StatementPanel tone="blocked" testId="finance-authority-statement">Corporate accounting system of record not yet established.</StatementPanel>
        <p className="text-xs text-slate-500">Every amount, once available, carries its source currency. No multi-currency total is shown until accounting FX is approved.</p>
      </Section>

      <Section
        label="B"
        title="Strategic finance measures"
        description="Kept visible because they matter — each is blocked, not zero, until the accounting authority exists."
        testId="finance-strategic-slots"
      >
        <div className="rounded-md border border-slate-200 bg-white px-3">
          <BlockedSlotList caption="Strategic finance measures and their state" items={STRATEGIC_SLOTS} />
        </div>
      </Section>

      <Section
        label="C"
        title="Product / operational money facts"
        description="Amounts recorded by product workflows — not Corporate Finance results. Each keeps its own name and is never upgraded into an accounting measure."
        testId="finance-product-money"
      >
        <div className="rounded-md border border-dashed border-slate-300 bg-white px-3">
          <BlockedSlotList caption="Product and operational money facts" items={PRODUCT_MONEY_FACTS} />
        </div>
        <p className="text-xs text-slate-500">{K2B_PENDING_REASON}</p>
      </Section>

      <Section label="D" title="Finance exceptions (reserved)" description="Reserved for when the source exists. Nothing is fabricated here." testId="finance-exceptions">
        <div className="rounded-md border border-slate-200 bg-white px-3">
          <BlockedSlotList caption="Reserved finance exception areas" items={EXCEPTION_AREAS} />
        </div>
      </Section>
    </CorporatePage>
  )
}
