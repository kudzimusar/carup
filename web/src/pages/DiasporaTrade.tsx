import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Globe2, ShieldCheck, FileText, Wallet, Handshake, Search, ShoppingCart } from 'lucide-react'

/**
 * Diaspora Trade — public placeholder / early-access landing page.
 * Intentionally static: it explains the intended value and routes users to what is live today
 * (Marketplace + Vehicle Verification). The full Diaspora Trade workflow is NOT wired here.
 */

const sections = [
  {
    icon: Globe2,
    title: 'Source vehicles remotely',
    body: 'Find verified vehicles across Zimbabwe from anywhere, with the same trust signals local buyers see.',
  },
  {
    icon: ShieldCheck,
    title: 'Verify before paying',
    body: 'Check a vehicle or parts history before committing funds — passport, plate, and PartSentry signals where data exists.',
  },
  {
    icon: FileText,
    title: 'Track documents and authorization',
    body: 'Follow import documents, duty status, and authorization steps in one place. (Planned.)',
  },
  {
    icon: Wallet,
    title: 'Prepare SafePay / reservation readiness later',
    body: 'Reserve and move funds safely through SafePay-backed escrow once it is enabled for diaspora flows. (Planned.)',
  },
  {
    icon: Handshake,
    title: 'Work with trusted local agents and dealers later',
    body: 'Coordinate with verified local dealers and agents to inspect, collect, and hand over. (Planned.)',
  },
]

export default function DiasporaTrade() {
  return (
    <div className="min-h-screen bg-gray-50" data-testid="diaspora-page">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white">
        <div className="section-padding mx-auto max-w-[1440px] py-16">
          <span className="inline-flex items-center gap-2 rounded-full border border-orange-400/40 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-300">
            Early access — in development
          </span>
          <h1 className="mt-4 text-3xl font-bold md:text-4xl">Diaspora Trade</h1>
          <p className="mt-3 max-w-3xl text-gray-300">
            Helping diaspora buyers source, verify, reserve, and track vehicle purchases with CarUp trust signals.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="bg-orange-500 hover:bg-orange-600">
              <Link to="/marketplace" data-testid="diaspora-cta-marketplace">
                <ShoppingCart className="mr-2 h-4 w-4" /> Browse Marketplace
              </Link>
            </Button>
            <Button asChild variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10 hover:text-white">
              <Link to="/search" data-testid="diaspora-cta-verify">
                <Search className="mr-2 h-4 w-4" /> Verify a Vehicle
              </Link>
            </Button>
            <Button
              variant="secondary"
              disabled
              data-testid="diaspora-cta-coming-soon"
              title="Diaspora Trade requests are not available yet"
            >
              Start Diaspora Trade Request (coming soon)
            </Button>
          </div>
        </div>
      </div>

      {/* Honest status banner */}
      <div className="section-padding mx-auto max-w-[1440px] pt-8">
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          data-testid="diaspora-status-note"
        >
          Full Diaspora Trade workflows are being developed. For now, use Marketplace and Vehicle
          Verification while this module is prepared.
        </div>
      </div>

      {/* What Diaspora Trade will offer */}
      <div className="section-padding mx-auto max-w-[1440px] py-10">
        <h2 className="mb-4 text-xl font-bold text-gray-900">What Diaspora Trade will offer</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map(section => (
            <Card key={section.title} className="border-0 card-shadow bg-white">
              <CardContent className="p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                  <section.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-gray-900">{section.title}</h3>
                <p className="mt-1.5 text-sm text-gray-600">{section.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Start with what's live today */}
      <div className="section-padding mx-auto max-w-[1440px] pb-16">
        <Card className="border-0 card-shadow bg-white">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Start with what is live today</h2>
              <p className="text-sm text-gray-600">
                Browse verified listings and run a vehicle or parts verification while Diaspora Trade is being built.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="bg-gray-950 text-white hover:bg-gray-800">
                <Link to="/marketplace">Browse Marketplace</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/search">Verify a Vehicle</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
