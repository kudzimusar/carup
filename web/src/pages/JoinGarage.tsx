import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Loader2, Wrench, AlertCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SN_PAGE, SN_FORM_COLUMN } from '@/lib/serviceNetworkLayout'

type Peek = {
  garageName: string | null
  role: string
  invitedName: string | null
  invitedEmail: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  usable: boolean
}

/**
 * GMO-6 — the page an invited mechanic lands on.
 *
 * Most people arriving here have never used CarUp. So it answers, before asking anything: which
 * garage, what role, and which email address they must use. Being told the last of those only
 * AFTER registering is a wasted account and a person who gives up.
 *
 * The return path is built here rather than taken from the URL. An invitation link is exactly the
 * kind of thing that gets forwarded and rewritten, and a `?next=` parameter honoured after sign-in
 * is an open redirect with a captive audience. The only place this page will send you back to is
 * itself, with the token it already has.
 */
export default function JoinGarage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { isAuthenticated, user } = useAuth()
  const { peekGarageInvitation, acceptGarageInvitation } = useCarUpApi()
  const navigate = useNavigate()

  const [peek, setPeek] = useState<Peek | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading')
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token) { setState('invalid'); return }
    peekGarageInvitation(token)
      .then((res: Peek) => { setPeek(res); setState('ready') })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : ''
        // "This link is not valid" and "we could not check the link" are different facts, and a
        // person who was genuinely invited must not be told their invitation is fake.
        setState(/not valid/i.test(msg) ? 'invalid' : 'error')
      })
  }, [token, peekGarageInvitation])

  useEffect(() => { load() }, [load])

  /** Same-origin by construction: this page, with the token it already holds. */
  const returnPath = `/join-garage?token=${encodeURIComponent(token)}`

  async function accept() {
    setAccepting(true); setError(null)
    try {
      await acceptGarageInvitation(token)
      // A fresh membership does not exist in the current session's context, so send them somewhere
      // that will establish it rather than straight into a workspace they cannot yet open.
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This invitation could not be accepted.')
    } finally { setAccepting(false) }
  }

  if (state === 'loading') {
    return (
      <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
        <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          <span className="text-sm text-gray-600">Checking this invitation…</span>
        </div>
      </div>
    )
  }

  if (state === 'invalid') {
    return (
      <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center" data-testid="invitation-invalid">
          <AlertCircle className="w-8 h-8 text-gray-400 mx-auto" aria-hidden="true" />
          <p className="font-medium text-gray-900 mt-3">This invitation link is not valid.</p>
          <p className="text-sm text-gray-600 mt-1">
            Ask the garage to send you a new one.
          </p>
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center" data-testid="invitation-error">
          <p className="font-medium text-gray-900">We could not check this invitation just now.</p>
          <p className="text-sm text-gray-600 mt-1">
            This is a loading problem — it does not mean your invitation is not real.
          </p>
          <Button variant="outline" className="min-h-11 mt-3" onClick={() => { setState('loading'); load() }}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const p = peek!
  const wrongAccount = isAuthenticated && user?.email
    && user.email.trim().toLowerCase() !== p.invitedEmail.trim().toLowerCase()

  return (
    <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
      <div className="rounded-xl border border-gray-200 bg-white p-6" data-testid="invitation-card">
        <Wrench className="w-8 h-8 text-orange-500" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-gray-900 mt-3">
          {p.garageName ?? 'A garage'} has invited you
        </h1>
        <p className="text-gray-600 mt-2">
          {p.invitedName ? `${p.invitedName}, you` : 'You'} have been invited to join{' '}
          <span className="font-medium text-gray-900">{p.garageName ?? 'this garage'}</span> as a{' '}
          <span className="font-medium text-gray-900">{p.role}</span>.
        </p>
        <p className="text-sm text-gray-600 mt-3" data-testid="invited-email">
          This invitation is for <span className="font-medium">{p.invitedEmail}</span>. You will need
          to be signed in with that address to accept it.
        </p>

        {!p.usable && (
          <p className="mt-4 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700" data-testid="invitation-unusable">
            {p.status === 'accepted' && 'This invitation has already been used.'}
            {p.status === 'revoked' && 'The garage cancelled this invitation.'}
            {p.status === 'expired' && 'This invitation has expired. Ask the garage for a new one.'}
          </p>
        )}

        {p.usable && !isAuthenticated && (
          <div className="mt-5 space-y-2" data-testid="sign-in-first">
            <p className="text-sm text-gray-700">Sign in or create your CarUp account to accept.</p>
            <div className="flex flex-wrap gap-2">
              {/* The return path is built from this page and its own token — never from a URL
                  parameter, which on a forwarded invitation link is an open redirect. */}
              <Link to={`/login?next=${encodeURIComponent(returnPath)}`}>
                <Button className="min-h-11 bg-orange-500 hover:bg-orange-600" data-testid="go-sign-in">Sign in</Button>
              </Link>
              <Link to={`/register?next=${encodeURIComponent(returnPath)}`}>
                <Button variant="outline" className="min-h-11" data-testid="go-register">Create an account</Button>
              </Link>
            </div>
          </div>
        )}

        {p.usable && isAuthenticated && wrongAccount && (
          <p className="mt-5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900" data-testid="wrong-account">
            You are signed in as {user?.email}, but this invitation was sent to {p.invitedEmail}.
            Sign in with that address to accept it.
          </p>
        )}

        {p.usable && isAuthenticated && !wrongAccount && (
          <div className="mt-5">
            <Button
              className="min-h-11 bg-orange-500 hover:bg-orange-600"
              onClick={accept} disabled={accepting} data-testid="accept-invitation"
            >
              {accepting ? 'Joining…' : `Join ${p.garageName ?? 'this garage'}`}
            </Button>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="accept-error">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
