import { useEffect, useState } from 'react'
import { FileSearch, ScanText, Sparkles } from 'lucide-react'
import { resolveApiBaseUrl } from '@/lib/apiClient'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

// The canonical OCR runtime projection from /api/health. Availability is decided by the SELECTED
// OCR provider being configured — NOT by whether some unrelated AI provider (gemini/groq/…) happens
// to hold credentials. `ocrProviders.some(Boolean)` is no longer authoritative: with Cloudflare
// selected but unconfigured and Gemini configured, that old check falsely rendered "available".
type OcrHealth = {
  selectedProvider?: string | null
  selectedModel?: string | null
  configured?: boolean
  mockRuntimeAllowed?: boolean
}

export function SellerDocumentAutofillNotice() {
  const [ocr, setOcr] = useState<OcrHealth | null>(null)
  // A FAILED health read is not an answer about provider availability — it renders as
  // "Availability could not be checked", never as a product claim derived from a network fault.
  const [readFailed, setReadFailed] = useState(false)

  useEffect(() => {
    let active = true
    fetch(API_BASE + '/health')
      .then(async response => {
        if (!response.ok) throw new Error('health unavailable')
        return response.json()
      })
      .then(body => {
        if (!active) return
        // Only the canonical `ocr` projection decides availability. A backend that does not expose
        // it yields {} → not available (safe), never a false "available" from the legacy map.
        setOcr(body?.ocr && typeof body.ocr === 'object' ? body.ocr : {})
      })
      .catch(() => {
        if (active) setReadFailed(true)
      })
    return () => { active = false }
  }, [])

  // Available ONLY when the selected OCR provider is actually configured. Mock reachability never
  // makes the product surface claim availability.
  const enabled = ocr ? ocr.configured === true : false
  const known = ocr !== null

  return (
    <section className="rounded-[2rem] border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-orange-50 p-5 sm:p-6" data-testid="seller-document-autofill">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-violet-600 text-white">
            <ScanText className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black text-slate-950">Smart document scan & autofill</h3>
              <span
                data-testid="seller-autofill-availability"
                className={'rounded-full px-2.5 py-1 text-[10px] font-black ' + (
                  enabled
                    ? 'bg-emerald-100 text-emerald-700'
                    : known
                      ? 'bg-violet-100 text-violet-700'
                      : 'bg-slate-100 text-slate-500'
                )}
              >
                {enabled
                  ? 'OCR provider available'
                  : readFailed
                    ? 'Availability could not be checked'
                    : known
                      ? 'Coming soon on this preview'
                      : 'Checking availability…'}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
              CarUp already has a governed document-extraction and reviewer pipeline. Seller Journey autofill will use that same
              pipeline for registration/logbook, customs and duty papers, auction sheets, inspections and other supported documents
              instead of creating a second OCR system.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <FileSearch className="h-4 w-4 text-violet-600" />
          <p className="mt-2 text-xs font-black">Read candidate fields</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">VIN, year, identifiers, mileage and document-specific fields where supported.</p>
        </div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <p className="mt-2 text-xs font-black">Suggest, never silently overwrite</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">OCR output is a candidate reading. Seller-stated and governed facts remain separate.</p>
        </div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <ScanText className="h-4 w-4 text-violet-600" />
          <p className="mt-2 text-xs font-black">Human/governed review stays authoritative</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">Extraction confidence never auto-approves a vehicle fact or Trust claim.</p>
        </div>
      </div>
    </section>
  )
}
