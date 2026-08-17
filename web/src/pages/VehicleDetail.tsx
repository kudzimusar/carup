import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { PremiumEvidenceGallery } from '@/components/PremiumEvidenceGallery'
import VehicleLifeStageTimeline from '@/components/VehicleLifeStageTimeline'
import VehicleTemporalComparison from '@/components/VehicleTemporalComparison'
import VehicleDisclosurePanel from '@/components/VehicleDisclosurePanel'
import VehicleHistoryReport from '@/components/VehicleHistoryReport'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Car, CheckCircle, Shield, Gauge, Fuel, Settings2, MapPin, Calendar,
  Phone, MessageSquare, Heart, Share2, ArrowLeft, AlertTriangle, Search,
  FileCheck, Star, Loader2, Lock, CreditCard, ChevronLeft, ChevronRight,
  XCircle, HelpCircle, Wrench, UserCheck, TrendingDown, ClipboardCheck,
  Clock, Image as ImageIcon, FileText, FileSearch, Link2, Copy
} from 'lucide-react'
import { formatPrice } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'
import type {
  Vehicle,
  VehicleIdentity,
  VehiclePassport,
  TimelineEvent,
  PassportVerificationSource,
  MarketplaceListingDetail,
  EvidenceTaxonomyResponse,
  EvidenceSource,
  TemporalFinding,
  DisclosureConflict,
  VehicleHistoryReportData,
  TrustDecision,
} from '@/types'
import { TrustSummaryPanel } from '@/components/marketplace/TrustSummaryPanel'
import { SourceCoveragePanel } from '@/components/SourceCoveragePanel'
import { TrustDecisionPanel } from '@/components/TrustDecisionPanel'
import { AllInPricePanel } from '@/components/marketplace/AllInPricePanel'
import { SafetyWarnings } from '@/components/marketplace/SafetyWarnings'
import { InquiryModal } from '@/components/marketplace/InquiryModal'
import DisputePanel from '@/components/DisputePanel'
import { captureReferralFromUrl, getStoredAttribution } from '@/lib/marketplaceReferral'

/** Minimal Vehicle hydrated from the governed marketplace detail (fallback when passport lookup misses). */
function vehicleFromMarketplaceDetail(d: MarketplaceListingDetail): Vehicle {
  return {
    vin: d.vin,
    id: d.vin,
    make: d.make,
    model: d.model,
    year: d.year,
    mileage: d.mileage,
    price: d.price,
    currency: d.currency,
    fuel_type: d.fuel_type || undefined,
    transmission: d.transmission || undefined,
    status: d.status,
    // `trust_score` is deliberately NOT carried over. It is the unversioned cache column, the page
    // renders no trust claim from it, and leaving it on the hydrated Vehicle is how a later edit
    // reaches for it as a fallback. The canonical projection is the only trust input here.
    images: (d.media || []).filter((m) => m.type === 'image').map((m) => m.url),
    location: d.location,
    sellerName: d.seller_summary?.display_label,
    sellerType: d.seller_summary?.seller_type === 'dealer' ? 'Dealership'
      : d.seller_summary?.seller_type === 'private' ? 'Private Owner'
      : undefined,
    created_at: d.created_at || undefined,
  } as Vehicle
}

// ── Governed identifier states ───────────────────────────────────────────────
/**
 * The passport identity block carries `identifiersRedacted`, which the shared
 * VehicleIdentity type does not declare yet.
 */
type PassportIdentity = VehicleIdentity & { identifiersRedacted?: boolean }

/**
 * A governed identifier has three distinct truths and the page must never collapse them:
 * `withheld` means this audience is not allowed to see it, `unrecorded` means it does not
 * exist. Withheld is a rule about the caller — never a data-quality finding about the
 * vehicle, and never an input to a confidence or trust claim.
 */
type IdentifierState = 'present' | 'withheld' | 'unrecorded'

function identifierState(value: string | null | undefined, redacted: boolean): IdentifierState {
  if (value) return 'present'
  return redacted ? 'withheld' : 'unrecorded'
}

// ── localStorage helpers ─────────────────────────────────────────────────────
function getFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem('carup_favorites') || '[]') } catch { return [] }
}

