import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const NOT_PUBLISHED = [
  'Subscription prices, commissions, transaction fees, grace periods, refunds, and suspension charges',
  'Partner, bank, insurer, registry, government, or payment-provider relationships',
  'Service-level promises, response-time guarantees, physical office addresses, or legal-contact identities',
  'Automatic penalties, blacklisting, referrals to authorities, or other legal-enforcement outcomes',
]

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <section className="bg-[hsl(222,47%,9%)] px-4 py-16 text-white">
        <div className="mx-auto max-w-4xl">
          <Badge className="mb-4 border border-amber-300/30 bg-amber-400/10 text-amber-200">
            Draft — owner/legal approval required
          </Badge>
          <h1 className="text-4xl font-extrabold tracking-tight">Terms of Service</h1>
          <p className="mt-4 max-w-2xl text-slate-300">
            CarUp does not currently publish a final commercial or legal terms document from this
            source. This page deliberately withholds placeholder fees, partner claims, enforcement
            promises, and contractual terms until they are approved.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              No placeholder commercial terms
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            {NOT_PUBLISHED.map(item => (
              <div key={item} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <span>{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>What governs today</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-slate-600">
            <p>
              Product access and actions are governed by the authenticated CarUp application,
              canonical domain authority, feature gates, and provider availability actually
              configured at runtime. A disabled or unconfigured external capability must remain
              unavailable rather than being represented by a simulated commercial service.
            </p>
            <p>
              Test fixtures, mock providers, sandbox payment states, and demonstration identities
              are not contractual product truth and do not establish a price, entitlement, partner
              relationship, regulatory status, or service obligation.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Before final publication</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-slate-600">
            <p>
              The owner must approve the commercial model and the appropriate legal review must
              approve the operative terms, jurisdiction-specific obligations, privacy references,
              cancellation/refund rules, and official contact details.
            </p>
            <Button asChild variant="outline">
              <Link to="/contact">Contact CarUp <ExternalLink className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
