/**
 * CA-K3-01 → CA-OWNER-02 — Finance (CA-UX-01 §13, CA-FIN-01).
 *
 * Corporate Finance & Accounting has no system of record, so every accounting measure stays blocked — never zero, never a
 * placeholder currency, never a product amount relabelled as finance. Product money facts are read live from their own
 * workflows and kept in their own panel, explicitly NOT Corporate Finance results: each keeps its own name, every amount stays
 * in the currency it was recorded in, and nothing is summed across currencies.
 */
import { CorporatePage, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { BlockedSlotList } from '@/components/corporate/TruthState'
import { EnvironmentNote, FactGrid, ManagementStatus } from '@/components/corporate/ManagementFacts'
import { useManagementArea } from '@/lib/corporate/useManagementArea'
import type { MetricSlot } from '@/lib/corporate/truthState'
import { CA_FIN_REASON, NO_SOURCE, PENDING_FIN } from './shared'

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

/** Exception areas with no source at all — reserved, never filled. The ones with a live source come from the read model. */
const RESERVED_EXCEPTIONS: Array<{ label: string; slot: MetricSlot; reason: string }> = [
  { label: 'Period close exceptions', slot: NO_SOURCE, reason: 'No period close process exists yet.' },
  { label: 'Receivable / payable aging', slot: NO_SOURCE, reason: 'No receivable or payable ledger exists yet.' },
  { label: 'Bank reconciliation', slot: NO_SOURCE, reason: 'No bank or treasury authority exists yet.' },
]

const isProductMoney = (id: string) => id.startsWith('finance.') && !id.startsWith('finance.exceptions.') && !id.startsWith('finance.accounting.')

export default function CorporateFinance() {
  const { result, retry } = useManagementArea('finance')
  const data = result.status === 'ok' ? result.payload : null
  const product = data ? data.facts.filter((f) => isProductMoney(f.id)) : []
  const exceptions = data ? data.facts.filter((f) => f.id.startsWith('finance.exceptions.')) : []
  return (
    <CorporatePage
      id="finance"
      intro={<>Finance — Corporate Finance & Accounting. Product financial facts exist; corporate accounting authority does not yet exist. This destination is not the customer-facing Finance, Payments & Insurance business unit.</>}
    >
      <Section label="A" title="Accounting authority" testId="finance-authority">
        <StatementPanel tone="blocked" testId="finance-authority-statement">Corporate accounting system of record not yet established.</StatementPanel>
        <p className="text-xs text-slate-500">Every amount carries its source currency. No multi-currency total is shown until accounting FX is approved.</p>
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
        description="Read live from the product workflows that recorded them — not Corporate Finance results. Each keeps its own name and is never upgraded into an accounting measure."
        testId="finance-product-money"
      >
        {data ? <FactGrid facts={product} className="xl:grid-cols-2" /> : <ManagementStatus result={result} onRetry={retry} />}
      </Section>

      <Section label="D" title="Finance exceptions" description="Failed, disputed, held or unmatched money workflow records, from their own sources. Areas with no source stay reserved — nothing is fabricated." testId="finance-exceptions">
        {data && <FactGrid facts={exceptions} />}
        <div className="rounded-md border border-slate-200 bg-white px-3">
          <BlockedSlotList caption="Reserved finance exception areas" items={RESERVED_EXCEPTIONS} />
        </div>
      </Section>

      {data && <EnvironmentNote environment={data.environment} generatedAt={data.generatedAt} />}
    </CorporatePage>
  )
}
