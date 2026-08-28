import { useEffect, useState } from 'react'
import { FileSearch, ScanText, Sparkles } from 'lucide-react'
import { resolveApiBaseUrl } from '@/lib/apiClient'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

type OcrProviderMap = Record<string, boolean>

export function SellerDocumentAutofillNotice() {
  const [providers, setProviders] = useState<OcrProviderMap | null>(null)

  useEffect(() => {
    let active = true
    fetch(API_BASE + '/health')
      .then(async response => {
        if (!response.ok) throw new Error('health unavailable')
        return response.json()
      })
      .then(body => {
        if (!active) return
        setProviders(body?.ocrProviders && typeof body.ocrProviders === 'object' ? body.ocrProviders : {})
      })
      .catch(() => {
        if (active) setProviders({})
      })
    return () => { active = false }
  }, [])

  const enabled = providers ? Object.values(providers).some(Boolean) : false
  const known = providers !== null

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
              <span className={'rounded-full px-2.5 py-1 text-[10px] font-black ' + (
                enabled
                  ? 'bg-emerald-100 text-emerald-700'
                  : known
                    ? 'bg-violet-100 text-violet-700'
                    : 'bg-slate-100 text-slate-500'
              )}>
                {enabled ? 'OCR provider available' : known ? 'Coming soon on this preview' : 'Checking availability…'}
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
