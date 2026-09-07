/**
 * People & Compliance Operations workspace — O2/P3+P4.
 *
 * ONE person-centered review surface. Read model only: every decision goes through the OWNING
 * domain route (identity session review, dealer compliance decision), and per-vehicle Seller
 * Authority decisions live where they always have — the Vehicle Operations workspace, which each
 * authority row links to. The separate concepts stay separate on screen: email verification,
 * identity verification, Seller Authority, vehicle ownership and dealer compliance are five
 * sections, never one badge. Actions render ONLY from server-derived allowed_actions (G2);
 * "who must act next" chips are the server's own domain-owned projections (M8 ADR vocabulary).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle, XCircle, RotateCcw, ArrowUpRight, ShieldQuestion } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'

interface IdentitySession {
  id: string; status: string | null; workflow_phase: string; final_disposition: string | null;
  primary_reason_code: string | null; review_decision: string | null; retry_reason: string | null;
  created_at: string | null; submitted_at: string | null; reviewed_at: string | null; who_must_act: string;
}

interface PersonReview {
  person: {
    id: string; name: string | null; email: string | null; role: string | null;
    email_verified: boolean; joined_at: string | null;
    tenant_memberships: Array<{ tenant_id: string; role: string }>;
  }
  identity: { evaluated: boolean; latest: IdentitySession | null; sessions: IdentitySession[]; who_must_act: string }
  seller_authority: {
    total: number;
    records: Array<{ vin: string; claim_type: string; status: string; basis: string | null; reason: string | null; policy_version: string; decided_by_role: string | null; decided_at: string | null; who_must_act: string }>;
  }
  ownership: {
    vehicles_owned: Array<{ vin: string; publication_status: string | null; label: string | null }>;
    transfers: Array<{ id: string; vin: string; state: string; relationship: string; completed_at: string | null; who_must_act: string }>;
  }
  dealer_compliance: {
    is_dealer: boolean;
    profile?: { id: string; suspension_state: string | null; restriction_state: string | null; compliance_review_state: string | null; identity_status: string | null; expiry_state: string };
    requirements?: Array<{ requirement_key: string; status: string; is_blocking: boolean; still_blocking: boolean }>;
    who_must_act?: string;
  }
  audit: Array<{ id: string; event_type: string; actor_role: string | null; reason: string | null; created_at: string | null }>
  allowed_actions: string[]
}

const RESPONSIBILITY_TONE: Record<string, string> = {
  none: 'bg-gray-100 text-gray-600',
  platform_processing: 'bg-blue-100 text-blue-800',
  carup_review: 'bg-orange-100 text-orange-800',
  subject_action: 'bg-amber-100 text-amber-800',
  external_authority: 'bg-purple-100 text-purple-800',
  escalated: 'bg-red-100 text-red-800',
}

function WhoMustAct({ value }: { value?: string }) {
  if (!value) return null
  return (
    <Badge variant="outline" className={`text-[11px] border-0 ${RESPONSIBILITY_TONE[value] || 'bg-gray-100 text-gray-600'}`}>
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

const IDENTITY_DECIDABLE = new Set(['reviewer_action_required', 'escalated'])

export default function PeopleComplianceReview() {
  const { userId = '' } = useParams()
  const { fetchPersonComplianceReview, reviewIdentitySession, recordDealerComplianceDecision } = useCarUpApi()

  const [review, setReview] = useState<PersonReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [identityNote, setIdentityNote] = useState('')
  const [dealerReason, setDealerReason] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Async continuation, never a synchronous setState in the effect body (react-hooks rule; the
    // same structure the Vehicle Operations workspace certified with).
    Promise.resolve().then(async () => {
      if (cancelled) return
      setLoading(true)
      setLoadError(null)
      try {
        const body = await fetchPersonComplianceReview(userId)
        if (!cancelled) setReview(body.review as unknown as PersonReview)
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Failed to load the review')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [userId, reloadNonce, fetchPersonComplianceReview])

  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])
  const can = new Set(review?.allowed_actions ?? [])

  const decideIdentity = async (action: 'approve' | 'request_resubmission' | 'reject' | 'escalate') => {
    if (!review?.identity.latest) return
    if (action !== 'approve' && !identityNote.trim()) {
      toast.error('A written reason is required for this identity decision.')
      return
    }
    setBusy(true)
    try {
      await reviewIdentitySession(review.identity.latest.id, { action, notes: identityNote.trim() || undefined })
      toast.success('Identity decision recorded through the identity service')
      setIdentityNote('')
      reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Identity decision failed')
    } finally {
      setBusy(false)
    }
  }

  const decideDealer = async (decision: string) => {
    if (!review?.dealer_compliance.profile) return
    if (!dealerReason.trim()) {
      toast.error('A written reason is required for a dealer compliance decision.')
      return
    }
    setBusy(true)
    try {
      await recordDealerComplianceDecision(review.dealer_compliance.profile.id, { decision, reason: dealerReason.trim() })
      toast.success('Dealer compliance decision recorded through the dealer service')
      setDealerReason('')
      reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dealer decision failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500" data-testid="people-review-loading">Loading person review…</div>
  }
  if (loadError || !review) {
    return (
      <div className="p-6" data-testid="people-review-unavailable">
        <p className="text-sm text-gray-700">The People &amp; Compliance review is unavailable.</p>
        <p className="text-xs text-gray-500 mt-1">{loadError || 'No data returned.'}</p>
      </div>
    )
  }

  const { person, identity, seller_authority, ownership, dealer_compliance, audit } = review

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="people-compliance-review">
      {/* ── Person (account facts — email verification is an ACCOUNT fact, nothing more) ── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{person.name || person.id}</h1>
              <p className="text-sm text-gray-600">{person.email || 'no email on record'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-[11px]">{person.role || 'unknown role'}</Badge>
              <Badge variant="outline" className={`text-[11px] border-0 ${person.email_verified ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {person.email_verified ? 'email verified' : 'email unverified'}
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <Fact label="Person ID" value={<span className="font-mono text-xs">{person.id}</span>} />
            <Fact label="Joined" value={person.joined_at} />
            <Fact label="Tenant memberships" value={person.tenant_memberships.length ? person.tenant_memberships.map((t) => t.role).join(', ') : 'none'} />
            <Fact label="Vehicles owned" value={String(ownership.vehicles_owned.length)} />
          </div>
        </CardContent>
      </Card>

      {/* ── Identity verification (identity service owns the truth) ── */}
      <Card data-testid="people-identity-section">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <SectionTitle>Identity verification</SectionTitle>
            <WhoMustAct value={identity.who_must_act} />
          </div>
          {!identity.evaluated && (
            <p className="text-sm text-gray-500 flex items-center gap-2">
              <ShieldQuestion className="w-4 h-4" /> No identity verification session exists. Identity is NOT asserted either way.
            </p>
          )}
          {identity.latest && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Fact label="Workflow phase" value={identity.latest.workflow_phase.replace(/_/g, ' ')} />
                <Fact label="Disposition" value={identity.latest.final_disposition?.replace(/_/g, ' ')} />
                <Fact label="Reason code" value={identity.latest.primary_reason_code} />
                <Fact label="Submitted" value={identity.latest.submitted_at} />
              </div>
              {can.has('identity.review') && IDENTITY_DECIDABLE.has(identity.latest.workflow_phase) && (
                <div className="space-y-2 border-t pt-3">
                  <Textarea
                    data-testid="identity-decision-note"
                    placeholder="Reviewer note / reason (required for every decision except approve)"
                    value={identityNote}
                    onChange={(e) => setIdentityNote(e.target.value)}
                    className="min-h-[56px] text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white gap-1" disabled={busy} onClick={() => decideIdentity('approve')}>
                      <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => decideIdentity('request_resubmission')}>
                      <RotateCcw className="w-3.5 h-3.5" /> Request resubmission
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200 gap-1" disabled={busy} onClick={() => decideIdentity('reject')}>
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => decideIdentity('escalate')}>
                      <ArrowUpRight className="w-3.5 h-3.5" /> Escalate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Seller Authority (per vehicle; decisions live in the Vehicle Operations workspace) ── */}
      <Card data-testid="people-authority-section">
        <CardContent className="pt-6">
          <SectionTitle>Seller authority — per vehicle</SectionTitle>
          {seller_authority.records.length === 0 && (
            <p className="text-sm text-gray-500">No authority claims. Absence of authority is not an adverse finding.</p>
          )}
          <div className="space-y-2">
            {seller_authority.records.map((record) => (
              <div key={record.vin} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 px-3 py-2">
                <div className="min-w-0">
                  <Link to={`/admin/vehicles/${record.vin}/review`} className="text-sm font-mono text-blue-700 hover:underline">{record.vin}</Link>
                  <p className="text-xs text-gray-500">
                    {record.status.replace(/_/g, ' ')}{record.basis ? ` · ${record.basis.replace(/_/g, ' ')}` : ''}
                    {record.decided_by_role ? ` · decided by ${record.decided_by_role}` : ''}
                  </p>
                </div>
                <WhoMustAct value={record.who_must_act} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Ownership (canonical via the governed transfer lifecycle) ── */}
      <Card data-testid="people-ownership-section">
        <CardContent className="pt-6">
          <SectionTitle>Ownership &amp; transfers</SectionTitle>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Vehicles owned</p>
              {ownership.vehicles_owned.length === 0 && <p className="text-sm text-gray-500">None</p>}
              {ownership.vehicles_owned.map((v) => (
                <p key={v.vin} className="text-sm">
                  <Link to={`/admin/vehicles/${v.vin}/review`} className="font-mono text-blue-700 hover:underline">{v.vin}</Link>
                  <span className="text-gray-500"> {v.label || ''} · {v.publication_status || 'unknown'}</span>
                </p>
              ))}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Ownership transfers</p>
              {ownership.transfers.length === 0 && <p className="text-sm text-gray-500">None</p>}
              {ownership.transfers.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate"><span className="font-mono">{t.vin}</span> · {t.state.replace(/_/g, ' ')} · {t.relationship.replace(/_/g, ' ')}</span>
                  <WhoMustAct value={t.who_must_act} />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Dealer compliance (domain statuses VERBATIM — never a generic Operations status) ── */}
      <Card data-testid="people-dealer-section">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <SectionTitle>Dealer / business compliance</SectionTitle>
            <WhoMustAct value={dealer_compliance.who_must_act} />
          </div>
          {!dealer_compliance.is_dealer && <p className="text-sm text-gray-500">Not a dealer. No business compliance state applies.</p>}
          {dealer_compliance.is_dealer && dealer_compliance.profile && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Fact label="Suspension" value={dealer_compliance.profile.suspension_state} />
                <Fact label="Restriction" value={dealer_compliance.profile.restriction_state} />
                <Fact label="Compliance review" value={dealer_compliance.profile.compliance_review_state} />
                <Fact label="Document expiry" value={dealer_compliance.profile.expiry_state} />
              </div>
              {(dealer_compliance.requirements?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  {dealer_compliance.requirements!.map((r) => (
                    <p key={r.requirement_key} className="text-xs text-gray-600">
                      {r.requirement_key}: {r.status}{r.still_blocking ? ' · blocking' : ''}
                    </p>
                  ))}
                </div>
              )}
              {can.has('dealer_compliance.decide') && (
                <div className="space-y-2 border-t pt-3">
                  <Textarea
                    data-testid="dealer-decision-reason"
                    placeholder="Reason (required for every dealer compliance decision)"
                    value={dealerReason}
                    onChange={(e) => setDealerReason(e.target.value)}
                    className="min-h-[56px] text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => decideDealer('pass_review')}>Pass review</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => decideDealer('restrict')}>Restrict</Button>
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={busy} onClick={() => decideDealer('suspend')}>Suspend</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => decideDealer('reinstate')}>Reinstate</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Audit (decision facts only) ── */}
      <Card data-testid="people-audit-section">
        <CardContent className="pt-6">
          <SectionTitle>Authority decision history</SectionTitle>
          {audit.length === 0 && <p className="text-sm text-gray-500">No recorded authority decisions.</p>}
          <div className="space-y-1" role="region" aria-label="Authority decision history" tabIndex={0}>
            {audit.map((event) => (
              <p key={event.id} className="text-xs text-gray-600">
                {event.created_at} · {event.event_type.replace(/_/g, ' ')} · {event.actor_role || 'unknown role'}
                {event.reason ? ` · ${event.reason}` : ''}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
