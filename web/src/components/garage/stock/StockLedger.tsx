import type { StockMovement } from '@/lib/garageBusiness'
import { MOVEMENT_LABEL, reasonText, signedDelta, whenText } from './stockPresentation'

/**
 * The stock ledger of one part: read-only history. A quantity changes only by adding a movement,
 * never by editing one, and the server keeps the list newest first.
 */
export function StockLedger({ movements }: { movements: StockMovement[] }) {
  if (movements.length === 0) {
    return (
      <p className="mt-2 text-sm text-gray-600" data-testid="stock-ledger-empty">
        No stock movements are recorded for this part yet. Its quantity has not been established by a count.
      </p>
    )
  }
  return (
    <ol className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white" data-testid="stock-ledger">
      {movements.map((m) => {
        const reason = reasonText(m.reason_code)
        return (
          <li key={m.id} className="p-3 text-sm" data-testid="stock-movement">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">{MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}</p>
              <p className="font-semibold tabular-nums" aria-label={`Change of ${signedDelta(m.quantity_delta)} units`}>{signedDelta(m.quantity_delta)}</p>
            </div>
            <p className="text-gray-600">Balance {m.balance_before} to {m.balance_after}</p>
            {reason && <p className="text-gray-600">Reason: {reason}</p>}
            {m.note && <p className="text-gray-600 break-words">Note: {m.note}</p>}
            {m.work_order_id && <p className="text-gray-600">Linked to a job card</p>}
            <p className="text-xs text-gray-500">{whenText(m.created_at)}</p>
          </li>
        )
      })}
    </ol>
  )
}

export default StockLedger
