import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getVerificationStatusMeta } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { buildLoginRedirect } from '@/lib/returnTo'

type ApplicantSession = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchApplicantVerificationStatus']>>

export default function KYCVerification() {
  const { isAuthenticated, loading: checkingAuth, token } = useAuth()
  const { fetchApplicantVerificationStatus } = useCarUpApi()
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ token: typeof token; refresh: number; session?: ApplicantSession }>()

  useEffect(() => {
    if (checkingAuth || !isAuthenticated) return
    const controller = new AbortController()
    fetchApplicantVerificationStatus(controller.signal).then(
      session => {
        if (!controller.signal.aborted) setResult({ token, refresh, session })
      },
      () => {
        if (!controller.signal.aborted) setResult({ token, refresh })
      },
    )
    return () => controller.abort()
  }, [checkingAuth, isAuthenticated, token, refresh, fetchApplicantVerificationStatus])

  const current = result?.token === token && result?.refresh === refresh ? result : undefined
  const session = current?.session
  const status = session?.status
  const phase = session?.workflow_phase
  const statusMeta = status === 'ocr_pending' ? getVerificationStatusMeta('processing')
    : status === 'captured' || status === 'uploaded' ? getVerificationStatusMeta('draft')
      : status ? getVerificationStatusMeta(status) : null
  const message = status === 'retry_requested' ? session?.retry_reason : status === 'rejected' ? session?.applicant_message : null

  return (
    <section aria-labelledby="identity-verification-title" className="mx-auto max-w-xl px-4 py-10">
      <Card>
        <CardContent className="space-y-4 p-6">
          <h1 id="identity-verification-title" className="text-2xl font-semibold">Identity verification</h1>
          {checkingAuth && <p role="status">Checking sign-in status…</p>}
          {!checkingAuth && !isAuthenticated && (
            <Button asChild><Link to={buildLoginRedirect('/kyc')}>Sign in to check your status</Link></Button>
          )}
          {!checkingAuth && isAuthenticated && (
            <>
              {!current ? <p role="status">Loading verification status…</p>
                : current.session === undefined ? <p role="alert">Verification status is unavailable. Try refreshing.</p>
                  : !session ? <p>Start identity verification in the CarUp app using this account.</p>
                    : (
                      <div className="space-y-2" aria-live="polite">
                        <h2 className="font-medium">{phase === 'escalated' ? 'Specialist review' : statusMeta?.label}</h2>
                        <p>{phase === 'escalated' ? 'Your case is awaiting specialist review.' : statusMeta?.description}</p>
                        {message && <p>{message}</p>}
                        {status === 'retry_requested' && <p>Open the CarUp app to replace the requested evidence.</p>}
                      </div>
                    )}
              <Button variant="outline" disabled={!current} onClick={() => setRefresh(value => value + 1)}>Refresh status</Button>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
