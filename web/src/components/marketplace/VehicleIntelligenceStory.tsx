import type { VehicleHistoryReportData } from '@/types'
import {
  AlertTriangle,
  ArrowLeftRight,
  Camera,
  CarFront,
  ClipboardCheck,
  Gauge,
  ShieldCheck,
  Wrench,
} from 'lucide-react'

function dateLabel(value: string | null) {
  if (!value) return 'Date unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unknown'
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function eventLabel(item: VehicleHistoryReportData['timeline'][number]) {
  const raw = item.evidence_subtype || item.evidence_class || 'vehicle record'
  return String(raw).replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function MileageStory({ report }: { report: VehicleHistoryReportData }) {
  const observations = report.mileage_history.observations
    .filter((item) => Number.isFinite(item.value))
    .slice()
    .sort((a, b) => Date.parse(a.date || '') - Date.parse(b.date || ''))

  if (!observations.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Gauge className="h-4 w-4 text-orange-500" /> Mileage history</div>
        <p className="mt-2 text-sm text-slate-500">No mileage observations are recorded in the currently available history.</p>
      </div>
    )
  }

  const values = observations.map((item) => item.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 1)
  const width = 640
  const height = 190
  const padX = 24
  const padY = 24
  const points = observations.map((item, index) => {
    const x = observations.length === 1 ? width / 2 : padX + (index / (observations.length - 1)) * (width - padX * 2)
    const y = height - padY - ((item.value - min) / range) * (height - padY * 2)
    return { ...item, x, y }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="vehicle-story-mileage">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Gauge className="h-4 w-4 text-orange-500" /> Mileage history</div>
          <p className="mt-1 text-xs text-slate-500">{observations.length} recorded observation{observations.length === 1 ? '' : 's'} · not interpolated</p>
        </div>
        {report.mileage_history.anomaly && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" /> Mileage review signal
          </span>
        )}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl bg-[#07101f] p-3">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recorded mileage over time" className="h-auto w-full">
          <defs>
            <linearGradient id="mileageLine" x1="0" x2="1">
              <stop offset="0%" stopColor="#fb923c" />
              <stop offset="100%" stopColor="#facc15" />
            </linearGradient>
          </defs>
          <path d={path} fill="none" stroke="url(#mileageLine)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => (
            <g key={`${point.date}-${point.value}-${index}`}>
              <circle cx={point.x} cy={point.y} r="5" fill="#fff" stroke="#f97316" strokeWidth="3" />
              <text x={point.x} y={Math.max(point.y - 11, 13)} fill="#e2e8f0" fontSize="10" textAnchor="middle">{point.value.toLocaleString()}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-3 flex gap-4 overflow-x-auto pb-1 text-xs text-slate-500">
        {points.map((point, index) => (
          <div key={`label-${point.date}-${index}`} className="shrink-0">
            <span className="font-semibold text-slate-700">{dateLabel(point.date)}</span>
            <span className="ml-1">{point.value.toLocaleString()} {point.unit || 'km'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function VehicleIntelligenceStory({ report }: { report: VehicleHistoryReportData }) {
  const sections = report.sections
  const summary = [
    { label: 'Ownership transfers', value: sections.ownership_transfer, icon: ArrowLeftRight },
    { label: 'Accident records', value: sections.accident_repair.accident, icon: CarFront },
    { label: 'Repair records', value: sections.accident_repair.repair, icon: Wrench },
    { label: 'Inspections', value: sections.inspection, icon: ClipboardCheck },
  ]
  const recent = report.timeline.slice().sort((a, b) => Date.parse(b.date || '') - Date.parse(a.date || '')).slice(0, 6)

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]" data-testid="vehicle-intelligence-story">
      <div className="relative overflow-hidden bg-[#07101f] px-5 py-6 text-white sm:px-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(249,115,22,0.22),transparent_34%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-300">
              <ShieldCheck className="h-4 w-4" /> CarUp Vehicle Intelligence
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">The story CarUp can support</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Ownership, mileage, damage, repairs and inspections are shown only when a record exists in the current evidence coverage. No record is never presented as proof that an event did not happen.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-right backdrop-blur">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Source diversity</p>
            <p className="text-xl font-bold">{report.completeness.source_diversity}</p>
            <p className="text-[10px] text-slate-500">recorded source{report.completeness.source_diversity === 1 ? '' : 's'}</p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-7">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summary.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <Icon className="h-5 w-5 text-orange-500" />
                <span className="text-2xl font-black text-slate-950">{value}</span>
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-700">{label}</p>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">{value === 0 ? 'No matching records in current coverage' : 'Supported by current report records'}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <MileageStory report={report} />

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Camera className="h-4 w-4 text-orange-500" /> Recorded vehicle story
            </div>
            <p className="mt-1 text-xs text-slate-500">Most recent public-safe evidence events.</p>
            {recent.length ? (
              <div className="mt-4 space-y-4">
                {recent.map((item, index) => (
                  <div key={`${item.evidence_id}-${index}`} className="relative pl-5">
                    <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-orange-500 ring-4 ring-orange-50" />
                    {index < recent.length - 1 && <span className="absolute left-[4px] top-4 h-[calc(100%+0.5rem)] w-px bg-slate-200" />}
                    <p className="text-sm font-semibold text-slate-800">{eventLabel(item)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{dateLabel(item.date)} · {item.verification_status || 'status not recorded'}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No public-safe history events are recorded yet.</p>
            )}
          </div>
        </div>

        {report.limitations.length > 0 && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Known coverage limits</p>
            <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-amber-900 sm:grid-cols-2">
              {report.limitations.slice(0, 6).map((limitation) => <li key={limitation}>• {limitation}</li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
