import { useEffect, useState } from 'react'
import { Bot, FileText, MapPin, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCommunicationProductApi, type CommunicationAiDerivation, type CommunicationMessagePart } from '@/hooks/useCommunicationProductApi'

type Props = {
  threadId: string
  part: CommunicationMessagePart
  onDerived?: (value: CommunicationAiDerivation) => void
}

export function CommunicationMessagePartView({ threadId, part, onDerived }: Props) {
  const { mediaAccess, analyzeMedia } = useCommunicationProductApi()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stored = Boolean(part.storage_key)
  const analyzable = ['image', 'audio', 'video', 'document'].includes(part.part_type) && stored

  useEffect(() => {
    if (!stored || !['image', 'audio', 'video'].includes(part.part_type)) return
    let active = true
    mediaAccess(threadId, part.id)
      .then((response) => { if (active) setUrl(response.access.url) })
      .catch(() => { if (active) setError('Media unavailable') })
    return () => { active = false }
  }, [mediaAccess, part.id, part.part_type, stored, threadId])

  async function openDocument() {
    setError(null)
    try {
      const response = await mediaAccess(threadId, part.id)
      window.open(response.access.url, '_blank', 'noopener,noreferrer')
    } catch {
      setError('Document unavailable')
    }
  }

  async function runAnalysis() {
    setBusy(true)
    setError(null)
    try {
      const response = await analyzeMedia(threadId, part.id)
      onDerived?.(response.derivation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI media analysis unavailable')
    } finally {
      setBusy(false)
    }
  }

  const metadata = part.metadata || {}
  const latitude = Number(metadata.latitude)
  const longitude = Number(metadata.longitude)

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-black/10 bg-white/60 p-2 text-gray-900">
      {part.part_type === 'image' && url && (
        <img src={url} alt={String(metadata.original_name || 'Conversation image')} className="max-h-72 w-full rounded-lg object-contain" />
      )}
      {part.part_type === 'audio' && url && (
        <audio controls src={url} className="w-full" aria-label="Voice or audio message" />
      )}
      {part.part_type === 'video' && url && (
        <video controls src={url} className="max-h-80 w-full rounded-lg" preload="metadata">
          <track kind="captions" />
        </video>
      )}
      {part.part_type === 'document' && (
        <Button type="button" size="sm" variant="outline" onClick={() => void openDocument()}>
          <FileText className="mr-1 h-4 w-4" /> Open secure document
        </Button>
      )}
      {part.part_type === 'location' && Number.isFinite(latitude) && Number.isFinite(longitude) && (
        <a
          href={`https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium"
        >
          <MapPin className="h-4 w-4" /> {String(metadata.label || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)}
        </a>
      )}
      {part.part_type === 'video' && !url && !error && (
        <div className="flex items-center gap-1 text-xs text-gray-500"><PlayCircle className="h-4 w-4" /> Loading secure video…</div>
      )}
      {analyzable && (
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void runAnalysis()}>
          <Bot className="mr-1 h-4 w-4" /> {busy ? 'Analyzing…' : 'Analyze safely'}
        </Button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {part.mime_type && <p className="text-[10px] text-gray-500">{part.mime_type}{part.size_bytes ? ` · ${Math.ceil(Number(part.size_bytes) / 1024)} KB` : ''}</p>}
    </div>
  )
}
