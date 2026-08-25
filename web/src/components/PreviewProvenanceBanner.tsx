/**
 * Renders the candidate-provenance verdict — Issue #164 Phase 8, Cluster I.
 *
 * Only ever appears on a per-branch preview, and only when the pairing is NOT verifiably correct. A
 * correctly paired preview renders nothing, so UAT screenshots show the product rather than this
 * banner. The receipt script (`scripts/issue164-uat-provenance-receipt.mjs`) is what positively
 * confirms a good pairing before a run starts.
 *
 * It is deliberately not dismissable. The fault it reports — a preview quietly serving one candidate's
 * frontend against another candidate's backend — already cost one full 32-step physical UAT.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import {
  evaluateProvenance,
  fetchBackendProvenance,
  readBuildSha,
  type ProvenanceVerdict,
} from '@/lib/previewProvenance'

export default function PreviewProvenanceBanner() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined
  const apiBaseUrl = resolveApiBaseUrl(import.meta.env?.VITE_API_URL as string | undefined, hostname)
  const buildSha = readBuildSha()

  // Two of the verdicts are decidable without a network call, and must be: a `not_applicable` host
  // must never emit a request, and an `unpaired` build has no backend to ask. `evaluateProvenance` is
  // pure, so deriving this during render costs nothing and keeps the effect free of synchronous state.
  const syncVerdict = evaluateProvenance({ hostname, apiBaseUrl, buildSha })
  const needsBackendCheck = syncVerdict.status !== 'not_applicable' && syncVerdict.status !== 'unpaired'
  const [checkedVerdict, setCheckedVerdict] = useState<ProvenanceVerdict | null>(null)

  useEffect(() => {
    if (!needsBackendCheck) return
    let mounted = true
    void fetchBackendProvenance(apiBaseUrl).then((backend) => {
      if (!mounted) return
      setCheckedVerdict(evaluateProvenance({
        hostname,
        apiBaseUrl,
        buildSha,
        backendSha: backend.sha,
        healthReadFailed: backend.failed,
      }))
    })
    return () => { mounted = false }
  }, [needsBackendCheck, apiBaseUrl, hostname, buildSha])

  // While the backend check is in flight there is no verdict yet — render nothing rather than briefly
  // accusing a correctly-paired preview of being unverifiable.
  const verdict = needsBackendCheck ? checkedVerdict : syncVerdict
  if (!verdict || !verdict.blocksUat) return null

  return (
    <div
      role="alert"
      data-testid="preview-provenance-banner"
      data-provenance-status={verdict.status}
      className="fixed inset-x-0 top-0 z-[9999] border-b-2 border-amber-500 bg-amber-50 px-4 py-3 text-amber-950 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{verdict.headline}</p>
          <p className="mt-0.5 text-sm leading-snug break-words">{verdict.detail}</p>
        </div>
      </div>
    </div>
  )
}
