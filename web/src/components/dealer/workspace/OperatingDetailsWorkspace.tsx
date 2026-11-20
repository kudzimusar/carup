/**
 * RX05-C — Dealer OS · Operating details (unified presentation of /dealers/operating-details).
 *
 * Presentation only: `DealerOperatingDetails` keeps the three reads (declarations, workspace,
 * media), the branch/media/declaration writes, version-conflict protection and the
 * `#dealer-profile-images` focus behaviour (its ref is attached to the media section here).
 *
 * Photos follow three explicit, separate states — never merged, never shortcut:
 *   1. Uploaded privately (scanned, private storage, only this dealership sees it)
 *   2. Awaiting independent review (warning — never green)
 *   3. Approved & public (success — only `APPROVED_PUBLIC_DISPLAY` with `public_display_approved`)
 * Thumbnails use the existing `PrivateMediaThumb` (owner-session blob, revoked on unmount) for the
 * same items the legacy view previews, and are always labelled as the dealership's private copy.
 *
 * Branches shown are the server-verified workspace branches. There is no branch selector that
 * authorizes anything: the optional branch on a facility photo is a write parameter the server checks.
 */
import { useState, type ChangeEvent, type ReactNode, type RefObject } from 'react'
import { Building2, Check, Eye, FileText, ImageIcon, ImagePlus, Lock, MapPin, Plus, ShieldCheck, X } from 'lucide-react'
import PrivateMediaThumb from '@/components/dealer/PrivateMediaThumb'
import { DealerObjectHeader } from './DealerObjectHeader'
import { EmptyState, WorkspaceNotice } from './EmptyState'
import { StatusChip, type StatusTone } from './StatusChip'
import {
  WS_CARD, WS_EYEBROW, WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_SECONDARY, WS_SECTION_TITLE,
} from './workspaceStyles'

export interface OperatingMediaItemView {
  media_id: string
  branch_id: string | null
  media_category: string
  caption: string
  alt_text: string
  review_status: string
  public_display_approved: boolean
}

type SectionConfig = { heading: string; help: string; fields: Array<[string, string]> }
type Area = 'branches' | 'media' | 'policies'

export interface OperatingDetailsWorkspaceProps<S extends string, C extends string> {
  status: 'loading' | 'ready' | 'denied'
  error: string
  notice: string
  busy: boolean
  read: { latest: Partial<Record<S, { version: number }>> } | null
  workspace: { branches: { id: string; name: string; address: string }[]; recorded_tenant_member_count: number } | null
  mediaItems: OperatingMediaItemView[] | null
  sections: Record<S, SectionConfig>
  selected: S
  onSelectSection: (section: S) => void
  draft: Record<string, string>
  setDraftField: (field: string, value: string) => void
  onSave: () => void
  branchName: string
  setBranchName: (value: string) => void
  branchAddress: string
  setBranchAddress: (value: string) => void
  onRecordBranch: () => void
  media: {
    category: C
    setCategory: (value: C) => void
    branchId: string
    setBranchId: (value: string) => void
    caption: string
    setCaption: (value: string) => void
    alt: string
    setAlt: (value: string) => void
    fileLoaded: boolean
    attested: boolean
    setAttested: (value: boolean) => void
    onSelectFile: (event: ChangeEvent<HTMLInputElement>) => void
    onUpload: () => void
  }
  mediaLabels: Record<string, string>
  companyImageCategories: readonly string[]
  rightsAttestation: string
  mediaSectionRef: RefObject<HTMLElement | null>
  privateThumb: { apiBase: string; headers: Record<string, string> }
  onReload: () => void
}

type Stage = 'review' | 'public' | 'other'
function stageOf(item: OperatingMediaItemView): Stage {
  if (item.review_status === 'PENDING_INDEPENDENT_REVIEW') return 'review'
  if (item.review_status === 'APPROVED_PUBLIC_DISPLAY' && item.public_display_approved === true) return 'public'
  return 'other'
}
const OTHER_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  REJECTED: { label: 'Not approved', tone: 'danger' },
  RETRACTED: { label: 'Withdrawn from public display', tone: 'neutral' },
  APPROVED_PUBLIC_DISPLAY: { label: 'Approved · not publicly displayed', tone: 'neutral' },
}

