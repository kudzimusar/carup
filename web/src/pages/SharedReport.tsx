import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Loader2, LinkIcon, FileQuestion, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import VehicleHistoryReport from '@/components/VehicleHistoryReport'
import { Button } from '@/components/ui/button'
import type { SharedReportResult } from '@/types'
import { isShowroomPagesEnabled } from '@/lib/presentationFlags'
import { DataState } from '@/components/truth'

/**
 * Public shared Vehicle History Report (M4). Path: /reports/shared/:token.
 *
 * Resolves a snapshotted report version via its share token with no authentication.
 * Renders the full report on success, and friendly, distinct states for an expired or
 * revoked link (HTTP 410) and a missing token (HTTP 404).
 */

function CenteredState({
  icon: Icon,
  iconClass,
  title,
  message,
}: {
  icon: typeof FileQuestion
  iconClass: string
  title: string
  message: string
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center text-center" role="status" data-testid="shared-report-state">
      <span className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full ${iconClass}`} aria-hidden="true">
        <Icon className="h-8 w-8" />
      </span>
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/marketplace">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Back to marketplace
        </Link>
      </Button>
    </div>
  )
}

export default function SharedReport() {
  const { token } = useParams<{ token: string }>()
  const { fetchSharedReport } = useCarUpApi()
  const [result, setResult] = useState<SharedReportResult | null>(null)
  // Loading starts true only when there is a token to fetch. The "no token" case is handled
  // in render, so the effect never needs a synchronous setState (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(() => Boolean(token))

  useEffect(() => {
    if (!token) return
    let mounted = true
    fetchSharedReport(token)
      .then((res) => {
        if (mounted) setResult(res)
      })
      .catch(() => {
        if (mounted) setResult({ status: 'error', message: 'Unable to load shared report.' })
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [token, fetchSharedReport])

  if (isShowroomPagesEnabled()) {
    const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'
    const state = !token ? 'not_found' : loading || !result ? 'loading' : result.status
    const notice = (title: string, message: string, tone: 'neutral' | 'warning' | 'danger') => (
      <section className="mx-auto max-w-xl rounded-3xl bg-carup-bg-surface px-6 py-12 text-center sm:px-10" role="status" data-testid="shared-report-state">
        <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${tone === 'warning' ? 'bg-status-warning-soft text-status-warning' : tone === 'danger' ? 'bg-status-danger-soft text-status-danger' : 'bg-white text-carup-text-2'}`} aria-hidden="true">
          {tone === 'warning' ? <LinkIcon className="h-7 w-7" /> : tone === 'danger' ? <AlertTriangle className="h-7 w-7" /> : <FileQuestion className="h-7 w-7" />}
        </span>
        <h1 className="mt-5 text-[22px] font-bold tracking-[-0.02em]">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-6 text-carup-text-2">{message}</p>
        <Link to="/marketplace" className={`mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-carup-raw-ink px-5 text-[15px] font-semibold text-white hover:bg-carup-raw-ink-2 ${FOCUS}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Browse the Marketplace
        </Link>
      </section>
    )
    return (
      <div className="min-h-screen bg-white text-carup-raw-ink" data-presentation="rx04">
        <div className="section-padding mx-auto max-w-[1100px] py-8 sm:py-12">
          {state === 'loading' ? (
            <div data-testid="shared-report-loading"><DataState state="loading" subject="Shared report" /></div>
          ) : state === 'ok' && result?.status === 'ok' ? (
            <>
              <header className="mb-8 border-b border-carup-line pb-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-carup-action">Shared Vehicle History Report</p>
                <p className="mt-2 max-w-2xl text-[15px] leading-6 text-carup-text-2">
                  Someone shared this CarUp report with you. It is a snapshot taken when the link was made; check the live listing before you decide.
                </p>
              </header>
              <VehicleHistoryReport report={result.data.report} generatedAt={result.data.generated_at} correctionNotice={result.data.correction_notice} />
            </>
          ) : state === 'gone' && result?.status === 'gone' ? (
            notice('This link is no longer available', result.reason || 'The person who shared this report has let the link expire or revoked it. Ask them for a fresh link.', 'warning')
          ) : state === 'not_found' ? (
            notice('Report not found', 'We could not find a shared report for this link. Check the address, or ask for a new link.', 'neutral')
          ) : (
            notice('Something went wrong', (result && 'message' in result && result.message) || 'This shared report could not load right now. Please try again later.', 'danger')
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="section-padding mx-auto max-w-[1100px] py-10">
        {!token ? (
          <div className="py-24">
            <CenteredState
              icon={FileQuestion}
              iconClass="bg-gray-100 text-gray-500"
              title="Report not found"
              message="We could not find a shared report for this link. Please check the URL or request a new link."
            />
          </div>
        ) : loading || !result ? (
          <div className="flex flex-col items-center py-24 text-gray-400" data-testid="shared-report-loading">
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
            <p className="mt-3 text-sm">Loading shared report…</p>
          </div>
        ) : result.status === 'ok' ? (
          <VehicleHistoryReport
            report={result.data.report}
            generatedAt={result.data.generated_at}
            correctionNotice={result.data.correction_notice}
          />
        ) : result.status === 'gone' ? (
          <div className="py-24">
            <CenteredState
              icon={LinkIcon}
              iconClass="bg-amber-100 text-amber-600"
              title="This link is no longer available"
              message={
                result.reason ||
                'This shared report link has expired or been revoked by the person who shared it. Ask them for a fresh link.'
              }
            />
          </div>
        ) : result.status === 'not_found' ? (
          <div className="py-24">
            <CenteredState
              icon={FileQuestion}
              iconClass="bg-gray-100 text-gray-500"
              title="Report not found"
              message="We could not find a shared report for this link. Please check the URL or request a new link."
            />
          </div>
        ) : (
          <div className="py-24">
            <CenteredState
              icon={AlertTriangle}
              iconClass="bg-red-100 text-red-600"
              title="Something went wrong"
              message={result.message || 'Unable to load this shared report right now. Please try again later.'}
            />
          </div>
        )}
      </div>
    </div>
  )
}
