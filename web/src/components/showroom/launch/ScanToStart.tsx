/**
 * RX03 Addendum 05 — Scan to Start: the launch design for document-assisted listing.
 *
 * LAUNCH PREVIEW ONLY. On `main` nothing reads vehicle documents yet (audit A2): the governed OCR
 * (`run-ocr`) lives on another lineage and must be ported and certified (RX-04 seller journeys +
 * the OCR lane). Home renders this section only when `isLaunchPreviewEnabled()` — never in a public
 * production build until the capability is functional and independently accepted.
 *
 * The demo uses a clearly labelled SAMPLE document. Every reading is a suggestion until the person
 * confirms it; nothing here creates a listing, verifies a vehicle or writes evidence.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, FileText, PencilLine, ScanLine } from 'lucide-react'
import type { CinematicFilm } from '@/content/media/homeFilm'
import { EditorialFilm } from '@/components/showroom/EditorialFilm'

type FieldState = 'hidden' | 'suggested' | 'confirmed' | 'editing'
interface SampleField { key: string; label: string; value: string; check?: boolean }

const SAMPLE: SampleField[] = [
  { key: 'make', label: 'Make', value: 'Toyota' },
  { key: 'model', label: 'Model', value: 'Hilux 2.8 GD-6' },
  { key: 'year', label: 'First registered', value: '2019', check: true },
  { key: 'colour', label: 'Colour', value: 'Silver' },
  { key: 'engine', label: 'Engine', value: '2.8 L diesel' },
  { key: 'chassis', label: 'Chassis number', value: '•••••••••••••2345' },
]

export function ScanToStart({ film }: { film: CinematicFilm | null }) {
  const [reading, setReading] = useState(false)
  const [states, setStates] = useState<Record<string, FieldState>>(() => Object.fromEntries(SAMPLE.map(f => [f.key, 'hidden'])))
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(SAMPLE.map(f => [f.key, f.value])))

  // Reveal the readings one by one (instantly for reduced motion).
  useEffect(() => {
    if (!reading) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timers = SAMPLE.map((field, index) => window.setTimeout(
      () => setStates(current => ({ ...current, [field.key]: current[field.key] === 'hidden' ? 'suggested' : current[field.key] })),
      reduce ? 0 : 280 * (index + 1),
    ))
    return () => timers.forEach(window.clearTimeout)
  }, [reading])

  const confirmed = SAMPLE.filter(f => states[f.key] === 'confirmed').length
  const shown = SAMPLE.filter(f => states[f.key] !== 'hidden').length
  const set = (key: string, state: FieldState) => setStates(current => ({ ...current, [key]: state }))

  return (
    <section id="scan-to-start" className="scroll-mt-20 bg-white py-14 sm:py-20" data-testid="home-scan-to-start" data-capability-state="launch-preview" aria-labelledby="scan-title">
      <div className="section-padding mx-auto grid max-w-[1440px] gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16">
        <EditorialFilm
          film={film}
          label="the Scan to Start film"
          testId="scan-film"
          className="aspect-square w-full max-w-[560px] rounded-[2rem] bg-[#09122A] lg:justify-self-start"
          fallback={(
            <div className="flex aspect-square w-full max-w-[560px] items-center justify-center rounded-[2rem] bg-[#09122A] text-white/80">
              <ScanLine className="h-16 w-16 text-[#FE7D18]" aria-hidden="true" />
            </div>
          )}
        />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Scan to Start · Sell</p>
            <span className="rounded-full bg-[#FFF1E6] px-2.5 py-1 text-[11px] font-semibold text-[#9A3412]" data-testid="scan-preview-badge">
              Launch preview · sample document
            </span>
          </div>
          <h2 id="scan-title" className="mt-3 max-w-xl text-[clamp(1.75rem,3.4vw,3rem)] font-bold leading-[1.04] tracking-[-0.03em] text-[#09122A]">
            Photograph the papers. CarUp starts the listing.
          </h2>
          <p className="mt-3 max-w-lg text-[15px] leading-7 text-slate-600">
            Point your phone at the registration book or customs papers. CarUp reads the vehicle details, you confirm each one, and your listing starts already filled in.
          </p>

          <div className="mt-7 rounded-[1.6rem] bg-[#F6F4F0] p-4 sm:p-6" data-testid="scan-demo">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#09122A]">
                <FileText className="h-4 w-4 text-[#C2410C]" aria-hidden="true" /> Registration book <span className="font-normal text-slate-600">(sample — not a real vehicle)</span>
              </p>
              {!reading ? (
                <button
                  type="button"
                  onClick={() => setReading(true)}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[#09122A] px-5 text-sm font-semibold text-white transition hover:bg-[#111D3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2"
                  data-testid="scan-read-sample"
                >
                  <ScanLine className="h-4 w-4" aria-hidden="true" /> Read the sample
                </button>
              ) : (
                <p className="text-[13px] font-medium text-slate-600" role="status" data-testid="scan-progress">
                  {shown < SAMPLE.length ? 'Reading…' : `${confirmed} of ${SAMPLE.length} confirmed`}
                </p>
              )}
            </div>

            <ul className="mt-4 divide-y divide-slate-200 rounded-2xl bg-white">
              {SAMPLE.map(field => {
                const state = states[field.key]
                return (
                  <li key={field.key} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2" data-testid="scan-field" data-field-state={state}>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{field.label}</p>
                      {state === 'hidden' ? (
                        <span className="mt-1 block h-3 w-28 rounded bg-slate-100" aria-hidden="true" />
                      ) : state === 'editing' ? (
                        <input
                          aria-label={`Correct ${field.label}`}
                          value={values[field.key]}
                          onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}
                          onKeyDown={event => { if (event.key === 'Enter') set(field.key, 'confirmed') }}
                          className="mt-0.5 h-9 w-full rounded-lg border border-slate-300 px-2 text-[15px] text-[#09122A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]"
                          autoFocus
                        />
                      ) : (
                        <p className="truncate text-[15px] font-semibold text-[#09122A]">
                          {values[field.key]}
                          {state === 'suggested' && (
                            <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold ${field.check ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
                              {field.check ? 'Please check' : 'Suggested'}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    {state === 'suggested' && (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => set(field.key, 'confirmed')} className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-[#09122A] ring-1 ring-slate-300 hover:bg-[#F6F4F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]" aria-label={`${field.label} is right`}>
                          <Check className="h-4 w-4" aria-hidden="true" /> Right
                        </button>
                        <button type="button" onClick={() => set(field.key, 'editing')} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-[#F6F4F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]" aria-label={`Correct ${field.label}`}>
                          <PencilLine className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                    {state === 'editing' && (
                      <button type="button" onClick={() => set(field.key, 'confirmed')} className="h-10 rounded-full bg-[#09122A] px-4 text-[13px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]">Save</button>
                    )}
                    {state === 'confirmed' && <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-700"><Check className="h-4 w-4" aria-hidden="true" /> You confirmed</span>}
                  </li>
                )
              })}
            </ul>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-sm text-[12px] leading-5 text-slate-600">
                Readings are suggestions until you confirm them. Nothing is published, verified or added to a Passport from a scan alone.
              </p>
              <Link to="/sell" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)] px-5 text-sm font-semibold text-[#09122A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09122A] focus-visible:ring-offset-2" data-testid="scan-continue">
                Continue to your listing <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <p className="mt-4 text-[12px] leading-5 text-slate-500" data-testid="scan-scope">
            Launch scope: registration book or customs papers as a photo (JPG, PNG, HEIC) or PDF; dealers bring stock as a workbook (.xlsx). Today the sell flow starts with photos — document reading switches on when it is certified.
          </p>
        </div>
      </div>
    </section>
  )
}
