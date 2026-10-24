import type { ReactNode } from 'react'
import { Receipt } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { formatMoney, type Closeout, type VarianceView } from '@/lib/garageBusiness'
import { categoryLabel, hubShowsMoney, isAllowed } from '@/lib/garageWorkspace'
import { HubSection, ScopedError, type HubPanelProps } from './hubUi'
import { InvoiceForm, type InvoiceDraft } from './InvoiceForm'
import { InvoiceView } from './InvoiceView'

const DIRECTION_LABEL = { same: 'the same as the estimate', over_estimate: 'over the estimate', under_estimate: 'under the estimate' } as const

function varianceText(v: VarianceView): string {
  switch (v.state) {
    case 'no_estimate': return 'There was no accepted estimate to compare against.'
    case 'awaiting_invoice': return 'This is compared once an invoice is issued.'
    case 'not_comparable': return `Not comparable: ${v.reason}`
    case 'comparable':
      return `Estimate ${formatMoney(v.estimate_total, v.currency)}, invoice ${formatMoney(v.invoice_total, v.currency)}. `
        + `Difference ${v.difference} ${v.currency} — ${DIRECTION_LABEL[v.direction]}.`
  }
}

function Fact({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="space-y-1">
      <dt className="text-gray-500">{label}</dt>
      <dd className="space-y-1">{children}</dd>
    </div>
  )
}

/**
 * Closing the job commercially — garage administrators only (`hub.closeout` is null for a mechanic).
 *
 * The estimate the customer accepted, the work actually recorded, the parts used and the invoice are shown
 * SIDE BY SIDE as separate facts. Nothing is added across them or converted between currencies; the
 * variance is the server's statement and is shown only as it says it.
 */
export function CloseoutPanel({ hub, busy, run, error }: HubPanelProps) {
  const { issueGarageInvoice } = useCarUpApi()
  const closeout: Closeout | null = hub.closeout
  const status = String(hub.case.status).toLowerCase()
  if (!closeout || !hubShowsMoney(hub) || (status !== 'completed' && !closeout.invoice)) return null

  const canIssue = isAllowed(hub, 'issue_invoice')
  const invoice = closeout.invoice
  const unpricedWork = closeout.actual_work.filter((w) => w.cost === null).length

  const issue = (body: InvoiceDraft) => run('closeout', () => issueGarageInvoice(hub.case.id, body), 'Invoice issued. It is a document — no payment has been recorded.')

  return (
    <HubSection
      id="closeout" title="Closing the job" testId="closeout-panel"
      hint="Estimate, actual work, invoice and payment are separate facts. They are shown side by side and never added together."
    >
      <dl className="grid gap-4 sm:grid-cols-2 text-sm" data-testid="closeout-facts">
        <Fact label="Estimate the customer accepted" testId="closeout-estimate">
          {closeout.estimate
            ? <p>Version {closeout.estimate.version}: {formatMoney(closeout.estimate.total_amount, closeout.estimate.currency)}</p>
            : <p>No accepted estimate on record.</p>}
        </Fact>

        <Fact label="Work recorded" testId="closeout-work">
          {closeout.actual_work.length === 0 ? <p>No work was recorded.</p> : (
            <>
              <p>{closeout.actual_work.length} piece{closeout.actual_work.length === 1 ? '' : 's'} of work</p>
              {closeout.actual_work.map((w) => (
                <p key={w.service_record_id} className="text-xs text-gray-600" data-testid="closeout-work-item">
                  {categoryLabel(w.service_category)}: {w.cost ? formatMoney(w.cost.amount, w.cost.currency) : 'Not recorded'}
                </p>
              ))}
            </>
          )}
          {closeout.recorded_cost_by_currency.map((c) => (
            <p key={c.currency} data-testid="closeout-recorded-cost">
              Recorded cost in {c.currency}: {formatMoney(c.total, c.currency)}
            </p>
          ))}
          {unpricedWork > 0 && <p className="text-xs text-gray-600">{unpricedWork} piece{unpricedWork === 1 ? '' : 's'} of work with no cost recorded.</p>}
        </Fact>

        <Fact label="Parts used" testId="closeout-parts">
          {closeout.parts_used.length === 0 ? <p>No parts were recorded.</p> : (
            closeout.parts_used.map((u) => (
              <p key={u.id} className={u.reversed_at ? 'line-through text-gray-500' : ''} data-testid="closeout-part">
                {u.part_name_snapshot} × {u.quantity}: {formatMoney(u.sell_price_snapshot, u.price_currency_snapshot)}
                {u.reversed_at ? ' (reversed)' : ''}
              </p>
            ))
          )}
        </Fact>

        <Fact label="Estimate against invoice" testId="closeout-variance">
          <p>{varianceText(closeout.variance)}</p>
        </Fact>
      </dl>

      <ScopedError scope="closeout" error={error} />

      {invoice && <InvoiceView hub={hub} invoice={invoice} busy={busy} run={run} />}

      {canIssue && (
        <InvoiceForm suggestion={closeout.suggested_invoice} busy={busy} onSubmit={issue} />
      )}

      {!invoice && !canIssue && (
        <p className="text-sm text-gray-600 flex items-center gap-2" data-testid="no-invoice">
          <Receipt className="w-4 h-4 text-gray-400" aria-hidden="true" /> No invoice has been issued for this job.
        </p>
      )}
    </HubSection>
  )
}
