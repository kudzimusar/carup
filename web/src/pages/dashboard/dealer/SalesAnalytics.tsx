/**
 * Dealer analytics — CarUp Intelligence I8.
 *
 * This page previously published a complete fiction. Every figure on it was either
 * invented or measured against the wrong population, and the I0 audit catalogued
 * each one:
 *
 *   - Total Revenue, Units Sold and Avg. Sale Price were initialised to hardcoded
 *     six-figure constants and shown, identically, to EVERY dealer.
 *   - When they were "replaced", the source was the PUBLIC platform-wide vehicle
 *     list — not this dealer's inventory — and public reads exclude sold vehicles,
 *     so the sold computation was structurally near-zero either way.
 *   - The green/red movement badges beside each figure were literals, with no
 *     prior period computed and nothing to compare against.
 *   - A customer-satisfaction figure was published although CarUp has no rating
 *     system at all, anywhere in the product.
 *   - The Monthly Sales bar chart and the Sales-by-Category pie were static arrays
 *     that no fetch ever touched.
 *
 * None of that is replaced with a better estimate, because there is nothing
 * honest to estimate from: CarUp holds no authoritative record of a dealer's
 * completed sales. The page now shows the governed, tenant-scoped marketplace
 * performance CarUp genuinely measures, and states the absence of sales data
 * plainly rather than filling it.
 */
import DealerIntelligence from '@/components/intelligence/DealerIntelligence'

export default function SalesAnalytics() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Dealer analytics</h1>
        <p className="text-gray-500">
          Governed marketplace performance for your dealership.
        </p>
      </div>

      <DealerIntelligence windowDays={30} />
    </div>
  )
}
