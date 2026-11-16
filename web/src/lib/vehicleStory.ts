/**
 * Vehicle Story reading rules: what the public summary records, and what CarUp has not confirmed.
 * A gap is stated in words; it is never filled, scored or hidden.
 */
import type { ShowroomListingCardModel } from '@/components/showroom/ShowroomListingCard'
import { formatMarketplacePrice } from '@/lib/currencyDisplay'

export function recordedFacts(v: ShowroomListingCardModel): [string, string][] {
  const facts: [string, string][] = []
  if (v.price != null) facts.push(['Asking price', formatMarketplacePrice(v.price, v.currency)])
  if (typeof v.mileage === 'number') facts.push(['Mileage', `${v.mileage.toLocaleString('en-US')} km`])
  if (v.transmission || v.fuel) facts.push(['Drivetrain', [v.transmission, v.fuel].filter(Boolean).join(' · ')])
  facts.push(['Location', v.locationLabel])
  facts.push(['Seller', v.sellerLabel])
  return facts
}

export function openQuestions(v: ShowroomListingCardModel): string[] {
  const gaps: string[] = []
  const trust = v.trust
  if (!trust || trust.evaluation_state !== 'evaluated') gaps.push('Trust has not been evaluated yet.')
  else if (trust.confidence === 'low') gaps.push(`Trust ${trust.score}/100 — low confidence, few records behind it.`)
  if (!v.plateVerified) gaps.push(`${v.plateStatus}.`)
  if (!v.partSentryChecked) gaps.push('No PartSentry parts record yet.')
  if (v.syntheticDemo) gaps.push('These photos are demo media, not evidence.')
  return gaps
}
