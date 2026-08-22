import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search, Store } from 'lucide-react'
import { useState } from 'react'

/**
 * Dealer Directory — honest empty state.
 *
 * This page previously listed invented dealerships from `mockData.dealers` — fabricated company names,
 * ratings, inventory counts, phone numbers and a green "Verified" check — as though CarUp had verified
 * them. There is no governed dealer registry behind this surface, so every entry was a fabricated
 * business fact on a public page.
 *
 * The fabricated records are removed rather than swapped for other invented names. The page and its
 * search remain so the surface can be wired to the governed dealer/tenant registry when one is
 * published; until then it says so plainly instead of showing unverified entries.
 */
export default function DealerDirectory() {
  const [search, setSearch] = useState('')
  // No governed dealer registry is published yet, so there is nothing to filter.
  const dealers: Array<{ id: string; name: string }> = []
  const filtered = dealers.filter(d => !search || d.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Dealer Directory</h1>
          <p className="text-gray-600 mb-6">Dealers that CarUp has onboarded and verified.</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Search dealers by name or location..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] py-8">
        {filtered.length === 0 && (
          <Card className="border-0 card-shadow" data-testid="dealer-directory-empty">
            <CardContent className="p-10 text-center">
              <Store className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <h2 className="font-semibold text-gray-800">No verified dealers listed yet</h2>
              <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                CarUp lists a dealer here only once it has been onboarded and verified. None has been
                published yet, so this directory is empty rather than showing unverified entries.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
