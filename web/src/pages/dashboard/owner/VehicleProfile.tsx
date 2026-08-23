import { useState, useEffect, useCallback } from 'react'
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
import { statedMileage, statedPrice, statedDate } from './ownerStatedValues'

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

export default function VehicleProfile() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { fetchVehiclePassport, fetchVehicleEvidence, fetchEvidenceTaxonomy, fetchEvidenceSources } = useCarUpApi()
  const [passportData, setPassportData] = useState<VehiclePassport | null>(null)
  const [evidenceList, setEvidenceList] = useState<VehicleEvidence[]>([])
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
      })
      .catch(err => console.error('Error fetching vehicle evidence:', err))
  }, [fetchVehicleEvidence, id])

  useEffect(() => {
    if (!id) return
    fetchVehiclePassport(id)
      .then(data => {
        setPassportData(data)
      })
      .catch(err => console.error('Error fetching passport details:', err))
    
    loadEvidence()
  }, [fetchVehiclePassport, id, loadEvidence])

  useEffect(() => {
    let mounted = true
    Promise.allSettled([fetchEvidenceTaxonomy(), fetchEvidenceSources()]).then(([tax, src]) => {
      if (!mounted) return
      if (tax.status === 'fulfilled') setEvidenceTaxonomy(tax.value)
      if (src.status === 'fulfilled') setEvidenceSources(src.value.sources || [])
    })
    return () => { mounted = false }
  }, [fetchEvidenceTaxonomy, fetchEvidenceSources])


  if (!passportData) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    )
  }

  const documentTypes = [
    'registration_document',
    'insurance_document',
    'police_clearance_document',
    'ownership_transfer_document'
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
  const listingMediaItems: Array<{ url?: string; is_primary?: boolean }> =
    Array.isArray((passportData as { listing_media?: { items?: unknown } })?.listing_media?.items)
      ? ((passportData as unknown as { listing_media: { items: Array<{ url?: string; is_primary?: boolean }> } }).listing_media.items)
      : []
  const primaryListingImage =
    listingMediaItems.find((i) => i.is_primary === true)?.url
    ?? listingMediaItems[0]?.url
    ?? null
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
        title: item.evidence_type.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
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
      })) as unknown as InsuranceRecord[],
    // PARTS and SERVICES ARE NOT THE SAME EVENTS. Both collections used to filter
    // `event_source === 'service'`, and the only 'service'-sourced timeline entries are PartSentry
    // part logs — so Golden A's single part log was published as "Total Services 1 AND Total Parts 1",
    // one row counted twice, while My Garage said 0 of each. Services come from mechanic-signed work
    // orders; a part fitted is a part.
    serviceHistory: (passportData.timeline || [])
      .filter((e) => e.event_source === 'service' && !String(e.id ?? '').startsWith('partsentry:'))
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" className="gap-1" asChild>
        <Link to="/dashboard/garage"><ArrowLeft className="w-4 h-4" /> Back to Garage</Link>
      </Button>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 card-shadow overflow-hidden">
            <div className="relative h-56">
              <ListingImage src={vehicle.imageUrl} alt="" className="h-full w-full" imgClassName="h-56" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl font-bold">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle details not recorded'}</h1>
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

              <div className="mb-4" data-testid="owner-trust">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Trust Score</span>
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
                    <Progress value={trustScore} className="h-3" />
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
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="bg-green-50 text-green-700">
                  <CheckCircle className="w-3 h-3 mr-1" /> Logbook Verified
                </Badge>
                <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                  <Shield className="w-3 h-3 mr-1" /> Insurance Active
                </Badge>
                <Badge variant="secondary" className="bg-purple-50 text-purple-700">
                  <Star className="w-3 h-3 mr-1" /> PartSentry Active
                </Badge>
                {passportData?.chainVerification?.verified && (
                  <Badge variant="secondary" className="bg-orange-50 text-orange-700 animate-pulse-glow">
                    <CheckCircle className="w-3 h-3 mr-1" /> Ledger Synced
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="documents" className="w-full">
            <TabsList className="w-full flex flex-wrap">
              <TabsTrigger value="documents" className="flex-1">Documents</TabsTrigger>
              <TabsTrigger value="service" className="flex-1">Service History</TabsTrigger>
              <TabsTrigger value="insurance" className="flex-1">Insurance</TabsTrigger>
              <TabsTrigger value="parts" className="flex-1">Parts</TabsTrigger>
              <TabsTrigger value="evidence" className="flex-1">Evidence & Media</TabsTrigger>
            </TabsList>
            <TabsContent value="documents" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5 space-y-3">
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
                  {vehicle.insuranceRecords.map((ir) => (
                    <div key={ir.id} className={`p-4 rounded-lg border ${ir.status === 'active' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Shield className="w-5 h-5 text-green-600" />
                          <span className="font-medium">{ir.provider}</span>
                        </div>
                        <Badge className={ir.status === 'active' ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}>{ir.status}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">Policy: {ir.policyNumber}</p>
                      <p className="text-sm text-gray-600">{ir.type} • ${ir.premium}/year</p>
                      <p className="text-xs text-gray-500 mt-1">{ir.startDate} to {ir.expiryDate}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="parts" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 font-medium text-gray-500">Part</th>
                          <th className="text-left py-2 font-medium text-gray-500">Type</th>
                          <th className="text-left py-2 font-medium text-gray-500">Date</th>
                          <th className="text-right py-2 font-medium text-gray-500">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
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
                  <div className="flex justify-between items-center pb-2 border-b">
                    <div>
                      <h3 className="font-semibold text-gray-800">Visual Evidence & Media</h3>
                      <p className="text-xs text-gray-500">Photographs and documentation proving the condition and identity of the vehicle.</p>
                    </div>
                    <Button onClick={() => setIsUploadModalOpen(true)} className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
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

                  {evidenceList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 bg-gray-50 border-2 border-dashed rounded-lg border-gray-200">
                      <FileText className="w-12 h-12 text-gray-400 mb-3" />
                      <h3 className="font-semibold text-gray-800 mb-1">No Evidence Uploaded</h3>
                      <p className="text-sm text-gray-500 text-center mb-4 max-w-sm">
                        Upload photographs or documents such as odometer captures, damage records, or registration certificates.
                      </p>
                      <Button onClick={() => setIsUploadModalOpen(true)} className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
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
                                  <img src={item.file_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    <FileText className="w-5 h-5" />
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-sm text-gray-800 truncate">
                                {item.evidence_type.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}
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
          loadEvidence()
          // Re-fetch passport as well in case status changed
          fetchVehiclePassport(vehicle.vin)
            .then(data => setPassportData(data))
            .catch(err => console.error(err))
        }}
      />
    </div>
  )
}