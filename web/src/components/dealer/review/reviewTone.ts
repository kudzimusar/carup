/**
 * RX05-D — how a reviewer status string is TONED in the independent review workbench.
 *
 * Truth rule: material nobody has decided on yet must never look verified. A status reads as
 * success only when it names a recorded positive decision (approved, activated, published,
 * attached, verified). Anything waiting, unreviewed, unverified, proposed or "not …" is checked
 * FIRST and can therefore never be painted green, whatever other words it also contains
 * (e.g. PENDING_APPROVAL, UNVERIFIED, NOT_APPROVED, DEACTIVATED).
 *
 * Presentation only: a tone never decides access, eligibility or what an action may do.
 */
export type ReviewTone = 'pending' | 'attention' | 'negative' | 'positive' | 'neutral'

const NEGATIVE = /REJECT|REVOK|SUSPEND|WITHDRAW|SUPPRESS|QUARANTIN|EXPIRED|BLOCKED|RETRACT|DENIED|FAILED|DEACTIVAT|CLOSED_PERMANENTLY/
const ATTENTION = /DISPUT|INVESTIGATION|NEEDS_|_REQUIRED|CONFLICT|DUPLICATE/
/** Decided, but deliberately not a verification: unclaimed research, withheld, escalated. */
const NEUTRAL_DECIDED = /PRELISTED|UNCLAIMED|WITHHELD|READY_FOR|NOT_ELIGIBLE|SUPERSEDED/
const PENDING = /(^|_)NOT_|^UN|PENDING|AWAITING|SUBMITTED|UNRESOLVED|POTENTIAL|DRAFT|QUEUED|PROPOSED|IN_REVIEW|LOADING/
const POSITIVE = /APPROVED|ACTIVATED|PUBLISHED_FULL|ATTACHED|^OPERATIONAL$|^ACTIVE$|^VERIFIED$/

export function reviewStatusTone(status?: string | null): ReviewTone {
  const s = String(status ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (!s) return 'neutral'
  if (NEGATIVE.test(s)) return 'negative'
  if (ATTENTION.test(s)) return 'attention'
  if (NEUTRAL_DECIDED.test(s)) return 'neutral'
  if (PENDING.test(s)) return 'pending'
  if (POSITIVE.test(s)) return 'positive'
  return 'neutral'
}

/** "AWAITING_DOCUMENTARY_EVIDENCE" → "Awaiting documentary evidence". */
export function humanizeStatus(status?: string | null): string {
  const s = String(status ?? '').replaceAll('_', ' ').trim().toLowerCase()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Not recorded'
}

/** How long something has been waiting, from a server timestamp. Null when the timestamp is unusable. */
export function reviewAge(iso?: string | null, now: number = Date.now()): string | null {
  const t = Date.parse(iso ?? '')
  if (Number.isNaN(t)) return null
  const days = Math.floor((now - t) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}

/** The case column's placeholder title, honest about why no case is open. */
export function noCaseTitle(state: 'loading' | 'unavailable' | 'empty' | 'ready', ready: string, empty: string): string {
  if (state === 'ready') return ready
  if (state === 'empty') return empty
  if (state === 'loading') return 'Loading the queue…'
  return 'No case is open while the queue is unavailable.'
}
