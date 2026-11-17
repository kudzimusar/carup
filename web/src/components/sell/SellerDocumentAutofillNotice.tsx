import { useEffect, useState } from 'react'
import { FileSearch, ScanText, Sparkles } from 'lucide-react'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { skin } from '@/lib/unifiedSkin'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

type OcrProviderMap = Record<string, boolean>

export function SellerDocumentAutofillNotice() {
  const [providers, setProviders] = useState<OcrProviderMap | null>(null)
  // A FAILED health read is not an answer about provider availability. It used to be written as
  // `setProviders({})`, which made `known` true and `enabled` false — so an unreachable backend
  // rendered "Coming soon on this preview", a claim about the PRODUCT derived from a network fault.
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
        setProviders(body?.ocrProviders && typeof body.ocrProviders === 'object' ? body.ocrProviders : {})
      })
      .catch(() => {
        if (active) setReadFailed(true)
      })
    return () => { active = false }
  }, [])

  const enabled = providers ? Object.values(providers).some(Boolean) : false
  const known = providers !== null

  return (
    <section className={skin('rounded-[2rem] border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-orange-50 p-5 sm:p-6', 'rounded-[2rem] border border-status-info bg-gradient-to-br from-status-info-soft via-white to-carup-action-soft p-5 sm:p-6')} data-testid="seller-document-autofill">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={skin('grid h-11 w-11 flex-none place-items-center rounded-2xl bg-violet-600 text-white', 'grid h-11 w-11 flex-none place-items-center rounded-2xl bg-status-info text-carup-action-on')}>
            <ScanText className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={skin('text-sm font-black text-slate-950', 'text-sm font-bold text-carup-text')}>Smart document scan & autofill</h3>
              <span
                data-testid="seller-autofill-availability"
                className={skin('rounded-full px-2.5 py-1 text-[10px] font-black ', 'rounded-full px-2.5 py-1 text-[10px] font-bold') + (
                  enabled
                    ? skin('bg-emerald-100 text-emerald-700', 'bg-status-success-soft text-status-success')
                    : known
                      ? skin('bg-violet-100 text-violet-700', 'bg-status-info-soft text-status-info')
                      : skin('bg-slate-100 text-slate-500', 'bg-carup-bg-surface-2 text-carup-text-2')
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
            <p className={skin('mt-2 max-w-2xl text-xs leading-5 text-slate-600', 'mt-2 max-w-2xl text-xs leading-5 text-carup-text-2')}>
              CarUp already has a governed document-extraction and reviewer pipeline. Seller Journey autofill will use that same
              pipeline for registration/logbook, customs and duty papers, auction sheets, inspections and other supported documents
              instead of creating a second OCR system.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className={skin('rounded-2xl bg-white p-3 ring-1 ring-slate-200', 'rounded-2xl bg-carup-bg-raised p-3 ring-1 ring-carup-line')}>
          <FileSearch className={skin('h-4 w-4 text-violet-600', 'h-4 w-4 text-status-info')} />
          <p className={skin('mt-2 text-xs font-black', 'mt-2 text-xs font-bold')}>Read candidate fields</p>
          <p className={skin('mt-1 text-[11px] leading-4 text-slate-500', 'mt-1 text-[11px] leading-4 text-carup-text-2')}>VIN, year, identifiers, mileage and document-specific fields where supported.</p>
        </div>
        <div className={skin('rounded-2xl bg-white p-3 ring-1 ring-slate-200', 'rounded-2xl bg-carup-bg-raised p-3 ring-1 ring-carup-line')}>
          <Sparkles className={skin('h-4 w-4 text-violet-600', 'h-4 w-4 text-status-info')} />
          <p className={skin('mt-2 text-xs font-black', 'mt-2 text-xs font-bold')}>Suggest, never silently overwrite</p>
          <p className={skin('mt-1 text-[11px] leading-4 text-slate-500', 'mt-1 text-[11px] leading-4 text-carup-text-2')}>OCR output is a candidate reading. Seller-stated and governed facts remain separate.</p>
        </div>
        <div className={skin('rounded-2xl bg-white p-3 ring-1 ring-slate-200', 'rounded-2xl bg-carup-bg-raised p-3 ring-1 ring-carup-line')}>
          <ScanText className={skin('h-4 w-4 text-violet-600', 'h-4 w-4 text-status-info')} />
          <p className={skin('mt-2 text-xs font-black', 'mt-2 text-xs font-bold')}>Human/governed review stays authoritative</p>
          <p className={skin('mt-1 text-[11px] leading-4 text-slate-500', 'mt-1 text-[11px] leading-4 text-carup-text-2')}>Extraction confidence never auto-approves a vehicle fact or Trust claim.</p>
        </div>
      </div>
    </section>
  )
}
