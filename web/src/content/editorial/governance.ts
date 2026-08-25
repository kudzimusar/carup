/**
 * Editorial content governance — Issue #164 Phase 8, Cluster G.
 *
 * ## Why this exists
 *
 * `/blog` and `/press` held their content as free-text strings inside component literals, with no
 * field in which a factual assertion could be attributed. Nothing constrained what they could claim,
 * and so they claimed a great deal that is not true: that ZINARA had launched a third-generation
 * portal integrating tolling, registration and insurance databases; that CarUp pushes a
 * cryptographically signed voucher into the ZINARA database and clears licensing in under three
 * minutes; that named real banks offer ZiG vehicle finance at specific interest rates; that four
 * named people with invented professional biographies wrote the articles; that a "Live Market
 * Metrics" panel of fabricated statistics was live; and that two named press officers would respond
 * within two hours, behind a form that transmits nothing.
 *
 * That is the same defect class Issue #164 exists to close — an unattributed value published as a
 * fact — expressed in prose instead of in a database column.
 *
 * ## The model
 *
 * Every factual-looking statement on these surfaces must carry a classification. There are exactly
 * four, and a claim that fits none of them may not be published:
 *
 *  - `governed_capability` — something CarUp measurably does today, traceable to shipped code.
 *  - `sourced_editorial`   — a claim about the world, carrying a resolvable source.
 *  - `future_vision`       — a concept, rendered with an unmistakable label.
 *  - `unavailable`         — we have nothing publishable yet, and say so.
 *
 * The pages keep their design. This governs what may appear inside it.
 */

export type EditorialSource = {
  publisher: string
  title: string
  url: string
  /** ISO date the source was last checked. A source nobody has re-read is not a live citation. */
  retrieved: string
}

export type EditorialClassification =
  | {
    kind: 'governed_capability'
    /** The shipped behaviour this describes, so a reviewer can go and check it. */
    capability: string
  }
  | { kind: 'sourced_editorial'; source: EditorialSource }
  | { kind: 'future_vision' }
  | { kind: 'unavailable' }

/**
 * Who wrote it.
 *
 * The previous `Author` type required name/role/avatar/bio with no link to any registry of real
 * people, so four personas with invented credentials were typed straight in. A byline is now either
 * CarUp's editorial desk — which is an accountable publisher — or a named person who must carry a
 * verifiable public profile.
 */
export type Byline =
  | { kind: 'carup_editorial' }
  | { kind: 'named'; name: string; role: string; profileUrl: string }

export const CARUP_EDITORIAL: Byline = { kind: 'carup_editorial' }

export function bylineName(byline: Byline): string {
  return byline.kind === 'carup_editorial' ? 'CarUp Editorial' : byline.name
}

export function bylineRole(byline: Byline): string {
  return byline.kind === 'carup_editorial' ? 'CarUp' : byline.role
}

/** Two initials for the existing avatar circle, without inventing a person to own them. */
export function bylineInitials(byline: Byline): string {
  if (byline.kind === 'carup_editorial') return 'CU'
  return byline.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

/** The label a surface prints beside a classified claim, or null where none is warranted. */
export function classificationLabel(classification: EditorialClassification): string | null {
  switch (classification.kind) {
    case 'governed_capability':
      return null // a description of what the product does needs no qualifier
    case 'sourced_editorial':
      return `Source: ${classification.source.publisher}`
    case 'future_vision':
      return 'Concept — not a current CarUp capability'
    case 'unavailable':
      return 'Not yet published'
    default:
      return null
  }
}

/**
 * Terms that may not appear in editorial prose without a classification that supports them.
 *
 * This is the mechanical half of the rule, and it is deliberately about INSTITUTIONS and
 * PARTNERSHIPS rather than an open-ended banned-word list: naming a real regulator, insurer or bank
 * is exactly where unattributed prose does its damage, because a reader has no way to tell an
 * invented integration from a real one.
 */
export const INSTITUTIONAL_TERMS = Object.freeze([
  'ZINARA', 'ZIMRA', 'ZRP', 'City Parking', 'CVR', 'Central Vehicle Registry',
  'CABS', 'FBC', 'Steward Bank', 'Old Mutual', 'Econet', 'JEVIC', 'QISJ',
])

/**
 * True when a statement names a real institution. Such a statement must be `sourced_editorial`, or
 * `governed_capability` describing what CarUp itself does, or `future_vision` clearly labelled —
 * never bare prose.
 */
export function namesInstitution(text: string): boolean {
  return INSTITUTIONAL_TERMS.some((term) => new RegExp(`\\b${term}\\b`, 'i').test(text))
}
