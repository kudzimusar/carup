import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'

type RequestType = 'CORRECTION' | 'REMOVAL' | 'BUSINESS_CLOSED' | 'IDENTITY_DISPUTE'
const API = resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window === 'undefined' ? undefined : window.location.hostname)

/** Public, low-trust correction intake. Never automatically suppresses any legal business. */
export default function DealerResearchCorrection() {
  const { seedId } = useParams<{seedId: string}>()
  const validId = /^ZW-DEAL-\d{4}$/.test((seedId || '').toUpperCase())
  const [requestType, setRequestType] = useState<RequestType>('CORRECTION')
  const [summary, setSummary] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [phase, setPhase] = useState<'draft'|'sending'|'submitted'>('draft')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validId || phase === 'sending') return
    setPhase('sending')
    setError('')
    try {
      await apiRequest({
        baseUrl: API,
        path: '/dealership/research/' + encodeURIComponent((seedId || '').toUpperCase()) + '/corrections',
        options: {
          method: 'POST',
          body: JSON.stringify({
            request_type: requestType, request_summary: summary,
            contact_email: contactEmail || null,
          }),
        },
      })
      setPhase('submitted')
    } catch (problem) {
      setPhase('draft')
      setError(problem instanceof Error ? problem.message : 'Correction could not be submitted')
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 section-padding">
      <div className="max-w-xl mx-auto py-10">
        <Link className="text-blue-700 underline underline-offset-4 text-sm" to="/dealers">
          Back to dealership directory
        </Link>
        <Card className="mt-6">
          <CardContent className="p-6">
            <h1 className="font-bold text-2xl">Correct or request removal of a researched listing</h1>
            <p className="mt-3 text-sm text-gray-600">
              CarUp reviews correction, closure, identity-dispute and removal requests.
              A request does not prove business ownership or automatically change a public record.
              A reviewer can suppress inaccurate information after independent assessment.
            </p>
            {!validId ? <p role="alert" className="mt-4">Invalid dealership research reference.</p>
              : phase === 'submitted' ? (
                <div role="status" className="mt-6 bg-slate-50 border p-4 rounded-md">
                  Your request is recorded for private human review. No publication change is asserted.
                </div>
              ) : (
                <form onSubmit={submit} className="mt-6 space-y-4">
                  <p className="text-sm text-gray-500">Research reference: {(seedId || '').toUpperCase()}</p>
                  <div>
                    <label htmlFor="research-correction-kind" className="text-sm font-medium block mb-1">Request category</label>
                    <select id="research-correction-kind" className="w-full border rounded-md p-2"
                      value={requestType} onChange={e => setRequestType(e.target.value as RequestType)}>
                      <option value="CORRECTION">Correct inaccurate business information</option>
                      <option value="REMOVAL">Request listing removal</option>
                      <option value="BUSINESS_CLOSED">Business is closed or no longer operating</option>
                      <option value="IDENTITY_DISPUTE">Business identity or branch ownership disputed</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="research-correction-summary" className="text-sm font-medium block mb-1">
                      Information requiring review
                    </label>
                    <textarea id="research-correction-summary" className="w-full border rounded-md p-3 min-h-32"
                      required minLength={30} maxLength={2000} value={summary}
                      onChange={e => setSummary(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="research-correction-email" className="text-sm font-medium block mb-1">
                      Contact email (optional, private)
                    </label>
                    <Input id="research-correction-email" type="email" maxLength={200} value={contactEmail}
                      onChange={e => setContactEmail(e.target.value)} />
                  </div>
                  <p className="text-xs text-gray-500">
                    Do not post government IDs, bank details or scanned documents in this text form.
                    Any original documents must use a separate secure evidence-intake process.
                  </p>
                  {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                  <Button disabled={phase === 'sending'} type="submit">
                    {phase === 'sending' ? 'Submitting…' : 'Submit private review request'}
                  </Button>
                </form>
              )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
