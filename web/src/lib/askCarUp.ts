/**
 * Ask CarUp — turn a sentence ("an automatic diesel pickup under $25k for the farm") into the
 * Marketplace filters CarUp already supports. Deterministic and local: it never invents a filter the
 * Marketplace cannot apply, and anything it does not recognise stays with the AI as context only.
 */
import { VEHICLE_TAXONOMY, canonicalMake, canonicalModel, makeTaxon, resolveFuelType, resolveTransmission } from '@/data/vehicleTaxonomy'

export interface CarRequest {
  make?: string
  model?: string
  bodyStyle?: string
  fuel?: string
  transmission?: string
  maxPrice?: number
  location?: string
  /** Purpose words passed to the assistant as context; never applied as a filter. */
  purposes: string[]
}

const BODY_WORDS: [RegExp, string][] = [
  [/\b(pick[\s-]?ups?|bakkies?|double[\s-]?cabs?|single[\s-]?cabs?|utes?)\b/, 'Pickup'],
  [/\b(suvs?|4x4s?|four[\s-]?by[\s-]?four)\b/, 'SUV'],
  [/\b(crossovers?)\b/, 'Crossover'],
  [/\b(sedans?|saloons?)\b/, 'Sedan'],
  [/\b(hatch(?:backs?)?)\b/, 'Hatchback'],
  [/\b(vans?|minivans?|mpvs?|kombis?|people[\s-]?carriers?|7[\s-]?seaters?|seven[\s-]?seaters?)\b/, 'MPV'],
]
const FUEL_WORDS: [RegExp, string][] = [
  [/\bdiesel\b/, 'Diesel'],
  [/\b(petrol|gasoline)\b/, 'Petrol'],
  [/\bhybrid\b/, 'Hybrid'],
  [/\b(electric|ev)\b/, 'Electric'],
]
const TRANSMISSION_WORDS: [RegExp, string][] = [
  [/\b(automatic|auto)\b/, 'Automatic'],
  [/\bmanual\b/, 'Manual'],
]
const PLACES = ['Harare', 'Bulawayo', 'Mutare', 'Gweru', 'Masvingo', 'Kwekwe', 'Kadoma', 'Chinhoyi', 'Victoria Falls', 'Marondera', 'Bindura', 'Chitungwiza']
const PURPOSES: [RegExp, string][] = [
  [/\b(farm|farming|rural|bush|gravel|off[\s-]?road)\b/, 'farm and rough roads'],
  [/\b(family|kids|school)\b/, 'family'],
  [/\b(city|town|commut\w*|traffic|parking)\b/, 'city driving'],
  [/\b(business|deliver\w*|work|cargo|load)\b/, 'work and loads'],
  [/\b(fuel[\s-]?efficient|economical|cheap to run|economy)\b/, 'fuel economy'],
  [/\b(first car|learner|beginner)\b/, 'first car'],
]

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const word = (term: string) => new RegExp(`(^|[^a-z0-9])${escape(term.toLowerCase())}([^a-z0-9]|$)`)

function canonicalFacet(kind: 'fuel' | 'transmission', label: string): string | undefined {
  const resolved = kind === 'fuel' ? resolveFuelType(label) : resolveTransmission(label)
  return resolved.state === 'canonical' || resolved.state === 'alias_match' ? String(resolved.value) : undefined
}

