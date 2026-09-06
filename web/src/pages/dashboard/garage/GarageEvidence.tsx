import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Trash2, Eye, Sparkles } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  GARAGE_EVIDENCE_TYPES, evidenceTypeLabel, extractionPresentation,
  type EvidenceDocument,
} from '@/lib/garageOnboarding'

const TONE_CLASS = {
  neutral: 'bg-gray-100 text-gray-700',
  waiting: 'bg-amber-100 text-amber-800',
  action: 'bg-orange-100 text-orange-800',
  good: 'bg-green-100 text-green-800',
} as const

const MAX_BYTES = 15 * 1024 * 1024

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '')
    reader.onerror = () => reject(new Error('That file could not be read from your device.'))
    reader.readAsDataURL(file)
  })
}

/**
 * GMO-2 — the applicant's evidence.
 *
 * PO-2 asks for "at least one credible business-presence evidence source" and forbids requiring
 * incorporation. So this surface leads with a photo of the workshop, and never implies that a
 * garage without company papers is a lesser garage.
 *
 * Automatic reading is offered where it can help and is described honestly where it cannot. The
 * page never presents an extraction problem as an application problem, and never writes a machine's
 * guess into the form — the applicant copies a value across only by pressing the button that says
 * so, which is the same explicit act as typing it.
 */
