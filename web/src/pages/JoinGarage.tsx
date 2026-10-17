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
 * GMO-6 — the page an invited person lands on (ported by OC-5E from PR #209).
 *
 * Most people arriving here have never used CarUp, so it answers before asking anything: which
 * garage, what role, and which email address they must use (and verify).
 *
 * OC-5E, beyond #209:
 *   - the way back from sign-in is `returnTo` — the parameter Login and Register actually read. #209
 *     linked `?next=`, which nothing reads, so an invitee who signed in never came back here. The
 *     path is this page with its own token (same-origin by construction; `resolvePostLoginRoute`
 *     refuses anything else);
 *   - after joining, the person is taken INTO the garage: the new membership is selected (the server
 *     verifies it), the session is re-read, and only then the Workshop opens. #209 sent them to the
 *     owner dashboard, assuming a login would pick the garage — on this lineage nothing guesses.
 */
export default function JoinGarage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { isAuthenticated, user, selectActiveTenant, refreshSession } = useAuth()
  const { peekGarageInvitation, acceptGarageInvitation } = useCarUpApi()
  const navigate = useNavigate()

  const [peek, setPeek] = useState<Peek | null>(null)
  // A missing token is knowable at render time, so it is the INITIAL state.
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>(token ? 'loading' : 'invalid')
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token) return
    peekGarageInvitation(token)
      .then((res) => { setPeek(res as unknown as Peek); setState('ready') })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : ''
        // "This link is not valid" and "we could not check the link" are different facts: a person
        // who was genuinely invited must not be told their invitation is fake.
        setState(/not valid/i.test(msg) ? 'invalid' : 'error')
      })
  }, [token, peekGarageInvitation])

  useEffect(() => { load() }, [load])

  /** Same-origin by construction: this page, with the token it already holds. */
  const returnPath = `/join-garage?token=${encodeURIComponent(token)}`

  async function accept() {
    setAccepting(true); setError(null)
    try {
      const result = await acceptGarageInvitation(token)
      const tenantId = typeof result?.tenantId === 'string' ? result.tenantId : null
      if (!tenantId) throw new Error('The garage did not confirm your membership. Try again.')
      // Into the garage they just joined — selected, verified by the server, then the session re-read.
      await selectActiveTenant(tenantId)
      await refreshSession()
      navigate('/garage')
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'This invitation could not be accepted.')
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
          <p className="text-sm text-gray-600 mt-1">Ask the garage to send you a new one.</p>
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center" data-testid="invitation-error">
          <p className="font-medium text-gray-900">We could not check this invitation just now.</p>
          <p className="text-sm text-gray-600 mt-1">This is a loading problem — it does not mean your invitation is not real.</p>
          <Button variant="outline" className="min-h-11 mt-3" onClick={() => { setState('loading'); load() }}>Try again</Button>
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
        <h1 className="text-2xl font-semibold text-gray-900 mt-3">{p.garageName ?? 'A garage'} has invited you</h1>
        <p className="text-gray-600 mt-2">
          {p.invitedName ? `${p.invitedName}, you` : 'You'} have been invited to join{' '}
          <span className="font-medium text-gray-900">{p.garageName ?? 'this garage'}</span> as a{' '}
          <span className="font-medium text-gray-900">{p.role}</span>.
        </p>
        <p className="text-sm text-gray-600 mt-3" data-testid="invited-email">
          This invitation is for <span className="font-medium">{p.invitedEmail}</span>. You need to be signed in
          with that address, and to have verified it, to accept.
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
              <Link to={`/login?returnTo=${encodeURIComponent(returnPath)}`} data-testid="go-sign-in">
                <Button className="min-h-11 bg-orange-500 hover:bg-orange-600">Sign in</Button>
              </Link>
              <Link to={`/register?returnTo=${encodeURIComponent(returnPath)}`} data-testid="go-register">
                <Button variant="outline" className="min-h-11">Create an account</Button>
              </Link>
            </div>
          </div>
        )}

        {p.usable && isAuthenticated && wrongAccount && (
          <p className="mt-5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900" data-testid="wrong-account">
            You are signed in as {user?.email}, but this invitation was sent to {p.invitedEmail}. Sign in with
            that address to accept it.
          </p>
        )}

        {p.usable && isAuthenticated && !wrongAccount && (
          <div className="mt-5">
            <Button className="min-h-11 bg-orange-500 hover:bg-orange-600" onClick={accept} disabled={accepting} data-testid="accept-invitation">
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
