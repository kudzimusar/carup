/**
 * RX05-A — the unified presentation of /dealers/claims (the claimant's own claim → compliance →
 * legal → activation status). The page container keeps every read, upload, import, submission and
 * appeal; this view arranges them as a status journey: where am I, what is needed next, then the
 * controls for each stage in order.
 *
 * Truth rules: every stage status comes from deriveClaimJourney() over what the server returned.
 * Uploaded documents, saved drafts and submitted versions are "submitted"/"waiting", never approved.
 * A stage is shown as done only for a decision the server recorded.
 */
import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Clock3, Download, FileSpreadsheet, FileText, Landmark, Lock, RotateCcw,
  ScanText, ShieldCheck, Store, Upload, X,
} from 'lucide-react'
import { DealerDraftReview } from '@/components/dealer/DealerDraftReview'
import type { DraftReviewPreview } from '@/lib/dealerDraftReview'
import { dealerDate, dealerDateTime } from '@/lib/dealerDates'
import { cn } from '@/lib/utils'
import {
  CLAIM_SECTION_IDS, claimStatusTone, deriveClaimJourney, humanizeStatus, type JourneyStage, type JourneyState,
} from './dealerShowroomModel'
import { ACTION_PRIMARY, ACTION_SECONDARY, CARD, EYEBROW, FIELD, HINT, LABEL, Notice, SkeletonBlock, StatusChip, TEXTAREA, TEXT_LINK } from './ShowroomPrimitives'
import { TONE_PANEL, TONE_TEXT } from './showroomTones'

export interface WorkspaceClaim { claim_id: string; seed_dealer_id: string; claimed_scope: string; claim_status: string; created_at: string }
export interface WorkspaceEvidence {
  evidence_id: string; document_class: string; created_at: string
  mime_type?: string; file_bytes?: number; quarantined?: boolean
  quarantine?: { actor_kind: string; reason_code: string; recorded_at: string } | null
}
export interface WorkspaceOcrCandidate {
  event_id: string; evidence_id: string; document_class: string; extraction_state: string
  pages_processed: number; review_flags: string[]; created_at: string
  extracted_fields: Record<string, { value: string; page: number; confidence: null }>
}
export interface WorkspaceJurisdiction {
  state: string; country?: string | null; policy_version?: string | null; policy_status?: string
  can_activate: boolean; can_publish: boolean; legal_review_complete: boolean; unresolved?: string[]
  requirements: Array<{ requirement_key: string; label: string; reason: string; applicability: string; evidence_status: string; legal_source_verified: boolean }>
}
export interface WorkspaceDraft {
  schema_version: string; submission_version: number; state: string; updated_at: string
  content: { tab_rows: Record<string, Array<Record<string, string>>> }
  review_preview?: DraftReviewPreview | null
}
export interface WorkspaceSubmission {
  submission_id: string; intake_version: number; schema_version: string; submitted_at: string
  preliminary_status: string; correction_reason: string | null; reviewed_at: string | null
}
export interface WorkspaceCsvPreview {
  target_tab: string; csv_sha256: string; input_headers: string[]; input_rows: number
  suggestions: Record<string, string>; unmapped: string[]; conflicts: string[]
  allowed_targets: Array<{ key: string; label: string; data_type: string; required: boolean }>
}
export interface WorkspaceAuthority {
  state: string; operational: boolean; tenant_member_role?: string
  blocking_reasons?: string[]; next_step?: string; legal_expires_at?: string | null
  public_listings_withdrawn?: boolean | null; public_listings_withdrawal_pending?: boolean | null
  organization_id?: string; public_storefront_approved?: boolean
  vehicle_listing_authority_granted?: boolean; attach_status?: string
}

type Setter<T> = Dispatch<SetStateAction<T>>

export interface ClaimWorkspaceModel {
  signedIn: boolean
  loading: boolean
  claims: WorkspaceClaim[]
  /** True when the latest read of the claims list failed (the list may be stale or empty). */
  claimsReadFailed: boolean
  onRetryClaims: () => void
  selected: string | null
  onSelect: (claimId: string) => void
  chosen: WorkspaceClaim | undefined
  detailsLoaded: boolean
  busy: boolean
  notice: string
  error: string
  // evidence
  evidence: WorkspaceEvidence[]
  documentClasses: Array<[string, string, string]>
  documentLabel: (code: string) => string
  documentClass: string
  setDocumentClass: Setter<string>
  documentClassConfirmed: boolean
  setDocumentClassConfirmed: Setter<boolean>
  documentFile: File | null
  setDocumentFile: Setter<File | null>
  uploadEvidence: () => void
  withdrawEvidence: (evidenceId: string) => void
  extractEvidenceCandidates: (evidenceId: string) => void
  ocrCandidates: WorkspaceOcrCandidate[]
  // application
  downloadPrefilled: () => void
  workbookFile: File | null
  setWorkbookFile: Setter<File | null>
  uploadWorkbook: () => void
  fileProblem: { scope: 'workbook' | 'csv'; text: string } | null
  setFileProblem: Setter<{ scope: 'workbook' | 'csv'; text: string } | null>
  csvTab: string
  setCsvTab: Setter<string>
  csvFile: File | null
  setCsvFile: Setter<File | null>
  csvPreview: WorkspaceCsvPreview | null
  setCsvPreview: (value: null) => void
  csvMapping: Record<string, string | null>
  setCsvMapping: Setter<Record<string, string | null>>
  csvAcknowledged: boolean
  setCsvAcknowledged: Setter<boolean>
  previewLegacyCsv: () => void
  importMappedCsv: () => void
  manual: {
    legalName: string; setLegalName: Setter<string>
    tradingName: string; setTradingName: Setter<string>
    registrationNumber: string; setRegistrationNumber: Setter<string>
    registrationAuthority: string; setRegistrationAuthority: Setter<string>
    country: string; setCountry: Setter<string>
    city: string; setCity: Setter<string>
    branchName: string; setBranchName: Setter<string>
    researchConfirmation: string; setResearchConfirmation: Setter<string>
    signer: string; setSigner: Setter<string>
    signerRole: string; setSignerRole: Setter<string>
    privacy: boolean; setPrivacy: Setter<boolean>
  }
  saveManual: () => void
  draft: WorkspaceDraft | null
  submitAcknowledged: boolean
  setSubmitAcknowledged: Setter<boolean>
  submitFrozenApplication: () => void
  complianceSubmissions: WorkspaceSubmission[]
  // legal + activation
  jurisdiction: WorkspaceJurisdiction | null
  operationalAuthority: WorkspaceAuthority | null
  reasonText: Record<string, string>
  nextStepText: Record<string, string>
  // appeal
  appealReason: string
  setAppealReason: Setter<string>
  appeal: () => void
}

