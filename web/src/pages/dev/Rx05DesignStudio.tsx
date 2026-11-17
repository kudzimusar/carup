/**
 * RX05 design studio — DEV ONLY (never in a production build: App.tsx creates the route only when
 * import.meta.env.DEV, and scripts/assert-no-dev-pages.mjs proves no chunk, test id or route ships).
 *
 * Holds the RX05-E original media scenes and, later, the RX-06 Trade north-star prototypes. Every
 * value shown here that is not a CarUp read is a FIXTURE and is labelled as one on screen.
 */
import { ShowroomFloorScene, TradeRouteScene } from '@/components/media/rx05/AutomotiveScenes'

export default function Rx05DesignStudio() {
  return (
    <div className="min-h-screen bg-carup-bg px-4 py-8 text-carup-text sm:px-8" data-testid="rx05-design-studio">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-status-warning">Design reference · DEV only · not the live product</p>
      <h1 className="mt-2 text-[clamp(1.6rem,3vw,2.4rem)] font-bold tracking-[-0.03em]">RX-05 media and RX-06 Trade north-star</h1>
      <section className="mt-8 space-y-3" aria-labelledby="rx05-scenes">
        <h2 id="rx05-scenes" className="text-[17px] font-semibold">Original scenes</h2>
        <ShowroomFloorScene className="aspect-[21/9] w-full rounded-card" />
        <TradeRouteScene className="aspect-[21/9] w-full rounded-card" milestones={[
          { key: 'source', label: 'Sourced', state: 'done' },
          { key: 'port', label: 'Origin port', state: 'done' },
          { key: 'sea', label: 'At sea', state: 'current' },
          { key: 'customs', label: 'Customs', state: 'upcoming' },
          { key: 'handover', label: 'Handover', state: 'upcoming' },
        ]} />
        <p className="text-[12px] text-carup-text-3">Milestone states above are a FIXTURE for the scene, not an order.</p>
      </section>
    </div>
  )
}