/** Budget only when the sentence says it is money: a currency mark, k/thousand, or a ceiling word. */
function readBudget(text: string): number | undefined {
  const match = text.match(/(?:\b(under|below|less than|max(?:imum)?|up to|budget(?: of| is)?|around|about|for)\s+)?(?:us\s?)?(\$|usd\s?)?\s?(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s?(k|thousand)?\b/i)
  if (!match) return undefined
  const [, ceiling, currency, rawNumber, thousands] = match
  if (!ceiling && !currency && !thousands) return undefined
  let value = Number(rawNumber.replace(/[,\s]/g, ''))
  if (thousands) value *= 1000
  if (!currency && !thousands && value >= 1950 && value <= 2035) return undefined // a model year, not money
  return Number.isFinite(value) && value >= 500 ? Math.round(value) : undefined
}

export function parseCarRequest(input: string): CarRequest {
  const text = ` ${input.toLowerCase()} `
  const request: CarRequest = { purposes: [] }

  // Make and model: whole-word matches against the governed taxonomy (names and aliases).
  for (const taxon of VEHICLE_TAXONOMY) {
    const names = [taxon.make, ...(taxon.aliases || [])]
    if (names.some(name => word(name).test(text))) { request.make = canonicalMake(taxon.make); break }
  }
  const searchModels = request.make ? [makeTaxon(request.make)!] : VEHICLE_TAXONOMY
  const modelHits: { make: string; model: string }[] = []
  for (const taxon of searchModels) {
    for (const model of taxon.models || []) {
      const names = [model.name, ...(model.aliases || [])].filter(name => name.length >= 3)
      if (names.some(name => word(name).test(text))) modelHits.push({ make: taxon.make, model: model.name })
    }
  }
  if (modelHits.length === 1 || (request.make && modelHits.length > 0)) {
    request.make = canonicalMake(modelHits[0].make)
    request.model = canonicalModel(request.make, modelHits[0].model)
  }

  for (const [pattern, value] of BODY_WORDS) if (pattern.test(text)) { request.bodyStyle = value; break }
  for (const [pattern, label] of FUEL_WORDS) if (pattern.test(text)) { request.fuel = canonicalFacet('fuel', label); break }
  for (const [pattern, label] of TRANSMISSION_WORDS) if (pattern.test(text)) { request.transmission = canonicalFacet('transmission', label); break }
  const place = PLACES.find(name => word(name).test(text))
  if (place) request.location = place
  request.maxPrice = readBudget(input)
  for (const [pattern, label] of PURPOSES) if (pattern.test(text)) request.purposes.push(label)
  return request
}

/** The live Marketplace with every recognised filter applied (only filters the Marketplace supports). */
export function marketplaceHrefFor(request: CarRequest): string {
  const params = new URLSearchParams()
  if (request.make) params.set('make', request.make)
  if (request.model) params.set('model', request.model)
  if (request.bodyStyle) params.set('bodyStyle', request.bodyStyle)
  if (request.fuel) params.set('fuel', request.fuel)
  if (request.transmission) params.set('transmission', request.transmission)
  if (request.maxPrice) params.set('maxPrice', String(request.maxPrice))
  if (request.location) params.set('location', request.location)
  const query = params.toString()
  return query ? `/marketplace?${query}` : '/marketplace'
}

export interface UnderstoodChip { key: keyof Omit<CarRequest, 'purposes'> | 'purpose'; label: string }

export function understoodChips(request: CarRequest): UnderstoodChip[] {
  const chips: UnderstoodChip[] = []
  if (request.make) chips.push({ key: 'make', label: request.model ? `${request.make} ${request.model}` : request.make })
  if (request.bodyStyle) chips.push({ key: 'bodyStyle', label: request.bodyStyle === 'MPV' ? 'Van / MPV' : request.bodyStyle })
  if (request.fuel) chips.push({ key: 'fuel', label: request.fuel })
  if (request.transmission) chips.push({ key: 'transmission', label: request.transmission })
  if (request.maxPrice) chips.push({ key: 'maxPrice', label: `Up to $${request.maxPrice.toLocaleString('en-US')}` })
  if (request.location) chips.push({ key: 'location', label: request.location })
  for (const purpose of request.purposes) chips.push({ key: 'purpose', label: `For ${purpose}` })
  return chips
}

/** Remove one recognised filter (the visitor corrects what CarUp understood). */
export function withoutChip(request: CarRequest, chip: UnderstoodChip): CarRequest {
  if (chip.key === 'purpose') return { ...request, purposes: request.purposes.filter(p => `For ${p}` !== chip.label) }
  const next: CarRequest = { ...request, purposes: [...request.purposes] }
  delete next[chip.key]
  if (chip.key === 'make') delete next.model
  return next
}
