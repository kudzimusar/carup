/**
 * RX05-A — the unified (showroom) presentation of /dealers/:seedId/correction. A focused, calm form;
 * the page container keeps the state, validation and the single POST. A request never changes a
 * public record by itself, and the view never says it did.
 */
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACTION_PRIMARY, CARD, EYEBROW, FIELD, HINT, LABEL, Notice, TEXTAREA, TEXT_LINK } from './ShowroomPrimitives'

export type CorrectionRequestType = 'CORRECTION' | 'REMOVAL' | 'BUSINESS_CLOSED' | 'IDENTITY_DISPUTE'

export interface DealerCorrectionShowroomProps {
  reference: string
  validId: boolean
  requestType: CorrectionRequestType
  onRequestType: (value: CorrectionRequestType) => void
  summary: string
  onSummary: (value: string) => void
  contactEmail: string
  onContactEmail: (value: string) => void
  phase: 'draft' | 'sending' | 'submitted'
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

const WHAT_HAPPENS: Array<[string, string]> = [
  ['A private review', 'Your request goes to CarUp reviewers only. It is never published.'],
  ['Independent assessment', 'A reviewer checks the information. A request alone does not prove business ownership.'],
  ['Only then, any change', 'Inaccurate information can be suppressed after review. Nothing changes automatically.'],
]

export function DealerCorrectionShowroom(props: DealerCorrectionShowroomProps) {
  const { reference, validId, phase } = props
  const profileHref = `/dealers/${reference.toLowerCase()}`
  return (
    <main className="min-h-screen bg-carup-bg text-carup-text" data-testid="dealer-correction-showroom" data-presentation="showroom">
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <nav aria-label="Breadcrumb" className="text-sm">
          <ol className="flex flex-wrap items-center gap-1.5 text-carup-text-2">
            <li>
              <Link to="/dealers" className="inline-flex min-h-11 items-center gap-1.5 rounded-control font-semibold text-carup-text hover:text-carup-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to dealership directory
              </Link>
            </li>
            {validId && (
              <>
                <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                <li><Link to={profileHref} className={cn(TEXT_LINK, 'inline-flex min-h-11 items-center')}>{reference}</Link></li>
              </>
            )}
          </ol>
        </nav>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
          <header className="min-w-0">
            <p className={EYEBROW}>Listing review request</p>
            <h1 className="mt-2 text-[clamp(1.75rem,3.4vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em]">
              Correct or request removal of a researched listing
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-7 text-carup-text-2">
              CarUp reviews correction, closure, identity-dispute and removal requests.
              A request does not prove business ownership or automatically change a public record.
              A reviewer can suppress inaccurate information after independent assessment.
            </p>
            <ol className="mt-8 space-y-5 border-t border-carup-line pt-6">
              {WHAT_HAPPENS.map(([title, body], index) => (
                <li key={title} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-carup-bg-surface-2 text-xs font-semibold tabular-nums" aria-hidden="true">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-[13px] leading-5 text-carup-text-2">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </header>

          <section aria-label="Review request" className={cn(CARD, 'min-w-0 p-5 sm:p-8')}>
            {!validId ? (
              <Notice tone="warning" role="alert">Invalid dealership research reference.</Notice>
            ) : phase === 'submitted' ? (
              <div>
                <Notice tone="info" role="status" testId="dealer-correction-recorded">
                  Your request is recorded for private human review. No publication change is asserted.
                </Notice>
                <p className="mt-5 text-sm"><Link to={profileHref} className={TEXT_LINK}>Return to the listing</Link></p>
              </div>
            ) : (
              <form onSubmit={props.onSubmit} className="space-y-5">
                <p className="text-[13px] text-carup-text-3">Research reference: <span className="font-semibold text-carup-text-2">{reference}</span></p>
                <div>
                  <label htmlFor="research-correction-kind" className={LABEL}>Request category</label>
                  <select id="research-correction-kind" className={FIELD} value={props.requestType} onChange={event => props.onRequestType(event.target.value as CorrectionRequestType)}>
                    <option value="CORRECTION">Correct inaccurate business information</option>
                    <option value="REMOVAL">Request listing removal</option>
                    <option value="BUSINESS_CLOSED">Business is closed or no longer operating</option>
                    <option value="IDENTITY_DISPUTE">Business identity or branch ownership disputed</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="research-correction-summary" className={LABEL}>Information requiring review</label>
                  <textarea id="research-correction-summary" className={TEXTAREA} required minLength={30} maxLength={2000} value={props.summary} onChange={event => props.onSummary(event.target.value)} />
                  <p className={HINT}>At least 30 characters. Say what is wrong and what is correct.</p>
                </div>
                <div>
                  <label htmlFor="research-correction-email" className={LABEL}>Contact email (optional, private)</label>
                  <input id="research-correction-email" type="email" className={FIELD} maxLength={200} value={props.contactEmail} onChange={event => props.onContactEmail(event.target.value)} />
                </div>
                <p className="flex items-start gap-2 rounded-card bg-carup-bg-surface p-3 text-[13px] leading-5 text-carup-text-2">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
                  <span>Do not post government IDs, bank details or scanned documents in this text form. Any original documents must use a separate secure evidence-intake process.</span>
                </p>
                {props.error && <Notice tone="danger" role="alert">{props.error}</Notice>}
                <button type="submit" disabled={phase === 'sending'} className={ACTION_PRIMARY}>
                  {phase === 'sending' ? 'Submitting…' : 'Submit private review request'}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
