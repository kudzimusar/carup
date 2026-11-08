import { useEffect, useState } from 'react'
import { ImageIcon } from 'lucide-react'

/**
 * CARUP-DEALER-1.0-VISUAL-UAT-R1 — the approved owner's PRIVATE preview of their own current company
 * image ('profile' or 'cover', pending or approved). Fetched with the owner's session headers from the
 * tenant-scoped endpoint, which is addressed by KIND — never by a media identity (Issue #164 Phase 5).
 * Shown from a blob: URL that is revoked on unmount; never a public URL.
 */
export default function PrivateMediaThumb({ apiBase, kind, headers, alt, className, version = '' }: {
  apiBase: string
  kind: 'profile' | 'cover'
  headers: Record<string, string>
  alt: string
  className?: string
  /** Changes when a new image is uploaded, so the preview reloads. */
  version?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const headerKey = JSON.stringify(headers)
  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    fetch(`${apiBase}/dealer/operational-media/company-image/${kind}`, {
      headers: JSON.parse(headerKey) as Record<string, string>, credentials: 'include', cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status))
      const blob = await response.blob()
      if (!alive) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [apiBase, kind, headerKey, version])
  if (url) return <img src={url} alt={alt} className={className} />
  return (
    <div className={`flex items-center justify-center bg-slate-100 text-slate-400 ${className ?? ''}`} role="img"
      aria-label={failed ? 'Private preview unavailable' : 'Loading private preview'}>
      <ImageIcon className="h-6 w-6" aria-hidden="true" />
    </div>
  )
}