const CSV_TABS = ['BUSINESS', 'BRANCHES', 'LICENCES_AUTHORIZATIONS', 'BRANDS_FRANCHISES', 'OPERATIONS_SOURCING', 'FINANCE_PAYMENTS',
  'WORKSHOP_WARRANTY', 'BUYER_PROTECTION', 'DIGITAL_MEDIA', 'VEHICLE_INVENTORY_REFERENCE', 'CONSENTS_DECLARATIONS']

const FILE_FIELD = 'block w-full min-h-11 rounded-control border border-carup-line-strong bg-carup-bg-raised px-2 py-1.5 text-sm text-carup-text file:mr-3 file:min-h-8 file:rounded-full file:border-0 file:bg-carup-bg-surface-2 file:px-4 file:text-sm file:font-semibold file:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus'
const CHECK = 'mt-0.5 h-4 w-4 shrink-0 accent-carup-action'

const STAGE_LOOK: Record<JourneyState, { bar: string; dot: string; label: string }> = {
  done: { bar: 'bg-status-success', dot: 'bg-status-success text-carup-action-on', label: 'Done' },
  current: { bar: 'bg-carup-action', dot: 'bg-carup-action text-carup-action-on', label: 'Your turn' },
  attention: { bar: 'bg-status-warning', dot: 'bg-status-warning text-carup-action-on', label: 'Needs attention' },
  waiting: { bar: 'bg-status-info', dot: 'bg-status-info-soft text-status-info ring-1 ring-status-info', label: 'With CarUp' },
  blocked: { bar: 'bg-status-danger', dot: 'bg-status-danger text-carup-action-on', label: 'Blocked' },
  upcoming: { bar: 'bg-carup-line', dot: 'bg-carup-bg-surface-2 text-carup-text-3', label: 'Later' },
  unknown: { bar: 'bg-carup-line', dot: 'bg-carup-bg-surface-2 text-carup-text-3', label: 'Unknown' },
  unconfirmed: { bar: 'bg-carup-line-strong', dot: 'bg-status-neutral-soft text-status-neutral ring-1 ring-carup-line-strong', label: 'Not confirmed here' },
}

function StageDot({ stage, index }: { stage: JourneyStage; index: number }) {
  const look = STAGE_LOOK[stage.state]
  const Icon = stage.state === 'done' ? Check : stage.state === 'waiting' ? Clock3 : stage.state === 'attention' ? AlertTriangle : stage.state === 'blocked' ? X : null
  return (
    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums', look.dot)} aria-hidden="true">
      {Icon ? <Icon className="h-4 w-4" /> : index + 1}
    </span>
  )
}