// ── Timeline event icon & color mapping ────────────────────────────────────
function timelineIcon(source: string) {
  const map: Record<string, { icon: typeof Wrench; color: string }> = {
    service:            { icon: Wrench,        color: 'text-blue-600 bg-blue-50' },
    ownership_transfer: { icon: UserCheck,     color: 'text-purple-600 bg-purple-50' },
    insurance:          { icon: Shield,        color: 'text-green-600 bg-green-50' },
    escrow:             { icon: Lock,          color: 'text-amber-600 bg-amber-50' },
    zimra:              { icon: ClipboardCheck,color: 'text-orange-600 bg-orange-50' },
    cvr:                { icon: FileCheck,     color: 'text-teal-600 bg-teal-50' },
    vid:                { icon: CheckCircle,   color: 'text-green-700 bg-green-50' },
    cid:                { icon: Shield,        color: 'text-red-600 bg-red-50' },
    zinara:             { icon: TrendingDown,  color: 'text-gray-600 bg-gray-50' },
    plate_assigned:      { icon: FileCheck,     color: 'text-blue-600 bg-blue-50' },
    temporary_id_issued: { icon: ClipboardCheck,color: 'text-amber-600 bg-amber-50' },
    plate_verified:      { icon: CheckCircle,   color: 'text-green-600 bg-green-50' },
    plate_changed:       { icon: Calendar,      color: 'text-purple-600 bg-purple-50' },
    plate_flagged:       { icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    plate_suspended:     { icon: XCircle,       color: 'text-red-700 bg-red-50' },
    evidence:            { icon: ImageIcon,     color: 'text-orange-600 bg-orange-50' },
  }
  return map[source] ?? { icon: Clock, color: 'text-gray-500 bg-gray-50' }
}

// Removed formatEvidenceLabel since it is no longer used here

/**
 * The passport's non-score signals. These moved from `trustReport.metrics` to `trustSignals` when
 * `trustReport` became the canonical projection (server.js: "Kept OUT of trustReport because that
 * object's key set is the public trust contract"). They are FACTS OBSERVED, never a verdict — the
 * backend even stamps `signals_are_not_a_trust_score: true` on them — so nothing here is combined
 * into a score.
 */
type TrustSignals = {
  cvr_synced?: boolean
  zimra_duty?: boolean
  zrp_police_cleared?: boolean
  odometer_consistent?: boolean
  maintenance_logs_count?: number
  stolen_alert_active?: boolean
}

function readTrustSignals(passport: VehiclePassport | null): TrustSignals | null {
  const raw = (passport as { trustSignals?: unknown } | null | undefined)?.trustSignals
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as TrustSignals
}

// ── Derive Verification sources from passport data ──────────────────────────
/**
 * WHEN NO SIGNALS WERE REPORTED, NOTHING IS CLAIMED IN EITHER DIRECTION. Every row below used to
 * collapse "the passport reported nothing" into the negative branch, which published sentences like
 * "No active stolen vehicle alert" and "CID check passed" off an absent object — a clean bill of
 * health fabricated from a missing field. Absent signals now render `unknown`.
 */
function buildVerificationSources(passport: VehiclePassport | null): PassportVerificationSource[] {
  if (!passport) return []

  const m = readTrustSignals(passport)
  const chain = passport.chainVerification

  const sources: PassportVerificationSource[] = [
    {
      label: 'VIN / Ledger Integrity',
      status: chain?.verified ? 'verified' : 'not_verified',
      detail: chain?.verified
        ? 'Blockchain hash chain verified — no tampering detected'
        : 'Ledger integrity check failed or no events recorded',
    },
  ]

  if (!m) {
    // The passport carried no signal report. Say that, once, instead of seven fabricated verdicts.
    return [
      ...sources,
      {
        label: 'Registry & clearance checks',
        status: 'unknown',
        detail: 'This passport reported no registry, clearance or odometer signals, so none is '
          + 'stated for this vehicle in either direction.',
      },
    ]
  }

  return [
    ...sources,
    {
      label: 'ZIMRA Customs Cleared',
      status: m.zimra_duty ? 'verified' : 'not_verified',
      detail: m.zimra_duty
        ? 'Import duty paid and confirmed via ZIMRA registry'
        : 'No ZIMRA customs declaration found',
    },
    {
      label: 'CVR Ownership Registration',
      status: m.cvr_synced ? 'verified' : 'not_verified',
      detail: m.cvr_synced
        ? 'Vehicle registered in Central Vehicle Registry'
        : 'CVR record not yet linked',
    },
    {
      label: 'ZRP Police Clearance',
      status: m.zrp_police_cleared ? 'verified' : 'not_verified',
      detail: m.zrp_police_cleared
        ? 'CID check passed — not flagged as stolen'
        : 'CID police clearance not yet recorded',
    },
    {
      label: 'Odometer Consistency',
      status: m.odometer_consistent ? 'verified' : 'warning',
      detail: m.odometer_consistent
        ? 'No odometer rollback anomalies detected across service logs'
        : 'Potential mileage discrepancy detected — inspect service history',
    },
    {
      label: 'Active Stolen Alert',
      status: m.stolen_alert_active ? 'warning' : 'verified',
      detail: m.stolen_alert_active
        ? '⚠️ Active police alert on this VIN — do not purchase'
        : 'No active stolen vehicle alert',
    },
    {
      label: 'Service Records',
      status: (m.maintenance_logs_count ?? 0) >= 1 ? 'verified' : 'not_verified',
      detail: (m.maintenance_logs_count ?? 0) >= 1
        ? `${m.maintenance_logs_count} signed maintenance log(s) on the blockchain ledger`
        : 'No mechanic-signed service records found',
    },
  ]
}

// ── Status badge for verification sources ───────────────────────────────────
function VerificationBadge({ status }: { status: PassportVerificationSource['status'] }) {
  const map = {
    verified:     { label: 'Verified',   cls: 'bg-green-500 text-white' },
    not_verified: { label: 'Unverified', cls: 'bg-gray-400 text-white' },
    warning:      { label: 'Warning',    cls: 'bg-amber-500 text-white' },
    unknown:      { label: 'Unknown',    cls: 'bg-gray-300 text-gray-700' },
  }
  const { label, cls } = map[status]
  return <Badge className={`${cls} text-[10px]`}>{label}</Badge>
}

// ── The canonical trust projection (Issue #164, ADR-001) ────────────────────
/**
 * THE TEN FIELDS. `backend/services/trustDecision/canonicalTrustService.js` → `toPublicTrust()` is
 * the ONE public trust contract. This page renders those ten fields and derives NOTHING from
 * anything else:
 *
 *   - `vehicle.trust_score` is never read for a trust claim. It is an unversioned cache column with
 *     several writers, and it is where the hand-set 84 came from.
 *   - `passport.trustReport` is now the canonical projection itself (server.js
 *     `canonicalPassportTrust`). It used to be the deprecated 70-baseline trustGraph engine's
 *     `{trustScore, metrics}`, which is where the 90 came from; the non-score signals moved to
 *     `passport.trustSignals`, and `readPublicTrust` refuses the old shape outright.
 *   - `decision.overall_trust.*` is never read for a trust claim either. Reading it was a SECOND
 *     forked public contract: the authority publishes a real 0 for the `insufficient_evidence`
 *     band and this page used to suppress it, so the same VIN read differently here than in the
 *     projection every other surface consumes.
 *
 * The decision is still fetched — its `dimensions[].reason_codes` say WHY, which the projection
 * does not carry — but the number, the band, the lifecycle state, the confidence, the evidence
 * basis and the limitations are all the projection's, verbatim.
 *
 * TWO TRANSPORTS, ONE CONTRACT. The projection reaches this page on the passport (public, always
 * fetched) and, when that route also publishes it, beside the trust decision. Both are the same
 * `toPublicTrust()` output from the same service and both are read by the one function below, so
 * this is one contract carried two ways — not two contracts.
 *
 * SCORE `null` IS NOT `0`. A null score means no canonical evaluation exists; it must render as an
 * explicit state, never as a number, a bar, or a percentage.
 */
const EVIDENCE_BASIS_FIELDS = [
  'governed_facts_total',
  'governed_facts_substantiated',
  'governed_facts_adverse',
  'connected_sources',
  'unbacked_legacy_claims',
] as const

type PublicTrustEvidenceBasis = Record<(typeof EVIDENCE_BASIS_FIELDS)[number], number | null>

type PublicTrust = {
  vin: string
  score: number | null
  band: string | null
  evaluation_state: string
  confidence: string
  evidence_basis: PublicTrustEvidenceBasis | null
  calculation_version: string | null
  evaluated_at: string | null
  known_limitations: string[]
  source: string
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Read a canonical projection. This narrows types; it does not compute. A field the server did not
 * send stays absent (null / 'unavailable') rather than being reconstructed from anything else on
 * the response — reconstructing it is what forking the contract means.
 *
 * `evaluation_state` is the discriminator, and it is required. That is what makes the deprecated
 * `{vin, trustScore, metrics}` shape parse as NOTHING rather than as a trust record: against a
 * server that still serves the old passport body this page reports "unavailable" instead of
 * quietly publishing the 70-baseline engine's number again.
 */
function readPublicTrust(raw: unknown): PublicTrust | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>
  if (typeof t.evaluation_state !== 'string') return null
  const basis = t.evidence_basis
  return {
    vin: typeof t.vin === 'string' ? t.vin : '',
    score: numberOrNull(t.score),
    band: typeof t.band === 'string' ? t.band : null,
    evaluation_state: t.evaluation_state,
    confidence: typeof t.confidence === 'string' ? t.confidence : 'not_evaluated',
    evidence_basis: basis && typeof basis === 'object' && !Array.isArray(basis)
      ? EVIDENCE_BASIS_FIELDS.reduce((out, field) => {
        out[field] = numberOrNull((basis as Record<string, unknown>)[field])
        return out
      }, {} as PublicTrustEvidenceBasis)
      : null,
    calculation_version: typeof t.calculation_version === 'string' ? t.calculation_version : null,
    evaluated_at: typeof t.evaluated_at === 'string' ? t.evaluated_at : null,
    known_limitations: Array.isArray(t.known_limitations)
      ? t.known_limitations.filter((entry): entry is string => typeof entry === 'string')
      : [],
    source: typeof t.source === 'string' ? t.source : 'none',
  }
}

/**
 * Band labels. An unrecognised band falls through unchanged rather than being mapped onto a
 * familiar tier, so a vocabulary change upstream stays visible instead of being absorbed. There is
 * deliberately no 'Excellent' / 'Good' / 'Fair' / 'High Trust' here: those were client-side tiers
 * awarded by thresholds this page has no authority to set.
 */
const TRUST_BAND_LABELS: Record<string, string> = {
  high: 'High trust',
  moderate: 'Moderate trust',
  low: 'Low trust',
  insufficient_evidence: 'Insufficient evidence',
}
const TRUST_BAND_TONE: Record<string, { badge: string; text: string }> = {
  high: { badge: 'bg-green-600', text: 'text-green-700' },
  moderate: { badge: 'bg-amber-500', text: 'text-amber-700' },
  low: { badge: 'bg-red-500', text: 'text-red-700' },
  insufficient_evidence: { badge: 'bg-gray-500', text: 'text-gray-600' },
}
const TRUST_NEUTRAL_TONE = { badge: 'bg-gray-500', text: 'text-gray-600' }

/** Lifecycle labels — the axis that says whether an evaluation exists at all. */
const TRUST_STATE_LABELS: Record<string, string> = {
  evaluated: 'Evaluated',
  stale: 'Assessment out of date',
  not_evaluated: 'Not evaluated',
  unavailable: 'Trust assessment unavailable',
}

/** Why there is, or is not, a number. Every state reads differently from every other. */
const TRUST_STATE_DETAIL: Record<string, string> = {
  stale: 'This vehicle was last assessed under superseded rules. The earlier score is withheld '
    + 'rather than shown as if it were current.',
  not_evaluated: 'CarUp has not produced a governed trust assessment for this vehicle. That is not '
    + 'a score of zero and says nothing for or against the vehicle.',
  unavailable: 'CarUp could not produce a trust assessment for this request. That is a fact about '
    + 'the request, not a finding about the vehicle.',
}

const TRUST_CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  not_evaluated: 'Confidence not assessed',
}

type TrustPresentation = {
  /** The projection's number, or null. Never defaulted, never floored, never zero-filled. */
  score: number | null
  band: string | null
  state: string
  /** The one line the surface leads with. */
  headline: string
  /** The sentence that keeps each state distinguishable from the others. */
  detail: string
  tone: string
  toneText: string
}

