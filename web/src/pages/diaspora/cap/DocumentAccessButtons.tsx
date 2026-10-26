import { useState } from 'react'
import { Download, Eye, Loader2 } from 'lucide-react'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'
import { documentActionLabel } from '../capDisplay'

/**
 * Open one of MY documents (T11-CAP-LR01-R2 step H).
 *
 * The server decides who may; holding an id grants nothing. A button asks for a five-minute link only when it is pressed, opens it in a new tab
 * (view) or starts the download (download), and says plainly when it could not. The link is never stored, shown, or logged here, and a refusal is
 * worded as "could not be opened" — the server answers the same for a document that does not exist and one that is not yours.
 */
export function DocumentAccessButtons({ documentId, displayName }: { documentId: string; displayName: string }) {
  const { getDocumentAccess } = useTradeLogisticsApi()
  const [busy, setBusy] = useState<'view' | 'download' | null>(null)
  const [failed, setFailed] = useState(false)

  const open = async (kind: 'view' | 'download') => {
    if (busy) return
    setBusy(kind)
    setFailed(false)
    try {
      const access = await getDocumentAccess(documentId, kind)
      const href = access?.view?.href
      if (typeof href !== 'string' || !/^https:\/\//i.test(href)) throw new Error('no link')
      if (kind === 'view') {
        // Open on the user's gesture so a pop-up blocker does not swallow it; the link is a capability for the user, never for the opened page.
        window.open(href, '_blank', 'noopener,noreferrer')
      } else {
        const a = document.createElement('a')
        a.href = href
        a.rel = 'noopener noreferrer'
        a.download = ''
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  const base = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-60'
  return (
    <div className="mt-2 min-w-0" data-testid={`cap-document-actions-${documentId}`}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={base} onClick={() => void open('view')} disabled={busy !== null} aria-label={documentActionLabel(displayName, 'view')} data-testid={`cap-document-view-${documentId}`}>
          {busy === 'view' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}View
        </button>
        <button type="button" className={base} onClick={() => void open('download')} disabled={busy !== null} aria-label={documentActionLabel(displayName, 'download')} data-testid={`cap-document-download-${documentId}`}>
          {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}Download
        </button>
      </div>
      {failed ? <p className="mt-1 min-w-0 break-words text-xs text-amber-900" role="status" data-testid={`cap-document-failed-${documentId}`}>This document could not be opened right now. Please try again.</p> : null}
    </div>
  )
}