function Journey({ stages }: { stages: JourneyStage[] }) {
  return (
    <ol className="grid gap-0 md:grid-cols-4 md:gap-4" aria-label="Claim journey" data-testid="dealer-claim-journey">
      {stages.map((stage, index) => {
        const look = STAGE_LOOK[stage.state]
        return (
          <li key={stage.key} className="relative flex min-w-0 gap-3 pb-6 last:pb-0 md:block md:pb-0" data-testid={`dealer-claim-stage-${stage.key}`} data-state={stage.state}
            aria-current={stage.state === 'current' || stage.state === 'attention' ? 'step' : undefined}>
            {/* rail: vertical on phones, horizontal from md */}
            {index < stages.length - 1 && <span className={cn('absolute left-4 top-9 bottom-1 w-0.5 rounded-full md:hidden', look.bar)} aria-hidden="true" />}
            <span className={cn('hidden h-1 rounded-full md:block', look.bar)} aria-hidden="true" />
            <div className="flex min-w-0 gap-3 md:mt-3">
              <StageDot stage={stage} index={index} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3">
                  {String(index + 1).padStart(2, '0')} · {look.label}
                </p>
                <p className="mt-0.5 font-semibold text-carup-text">{stage.title}</p>
                <p className={cn('mt-0.5 text-sm leading-5', stage.state === 'upcoming' || stage.state === 'unknown' ? 'text-carup-text-3' : 'text-carup-text-2')}>{stage.status}</p>
                {stage.detail && <p className="mt-1 text-[13px] leading-5 text-carup-text-3 [overflow-wrap:anywhere]">{stage.detail}</p>}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function StageGroup({ index, title, note, children }: { index: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-4" aria-label={title}>
      <div className="flex items-baseline gap-3 border-t border-carup-line pt-6">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-action tabular-nums">{index}</span>
        <h2 className="text-lg font-semibold tracking-[-0.015em]">{title}</h2>
      </div>
      {note && <p className="-mt-2 max-w-3xl text-sm leading-6 text-carup-text-2">{note}</p>}
      {children}
    </section>
  )
}

function Panel({ id, title, icon: Icon, lead, children, testId }: { id?: string; title: string; icon: typeof FileText; lead?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section id={id} className={cn(CARD, 'scroll-mt-24 p-5 sm:p-6')} data-testid={testId} aria-labelledby={id ? `${id}-title` : undefined}>
      <h3 id={id ? `${id}-title` : undefined} className="flex items-center gap-2 text-base font-semibold">
        <Icon className="h-4 w-4 shrink-0 text-carup-action" aria-hidden="true" />{title}
      </h3>
      {lead && <div className="mt-1.5 max-w-3xl text-sm leading-6 text-carup-text-2">{lead}</div>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function Disclosure({ title, summary, open, onToggle, children }: { title: string; summary?: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  return (
    <details open={open} onToggle={event => onToggle((event.currentTarget as HTMLDetailsElement).open)} className="group rounded-card ring-1 ring-carup-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {summary && <span className="block text-[13px] text-carup-text-2">{summary}</span>}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-carup-text-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-carup-line px-4 py-4">{children}</div>
    </details>
  )
}

export function DealerClaimWorkspaceShowroom({ model: m }: { model: ClaimWorkspaceModel }) {
  const [csvOpen, setCsvOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const chosen = m.chosen
  const journey = chosen ? deriveClaimJourney({
    claimStatus: chosen.claim_status,
    evidence: m.detailsLoaded ? m.evidence : [],
    draft: m.detailsLoaded ? m.draft : null,
    submissions: m.detailsLoaded ? m.complianceSubmissions : [],
    authority: m.detailsLoaded ? m.operationalAuthority : null,
    detailsLoaded: m.detailsLoaded,
  }) : null
  const approved = chosen?.claim_status === 'CLAIM_APPROVED'
  const evidenceOpen = chosen ? ['AWAITING_DOCUMENTARY_EVIDENCE', 'CLAIM_DISPUTED', 'CLAIM_APPEALED', 'CLAIM_APPROVED'].includes(chosen.claim_status) : false
  const canAppeal = chosen ? ['CLAIM_REJECTED', 'CLAIM_DISPUTED', 'CLAIM_REVOKED'].includes(chosen.claim_status) : false
  const authority = m.operationalAuthority
  const latestDraftBusiness = m.draft?.content.tab_rows.BUSINESS?.[0]
  const csvShown = csvOpen || Boolean(m.csvPreview) || m.fileProblem?.scope === 'csv'

  const goTo = (id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="min-h-screen bg-carup-bg text-carup-text" data-testid="dealer-claim-workspace-showroom" data-presentation="unified">
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <Link to="/dealers" className="inline-flex min-h-11 items-center gap-1.5 rounded-control text-sm font-semibold text-carup-text hover:text-carup-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to dealership directory
        </Link>
        <header className="mt-3 max-w-3xl">
          <p className={EYEBROW}>Dealer onboarding</p>
          <h1 className="mt-2 text-[clamp(1.75rem,3.2vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.03em]">My dealership claim applications</h1>
          <p className="mt-3 text-[15px] leading-7 text-carup-text-2">
            Claims, company verification and dealer operations are separate processes.
            Only authorized claimants may receive prefilled private workbooks.
          </p>
        </header>

        {!m.signedIn ? (
          <div className={cn(CARD, 'mt-8 flex flex-col gap-4 p-6 sm:flex-row sm:items-center')}>
            <Lock className="h-5 w-5 text-carup-text-3" aria-hidden="true" />
            <p className="flex-1 text-[15px]"><Link to="/login" className={TEXT_LINK}>Sign in</Link> to review your claims.</p>
          </div>
        ) : m.loading ? (
          <div className="mt-8 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <SkeletonBlock className="h-40" />
            <div className="space-y-4"><SkeletonBlock className="h-28" /><SkeletonBlock className="h-40" /></div>
            <p className="sr-only" role="status">Loading your claim applications…</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10">
            {/* ── Claims list ── */}
            <nav aria-label="My research claims" className="min-w-0">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">My research claims</h2>
              {m.claimsReadFailed && m.claims.length === 0 ? (
                <div className={cn(CARD, 'mt-3 p-5 text-sm leading-6 text-carup-text-2')} data-testid="dealer-claims-read-failed">
                  Your claim applications could not be loaded. This is not evidence that you have none.
                  <button type="button" onClick={m.onRetryClaims} className={cn(ACTION_SECONDARY, 'mt-3 w-full')}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />Try again
                  </button>
                </div>
              ) : m.claims.length === 0 ? (
                <div className={cn(CARD, 'mt-3 p-5 text-sm leading-6 text-carup-text-2')}>
                  No claim requests yet. Find a published unclaimed business in the directory.
                  <p className="mt-3"><Link to="/dealers" className={TEXT_LINK}>Open the dealership directory</Link></p>
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {m.claims.map(claim => {
                    const active = m.selected === claim.claim_id
                    return (
                      <li key={claim.claim_id}>
                        <button
                          type="button"
                          aria-current={active ? 'true' : undefined}
                          onClick={() => m.onSelect(claim.claim_id)}
                          className={cn(
                            'w-full rounded-card p-4 text-left ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus',
                            active ? 'bg-carup-bg-raised ring-2 ring-carup-text' : 'bg-carup-bg-surface ring-carup-line hover:bg-carup-bg-raised',
                          )}
                          data-testid={`dealer-claim-list-${claim.seed_dealer_id}`}
                        >
                          <span className="block font-semibold">{claim.seed_dealer_id}</span>
                          <span className="mt-2 block"><StatusChip tone={claimStatusTone(claim.claim_status)}>{humanizeStatus(claim.claim_status)}</StatusChip></span>
                          <span className="mt-2 block text-xs text-carup-text-3">{humanizeStatus(claim.claimed_scope)} · requested {dealerDate(claim.created_at)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </nav>

            <div className="min-w-0 space-y-8">
              {chosen && journey && (
                <>
                  {/* ── Object header + journey + next step ── */}
                  <section className={cn(CARD, 'overflow-hidden')} aria-labelledby="claim-object-title">
                    <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
                      <div className="min-w-0">
                        <p className={EYEBROW}>Ownership claim · {humanizeStatus(chosen.claimed_scope)}</p>
                        <h2 id="claim-object-title" className="mt-1.5 text-2xl font-bold tracking-[-0.02em]">Claim {chosen.seed_dealer_id}</h2>
                        <p className="mt-1 text-sm text-carup-text-2">Requested {dealerDate(chosen.created_at)} · Current status: <strong className="font-semibold text-carup-text">{humanizeStatus(chosen.claim_status)}</strong></p>
                      </div>
                      <Link className={ACTION_SECONDARY} to={`/dealers/${chosen.seed_dealer_id.toLowerCase()}`}>
                        <Store className="h-4 w-4" aria-hidden="true" />View the public research profile
                      </Link>
                    </div>
                    <div className="border-t border-carup-line bg-carup-bg-surface p-5 sm:p-6">
                      <Journey stages={journey.stages} />
                    </div>
                    <div className={cn('flex flex-col gap-4 border-t-4 p-5 sm:flex-row sm:items-center sm:p-6', TONE_PANEL[journey.next.tone])} data-testid="dealer-claim-next-step" data-tone={journey.next.tone}>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-[11px] font-semibold uppercase tracking-[0.16em]', TONE_TEXT[journey.next.tone])}>What happens next</p>
                        <p className="mt-1 text-lg font-semibold tracking-[-0.015em] text-carup-text">{journey.next.title}</p>
                        <p className="mt-1 text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]">{journey.next.body}</p>
                      </div>
                      {journey.next.href ? (
                        <Link to={journey.next.href} className={ACTION_PRIMARY}>{journey.next.title}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                      ) : journey.next.target ? (
                        <button type="button" className={ACTION_PRIMARY} onClick={() => goTo(journey.next.target!)}>Go to this step<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
                      ) : null}
                    </div>
                    <p className="border-t border-carup-line px-5 py-3 text-[13px] leading-5 text-carup-text-3 sm:px-6">
                      A verified account email or submitted document alone does not prove company ownership.
                      An independent reviewer must inspect the original evidence and determine branch/parent scope.
                    </p>
                  </section>

                  {/* ── Stage 1: ownership claim ── */}
                  {(evidenceOpen || m.evidence.length > 0 || canAppeal) && (
                    <StageGroup index="Stage 01" title="Ownership claim">
                      {evidenceOpen && (
                        <Panel
                          id={CLAIM_SECTION_IDS.evidence}
                          icon={Upload}
                          title={approved ? 'Additional original documents for separate compliance review' : 'Original business-authority evidence'}
                          lead="JPEG, PNG or PDF, maximum 6MB. Only the private CarUp evidence store is used; acceptance requires a real ClamAV clean scan, with manual verification afterwards."
                        >
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="min-w-0">
                              <label htmlFor="claim-document-class" className={LABEL}>Evidence type</label>
                              <select id="claim-document-class" className={FIELD} value={m.documentClass}
                                onChange={event => { m.setDocumentClass(event.target.value); m.setDocumentClassConfirmed(false) }}>
                                <option value="">Choose what this document is…</option>
                                {m.documentClasses.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                              </select>
                              {m.documentClass && <p className={HINT} data-testid="claim-document-class-help">{m.documentClasses.find(([code]) => code === m.documentClass)?.[2]}</p>}
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="claim-document-file" className={LABEL}>Original document</label>
                              <input id="claim-document-file" type="file" className={FILE_FIELD} accept="image/jpeg,image/png,application/pdf"
                                onChange={event => { m.setDocumentFile(event.target.files?.[0] || null); m.setDocumentClassConfirmed(false) }} />
                              {m.documentFile && <p className={cn(HINT, '[overflow-wrap:anywhere]')}>
                                Selected: {m.documentFile.name} · {m.documentFile.type || 'unknown type'} · {Math.max(1, Math.round(m.documentFile.size / 1024))} KB</p>}
                            </div>
                          </div>
                          <label htmlFor="claim-document-class-confirmed" className="flex items-start gap-2.5 text-sm leading-6">
                            <input id="claim-document-class-confirmed" type="checkbox" className={CHECK}
                              checked={m.documentClassConfirmed} disabled={!m.documentClass || !m.documentFile}
                              onChange={event => m.setDocumentClassConfirmed(event.target.checked)} />
                            <span className="min-w-0">{m.documentClass
                              ? `This file is my ${m.documentLabel(m.documentClass).toLowerCase()}.`
                              : 'Choose the evidence type first.'} It is not a photo of the showroom or premises — add those
                              later as company profile or facility photos in your dealer workspace.</span>
                          </label>
                          <button type="button" className={ACTION_PRIMARY} disabled={m.busy || !m.documentFile || !m.documentClass || !m.documentClassConfirmed}
                            onClick={m.uploadEvidence}>Upload private evidence</button>
                          {m.evidence.length > 0 && (
                            <div className="border-t border-carup-line pt-4">
                              <p className="text-sm font-semibold">{m.evidence.length} private evidence record(s)</p>
                              <ul className="mt-2 space-y-2">
                                {m.evidence.map(item => (
                                  <li key={item.evidence_id} data-testid="claim-evidence-record"
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-carup-bg-surface p-3 text-sm">
                                    <div className="min-w-0 [overflow-wrap:anywhere]">
                                      <p className="flex flex-wrap items-center gap-2">
                                        <FileText className="h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
                                        <span className={item.quarantined ? 'text-carup-text-3 line-through' : 'font-semibold'}>{m.documentLabel(item.document_class)}</span>
                                        {!item.quarantined && <StatusChip tone="neutral">Private · submitted</StatusChip>}
                                      </p>
                                      <p className="mt-0.5 text-[13px] text-carup-text-2">
                                        {item.mime_type ? item.mime_type : ''}{item.file_bytes ? ' · ' + Math.max(1, Math.round(item.file_bytes / 1024)) + ' KB' : ''}
                                        {' · '}Submitted {dealerDate(item.created_at)}
                                      </p>
                                      {item.quarantined && <p className="mt-1 text-[13px] text-status-warning">
                                        {item.quarantine?.actor_kind === 'CLAIMANT_WITHDRAWAL'
                                          ? 'Withdrawn by you as uploaded by mistake — never used as legal proof.'
                                          : 'Quarantined by a CarUp reviewer — not usable as legal proof. Upload the correct document.'}</p>}
                                    </div>
                                    {!item.quarantined && (
                                      <button type="button" className={cn(ACTION_SECONDARY, 'min-h-9 px-4 text-[13px]')} disabled={m.busy}
                                        onClick={() => m.withdrawEvidence(item.evidence_id)}>Uploaded by mistake — withdraw</button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </Panel>
                      )}
                      {m.evidence.length > 0 && (
                        <Panel icon={ScanText} title="Document intelligence — candidate observations"
                          lead="Uses a separately authorized local OCR provider only when qualified. Missing tools or unreadable pages require manual review, never automatic business approval. Results and originals stay private to your claim.">
                          <ul className="space-y-2">
                            {m.evidence.map(item => (
                              <li key={item.evidence_id} className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-carup-bg-surface p-3 text-sm">
                                <span className="min-w-0">
                                  <strong className="font-semibold">{humanizeStatus(item.document_class)}</strong>
                                  <span className="block text-xs text-carup-text-3">Original evidence recorded</span>
                                </span>
                                <button type="button" className={cn(ACTION_SECONDARY, 'min-h-9 px-4 text-[13px]')} disabled={m.busy}
                                  onClick={() => m.extractEvidenceCandidates(item.evidence_id)}>Extract candidate fields</button>
                              </li>
                            ))}
                          </ul>
                          {m.ocrCandidates.length === 0 && <p className="text-sm text-carup-text-2">No OCR attempts recorded. The original document still needs independent human review.</p>}
                          {m.ocrCandidates.map(candidate => (
                            <section key={candidate.event_id} className="rounded-card p-3 text-sm ring-1 ring-carup-line" aria-label="Unverified document candidate">
                              <p className="flex flex-wrap items-center gap-2 font-semibold">
                                {humanizeStatus(candidate.document_class)} · {humanizeStatus(candidate.extraction_state)}
                                <StatusChip tone="neutral">Not verified</StatusChip>
                              </p>
                              <p className="mt-1 text-xs text-carup-text-2">{candidate.pages_processed} page(s) processed · Confidence unknown · Not verified</p>
                              {Object.entries(candidate.extracted_fields).map(([name, field]) => (
                                <p className="mt-2 break-words" key={name}>
                                  <span className="font-semibold">{humanizeStatus(name)}:</span> {field.value}
                                  <span className="text-carup-text-3"> (page {field.page}, unconfirmed)</span>
                                </p>
                              ))}
                              {candidate.review_flags?.length > 0 && <p className="mt-2 text-status-warning">Review needed: {candidate.review_flags.join(', ').replaceAll('_', ' ')}</p>}
                            </section>
                          ))}
                        </Panel>
                      )}
                      {canAppeal && (
                        <Panel id={CLAIM_SECTION_IDS.appeal} icon={Landmark} title="Appeal the claim decision"
                          lead="An appeal is reviewed separately and independently. No authority changes while it is open.">
                          <div>
                            <label htmlFor="claim-appeal-reason" className={LABEL}>Explain the contested decision and new evidence (at least 40 characters)</label>
                            <textarea id="claim-appeal-reason" className={TEXTAREA} minLength={40} maxLength={3000} value={m.appealReason} onChange={event => m.setAppealReason(event.target.value)} />
                          </div>
                          <button type="button" className={ACTION_PRIMARY} disabled={m.busy || m.appealReason.trim().length < 40} onClick={m.appeal}>Submit appeal for review</button>
                        </Panel>
                      )}
                    </StageGroup>
                  )}

                  {/* ── Stage 2: dealer application ── */}
                  {approved && (
                    <StageGroup index="Stage 02" title="Dealer application" note="Your approved business claim allows a private prefilled workbook. Research values are candidates needing your confirmation, not independently verified legal facts.">
                      <Panel id={CLAIM_SECTION_IDS.application} icon={FileSpreadsheet} title="Prefilled Excel and application"
                        lead="Complete the missing legal, branch, service and buyer-policy fields, then upload the workbook — or use a CSV or manual entry below.">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="min-w-0 rounded-card bg-carup-bg-surface p-4">
                            <p className="text-sm font-semibold">1 · Download</p>
                            <p className="mt-1 text-[13px] leading-5 text-carup-text-2">Your private copy, prefilled with research candidates.</p>
                            <button type="button" className={cn(ACTION_SECONDARY, 'mt-3 w-full')} disabled={m.busy} onClick={m.downloadPrefilled}>
                              <Download className="h-4 w-4" aria-hidden="true" />Download my prefilled Excel workbook
                            </button>
                          </div>
                          <div className="min-w-0 rounded-card bg-carup-bg-surface p-4">
                            <label htmlFor="claim-workbook-file" className="text-sm font-semibold">2 · Completed .xlsx workbook</label>
                            <input id="claim-workbook-file" type="file" className={cn(FILE_FIELD, 'mt-2')} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                              onChange={event => { m.setWorkbookFile(event.target.files?.[0] || null); m.setFileProblem(null) }} />
                            <button type="button" className={cn(ACTION_PRIMARY, 'mt-3 w-full')} disabled={m.busy || !m.workbookFile} onClick={m.uploadWorkbook}>
                              <Upload className="h-4 w-4" aria-hidden="true" />Upload completed workbook and populate application
                            </button>
                          </div>
                        </div>
                        {m.fileProblem?.scope === 'workbook' && <Notice tone="danger" role="alert" testId="dealer-workbook-refusal">{m.fileProblem.text}</Notice>}

                        <Disclosure title="Import an existing CSV with confirmed field mapping" summary="One section at a time; you confirm every column." open={csvShown} onToggle={setCsvOpen}>
                          <p className="text-sm leading-6 text-carup-text-2">
                            Import one business or child-record section at a time. CarUp suggests
                            recognized column mappings but never guesses legal identity, tenant
                            permissions, approvals, or verification. Unmapped columns must be
                            deliberately ignored or assigned by you.
                          </p>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="min-w-0">
                              <label htmlFor="claim-csv-target" className={LABEL}>Destination application section</label>
                              <select id="claim-csv-target" className={FIELD} value={m.csvTab}
                                onChange={event => { m.setCsvTab(event.target.value); m.setCsvPreview(null); m.setCsvAcknowledged(false) }}>
                                {CSV_TABS.map(tab => <option key={tab} value={tab}>{tab.replaceAll('_', ' ')}</option>)}
                              </select>
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="claim-csv-file" className={LABEL}>Existing UTF-8 CSV file (2MB max)</label>
                              <input id="claim-csv-file" type="file" className={FILE_FIELD} accept=".csv,text/csv"
                                onChange={event => { m.setCsvFile(event.target.files?.[0] || null); m.setCsvPreview(null); m.setCsvAcknowledged(false) }} />
                            </div>
                          </div>
                          <button type="button" className={ACTION_SECONDARY} disabled={m.busy || !m.csvFile} onClick={m.previewLegacyCsv}>Preview CSV mappings without saving</button>
                          {m.fileProblem?.scope === 'csv' && <Notice tone="danger" role="alert" testId="dealer-csv-refusal">{m.fileProblem.text}</Notice>}
                          {m.csvPreview && (
                            <div className="space-y-3 rounded-card bg-carup-bg-surface p-4">
                              <p className="text-sm font-semibold">{m.csvPreview.input_rows} candidate record(s) · {m.csvPreview.input_headers.length} source column(s)</p>
                              <p className="break-all text-xs text-carup-text-2">Source SHA-256: {m.csvPreview.csv_sha256}. A changed file must be previewed again. No automatic mapping is approved.</p>
                              {m.csvPreview.conflicts.length > 0 && <Notice tone="warning" role="alert">Mapping conflicts: {m.csvPreview.conflicts.join('; ')}</Notice>}
                              {m.csvPreview.input_headers.map((header, index) => (
                                <div key={header}>
                                  <label className={LABEL} htmlFor={'csv-map-' + index}>CSV column: {header}</label>
                                  <select id={'csv-map-' + index} className={FIELD} value={m.csvMapping[header] ?? ''}
                                    onChange={event => { m.setCsvMapping(old => ({ ...old, [header]: event.target.value || null })); m.setCsvAcknowledged(false) }}>
                                    <option value="">Ignore this source column</option>
                                    {m.csvPreview!.allowed_targets.map(field => <option key={field.key} value={field.key}>{field.label} ({field.key})</option>)}
                                  </select>
                                </div>
                              ))}
                              <label className="flex items-start gap-2.5 text-sm leading-6">
                                <input type="checkbox" className={CHECK} checked={m.csvAcknowledged} onChange={event => m.setCsvAcknowledged(event.target.checked)} />
                                <span>I reviewed every source column, confirm the mapping and understand these imported values are unverified candidate declarations requiring independent review.</span>
                              </label>
                              <button type="button" className={ACTION_PRIMARY} disabled={m.busy || !m.csvAcknowledged} onClick={m.importMappedCsv}>
                                Confirm mapped CSV and save the private application draft
                              </button>
                            </div>
                          )}
                        </Disclosure>

                        <Disclosure title="Or enter your application manually" summary="Same versioned field registry and validation as the workbook." open={manualOpen} onToggle={setManualOpen}>
                          <p className="text-[13px] leading-5 text-carup-text-2">
                            This alternative uses the same versioned 12-tab field registry and import validation. Any researched branch/city values not changed here are preserved as unverified candidates, not asserted approvals.
                          </p>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="min-w-0 md:col-span-2">
                              <label htmlFor="manual-legal-name" className={LABEL}>Registered legal company name</label>
                              <input id="manual-legal-name" className={FIELD} required maxLength={180} value={m.manual.legalName}
                                onChange={event => m.manual.setLegalName(event.target.value)}
                                placeholder={latestDraftBusiness?.legal_name || 'Legal name shown on incorporation evidence'} />
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="manual-trading-name" className={LABEL}>Trading name (if different)</label>
                              <input id="manual-trading-name" className={FIELD} maxLength={180} value={m.manual.tradingName} onChange={event => m.manual.setTradingName(event.target.value)} />
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="manual-registration-number" className={LABEL}>
                                Company registration number (leave blank to keep {latestDraftBusiness?.registration_number ? '“' + latestDraftBusiness.registration_number + '”' : 'the saved value'})
                              </label>
                              <input id="manual-registration-number" name="company_registration_number" autoComplete="off" spellCheck={false}
                                data-1p-ignore="true" data-lpignore="true" className={FIELD} maxLength={80} value={m.manual.registrationNumber}
                                onChange={event => m.manual.setRegistrationNumber(event.target.value)} placeholder="As printed on the registration certificate" />
                            </div>
                            <div className="min-w-0 md:col-span-2">
                              <label htmlFor="manual-registration-authority" className={LABEL}>Registration authority (leave blank to keep the saved value)</label>
                              <input id="manual-registration-authority" autoComplete="off" className={FIELD} maxLength={180} value={m.manual.registrationAuthority}
                                onChange={event => m.manual.setRegistrationAuthority(event.target.value)}
                                placeholder={latestDraftBusiness?.registration_authority || 'The registrar that issued the certificate'} />
                              <p className={HINT}>If this location belongs to a company you already operate on CarUp, enter that company’s exact legal name and registration number — CarUp can then attach it to your existing dealership after independent legal review.</p>
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="manual-country" className={LABEL}>Operating country (ISO two-letter code)</label>
                              <input id="manual-country" className={FIELD} maxLength={2} value={m.manual.country} onChange={event => m.manual.setCountry(event.target.value)} />
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="manual-city" className={LABEL}>Correct city (leave blank to preserve researched candidate)</label>
                              <input id="manual-city" className={FIELD} maxLength={180} value={m.manual.city} onChange={event => m.manual.setCity(event.target.value)} />
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="manual-branch" className={LABEL}>Branch name (optional)</label>
                              <input id="manual-branch" className={FIELD} maxLength={180} value={m.manual.branchName} onChange={event => m.manual.setBranchName(event.target.value)} />
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="manual-research-confirm" className={LABEL}>Confirm researched business identity and branch facts</label>
                              <select id="manual-research-confirm" className={FIELD} value={m.manual.researchConfirmation} onChange={event => m.manual.setResearchConfirmation(event.target.value)}>
                                <option value="UNKNOWN">Not yet confirmed</option>
                                <option value="YES">Confirmed as currently correct</option>
                                <option value="CORRECT">I supplied corrections</option>
                              </select>
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="manual-signer" className={LABEL}>Name of proposed authorized company signatory</label>
                              <input id="manual-signer" className={FIELD} maxLength={180} value={m.manual.signer} onChange={event => m.manual.setSigner(event.target.value)} />
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="manual-signer-role" className={LABEL}>Proposed signatory role (independent authority proof is still required)</label>
                              <input id="manual-signer-role" className={FIELD} maxLength={180} value={m.manual.signerRole} onChange={event => m.manual.setSignerRole(event.target.value)} />
                            </div>
                          </div>
                          <label className="flex items-start gap-2.5 text-sm leading-6">
                            <input type="checkbox" className={CHECK} checked={m.manual.privacy} onChange={event => m.manual.setPrivacy(event.target.checked)} />
                            <span>I acknowledge CarUp will handle my private application data for dealership eligibility review. This is not proof that the named signatory has independently verified authority.</span>
                          </label>
                          <button type="button" className={ACTION_SECONDARY} disabled={m.busy || m.manual.legalName.trim().length < 2} onClick={m.saveManual}>Save manual application into CarUp</button>
                        </Disclosure>
                      </Panel>

                      {m.draft && (
                        <Panel id={CLAIM_SECTION_IDS.submit} icon={ShieldCheck} title={`Submit version ${m.draft.submission_version} for preliminary review`}
                          lead="The entire current 12-tab application, corrections, source version and consent fields will be frozen as a private review snapshot. Ensure that researched facts are confirmed, at least one branch is recorded, original company-authority evidence exists, and your signer and privacy acknowledgement are present in the saved workbook.">
                          <label className="flex items-start gap-2.5 text-sm leading-6">
                            <input type="checkbox" className={CHECK} checked={m.submitAcknowledged} onChange={event => m.setSubmitAcknowledged(event.target.checked)} />
                            <span>I declare that I have reviewed the submitted business and branch details and authorize CarUp to send this applicant declaration for independent preliminary review. This does not constitute company ownership verification, regulatory approval or a legal electronic signature.</span>
                          </label>
                          <button type="button" className={ACTION_PRIMARY} disabled={m.busy || !m.submitAcknowledged} onClick={m.submitFrozenApplication}>
                            Submit frozen application for independent review
                          </button>
                        </Panel>
                      )}

                      {m.complianceSubmissions.length > 0 && (
                        <Panel id={CLAIM_SECTION_IDS.history} icon={Clock3} title="Application review history">
                          <ul className="space-y-2">
                            {m.complianceSubmissions.map(item => {
                              const needsWork = item.preliminary_status === 'NEEDS_CORRECTIONS' || item.preliminary_status === 'EVIDENCE_REQUIRED' || Boolean(item.correction_reason)
                              return (
                                <li key={item.submission_id} className="rounded-card bg-carup-bg-surface p-4 text-sm">
                                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                                    Version {item.intake_version}
                                    <StatusChip tone={needsWork ? 'warning' : item.preliminary_status === 'AWAITING_PRELIMINARY_REVIEW' ? 'info' : 'neutral'}>{humanizeStatus(item.preliminary_status)}</StatusChip>
                                  </p>
                                  <p className="mt-1 text-xs text-carup-text-3">Submitted {dealerDateTime(item.submitted_at)}</p>
                                  {item.correction_reason && <p className="mt-2 text-status-warning">Required action: {item.correction_reason}</p>}
                                  <p className="mt-2 text-xs text-carup-text-2">Preliminary review only — legal compliance and dealer operations not approved.</p>
                                </li>
                              )
                            })}
                          </ul>
                        </Panel>
                      )}

                      {m.draft && (
                        <Disclosure
                          title={`Saved application version ${m.draft.submission_version}`}
                          summary={`State: ${humanizeStatus(m.draft.state)} · Saved ${dealerDateTime(m.draft.updated_at)}`}
                          open={draftOpen}
                          onToggle={setDraftOpen}
                        >
                          <DealerDraftReview tabRows={m.draft.content.tab_rows} preview={m.draft.review_preview} />
                        </Disclosure>
                      )}
                    </StageGroup>
                  )}

                  {/* ── Stages 3–4: legal review and activation ── */}
                  {approved && (m.jurisdiction || authority) && (
                    <StageGroup index="Stages 03–04" title="Legal review and activation" note="Claim approval alone never grants stock listing, finance entitlement or a public verified badge. Every operation requires canonical tenant membership and live country-compliance policy.">
                      {m.jurisdiction && (
                        <Panel icon={Landmark} title="Jurisdiction and compliance applicability"
                          lead={<>{humanizeStatus(m.jurisdiction.state)} · {m.jurisdiction.country || 'Country not declared'} · No legal approval or operating rights have been granted.</>}>
                          {m.jurisdiction.policy_status && <StatusChip tone="warning">{humanizeStatus(m.jurisdiction.policy_status)}</StatusChip>}
                          <ul className="grid gap-2 md:grid-cols-2">
                            {m.jurisdiction.requirements.map(item => (
                              <li key={item.requirement_key} className="min-w-0 rounded-card bg-carup-bg-surface p-3 text-sm">
                                <p className="font-semibold">{item.label}</p>
                                <p className="mt-1 text-carup-text-2">{item.reason}</p>
                                <p className="mt-1.5 text-xs text-status-warning">Applicability requires human determination · Evidence not verified</p>
                              </li>
                            ))}
                          </ul>
                          {m.jurisdiction.unresolved?.map(item => <p key={item} className="text-xs text-carup-text-2">{item}</p>)}
                        </Panel>
                      )}
                      {authority && (
                        <Panel id={CLAIM_SECTION_IDS.authority} icon={ShieldCheck} title="Operational dealership authority">
                          <div className="flex flex-wrap gap-2">
                            <StatusChip tone={authority.operational ? 'success' : authority.state === 'NOT_YET_ACTIVATED' || authority.state === 'NOT_AUTHORIZED' ? 'neutral' : 'warning'}>
                              {humanizeStatus(authority.state)}
                            </StatusChip>
                            {authority.public_storefront_approved === false && <StatusChip tone="neutral">Public storefront not approved</StatusChip>}
                            {authority.vehicle_listing_authority_granted === false && <StatusChip tone="neutral">Vehicle listing authority not granted</StatusChip>}
                          </div>
                          {!authority.operational && (authority.blocking_reasons || []).length > 0 && (
                            <div className="space-y-1 rounded-card border-l-4 border-status-warning bg-status-warning-soft p-4 text-sm" data-testid="dealer-authority-status">
                              <p className="font-semibold">Why your dealership cannot operate right now:</p>
                              <ul className="list-disc pl-5">
                                {(authority.blocking_reasons || []).map(reason => <li key={reason}>{m.reasonText[reason] || reason.replaceAll('_', ' ').toLowerCase()}</li>)}
                              </ul>
                              {authority.public_listings_withdrawn === true && <p>Your vehicles are not public while this applies. Nothing is republished automatically.</p>}
                              {authority.public_listings_withdrawal_pending === true && <p>Your remaining public listings are being withdrawn automatically (normally within minutes). Nothing is republished automatically.</p>}
                              {authority.next_step && <p className="font-semibold">Next step: {m.nextStepText[authority.next_step] || authority.next_step}</p>}
                            </div>
                          )}
                          {authority.state === 'ATTACHED_TO_EXISTING_DEALERSHIP' && (
                            <div className="space-y-1 rounded-card border-l-4 border-status-info bg-status-info-soft p-4 text-sm" data-testid="dealer-claim-attached-status">
                              <p className="font-semibold">This branch is part of your existing dealership.</p>
                              <p>An independent reviewer attached this approved claim to your dealership
                                {authority.attach_status && authority.attach_status !== 'ACTIVE' ? ` (attachment ${authority.attach_status.toLowerCase()})` : ''}. Its branches and
                                declarations are managed from your dealer workspace; no separate company account was created.</p>
                              <Link to="/dealer/dashboard" className={TEXT_LINK}>Open my dealer workspace</Link>
                            </div>
                          )}
                          {authority.operational && <Link to="/dealer/dashboard" className={ACTION_PRIMARY}>Open my authorized dealer workspace</Link>}
                        </Panel>
                      )}
                    </StageGroup>
                  )}
                </>
              )}

              {(m.notice || m.error) && (
                <div className="sticky bottom-4 z-20 space-y-2">
                  {m.notice && <Notice tone="info" role="status" className="shadow-sheet">{m.notice}</Notice>}
                  {m.error && <Notice tone="danger" role="alert" className="shadow-sheet">{m.error}</Notice>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
