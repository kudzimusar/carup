import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import {
  ArrowLeft, Gauge, Calendar, FileText, Shield, CheckCircle,
  Wrench, Palette, Hash, Upload, Star, Loader2,
  Eye, EyeOff, Lock
} from 'lucide-react'

import { useCarUpApi } from '@/hooks/useCarUpApi'
import type {
  VehiclePassport,
  InsuranceRecord,
  VehicleEvidence,
  EvidenceTaxonomyResponse,
  EvidenceSource,
} from '@/types'
import EvidenceUploadModal from '@/components/EvidenceUploadModal'
import VehicleLifeStageTimeline from '@/components/VehicleLifeStageTimeline'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { statedMileage, statedPrice, statedDate } from './ownerStatedValues'
import { evidenceClassificationLabel, satisfiesOwnershipRegistration } from '@/lib/evidenceClassification'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { DataState, MoneyDisplay } from '@/components/truth'
import { OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION } from '@/components/owner/OwnerPageHeader'
import { OwnerListingMedia } from '@/components/listing/OwnerListingMedia'

// ── The canonical trust projection (Issue #164, ADR-001) ────────────────────
/**
 * This page used to render `passportData.trustReport?.trustScore || 0` as a percentage with a
 * filled progress bar. Two defects in one expression:
 *
 *   1. `trustReport.trustScore` was the DEPRECATED 70-baseline trustGraph engine's number. It is
 *      the "90" that disagreed with the marketplace's 84 and the trust route's 50 for one VIN.
 *   2. `|| 0` turned every absence into a measured zero, and the bar then drew that zero at 0%
 *      as though CarUp had assessed the vehicle and found nothing. Absence is not proof.
 *
 * `passport.trustReport` is now the canonical projection itself (server.js `canonicalPassportTrust`
 * → `toPublicTrust`), so the owner sees the same ten fields, from the same authority, as the public
 * vehicle detail page. A null score draws NO bar and no percentage.
 *
 * `evaluation_state` is the required discriminator below, which is what makes the OLD
 * `{vin, trustScore, metrics}` body parse as nothing rather than as a trust record — against a
 * server that has not been updated this page says "unavailable" instead of republishing the 90.
 */
type PublicTrust = {
  score: number | null
  band: string | null
  evaluation_state: string
  confidence: string
  calculation_version: string | null
  evaluated_at: string | null
  known_limitations: string[]
}

/**
 * Read the canonical projection. Narrowing only — nothing here computes a score, and no other
 * field on any response may stand in for one.
 */
function readPublicTrust(raw: unknown): PublicTrust | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>
  if (typeof t.evaluation_state !== 'string') return null
  return {
    score: typeof t.score === 'number' && Number.isFinite(t.score) ? t.score : null,
    band: typeof t.band === 'string' ? t.band : null,
    evaluation_state: t.evaluation_state,
    confidence: typeof t.confidence === 'string' ? t.confidence : 'not_evaluated',
    calculation_version: typeof t.calculation_version === 'string' ? t.calculation_version : null,
    evaluated_at: typeof t.evaluated_at === 'string' ? t.evaluated_at : null,
    known_limitations: Array.isArray(t.known_limitations)
      ? t.known_limitations.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

/** Band vocabulary, verbatim. No 'Excellent' / 'Good' / 'Fair' tier is invented here. */
const TRUST_BAND_LABELS: Record<string, string> = {
  high: 'High trust',
  moderate: 'Moderate trust',
  low: 'Low trust',
  insufficient_evidence: 'Insufficient evidence',
}
const TRUST_STATE_LABELS: Record<string, string> = {
  evaluated: 'Evaluated',
  stale: 'Assessment out of date',
  not_evaluated: 'Not evaluated',
  unavailable: 'Trust assessment unavailable',
}
const TRUST_STATE_DETAIL: Record<string, string> = {
  stale: 'This vehicle was last assessed under superseded rules, so the earlier score is withheld '
    + 'rather than shown as if it were current.',
  not_evaluated: 'CarUp has not produced a governed trust assessment for this vehicle yet. That is '
    + 'not a score of zero — add evidence and the assessment will follow.',
  unavailable: 'CarUp could not produce a trust assessment for this request.',
}
const TRUST_CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  not_evaluated: 'Confidence not assessed',
}

