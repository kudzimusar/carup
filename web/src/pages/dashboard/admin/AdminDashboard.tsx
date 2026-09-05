/**
 * Ecosystem command centre — CarUp Intelligence I16.
 *
 * An earlier pass removed the fabricated organization and fraud tables from this
 * page — they had listed real companies as Active CarUp partners with invented
 * Trust Index percentages, and fabricated VIN-cloning interceptions. What that
 * pass left behind is what I16 removes:
 *
 *   - a seeded `stats` object (9,200 users, 5 vehicles, 1 escrow, "Optimal",
 *     "98.5%") used as the fallback for EVERY field via `data.x || prev.x`, so a
 *     genuine zero from the server was replaced by the invented seed, and a failed
 *     fetch left the invented numbers on screen with no indication at all;
 *   - "SafePay Escrow Volume", which rendered the literal `'$145,000'` whenever
 *     the real escrow count was zero — and otherwise switched units to "N Locks",
 *     so the tile was never comparable with itself;
 *   - four hardcoded period deltas (+18%, +20%, +32%, +0.4%), colour-coded green
 *     by whether the literal began with a plus sign;
 *   - a five-month user-growth line chart drawn from a fixed array;
 *   - and an "Active AI Copilots" panel showing "Simbisa Diagnostics AI" and "Old
 *     Mutual Underwriter Copilot" as Online — asserting running integrations with
 *     two real named companies.
 *
 * "Fraud Intercept Rate 98.5%" was fed by a string literal in the admin API
 * itself, which has been removed at the source alongside `systemHealth: 'Optimal'`.
 *
 * The page now composes the governed command-centre projection, which states each
 * section's source and names the sections that have none.
 */
import { Users, Brain, ShieldAlert, ArrowRight, Building2, FileCheck2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import CommandCentre from '@/components/intelligence/CommandCentre'

const QUICK_ACTIONS = [
  { label: 'User Management', href: '/admin/users', icon: Users },
  { label: 'AI Monitoring', href: '/admin/ai', icon: Brain },
  { label: 'Moderation', href: '/admin/moderation', icon: ShieldAlert },
  { label: 'Fraud Queue', href: '/admin/fraud-queue', icon: ShieldAlert },
  { label: 'Dealer Compliance', href: '/admin/dealer-compliance', icon: Building2 },
  { label: 'Evidence Review', href: '/admin/evidence', icon: FileCheck2 },
]

export default function AdminDashboard() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Ecosystem command centre</h1>
        <p className="text-gray-500">
          The platform position, with each section's source stated and the sections that have none
          named.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CommandCentre windowDays={30} />
        </div>

        <div className="space-y-6">
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {QUICK_ACTIONS.map((link) => (
                <Link key={link.label} to={link.href} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <link.icon className="w-4 h-4 text-orange-500" />
                  <span className="flex-1 font-semibold">{link.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
