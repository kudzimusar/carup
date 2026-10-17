import { Card, CardContent } from '@/components/ui/card'
import { Shield } from 'lucide-react'
import { DirectoryJoinCard } from '@/components/directory/DirectoryJoinCard'

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
 * the same defect with different names. Until a governed provider registry exists the page states
 * plainly that none is published. PC01-J-R1 removed its search box — it filtered a hard-coded empty
 * array — and added the one real path an insurer has today: the approved general address.
 */
export default function InsuranceDirectory() {

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Insurance Directory</h1>
          <p className="text-gray-600">Motor insurance providers that CarUp has onboarded and verified.</p>
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] space-y-6 py-8">
        {/* No governed insurer registry is published yet, so the directory is empty by construction. */}
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
        <DirectoryJoinCard kind="insurer" />
      </div>
    </div>
  )
}
