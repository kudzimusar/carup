import type { ReactNode } from 'react'

/** The page's own surface vocabulary, shared by the CAP sections so they cannot drift apart. */
export const card = 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5'
export const eyebrow = 'text-xs font-semibold uppercase tracking-wide text-slate-500'

/** One labelled section of the page. The heading is real (h2) and the region is named by it, so a screen reader can jump between sections. */
export function CapSection({ id, title, icon, children, testId }: { id: string; title: string; icon?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={`mt-5 scroll-mt-20 ${card}`} data-testid={testId ?? id}>
      <h2 id={`${id}-heading`} className={`flex items-center gap-1.5 ${eyebrow}`}>{icon}{title}</h2>
      {children}
    </section>
  )
}

/** A recorded fact, or the honest words that it is not recorded. */
export function Fact({ label, value, marker = false }: { label: string; value: string | number | null | undefined; marker?: boolean }) {
  const missing = value === null || value === undefined || String(value).trim() === ''
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-sm ${missing ? 'text-slate-500' : 'text-slate-900'}`}>
        {missing ? 'Not recorded' : value}
        {marker && !missing ? <UnverifiedMark /> : null}
      </dd>
    </div>
  )
}

/** The † beside a value that is "as recorded, not independently verified": a dagger for the eye, and the words for everyone else. */
export function UnverifiedMark() {
  return (
    <>
      <span className="ml-1 text-xs text-slate-500" aria-hidden="true" data-testid="unverified-mark">†</span>
      <span className="sr-only"> (as recorded; not independently verified)</span>
    </>
  )
}

/** A part the projection withheld or could not read — said as what it is, in the projection's own words. */
export function Unshown({ availability, note, testId }: { availability: 'withheld' | 'unavailable' | string; note?: string; testId?: string }) {
  const unavailable = availability === 'unavailable'
  return (
    <p
      className={`mt-3 min-w-0 break-words rounded-lg border p-3 text-sm ${unavailable ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
      data-testid={testId}
      role={unavailable ? 'status' : undefined}
    >
      {note || (unavailable ? 'This could not be read right now. That does not mean there is nothing to show.' : 'This is not available to you here.')}
    </p>
  )
}
