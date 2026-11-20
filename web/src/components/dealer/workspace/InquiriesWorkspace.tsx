/**
 * RX05-C — Dealer OS · Enquiries (unified presentation of /dealers/inquiries).
 *
 * Presentation only: `DealerTenantInquiries` keeps the scoped read, the follow-up PATCH and its
 * receipt verification. This view adds list → detail navigation (a list on phones that opens a
 * detail screen; master/detail side by side from `lg`).
 *
 * The next action for an enquiry is derived ONLY from recorded fields:
 *   - contact withheld (`customer_contact_available === false`) → wait for Marketplace clearance;
 *   - `allowed_followup_status` 'contacted' / 'qualified' → the one follow-up the server allows;
 *   - otherwise → no further dealer step exists in CarUp for this status.
 * Recording a follow-up is the dealer's own report; it never sends a message or records a sale,
 * so follow-up statuses are never shown as green.
 */
import { useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Mail, MessageSquareText, Phone, RotateCw, Search, ShieldAlert } from 'lucide-react'
import { dealerDateTime } from '@/lib/dealerDates'
import { DealerObjectHeader } from './DealerObjectHeader'
import { EmptyState, WorkspaceNotice } from './EmptyState'
import { StatusChip, type StatusTone } from './StatusChip'
import { toneFor } from './statusTone'
import { humanizeCode, revealOnPhone } from './format'
import {
  WS_CARD, WS_DD, WS_DT, WS_EYEBROW, WS_FIELD, WS_PRIMARY, WS_ROW, WS_SECONDARY, WS_SECTION_TITLE, WS_TEXT_ACTION,
} from './workspaceStyles'

export interface InquiryView {
  inquiry_id: string
  vin: string | null
  inquiry_type: string | null
  status: string
  source_channel: string | null
  created_at: string
  customer_contact_available: boolean
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  message: string | null
  allowed_followup_status: 'contacted' | 'qualified' | null
}

export interface InquiriesWorkspaceProps<T extends InquiryView = InquiryView> {
  status: 'loading' | 'ready' | 'unavailable'
  inbox: { entries: T[]; returned_visible_count: number } | null
  filtered: T[]
  search: string
  onSearch: (value: string) => void
  updatingId: string | null
  actionNotice: string
  actionError: string
  onRefresh: () => void
  onFollowup: (item: T) => void
}

/** 'new' needs the dealer; dealer-reported statuses are self-reported, so they stay neutral. */
const STATUS_TONES: Record<string, StatusTone> = { new: 'info', contacted: 'neutral', qualified: 'neutral' }

const followupLabel = (status: 'contacted' | 'qualified') =>
  status === 'contacted' ? 'Record dealer-reported contact' : 'Record dealer-reported qualified enquiry'

function nextActionOf(item: InquiryView): { key: string; title: string; body: string; short: string } {
  if (!item.customer_contact_available) {
    return {
      key: 'withheld', short: 'Awaiting Marketplace clearance',
      title: 'Wait for Marketplace clearance',
      body: 'Contact withheld pending risk and eligibility confirmation. There is nothing to do here until CarUp clears this enquiry.',
    }
  }
  if (item.allowed_followup_status === 'contacted') {
    return {
      key: 'contact', short: 'Next: contact the buyer',
      title: 'Contact the buyer',
      body: 'Reach the buyer with the details below, then record that you made contact.',
    }
  }
  if (item.allowed_followup_status === 'qualified') {
    return {
      key: 'qualify', short: 'Next: record if qualified',
      title: 'Record whether the enquiry is qualified',
      body: 'If your conversation showed genuine buying interest, record it as a qualified enquiry.',
    }
  }
  return {
    key: 'none', short: 'No further step in CarUp',
    title: 'No further step in CarUp',
    body: `This enquiry is recorded as "${humanizeCode(item.status)}". CarUp has no further dealer follow-up step for this status.`,
  }
}

const typeLabel = (item: InquiryView) => humanizeCode(item.inquiry_type, 'Marketplace enquiry')

