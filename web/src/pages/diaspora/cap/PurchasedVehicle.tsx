import { Car } from 'lucide-react'
import { GovernedGallery } from '@/components/media/GovernedGallery'
import type { JourneyAsset, Journey } from '@/hooks/useTradeLogisticsApi'
import { specRows } from '../capDisplay'
import { vehicleTitle } from '../journeyDisplay'
import { CapSection, Fact, Unshown, UnverifiedMark } from './ui'

/**
 * §23.2 — the purchased vehicle: its photographs, its identity, its complete KNOWN specifications and the purchase's reference.
 *
 * A fact is drawn if it is known and omitted if it is not. A row the projection flagged as "reported" carries a marker and the section says once, in
 * words, that CarUp has not independently verified it. The purchase price is never read from a listing price: the projection says "not recorded",
 * and so does this page.
 */
export function PurchasedVehicle({ asset, price }: { asset: JourneyAsset | null; price: NonNullable<Journey['transaction']>['purchase_price'] }) {
  if (!asset) return null
  const specs = asset.specifications
  const title = vehicleTitle(asset)
  return (
    <CapSection id="cap-vehicle" title="Purchased vehicle" icon={<Car className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}>
      <div className="mt-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 break-words text-lg font-semibold text-slate-950" data-testid="cap-vehicle-title">{title}</p>
        {asset.reference?.value ? <p className="min-w-0 break-words text-sm text-slate-700" data-testid="cap-vehicle-reference">Reference no. <span className="font-semibold">{asset.reference.value}</span></p> : null}
      </div>

      {asset.media ? (
        <div className="mt-3" data-testid="cap-vehicle-gallery">
          <GovernedGallery media={asset.media} title="Photographs" vehicleLabel={title} embedded />
        </div>
      ) : null}

      {specs?.availability === 'composed' ? (
        <div className="mt-4 min-w-0" data-testid="cap-vehicle-specs">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {specRows(specs.items).map((item) => (
              <Fact key={item.key} label={item.label} value={item.value} marker={item.marker} />
            ))}
            {price ? <Fact label="Purchase price" value={null} /> : null}
          </dl>
          {specs.equipment ? (
            <div className="mt-4 min-w-0" data-testid="cap-vehicle-equipment">
              <p className="text-xs text-slate-500">Equipment{specs.equipment.reported ? <UnverifiedMark /> : null}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {specs.equipment.items.map((item) => (
                  <li key={item} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-800">{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {price ? <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="cap-purchase-price-note">{price.note}</p> : null}
          {specs.note ? <p className="mt-2 min-w-0 break-words text-xs text-slate-600" data-testid="cap-vehicle-specs-note">† {specs.note}</p> : null}
          {specs.read_note ? <p className="mt-2 min-w-0 break-words text-xs text-amber-900" role="status" data-testid="cap-vehicle-specs-partial">{specs.read_note}</p> : null}
        </div>
      ) : specs ? (
        <Unshown availability={specs.availability} note={specs.note} testId="cap-vehicle-specs-unshown" />
      ) : null}
    </CapSection>
  )
}
