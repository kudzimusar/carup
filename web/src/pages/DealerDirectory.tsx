import { Card, CardContent } from '@/components/ui/card'
import { Store } from 'lucide-react'
import { DirectoryJoinCard } from '@/components/directory/DirectoryJoinCard'

/**
 * Dealer Directory — honest empty state.
 *
 * This page previously listed invented dealerships from `mockData.dealers` — fabricated company names,
 * ratings, inventory counts, phone numbers and a green "Verified" check — as though CarUp had verified
 * them. There is no governed dealer registry behind this surface, so every entry was a fabricated
 * business fact on a public page.
 *
 * The fabricated records are removed rather than swapped for other invented names. Until the page is
 * wired to the governed dealer/tenant registry it says so plainly instead of showing unverified
 * entries. PC01-J-R1 removed its search box — it filtered a hard-coded empty array, a control that
 * could only ever answer "nothing" — and added the real way in for a dealer (DirectoryJoinCard).
 */
export default function DealerDirectory() {

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Dealer Directory</h1>
          <p className="text-gray-600">Dealers that CarUp has onboarded and verified.</p>
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] space-y-6 py-8">
        {/* No governed dealer registry is published yet, so the directory is empty by construction. */}
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
        <DirectoryJoinCard kind="dealer" />
      </div>
    </div>
  )
}