/* RX04-C — Vehicle Passport section primitives (unified presentation). */
function PassportSection({ id, title, count, action, children }: { id: string; title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-2xl bg-carup-bg-raised p-5 ring-1 ring-carup-line sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-[17px] font-semibold tracking-[-0.01em] text-carup-text">
          {title} <span className="ml-1 text-[13px] font-medium tabular-nums text-carup-text-3">{count}</span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function PassportEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-carup-bg-surface px-4 py-3.5 text-[14px] text-carup-text-2">{children}</p>
}

export default function VehicleProfile() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { fetchVehiclePassport, fetchVehicleEvidence, fetchEvidenceTaxonomy, fetchEvidenceSources } = useCarUpApi()
  const [passportData, setPassportData] = useState<VehiclePassport | null>(null)
  const [passportLoadState, setPassportLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [evidenceList, setEvidenceList] = useState<VehicleEvidence[]>([])
  const [evidenceLoadState, setEvidenceLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(() => searchParams.get('upload') === '1')

  // Deep-link support: /dashboard/garage/<vin>?upload=1 (e.g. from the completeness panel's
  // "Upload documents" action) opens the evidence upload modal on arrival — via the modal
  // state's lazy initializer below; the param is consumed when the modal closes so back/
  // refresh does not reopen it.
  // Vehicle Life Evidence Taxonomy (M1): drives the life-stage timeline grouping.
  const [evidenceTaxonomy, setEvidenceTaxonomy] = useState<EvidenceTaxonomyResponse | null>(null)
  const [evidenceSources, setEvidenceSources] = useState<EvidenceSource[]>([])

  const loadEvidence = useCallback(() => {
    if (!id) return
    fetchVehicleEvidence(id)
      .then(data => {
        setEvidenceList(data || [])
        setEvidenceLoadState('ready')
      })
      .catch(err => {
        console.error('Error fetching vehicle evidence:', err)
        setEvidenceLoadState('error')
      })
  }, [fetchVehicleEvidence, id])

  const loadPassport = useCallback(() => {
    if (!id) return
    fetchVehiclePassport(id)
      .then(data => {
        setPassportData(data)
        setPassportLoadState('ready')
      })
      .catch(err => {
        console.error('Error fetching passport details:', err)
        setPassportData(null)
        setPassportLoadState('error')
      })
  }, [fetchVehiclePassport, id])

  useEffect(() => {
    if (!id) return
    loadPassport()
    loadEvidence()
  }, [id, loadPassport, loadEvidence])

  useEffect(() => {
    let mounted = true
    Promise.allSettled([fetchEvidenceTaxonomy(), fetchEvidenceSources()]).then(([tax, src]) => {
      if (!mounted) return
      if (tax.status === 'fulfilled') setEvidenceTaxonomy(tax.value)
      if (src.status === 'fulfilled') setEvidenceSources(src.value.sources || [])
    })
    return () => { mounted = false }
  }, [fetchEvidenceTaxonomy, fetchEvidenceSources])


  const unified = isUnifiedUiEnabled()
  const retryAll = () => {
    setPassportLoadState('loading')
    setEvidenceLoadState('loading')
    loadPassport()
    loadEvidence()
  }
  // RX06-LR04 (RX-04 gate correction): the workspace shell already provides <main>; the Passport is a labelled
  // section inside it, never a second main landmark (axe landmark-no-duplicate-main / landmark-main-is-top-level).
  if (unified && !passportData) {
    return (
      <section className="mx-auto w-full max-w-[1320px] space-y-4" aria-labelledby="passport-state-title" data-presentation="rx04">
        <Link to="/dashboard/garage" className={`inline-flex min-h-11 items-center gap-2 rounded-full text-[14px] font-semibold text-carup-text-2 hover:text-carup-text ${OWNER_FOCUS}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My garage
        </Link>
        <h1 id="passport-state-title" className="sr-only">Vehicle Passport</h1>
        {passportLoadState === 'error'
          ? <DataState state="error" subject="Vehicle Passport" description="CarUp could not load this Passport. This does not mean the vehicle has no records." action={{ label: 'Retry Passport', onClick: retryAll }} />
          : <DataState state="loading" subject="Vehicle Passport" />}
      </section>
    )
  }

  if (!passportData && passportLoadState === 'error') {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-8" aria-labelledby="passport-error-title">
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-6 text-center" role="alert">
            <h1 id="passport-error-title" className="text-lg font-semibold text-gray-900">Vehicle Passport unavailable</h1>
            <p className="mt-2 text-sm text-gray-700">
              CarUp could not load this Passport. This does not mean the vehicle has no records.
            </p>
            <Button className="mt-4 min-h-11" variant="outline" onClick={() => {
              setPassportLoadState('loading')
              setEvidenceLoadState('loading')
              loadPassport()
              loadEvidence()
            }}>
              Retry Passport
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!passportData) {
    return (
      <div className="flex items-center justify-center gap-3 p-12" role="status" aria-live="polite">
        <Loader2 className="w-8 h-8 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
        <span className="sr-only">Loading Vehicle Passport</span>
      </div>
    )
  }

  const documentTypes = [
    'registration_document',
    'insurance_document',
    'police_clearance_document',
    'ownership_transfer_document',
    // Canonical-first uploads with no exact legacy counterpart carry the
    // generic document compatibility value (Operations M1).
    'vehicle_life_document'
  ]

  // Owner per-VIN view-model. Every field is the value the canonical passport actually published, or
  // null — NEVER a fabricated stand-in. No stock image, no `price * 0.9` valuation CarUp never made,
  // no "today" purchase date, no invented garage/manufacturer. Absent values render as words.
  const pv = passportData.vehicle ?? {}
  const numOrNull = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : null)

  /**
   * The passport publishes listing photos in the canonical top-level `listing_media` block, NOT on
   * `vehicle.image_url`. Reading only the latter showed "Image unavailable" for vehicles that do have
   * a published gallery. Prefer the seller's primary photo, else the first published item, and fall
   * back to `image_url` only if the block carries nothing.
   */
  // Selection lives in one place (web/src/lib/listingMedia.ts) so this header, the garage card, the
  // listings row and the dashboard row cannot disagree about which photograph is primary.
  const primaryListingImage = primaryListingImageUrl(
    (passportData as { listing_media?: unknown }).listing_media,
  )
  const vehicle = {
    make: pv.make || null,
    model: pv.model || null,
    year: pv.year || null,
    vin: pv.vin || id || '',
    mileage: numOrNull(pv.mileage),
    color: pv.color || null,
    price: numOrNull(pv.price),
    imageUrl: primaryListingImage ?? pv.image_url ?? null,
    registration: pv.vin || id || '',
    engineNumber: pv.engine_number || null,
    // NO purchase date. `vehicles.created_at` is the row-insert timestamp — a fact about CarUp's
    // database, not about when this owner acquired the vehicle — and it was rendered under the label
    // "Purchased". No governed acquisition claim exists anywhere in the contract or the schema
    // (measured: `vehicles` has no purchase_date / acquired_at / owned_since column), so the tile
    // states that it is not recorded rather than relabelling another timestamp.
    purchaseDate: null as string | null,
    documents: (evidenceList || [])
      .filter((item) => documentTypes.includes(item.evidence_type))
      .map((item) => ({
        id: item.id,
        title: evidenceClassificationLabel(item),
        date: statedDate(item.captured_at || item.uploaded_at) ?? 'Date not recorded',
        status: item.verification_status
      })),
    // Populated from the passport's governed insurance timeline. It was a hardcoded `[]`, so the
    // Insurance tab was unconditionally empty while Golden A holds one active policy — a silent
    // false absence on the very surface Cluster D designates as the source of truth.
    insuranceRecords: (passportData.timeline || [])
      .filter((e) => e.event_source === 'insurance')
      .map((e) => ({
        id: e.id,
        insurer: e.label ?? null,
        policyNumber: null as string | null,
        startDate: statedDate(e.timestamp) ?? 'Date not recorded',
        status: 'recorded',
      })) as InsuranceRecord[],
    // PARTS and SERVICES ARE NOT THE SAME EVENTS. Both collections used to filter
    // `event_source === 'service'`, and the only 'service'-sourced timeline entries are PartSentry
    // part logs — so Golden A's single part log was published as "Total Services 1 AND Total Parts 1",
    // one row counted twice, while My Garage said 0 of each. Services come from mechanic-signed work
    // orders; a part fitted is a part.
    serviceHistory: (passportData.timeline || [])
      .filter((e) => e.event_source === 'service' && String(e.id ?? '').startsWith('workorder:'))
      .map((e) => ({
        id: e.id,
        serviceType: e.label,
        garage: e.details?.notes || null,
        date: statedDate(e.timestamp) ?? 'Date not recorded',
        mileage: numOrNull(e.details?.mileage),
        description: e.details?.notes || null,
        cost: numOrNull(e.details?.cost)
      })),
    partsHistory: (passportData.timeline || [])
      .filter((e) => e.event_source === 'service' && String(e.id ?? '').startsWith('partsentry:'))
      .map((e) => ({
        id: e.id,
        name: e.label,
        manufacturer: null as string | null,
        type: null as string | null,
        installedDate: statedDate(e.timestamp) ?? 'Date not recorded',
        cost: numOrNull(e.details?.cost)
      }))
  }

  /**
   * GOVERNED FACTS BEHIND THE THREE CLAIM BADGES.
   *
   * Each is the narrowest fact that can honestly support its badge, read from the same canonical
   * definition the rest of the platform uses. A badge that cannot be grounded is not rendered.
   */

  // The verified set is `ownerGarageCounts`' set (backend/server.js), not a second opinion: a
  // document counts as verified here exactly when it counts there.
  const VERIFIED_EVIDENCE_STATUSES = ['verified', 'confirmed', 'approved']

  // "Logbook" is the ownership/registration artifact. `pending`, `rejected` and an absent document
  // are all NOT verified, and none of them renders the badge. Semantics are
  // canonical-first (Operations M1): a canonical import document stored under a
  // legacy registration_document compatibility value must never light this badge.
  const hasVerifiedLogbook = (evidenceList || []).some(
    (item) =>
      satisfiesOwnershipRegistration(item)
      && VERIFIED_EVIDENCE_STATUSES.includes(String(item.verification_status ?? '')),
  )

  // A policy ROW is not an ACTIVE policy. `details.active` is `insurance_records.active`, carried
  // through the trust graph for exactly this decision; `=== true` so a null never reads as active.
  const hasActiveInsurance = (passportData.timeline || []).some(
    (e) => e.event_source === 'insurance' && (e.details as { active?: boolean } | undefined)?.active === true,
  )

  // Grounded in the same `partsentry:`-prefixed timeline rows that produce the parts history and
  // the "parts" garage count — one PartSentry log, counted once, in all three places.
  const hasPartSentryActivity = vehicle.partsHistory.length > 0

  // The canonical projection the passport published. `readPublicTrust` returns null for anything
  // that is not one — including the deprecated `{trustScore, metrics}` body — so there is no path
  // by which the old engine's number becomes this page's score.
  const publicTrust = readPublicTrust(passportData.trustReport)

  // A score exists only in the `evaluated` state. Anything else yields null here, and null renders
  // as words — never as a number, a percentage, or a bar drawn at 0%.
  const trustScore = publicTrust?.evaluation_state === 'evaluated' ? publicTrust.score : null
  const trustState = publicTrust?.evaluation_state ?? 'unavailable'
  const trustHeadline = trustScore !== null
    ? (TRUST_BAND_LABELS[publicTrust?.band ?? ''] ?? publicTrust?.band ?? TRUST_STATE_LABELS.evaluated)
    : (TRUST_STATE_LABELS[trustState] ?? TRUST_STATE_LABELS.unavailable)
  const trustDetail = trustScore !== null
    ? (publicTrust?.band === 'insufficient_evidence'
      ? 'CarUp evaluated this vehicle and found too little authoritative evidence to support a '
        + 'higher score. This is a measured result, not a missing one.'
      : 'Published by CarUp’s trust authority under its current calculation rules.')
    : (TRUST_STATE_DETAIL[trustState] ?? TRUST_STATE_DETAIL.unavailable)

  if (unified) {
    const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle details not recorded'
    const statusTone = (status: unknown) => {
      const v = String(status ?? '')
      if (v === 'verified') return 'bg-status-success-soft text-status-success'
      if (v === 'rejected') return 'bg-status-danger-soft text-status-danger'
      return 'bg-status-warning-soft text-status-warning'
    }
    const statusLabel = (status: unknown) => {
      const v = String(status ?? '')
      if (v === 'verified') return 'Verified'
      if (v === 'rejected') return 'Rejected'
      if (v === 'pending') return 'Pending review'
      return v ? v.replace(/_/g, ' ') : 'Status not recorded'
    }
    const SECTIONS = [
      { id: 'passport-documents', label: 'Documents', count: vehicle.documents.length },
      { id: 'passport-service', label: 'Service', count: vehicle.serviceHistory.length },
      { id: 'passport-insurance', label: 'Insurance', count: vehicle.insuranceRecords.length },
      { id: 'passport-parts', label: 'Parts', count: vehicle.partsHistory.length },
      { id: 'passport-evidence', label: 'Evidence & timeline', count: evidenceList.length },
    ]
    const serviceCostTotal = vehicle.serviceHistory.reduce((a, s) => a + (s.cost ?? 0), 0)
    const anyServiceCost = vehicle.serviceHistory.some(s => s.cost !== null)
    const uploadButton = (label = 'Upload evidence') => (
      <button type="button" onClick={() => setIsUploadModalOpen(true)} className={OWNER_SECONDARY_ACTION}>
        <Upload className="h-4 w-4" aria-hidden="true" /> {label}
      </button>
    )

    return (
      <section className="mx-auto w-full max-w-[1320px] space-y-6" aria-labelledby="vehicle-passport-title" data-presentation="rx04" data-testid="vehicle-passport-unified">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/dashboard/garage" className={`inline-flex min-h-11 items-center gap-2 rounded-full text-[14px] font-semibold text-carup-text-2 hover:text-carup-text ${OWNER_FOCUS}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My garage
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link to="/dashboard/listings" className={OWNER_SECONDARY_ACTION}>My listings</Link>
            <Link to={`/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}`} className={OWNER_PRIMARY_ACTION}>Edit or continue listing</Link>
          </div>
        </div>

        <section className="grid overflow-hidden rounded-3xl bg-carup-bg-raised ring-1 ring-carup-line lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="relative bg-carup-bg-surface">
            <OwnerListingMedia
              media={(passportData as { listing_media?: unknown }).listing_media}
              alt={`${name} listing photo`}
              className="aspect-[16/10] h-full w-full lg:aspect-auto lg:min-h-[22rem]"
              imgClassName="h-full w-full object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-5 p-5 sm:p-7">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-action">Vehicle Passport</p>
              <h1 id="vehicle-passport-title" className="mt-1 text-[clamp(1.5rem,2.6vw,2.1rem)] font-bold leading-tight tracking-[-0.025em] text-carup-text">{name}</h1>
              <p className="mt-1 font-mono text-[12px] text-carup-text-3">VIN {vehicle.vin}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-carup-line py-4 text-[14px]">
              {[
                { label: 'Mileage', value: statedMileage(vehicle.mileage) },
                { label: 'Colour', value: vehicle.color ?? 'Not recorded' },
                { label: 'Engine number', value: vehicle.engineNumber ?? 'Not recorded' },
                { label: 'Owned since', value: vehicle.purchaseDate ?? 'Not recorded' },
              ].map(f => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[12px] text-carup-text-3">{f.label}</dt>
                  <dd className="truncate font-medium text-carup-text">{f.value}</dd>
                </div>
              ))}
            </dl>

            <div data-testid="owner-trust" aria-labelledby="owner-trust-heading">
              <div className="flex items-baseline justify-between gap-3">
                <span id="owner-trust-heading" className="text-[14px] font-semibold text-carup-text">CarUp Trust</span>
                {trustScore !== null
                  ? <span className="text-[20px] font-semibold tabular-nums text-carup-text" data-testid="owner-trust-score">{trustScore} / 100</span>
                  : <span className="text-[14px] font-semibold text-carup-text-2" data-testid="owner-trust-state">{trustHeadline}</span>}
              </div>
              {trustScore !== null ? (
                <>
                  <Progress value={trustScore} className="mt-2 h-2" aria-label="CarUp Trust score" />
                  <p className="mt-1.5 text-[13px] text-carup-text-2" data-testid="owner-trust-band">
                    {trustHeadline} · {TRUST_CONFIDENCE_LABELS[publicTrust?.confidence ?? ''] ?? 'Confidence not assessed'}
                    {publicTrust?.calculation_version ? ` · calculation version ${publicTrust.calculation_version}` : ''}
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-[13px] text-carup-text-2" data-testid="owner-trust-detail">{trustDetail}</p>
              )}
              {(publicTrust?.known_limitations.length ?? 0) > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-carup-text-2" data-testid="owner-trust-limitations">
                  {publicTrust?.known_limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2" data-testid="vehicle-claim-badges">
              {hasVerifiedLogbook && <span className="inline-flex items-center gap-1 rounded-full bg-status-success-soft px-2.5 py-1 text-[12px] font-semibold text-status-success" data-testid="badge-logbook-verified"><CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Logbook verified</span>}
              {hasActiveInsurance && <span className="inline-flex items-center gap-1 rounded-full bg-status-info-soft px-2.5 py-1 text-[12px] font-semibold text-status-info" data-testid="badge-insurance-active"><Shield className="h-3.5 w-3.5" aria-hidden="true" /> Insurance active</span>}
              {hasPartSentryActivity && <span className="inline-flex items-center gap-1 rounded-full bg-status-neutral-soft px-2.5 py-1 text-[12px] font-semibold text-status-neutral" data-testid="badge-partsentry-active"><Star className="h-3.5 w-3.5" aria-hidden="true" /> PartSentry active</span>}
              {passportData?.chainVerification?.verified && (passportData.chainVerification.count ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-carup-action-soft px-2.5 py-1 text-[12px] font-semibold text-carup-action-hover" data-testid="badge-ledger-synced"><CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Ledger synced</span>
              )}
            </div>
          </div>
        </section>

        <nav aria-label="Passport sections" className="sticky top-0 z-10 -mx-1 flex gap-2 overflow-x-auto bg-carup-bg px-1 py-2">
          {SECTIONS.map(sec => (
            <a key={sec.id} href={`#${sec.id}`} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-carup-bg-raised px-4 text-[14px] font-semibold text-carup-text ring-1 ring-carup-line hover:ring-carup-text-3 ${OWNER_FOCUS}`}>
              {sec.label} <span className="tabular-nums text-carup-text-3">{sec.count}</span>
            </a>
          ))}
        </nav>

        {evidenceLoadState === 'error' && (
          <div data-testid="passport-evidence-unavailable">
            <DataState state="error" subject="Evidence" description="Evidence records could not be loaded. This is not a statement that no evidence exists." action={{ label: 'Retry evidence', onClick: loadEvidence }} />
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            <PassportSection id="passport-documents" title="Documents" count={vehicle.documents.length} action={uploadButton('Upload document')}>
              {evidenceLoadState === 'ready' && vehicle.documents.length === 0 && <PassportEmpty>No document records are available to CarUp for this vehicle.</PassportEmpty>}
              <ul className="divide-y divide-carup-line">
                {vehicle.documents.map(doc => (
                  <li key={doc.id} className="flex items-center gap-3 py-3">
                    <FileText className="h-5 w-5 shrink-0 text-carup-action" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-carup-text">{doc.title}</p>
                      <p className="text-[12px] text-carup-text-3">{doc.date}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${statusTone(doc.status)}`}>{statusLabel(doc.status)}</span>
                  </li>
                ))}
              </ul>
            </PassportSection>

            <PassportSection id="passport-service" title="Service history" count={vehicle.serviceHistory.length}>
              {vehicle.serviceHistory.length === 0 && <PassportEmpty>No service records are available to CarUp for this vehicle.</PassportEmpty>}
              <ol className="relative space-y-4 border-l border-carup-line pl-5">
                {vehicle.serviceHistory.map(sv => (
                  <li key={sv.id} className="relative">
                    <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-carup-action" aria-hidden="true" />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[14px] font-semibold text-carup-text">{sv.serviceType}</p>
                      {sv.cost !== null ? <MoneyDisplay amount={sv.cost} currency={null} /> : <span className="text-[13px] text-carup-text-3">Cost not recorded</span>}
                    </div>
                    <p className="text-[13px] text-carup-text-2">{sv.garage ?? 'Garage not recorded'} · {sv.date} · {statedMileage(sv.mileage)}</p>
                    {sv.description && <p className="mt-1 text-[13px] text-carup-text-2">{sv.description}</p>}
                  </li>
                ))}
              </ol>
            </PassportSection>

            <PassportSection id="passport-insurance" title="Insurance" count={vehicle.insuranceRecords.length}>
              {vehicle.insuranceRecords.length === 0 && <PassportEmpty>No insurance records are available to CarUp for this vehicle.</PassportEmpty>}
              <ul className="space-y-3">
                {vehicle.insuranceRecords.map(ir => (
                  <li key={ir.id} className="rounded-xl bg-carup-bg-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-carup-text" data-testid="insurance-record-insurer"><Shield className="h-4 w-4 text-status-info" aria-hidden="true" />{ir.insurer || 'Insurer not recorded'}</span>
                      <span className="rounded-full bg-carup-bg-raised px-2.5 py-0.5 text-[12px] font-semibold text-carup-text-2">{ir.status}</span>
                    </div>
                    <p className="mt-1.5 text-[13px] text-carup-text-2" data-testid="insurance-record-policy">Policy: {ir.policyNumber || 'not recorded'}</p>
                    <p className="text-[13px] text-carup-text-2" data-testid="insurance-record-dates">{ir.startDate}{ir.expiryDate ? ` to ${ir.expiryDate}` : ' — end date not recorded'}</p>
                    <p className="mt-2 text-[12px] text-carup-text-3">Cover type and premium are not held by CarUp for this record. Their absence here is not a statement about the policy.</p>
                  </li>
                ))}
              </ul>
            </PassportSection>

            <PassportSection id="passport-parts" title="Parts" count={vehicle.partsHistory.length}>
              {vehicle.partsHistory.length === 0 && <PassportEmpty>No parts records are available to CarUp for this vehicle.</PassportEmpty>}
              <ul className="divide-y divide-carup-line">
                {vehicle.partsHistory.map(part => (
                  <li key={part.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-carup-text">{part.name}</p>
                      <p className="text-[12px] text-carup-text-3">{[part.manufacturer, part.type ?? 'Type not recorded', part.installedDate].filter(Boolean).join(' · ')}</p>
                    </div>
                    {part.cost !== null ? <MoneyDisplay amount={part.cost} currency={null} /> : <span className="text-[13px] text-carup-text-3">Cost not recorded</span>}
                  </li>
                ))}
              </ul>
            </PassportSection>

            <PassportSection id="passport-evidence" title="Evidence and life timeline" count={evidenceList.length} action={uploadButton()}>
              <p className="mb-4 text-[13px] text-carup-text-2">Photographs and documents that support this car’s condition and identity.</p>
              {evidenceList.length > 0 && (
                <div className="mb-5">
                  <h3 className="mb-3 text-[14px] font-semibold text-carup-text">Vehicle life timeline</h3>
                  <VehicleLifeStageTimeline evidence={evidenceList} taxonomy={evidenceTaxonomy} sources={evidenceSources} />
                </div>
              )}
              {evidenceLoadState === 'error' ? (
                <PassportEmpty>Evidence is temporarily unavailable. No absence conclusion is being made.</PassportEmpty>
              ) : evidenceList.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-carup-line-strong px-5 py-8 text-center">
                  <FileText className="mx-auto h-10 w-10 text-carup-text-3" aria-hidden="true" />
                  <h3 className="mt-3 text-[15px] font-semibold text-carup-text">No evidence records available to CarUp</h3>
                  <p className="mx-auto mt-1 max-w-sm text-[13px] text-carup-text-2">This does not prove that no evidence exists. Add photographs or documents such as odometer captures, damage records or registration certificates.</p>
                  <div className="mt-4 flex justify-center">{uploadButton()}</div>
                </div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {evidenceList.map(item => (
                    <li key={item.id} className="flex gap-3 rounded-xl bg-carup-bg-surface p-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-carup-bg-surface-2">
                        {!documentTypes.includes(item.evidence_type) && item.file_url
                          ? <img src={item.file_url} alt={`${evidenceClassificationLabel(item)} evidence preview`} className="h-full w-full object-cover" loading="lazy" />
                          : <span className="flex h-full w-full items-center justify-center text-carup-text-3"><FileText className="h-6 w-6" aria-hidden="true" /></span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-carup-text">{evidenceClassificationLabel(item)}</p>
                        {item.verification_notes && <p className="mt-0.5 line-clamp-2 text-[12px] italic text-carup-text-2">“{item.verification_notes}”</p>}
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                          {['verified', 'rejected', 'pending'].includes(String(item.verification_status)) && <span className={`rounded-full px-2 py-0.5 ${statusTone(item.verification_status)}`}>{statusLabel(item.verification_status)}</span>}
                          {item.visibility_level === 'public_safe' && <span className="inline-flex items-center gap-1 rounded-full bg-status-info-soft px-2 py-0.5 text-status-info"><Eye className="h-3 w-3" aria-hidden="true" /> Public</span>}
                          {item.visibility_level === 'restricted' && <span className="inline-flex items-center gap-1 rounded-full bg-status-warning-soft px-2 py-0.5 text-status-warning"><EyeOff className="h-3 w-3" aria-hidden="true" /> Restricted</span>}
                          {item.visibility_level === 'private' && <span className="inline-flex items-center gap-1 rounded-full bg-carup-bg-raised px-2 py-0.5 text-carup-text-2"><Lock className="h-3 w-3" aria-hidden="true" /> Private</span>}
                          {item.linked_registry_event_id && <span className="rounded-full bg-carup-bg-raised px-2 py-0.5 text-carup-text-2">Linked</span>}
                        </div>
                        <p className="mt-1 text-[11px] text-carup-text-3">Uploaded {statedDate(item.uploaded_at) ?? 'date not recorded'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </PassportSection>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-16 xl:self-start">
            <section className="rounded-2xl bg-carup-bg-raised p-5 ring-1 ring-carup-line" aria-labelledby="passport-summary-title">
              <h2 id="passport-summary-title" className="text-[15px] font-semibold text-carup-text">Summary</h2>
              <dl className="mt-3 space-y-2 text-[14px]">
                <div className="flex justify-between gap-3"><dt className="text-carup-text-2">Recorded price</dt><dd className="text-right">{statedPrice(vehicle.price)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-carup-text-2">Services</dt><dd className="tabular-nums">{vehicle.serviceHistory.length}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-carup-text-2">Parts</dt><dd className="tabular-nums">{vehicle.partsHistory.length}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-carup-text-2">Recorded service cost</dt><dd className="text-right">{anyServiceCost ? <MoneyDisplay amount={serviceCostTotal} currency={null} /> : 'Not recorded'}</dd></div>
              </dl>
            </section>
            <section className="rounded-2xl bg-carup-bg-raised p-5 ring-1 ring-carup-line" aria-labelledby="passport-next-title">
              <h2 id="passport-next-title" className="text-[15px] font-semibold text-carup-text">For this car</h2>
              <ul className="mt-2 space-y-1 text-[14px]">
                {[
                  { label: 'Ask Gutu AI about it', href: '/dashboard/ai' },
                  { label: 'Service history across your cars', href: '/dashboard/service-history' },
                  { label: 'Insurance records', href: '/dashboard/insurance' },
                  { label: 'PartSentry parts', href: '/dashboard/partsentry' },
                  { label: 'All your evidence', href: '/dashboard/evidence' },
                ].map(l => (
                  <li key={l.href}><Link to={l.href} className={`flex min-h-10 items-center justify-between rounded-md text-carup-text hover:text-carup-action-hover ${OWNER_FOCUS}`}>{l.label}<ArrowLeft className="h-3.5 w-3.5 rotate-180 text-carup-text-3" aria-hidden="true" /></Link></li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        <EvidenceUploadModal
          isOpen={isUploadModalOpen}
          onClose={() => {
            setIsUploadModalOpen(false)
            if (searchParams.get('upload') === '1') {
              const next = new URLSearchParams(searchParams)
              next.delete('upload')
              setSearchParams(next, { replace: true })
            }
          }}
          vin={vehicle.vin}
          timelineEvents={passportData.timeline || []}
          onSuccess={() => {
            setEvidenceLoadState('loading')
            setPassportLoadState('loading')
            loadEvidence()
            loadPassport()
          }}
        />
      </section>
    )
  }

  return (
    <main className="space-y-6 max-w-7xl mx-auto px-3 sm:px-0" aria-labelledby="vehicle-passport-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="gap-1" asChild>
          <Link to="/dashboard/garage"><ArrowLeft className="w-4 h-4" /> Back to Garage</Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to={`/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}`}>Edit / continue listing</Link>
          </Button>
          <Button size="sm" className="bg-orange-700 hover:bg-orange-800" asChild>
            <Link to="/dashboard/listings">Listing &amp; Marketplace</Link>
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 card-shadow overflow-hidden">
            <div className="relative h-56">
              <ListingImage
                src={vehicle.imageUrl}
                alt={`${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'} listing photo`}
                className="h-full w-full"
                imgClassName="h-56"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <div className="flex items-center gap-2 mb-1">
                  <h1 id="vehicle-passport-title" className="text-xl sm:text-2xl font-bold">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle details not recorded'}</h1>
                  <Badge className="bg-white/20 text-white">{vehicle.registration}</Badge>
                </div>
                <p className="text-sm text-gray-200">VIN: {vehicle.vin}</p>
              </div>
            </div>
            <CardContent className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                {[
                  { icon: Gauge, label: 'Mileage', value: statedMileage(vehicle.mileage) },
                  { icon: Palette, label: 'Color', value: vehicle.color ?? 'Not recorded' },
                  { icon: Hash, label: 'Engine No.', value: vehicle.engineNumber ?? 'Not recorded' },
                  { icon: Calendar, label: 'Purchased', value: vehicle.purchaseDate ?? 'Not recorded' },
                ].map((item) => (
                  <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
                    <item.icon className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                    <p className="text-xs text-gray-500">{item.label}</p>
                    <p className="font-semibold text-sm">{item.value}</p>
                  </div>
                ))}
              </div>

              <section className="mb-4" data-testid="owner-trust" aria-labelledby="owner-trust-heading">
                <div className="flex items-center justify-between mb-2">
                  <span id="owner-trust-heading" className="font-medium">Trust Score</span>
                  {trustScore !== null ? (
                    <span className="font-bold text-lg" data-testid="owner-trust-score">{trustScore} / 100</span>
                  ) : (
                    <span className="text-sm font-semibold text-gray-600" data-testid="owner-trust-state">
                      {trustHeadline}
                    </span>
                  )}
                </div>
                {trustScore !== null ? (
                  <>
                    <Progress value={trustScore} className="h-3" aria-label="CarUp Trust score" />
                    <p className="mt-1 text-xs text-gray-500" data-testid="owner-trust-band">
                      {trustHeadline} · {TRUST_CONFIDENCE_LABELS[publicTrust?.confidence ?? ''] ?? 'Confidence not assessed'}
                      {publicTrust?.calculation_version ? ` · calculation version ${publicTrust.calculation_version}` : ''}
                    </p>
                  </>
                ) : (
                  /* No progress bar at all. A bar is a measurement, and there is none to draw —
                     a 0%-filled track is exactly the absence-as-proof this page had before. */
                  <p className="text-xs text-gray-500" data-testid="owner-trust-detail">{trustDetail}</p>
                )}
                {(publicTrust?.known_limitations.length ?? 0) > 0 && (
                  <ul className="mt-2 list-disc list-inside space-y-1 text-xs text-gray-500" data-testid="owner-trust-limitations">
                    {publicTrust?.known_limitations.map((limitation, i) => (
                      <li key={i}>{limitation}</li>
                    ))}
                  </ul>
                )}
              </section>

              {/*
                * Every badge here is a POSITIVE VERIFICATION CLAIM, so each renders only when a
                * governed fact positively supports it.
                *
                * All three of these used to render unconditionally, with no data binding of any
                * kind. On a vehicle whose logbook is still `pending`, with no insurance policy and
                * no PartSentry log, this block asserted "Logbook Verified" in green with a
                * checkmark — directly beneath the governed trust panel above, which on the same
                * screen states "No governed vehicle fact is backed by an authoritative record."
                * One card, two contradictory claims, and the fabricated one was the reassuring one.
                *
                * No badge has a "false" rendering. Absence of a governed fact means the claim is
                * simply not made — it is not restated as a negative, because "not verified" and
                * "verified false" are different facts and only the first is known here.
                */}
              <div className="flex flex-wrap gap-2" data-testid="vehicle-claim-badges">
                {hasVerifiedLogbook && (
                  <Badge variant="secondary" className="bg-green-50 text-green-700" data-testid="badge-logbook-verified">
                    <CheckCircle className="w-3 h-3 mr-1" /> Logbook Verified
                  </Badge>
                )}
                {hasActiveInsurance && (
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700" data-testid="badge-insurance-active">
                    <Shield className="w-3 h-3 mr-1" /> Insurance Active
                  </Badge>
                )}
                {hasPartSentryActivity && (
                  <Badge variant="secondary" className="bg-purple-50 text-purple-700" data-testid="badge-partsentry-active">
                    <Star className="w-3 h-3 mr-1" /> PartSentry Active
                  </Badge>
                )}
                {/* RX03-P2: an EMPTY chain "verifies" vacuously (verifyChain returns {verified:true,count:0});
                    only claim a synced ledger when at least one recorded event was actually verified. */}
                {passportData?.chainVerification?.verified && (passportData.chainVerification.count ?? 0) > 0 && (
                  <Badge variant="secondary" className="bg-orange-50 text-orange-700 animate-pulse-glow motion-reduce:animate-none" data-testid="badge-ledger-synced">
                    <CheckCircle className="w-3 h-3 mr-1" /> Ledger Synced
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {evidenceLoadState === 'error' && (
            <Card className="border-amber-200 bg-amber-50" data-testid="passport-evidence-unavailable">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite">
                <p className="text-sm text-gray-700">
                  Evidence records could not be loaded. This is not a statement that no evidence exists.
                </p>
                <Button variant="outline" className="min-h-11 shrink-0" onClick={loadEvidence}>Retry evidence</Button>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="documents" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
              <TabsTrigger value="documents" className="min-h-11 px-2 text-xs sm:text-sm">Documents</TabsTrigger>
              <TabsTrigger value="service" className="min-h-11 px-2 text-xs sm:text-sm">Service History</TabsTrigger>
              <TabsTrigger value="insurance" className="min-h-11 px-2 text-xs sm:text-sm">Insurance</TabsTrigger>
              <TabsTrigger value="parts" className="min-h-11 px-2 text-xs sm:text-sm">Parts</TabsTrigger>
              <TabsTrigger value="evidence" className="min-h-11 px-2 text-xs sm:text-sm">Evidence & Media</TabsTrigger>
            </TabsList>
            <TabsContent value="documents" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5 space-y-3">
                  {evidenceLoadState === 'ready' && vehicle.documents.length === 0 && (
                    <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                      No document records are available to CarUp for this vehicle.
                    </p>
                  )}
                  {vehicle.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <FileText className="w-5 h-5 text-orange-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{doc.title}</p>
                        <p className="text-xs text-gray-500">{doc.date}</p>
                      </div>
                      <Badge className={doc.status === 'verified' ? 'bg-green-500 text-white' : doc.status === 'rejected' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}>
                        {doc.status}
                      </Badge>
                    </div>
                  ))}
                  <Button variant="outline" className="w-full gap-1" onClick={() => setIsUploadModalOpen(true)}>
                    <Upload className="w-4 h-4" /> Upload Document
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="service" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5 space-y-3">
                  {vehicle.serviceHistory.length === 0 && (
                    <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                      No service records are available to CarUp for this vehicle.
                    </p>
                  )}
                  {vehicle.serviceHistory.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <Wrench className="w-5 h-5 text-orange-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{s.serviceType}</p>
                        <p className="text-xs text-gray-500">{s.garage ?? 'Garage not recorded'} • {s.date} • {statedMileage(s.mileage)}</p>
                        {s.description && <p className="text-xs text-gray-600 mt-1">{s.description}</p>}
                      </div>
                      <span className="text-sm font-medium">{s.cost !== null ? `$${s.cost.toLocaleString()}` : '—'}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="insurance" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5 space-y-3">
                  {vehicle.insuranceRecords.length === 0 && (
                    <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                      No insurance records are available to CarUp for this vehicle.
                    </p>
                  )}
                  {vehicle.insuranceRecords.map((ir) => (
                    <div key={ir.id} className={`p-4 rounded-lg border ${ir.status === 'active' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                      {/* RENDER ONLY WHAT WAS RECORDED. This block read `ir.provider`, `ir.type`,
                          `ir.premium` and `ir.expiryDate`, none of which the passport timeline
                          mapper above sets — it sets `insurer`, and leaves `policyNumber` null. So
                          every governed insurance record rendered a blank provider, "Policy: ", a
                          bare "$/year" money token with no figure, and a dangling "… to ". A money
                          symbol with no amount is not a smaller fact than a premium; it is an
                          invented one, and the premium is not a field CarUp holds here at all. */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Shield className="w-5 h-5 text-green-600" />
                          <span className="font-medium" data-testid="insurance-record-insurer">
                            {ir.insurer || 'Insurer not recorded'}
                          </span>
                        </div>
                        <Badge className={ir.status === 'active' ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}>{ir.status}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2" data-testid="insurance-record-policy">
                        Policy: {ir.policyNumber || 'not recorded'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1" data-testid="insurance-record-dates">
                        {ir.startDate}
                        {ir.expiryDate ? ` to ${ir.expiryDate}` : ' — end date not recorded'}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        Cover type and premium are not held by CarUp for this record. Their absence
                        here is not a statement about the policy.
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="parts" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5">
                  <div className="overflow-x-auto" tabIndex={0} aria-label="Vehicle parts history table; scroll horizontally on compact screens">
                    <table className="w-full min-w-[34rem] text-sm">
                      <caption className="sr-only">Vehicle parts history</caption>
                      <thead>
                        <tr className="border-b">
                          <th scope="col" className="text-left py-2 font-medium text-gray-500">Part</th>
                          <th scope="col" className="text-left py-2 font-medium text-gray-500">Type</th>
                          <th scope="col" className="text-left py-2 font-medium text-gray-500">Date</th>
                          <th scope="col" className="text-right py-2 font-medium text-gray-500">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vehicle.partsHistory.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-4 text-sm text-gray-600">
                              No parts records are available to CarUp for this vehicle.
                            </td>
                          </tr>
                        )}
                        {vehicle.partsHistory.map((part) => (
                          <tr key={part.id} className="border-b last:border-0">
                            <td className="py-3">
                              <p className="font-medium">{part.name}</p>
                              {part.manufacturer && <p className="text-xs text-gray-500">{part.manufacturer}</p>}
                            </td>
                            <td className="py-3">{part.type ? <Badge variant="outline" className="text-xs">{part.type}</Badge> : <span className="text-xs text-gray-400">Not recorded</span>}</td>
                            <td className="py-3 text-gray-600">{part.installedDate}</td>
                            <td className="py-3 text-right font-medium">{part.cost !== null ? `$${part.cost.toLocaleString()}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="evidence" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5 space-y-4">
                  <div className="flex flex-col gap-3 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-800">Visual Evidence & Media</h3>
                      <p className="text-xs text-gray-500">Photographs and documentation proving the condition and identity of the vehicle.</p>
                    </div>
                    <Button onClick={() => setIsUploadModalOpen(true)} className="min-h-11 bg-orange-500 hover:bg-orange-600 text-white gap-2">
                      <Upload className="w-4 h-4" /> Upload Evidence
                    </Button>
                  </div>

                  {/* Vehicle life-stage timeline (M1): groups this owner's evidence by the eight life stages. */}
                  {evidenceList.length > 0 && (
                    <div className="pb-2">
                      <h4 className="font-semibold text-sm text-gray-800 mb-3">Vehicle Life Timeline</h4>
                      <VehicleLifeStageTimeline
                        evidence={evidenceList}
                        taxonomy={evidenceTaxonomy}
                        sources={evidenceSources}
                      />
                    </div>
                  )}

                  {evidenceLoadState === 'error' ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-gray-700" role="status">
                      Evidence is temporarily unavailable. No absence conclusion is being made.
                    </div>
                  ) : evidenceList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 bg-gray-50 border-2 border-dashed rounded-lg border-gray-200">
                      <FileText className="w-12 h-12 text-gray-400 mb-3" aria-hidden="true" />
                      <h3 className="font-semibold text-gray-800 mb-1">No evidence records available to CarUp</h3>
                      <p className="text-sm text-gray-500 text-center mb-4 max-w-sm">
                        This does not prove that no evidence exists. Add photographs or documents such as odometer captures, damage records, or registration certificates.
                      </p>
                      <Button onClick={() => setIsUploadModalOpen(true)} className="min-h-11 bg-orange-500 hover:bg-orange-600 text-white gap-2">
                        <Upload className="w-4 h-4" /> Upload Evidence
                      </Button>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-4">
                      {evidenceList.map((item) => (
                        <div key={item.id} className="flex flex-col p-4 bg-gray-50 rounded-lg border border-gray-150 justify-between">
                          <div className="flex items-start gap-3">
                            {documentTypes.includes(item.evidence_type) ? (
                              <FileText className="w-10 h-10 text-red-500 shrink-0" />
                            ) : (
                              <div className="w-16 h-16 shrink-0 bg-gray-200 rounded overflow-hidden">
                                {item.file_url ? (
                                  <img
                                    src={item.file_url}
                                    alt={`${evidenceClassificationLabel(item)} evidence preview`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    <FileText className="w-5 h-5" />
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-sm text-gray-800 truncate">
                                {evidenceClassificationLabel(item)}
                              </h4>
                              {item.verification_notes && (
                                <p className="text-xs text-gray-600 mt-1 line-clamp-2 italic">"{item.verification_notes}"</p>
                              )}
                              <div className="flex flex-wrap gap-1 mt-2">
                                {item.verification_status === 'verified' && (
                                  <Badge className="bg-green-500 text-white text-[10px] py-0 px-1.5 hover:bg-green-600">Verified</Badge>
                                )}
                                {item.verification_status === 'rejected' && (
                                  <Badge className="bg-red-500 text-white text-[10px] py-0 px-1.5 hover:bg-red-600">Rejected</Badge>
                                )}
                                {item.verification_status === 'pending' && (
                                  <Badge className="bg-amber-500 text-white text-[10px] py-0 px-1.5 hover:bg-amber-600">Pending Review</Badge>
                                )}

                                {item.visibility_level === 'public_safe' && (
                                  <Badge className="bg-blue-500 text-white text-[10px] py-0 px-1.5 flex items-center gap-0.5 hover:bg-blue-600">
                                    <Eye className="w-2.5 h-2.5" /> Public
                                  </Badge>
                                )}
                                {item.visibility_level === 'restricted' && (
                                  <Badge className="bg-orange-500 text-white text-[10px] py-0 px-1.5 flex items-center gap-0.5 hover:bg-orange-600">
                                    <EyeOff className="w-2.5 h-2.5" /> Restricted
                                  </Badge>
                                )}
                                {item.visibility_level === 'private' && (
                                  <Badge className="bg-gray-500 text-white text-[10px] py-0 px-1.5 flex items-center gap-0.5 hover:bg-gray-600">
                                    <Lock className="w-2.5 h-2.5" /> Private
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="mt-3 pt-3 border-t border-gray-200/60 flex items-center justify-between text-[11px] text-gray-500">
                            <span>Uploaded: {new Date(item.uploaded_at || '').toLocaleDateString()}</span>
                            {item.linked_registry_event_id && (
                              <Badge variant="outline" className="text-[10px] border-gray-300 text-gray-600 bg-white">
                                Linked
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border-0 card-shadow">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-4">Vehicle Summary</h3>
              <div className="space-y-3 text-sm">
                {/* Recorded price only. CarUp publishes no market valuation for this vehicle, so there is
                    no "Current Value" / "Depreciation" / "AI Valuation" — inventing one (price * 0.9)
                    would be a fabricated business fact. */}
                <div className="flex justify-between"><span className="text-gray-500">Recorded Price</span><span>{statedPrice(vehicle.price)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Services</span><span>{vehicle.serviceHistory.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Parts</span><span>{vehicle.partsHistory.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Recorded Service Cost</span><span>${vehicle.serviceHistory.reduce((a, s) => a + (s.cost ?? 0), 0).toLocaleString()}</span></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <EvidenceUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false)
          if (searchParams.get('upload') === '1') {
            const next = new URLSearchParams(searchParams)
            next.delete('upload')
            setSearchParams(next, { replace: true })
          }
        }}
        vin={vehicle.vin}
        timelineEvents={passportData.timeline || []}
        onSuccess={() => {
          setEvidenceLoadState('loading')
          setPassportLoadState('loading')
          loadEvidence()
          loadPassport()
        }}
      />
    </main>
  )
}