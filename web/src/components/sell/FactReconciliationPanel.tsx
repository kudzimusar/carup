/**
 * Seller Journey 1.0 / S5 — where your documents disagree with what you told us.
 *
 * The plan's reference case:
 *
 *     Seller states model year 2020
 *     Registration document indicates 2019
 *
 * Both sides are shown, attributed, side by side. CarUp presents neither as the answer, because
 * neither is: an OCR reading is what a document appears to say, and a seller statement is what a
 * seller said. Deciding between them is a human review, and until that happens this panel says so.
 *
 * What this must never do:
 *   · present the document reading as a correction — that would silently replace a seller's
 *     statement with a machine's guess;
 *   · call an unreviewed reading "verified" — verification is a person, not a confidence score;
 *   · announce itself when there is nothing to report. A panel that says "no problems" on every
 *     listing trains sellers to stop reading it.
 */
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { SellerFactReconciliation, SellerFactReconciliationEntry } from '@/types'

/** Field names as a seller would say them. Unknown fields fall back to a readable form. */
const FIELD_LABELS: Record<string, string> = {
  year: 'Model year',
  make: 'Make',
  model: 'Model',
  vin: 'VIN',
  chassis_number: 'Chassis number',
  engine_number: 'Engine number',
  plate_number: 'Number plate',
  normalized_plate_number: 'Number plate',
}

const fieldLabel = (field: string) =>
  FIELD_LABELS[field] ?? field.replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase())

const documentLabel = (documentType: string | null) =>
  documentType
    ? documentType.replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase())
    : 'Uploaded document'

function ReconciliationRow({ entry }: { entry: SellerFactReconciliationEntry }) {
  return (
    <li
      className={`rounded-xl border p-3 ${entry.resolved ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'}`}
      data-testid={`reconciliation-row-${entry.field}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-slate-900">{fieldLabel(entry.field)}</p>
        {entry.resolved ? (
          <Badge variant="outline" className="border-slate-300 text-[10px] text-slate-600">Resolved</Badge>
        ) : (
          <Badge className="bg-amber-500 text-[10px] text-white">Awaiting review</Badge>
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-white p-2" data-testid={`reconciliation-seller-${entry.field}`}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">You stated</p>
          <p className="mt-0.5 font-semibold text-slate-900">{entry.seller_stated ?? 'Not recorded'}</p>
        </div>
        <div className="rounded-lg bg-white p-2" data-testid={`reconciliation-evidence-${entry.field}`}>
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <FileText className="h-3 w-3" aria-hidden="true" />
            {documentLabel(entry.document_type)} reads
          </p>
          <p className="mt-0.5 font-semibold text-slate-900">{entry.evidence_indicated ?? 'Not recorded'}</p>
          {/* "on the document" is doing real work: a reviewer confirms what a PAGE says, which is
              not the same as CarUp certifying the vehicle's model year. */}
          {entry.evidence_verified && (
            <p className="mt-0.5 text-[11px] text-slate-500">A reviewer confirmed this reading on the document.</p>
          )}
        </div>
      </div>
    </li>
  )
}

export function FactReconciliationPanel({
  reconciliation,
  className = '',
}: {
  reconciliation?: SellerFactReconciliation
  className?: string
}) {
  // Only genuine disagreements are reported. `no_evidence` and `not_comparable` are not problems:
  // "we have not read a document for this" is a gap, not a contradiction.
  const contradictions = (reconciliation?.fields ?? []).filter(entry => entry.state === 'contradicted')
  if (contradictions.length === 0) return null

  const blocking = reconciliation?.has_unresolved_material_contradiction === true

  return (
    <Card className={`border-0 card-shadow ${className}`} data-testid="fact-reconciliation-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Your documents disagree with your details
        </CardTitle>
        <p className="mt-1 text-xs text-gray-500">
          CarUp has not changed anything you entered. Both readings are shown below exactly as they
          stand, and a reviewer decides which one is right.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {contradictions.map(entry => <ReconciliationRow key={entry.field} entry={entry} />)}
        </ul>

        {blocking ? (
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="reconciliation-blocking-notice"
          >
            <p className="font-semibold">This listing is held until the disagreement is settled.</p>
            <p className="mt-1 text-xs">
              CarUp does not publish a vehicle while a document contradicts a detail this important.
              If your entry was a typo, correct it. If the document is wrong or out of date, a
              reviewer will record that.
            </p>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 text-sm text-emerald-700" data-testid="reconciliation-cleared">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Every disagreement above has been reviewed. Publication is no longer held for this reason.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
