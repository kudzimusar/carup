/**
 * `/blog` editorial content — Issue #164 Phase 8, Cluster G.
 *
 * The five articles this replaces asserted, as current fact: a ZINARA third-generation portal
 * integrating tolling/registration/insurance databases; ANPR toll plazas issuing automatic electronic
 * fines; CarUp selling insurance and pushing a cryptographically signed voucher into the ZINARA
 * database, clearing licensing "in under 3 minutes"; JEVIC/QISJ odometer scanning and ML wear-models
 * making fraud "virtually impossible"; and named real banks (CABS, FBC) offering ZiG vehicle finance
 * at specific rates and deposits. None of it is true, none of it was sourced, and all of it was signed
 * by invented people.
 *
 * What replaces it is deliberately narrower and entirely checkable. Every `governed_capability` entry
 * below describes behaviour that ships in this repository and names where to verify it. Nothing here
 * is sourced editorial, because a source I cannot verify is worse than no article — inventing a
 * citation would be the same defect wearing a footnote. Topics we cannot yet source honestly are
 * published as `unavailable` rather than filled in, and the page renders that state instead of
 * pretending the shelf is full.
 */

import type { EditorialClassification, Byline } from './governance'
import { CARUP_EDITORIAL } from './governance'

export type EditorialArticle = {
  id: string
  title: string
  excerpt: string
  description: string
  /** Empty for an `unavailable` article — the surface renders the honest state instead. */
  content: string[]
  category: string
  date: string
  byline: Byline
  readTime: string
  accentColor: string
  classification: EditorialClassification
  /** Short factual pairs shown as context chips. Governed facts only. */
  context?: { label: string; value: string }[]
}

