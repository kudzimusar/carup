import { useEffect, useState } from 'react'
import { Link, useParams, useLocation } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, QrCode, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { INVALID_LINK, UNREADABLE_LINK, presentLink, type LinkPresentation, type ResolvedLink } from '@/lib/serviceLink'

/**
 * `/s/:token` — where every CarUp QR code lands (R8).
 *
 * Owner UAT: the backend resolved service links correctly and the web app had no route for them, so
 * every code in the product opened the 404 page. This page exists so a scan reaches something.
 *
 * It decides nothing. `/api/service-links/:publicToken` decides who may see what; this page renders
 * that decision and offers the one next step it names. A refusal is shown as a refusal — never
 * softened, and never turned into an invalid-link message, because "not yours" and "not real" are
 * different facts and a person deserves to know which one they hit.
 */
export default function ServiceLink() {
  const { token } = useParams<{ token: string }>()
  const location = useLocation()
  const { user } = useAuth()
  const { resolveServiceLink } = useCarUpApi()

  const [presentation, setPresentation] = useState<LinkPresentation | null>(null)
  const [loading, setLoading] = useState(true)

  // A garage member and the requester are the two sides of a job and belong in different products.
  const viewerIsGarageMember = Boolean(user?.active_tenant_id)
  const returnTo = `${location.pathname}${location.search}`

  useEffect(() => {
    let mounted = true
    if (!token) {
      setPresentation(INVALID_LINK)
      setLoading(false)
      return
    }
    setLoading(true)
    resolveServiceLink(token)
      .then((resolved: ResolvedLink) => {
        if (!mounted) return
        setPresentation(presentLink(resolved, { returnTo, viewerIsGarageMember }))
      })
      .catch((err: unknown) => {
        if (!mounted) return
        // The resolver answers 404 for revoked, expired and never-existed alike, and that is
        // deliberate — it must not become an oracle. Anything else is OUR failure, and saying
        // "invalid link" for a network fault would blame the person holding a perfectly good code.
        const message = err instanceof Error ? err.message : ''
        setPresentation(/not valid|not found/i.test(message) ? INVALID_LINK : UNREADABLE_LINK)
      })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [token, resolveServiceLink, returnTo, viewerIsGarageMember])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-0 card-shadow">
        <CardContent className="p-6 sm:p-8">
          {loading && (
            <div className="flex flex-col items-center text-center gap-3 py-8" role="status" aria-live="polite">
              <Loader2 className="w-7 h-7 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
              <p className="text-sm text-gray-600">Checking this link…</p>
            </div>
          )}

          {!loading && presentation && (
            <div className="text-center" data-testid="service-link-result" data-tone={presentation.tone}>
              <div className={`w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center ${
                presentation.tone === 'safe' ? 'bg-orange-100' : 'bg-gray-100'
              }`}>
                {presentation.tone === 'safe'
                  ? <QrCode className="w-6 h-6 text-orange-600" aria-hidden="true" />
                  : <ShieldAlert className="w-6 h-6 text-gray-500" aria-hidden="true" />}
              </div>

              <h1 className="text-xl font-semibold text-gray-900" data-testid="service-link-title">
                {presentation.title}
              </h1>
              <p className="text-sm text-gray-600 mt-2" data-testid="service-link-body">
                {presentation.body}
              </p>

              {presentation.action && (
                <Link to={presentation.action.to} className="block mt-6">
                  <Button className="w-full min-h-11 bg-orange-500 hover:bg-orange-600" data-testid="service-link-action">
                    {presentation.action.label}
                  </Button>
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
