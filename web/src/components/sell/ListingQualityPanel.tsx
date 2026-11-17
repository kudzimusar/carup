/**
 * Seller Journey 1.0 / S7 — the Listing Quality block.
 *
 * This is the SECOND of three measurements a seller sees, and the one most likely to be misread as
 * the third. It answers "is my advertisement strong?" — not "may CarUp publish this?" (that is the
 * publication-requirements panel) and emphatically not "what has CarUp verified?" (that is Canonical
 * Trust, which this component never reads, never computes and never displays).
 *
 * The panel says so in its own words, because a percentage next to a car is read as a verdict on
 * the car unless it is told otherwise.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Sparkles, Lightbulb } from 'lucide-react'
import { assessListingQuality, type ListingQualityInput } from '@/lib/listingQuality'
import { skin } from '@/lib/unifiedSkin'

const BAND_STYLE: Record<string, string> = {
  'Strong': 'bg-emerald-600 text-white',
  'Getting there': 'bg-amber-500 text-white',
  'Needs work': 'bg-slate-500 text-white',
}

export function ListingQualityPanel({
  listing,
  className = '',
}: {
  listing: ListingQualityInput
  className?: string
}) {
  const quality = assessListingQuality(listing)

  return (
    <Card className={`border-0 card-shadow ${className}`} data-testid="listing-quality-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className={skin('w-4 h-4 text-orange-500', 'w-4 h-4 text-carup-action')} />
            Listing quality
          </CardTitle>
          <Badge className={`text-xs ${BAND_STYLE[quality.band]}`} data-testid="listing-quality-band">
            {quality.band}
          </Badge>
        </div>
        {/* The sentence that keeps this from being read as a Trust score. */}
        <p className={skin('text-xs text-gray-500 mt-1', 'text-xs text-carup-text-2 mt-1')} data-testid="listing-quality-scope">
          How strong your advertisement is. This is separate from whether CarUp can publish the
          listing, and separate again from what CarUp has verified about the vehicle.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between mb-1">
            <span className={skin('text-xs text-gray-500', 'text-xs text-carup-text-2')}>Advertisement strength</span>
            <span className={skin('text-xs font-semibold text-gray-700', 'text-xs font-semibold text-carup-text-2')} data-testid="listing-quality-score">
              {quality.score}%
            </span>
          </div>
          <Progress value={quality.score} className="h-2" />
        </div>

        {quality.suggestions.length > 0 ? (
          <div className={skin('rounded-lg border border-orange-200 bg-orange-50 p-3', 'rounded-lg border border-carup-line-strong bg-carup-action-soft p-3')} data-testid="listing-quality-suggestions">
            <p className={skin('flex items-center gap-1.5 text-sm font-semibold text-orange-900', 'flex items-center gap-1.5 text-sm font-semibold text-carup-text')}>
              <Lightbulb className="h-4 w-4" aria-hidden="true" />
              Ways to strengthen this listing
            </p>
            <ul className={skin('mt-1.5 list-disc space-y-1 pl-5 text-sm text-orange-900', 'mt-1.5 list-disc space-y-1 pl-5 text-sm text-carup-text')}>
              {quality.suggestions.map(suggestion => <li key={suggestion}>{suggestion}</li>)}
            </ul>
            {/* Recommendations, not requirements — the difference matters because the publication
                panel beside this one lists things that genuinely do block. */}
            <p className={skin('mt-2 text-xs text-orange-800', 'mt-2 text-xs text-carup-text-2')}>
              These are recommendations. None of them blocks publication.
            </p>
          </div>
        ) : (
          <p className={skin('text-sm text-emerald-700', 'text-sm text-status-success')} data-testid="listing-quality-complete">
            Every listing-quality recommendation is met. This says your advertisement is complete —
            not that CarUp has verified the vehicle.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
