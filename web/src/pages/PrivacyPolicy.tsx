import { Link } from 'react-router-dom'
import { Database, ExternalLink, Lock, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[hsl(222,47%,8%)] text-slate-100">
      <section className="border-b border-white/10 px-4 py-16">
        <div className="mx-auto max-w-4xl">
          <Badge className="mb-4 border border-amber-300/30 bg-amber-400/10 text-amber-200">
            Draft — owner/legal approval required
          </Badge>
          <h1 className="text-4xl font-extrabold tracking-tight">Privacy & Data Handling</h1>
          <p className="mt-4 max-w-2xl text-slate-300">
            This page describes the current technical posture without inventing a final legal
            policy, partner relationship, retention period, Data Protection Officer, office
            address, response-time promise, or consent workflow that is not actually implemented.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <Card className="border-white/10 bg-white/5 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-orange-400" />
              CarUp audit ledger
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-slate-300">
            <p>
              CarUp maintains an internal audit record for governed platform events. It is not
              published to any external or public network.
            </p>
            <p>
              Public product surfaces may expose a marketplace-visible record only where the
              relevant CarUp authority permits that projection. Private evidence, credentials,
              internal identifiers, and provider secrets are not made public by the audit ledger.
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-orange-400" />
              External providers and data sharing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-slate-300">
            <p>
              No insurer, lender, registry, dealer, garage, government body, or other third party
              should be inferred to be a CarUp partner from example copy. External data exchange is
              available only when the corresponding governed integration is actually configured,
              authorized, and permitted for the specific request.
            </p>
            <p>
              Candidate AI or OCR output is evidence for review; it does not itself establish
              identity, ownership, registration, dealer authority, payment status, or government
              truth.
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-orange-400" />
              Policy decisions still pending
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-slate-300">
            <p>
              Production retention, deletion, anonymization, legal-hold, data-subject request,
              consent, official privacy-contact, and jurisdiction-specific policy details require
              owner/legal approval and an implemented workflow. This page does not claim those
              controls exist until they do.
            </p>
            <p>
              When the approved policy is published, this page should describe only verified
              operational contacts, actual integrations, and controls backed by canonical records.
            </p>
            <Button asChild variant="outline" className="border-white/15 bg-white/5 text-slate-100 hover:bg-white/10">
              <Link to="/contact">Contact CarUp <ExternalLink className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
