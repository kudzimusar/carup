/**
 * RX05-E — original CarUp automotive artwork (no-cost, authored in code).
 *
 * These scenes are ILLUSTRATIONS: they never depict a real vehicle, dealership, port, document or
 * shipment, carry a visible disclosure, and are never placed where they could be read as evidence.
 * Colour comes only from CarUp tokens (CSS variables); motion stops for prefers-reduced-motion.
 *
 *  - ShowroomFloorScene: a curated showroom floor — light rail, three spot-lit silhouettes, floor
 *    reflections. For public dealership heroes and Dealer empty states.
 *  - TradeRouteScene: a vehicle's journey drawn as a route — origin, sea, customs, handover —
 *    used by the RX-06 Trade north-star. Milestones are labels passed in, never invented progress.
 */
import { VehicleSilhouette } from '@/components/showroom/VehicleSilhouette'
import './automotiveScenes.css'

const SIGNAL = 'var(--carup-raw-orange-signal)'

export function SceneDisclosure({ children = 'Illustration · original CarUp artwork, not inventory', className = '' }: { children?: string; className?: string }) {
  return (
    <span className={`pointer-events-none rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white/85 ${className}`} data-testid="scene-disclosure">
      {children}
    </span>
  )
}

/** A curated showroom floor. Fills its container; give the container a height or aspect ratio. */
export function ShowroomFloorScene({ className = '', label = 'Illustration of a dealership showroom floor', disclosure = true, cars = ['suv', 'sedan', 'pickup'] }: {
  className?: string
  label?: string
  disclosure?: boolean
  cars?: string[]
}) {
  return (
    <div className={`relative isolate overflow-hidden bg-carup-raw-ink ${className}`} role="img" aria-label={label} data-testid="showroom-floor-scene">
      {/* Back wall: tall glazing bars and a warm ceiling light rail. */}
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-x-0 top-0 h-[58%]" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--carup-raw-navy) 85%, transparent) 0%, var(--carup-raw-ink) 100%)' }} />
        {[8, 22, 36, 50, 64, 78, 92].map(left => (
          <div key={left} className="absolute top-[8%] h-[46%] w-px bg-white/[0.07]" style={{ left: `${left}%` }} />
        ))}
        <div className="absolute left-[-5%] right-[-5%] top-[9%] h-[2px] -rotate-[1.5deg] opacity-90" style={{ background: `linear-gradient(90deg, transparent, ${SIGNAL} 18%, ${SIGNAL} 82%, transparent)`, boxShadow: `0 0 24px 4px color-mix(in srgb, ${SIGNAL} 45%, transparent)` }} />
        {/* Floor: a polished plane with perspective seams. */}
        <div className="absolute inset-x-0 bottom-0 h-[46%]" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--carup-raw-ink-2) 92%, black) 0%, var(--carup-raw-ink) 100%)' }} />
        <svg className="absolute inset-x-0 bottom-0 h-[46%] w-full" viewBox="0 0 100 46" preserveAspectRatio="none" aria-hidden="true">
          {[-60, -30, 0, 30, 60, 90, 120, 150].map(x => (
            <line key={x} x1={50} y1={0} x2={x} y2={46} stroke="white" strokeOpacity={0.05} strokeWidth={0.15} />
          ))}
          {[6, 14, 24, 36].map(y => <line key={y} x1={0} y1={y} x2={100} y2={y} stroke="white" strokeOpacity={0.04} strokeWidth={0.12} />)}
        </svg>
      </div>

      {/* Three cars, each under its own spot, with a soft reflection on the floor. */}
      <div className="absolute inset-x-[4%] bottom-[10%] grid grid-cols-3 items-end gap-[3%]" aria-hidden="true">
        {cars.slice(0, 3).map((body, i) => (
          <div key={body + i} className={`relative ${i === 1 ? 'scale-[1.12]' : 'opacity-90'}`}>
            <div className="absolute inset-x-[-10%] bottom-[-8%] top-[-120%] carup-spot" style={{ background: `radial-gradient(60% 55% at 50% 100%, color-mix(in srgb, white ${i === 1 ? 14 : 9}%, transparent), transparent 72%)`, animationDelay: `${i * 0.6}s` }} />
            <VehicleSilhouette bodyStyle={body} tone="paper" className="relative h-auto w-full drop-shadow-2xl" />
            <div className="pointer-events-none absolute inset-x-0 top-full h-[60%] -scale-y-100 opacity-[0.12] [mask-image:linear-gradient(180deg,black,transparent)]">
              <VehicleSilhouette bodyStyle={body} tone="paper" accent={false} className="h-auto w-full" />
            </div>
          </div>
        ))}
      </div>
      {disclosure && <SceneDisclosure className="absolute right-3 top-3" />}
    </div>
  )
}

