import { Link } from 'react-router-dom'
import { ShieldCheck, FileText, Wrench, AlertTriangle, ArrowRight } from 'lucide-react'
import { PUBLIC_CONTACTS } from '@/config/publicIdentity'
import { usePageMetadata } from '@/lib/usePageMetadata'

const RECORDS = [
  { icon: FileText, title: 'Ownership and documents', detail: 'Read the documents supplied for the vehicle and the recorded review decisions. A CarUp review is an assessment of the evidence supplied, not confirmation from a government registry.' },
  { icon: Wrench, title: 'Service history and parts', detail: 'See the service and parts records that are available for public viewing. Missing history is shown as missing; a record does not prove that every repair has been recorded.' },
  { icon: ShieldCheck, title: 'What CarUp knows', detail: 'The Vehicle Passport shows the evidence available, its review state, and gaps. Not evaluated means not evaluated. A Trust position is not a guarantee of condition, a valuation, a credit score or a verdict on the seller.' },
]
const SAFETY = [
  ['Read the Vehicle Passport', 'Compare the listing with the evidence available. Ask about gaps and arrange an independent inspection before committing to a purchase.'],
  ['Inspect in a safe place', 'Arrange a well-lit public meeting place and take someone you trust. CarUp does not operate physical inspection hubs or a partner inspection network.'],
  ['Check the documents yourself', 'Compare the vehicle identifier and seller identity with original documents. Confirm ownership, import liabilities and clearance directly with the relevant authority when needed. CarUp has no registry connection.'],
  ['Treat payments carefully', 'CarUp is non-custodial: it does not hold, transfer or process funds. Its escrow feature is sandbox-only. Do not treat a CarUp listing or conversation as a payment guarantee.'],
]

export default function TrustSafety() {
  usePageMetadata({ title: 'Trust & Safety | CarUp', description: 'Read the Vehicle Passport, understand evidence and gaps, and take practical precautions when buying or selling a car.', canonicalPath: '/trust' })
  return <div className="bg-slate-50 text-slate-900" data-testid="page-trust">
    <header className="bg-slate-950 text-white">
      <div className="section-padding mx-auto max-w-6xl py-12 sm:py-16">
        <p className="font-semibold text-amber-400">Trust & Safety</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">Know what is recorded. Ask about what is missing.</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">A Vehicle Passport helps you understand a car’s ownership, evidence and service history. It supports your decision; it cannot replace an independent inspection.</p>
        <Link to="/search" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-400 px-5 py-3 font-semibold text-slate-950">Look up a vehicle <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
    </header>
    <div className="section-padding mx-auto max-w-6xl py-10 sm:py-16">
      <section aria-labelledby="passport-evidence">
        <h2 id="passport-evidence" className="text-2xl font-bold">What the Passport tells you</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-3">{RECORDS.map(({ icon: Icon, title, detail }) => <article key={title} className="rounded-xl border border-slate-200 bg-white p-6"><Icon className="h-6 w-6 text-amber-700" aria-hidden /><h3 className="mt-4 text-lg font-semibold">{title}</h3><p className="mt-3 leading-7 text-slate-600">{detail}</p></article>)}</div>
      </section>
      <section className="mt-12" aria-labelledby="safe-trading">
        <h2 id="safe-trading" className="text-2xl font-bold">Before you buy or sell</h2>
        <div className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">{SAFETY.map(([title, detail]) => <details key={title} className="p-5"><summary className="min-h-11 cursor-pointer py-2 font-semibold">{title}</summary><p className="mt-2 leading-7 text-slate-600">{detail}</p></details>)}</div>
      </section>
      <section className="mt-12 rounded-xl border border-amber-200 bg-amber-50 p-6" aria-labelledby="report-concern">
        <h2 id="report-concern" className="flex items-center gap-2 text-xl font-bold"><AlertTriangle className="h-6 w-6 shrink-0" aria-hidden />Concerned about a listing?</h2>
        <p className="mt-3 leading-7" data-testid="trust-report-unavailable">In-product reporting is not available. Email the listing link and your concern to <a href={`mailto:${PUBLIC_CONTACTS.support}`} className="inline-flex min-h-11 items-center break-all font-semibold underline">support@carup.dev</a>. CarUp has no guaranteed response time or law-enforcement escalation arrangement. If you suspect a stolen vehicle, contact the police directly.</p>
        <button type="button" disabled data-testid="trust-report-submit" className="mt-4 min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-slate-600">In-product reporting unavailable</button>
        <p className="mt-3 text-sm leading-6 text-slate-600">Do not send passwords or recovery codes. For an account security concern, use <Link className="inline-flex min-h-11 items-center underline" to="/security">CarUp Security</Link>.</p>
      </section>
    </div>
  </div>
}
