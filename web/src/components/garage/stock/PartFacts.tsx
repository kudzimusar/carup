import { formatMoney, type GaragePart } from '@/lib/garageBusiness'
import { quantityText, reorderText, supplierText, whenText } from './stockPresentation'

/**
 * The facts of one part, as the server states them.
 *  - quantity: never a number unless one is on record; a legacy number is labelled unverified;
 *  - reorder level: "No reorder level set" when none was ever set (a part with none is never "low");
 *  - supplier: the garage's own free text, or "Not stated" — never "Internal" or "Verified";
 *  - prices: amount + currency together; the pre-currency legacy price is never shown as money.
 *  - money is the garage admin's: when the server redacts it (`moneyVisible` false, a mechanic) NO
 *    price, cost or legacy-price line is rendered at all. A redacted price is not "Not recorded" —
 *    saying so would be a false claim — so the line is simply absent.
 */
export function PartFacts({ part, moneyVisible }: { part: GaragePart; moneyVisible: boolean }) {
  const hasLegacyPrice = moneyVisible && part.legacy_unit_price !== null && part.legacy_unit_price !== undefined
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div data-testid={`part-quantity-${part.id}`}>
        <dt className="text-gray-500">Quantity</dt>
        <dd>{quantityText(part)}</dd>
      </div>
      <div data-testid={`part-reorder-${part.id}`}>
        <dt className="text-gray-500">Reorder level</dt>
        <dd>{reorderText(part)}</dd>
      </div>
      <div data-testid={`part-supplier-${part.id}`}>
        <dt className="text-gray-500">Supplier (as stated by the garage)</dt>
        <dd className="break-words">{supplierText(part)}</dd>
      </div>
      {moneyVisible && (
        <>
          <div data-testid={`part-sell-price-${part.id}`}>
            <dt className="text-gray-500">Sell price</dt>
            <dd>{formatMoney(part.sell_price, part.price_currency)}</dd>
          </div>
          <div data-testid={`part-unit-cost-${part.id}`}>
            <dt className="text-gray-500">Unit cost</dt>
            <dd>{formatMoney(part.unit_cost, part.price_currency)}</dd>
          </div>
        </>
      )}
      {hasLegacyPrice && (
        <div data-testid={`part-legacy-price-${part.id}`}>
          <dt className="text-gray-500">Legacy price (currency unknown)</dt>
          <dd>{part.legacy_unit_price}</dd>
        </div>
      )}
      <div data-testid={`part-last-movement-${part.id}`}>
        <dt className="text-gray-500">Last stock movement</dt>
        <dd>{part.last_movement_at ? whenText(part.last_movement_at) : 'No stock movement recorded'}</dd>
      </div>
    </dl>
  )
}

export default PartFacts