export interface TradeMilestone {
  key: string
  label: string
  /** Where the order actually is — passed in from a real projection, or omitted for a concept view. */
  state?: 'done' | 'current' | 'upcoming' | 'unknown'
}

/** A vehicle's international journey as a route. States are props; the scene invents no progress. */
export function TradeRouteScene({ className = '', milestones, label = 'Illustration of a vehicle shipping route from origin port to handover', disclosure = true }: {
  className?: string
  milestones: TradeMilestone[]
  label?: string
  disclosure?: boolean
}) {
  const n = milestones.length
  const points = milestones.map((_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    // A gentle ocean arc from left to right.
    return { x: 60 + t * 680, y: 230 - Math.sin(t * Math.PI) * 120 }
  })
  const path = points.reduce((d, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`
    const prev = points[i - 1]
    const cx = (prev.x + p.x) / 2
    return `${d} Q ${cx} ${Math.min(prev.y, p.y) - 30} ${p.x} ${p.y}`
  }, '')
  const fill = (state?: TradeMilestone['state']) =>
    state === 'done' ? 'var(--carup-raw-paper)' : state === 'current' ? SIGNAL : 'var(--carup-raw-ink)'
  return (
    <div className={`relative isolate overflow-hidden bg-carup-raw-ink ${className}`} role="img" aria-label={label} data-testid="trade-route-scene">
      <svg viewBox="0 0 800 330" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {/* Ocean swell lines. */}
        {[250, 270, 290, 310].map((y, i) => (
          <path key={y} d={`M0 ${y} C 200 ${y - 8}, 400 ${y + 8}, 800 ${y - 4}`} fill="none" stroke="white" strokeOpacity={0.05 + i * 0.01} strokeWidth={1} />
        ))}
        {/* Latitude arcs. */}
        {[60, 110, 160].map(y => <path key={y} d={`M0 ${y} Q 400 ${y - 40} 800 ${y}`} fill="none" stroke="white" strokeOpacity={0.05} strokeDasharray="2 6" />)}
        {/* Origin and destination quays with gantry cranes and container stacks. */}
        {[{ x: 20, flip: false }, { x: 700, flip: true }].map(({ x, flip }) => (
          <g key={x} transform={flip ? `translate(${x + 80} 0) scale(-1 1)` : `translate(${x} 0)`} opacity={0.85}>
            <rect x={0} y={246} width={80} height={8} fill="var(--carup-raw-ink-2)" />
            <path d="M14 246 V150 H62 V160 H24 V246" fill="none" stroke="var(--carup-raw-paper)" strokeOpacity={0.35} strokeWidth={2} />
            <path d="M62 150 L74 150" stroke={SIGNAL} strokeWidth={2} />
            {[0, 1, 2].map(row => [0, 1].map(col => (
              <rect key={`${row}-${col}`} x={34 + col * 14} y={234 - row * 10} width={12} height={8} rx={1} fill="var(--carup-raw-paper)" fillOpacity={0.12 + row * 0.04} />
            )))}
          </g>
        ))}
        {/* The route, drawn once, then a slow travelling highlight. */}
        <path d={path} fill="none" stroke="var(--carup-raw-paper)" strokeOpacity={0.25} strokeWidth={2} strokeDasharray="4 6" />
        <path d={path} fill="none" stroke={SIGNAL} strokeWidth={2.5} strokeLinecap="round" className="carup-route-sweep" pathLength={100} />
        {milestones.map((m, i) => (
          <g key={m.key} transform={`translate(${points[i].x} ${points[i].y})`}>
            <circle r={m.state === 'current' ? 10 : 7} fill={fill(m.state)} stroke={m.state === 'upcoming' || m.state === 'unknown' || !m.state ? 'var(--carup-raw-paper)' : SIGNAL} strokeOpacity={0.7} strokeWidth={2} />
            {m.state === 'current' && <circle r={16} fill="none" stroke={SIGNAL} strokeOpacity={0.45} className="carup-pulse" />}
            <text y={i % 2 === 0 ? 30 : -18} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--carup-raw-paper)" fillOpacity={0.9}>{m.label}</text>
          </g>
        ))}
      </svg>
      {disclosure && <SceneDisclosure className="absolute bottom-3 right-3">Illustration · not a live shipment</SceneDisclosure>}
    </div>
  )
}