export function InquiriesWorkspace<T extends InquiryView>(props: InquiriesWorkspaceProps<T>) {
  const { status, inbox, filtered, search, onSearch, updatingId, actionNotice, actionError, onRefresh, onFollowup } = props
  const [selectedId, setSelectedId] = useState('')
  const [phoneDetail, setPhoneDetail] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const selected = filtered.find(i => i.inquiry_id === selectedId) ?? filtered[0] ?? null
  const showDetailOnPhone = phoneDetail && selected !== null

  function open(id: string) {
    setSelectedId(id)
    setPhoneDetail(true)
    window.requestAnimationFrame(() => revealOnPhone(headingRef.current))
  }

  return (
    <div className="space-y-5 text-carup-text" data-testid="dealer-ws-inquiries" data-presentation="dealer-workspace-inquiries">
      <DealerObjectHeader
        eyebrow="Dealer OS · Enquiries"
        title="Buyer enquiries"
        description="Real enquiries buyers sent your dealership through the CarUp Marketplace. Recording a follow-up here never sends a message or records a sale."
        meta={status === 'ready' && inbox ? (
          <>
            <StatusChip testId="dealer-ws-inquiry-count">{inbox.returned_visible_count} in this read</StatusChip>
            <span className="text-xs text-carup-text-3">First 100 records examined · no full-history count</span>
          </>
        ) : undefined}
      />

      {actionNotice && <WorkspaceNotice testId="dealer-ws-inquiry-notice">{actionNotice}</WorkspaceNotice>}
      {actionError && <WorkspaceNotice tone="danger">{actionError}</WorkspaceNotice>}

      {status === 'loading' && <EmptyState kind="loading" title="Loading your Marketplace enquiries…" testId="dealer-ws-inquiries-loading" />}
      {status === 'unavailable' && (
        <EmptyState kind="error" title="Enquiries could not be loaded" onRetry={onRefresh} testId="dealer-ws-inquiries-error">
          Canonical tenant enquiry access is unavailable. This is not proof that your dealership has no customers or enquiries.
        </EmptyState>
      )}

      {status === 'ready' && inbox && (inbox.entries.length === 0 ? (
        <EmptyState
          title="No enquiries yet"
          testId="dealer-ws-inquiries-empty"
          action={<>
            <button type="button" className={WS_SECONDARY} onClick={onRefresh}>
              <RotateCw className="h-4 w-4" aria-hidden="true" /> Refresh enquiries
            </button>
            <Link to="/dealers/stock" className={WS_SECONDARY}>Go to inventory</Link>
          </>}
        >
          An enquiry appears here when a buyer contacts your dealership through the CarUp Marketplace, usually about
          one of your public vehicles. Enquiries held for risk review stay with Marketplace moderation until cleared.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <section
            aria-labelledby="dealer-ws-inquiry-list-title"
            className={`${WS_CARD} overflow-hidden ${showDetailOnPhone ? 'hidden lg:block' : ''}`}
            data-testid="dealer-ws-inquiry-list"
          >
            <div className="border-b border-carup-line p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 id="dealer-ws-inquiry-list-title" className={WS_SECTION_TITLE}>Inbox</h2>
                <span className="flex items-center gap-1">
                  <span className="text-xs text-carup-text-3">{filtered.length} of {inbox.entries.length} shown</span>
                  <button type="button" onClick={onRefresh} aria-label="Refresh enquiries" title="Refresh enquiries"
                    data-testid="dealer-ws-inquiries-refresh"
                    className="grid h-11 w-11 place-items-center rounded-control text-carup-text-2 hover:bg-carup-bg-surface hover:text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              </div>
              <label htmlFor="dealer-inquiry-filter" className="sr-only">Filter loaded enquiries</label>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-carup-text-3" aria-hidden="true" />
                <input id="dealer-inquiry-filter" type="search" value={search} onChange={e => onSearch(e.target.value)}
                  className={`${WS_FIELD} pl-9`} placeholder="Search VIN, type, status or buyer" />
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-4">
                <EmptyState compact title="No enquiry on this page matches your filter">
                  Risk-held enquiries remain subject to Marketplace moderation.{' '}
                  <button type="button" className={WS_TEXT_ACTION} onClick={() => onSearch('')}>Clear filter</button>
                </EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-carup-line">
                {filtered.map(item => {
                  const active = selected?.inquiry_id === item.inquiry_id
                  const next = nextActionOf(item)
                  return (
                    <li key={item.inquiry_id}>
                      <button
                        type="button"
                        onClick={() => open(item.inquiry_id)}
                        aria-current={active ? 'true' : undefined}
                        data-testid={`dealer-ws-inquiry-row-${item.inquiry_id}`}
                        className={`${WS_ROW} relative px-4 py-3 ${active ? 'lg:bg-carup-bg-surface' : ''}`}
                      >
                        {active && <span aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-[3px] bg-carup-action lg:block" />}
                        <span className="flex items-start gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="min-w-0 truncate text-sm font-semibold text-carup-text">
                                {item.customer_contact_available && item.contact_name ? item.contact_name : typeLabel(item)}
                              </span>
                              <span className="shrink-0 text-xs text-carup-text-3">{dealerDateTime(item.created_at)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-carup-text-2">
                              {typeLabel(item)}{item.vin ? <> · <span className="font-mono">{item.vin}</span></> : null}
                            </span>
                            <span className="mt-2 flex flex-wrap items-center gap-1.5">
                              <StatusChip tone={toneFor(item.status, STATUS_TONES)}>{humanizeCode(item.status)}</StatusChip>
                              <span className={`text-xs font-semibold ${next.key === 'withheld' ? 'text-status-warning' : next.key === 'none' ? 'text-carup-text-3' : 'text-carup-action'}`}>
                                {next.short}
                              </span>
                            </span>
                          </span>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-carup-text-3 lg:hidden" aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {selected && (
            <InquiryDetail
              key={selected.inquiry_id}
              item={selected}
              className={showDetailOnPhone ? '' : 'hidden lg:block'}
              headingRef={headingRef}
              onBack={() => setPhoneDetail(false)}
              updatingId={updatingId}
              onFollowup={onFollowup}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function InquiryDetail<T extends InquiryView>({ item, className, headingRef, onBack, updatingId, onFollowup }: {
  item: T
  className: string
  headingRef: RefObject<HTMLHeadingElement | null>
  onBack: () => void
  updatingId: string | null
  onFollowup: (item: T) => void
}) {
  const next = nextActionOf(item)
  return (
    <article aria-labelledby="dealer-ws-inquiry-title" data-testid={`dealer-ws-inquiry-${item.inquiry_id}`} className={`${WS_CARD} min-w-0 ${className}`}>
      <div className="border-b border-carup-line p-4 sm:p-5">
        <button type="button" onClick={onBack} className={`${WS_TEXT_ACTION} -ml-1 mb-1 lg:hidden`}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> All enquiries
        </button>
        <p className={WS_EYEBROW}>Enquiry</p>
        <h2 id="dealer-ws-inquiry-title" ref={headingRef} tabIndex={-1} className="mt-1 scroll-mt-36 text-xl font-bold tracking-[-0.02em] text-carup-text outline-none sm:text-2xl">
          {typeLabel(item)}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusChip tone={toneFor(item.status, STATUS_TONES)} testId="dealer-ws-inquiry-status">{humanizeCode(item.status)}</StatusChip>
          <span className="text-xs text-carup-text-2">{dealerDateTime(item.created_at)} · {item.source_channel || 'Source not recorded'}</span>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div data-testid={`dealer-ws-inquiry-next-${next.key}`} className="rounded-card border border-carup-line-strong bg-carup-bg p-4">
          <p className={WS_EYEBROW}>Next action</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-carup-text">
            {next.key === 'withheld' && <ShieldAlert className="h-4 w-4 text-status-warning" aria-hidden="true" />}
            {next.title}
          </p>
          <p className="mt-1 text-sm leading-6 text-carup-text-2">{next.body}</p>
          {item.allowed_followup_status && (
            <button
              type="button"
              className={`${WS_PRIMARY} mt-3`}
              disabled={Boolean(updatingId)}
              onClick={() => onFollowup(item)}
            >
              {updatingId === item.inquiry_id ? 'Saving...' : followupLabel(item.allowed_followup_status)}
            </button>
          )}
        </div>

        {item.customer_contact_available ? (
          <section aria-labelledby="dealer-ws-inquiry-buyer-title">
            <h3 id="dealer-ws-inquiry-buyer-title" className={WS_SECTION_TITLE}>Buyer</h3>
            <dl className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-10">
              <div><dt className={WS_DT}>Name</dt><dd className={WS_DD}>{item.contact_name || 'Not provided'}</dd></div>
              <div>
                <dt className={WS_DT}>Email</dt>
                <dd className={WS_DD}>
                  {item.contact_email
                    ? <a href={`mailto:${item.contact_email}`} className="inline-flex min-h-11 items-center gap-1.5 text-carup-action underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus sm:min-h-0"><Mail className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="[overflow-wrap:anywhere]">{item.contact_email}</span></a>
                    : 'Not provided'}
                </dd>
              </div>
              <div>
                <dt className={WS_DT}>Telephone</dt>
                <dd className={WS_DD}>
                  {item.contact_phone
                    ? <a href={`tel:${item.contact_phone.replace(/\s+/g, '')}`} className="inline-flex min-h-11 items-center gap-1.5 text-carup-action underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus sm:min-h-0"><Phone className="h-4 w-4 shrink-0" aria-hidden="true" />{item.contact_phone}</a>
                    : 'Not provided'}
                </dd>
              </div>
            </dl>
            {item.message && (
              <figure className="mt-4 rounded-card bg-carup-bg-surface p-4">
                <figcaption className={`flex items-center gap-1.5 ${WS_EYEBROW}`}>
                  <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" /> Message
                </figcaption>
                <blockquote className="mt-2 whitespace-pre-wrap text-sm leading-6 text-carup-text [overflow-wrap:anywhere]">{item.message}</blockquote>
              </figure>
            )}
          </section>
        ) : (
          <WorkspaceNotice tone="warning">Contact withheld pending risk and eligibility confirmation.</WorkspaceNotice>
        )}

        <section aria-labelledby="dealer-ws-inquiry-vehicle-title" className="border-t border-carup-line pt-4">
          <h3 id="dealer-ws-inquiry-vehicle-title" className={WS_SECTION_TITLE}>Vehicle</h3>
          {item.vin
            ? <p className="mt-1 text-sm text-carup-text-2">Referenced vehicle VIN: <span className="font-mono text-carup-text [overflow-wrap:anywhere]">{item.vin}</span></p>
            : <p className="mt-1 text-sm text-carup-text-2">No vehicle is referenced on this enquiry.</p>}
        </section>

        <p className="border-t border-carup-line pt-4 text-xs leading-5 text-carup-text-3">
          A follow-up records a seller-reported, risk-cleared step on the Marketplace enquiry only. It does not send a
          message, prove buyer contact, assign a moderator, verify a transaction, close a sale or authorize payment.
        </p>
      </div>
    </article>
  )
}