export default function GarageEvidence({
  applicationId, editable, onChanged, onUseValue,
}: {
  applicationId: string
  editable: boolean
  onChanged?: (count: number) => void
  onUseValue?: (field: string, value: string) => void
}) {
  const {
    listGarageEvidence, uploadGarageEvidence, removeGarageEvidence,
    extractGarageEvidence, acknowledgeGarageEvidence, previewGarageEvidence,
  } = useCarUpApi()

  const [documents, setDocuments] = useState<EvidenceDocument[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [evidenceType, setEvidenceType] = useState<string>('premises_photo')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [workingOn, setWorkingOn] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const load = useCallback(() => {
    listGarageEvidence(applicationId)
      .then((res: { documents?: EvidenceDocument[] }) => {
        const docs = res?.documents ?? []
        setDocuments(docs)
        setState('ready')
        onChanged?.(docs.length)
      })
      // A failed read is a loading problem. It must never render as "you have uploaded nothing".
      .catch(() => setState('error'))
  }, [applicationId, listGarageEvidence, onChanged])

  useEffect(() => { load() }, [load])

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 15MB. A photo taken on your phone is usually fine.')
      return
    }
    setUploading(true); setError(null)
    try {
      const file_base64 = await readAsBase64(file)
      await uploadGarageEvidence(applicationId, {
        evidence_type: evidenceType,
        description: description.trim() || undefined,
        mime_type: file.type,
        file_base64,
      })
      setDescription('')
      if (fileInput.current) fileInput.current.value = ''
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That upload did not go through. Nothing was lost — try again.')
    } finally { setUploading(false) }
  }

  async function act(id: string, fn: () => Promise<unknown>, fallback: string) {
    setWorkingOn(id); setError(null)
    try { await fn(); load() }
    catch (e) { setError(e instanceof Error ? e.message : fallback) }
    finally { setWorkingOn(null) }
  }

  async function preview(id: string) {
    setWorkingOn(id); setError(null)
    try {
      const res = await previewGarageEvidence(applicationId, id)
      if (res?.url) window.open(res.url, '_blank', 'noopener,noreferrer')
      else setError('That preview link could not be created.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That preview link could not be created.')
    } finally { setWorkingOn(null) }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-600" role="status" aria-live="polite">
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
        Loading what you have uploaded…
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm" data-testid="evidence-error">
        <p className="font-medium text-gray-900">We could not load your uploads just now.</p>
        <p className="text-gray-600 mt-1">
          This is a loading problem — it does not mean your documents are missing.
        </p>
        <Button variant="outline" size="sm" className="min-h-11 mt-3" onClick={() => { setState('loading'); load() }}>
          Try again
        </Button>
      </div>
    )
  }

  const docs = documents ?? []

  return (
    <section className="space-y-4" data-testid="evidence-section" aria-labelledby="evidence-heading">
      <div>
        <h3 id="evidence-heading" className="font-medium text-gray-900">Show us your garage is real</h3>
        <p className="text-sm text-gray-600 mt-1">
          Add at least one thing. A photo of your workshop or your sign is enough — you do not need a
          registered company to work with CarUp.
        </p>
      </div>

      {editable && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3" data-testid="evidence-upload">
          <div>
            <label htmlFor="evidence-type" className="block text-sm font-medium text-gray-700 mb-1">
              What are you adding?
            </label>
            <select
              id="evidence-type" data-testid="evidence-type"
              value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px] bg-white"
            >
              {GARAGE_EVIDENCE_TYPES.map(([value, label, hint]) => (
                <option key={value} value={value}>{label} — {hint}</option>
              ))}
            </select>
          </div>

          {evidenceType === 'other' && (
            <div>
              <label htmlFor="evidence-description" className="block text-sm font-medium text-gray-700 mb-1">
                Tell us what this is
              </label>
              <input
                id="evidence-description" data-testid="evidence-description"
                value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
                placeholder="For example: a letter from the property owner"
              />
            </div>
          )}

          <div>
            <label htmlFor="evidence-file" className="block text-sm font-medium text-gray-700 mb-1">
              Choose a photo or PDF
            </label>
            <input
              ref={fileInput} id="evidence-file" data-testid="evidence-file" type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }}
              disabled={uploading}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-white file:min-h-[44px] disabled:opacity-60"
            />
            <p className="text-xs text-gray-500 mt-1">Up to 15MB. A photo from your phone is fine.</p>
          </div>

          {uploading && (
            <p className="flex items-center gap-2 text-sm text-gray-600" role="status" aria-live="polite" data-testid="evidence-uploading">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Uploading…
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="evidence-action-error">
          {error}
        </p>
      )}

      {docs.length === 0 ? (
        <p className="text-sm text-gray-600 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center" data-testid="evidence-empty">
          Nothing added yet.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="evidence-list">
          {docs.map((doc) => {
            const p = extractionPresentation(doc)
            const busy = workingOn === doc.id
            const candidates = doc.extraction_candidates ?? {}
            const usable = Object.entries(candidates).filter(([, c]) => c?.state === 'machine_candidate' && c.value)
            return (
              <li key={doc.id} className="rounded-lg border border-gray-200 bg-white p-4" data-testid="evidence-item">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{evidenceTypeLabel(doc.evidence_type)}</p>
                    {doc.description && <p className="text-sm text-gray-600 truncate">{doc.description}</p>}
                  </div>
                  <Badge className={TONE_CLASS[p.tone]} data-testid="evidence-state">{p.label}</Badge>
                </div>

                <p className="text-sm text-gray-600 mt-2" data-testid="evidence-detail">{p.detail}</p>

                {p.showCandidates && usable.length > 0 && (
                  <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2" data-testid="evidence-candidates">
                    <p className="text-xs font-medium text-gray-700 uppercase tracking-wide">
                      What we read from this document
                    </p>
                    {usable.map(([field, c]) => (
                      <div key={field} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-gray-900">
                          <span className="text-gray-500">{field.replace(/_/g, ' ')}: </span>{c.value}
                        </span>
                        {editable && onUseValue && (
                          <Button className="min-h-11"
                            variant="outline" size="sm" data-testid="evidence-use-value"
                            onClick={() => onUseValue(field, String(c.value))}
                          >
                            Use this
                          </Button>
                        )}
                      </div>
                    ))}
                    <p className="text-xs text-gray-500">
                      These are suggestions from the document. Nothing is filled in until you press “Use this”.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-3">
                  {doc.has_file && (
                    <Button className="min-h-11" variant="outline" size="sm" onClick={() => preview(doc.id)} disabled={busy} data-testid="evidence-preview">
                      <Eye className="w-4 h-4 mr-1" aria-hidden="true" /> View
                    </Button>
                  )}
                  {editable && doc.extraction_state === 'not_attempted' && (
                    <Button className="min-h-11"
                      variant="outline" size="sm" disabled={busy} data-testid="evidence-extract"
                      onClick={() => act(doc.id, () => extractGarageEvidence(applicationId, doc.id), 'We could not try to read that document.')}
                    >
                      <Sparkles className="w-4 h-4 mr-1" aria-hidden="true" /> Try to read it for me
                    </Button>
                  )}
                  {editable && p.showCandidates && doc.extraction_state !== 'confirmed' && (
                    <Button className="min-h-11"
                      variant="outline" size="sm" disabled={busy} data-testid="evidence-acknowledge"
                      onClick={() => act(doc.id, () => acknowledgeGarageEvidence(applicationId, doc.id), 'That confirmation was not recorded.')}
                    >
                      I have checked these
                    </Button>
                  )}
                  {editable && (
                    <Button
                      variant="outline" size="sm" disabled={busy} data-testid="evidence-remove"
                      className="min-h-11 text-red-700 hover:text-red-800"
                      onClick={() => act(doc.id, () => removeGarageEvidence(applicationId, doc.id), 'That document was not removed.')}
                    >
                      <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" /> Remove
                    </Button>
                  )}
                  {busy && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-gray-400 self-center" aria-hidden="true" />}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!editable && docs.length > 0 && (
        <p className="text-xs text-gray-500" data-testid="evidence-locked">
          Your application is with CarUp, so these cannot be changed right now.
        </p>
      )}

    </section>
  )
}