export const EDITORIAL_ARTICLES: EditorialArticle[] = [
  {
    id: 'how-carup-trust-is-calculated',
    title: 'How a CarUp Trust score is produced — and what it deliberately will not tell you',
    excerpt:
      'Every trust score CarUp publishes carries a calculation version, an evaluation state, a confidence level and its known limitations. Here is what the number is derived from, and the questions it is not designed to answer.',
    description:
      'CarUp publishes one governed trust decision per vehicle. This explains the inputs, the versioning, and why a vehicle with no evaluation shows no number rather than a zero.',
    content: [
      'A CarUp trust score is not an opinion about a vehicle and not a market rating. It is a governed decision produced by one service, stamped with the version of the rules that produced it, and published with the evidence basis it was derived from. Today that version is trust-decision-1.0.0.',
      'Every score carries four things besides the number: an evaluation state, a band, a confidence level, and a list of known limitations. The evaluation state is the part most people skip and the part that matters most. A vehicle that has never been assessed is "not evaluated" — it is not a zero, and it says nothing for or against the vehicle. A vehicle assessed under superseded rules is "stale", and CarUp withholds the earlier number rather than presenting it as current.',
      'Confidence is separate from the score on purpose. A number alone cannot distinguish a vehicle with thin evidence from one that was thoroughly assessed and genuinely scored low. So the evidence basis is published alongside: how many governed facts are backed by a record, how many are adverse, and how many connected sources contributed.',
      'The limitations are published too, in plain words. If no live government or partner source is connected for a vehicle, the score says so. CarUp does not estimate a sub-score for a signal it has no record of, and it does not fill a gap with a plausible average.',
      'One consequence is worth stating directly: CarUp publishes no vehicle valuation. There is no "current value", no depreciation curve and no market range, because we hold no governed source that would make such a number true.',
    ],
    category: 'Trust',
    date: 'August 2026',
    byline: CARUP_EDITORIAL,
    readTime: '4 min read',
    accentColor: 'from-orange-500 to-amber-500',
    classification: {
      kind: 'governed_capability',
      capability: 'canonicalTrustService — versioned trust decisions with evaluation state, band, confidence, evidence basis and known limitations',
    },
    context: [
      { label: 'Calculation version', value: 'trust-decision-1.0.0' },
      { label: 'Valuation published', value: 'None' },
    ],
  },
  {
    id: 'evidence-versus-listing-photos',
    title: 'Why your listing photos are not evidence — and why CarUp keeps them apart',
    excerpt:
      'A photograph a seller uploads to advertise a car and a document CarUp has reviewed are different kinds of thing. Collapsing them is how a gallery starts to look like a verification.',
    description:
      'Listing media and verified evidence are separate concepts in the CarUp Passport. This explains the distinction and what each one can and cannot support.',
    content: [
      'A vehicle Passport shows two collections that are easy to confuse. Listing photos are supplied by the seller to advertise the vehicle. CarUp does not review them and makes no claim about what they show. Verified evidence is a governed artifact — a registration document, an inspection, a clearance — that has been through a review decision and carries its own provenance.',
      'They are stored separately, published separately, and shown in separate sections. A listing photo can never appear as verified evidence, and evidence is never used to dress a gallery.',
      'The gating differs too. Only verified evidence is ever published. A document that has been uploaded but not yet reviewed stays pending and stays private to its owner — an unreviewed document is not a weaker claim, it is not a claim at all. Equally, a draft listing publishes no gallery, because photos attached to something that is not for sale are not an advertisement.',
      'Absence is stated rather than implied. Where a vehicle has no verified evidence, the Passport says so explicitly. It does not render an empty section that a reader could mistake for a clean bill of health.',
    ],
    category: 'Trust',
    date: 'August 2026',
    byline: CARUP_EDITORIAL,
    readTime: '3 min read',
    accentColor: 'from-blue-500 to-cyan-500',
    classification: {
      kind: 'governed_capability',
      capability: 'vehicleMediaProjection + evidence projection — listing media and verified evidence are disjoint, publication-gated collections',
    },
    context: [
      { label: 'Unreviewed documents', value: 'Never published' },
      { label: 'Draft listings', value: 'No public gallery' },
    ],
  },
  {
    id: 'why-a-listing-can-refuse-to-publish',
    title: 'Why a listing can refuse to publish, and how to read the reason',
    excerpt:
      'CarUp will not publish a listing whose blocking requirements are unresolved. The refusal now names which requirement, and distinguishes something you still owe from something we are still reviewing.',
    description:
      'The publication gate, what it checks, and the difference between a missing requirement and one awaiting verification.',
    content: [
      'Before a vehicle can be listed publicly, CarUp evaluates its completeness against a set of requirements. Some are blocking — an ownership or registration document among them — and a listing whose blocking requirements are unresolved cannot be published. The gate is enforced on the server, so it cannot be bypassed from a browser.',
      'A refusal distinguishes two very different situations. A requirement can be MISSING, meaning CarUp holds nothing for it and the owner needs to supply it. Or it can be AWAITING VERIFICATION, meaning the owner has already supplied it and CarUp has not finished reviewing it.',
      'That distinction matters more than it might appear. Telling an owner a document is "missing" when it is sitting in the review queue sends them to re-upload a file we already hold, and quietly suggests we lost it. So the two are named separately, and where the outstanding work is ours, the message says there is nothing further needed from the owner until the review completes.',
      'A vehicle stays in draft until the requirement is genuinely resolved. Publication is never granted to clear a warning.',
    ],
    category: 'Marketplace',
    date: 'August 2026',
    byline: CARUP_EDITORIAL,
    readTime: '3 min read',
    accentColor: 'from-emerald-500 to-teal-500',
    classification: {
      kind: 'governed_capability',
      capability: 'completenessEvaluator + POST /api/vehicles/:vin/publish — server-enforced publication gate with blocking_gaps / pending_gaps disclosure',
    },
    context: [
      { label: 'Gate enforced', value: 'Server-side' },
      { label: 'Refusal detail', value: 'Names the requirement' },
    ],
  },
  {
    id: 'unknown-stays-unknown',
    title: 'Unknown stays unknown: the rule behind every blank field on CarUp',
    excerpt:
      'A missing fact is never filled with a plausible one. No default city, no default fuel type, no default date, no fabricated phone number.',
    description:
      'Why CarUp prints "not recorded" instead of a sensible-looking guess, and what each absence state means.',
    content: [
      'The most damaging thing a vehicle platform can do is make a missing fact look like a known one. A blank location that becomes a country. A missing transmission that becomes "Automatic". A record-creation timestamp that becomes a purchase date. Each is individually small and collectively corrosive, because a reader cannot tell which fields were measured.',
      'So CarUp states absence. A field CarUp holds no record for reads "not recorded". A field deliberately kept private reads "withheld" — a different state, kept distinct, because collapsing the two would make "we hold nothing" and "you may not see this" look identical.',
      'This extends to contact details. Where a seller has published no number, the page says so and the call action is disabled. It does not substitute a platform number or a placeholder.',
      'It extends to images. Where a listing photo cannot be loaded, CarUp shows a neutral placeholder that says the image is unavailable. It does not substitute a stock photograph of a similar car, because a photograph of a different vehicle is a statement about this one.',
    ],
    category: 'Trust',
    date: 'August 2026',
    byline: CARUP_EDITORIAL,
    readTime: '3 min read',
    accentColor: 'from-purple-500 to-fuchsia-500',
    classification: {
      kind: 'governed_capability',
      capability: 'publicVehicleProjection claim states — recorded / not_recorded / withheld / not_applicable, with no defaulting',
    },
    context: [
      { label: 'Absence states', value: 'recorded · not recorded · withheld' },
      { label: 'Stock-photo substitution', value: 'Never' },
    ],
  },
  {
    id: 'regulatory-guidance',
    title: 'Zimbabwean licensing, duty and insurance guidance',
    excerpt:
      'We are not publishing regulatory guidance until we can source every figure from the issuing authority and keep it current.',
    description:
      'Licensing fees, import duty bands and insurance requirements change, and a stale or unsourced figure is worse than none.',
    content: [],
    category: 'Regulations',
    date: 'August 2026',
    byline: CARUP_EDITORIAL,
    readTime: '—',
    accentColor: 'from-slate-500 to-slate-600',
    classification: { kind: 'unavailable' },
  },
]

/** The honest empty state for an `unavailable` article, so the surface never renders a blank body. */
export const UNAVAILABLE_BODY =
  'CarUp has not published this yet. Licensing fees, duty bands and insurance requirements change, '
  + 'and each figure has to be traceable to the authority that issued it and kept current. Until we '
  + 'can do that, we would rather show you nothing than a number you might rely on. We will publish '
  + 'this once it can be sourced and maintained properly.'
