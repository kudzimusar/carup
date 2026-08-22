import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search, Shield } from 'lucide-react'

/**
 * Insurance Directory — honest empty state.
 *
 * This page previously listed REAL insurance companies (NicozDiamond, CABS, Cell Insurance) as
 * CarUp-"Verified" onboarded partners, with ratings, contact numbers and a "Get a Quote" action, all
 * sourced from `mockData.insuranceProviders`. None of that was true: CarUp has no governed insurer
 * directory, and presenting real firms as verified partners asserts a commercial relationship that
 * does not exist.
 *
 * The fabricated records are removed rather than replaced — inventing substitute companies would be
 * the same defect with different names. The page and its search remain so the surface can be wired to
 * a governed provider registry when one exists; until then it states plainly that none is published.
 */
export default function InsuranceDirectory() {
  const [search, setSearch] = useState('')
  // No governed insurer registry is published yet, so there is nothing to filter.
  const providers: Array<{ id: string; name: string }> = []
  const filtered = providers.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Insurance Directory</h1>
          <p className="text-gray-600 mb-6">Motor insurance providers that CarUp has onboarded and verified.</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Search insurance providers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] py-8">
        {filtered.length === 0 && (
          <Card className="border-0 card-shadow" data-testid="insurance-directory-empty">
            <CardContent className="p-10 text-center">
              <Shield className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <h2 className="font-semibold text-gray-800">No verified insurance providers listed yet</h2>
              <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                CarUp lists an insurer here only once it has been onboarded and verified. None has been
                published yet, so this directory is empty rather than showing unverified entries.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
