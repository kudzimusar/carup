import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { PUBLIC_CONTACTS } from '@/config/publicIdentity'

/**
 * PC01-J-R1 — the supply-side path on a public directory.
 *
 * The Dealer, Garage and Insurance directories are honest about being empty, but that left each one
 * a page with nowhere to go. Dealers and garages DO have a real path — the governed onboarding
 * journey offers "Dealer / dealership" and "Garage / service centre" as business types — so the card
 * points there, and says plainly that an account is not a listing. Insurers have no onboarding yet,
 * so their card offers the approved general address rather than a flow that does not exist.
 */
const ONBOARDING = '/onboarding'

const COPY = {
  dealer: {
    title: 'Run a dealership?',
    body: 'Create a CarUp account, then choose “Dealer / dealership” in your onboarding. A dealer appears here only after CarUp has verified it — creating an account does not list you.',
  },
  garage: {
    title: 'Run a garage or service centre?',
    body: 'Create a CarUp account, then choose “Garage / service centre” in your onboarding. A garage appears here once it has published its own profile.',
  },
} as const

export function DirectoryJoinCard({ kind }: { kind: 'dealer' | 'garage' | 'insurer' }) {
  const { isAuthenticated } = useAuth()

  if (kind === 'insurer') {
    return (
      <Card className="border-slate-200 py-0" data-testid="directory-join-insurer">
        <CardContent className="space-y-2 p-6">
          <h2 className="font-semibold text-slate-900">Are you an insurer?</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            CarUp has no insurer onboarding yet. To talk to CarUp about it, write to the general address.
          </p>
          <a className="inline-flex min-h-11 items-center break-all font-medium text-orange-700 underline" href={`mailto:${PUBLIC_CONTACTS.info}`}>
            {PUBLIC_CONTACTS.info}
          </a>
        </CardContent>
      </Card>
    )
  }

  const copy = COPY[kind]
  const returnTo = encodeURIComponent(ONBOARDING)
  return (
    <Card className="border-slate-200 py-0" data-testid={`directory-join-${kind}`}>
      <CardContent className="space-y-3 p-6">
        <h2 className="font-semibold text-slate-900">{copy.title}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{copy.body}</p>
        <div className="flex flex-wrap gap-2">
          {isAuthenticated ? (
            <Button asChild className="min-h-11 bg-orange-500 hover:bg-orange-600">
              <Link to={ONBOARDING}>Open your onboarding</Link>
            </Button>
          ) : (
            <>
              <Button asChild className="min-h-11 bg-orange-500 hover:bg-orange-600">
                <Link to={`/register?returnTo=${returnTo}`}>Create an account</Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11">
                <Link to={`/login?returnTo=${returnTo}`}>Sign in</Link>
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
