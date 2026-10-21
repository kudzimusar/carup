import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { PUBLIC_CONTACTS } from '@/config/publicIdentity'
import { GARAGE_SETUP_ROUTE } from '@/lib/garageOnboarding'

/**
 * PC01-J-R1 — the supply-side path on a public directory.
 *
 * The Dealer, Garage and Insurance directories are honest about being empty, but that left each one
 * a page with nowhere to go. Dealers and garages DO have a real path — the governed onboarding
 * journey offers "Dealer / dealership" and "Garage / service centre" as business types — so the card
 * points there, and says plainly that an account is not a listing. Insurers have no onboarding yet,
 * so their card offers the approved general address rather than a flow that does not exist.
 *
 * CARUP-MVP-STAB-01 F-019: /onboarding never offered a garage its application. A signed-in visitor
 * now goes straight to /dashboard/garage-setup (whose own server gate decides who may apply); a
 * signed-out one registers — the registration card hands a garage to its application — or signs in
 * and returns to it.
 */
const ONBOARDING = '/onboarding'

const COPY = {
  dealer: {
    title: 'Run a dealership?',
    body: 'Create a CarUp account, then choose “Dealer / dealership” in your onboarding. A dealer appears here only after CarUp has verified it — creating an account does not list you.',
  },
  garage: {
    title: 'Run a garage or service centre?',
    body: 'Create a CarUp account as a “Garage / service centre” business, then send CarUp your garage application. CarUp reviews every application. A garage appears here once its application is approved and it publishes its own profile — a listing is not an inspection or an endorsement.',
  },
} as const

/** Where each kind's way in leads: signed in, and the registration / sign-in pair when signed out. */
const LINKS = {
  dealer: {
    signedIn: { to: ONBOARDING, label: 'Open your onboarding' },
    register: `/register?returnTo=${encodeURIComponent(ONBOARDING)}`,
    signIn: `/login?returnTo=${encodeURIComponent(ONBOARDING)}`,
  },
  garage: {
    signedIn: { to: GARAGE_SETUP_ROUTE, label: 'Start your garage application' },
    register: '/register',
    signIn: `/login?returnTo=${encodeURIComponent(GARAGE_SETUP_ROUTE)}`,
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
  const links = LINKS[kind]
  return (
    <Card className="border-slate-200 py-0" data-testid={`directory-join-${kind}`}>
      <CardContent className="space-y-3 p-6">
        <h2 className="font-semibold text-slate-900">{copy.title}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{copy.body}</p>
        <div className="flex flex-wrap gap-2">
          {isAuthenticated ? (
            <Button asChild className="min-h-11 bg-orange-500 hover:bg-orange-600">
              <Link to={links.signedIn.to}>{links.signedIn.label}</Link>
            </Button>
          ) : (
            <>
              <Button asChild className="min-h-11 bg-orange-500 hover:bg-orange-600">
                <Link to={links.register}>Create an account</Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11">
                <Link to={links.signIn}>Sign in</Link>
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
