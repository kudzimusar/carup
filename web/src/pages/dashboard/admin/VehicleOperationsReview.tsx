/**
 * Vehicle Operations Review — Operations Control Plane M4.
 *
 * The VIN-centered reviewer workspace. It COMPOSES the canonical domain
 * authorities (evidence, seller authority, registration lifecycle, trust,
 * governance, risk, publication gate) into one decision surface; every action
 * calls the owning service's route — nothing here creates parallel truth, and
 * there is deliberately no "make trust X", no ZIMRA/CVR button and no admin
 * publish action. What the operator may do comes from the server-derived
 * allowed_actions — the UI renders permission, it never grants it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowLeft, CheckCircle, FileText, Loader2, ShieldAlert, XCircle,
} from 'lucide-react'

// ── DTO types (mirror backend/services/operations/vehicleOperationsReadModel.js) ──

type Requirement = {
  key: string; label: string; category: string; blocking: boolean; status: string;
  who_must_act?: string; refusal_category?: string; reason_codes?: string[]
}

type EvidenceItem = {
  id: string; semantic_label: string; evidence_class: string | null; evidence_subtype: string | null;
  semantic_source: string | null; legacy_evidence_type: string | null; legacy_contradicts_canonical: boolean;
  verification_status: string; visibility_level: string; uploader_role: string | null;
  uploaded_by_seller: boolean; source_name: string | null; has_checksum: boolean;
  event_date: string | null; uploaded_at: string | null; verified_at: string | null;
  mime_type: string | null; ai_advisory_status: string | null;
  classification_history: Array<{ previous_evidence_class: string | null; corrected_at: string | null; reason: string | null }>
}

type OperationsReview = {
  vin: string
  generated_at: string
  vehicle: {
    vin: string; make: string; model: string; year: number; status: string; publication_status: string;
    chassis_number: string | null; engine_number: string | null; import_source: string | null;
    price: number | null; currency: string | null; listing_city: string | null;
    passport_verified: boolean; zimra_verified: boolean; duty_paid: boolean; created_at: string | null
  }
  seller: {
    account: { id: string; name: string | null; role: string | null; account_verified: boolean; email_verified: boolean; member_since: string | null } | null
    seller_type: string | null; owner_id: string | null; current_seller_id: string | null; tenant_id: string | null
  }
  seller_authority: {
    seller_user_id: string; status: string; basis: string | null; reason: string | null;
    policy_version: string; decided_by: string | null; decided_at: string | null;
    existing_relationship: boolean; public_statement: string; evidence_ids: string[]
  } | null
  registration: {
    recorded_stage: string | null; stage_source: string | null; stage_provenance: string;
    lifecycle: { label: string; status: string; publication_blocking: boolean; reason_codes: string[]; lifecycle_status: string | null }
    plate_number_recorded: boolean; temporary_permit_recorded: boolean
  }
  evidence: { total: number; groups: Record<string, EvidenceItem[]> }
  document_intelligence: { unresolved_material_fields: string[] }
  trust_summary: { trust_score: number | null; trust_band: string | null; evaluated: boolean; pending_fact_requests: number }
  governance_summary: { open_review_tasks: number; open_disputes: number }
  risk_summary: { open_cases: number; blocking_cases: number; cases: Array<{ id: string; status: string; severity: string | null; blocks_publication: boolean }> }
  publication_readiness: {
    is_publishable: boolean; completeness_percent: number; publication_status: string;
    requirements: Requirement[]
  }
  audit: Array<{ id: string; event_type: string; actor_role: string | null; reason: string | null; created_at: string }>
  allowed_actions: string[]
}

const CLASS_LABELS: Record<string, string> = {
  import: 'Import', auction: 'Auction', accident: 'Accident', repair: 'Repair',
  inspection: 'Inspection', ownership_transfer: 'Ownership Transfer',
  registration: 'Zimbabwe Registration', dealer_listing: 'Dealer Listing',
  current_condition: 'Current Condition', unclassified: 'Unclassified (legacy)',
}

const STATUS_TONE: Record<string, string> = {
  verified: 'bg-green-100 text-green-800',
  present: 'bg-green-100 text-green-800',
  pending_review: 'bg-amber-100 text-amber-800',
  missing: 'bg-red-100 text-red-700',
  not_available: 'bg-gray-100 text-gray-600',
  pending: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-700',
}

const ACT_LABELS: Record<string, string> = {
  seller: 'Seller must act',
  carup_review: 'Awaiting CarUp review',
  external_authority: 'Awaiting external authority',
  none: '—',
}

function StatusBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`text-[11px] border-0 ${STATUS_TONE[value] || 'bg-gray-100 text-gray-600'}`}>
      {value.replace(/_/g, ' ')}
    </Badge>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{children}</h2>
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm text-gray-900 truncate">{value ?? <span className="text-gray-500">Not recorded</span>}</p>
    </div>
  )
}

export default function VehicleOperationsReview() {
  const { vin = '' } = useParams()
  const {
    fetchVehicleOperationsReview, approveEvidence, rejectEvidence,
    correctEvidenceClassification, reviewSellerAuthority, fetchEvidenceTaxonomy,
  } = useCarUpApi()

  const [review, setReview] = useState<OperationsReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  // Classification-correction editor state (one row at a time).
  const [correctingId, setCorrectingId] = useState<string | null>(null)
  const [taxonomy, setTaxonomy] = useState<Array<{ evidence_class: string; subtypes: Array<{ subtype_code: string; label: string }> }>>([])
  const [correctionClass, setCorrectionClass] = useState('')
  const [correctionSubtype, setCorrectionSubtype] = useState('')

  // Seller authority decision state.
  const [authorityDecision, setAuthorityDecision] = useState('confirmed')
  const [authorityReason, setAuthorityReason] = useState('')

  // Reloads bump a nonce; the effect performs every state transition in async
  // continuations only (react-hooks/set-state-in-effect).
  const [reloadNonce, setReloadNonce] = useState(0)
  const load = useCallback(() => setReloadNonce((nonce) => nonce + 1), [])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(async () => {
      if (cancelled) return
      setLoading(true)
      setLoadError(null)
      try {
        const data = await fetchVehicleOperationsReview(vin)
        if (!cancelled) setReview(data.review as unknown as OperationsReview)
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load the review')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [fetchVehicleOperationsReview, vin, reloadNonce])

  useEffect(() => {
    if (!correctingId || taxonomy.length > 0) return
    fetchEvidenceTaxonomy()
      .then((data) => setTaxonomy((data.classes || []) as typeof taxonomy))
      .catch(() => toast.error('Could not load the evidence taxonomy'))
  }, [correctingId, taxonomy.length, fetchEvidenceTaxonomy])

  const can = useMemo(() => new Set(review?.allowed_actions ?? []), [review])

  const decideEvidence = async (item: EvidenceItem, action: 'approve' | 'reject') => {
    setBusyId(item.id)
    try {
      const note = notes[item.id] || (action === 'approve'
        ? 'Evidence reviewed and matches the vehicle record.'
        : 'Evidence rejected during Operations review.')
      if (action === 'approve') await approveEvidence(vin, item.id, note, 3)
      else await rejectEvidence(vin, item.id, note, -5)
      toast.success(action === 'approve' ? 'Evidence verified' : 'Evidence rejected')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Review action failed')
    } finally {
      setBusyId(null)
    }
  }

  const submitCorrection = async (item: EvidenceItem) => {
    const reason = notes[item.id]?.trim()
    if (!correctionClass || !correctionSubtype) { toast.error('Choose the corrected life stage and subtype.'); return }
    if (!reason) { toast.error('A classification correction requires a written reason.'); return }
    setBusyId(item.id)
    try {
      await correctEvidenceClassification(vin, item.id, {
        evidence_class: correctionClass, evidence_subtype: correctionSubtype, reason,
      })
      toast.success('Classification corrected — the original interpretation is preserved in history')
      setCorrectingId(null); setCorrectionClass(''); setCorrectionSubtype('')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Correction failed')
    } finally {
      setBusyId(null)
    }
  }

  const submitAuthorityDecision = async () => {
    if (!review?.seller_authority) return
    if (!authorityReason.trim()) { toast.error('A seller authority decision requires a reason.'); return }
    setBusyId('seller-authority')
    try {
      await reviewSellerAuthority(vin, {
        seller_user_id: review.seller_authority.seller_user_id,
        decision: authorityDecision,
        reason: authorityReason.trim(),
      })
      toast.success('Seller authority decision recorded')
      setAuthorityReason('')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Decision failed')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500 gap-2" data-testid="ops-review-loading">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading vehicle operations review…
      </div>
    )
  }

  if (loadError || !review) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3" data-testid="ops-review-error">
        <ShieldAlert className="w-8 h-8 mx-auto text-gray-500" />
        <p className="font-medium text-gray-800">Vehicle operations review unavailable</p>
        <p className="text-sm text-gray-500">{loadError || 'The vehicle could not be loaded.'}</p>
        <Link to="/admin/evidence" className="text-sm text-orange-700 inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Evidence Review
        </Link>
      </div>
    )
  }

  const v = review.vehicle
  const subtypesForCorrection = taxonomy.find((c) => c.evidence_class === correctionClass)?.subtypes ?? []

  return (
    <div className="space-y-8 max-w-[1440px]" data-testid="vehicle-operations-review">
      {/* ── Header: vehicle identity + publication state ─────────────────── */}
      <div className="border-b border-gray-200 pb-5">
        <Link to="/admin/evidence" className="text-xs text-gray-500 inline-flex items-center gap-1 mb-2 hover:text-orange-700">
          <ArrowLeft className="w-3.5 h-3.5" /> Evidence Review
        </Link>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{v.year} {v.make} {v.model}</h1>
            <p className="text-sm text-gray-500 font-mono mt-1">{v.vin}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">{v.status}</Badge>
            <Badge className={`text-xs border-0 ${v.publication_status === 'published' ? 'bg-green-700 text-white' : 'bg-gray-900 text-white'}`}>
              {v.publication_status}
            </Badge>
            <Badge className={`text-xs border-0 ${review.publication_readiness.is_publishable ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`} data-testid="ops-publishable-state">
              {review.publication_readiness.is_publishable ? 'Publishable' : 'Not yet publishable'}
            </Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-5">
          <Fact label="Chassis" value={v.chassis_number} />
          <Fact label="Engine" value={v.engine_number} />
          <Fact label="Import source" value={v.import_source} />
          <Fact label="Asking price" value={v.price != null ? `${v.currency ?? ''} ${v.price.toLocaleString()}` : null} />
          <Fact label="Listing city" value={v.listing_city} />
          <Fact label="Completeness" value={`${review.publication_readiness.completeness_percent}% of blocking requirements met`} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[2fr_1fr] gap-8 items-start">
        <div className="space-y-8 min-w-0">
          {/* ── Publication requirement matrix ─────────────────────────────── */}
          <section data-testid="ops-requirement-matrix">
            <SectionTitle>Marketplace readiness — requirement matrix</SectionTitle>
            <div className="overflow-x-auto rounded-lg border border-gray-200" role="region" aria-label="Publication requirement matrix" tabIndex={0}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2 font-medium">Requirement</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium">Blocking</th>
                    <th className="px-3 py-2 font-medium">Who must act</th>
                  </tr>
                </thead>
                <tbody>
                  {review.publication_readiness.requirements.map((r) => (
                    <tr key={r.key} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-900">{r.label}</td>
                      <td className="px-3 py-2 text-gray-500">{r.category.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2"><StatusBadge value={r.status} /></td>
                      <td className="px-3 py-2">{r.blocking ? <span className="text-red-600 font-medium">Yes</span> : <span className="text-gray-500">No</span>}</td>
                      <td className="px-3 py-2 text-gray-600">{ACT_LABELS[r.who_must_act ?? 'none'] ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Evidence set, grouped canonically ──────────────────────────── */}
          <section data-testid="ops-evidence-groups">
            <SectionTitle>Evidence — {review.evidence.total} item{review.evidence.total === 1 ? '' : 's'}, grouped by life stage</SectionTitle>
            {review.evidence.total === 0 && (
              <p className="text-sm text-gray-500">No evidence has been submitted for this vehicle.</p>
            )}
            <div className="space-y-6">
              {Object.entries(review.evidence.groups).map(([groupKey, items]) => (
                <div key={groupKey} data-testid={`ops-evidence-group-${groupKey}`}>
                  <h3 className="font-semibold text-gray-900 mb-2">{CLASS_LABELS[groupKey] || groupKey}</h3>
                  <div className="space-y-3">
                    {items.map((item) => (
                      <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileText className="w-4 h-4 text-orange-500" />
                          <span className="font-medium text-sm text-gray-900">{item.semantic_label}</span>
                          <StatusBadge value={item.verification_status} />
                          <Badge variant="outline" className="text-[10px]">{item.visibility_level.replace(/_/g, ' ')}</Badge>
                          {item.legacy_contradicts_canonical && (
                            <Badge className="text-[10px] border-0 bg-amber-50 text-amber-800 inline-flex items-center gap-1" data-testid="ops-legacy-contradiction">
                              <AlertTriangle className="w-3 h-3" /> legacy label “{item.legacy_evidence_type}” — canonical meaning governs
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5">
                          {item.uploaded_by_seller ? 'Uploaded by the seller' : `Uploaded by ${item.uploader_role || 'unknown role'}`}
                          {item.event_date ? ` · event date ${item.event_date}` : ''}
                          {item.uploaded_at ? ` · received ${new Date(item.uploaded_at).toLocaleDateString()}` : ''}
                          {item.has_checksum ? ' · checksum recorded' : ' · no checksum'}
                          {item.ai_advisory_status ? ` · AI advisory: ${item.ai_advisory_status.replace(/^ai_/, '')}` : ''}
                        </p>
                        {item.classification_history.length > 0 && (
                          <p className="text-[11px] text-gray-500 mt-1">
                            Classification corrected {item.classification_history.length}× — history preserved.
                          </p>
                        )}

                        {(can.has('evidence.verify') || can.has('evidence.correct_classification')) && item.verification_status === 'pending' && (
                          <div className="mt-3 space-y-2">
                            <Textarea
                              placeholder="Reviewer note / reason (required for corrections and rejections)"
                              value={notes[item.id] ?? ''}
                              onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              className="min-h-[56px] text-sm"
                            />
                            <div className="flex flex-wrap gap-2">
                              {can.has('evidence.verify') && (
                                <>
                                  <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white gap-1" disabled={busyId === item.id} onClick={() => decideEvidence(item, 'approve')}>
                                    <CheckCircle className="w-3.5 h-3.5" /> Verify
                                  </Button>
                                  <Button size="sm" variant="outline" className="text-red-600 border-red-200 gap-1" disabled={busyId === item.id} onClick={() => decideEvidence(item, 'reject')}>
                                    <XCircle className="w-3.5 h-3.5" /> Reject
                                  </Button>
                                </>
                              )}
                              {can.has('evidence.correct_classification') && correctingId !== item.id && (
                                <Button size="sm" variant="outline" onClick={() => { setCorrectingId(item.id); setCorrectionClass(item.evidence_class ?? ''); setCorrectionSubtype('') }}>
                                  Correct classification
                                </Button>
                              )}
                            </div>
                            {correctingId === item.id && (
                              <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end" data-testid="ops-correction-editor">
                                <div>
                                  <Label className="text-xs text-gray-500">Life stage</Label>
                                  <select
                                    aria-label="Corrected life stage"
                                    className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm"
                                    value={correctionClass}
                                    onChange={(e) => { setCorrectionClass(e.target.value); setCorrectionSubtype('') }}
                                  >
                                    <option value="">--</option>
                                    {taxonomy.map((c) => (
                                      <option key={c.evidence_class} value={c.evidence_class}>{CLASS_LABELS[c.evidence_class] || c.evidence_class}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <Label className="text-xs text-gray-500">Subtype</Label>
                                  <select
                                    aria-label="Corrected subtype"
                                    className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm"
                                    value={correctionSubtype}
                                    onChange={(e) => setCorrectionSubtype(e.target.value)}
                                    disabled={subtypesForCorrection.length === 0}
                                  >
                                    <option value="">--</option>
                                    {subtypesForCorrection.map((s) => (
                                      <option key={s.subtype_code} value={s.subtype_code}>{s.label}</option>
                                    ))}
                                  </select>
                                </div>
                                <Button size="sm" disabled={busyId === item.id} onClick={() => submitCorrection(item)} className="bg-orange-700 hover:bg-orange-800 text-white">
                                  Apply correction
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setCorrectingId(null)}>Cancel</Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Document intelligence ─────────────────────────────────────── */}
          <section data-testid="ops-document-intelligence">
            <SectionTitle>Document intelligence</SectionTitle>
            {review.document_intelligence.unresolved_material_fields.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Unresolved material contradictions: {review.document_intelligence.unresolved_material_fields.join(', ')} — resolve through the extraction review workflow before publication.
              </div>
            ) : (
              <p className="text-sm text-gray-500">No unresolved material contradiction between seller statements and document readings.</p>
            )}
          </section>

          {/* ── Audit trail ───────────────────────────────────────────────── */}
          <section data-testid="ops-audit-trail">
            <SectionTitle>Governed decision history</SectionTitle>
            {review.audit.length === 0 ? (
              <p className="text-sm text-gray-500">No governed decisions recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {review.audit.map((entry) => (
                  <li key={entry.id} className="text-sm text-gray-700 flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[11px] text-gray-500">{new Date(entry.created_at).toLocaleString()}</span>
                    <span className="font-medium">{entry.event_type}</span>
                    {entry.actor_role && <span className="text-gray-500">by {entry.actor_role}</span>}
                    {entry.reason && <span className="text-gray-500 italic">— {entry.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Right rail: seller, authority, registration, trust, risk ────── */}
        <div className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="ops-seller-section">
            <SectionTitle>Seller</SectionTitle>
            {review.seller.account ? (
              <div className="space-y-2">
                <Fact label="Name" value={review.seller.account.name} />
                <Fact label="Seller type" value={review.seller.seller_type} />
                <div className="flex gap-2 pt-1">
                  <Badge variant="outline" className={`text-[10px] ${review.seller.account.email_verified ? 'text-green-700' : 'text-amber-700'}`}>
                    {review.seller.account.email_verified ? 'Email verified' : 'Email not verified'}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${review.seller.account.account_verified ? 'text-green-700' : 'text-gray-500'}`}>
                    {review.seller.account.account_verified ? 'Account verified' : 'Account not verified'}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No individual seller account recorded{review.seller.tenant_id ? ' (tenant inventory)' : ''}.</p>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="ops-seller-authority-section">
            <SectionTitle>Seller authority</SectionTitle>
            {review.seller_authority ? (
              <div className="space-y-2">
                <StatusBadge value={review.seller_authority.status} />
                <p className="text-sm text-gray-700">{review.seller_authority.public_statement}</p>
                {review.seller_authority.basis && (
                  <p className="text-xs text-gray-500">Basis: {review.seller_authority.basis.replace(/_/g, ' ')} · {review.seller_authority.policy_version}</p>
                )}
                {review.seller_authority.decided_at && (
                  <p className="text-xs text-gray-500">Decided {new Date(review.seller_authority.decided_at).toLocaleString()}</p>
                )}
                {can.has('seller_authority.review') && (
                  <div className="pt-2 space-y-2 border-t border-gray-100 mt-2" data-testid="ops-authority-decision">
                    <Label className="text-xs text-gray-500">Governed decision</Label>
                    <select
                      aria-label="Seller authority decision"
                      className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm"
                      value={authorityDecision}
                      onChange={(e) => setAuthorityDecision(e.target.value)}
                    >
                      <option value="confirmed">Confirm authority</option>
                      <option value="under_review">Mark under review</option>
                      <option value="insufficient">Insufficient</option>
                      <option value="disputed">Disputed</option>
                      <option value="revoked">Revoke</option>
                    </select>
                    <Textarea
                      placeholder="Reason (required — becomes part of the audit record)"
                      value={authorityReason}
                      onChange={(e) => setAuthorityReason(e.target.value)}
                      className="min-h-[56px] text-sm"
                    />
                    <Button size="sm" className="w-full bg-gray-900 hover:bg-gray-800 text-white" disabled={busyId === 'seller-authority'} onClick={submitAuthorityDecision}>
                      Record decision
                    </Button>
                    <p className="text-[11px] text-gray-500">
                      Confirms authority under CarUp policy only — never a legal-title or registration claim. The seller keeps the final Publish action.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No seller recorded, so no authority to assess.</p>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="ops-registration-section">
            <SectionTitle>Zimbabwe registration</SectionTitle>
            <div className="space-y-2">
              <Fact label="Recorded stage" value={review.registration.recorded_stage ? review.registration.lifecycle.label : null} />
              <Fact label="Stage provenance" value={review.registration.stage_provenance === 'seller_statement' ? 'Seller statement' : review.registration.stage_provenance.replace(/_/g, ' ')} />
              <Fact label="Local plate" value={review.registration.plate_number_recorded ? 'Recorded' : 'Not recorded'} />
              <Fact label="Temporary import permit" value={review.registration.temporary_permit_recorded ? 'Recorded' : 'Not recorded'} />
              <div className="pt-1">
                {review.registration.lifecycle.publication_blocking ? (
                  <Badge className="text-[10px] border-0 bg-amber-100 text-amber-800">Blocks publication until resolved</Badge>
                ) : (
                  <Badge className="text-[10px] border-0 bg-green-100 text-green-800">Does not block publication</Badge>
                )}
              </div>
              {review.registration.lifecycle.reason_codes.length > 0 && (
                <p className="text-[11px] text-gray-500">Reasons: {review.registration.lifecycle.reason_codes.join(', ')}</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="ops-trust-section">
            <SectionTitle>Trust &amp; governance</SectionTitle>
            <div className="space-y-2">
              <Fact
                label="Canonical trust"
                value={review.trust_summary.evaluated
                  ? `${review.trust_summary.trust_score ?? '—'} (${review.trust_summary.trust_band ?? 'no band'})`
                  : 'Not yet evaluated'}
              />
              <Fact label="Pending trust-fact requests" value={String(review.trust_summary.pending_fact_requests)} />
              <Fact label="Open governance tasks" value={String(review.governance_summary.open_review_tasks)} />
              <Fact label="Open disputes" value={String(review.governance_summary.open_disputes)} />
              <p className="text-[11px] text-gray-500 pt-1">
                Trust changes go through the canonical Trust/Governance services — this workspace never edits a score.
              </p>
              <Link to="/admin/trust-review" className="text-xs text-orange-700">Open Trust Review →</Link>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="ops-risk-section">
            <SectionTitle>Fraud &amp; risk</SectionTitle>
            {review.risk_summary.cases.length === 0 ? (
              <p className="text-sm text-gray-500">No risk cases recorded for this vehicle.</p>
            ) : (
              <ul className="space-y-1.5">
                {review.risk_summary.cases.map((c) => (
                  <li key={c.id} className="text-sm flex items-center gap-2">
                    <StatusBadge value={c.status} />
                    {c.blocks_publication && <Badge className="text-[10px] border-0 bg-red-100 text-red-700">blocks publication</Badge>}
                    <span className="text-gray-500 text-xs">{c.severity ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/admin/fraud-queue" className="text-xs text-orange-700 mt-2 inline-block">Open Fraud Queue →</Link>
          </section>
        </div>
      </div>
    </div>
  )
}