function presentTrust(
  trust: PublicTrust | null,
  opts: { loading: boolean; authenticated: boolean },
): TrustPresentation {
  const neutral = {
    score: null,
    band: null,
    tone: TRUST_NEUTRAL_TONE.badge,
    toneText: TRUST_NEUTRAL_TONE.text,
  }
  if (opts.loading) {
    return { ...neutral, state: 'unavailable', headline: 'Checking…', detail: '' }
  }

  if (!trust) {
    // No projection reached this page: the visitor is signed out, or the authority could not be
    // read. Nothing about this vehicle's trust may be asserted in either direction.
    return {
      ...neutral,
      state: 'unavailable',
      headline: opts.authenticated ? TRUST_STATE_LABELS.unavailable : 'Sign in to view trust',
      detail: opts.authenticated
        ? TRUST_STATE_DETAIL.unavailable
        : 'CarUp publishes a vehicle’s governed trust assessment to signed-in users.',
    }
  }

  // FAIL CLOSED. The contract guarantees a score exists only in the `evaluated` state; this page
  // still refuses to print one otherwise, so a route that ever published a raw decision here shows
  // its lifecycle state rather than an ungoverned number.
  const publishable = trust.evaluation_state === 'evaluated' && trust.score !== null
  if (!publishable) {
    const state = trust.evaluation_state
    return {
      ...neutral,
      state,
      headline: TRUST_STATE_LABELS[state] ?? TRUST_STATE_LABELS.not_evaluated,
      detail: TRUST_STATE_DETAIL[state] ?? TRUST_STATE_DETAIL.not_evaluated,
    }
  }

  const band = trust.band
  const tone = (band ? TRUST_BAND_TONE[band] : undefined) ?? TRUST_NEUTRAL_TONE
  return {
    score: trust.score,
    band,
    state: trust.evaluation_state,
    headline: (band ? TRUST_BAND_LABELS[band] : undefined) ?? (band ?? '').replace(/_/g, ' '),
    // An `insufficient_evidence` score IS a measurement. Saying so is what keeps it from reading
    // like the `not_evaluated` state above, and keeps it from reading like a bad-vehicle verdict.
    detail: band === 'insufficient_evidence'
      ? 'CarUp evaluated this vehicle and found too little authoritative evidence to support a '
        + 'higher score. This is a measured result, not a missing one.'
      : 'Published by CarUp’s trust authority under its current calculation rules.',
    tone: tone.badge,
    toneText: tone.text,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VehicleDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { reserveVehicle, createSafePayEscrow, submitFinancing, fetchVehicle, fetchVehiclePassport, lookupVehiclePassport, fetchMarketplaceListingDetail, saveMarketplaceListing, unsaveMarketplaceListing, fetchSavedMarketplaceListings, fetchEvidenceTaxonomy, fetchEvidenceSources, fetchTemporalFindings, fetchDisclosureConflicts, fetchVehicleReport, generateReportVersion, createReportShareLink, fetchVehicleTrustDecision } = useCarUpApi()
  const { isAuthenticated, user, loading: authLoading } = useAuth()

  // Buyers/owners can generate a snapshot + share link; backend enforces the role.
  // Keep the owner actions unobtrusive: only authenticated privileged roles see them.
  const canManageReport = isAuthenticated && ['owner', 'dealer', 'admin', 'government'].includes(user?.role ?? '')

  const [vehicle, setVehicle]   = useState<Vehicle | null>(null)
  const [passport, setPassport] = useState<VehiclePassport | null>(null)
  const [detail, setDetail]     = useState<MarketplaceListingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [loading, setLoading]   = useState(true)
  // A plate / temporary-identifier lookup is refused for signed-out visitors by design. That is a
  // statement about the caller, not about the vehicle, so it must not render as "Vehicle Not Found".
  const [lookupNeedsSignIn, setLookupNeedsSignIn] = useState(false)

  const [currentImageIdx, setCurrentImageIdx] = useState(0)
  const [isFav, setIsFav]         = useState(() => getFavorites().includes(id || ''))
  // Session-only acknowledgement that this browser submitted a reservation request. It never
  // asserts reserved state on its own — `status` from the server is the only source of "Reserved".
  const [reserveRequested, setReserveRequested] = useState(false)
  const [isFinanced, setIsFinanced] = useState(false)

  const [showReserveModal, setShowReserveModal] = useState(false)
  const [reserveLoading, setReserveLoading]     = useState(false)

  const [showFinanceModal, setShowFinanceModal] = useState(false)
  const [financeLoading, setFinanceLoading]     = useState(false)
  const [loanAmount, setLoanAmount]             = useState('')
  const [loanTerm, setLoanTerm]                 = useState('36')
  const [selectedBank, setSelectedBank]         = useState('cbz')

  const [lookupQuery, setLookupQuery] = useState('')

  // Vehicle Life Evidence Taxonomy (M1) — used to derive a life-stage class for
  // legacy evidence and to resolve human-readable source labels in the timeline.
  const [evidenceTaxonomy, setEvidenceTaxonomy] = useState<EvidenceTaxonomyResponse | null>(null)
  const [evidenceSources, setEvidenceSources] = useState<EvidenceSource[]>([])

  useEffect(() => {
    let mounted = true
    Promise.allSettled([fetchEvidenceTaxonomy(), fetchEvidenceSources()]).then(([tax, src]) => {
      if (!mounted) return
      if (tax.status === 'fulfilled') setEvidenceTaxonomy(tax.value)
      if (src.status === 'fulfilled') setEvidenceSources(src.value.sources || [])
    })
    return () => { mounted = false }
  }, [fetchEvidenceTaxonomy, fetchEvidenceSources])

  // Vehicle Life Intelligence (M3): reviewer-confirmed, public-safe temporal
  // comparisons and disclosure conflicts. Buyers typically see empty/governed
  // results — that is correct and expected; the UI handles empty gracefully.
  const [temporalFindings, setTemporalFindings] = useState<TemporalFinding[]>([])
  const [disclosureConflicts, setDisclosureConflicts] = useState<DisclosureConflict[]>([])

  useEffect(() => {
    const vin = vehicle?.vin || id
    if (!vin) return
    let mounted = true
    Promise.allSettled([fetchTemporalFindings(vin), fetchDisclosureConflicts(vin)]).then(([findings, conflicts]) => {
      if (!mounted) return
      setTemporalFindings(findings.status === 'fulfilled' ? findings.value.findings || [] : [])
      setDisclosureConflicts(conflicts.status === 'fulfilled' ? conflicts.value.conflicts || [] : [])
    })
    return () => { mounted = false }
  }, [vehicle?.vin, id, fetchTemporalFindings, fetchDisclosureConflicts])

  // The trust DECISION (ADR-001) supplies reason codes — `dimensions[].reason_codes` — and nothing
  // else. The trust CLAIM comes from the canonical projection resolved below. The route requires a
  // session, so a signed-out visitor simply gets no reason codes; the passport still carries the
  // projection, so the trust state itself is public.
  const [trustDecision, setTrustDecision] = useState<TrustDecision | null>(null)
  const [routeTrust, setRouteTrust] = useState<PublicTrust | null>(null)
  const [trustDecisionLoading, setTrustDecisionLoading] = useState(true)

  useEffect(() => {
    const vin = vehicle?.vin || id
    if (!vin || authLoading) return
    let mounted = true
    if (!isAuthenticated) {
      // Nothing to ask for, and nothing may be assumed. Resolve the loading state only.
      Promise.resolve().then(() => {
        if (!mounted) return
        setTrustDecision(null)
        setRouteTrust(null)
        setTrustDecisionLoading(false)
      })
      return () => { mounted = false }
    }
    fetchVehicleTrustDecision(vin)
      .then((r) => {
        if (!mounted) return
        setTrustDecision(r.decision ?? null)
        setRouteTrust(readPublicTrust((r as { trust?: unknown }).trust))
      })
      .catch(() => { if (mounted) { setTrustDecision(null); setRouteTrust(null) } })
      .finally(() => { if (mounted) setTrustDecisionLoading(false) })
    return () => { mounted = false }
  }, [vehicle?.vin, id, authLoading, isAuthenticated, fetchVehicleTrustDecision])

  // Vehicle History Report (M4): full public-safe buyer report. Audience is derived
  // server-side from role; buyers get verified, public-safe data only. Loaded lazily
  // alongside the page so the dedicated tab renders immediately when opened.
  const [report, setReport] = useState<VehicleHistoryReportData | null>(null)
  const [reportLoading, setReportLoading] = useState(true)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)

  // Vehicle History Report fetch. No synchronous setState in the effect body
  // (react-hooks/set-state-in-effect): reportLoading is initialised true and all state
  // updates happen in async continuations; error is cleared on a successful load.
  useEffect(() => {
    const vin = vehicle?.vin || id
    if (!vin) return
    let mounted = true
    fetchVehicleReport(vin)
      .then((data) => { if (mounted) { setReport(data); setReportError(null) } })
      .catch((err) => { if (mounted) setReportError(err instanceof Error ? err.message : 'Report unavailable') })
      .finally(() => { if (mounted) setReportLoading(false) })
    return () => { mounted = false }
  }, [vehicle?.vin, id, fetchVehicleReport])

  const handleGenerateReportVersion = useCallback(async () => {
    const vin = vehicle?.vin || id
    if (!vin) return
    setReportBusy(true)
    try {
      const version = await generateReportVersion(vin)
      toast.success(`Report version v${version.version} snapshotted.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate report version.')
    } finally {
      setReportBusy(false)
    }
  }, [vehicle?.vin, id, generateReportVersion])

  const handleCreateShareLink = useCallback(async () => {
    const vin = vehicle?.vin || id
    if (!vin) return
    setReportBusy(true)
    try {
      // Snapshot a fresh version, then create an expiring share link for it.
      const version = await generateReportVersion(vin)
      const link = await createReportShareLink(version.id)
      const url = `${window.location.origin}/reports/shared/${link.share_token}`
      setShareLink(url)
      try {
        await navigator.clipboard?.writeText(url)
        toast.success('Share link created and copied to clipboard.')
      } catch {
        toast.success('Share link created.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create share link.')
    } finally {
      setReportBusy(false)
    }
  }, [vehicle?.vin, id, generateReportVersion, createReportShareLink])

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (lookupQuery.trim()) {
      navigate(`/marketplace/${lookupQuery.trim()}`)
    }
  }

  useEffect(() => {
    if (!id) return
    let mounted = true

    const load = async () => {
      try {
        setLoading(true)
        // 1. Try looking up the passport using the new lookup endpoint
        const passportData = await lookupVehiclePassport(id)
        if (!mounted) return

        if (passportData) {
          setPassport(passportData)
          const d = passportData.vehicle
          setVehicle({
            ...d,
            id: d.vin,
            images: (d.images && d.images.length > 0) ? d.images : [],
            features: d.features ?? [],
            sellerName:   d.tenant?.name  ?? passportData.ownershipSummary?.currentSellerDisplayName ?? undefined,
            sellerPhone:  d.tenant?.phone,
            sellerAvatar: d.tenant?.logo_url ?? null,
            sellerType:   passportData.ownershipSummary?.currentSellerType ?? undefined,
            location:     d.location,
            province:     d.province,
            listingDate:  d.created_at,
          })
          setLoanAmount((d.price ?? 0).toString())
          setLoading(false)
          return
        }
      } catch (err) {
        if ((err as { code?: string })?.code === 'LOOKUP_REQUIRES_AUTHENTICATION') {
          setLookupNeedsSignIn(true)
        }
        console.warn('lookupVehiclePassport failed, trying fallback details fetch:', err)
      }

      // 2. Fallback to VIN canonical endpoints if lookup fails
      try {
        const [vehicleData, passportData] = await Promise.allSettled([
          fetchVehicle(id),
          fetchVehiclePassport(id),
        ])

        if (!mounted) return

        if (vehicleData.status === 'fulfilled' && vehicleData.value) {
          const d = vehicleData.value
          setVehicle({
            ...d,
            id: d.vin,
            images: (d.images && d.images.length > 0) ? d.images : [],
            features: d.features ?? [],
            sellerName:   d.tenant?.name,
            sellerPhone:  d.tenant?.phone,
            sellerAvatar: d.tenant?.logo_url ?? null,
            sellerType:   d.current_seller_type,
            location:     d.location,
            province:     d.province,
            listingDate:  d.created_at,
          })
          setLoanAmount((d.price ?? 0).toString())
        }

        if (passportData.status === 'fulfilled' && passportData.value) {
          setPassport(passportData.value)
        }
      } catch (err) {
        console.error('VehicleDetail load fallback error:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  }, [id, fetchVehicle, fetchVehiclePassport, lookupVehiclePassport])

  // Backend-governed marketplace detail (trust/verification/pricing summaries). Best-effort: if the
  // listing is not a public marketplace listing this stays null and the page renders the passport view.
  useEffect(() => {
    if (!id) return
    let mounted = true
    captureReferralFromUrl()
    const attr = getStoredAttribution()
    setDetailLoading(true)
    fetchMarketplaceListingDetail(id, { ref: attr.referral_code, campaign: attr.campaign_code, source: attr.source })
      .then((d) => {
        if (!mounted) return
        setDetail(d)
        // Fallback: a real public marketplace listing must always open a real detail page. If the
        // passport lookup didn't resolve a vehicle, hydrate from the marketplace detail so the page
        // renders instead of showing "Vehicle Not Found".
        setVehicle((prev) => prev ?? vehicleFromMarketplaceDetail(d))
      })
      .catch(() => { if (mounted) setDetail(null) })
      .finally(() => { if (mounted) setDetailLoading(false) })
    return () => { mounted = false }
  }, [id, fetchMarketplaceListingDetail])

  // Saved state is SERVER-backed + account-scoped for authenticated users (existing /marketplace/saved
  // API), so it survives refresh and never leaks across accounts. Guests keep the browser-local list.
  useEffect(() => {
    if (!isAuthenticated) return
    const vin = vehicle?.vin || id
    if (!vin) return
    let active = true
    fetchSavedMarketplaceListings()
      .then(res => { if (active) setIsFav((res.listings || []).some(l => l.vin === vin)) })
      .catch(() => { /* server unavailable — keep current */ })
    return () => { active = false }
  }, [isAuthenticated, vehicle?.vin, id, fetchSavedMarketplaceListings])

  const toggleFavorite = useCallback(async () => {
    if (!vehicle) return

    if (isAuthenticated) {
      // Server-backed + account-scoped. Optimistic toggle, rolled back on error. No localStorage write.
      const vin = vehicle.vin || id || ''
      if (!vin) return
      const previous = isFav
      setIsFav(!previous)
      try {
        if (previous) {
          await unsaveMarketplaceListing(vin)
          toast.info('Removed from saved cars')
        } else {
          await saveMarketplaceListing(vin)
          toast.success(`${vehicle.make ?? ''} ${vehicle.model ?? ''} saved!`)
        }
      } catch {
        setIsFav(previous)
        toast.error('Could not update saved cars. Please try again.')
      }
      return
    }

    // Guest fallback: browser-local only (unchanged behavior).
    const current = getFavorites()
    let updated: string[]
    if (current.includes(vehicle.id || '')) {
      updated = current.filter(i => i !== vehicle.id)
      setIsFav(false)
      toast.info('Removed from saved cars')
    } else {
      updated = [...current, vehicle.id || '']
      setIsFav(true)
      toast.success(`${vehicle.make ?? ''} ${vehicle.model ?? ''} saved!`)
    }
    localStorage.setItem('carup_favorites', JSON.stringify(updated))
  }, [vehicle, id, isAuthenticated, isFav, saveMarketplaceListing, unsaveMarketplaceListing])

  const handleShare = useCallback(async () => {
    const url = window.location.href
    if (navigator.share) {
      try { await navigator.share({ title: `${vehicle?.year ?? ''} ${vehicle?.make ?? ''} ${vehicle?.model ?? ''}`, url }) } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(url).catch(() => {})
      toast.success('Link copied to clipboard!')
    }
  }, [vehicle])

  const handleReserve = async () => {
    if (!vehicle) return
    // An escrow needs a real counterparty. Without one we fail closed rather than opening a
    // payment instrument against a placeholder.
    const sellerId = vehicle.tenant_id ?? vehicle.sellerId ?? null
    if (!sellerId) {
      toast.error('SafePay escrow is opened by CarUp once a verified inquiry confirms the seller. Send an inquiry to begin.')
      return
    }
    setReserveLoading(true)
    try {
      await reserveVehicle(vehicle.vin ?? '', 7)
      await createSafePayEscrow(vehicle.vin ?? '', sellerId, 500)
      setReserveRequested(true)
      setShowReserveModal(false)
      toast.success('Reservation requested. SafePay escrow of $500 initiated.', { duration: 5000 })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to initiate Escrow. Make sure you are logged in.')
    } finally {
      setReserveLoading(false)
    }
  }

  const handleFinance = async () => {
    if (!vehicle) return
    // The applicant is the signed-in user; there is no fallback identity to apply on behalf of.
    if (!user?.id) {
      toast.error('Sign in to apply — a financing application is submitted under your CarUp account.')
      return
    }
    setFinanceLoading(true)
    try {
      await submitFinancing(vehicle.vin ?? '', user.id, selectedBank, parseFloat(loanAmount))
      setIsFinanced(true)
      setShowFinanceModal(false)
      toast.success('Financing application submitted!', { duration: 6000 })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit application. Make sure you are logged in.')
    } finally {
      setFinanceLoading(false)
    }
  }

  // ── Loading / 404 states ─────────────────────────────────────────────────
  if (loading || (!vehicle && detailLoading)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    )
  }

  if (!vehicle && lookupNeedsSignIn) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-4" data-testid="lookup-requires-signin">
          <Lock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Sign in to look up by plate</h1>
          <p className="text-gray-500 mb-6">
            Searching by number plate or temporary identifier needs a CarUp account. Looking up an exact
            VIN is open to everyone.
          </p>
          <div className="flex gap-3 justify-center">
            <Button className="bg-orange-500 hover:bg-orange-600" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/marketplace">Back to Marketplace</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <Car className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Vehicle Not Found</h1>
          <p className="text-gray-500 mb-6">The vehicle you're looking for doesn't exist or has been removed.</p>
          <Button className="bg-orange-500 hover:bg-orange-600" asChild>
            <Link to="/marketplace">Back to Marketplace</Link>
          </Button>
        </div>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const FALLBACK_IMAGE = null // No fake Unsplash image
  const allImages: string[] = (vehicle.images && vehicle.images.length > 0)
    ? vehicle.images
    : (FALLBACK_IMAGE ? [FALLBACK_IMAGE] : [])

  const hasRealImages  = allImages.length > 0

  // The canonical projection, from the passport first — it is public, it is already fetched, and
  // `server.js` designates `trustReport` as "the ONE trust number this body publishes". The
  // trust-decision route's copy is the same projection from the same service and is used only when
  // the passport carried none, so there is one contract here, not a preference between two answers.
  const publicTrust = readPublicTrust(passport?.trustReport) ?? routeTrust
  const trust          = presentTrust(publicTrust, {
    // The passport resolves with `loading`; only the route call has its own gate.
    loading: loading || (isAuthenticated && !passport && trustDecisionLoading),
    authenticated: isAuthenticated,
  })

  // Direct contact exists only when the listing carries a real number. There is no fallback
  // number — an unknown contact stays unknown and the buyer is routed to the governed inquiry flow.
  const sellerContactNumber = vehicle.sellerPhone && /[0-9]/.test(vehicle.sellerPhone) ? vehicle.sellerPhone : null
  const sellerWhatsAppLink  = sellerContactNumber
    ? `https://wa.me/${sellerContactNumber.replace(/[^0-9]/g, '')}?text=Hi%2C%20I%20am%20interested%20in%20your%20${vehicle.year ?? ''}%20${vehicle.make ?? ''}%20${vehicle.model ?? ''}%20listed%20on%20CarUp.`
    : null

  // Transaction identity. Reserved state is read from the server listing status; the escrow
  // counterparty must resolve to a real seller or the reserve path stays closed.
  const resolvedSellerId    = vehicle.tenant_id ?? vehicle.sellerId ?? null
  const isReservedOnServer  = vehicle.status === 'reserved' || vehicle.status === 'Reserved'
  const canApplyForFinancing = isAuthenticated && Boolean(user?.id)

  // A null identifier on the passport means "withheld from this audience" when
  // identifiersRedacted is set, and "unrecorded" only when it is not.
  const identity             = passport?.identity as PassportIdentity | undefined
  const identifiersRedacted  = identity?.identifiersRedacted === true

  const timeline            = passport?.timeline ?? []
  const evidenceVault       = passport?.evidenceVault ?? []
  const publicEvidence      = evidenceVault.filter(e => e.verification_status === 'verified' && e.visibility_level === 'public_safe')
  const verificationSources = buildVerificationSources(passport)

  // Reason codes come from the decision's own dimensions. They are shown verbatim; the page does
  // not translate them into sub-scores, because a code says WHY, not HOW MUCH.
  const trustReasonCodes = Array.from(new Set(
    Object.values(trustDecision?.dimensions ?? {}).flatMap((d) => d.reason_codes ?? []),
  ))
  // Limitations are the PROJECTION's, not the decision's: the projection's list is the superset
  // that also carries the fact resolver's disclosures — including "the stored 'zimra_verified' flag
  // is not supported by any authoritative record and is not published".
  const trustLimitations = publicTrust?.known_limitations ?? []
  const evidenceBasis = publicTrust?.evidence_basis ?? null
  // A basis entry that was never resolved prints as "not recorded", never as 0: a zero here would
  // claim CarUp counted and found none.
  const basisValue = (value: number | null) => (value === null ? 'Not recorded' : String(value))
  // A record count that was never reported stays null. Rendering it as 0 would assert that no
  // service record exists, which is exactly the absence-as-proof this page must not make.
  const trustSignals = readTrustSignals(passport)
  const serviceRecordCount = trustSignals?.maintenance_logs_count ?? null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Link to="/" className="hover:text-orange-500">Home</Link>
              <span>/</span>
              <Link to="/marketplace" className="hover:text-orange-500">Marketplace</Link>
              <span>/</span>
              <span className="text-gray-900">{vehicle.make} {vehicle.model}</span>
            </div>
            
            <form onSubmit={handleLookupSubmit} className="flex gap-2 max-w-sm w-full">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Enter VIN, chassis, plate, or temporary ID"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  className="pl-9 h-9 text-xs bg-gray-50"
                />
              </div>
              <Button type="submit" size="sm" className="bg-orange-500 hover:bg-orange-600 text-xs">Lookup</Button>
            </form>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        <Button variant="ghost" size="sm" className="mb-4 gap-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>

        {/* Backend-governed marketplace panels (trust, all-in price, inquiry, safety) */}
        {detail && (
          <div className="mb-6 grid gap-4 lg:grid-cols-3" data-testid="marketplace-detail-panels">
            <div className="space-y-4 lg:col-span-2">
              <TrustSummaryPanel trust={detail.trust_summary} verification={detail.verification_summary} />
              {(vehicle?.vin || id) && <TrustDecisionPanel vin={(vehicle?.vin || id) as string} />}
              {(vehicle?.vin || id) && <SourceCoveragePanel vin={(vehicle?.vin || id) as string} />}
              <SafetyWarnings warnings={detail.safety_warnings} />
            </div>
            <div className="space-y-4">
              <AllInPricePanel pricing={detail.pricing_summary} />
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Contact &amp; inquire</h3>
                <div className="flex flex-col gap-2">
                  <InquiryModal
                    listingId={detail.vin}
                    inquiryTypes={['vehicle_purchase_interest', 'vehicle_inspection_request']}
                    triggerLabel="Send inquiry"
                    triggerClassName="w-full"
                  />
                  <InquiryModal
                    listingId={detail.vin}
                    inquiryTypes={['vehicle_inspection_request']}
                    defaultInquiryType="vehicle_inspection_request"
                    triggerLabel="Request inspection"
                    triggerVariant="outline"
                    triggerClassName="w-full"
                  />
                </div>
                <p className="mt-2 text-[11px] text-gray-500">Inquiries are safe — the CarUp team helps connect you. Never pay outside CarUp.</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Plate Advisory Banner */}
            {passport && (
              (() => {
                const plateState = identifierState(identity?.plateNumber, identifiersRedacted);
                const tempIdState = identifierState(identity?.temporaryIdentificationNumber, identifiersRedacted);
                // Only assertable once the identifiers are visible: under redaction the page knows
                // neither whether a plate exists nor whether it was verified.
                const isMissing = plateState === 'unrecorded' && tempIdState === 'unrecorded';
                const isUnverified = plateState === 'present' && !identity?.plateVerifiedAt;
                // plateStatus is public in every audience, so a flag is assertable even under redaction.
                const isFlagged = identity?.plateStatus === 'Flagged' || identity?.plateStatus === 'Suspended';

                if (isFlagged) {
                  return (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg text-red-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">SECURITY WARNING: Plate Flagged/Suspended</p>
                        <p className="text-xs mt-0.5">The registration plate registered to this vehicle has been marked as Flagged or Suspended by the registry authority. Proceed with caution.</p>
                      </div>
                    </div>
                  );
                } else if (identifiersRedacted) {
                  return (
                    <div className="bg-gray-50 border-l-4 border-gray-300 p-4 rounded-r-lg text-gray-700 flex items-start gap-3" data-testid="plate-advisory-withheld">
                      <Lock className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm">Registration identifiers are not shown publicly</p>
                        <p className="text-xs mt-0.5">Plate, temporary ID, chassis and engine numbers are withheld from public view. This is a privacy rule for every listing — it says nothing about this vehicle and does not affect its trust score.</p>
                      </div>
                    </div>
                  );
                } else if (isMissing) {
                  return (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg text-amber-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">Confidence Advisory: Missing Number Plate</p>
                        <p className="text-xs mt-0.5">This vehicle does not have a permanent registration plate or temporary identification number registered. Trust score confidence has been reduced.</p>
                      </div>
                    </div>
                  );
                } else if (isUnverified) {
                  return (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg text-amber-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">Confidence Advisory: Unverified Number Plate</p>
                        <p className="text-xs mt-0.5">A number plate is assigned but has not yet been verified against the Central Vehicle Registry (CVR). Trust score confidence has been reduced.</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()
            )}

            {/* Image gallery */}
            <div className="relative rounded-xl overflow-hidden bg-white card-shadow" data-testid="image-gallery">
              {hasRealImages ? (
                <>
                  <img
                    src={allImages[currentImageIdx]}
                    alt={`${vehicle.make} ${vehicle.model}`}
                    className="w-full aspect-[16/9] object-cover"
                    data-testid="vehicle-image"
                  />
                  {allImages.length > 1 && (
                    <>
                      <button
                        onClick={() => setCurrentImageIdx(i => (i - 1 + allImages.length) % allImages.length)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setCurrentImageIdx(i => (i + 1) % allImages.length)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                      <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                        {currentImageIdx + 1} / {allImages.length}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div
                  className="w-full aspect-[16/9] bg-gray-100 flex flex-col items-center justify-center text-gray-400 gap-3"
                  data-testid="no-images-placeholder"
                >
                  <Car className="w-16 h-16 opacity-30" />
                  <p className="text-sm font-medium">No verified images uploaded yet</p>
                  <p className="text-xs text-gray-400">The seller has not uploaded any images for this vehicle</p>
                </div>
              )}
              <div className="absolute top-4 left-4 flex gap-2">
                {vehicle.police_verified && (
                  <Badge className="bg-blue-700 text-white" data-testid="police-checked-badge">Police Checked</Badge>
                )}
                {/* No "Featured" badge: it was awarded by a client-side score threshold, which is a
                    merchandising claim the page has no authority to make. */}
                {isReservedOnServer && <Badge className="bg-amber-500 text-white">Reserved</Badge>}
              </div>
              <div className="absolute top-4 right-4 flex gap-2">
                <button onClick={toggleFavorite} className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                  <Heart className={`w-5 h-5 ${isFav ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
                </button>
                <button onClick={handleShare} className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                  <Share2 className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            {/* Thumbnails */}
            {allImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {allImages.map((img, i) => (
                  <button key={i} onClick={() => setCurrentImageIdx(i)}
                    className={`flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-colors ${i === currentImageIdx ? 'border-orange-500' : 'border-transparent'}`}>
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Info card */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="text-2xl font-bold">{vehicle.year ?? ''} {vehicle.make ?? ''} {vehicle.model ?? ''}</h1>
                    
                    {/* Plate, VIN and Registration Status identity block */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded text-gray-700 font-mono">
                        VIN: {vehicle.vin}
                      </span>
                      {identity?.plateNumber ? (
                        <span className="text-xs font-bold px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-mono flex items-center gap-1" data-testid="identity-plate">
                          Plate: {identity.plateNumber}
                        </span>
                      ) : identity?.temporaryIdentificationNumber ? (
                        <span className="text-xs font-bold px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded font-mono flex items-center gap-1" data-testid="identity-temp-id">
                          Temp ID: {identity.temporaryIdentificationNumber}
                        </span>
                      ) : identifiersRedacted ? (
                        <span className="text-xs font-medium px-2 py-1 bg-gray-100 text-gray-600 border border-gray-200 rounded flex items-center gap-1" data-testid="identity-plate-withheld">
                          <Lock className="w-3 h-3" /> Plate: not shown publicly
                        </span>
                      ) : (
                        <span className="text-xs font-bold px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded" data-testid="identity-no-plate">
                          No Plate Assigned
                        </span>
                      )}
                      {passport?.identity?.registrationStatus && (
                        <Badge className={`${
                          passport.identity.registrationStatus === 'Current' || passport.identity.registrationStatus === 'Active' ? 'bg-green-500 text-white' : 
                          passport.identity.registrationStatus === 'Pending' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
                        } text-[10px] font-semibold`} data-testid="registration-status-badge">
                          {passport.identity.registrationStatus}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-3 text-sm text-gray-500">
                      <MapPin className="w-4 h-4" />{[vehicle.location, vehicle.province].filter(Boolean).join(', ') || 'Location not recorded'}
                      <span className="mx-1">•</span>
                      <Calendar className="w-4 h-4" />Listed {vehicle.listingDate ? new Date(vehicle.listingDate).toLocaleDateString() : 'date not recorded'}
                    </div>
                  </div>
                  <div className={`${trust.tone} text-white px-4 py-2 rounded-xl text-center min-w-[70px] max-w-[150px]`} data-testid="trust-score-badge">
                    {trust.score !== null && (
                      <p className="text-2xl font-bold" data-testid="trust-score-value">{trust.score}</p>
                    )}
                    <p className="text-xs" data-testid="trust-score-label">{trust.headline}</p>
                  </div>
                </div>
                {vehicle.description && <p className="text-gray-700 mb-6 leading-relaxed">{vehicle.description}</p>}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  {[
                    // 0 km is a real reading, so presence is tested on the number, not on truthiness.
                    { label: 'Mileage',       value: Number.isFinite(vehicle.mileage) ? `${vehicle.mileage.toLocaleString()} km` : null, icon: Gauge },
                    { label: 'Transmission',  value: vehicle.transmission || null, icon: Settings2 },
                    { label: 'Fuel Type',     value: vehicle.fuel_type || vehicle.fuelType || null, icon: Fuel },
                    { label: 'Condition',     value: vehicle.condition || null, icon: FileCheck },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <item.icon className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">{item.label}</p>
                      {item.value ? (
                        <p className="font-semibold text-sm">{item.value}</p>
                      ) : (
                        <p className="text-sm text-gray-400 italic" data-testid="spec-not-recorded">Not recorded</p>
                      )}
                    </div>
                  ))}
                </div>
                {(vehicle.features ?? []).length > 0 && (
                  <>
                    <Separator className="mb-6" />
                    <h3 className="font-semibold mb-3">Features</h3>
                    <div className="flex flex-wrap gap-2">
                      {(vehicle.features ?? []).map((f) => (
                        <Badge key={f} variant="secondary" className="bg-gray-100 text-gray-700 font-normal">{f}</Badge>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Tabs ─────────────────────────────────────────────────── */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <Tabs defaultValue="history">
                  <TabsList className="w-full flex-wrap">
                    <TabsTrigger value="history" className="flex-1">Vehicle History</TabsTrigger>
                    <TabsTrigger value="report" className="flex-1">History Report</TabsTrigger>
                    <TabsTrigger value="evidence" className="flex-1">Evidence Vault</TabsTrigger>
                    <TabsTrigger value="verification" className="flex-1">Verification</TabsTrigger>
                    <TabsTrigger value="market" className="flex-1">Market Analysis</TabsTrigger>
                  </TabsList>

                  {/* ── History tab: real timeline ── */}
                  <TabsContent value="history" className="mt-4" data-testid="history-tab-content">
                    {timeline.length === 0 ? (
                      <div className="text-center py-8 text-gray-400" data-testid="history-empty-state">
                        <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">No history events recorded yet</p>
                        <p className="text-xs mt-1 text-gray-400">Events appear as service records, ownership transfers, and inspections are logged on the CarUp blockchain</p>
                      </div>
                    ) : (
                      <div className="space-y-3" data-testid="history-timeline">
                        {timeline.map((event: TimelineEvent, idx) => {
                          const { icon: Icon, color } = timelineIcon(event.event_source)
                          return (
                            <div key={`${event.event_source}-${event.id ?? idx}`}
                              className="flex items-start gap-3 p-3 rounded-lg bg-gray-50"
                              data-testid="timeline-event"
                            >
                              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${color}`}>
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">{event.label}</p>
                                {event.desc && <p className="text-xs text-gray-500 mt-0.5 truncate">{event.desc}</p>}
                                <p className="text-xs text-gray-400 mt-1">
                                  {event.timestamp ? new Date(event.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown'}
                                  {event.details?.mileage ? ` · ${event.details.mileage.toLocaleString()} km` : ''}
                                </p>
                                {event.event_source === 'evidence' && (
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <Badge className="bg-green-100 text-green-700 border-0 shadow-none">
                                      Verified Proof
                                    </Badge>
                                    {event.linked_registry_event_id && (
                                      <span className="text-[11px] text-gray-500 font-mono">
                                        Linked: {event.linked_registry_event_id}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {/* Add chronological evidence thumbnails */}
                                {publicEvidence.filter(e => e.linked_registry_event_id === String(event.id) || e.timeline_event_id === String(event.id)).length > 0 && (
                                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                                    {publicEvidence.filter(e => e.linked_registry_event_id === String(event.id) || e.timeline_event_id === String(event.id)).map(item => {
                                      const isDoc = item.mime_type?.includes('pdf') || item.file_url.endsWith('.pdf') || item.evidence_type.includes('document');
                                      return (
                                        <div key={item.id} className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden border border-gray-200" data-testid={`history-thumbnail-${item.id}`}>
                                          {isDoc ? (
                                            <div className="w-full h-full bg-gray-50 flex items-center justify-center">
                                              <FileText className="w-6 h-6 text-gray-400" />
                                            </div>
                                          ) : (
                                            <img src={item.file_url} className="w-full h-full object-cover" alt="" />
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Vehicle History Report tab (M4): full buyer report ── */}
                  <TabsContent value="report" className="mt-4" data-testid="history-report-tab-content">
                    {/* Owner/dealer/admin actions: snapshot a version + create an expiring share link.
                        Backend role-gates the writes; UI keeps them unobtrusive for privileged roles. */}
                    {canManageReport && (
                      <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4" data-testid="report-owner-actions">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <FileSearch className="h-4 w-4 text-gray-400" aria-hidden="true" />
                            <span>Snapshot this report or share it with a buyer via an expiring link.</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleGenerateReportVersion}
                              disabled={reportBusy}
                            >
                              {reportBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck className="mr-2 h-4 w-4" />}
                              Generate report version
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleCreateShareLink}
                              disabled={reportBusy}
                            >
                              {reportBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                              Create share link
                            </Button>
                          </div>
                        </div>
                        {shareLink && (
                          <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2" data-testid="report-share-link">
                            <Copy className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                            <code className="min-w-0 flex-1 truncate text-xs text-gray-600">{shareLink}</code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => { navigator.clipboard?.writeText(shareLink); toast.success('Copied.') }}
                            >
                              Copy
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {reportLoading ? (
                      <div className="flex flex-col items-center py-12 text-gray-400">
                        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
                        <p className="mt-3 text-sm">Loading vehicle history report…</p>
                      </div>
                    ) : report ? (
                      <VehicleHistoryReport report={report} />
                    ) : (
                      <div className="text-center py-10 text-gray-400" data-testid="history-report-unavailable">
                        <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
                        <p className="font-medium">History report unavailable</p>
                        <p className="text-xs mt-1">{reportError || 'The report could not be loaded for this vehicle.'}</p>
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Evidence tab: buyer-facing visual proof timeline ── */}
                  <TabsContent value="evidence" className="mt-4" data-testid="evidence-timeline-tab-content">
                    {/* Vehicle life-stage timeline (M1): groups verified, public-safe evidence by the eight life stages. */}
                    {publicEvidence.length > 0 && (
                      <div className="mb-8">
                        <h3 className="text-lg font-semibold mb-3">Vehicle Life Timeline</h3>
                        <VehicleLifeStageTimeline
                          evidence={publicEvidence}
                          taxonomy={evidenceTaxonomy}
                          sources={evidenceSources}
                        />
                      </div>
                    )}
                    <PremiumEvidenceGallery evidence={evidenceVault} />

                    {/* Vehicle Life Intelligence (M3): reviewer-confirmed, public-safe
                        before/after comparisons across the vehicle's life. Empty is the
                        expected case for most vehicles and implies nothing is wrong. */}
                    <div className="mt-8" data-testid="temporal-comparison-section">
                      <h3 className="text-lg font-semibold mb-1">Component Changes Over Time</h3>
                      <p className="text-xs text-gray-500 mb-3">
                        Reviewer-confirmed before/after comparisons of vehicle components across its life.
                      </p>
                      <VehicleTemporalComparison findings={temporalFindings} />
                    </div>

                    {/* Disclosure conflicts: neutral comparison of seller disclosures
                        against available evidence. Empty is the expected case. */}
                    <div className="mt-8" data-testid="disclosure-panel-section">
                      <h3 className="text-lg font-semibold mb-1">Disclosure Review</h3>
                      <p className="text-xs text-gray-500 mb-3">
                        How the seller's disclosures compare against available evidence, as confirmed by a reviewer.
                      </p>
                      <VehicleDisclosurePanel conflicts={disclosureConflicts} />
                    </div>
                    {/* M5 governance: disputes & corrections (public-safe; owners can raise). */}
                    <div className="mt-8" data-testid="dispute-panel-section">
                      <DisputePanel vin={vehicle?.vin || id || ''} />
                    </div>
                  </TabsContent>

                  {/* ── Verification tab: real trust metrics ── */}
                  <TabsContent value="verification" className="mt-4" data-testid="verification-tab-content">
                    {verificationSources.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">Verification data unavailable</p>
                        <p className="text-xs mt-1">Trust report could not be loaded for this vehicle</p>
                      </div>
                    ) : (
                      <div className="space-y-2" data-testid="verification-list">
                        {verificationSources.map((src: PassportVerificationSource) => {
                          const Icon = src.status === 'verified' ? CheckCircle
                            : src.status === 'warning' ? AlertTriangle
                            : src.status === 'not_verified' ? XCircle
                            : HelpCircle
                          const iconColor = src.status === 'verified' ? 'text-green-600'
                            : src.status === 'warning' ? 'text-amber-600'
                            : 'text-gray-400'

                          return (
                            <div key={src.label}
                              className="flex items-center gap-3 p-3 rounded-lg bg-gray-50"
                              data-testid="verification-item"
                            >
                              <Icon className={`w-5 h-5 flex-shrink-0 ${iconColor}`} />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">{src.label}</p>
                                {src.detail && <p className="text-xs text-gray-500 mt-0.5">{src.detail}</p>}
                              </div>
                              <VerificationBadge status={src.status} />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Market Analysis tab ── */}
                  <TabsContent value="market" className="mt-4">
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Listed Price</p>
                        <p className="text-xl font-bold">{formatPrice(vehicle.price ?? 0, vehicle.currency ?? 'USD')}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Trust Score</p>
                        {trust.score !== null ? (
                          <p className={`text-xl font-bold ${trust.toneText}`} data-testid="market-trust-score">{trust.score} / 100</p>
                        ) : (
                          <p className={`text-sm font-semibold ${trust.toneText}`} data-testid="market-trust-unscored">{trust.headline}</p>
                        )}
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Service Records</p>
                        {serviceRecordCount === null ? (
                          <p className="text-sm text-gray-400 italic" data-testid="service-records-unrecorded">Not recorded</p>
                        ) : (
                          <p className="text-xl font-bold">{serviceRecordCount}</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                      <h4 className="font-medium text-sm mb-2">CarUp Data Summary</h4>
                      <p className="text-sm text-gray-600" data-testid="carup-data-summary">
                        {trust.score !== null
                          ? `CarUp's trust authority published ${trust.score}/100 for this vehicle — ${trust.headline.toLowerCase()}.`
                          : `${trust.headline}: CarUp has published no trust score for this vehicle.`}
                        {` ${trust.detail}`}
                        {/* The calculation version is stated only beside a published score. Naming
                            the superseded version beside a withheld one would read as provenance
                            for a number the page is deliberately not showing. */}
                        {trust.score !== null && publicTrust?.calculation_version
                          ? ` Calculation version ${publicTrust.calculation_version}.`
                          : ''}
                        {serviceRecordCount === null
                          ? ' No service-record count is recorded for this vehicle.'
                          : serviceRecordCount > 0
                            ? ` It has ${serviceRecordCount} mechanic-signed service record(s) on the ledger.`
                            : ' No mechanic-signed service records have been submitted yet.'}
                        {/* An adverse alert is stated when it is present. Its absence is NOT stated as
                            "no active alert" — no record is not the same as a clean check. */}
                        {trustSignals?.stolen_alert_active
                          ? ' ⚠️ WARNING: This vehicle has an active police alert.'
                          : ''}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        A recorded event is not by itself a verification, so CarUp does not turn a count of
                        events into a trust claim. Each signal is shown separately in the trust breakdown.
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* ── Right sidebar ────────────────────────────────────────────── */}
          <div className="space-y-6">
            {/* Price / CTA card */}
            <Card className="border-0 card-shadow bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white sticky top-6">
              <CardContent className="p-6">
                <p className="text-sm text-gray-300 mb-1">Price</p>
                <p className="text-3xl font-bold">{formatPrice(vehicle.price ?? 0, vehicle.currency ?? 'USD')}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  <span className="text-sm text-gray-300" data-testid="sidebar-trust">
                    {trust.score !== null
                      ? `CarUp Trust Score: ${trust.score}`
                      : `CarUp Trust: ${trust.headline}`}
                  </span>
                </div>
                {sellerContactNumber && sellerWhatsAppLink ? (
                  <div className="flex gap-2 mt-6">
                    <a href={`tel:${sellerContactNumber}`} onClick={() => toast.info(`Calling ${vehicle.sellerName ?? 'the seller'}...`)} className="flex-1">
                      <Button className="w-full bg-orange-500 hover:bg-orange-600 gap-1"><Phone className="w-4 h-4" /> Call</Button>
                    </a>
                    <a href={sellerWhatsAppLink} target="_blank" rel="noopener noreferrer" className="flex-1">
                      <Button variant="outline" className="w-full border-white/30 text-white hover:bg-white/10 gap-1"><MessageSquare className="w-4 h-4" /> WhatsApp</Button>
                    </a>
                  </div>
                ) : (
                  <div className="mt-6" data-testid="seller-contact-unavailable">
                    <div className="flex gap-2">
                      <Button disabled className="flex-1 bg-orange-500 gap-1"><Phone className="w-4 h-4" /> Call</Button>
                      <Button disabled variant="outline" className="flex-1 border-white/30 text-white gap-1"><MessageSquare className="w-4 h-4" /> WhatsApp</Button>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      No contact number is published for this seller.
                      {detail
                        ? ' Use “Send inquiry” above — CarUp routes your request to the seller.'
                        : ' Direct contact opens once the seller publishes a number.'}
                    </p>
                  </div>
                )}
                <Separator className="my-4 border-white/20" />
                {isReservedOnServer ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-amber-600/20 border border-amber-500/40 rounded-lg py-3 text-amber-300 font-semibold text-sm" data-testid="reserved-state">
                    <Lock className="w-4 h-4" /> Reserved
                  </div>
                ) : reserveRequested ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-white/10 border border-white/20 rounded-lg py-3 text-gray-200 font-semibold text-sm" data-testid="reserve-requested-state">
                    <Clock className="w-4 h-4" /> Reservation requested — awaiting confirmation
                  </div>
                ) : (
                  <>
                    <Button
                      className="w-full bg-white text-gray-900 hover:bg-gray-100 font-semibold gap-2"
                      onClick={() => setShowReserveModal(true)}
                      disabled={!resolvedSellerId}
                    >
                      <Lock className="w-4 h-4" /> Reserve Vehicle
                    </Button>
                    {!resolvedSellerId && (
                      <p className="text-xs text-gray-400 mt-2" data-testid="reserve-unavailable">
                        SafePay escrow is opened by CarUp once a verified inquiry confirms the seller, so it cannot be
                        started from this page.
                        {detail ? ' Use “Send inquiry” above to begin.' : ''}
                      </p>
                    )}
                  </>
                )}
                {isFinanced ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-blue-600/20 border border-blue-500/40 rounded-lg py-3 text-blue-400 font-semibold text-sm mt-3">
                    <CheckCircle className="w-4 h-4" /> Financing Applied ✓
                  </div>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="w-full mt-3 border-white/20 text-white hover:bg-white/10 gap-2"
                      onClick={() => setShowFinanceModal(true)}
                      disabled={!canApplyForFinancing}
                    >
                      <CreditCard className="w-4 h-4" /> Apply for Financing
                    </Button>
                    {!canApplyForFinancing && (
                      <p className="text-xs text-gray-400 mt-2" data-testid="financing-signin-required">
                        Sign in to apply — the application is submitted under your CarUp account.
                      </p>
                    )}
                  </>
                )}
                <p className="text-xs text-gray-400 text-center mt-3">🔒 Protected by CarUp SafePay Escrow</p>
              </CardContent>
            </Card>

            {/* Seller card */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Seller Information</h3>
                <div className="flex items-center gap-3 mb-4">
                  {vehicle.sellerAvatar && <img src={vehicle.sellerAvatar} alt="" className="w-12 h-12 rounded-full object-cover" />}
                  <div>
                    <p className="font-medium" data-testid="seller-name">
                      {vehicle.sellerName
                        ?? (passport?.ownershipSummary?.currentSellerRecorded ? 'Not shown publicly' : 'Not recorded')}
                    </p>
                    {vehicle.sellerType && (
                      <Badge variant="outline" className="text-[10px] mt-0.5">{vehicle.sellerType}</Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-400" />
                    {sellerContactNumber ? (
                      <a href={`tel:${sellerContactNumber}`} className="hover:text-orange-500">{sellerContactNumber}</a>
                    ) : (
                      <span className="text-gray-500" data-testid="seller-phone-unavailable">No contact number published</span>
                    )}
                  </div>
                </div>
                <Button variant="outline" className="w-full mt-4" asChild>
                  <Link to="/dealers">View All Listings</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Vehicle Identity */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Vehicle Identity</h3>
                <div className="space-y-3 text-sm">
                  {[
                    // `redactable` marks the rows the projection withholds from an unauthorized
                    // audience; the rest are public, so absence there can only mean unrecorded.
                    { label: 'VIN', value: identity?.vin || vehicle.vin, redactable: false },
                    { label: 'Chassis No.', value: identity?.chassisNumber || vehicle.chassis_number, redactable: true },
                    { label: 'Engine No.', value: identity?.engineNumber || vehicle.engine_number || vehicle.engineNumber, redactable: true },
                    { label: 'Reg. Country', value: identity?.registrationCountry || vehicle.registration_country, redactable: false },
                    { label: 'Reg. Authority', value: identity?.registrationAuthority || vehicle.registration_authority, redactable: false },
                    { label: 'Color', value: vehicle.color, redactable: false },
                  ].map(({ label, value, redactable }) => {
                    const state = identifierState(value, redactable && identifiersRedacted)
                    return (
                      <div key={label} className="flex justify-between">
                        <span className="text-gray-500">{label}</span>
                        {state === 'present' ? (
                          <span className="font-mono text-xs" data-testid="identity-field-present" data-field={label}>{value}</span>
                        ) : state === 'withheld' ? (
                          <span className="text-xs text-gray-500 italic" data-testid="identity-field-withheld" data-field={label}>Not shown publicly</span>
                        ) : (
                          <span className="text-xs text-gray-400 italic" data-testid="identity-field-unrecorded" data-field={label}>Not recorded</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Ownership Summary */}
            {passport?.ownershipSummary && (
              <Card className="border-0 card-shadow" data-testid="ownership-summary-card">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Ownership Summary</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current Seller</span>
                      {passport.ownershipSummary.currentSellerDisplayName ? (
                        <span className="font-medium" data-testid="ownership-seller-present">
                          {passport.ownershipSummary.currentSellerDisplayName}
                        </span>
                      ) : passport.ownershipSummary.currentSellerRecorded ? (
                        <span className="font-medium text-gray-500" data-testid="ownership-seller-withheld">
                          Not shown publicly
                        </span>
                      ) : (
                        <span className="font-medium text-gray-500" data-testid="ownership-seller-unrecorded">
                          Not recorded
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current Owner Type</span>
                      {passport.ownershipSummary.currentSellerType ? (
                        <span className="font-medium" data-testid="ownership-seller-type-present">
                          {passport.ownershipSummary.currentSellerType}
                        </span>
                      ) : (
                        <span className="font-medium text-gray-500" data-testid="ownership-seller-type-unrecorded">
                          Not recorded
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Previous Owners</span>
                      <span className="font-medium" data-testid="prev-owner-count">
                        {passport.ownershipSummary.previousOwnerCount} owner(s) ({passport.ownershipSummary.previousOwnersPublicLabel})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Owner PII Status</span>
                      <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">
                        {passport.ownershipSummary.ownerNamesRedacted ? 'Redacted' : 'Full Access'}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Plate History */}
            {passport?.plateHistory && (
              <Card className="border-0 card-shadow" data-testid="plate-history-card">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Plate Registration History</h3>
                  {passport.plateHistory.length === 0 ? (
                    passport.plateHistoryRedacted ? (
                      <p className="text-xs text-gray-400" data-testid="plate-history-withheld">
                        Plate registration history is not shown publicly for this vehicle.
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400" data-testid="plate-history-empty">
                        No previous plates logged in history.
                      </p>
                    )
                  ) : (
                    <div className="space-y-3">
                      {passport.plateHistory.map((h, i) => {
                        const plateState = identifierState(h.plate_number, identifiersRedacted)
                        return (
                        <div key={h.id || i} className="border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                          <div className="flex justify-between items-center text-sm">
                            {plateState === 'present' ? (
                              <span className="font-mono font-bold text-xs" data-testid="plate-history-number-present">{h.plate_number}</span>
                            ) : plateState === 'withheld' ? (
                              <span className="text-xs text-gray-500 italic" data-testid="plate-history-number-withheld">Plate not shown publicly</span>
                            ) : (
                              <span className="text-xs text-gray-400 italic" data-testid="plate-history-number-unrecorded">Plate not recorded</span>
                            )}
                            <Badge variant="outline" className={`text-[9px] uppercase ${
                              h.status === 'active' ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500'
                            }`}>
                              {h.status || 'status not recorded'}
                            </Badge>
                          </div>
                          <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                            <span>Type: {h.plate_type || 'not recorded'}</span>
                            <span>{h.issued_at ? new Date(h.issued_at).toLocaleDateString() : 'date not recorded'}</span>
                          </div>
                          {h.reason && <p className="text-[10px] text-gray-500 mt-1 italic">Reason: {h.reason}</p>}
                        </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* What the canonical assessment is based on. The former "Trust Score Breakdown"
                invented per-category percentages on the client; a fabricated precision is worse
                than no breakdown, so only what the authority actually published is rendered here.
                This card is where the projection's other two axes surface: `confidence` (how much
                evidence is behind the number) and `evidence_basis` (what that evidence is). A
                number alone cannot tell an unevidenced vehicle from a genuinely low-scoring one. */}
            {publicTrust && (
              <Card className="border-0 card-shadow" data-testid="trust-basis">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-1">What this assessment is based on</h3>
                  <p className="text-xs text-gray-500 mb-4" data-testid="trust-state-detail">
                    {trust.detail} CarUp does not estimate a sub-score for a signal it has no record of.
                  </p>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-gray-200 bg-gray-50 text-[10px] text-gray-600" data-testid="trust-evaluation-state">
                      {TRUST_STATE_LABELS[publicTrust.evaluation_state] ?? publicTrust.evaluation_state}
                    </Badge>
                    <Badge variant="outline" className="border-gray-200 bg-gray-50 text-[10px] text-gray-600" data-testid="trust-confidence">
                      {TRUST_CONFIDENCE_LABELS[publicTrust.confidence] ?? publicTrust.confidence}
                    </Badge>
                    {trust.score !== null && publicTrust.evaluated_at && (
                      <span className="text-[10px] text-gray-500" data-testid="trust-evaluated-at">
                        Evaluated {new Date(publicTrust.evaluated_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {evidenceBasis && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Evidence behind this assessment</p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600" data-testid="trust-evidence-basis">
                        <dt>Governed facts backed by a record</dt>
                        <dd className="text-right font-medium">
                          {basisValue(evidenceBasis.governed_facts_substantiated)}
                          {evidenceBasis.governed_facts_total === null ? '' : ` of ${evidenceBasis.governed_facts_total}`}
                        </dd>
                        <dt>Adverse findings</dt>
                        <dd className="text-right font-medium">{basisValue(evidenceBasis.governed_facts_adverse)}</dd>
                        <dt>Connected sources</dt>
                        <dd className="text-right font-medium">{basisValue(evidenceBasis.connected_sources)}</dd>
                        <dt>Stored claims with no backing record</dt>
                        <dd className="text-right font-medium" data-testid="trust-unbacked-claims">
                          {basisValue(evidenceBasis.unbacked_legacy_claims)}
                        </dd>
                      </dl>
                    </div>
                  )}

                  {trustReasonCodes.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Reason codes</p>
                      <div className="flex flex-wrap gap-1.5" data-testid="trust-reason-codes">
                        {trustReasonCodes.map((code) => (
                          <Badge key={code} variant="outline" className="border-gray-200 bg-gray-50 font-mono text-[10px] text-gray-600">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {trustLimitations.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-gray-700 mb-2">Known limitations</p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-gray-600" data-testid="trust-known-limitations">
                        {trustLimitations.map((limitation, i) => (
                          <li key={i}>{limitation}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Ledger verification badge */}
            {passport?.chainVerification && (
              <Card className="border-0 card-shadow">
                <CardContent className="p-4">
                  <div className={`flex items-center gap-2 text-sm ${passport.chainVerification.verified ? 'text-green-700' : 'text-amber-700'}`}>
                    {passport.chainVerification.verified
                      ? <><CheckCircle className="w-4 h-4" /> Blockchain ledger verified — tamper-proof record</>
                      : <><AlertTriangle className="w-4 h-4" /> Ledger integrity unconfirmed</>
                    }
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* ── Reserve Modal ─────────────────────────────────────────────────── */}
      <Dialog open={showReserveModal} onOpenChange={setShowReserveModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="w-5 h-5 text-orange-500" /> Reserve this Vehicle</DialogTitle>
            <DialogDescription>Secure your interest with a CarUp SafePay reservation</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="font-semibold">{vehicle.year ?? ''} {vehicle.make ?? ''} {vehicle.model ?? ''}</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">{formatPrice(vehicle.price ?? 0, vehicle.currency ?? 'USD')}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-1">
              <p className="font-semibold">What happens next:</p>
              <p>✓ Vehicle held exclusively for you for 7 days</p>
              <p>✓ Refundable deposit of <strong>$500</strong> held in SafePay escrow</p>
              <p>✓ Seller notified immediately via WhatsApp</p>
              <p>✓ Funds released only on successful transfer</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowReserveModal(false)} disabled={reserveLoading}>Cancel</Button>
              <Button className="flex-1 bg-orange-500 hover:bg-orange-600" onClick={handleReserve} disabled={reserveLoading || !resolvedSellerId}>
                {reserveLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</> : 'Confirm Reservation'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Finance Modal ─────────────────────────────────────────────────── */}
      <Dialog open={showFinanceModal} onOpenChange={setShowFinanceModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-blue-500" /> Apply for Financing</DialogTitle>
            <DialogDescription>Get pre-approved through CarUp's banking partners</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-500">Vehicle</p>
              <p className="font-semibold">{vehicle.year ?? ''} {vehicle.make ?? ''} {vehicle.model ?? ''} — {formatPrice(vehicle.price ?? 0, vehicle.currency ?? 'USD')}</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Loan Amount (USD)</label>
              <Input type="number" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} min={1000} max={vehicle.price ?? 0} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Loan Term</label>
              <Select value={loanTerm} onValueChange={setLoanTerm}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['12', '24', '36', '48', '60'].map(m => <SelectItem key={m} value={m}>{m} months</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Preferred Bank</label>
              <Select value={selectedBank} onValueChange={setSelectedBank}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cbz">CBZ Bank</SelectItem>
                  <SelectItem value="stanbic">Stanbic Zimbabwe</SelectItem>
                  <SelectItem value="cabs">CABS Bank</SelectItem>
                  <SelectItem value="fbc">FBC Bank</SelectItem>
                  <SelectItem value="zb">ZB Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowFinanceModal(false)} disabled={financeLoading}>Cancel</Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={handleFinance} disabled={financeLoading || !loanAmount}>
                {financeLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Submit Application'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
