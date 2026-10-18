/**
 * CA-OWNER-02 — the operational Admin says where the Owner is, which authority applies here, and the way back.
 *
 * Operational Admin works on live operational records and is authorised by the platform role (users.role). Corporate
 * Admin is admitted by the server from persistent Corporate memberships and permissions. The two stay separate: this
 * banner changes no route and no authorisation, and it never holds back the admin page.
 *
 * Its one Corporate affordance — "Return to Corporate Admin" — is shown only when the SERVER's Corporate decision for this
 * session (useCorporateServerDecision) is a grant. While that decision is pending, denied, unavailable or unauthenticated
 * the context is stated without it. No client-side role is consulted. The arrival line reads only the navigation marker
 * (adminArrival), which is never authority. CA-OWNER-02-R3 (D6): the arrival is remembered for the whole Admin visit — it
 * survives the page rewriting its own address and moving between Admin pages — and ends on "Return to Corporate Admin" or
 * when a non-Admin page renders.
 */
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useCorporateServerDecision } from '@/lib/corporate/useCorporateAccess'
import { arrivedFromCorporate, forgetCorporateArrival, rememberCorporateArrival, rememberedCorporateArrival } from './adminArrival'

export function AdminContextBanner() {
  const { decision } = useCorporateServerDecision()
  const { search } = useLocation()
  const markedNow = arrivedFromCorporate(search)
  useEffect(() => { if (markedNow) rememberCorporateArrival() }, [markedNow])
  const fromCorporate = markedNow || rememberedCorporateArrival()
  return (
    <section
      aria-label="Operational Admin context"
      className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
      data-testid="admin-context-banner"
      data-corporate-decision={decision.status}
    >
      <div className="min-w-0 flex-1 basis-64 space-y-0.5 leading-relaxed">
        {fromCorporate && (
          <p className="font-medium text-slate-900" data-testid="admin-context-arrival">You came from Corporate Admin.</p>
        )}
        <p data-testid="admin-context-statement">
          <strong className="font-semibold text-slate-900">Operational Admin</strong> — live operational records. Access here
          comes from your platform role (<code className="rounded bg-white px-1 font-mono text-[11px] text-slate-800">users.role</code>),
          not from Corporate memberships or permissions.
        </p>
      </div>
      {decision.status === 'granted' && (
        <Link
          to="/corporate"
          onClick={forgetCorporateArrival}
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 max-sm:min-h-11"
          data-testid="admin-context-return-corporate"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Return to Corporate Admin
        </Link>
      )}
    </section>
  )
}
