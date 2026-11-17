/**
 * Gutu AI (formerly "Ask CarUp") — turn a sentence ("an automatic diesel pickup under $25k for the farm") into the
 * Marketplace filters CarUp already supports. Deterministic and local: it never invents a filter the
 * Marketplace cannot apply, and anything it does not recognise stays with the AI as context only.
 */
import { VEHICLE_COLORS, VEHICLE_TAXONOMY, canonicalMake, canonicalModel, isValidVehicleYear, makeTaxon, resolveColor, resolveFuelType, resolveTransmission } from '@/data/vehicleTaxonomy'

export interface CarRequest {
  make?: string
  model?: string
  bodyStyle?: string
  fuel?: string
  transmission?: string
  /** Canonical taxonomy colour (the Marketplace `color` filter). */
  color?: string
  /** Model year (the Marketplace `year` filter) — never read as money. */
  year?: number
  minPrice?: number
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

/**
 * RX03-P2-R5 GUTU-01 — read budgets from MONEY, not from the first number in the sentence.
 *
 * Every number is classified on its own. A number is money only with monetary context: a currency
 * mark or code before it ($, US$, USD), a currency word after it (dollars, usd), a thousands
 * suffix (k, thousand), or a budget word before it (under, max, at least, between ...) AND a value
 * of at least 500 that is not a model year. Seat/door counts, mileages, engine sizes, model numbers
 * ("Mazda 3", "320i", "Land Cruiser 200") and years are never budgets. Nothing is converted
 * between currencies: the Marketplace price filters are USD, so only USD/$ amounts are read.
 */
const MAX_WORDS = /(?:under|below|less than|no more than|not more than|max(?:imum)?|up to|within|budget(?: of| is)?|around|about|for)\s*$/
const MIN_WORDS = /(?:at least|over|above|more than|from|min(?:imum)?|starting at)\s*$/
const UNIT_AFTER = /^\s?-?\s?(?:seat|seater|door|km|kms|kilomet|mile|cc|litre|liter|l\b|hp|kw|ton|tonne|year|yr|row|owner|speed|wheel|x\d)/
const MONEY_NUMBER = /(us\s?\$|\$|usd\s?)?(\d{1,3}(?:[, \u00a0]\d{3})+(?!\d)|\d+(?:\.\d+)?)(\s?(?:k|thousand))?(?![\w$])(\s?(?:dollars?|usd)\b)?/gi

interface MoneyMention { value: number; bound: 'max' | 'min' | 'budget'; index: number; end: number }

function moneyMentions(input: string): MoneyMention[] {
  const lower = input.toLowerCase()
  const out: MoneyMention[] = []
  for (const m of lower.matchAll(MONEY_NUMBER)) {
    const [whole, currencyBefore, rawNumber, thousands, currencyAfter] = m
    const index = m.index ?? 0
    const before = lower.slice(Math.max(0, index - 24), index)
    const after = lower.slice(index + whole.length, index + whole.length + 14)
    if (/[\w.]$/.test(before)) continue // part of a word or model code (e.g. "x5", "a4")
    if (!currencyAfter && !thousands && UNIT_AFTER.test(after)) continue
    let value = Number(rawNumber.replace(/[, \u00a0]/g, ''))
    if (thousands) value *= 1000
    if (!Number.isFinite(value)) continue
    const currency = Boolean(currencyBefore || currencyAfter)
    const bound: MoneyMention['bound'] = MIN_WORDS.test(before) ? 'min' : MAX_WORDS.test(before) ? 'max' : 'budget'
    const yearLike = !currency && !thousands && value >= 1950 && value <= 2035
    const monetary = currency || Boolean(thousands) || (bound !== 'budget' && value >= 500 && !yearLike)
    if (!monetary || yearLike || value < 500) continue
    out.push({ value: Math.round(value), bound, index, end: index + whole.length })
  }
  return out
}

/** Budget bounds the sentence states in money; `between A and B` gives both. */
function readBudget(input: string): { minPrice?: number; maxPrice?: number } {
  const mentions = moneyMentions(input)
  if (mentions.length === 0) return {}
  const lower = input.toLowerCase()
  for (let i = 0; i + 1 < mentions.length; i++) {
    const a = mentions[i], b = mentions[i + 1]
    if (/between\s*$/.test(lower.slice(Math.max(0, a.index - 12), a.index)) && /^\s*(?:and|to|-)\s*$/.test(lower.slice(a.end, b.index))) {
      return { minPrice: Math.min(a.value, b.value), maxPrice: Math.max(a.value, b.value) }
    }
  }
  const min = mentions.find(m => m.bound === 'min')
  const max = mentions.find(m => m.bound === 'max') ?? mentions.find(m => m.bound === 'budget')
  return { minPrice: min?.value, maxPrice: max && max !== min ? max.value : undefined }
}

/** A stand-alone model year (the Marketplace `year` filter), never one used as money. */
function readYear(input: string, money: MoneyMention[]): number | undefined {
  for (const m of input.matchAll(/(?<![\d$.,])\b(19[5-9]\d|20[0-3]\d)\b(?![\d,]|\s?k\b)/gi)) {
    const index = m.index ?? 0
    if (money.some(x => index >= x.index && index < x.end)) continue
    const year = Number(m[1])
    if (isValidVehicleYear(year)) return year
  }
  return undefined
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
  // RX03-P2-R4 — colour, from the governed colour catalogue (labels + aliases, e.g. gray → Grey).
  for (const label of VEHICLE_COLORS) {
    if (label === 'Other') continue
    const names = label === 'Grey' ? ['grey', 'gray'] : [label]
    if (names.some(name => word(name).test(text))) {
      const resolved = resolveColor(label)
      if (resolved.state === 'canonical' || resolved.state === 'alias_match') { request.color = String(resolved.value); break }
    }
  }
  const place = PLACES.find(name => word(name).test(text))
  if (place) request.location = place
  const money = moneyMentions(input)
  const budget = readBudget(input)
  if (budget.maxPrice) request.maxPrice = budget.maxPrice
  if (budget.minPrice) request.minPrice = budget.minPrice
  const year = readYear(input, money)
  if (year !== undefined) request.year = year
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
  if (request.color) params.set('color', request.color)
  if (request.year) params.set('year', String(request.year))
  if (request.minPrice) params.set('minPrice', String(request.minPrice))
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
  if (request.color) chips.push({ key: 'color', label: request.color })
  if (request.year) chips.push({ key: 'year', label: String(request.year) })
  if (request.minPrice) chips.push({ key: 'minPrice', label: `From $${request.minPrice.toLocaleString('en-US')}` })
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