/** The same "current company image" rule the legacy list uses to decide which items get a private thumbnail. */
function hasPrivateThumb(items: OperatingMediaItemView[], item: OperatingMediaItemView) {
  return (item.media_category === 'COMPANY_PROFILE_IMAGE' || item.media_category === 'COMPANY_COVER_IMAGE') &&
    item.media_id === items.find(x => x.media_category === item.media_category &&
      (x.review_status === 'PENDING_INDEPENDENT_REVIEW' || x.review_status === 'APPROVED_PUBLIC_DISPLAY'))?.media_id
}

/** Per-photo progress through the three separate states. */
function MediaProgress({ item }: { item: OperatingMediaItemView }) {
  const stage = stageOf(item)
  const rejected = item.review_status === 'REJECTED'
  const steps: Array<{ label: string; bar: string; text: string }> = [
    { label: 'Uploaded privately', bar: 'bg-carup-text', text: 'text-carup-text-2' },
    {
      label: stage === 'review' ? 'Awaiting review' : rejected ? 'Not approved' : stage === 'public' ? 'Reviewed' : 'Review closed',
      bar: stage === 'review' ? 'bg-status-warning' : rejected ? 'bg-status-danger' : stage === 'public' ? 'bg-carup-text' : 'bg-status-neutral',
      text: stage === 'review' ? 'text-status-warning' : rejected ? 'text-status-danger' : 'text-carup-text-2',
    },
    {
      label: stage === 'public' ? 'Public on profile' : 'Not public',
      bar: stage === 'public' ? 'bg-status-success' : 'bg-carup-line',
      text: stage === 'public' ? 'text-status-success' : 'text-carup-text-3',
    },
  ]
  return (
    <ol className="mt-2 grid grid-cols-3 gap-1.5" aria-label="Photo review progress" data-testid={`dealer-ws-media-progress-${item.media_id}`}>
      {steps.map((s, i) => (
        <li key={i} className="min-w-0">
          <span aria-hidden="true" className={`block h-1 rounded-full ${s.bar}`} />
          <span className={`mt-1 block truncate text-[11px] font-semibold ${s.text}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  )
}

function StageCard({ n, icon, title, body, count, tone }: { n: number; icon: ReactNode; title: string; body: string; count: number; tone: 'neutral' | 'warning' | 'success' }) {
  const ring = tone === 'warning' ? 'border-status-warning' : tone === 'success' ? 'border-status-success' : 'border-carup-line'
  const num = tone === 'warning' ? 'text-status-warning' : tone === 'success' ? 'text-status-success' : 'text-carup-text'
  return (
    <li className={`flex min-w-0 flex-col gap-1 rounded-card border bg-carup-bg-raised p-2.5 sm:flex-row sm:items-start sm:gap-3 sm:p-3 ${ring}`}>
      <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-carup-bg-surface text-carup-text-2 sm:grid" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-col-reverse gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
          <span className="text-xs font-semibold leading-4 text-carup-text sm:text-sm sm:leading-5"><span className="sr-only">Step {n}: </span>{title}</span>
          <span className={`text-lg font-bold tabular-nums leading-6 ${num}`}>{count}</span>
        </span>
        <span className="mt-0.5 hidden text-xs leading-5 text-carup-text-2 sm:block">{body}</span>
      </span>
    </li>
  )
}

export function OperatingDetailsWorkspace<S extends string, C extends string>(props: OperatingDetailsWorkspaceProps<S, C>) {
  const {
    status, error, notice, busy, read, workspace, mediaItems, sections, selected, onSelectSection, draft, setDraftField,
    onSave, branchName, setBranchName, branchAddress, setBranchAddress, onRecordBranch, media, mediaLabels,
    companyImageCategories, rightsAttestation, mediaSectionRef, privateThumb, onReload,
  } = props
  const items = mediaItems ?? []
  const [area, setArea] = useState<Area | null>(null)
  const [uploadOpen, setUploadOpen] = useState(() =>
    typeof window !== 'undefined' && window.location.hash === '#dealer-profile-images')
  const [branchFormOpen, setBranchFormOpen] = useState(false)

  const sectionKeys = Object.keys(sections) as S[]
  const recordedSections = read ? sectionKeys.filter(k => read.latest[k]).length : 0
  const reviewItems = items.filter(i => stageOf(i) === 'review')
  const publicItems = items.filter(i => stageOf(i) === 'public')
  const otherItems = items.filter(i => stageOf(i) === 'other')
  const isCompany = companyImageCategories.includes(media.category)
  const branches = workspace?.branches ?? []

  const feedback = (here: Area | null) => area === here && (notice || error) ? (
    <div className="space-y-2">
      {notice && <WorkspaceNotice testId="dealer-ws-operating-notice">{notice}</WorkspaceNotice>}
      {error && <WorkspaceNotice tone="danger">{error}</WorkspaceNotice>}
    </div>
  ) : null

  function openUpload() {
    setUploadOpen(true)
    window.requestAnimationFrame(() => {
      mediaSectionRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      mediaSectionRef.current?.focus({ preventScroll: true })
    })
  }

  const thumbFor = (item: OperatingMediaItemView) => hasPrivateThumb(items, item)
    ? (
      <span className="relative block shrink-0">
        <PrivateMediaThumb apiBase={privateThumb.apiBase} kind={item.media_category === 'COMPANY_PROFILE_IMAGE' ? 'profile' : 'cover'}
          headers={privateThumb.headers} version={item.media_id} alt={item.alt_text}
          className={`h-16 rounded-control object-cover ${item.media_category === 'COMPANY_COVER_IMAGE' ? 'w-28' : 'w-16'}`} />
        <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <Lock className="h-2.5 w-2.5" aria-hidden="true" /> Private copy
        </span>
      </span>
    )
    : (
      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-control bg-carup-bg-surface text-carup-text-3" aria-hidden="true">
        <ImageIcon className="h-5 w-5" />
      </span>
    )

  const mediaGroup = (title: string, list: OperatingMediaItemView[], testId: string) => list.length === 0 ? null : (
    <div data-testid={testId}>
      <h3 className={`${WS_EYEBROW} mb-2`}>{title} ({list.length})</h3>
      <ul className="space-y-2">
        {list.map(item => {
          const stage = stageOf(item)
          const other = OTHER_LABELS[item.review_status]
          return (
            <li key={item.media_id} data-testid={`dealer-owner-media-item-${item.media_id}`} data-stage={stage}
              className="flex items-start gap-3 rounded-card border border-carup-line bg-carup-bg-raised p-3">
              {thumbFor(item)}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{item.caption}</p>
                  {stage === 'review' && <StatusChip tone="warning" testId={`dealer-ws-media-status-${item.media_id}`}>Awaiting independent review · only you can see it</StatusChip>}
                  {stage === 'public' && <StatusChip tone="success" testId={`dealer-ws-media-status-${item.media_id}`}>Approved for your public profile</StatusChip>}
                  {stage === 'other' && <StatusChip tone={other?.tone ?? 'neutral'} testId={`dealer-ws-media-status-${item.media_id}`}>{other?.label ?? item.review_status}</StatusChip>}
                </div>
                <p className="mt-0.5 text-xs text-carup-text-2 [overflow-wrap:anywhere]">
                  {mediaLabels[item.media_category] || item.media_category.replaceAll('_', ' ')} · Alt: {item.alt_text}
                </p>
                <MediaProgress item={item} />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <div className="space-y-5 text-carup-text" data-testid="dealer-ws-operating" data-presentation="dealer-workspace-operating">
      <DealerObjectHeader
        eyebrow="Dealer OS · Operating details"
        title="Operating details"
        description="Your branches, company images and business policies. Everything you save is private and versioned; nothing reaches buyers without independent review."
        meta={status === 'ready' && workspace ? (
          <>
            <StatusChip testId="dealer-ws-branch-count">{branches.length} {branches.length === 1 ? 'branch' : 'branches'} recorded</StatusChip>
            {reviewItems.length > 0 && <StatusChip tone="warning" testId="dealer-ws-media-pending-count">{reviewItems.length} awaiting review</StatusChip>}
            {publicItems.length > 0 && <StatusChip tone="success">{publicItems.length} approved &amp; public</StatusChip>}
            {read && <StatusChip>{recordedSections} of {sectionKeys.length} policy sections recorded</StatusChip>}
          </>
        ) : undefined}
        actions={status === 'ready' && workspace ? (
          <button type="button" className={WS_PRIMARY} onClick={openUpload} data-testid="dealer-ws-upload-photo">
            <ImagePlus className="h-4 w-4" aria-hidden="true" /> Upload photo
          </button>
        ) : undefined}
      />

      {status === 'loading' && <EmptyState kind="loading" title="Checking your dealership's operating authority…" testId="dealer-ws-operating-loading" />}
      {status === 'denied' && (
        <EmptyState kind="error" title="Operating details are unavailable" onRetry={onReload} testId="dealer-ws-operating-denied">
          No active, independently approved dealership organization and tenant access is available, or it could not be
          confirmed right now. A source listing or approved ownership claim alone is insufficient.
          {error && <span className="mt-1 block text-xs text-carup-text-3">Reason: {error}</span>}
        </EmptyState>
      )}
      {status === 'ready' && feedback(null)}

      {status === 'ready' && workspace && (
        <div className="grid items-start gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="Operating details sections" className="lg:sticky lg:top-24">
            <ul className="grid grid-cols-3 gap-2 lg:flex lg:flex-col lg:gap-1">
              {[
                { href: '#dealer-ws-branches', short: 'Branches', label: 'Branches', meta: String(branches.length) },
                { href: '#dealer-profile-images', short: 'Photos', label: 'Images & photos', meta: reviewItems.length ? `${reviewItems.length} in review` : String(items.length) },
                { href: '#dealer-ws-policies', short: 'Policies', label: 'Business policies', meta: `${recordedSections}/${sectionKeys.length}` },
              ].map(link => (
                <li key={link.href} className="min-w-0">
                  <a href={link.href} className="flex min-h-11 flex-col items-start justify-center gap-0 rounded-control border border-carup-line bg-carup-bg-raised px-3 py-1.5 text-sm font-semibold text-carup-text hover:border-carup-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:border-transparent lg:bg-transparent lg:py-0 lg:hover:bg-carup-bg-surface">
                    <span className="truncate lg:hidden">{link.short}</span>
                    <span className="hidden lg:inline">{link.label}</span>
                    <span className="text-xs font-medium text-carup-text-3">{link.meta}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-6">
            {/* ── Branches ─────────────────────────────────────────────── */}
            <section id="dealer-ws-branches" aria-labelledby="dealer-ws-branches-title" className={`${WS_CARD} scroll-mt-24 p-4 sm:p-5`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="dealer-ws-branches-title" className={`flex items-center gap-2 ${WS_SECTION_TITLE}`}>
                    <Building2 className="h-4 w-4 text-carup-text-3" aria-hidden="true" /> Branches
                  </h2>
                  <p className={WS_HINT}>Recorded on your dealer profile. A private branch is not public-site or GPS certification.</p>
                </div>
                {branches.length > 0 && (
                  <button type="button" className={WS_SECONDARY} aria-expanded={branchFormOpen} aria-controls="dealer-ws-branch-form"
                    onClick={() => setBranchFormOpen(o => !o)}>
                    {branchFormOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    {branchFormOpen ? 'Close' : 'Add branch'}
                  </button>
                )}
              </div>
              {branches.length === 0 ? (
                <div className="mt-3"><EmptyState compact title="No branches recorded yet">Add your first branch below. It stays private until a reviewer approves your public site.</EmptyState></div>
              ) : (
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {branches.map(b => (
                    <li key={b.id} className="flex items-start gap-3 rounded-card border border-carup-line p-3" data-testid={`dealer-ws-branch-${b.id}`}>
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{b.name}</h3>
                        <p className="mt-0.5 text-sm text-carup-text-2 [overflow-wrap:anywhere]">{b.address}</p>
                        <p className="mt-2"><StatusChip>Private · not public-approved</StatusChip></p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {(branchFormOpen || branches.length === 0) && (
                <form id="dealer-ws-branch-form" className="mt-4 grid gap-3 border-t border-carup-line pt-4 sm:grid-cols-2"
                  onSubmit={e => { e.preventDefault(); setArea('branches'); onRecordBranch() }}>
                  <div>
                    <label htmlFor="operating-branch-name" className={WS_LABEL}>Branch name</label>
                    <input id="operating-branch-name" maxLength={180} className={WS_FIELD} value={branchName}
                      onChange={e => setBranchName(e.target.value)} placeholder="Registered or trading branch name" />
                  </div>
                  <div>
                    <label htmlFor="operating-branch-address" className={WS_LABEL}>Physical site address</label>
                    <input id="operating-branch-address" maxLength={400} className={WS_FIELD} value={branchAddress}
                      onChange={e => setBranchAddress(e.target.value)} placeholder="Actual operating branch location" />
                  </div>
                  <div className="sm:col-span-2">
                    <button type="submit" className={WS_PRIMARY} disabled={busy || branchName.trim().length < 2 || branchAddress.trim().length < 3}>
                      Save branch (private)
                    </button>
                  </div>
                </form>
              )}
              <p className="mt-4 text-xs leading-5 text-carup-text-3">
                Recorded tenant memberships: {workspace.recorded_tenant_member_count}. Staff headcount, individual licence
                validity and sales revenue are not inferred.
              </p>
              {feedback('branches') && <div className="mt-3">{feedback('branches')}</div>}
            </section>

            {/* ── Company images & facility photos ─────────────────────── */}
            <section
              id="dealer-profile-images"
              ref={mediaSectionRef}
              tabIndex={-1}
              data-testid="dealer-owner-media-section"
              aria-labelledby="dealer-ws-media-title"
              className={`${WS_CARD} scroll-mt-24 p-4 outline-none focus-visible:ring-2 focus-visible:ring-carup-focus sm:p-5`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="dealer-ws-media-title" className={`flex items-center gap-2 ${WS_SECTION_TITLE}`}>
                    <ImageIcon className="h-4 w-4 text-carup-text-3" aria-hidden="true" /> Company images &amp; facility photos
                  </h2>
                  <p className={`${WS_HINT} max-w-2xl`}>
                    Dealer-owned photographs only — no OEM or third-party logos. Every photo needs alt text and an
                    independent reviewer's approval before it can appear on your public profile. Photos are never legal evidence.
                  </p>
                </div>
                <button type="button" className={WS_SECONDARY} aria-expanded={uploadOpen} aria-controls="dealer-ws-upload-form"
                  onClick={() => setUploadOpen(o => !o)} data-testid="dealer-ws-upload-toggle">
                  {uploadOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                  {uploadOpen ? 'Close upload' : 'Upload a photo'}
                </button>
              </div>

              <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="How a photo becomes public" data-testid="dealer-ws-media-stages">
                <StageCard n={1} icon={<Lock className="h-4 w-4" />} title="Uploaded privately" count={items.length} tone="neutral"
                  body="Virus-scanned into private storage. Only your dealership can see it." />
                <StageCard n={2} icon={<Eye className="h-4 w-4" />} title="Awaiting independent review" count={reviewItems.length} tone={reviewItems.length ? 'warning' : 'neutral'}
                  body="A CarUp reviewer checks rights, logos and alt text. Not public yet." />
                <StageCard n={3} icon={<ShieldCheck className="h-4 w-4" />} title="Approved & public" count={publicItems.length} tone={publicItems.length ? 'success' : 'neutral'}
                  body="Only after approval does the photo appear on your public profile." />
              </ol>
              <p className="mt-2 text-xs leading-5 text-carup-text-2 sm:hidden">
                Three separate states: private upload → independent review → public. Only approved photos reach buyers.
              </p>

              {uploadOpen && (
                <form id="dealer-ws-upload-form" className="mt-4 space-y-4 rounded-card border border-carup-line-strong bg-carup-bg p-4"
                  onSubmit={e => { e.preventDefault(); setArea('media'); media.onUpload() }} data-testid="dealer-ws-upload-form">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="dealer-media-category" className={WS_LABEL}>Photo type</label>
                      <select id="dealer-media-category" className={WS_FIELD} value={media.category}
                        onChange={e => media.setCategory(e.target.value as C)}>
                        <optgroup label="Company profile">
                          <option value="COMPANY_PROFILE_IMAGE">Company profile image (square)</option>
                          <option value="COMPANY_COVER_IMAGE">Cover image (wide banner)</option>
                        </optgroup>
                        <optgroup label="Facility photos">
                          <option value="SHOWROOM_EXTERIOR">Showroom exterior</option>
                          <option value="SHOWROOM_INTERIOR">Showroom interior</option>
                          <option value="BRANCH_FACILITY">Branch facility</option>
                          <option value="SERVICE_BAY">Service bay / workshop</option>
                        </optgroup>
                      </select>
                      {isCompany && (
                        <p className={WS_HINT} data-testid="dealer-company-image-help">
                          {media.category === 'COMPANY_PROFILE_IMAGE'
                            ? 'Shown as the round/square picture beside your name. Use your own photo of the business — not a manufacturer or franchise logo.'
                            : 'Shown across the top of your public profile and cropped to fit phones. Choose a wide, landscape photo you own.'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="dealer-media-branch" className={WS_LABEL}>Associated branch (optional)</label>
                      <select id="dealer-media-branch" className={WS_FIELD} disabled={isCompany}
                        value={isCompany ? '' : media.branchId} onChange={e => media.setBranchId(e.target.value)}>
                        <option value="">General dealership facility</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="dealer-media-caption" className={WS_LABEL}>Public caption (5–240 characters)</label>
                      <input id="dealer-media-caption" maxLength={240} className={WS_FIELD} value={media.caption}
                        onChange={e => media.setCaption(e.target.value)} placeholder="e.g. Main Harare showroom forecourt and customer reception" />
                    </div>
                    <div>
                      <label htmlFor="dealer-media-alt" className={WS_LABEL}>Accessible image alt text (5–240 characters, required)</label>
                      <input id="dealer-media-alt" maxLength={240} className={WS_FIELD} value={media.alt}
                        onChange={e => media.setAlt(e.target.value)} placeholder="Describe the scene clearly for screen-reader users" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="dealer-media-file" className={WS_LABEL}>Photograph file (PNG or JPEG)</label>
                    <input id="dealer-media-file" type="file" accept="image/png,image/jpeg" data-file-loaded={media.fileLoaded}
                      onChange={media.onSelectFile}
                      className="block w-full text-sm text-carup-text-2 file:mr-3 file:min-h-11 file:rounded-control file:border file:border-carup-line-strong file:bg-carup-bg-raised file:px-4 file:text-sm file:font-semibold file:text-carup-text hover:file:bg-carup-bg-surface" />
                    <p className={WS_HINT} data-testid="dealer-ws-upload-file-state">
                      {media.fileLoaded
                        ? 'File ready on this device. Uploading sends it to private storage for independent review — it is not public.'
                        : 'No file chosen yet.'}
                    </p>
                  </div>
                  <label htmlFor="dealer-media-rights-attestation" className="flex items-start gap-3 text-sm leading-6 text-carup-text">
                    <input id="dealer-media-rights-attestation" type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-carup-action"
                      checked={media.attested} onChange={e => media.setAttested(e.target.checked)} />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      I attest that this photograph is owned by our dealership and contains no OEM or third-party brand logo
                      rights claim ({rightsAttestation}).
                    </span>
                  </label>
                  <button type="submit" className={WS_PRIMARY} data-testid="dealer-media-upload-button"
                    disabled={busy || !media.fileLoaded || !media.attested || media.caption.trim().length < 5 || media.alt.trim().length < 5}>
                    {isCompany
                      ? `Upload ${(mediaLabels[media.category] || '').toLowerCase()} for independent review`
                      : 'Upload dealership facility photo for independent review'}
                  </button>
                </form>
              )}

              {feedback('media') && <div className="mt-3">{feedback('media')}</div>}

              <div className="mt-5 space-y-5">
                {mediaItems === null ? (
                  <EmptyState kind="error" compact title="Your photos could not be loaded" onRetry={onReload} testId="dealer-ws-media-error">
                    The media read failed. This is not proof that you have no photos or that any are public.
                  </EmptyState>
                ) : items.length === 0 ? (
                  <EmptyState compact title="No photos uploaded yet" testId="dealer-ws-media-empty">
                    Start with a square company profile image and a wide cover image. Each stays private until an
                    independent reviewer approves it.
                  </EmptyState>
                ) : (
                  <>
                    {mediaGroup('Awaiting independent review', reviewItems, 'dealer-ws-media-group-review')}
                    {mediaGroup('Approved for your public profile', publicItems, 'dealer-ws-media-group-public')}
                    {mediaGroup('Not approved or withdrawn', otherItems, 'dealer-ws-media-group-other')}
                  </>
                )}
              </div>
            </section>

            {/* ── Business policies (versioned declarations) ───────────── */}
            {read && (
              <section id="dealer-ws-policies" aria-labelledby="dealer-ws-policies-title" className={`${WS_CARD} scroll-mt-24 p-4 sm:p-5`}>
                <h2 id="dealer-ws-policies-title" className={`flex items-center gap-2 ${WS_SECTION_TITLE}`}>
                  <FileText className="h-4 w-4 text-carup-text-3" aria-hidden="true" /> Business policies
                </h2>
                <p className={WS_HINT}>Private, versioned operator statements. Saving one never verifies or publishes it.</p>
                <nav aria-label="Dealer operating sections" className="mt-4">
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {sectionKeys.map(key => {
                      const active = key === selected
                      const version = read.latest[key]?.version
                      return (
                        <li key={key} className="min-w-0">
                          <button type="button" aria-pressed={active} onClick={() => onSelectSection(key)}
                            data-testid={`dealer-ws-policy-${key}`}
                            className={`flex h-full min-h-14 w-full flex-col items-start justify-center rounded-control border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
                              active ? 'border-carup-action bg-carup-action-soft' : 'border-carup-line bg-carup-bg-raised hover:border-carup-line-strong'
                            }`}>
                            <span className="font-semibold leading-5 text-carup-text">{sections[key].heading}</span>
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-carup-text-2">
                              {version ? <><Check className="h-3 w-3" aria-hidden="true" /> Version {version}</> : 'Not recorded'}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </nav>
                <form className="mt-5 space-y-4 border-t border-carup-line pt-5" onSubmit={e => { e.preventDefault(); setArea('policies'); onSave() }}
                  data-testid="dealer-ws-policy-editor">
                  <header>
                    <h3 className="text-lg font-bold tracking-[-0.01em] text-carup-text">{sections[selected].heading}</h3>
                    <p className="mt-1 text-sm leading-6 text-carup-text-2">{sections[selected].help}</p>
                    <p className="mt-1 text-xs text-carup-text-3">
                      Current recorded version: {read.latest[selected]?.version || 0}. Saved material stays private, unverified and unpublished.
                    </p>
                  </header>
                  {sections[selected].fields.map(([field, label]) => (
                    <div key={field}>
                      <label htmlFor={'dealer-' + field} className={WS_LABEL}>{label}</label>
                      <textarea id={'dealer-' + field} maxLength={750} rows={3} value={draft[field] || ''}
                        onChange={e => setDraftField(field, e.target.value)}
                        className={`${WS_FIELD} min-h-20 leading-6`}
                        placeholder="Enter an accurate declaration, or leave blank if not applicable." />
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" className={WS_PRIMARY} disabled={busy || !Object.values(draft).some(v => v.trim())}>
                      Save this section to CarUp
                    </button>
                    <p className="text-xs text-carup-text-3">Version conflict protection · No unverified public claims</p>
                  </div>
                </form>
                {feedback('policies') && <div className="mt-3">{feedback('policies')}</div>}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
