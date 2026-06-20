import { Badge } from '@/components/ui/badge'
import { Calculator } from 'lucide-react'
import type { MarketplacePricingSummary } from '@/types'

/**
 * Transparent all-in landed-cost estimate. Values are advisory (deterministic bands unless AI refines
 * them) and clearly labelled — never presented as an authoritative quote.
 */
export function AllInPricePanel({ pricing }: { pricing: MarketplacePricingSummary }) {
  const cur = pricing.currency || 'USD'
  const fmt = (n?: number) => (typeof n === 'number' ? `${cur} ${n.toLocaleString()}` : '—')
  const rows: { label: string; value?: number }[] = [
    { label: 'Asking price', value: pricing.asking_price },
    { label: 'Inspection (est.)', value: pricing.inspection_estimate },
    { label: 'Local transport (est.)', value: pricing.local_transport_estimate },
    { label: 'Export/import (est.)', value: pricing.export_import_estimate },
    { label: 'Container shipping (est.)', value: pricing.container_shipping_estimate },
    { label: 'Documentation (est.)', value: pricing.documentation_estimate },
    { label: 'Service fee (est.)', value: pricing.service_fee_estimate },
    { label: 'Referral discount', value: pricing.referral_discount_estimate ? -pricing.referral_discount_estimate : undefined },
  ].filter((r) => typeof r.value === 'number')

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm" data-testid="marketplace-allin-price">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-orange-500" />
          <h3 className="text-sm font-semibold text-gray-900">All-in cost estimate</h3>
        </div>
        <Badge variant="outline" className="text-[10px] capitalize">
          {pricing.estimate_basis === 'ai_assisted' ? 'AI-assisted' : 'Estimate'} · {pricing.price_confidence} confidence
        </Badge>
      </div>

      <div className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-gray-600">{r.label}</span>
            <span className={`font-medium ${(r.value || 0) < 0 ? 'text-emerald-600' : 'text-gray-900'}`}>{fmt(r.value)}</span>
          </div>
        ))}
        {typeof pricing.estimated_total === 'number' && (
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
            <span className="font-semibold text-gray-900">Estimated total</span>
            <span className="text-lg font-bold text-orange-600" data-testid="marketplace-allin-total">{fmt(pricing.estimated_total)}</span>
          </div>
        )}
      </div>

      {(pricing.estimated_fair_min || pricing.estimated_fair_max) && (
        <p className="mt-2 text-xs text-gray-500">
          Fair price band: {fmt(pricing.estimated_fair_min)} – {fmt(pricing.estimated_fair_max)}
        </p>
      )}

      {pricing.price_warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {pricing.price_warnings.map((w, i) => (
            <li key={i} className="text-xs text-amber-700">⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
