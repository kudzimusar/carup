import {
  DataState,
  EvidenceLine,
  MoneyDisplay,
  TrustLens,
  VehicleIdentity,
  type TrustLensState,
} from '@/components/truth'

/**
 * RX-02A S1-3 — ComponentCatalogue (UI_DESIGN_REFERENCE_AND_TOKENS.md §10.3).
 * Isolated renderer hosting every truth component in every contract state.
 * Registered ONLY in development (App.tsx gates it behind import.meta.env.DEV);
 * it is not linked from any production navigation and never ships in a release build surface.
 */

const VEHICLE = {
  title: 'Toyota Hilux 2.8 GD-6 Raider',
  vin: 'AHTGB3CD005123456',
  year: 2021,
  mileageKm: 62400,
  location: 'Harare',
}

const LENS_STATES: TrustLensState[] = ['evaluated', 'partial', 'stale', 'not-evaluated', 'insufficient-data', 'unavailable']

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[12px] border border-carup-line bg-carup-bg-raised p-4">
      <h2 className="mb-3 text-[16px] font-bold tracking-[-0.02em] text-carup-text">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-carup-line pb-3 last:border-b-0 last:pb-0">
      <span className="w-40 shrink-0 text-[12px] font-medium text-carup-text-3">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export default function ComponentCatalogue() {
  return (
    <main className="min-h-screen bg-carup-bg px-4 py-8 text-carup-text" data-testid="component-catalogue">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-[28px] font-bold leading-[1.12] tracking-[-0.02em]">Truth components — RX-02A S1-3 catalogue</h1>
          <p className="mt-1 text-[13px] text-carup-text-2">
            Isolated renderer per UI_DESIGN_REFERENCE_AND_TOKENS.md §10.3. Every component in every contract state. Dev-only route.
          </p>
        </header>

        <Section title="MoneyDisplay — currency explicit, missing values honest">
          <Row label="USD · asking">
            <MoneyDisplay amount={18500} currency="USD" source="asking" />
          </Row>
          <Row label="ZiG · agreed (never $)">
            <MoneyDisplay amount={7200} currency="ZiG" source="agreed" />
          </Row>
          <Row label="USD · estimate · large">
            <MoneyDisplay amount={15900} currency="USD" source="estimate" size="lg" />
          </Row>
          <Row label="ZiG · guide">
            <MoneyDisplay amount={9800} currency="ZiG" source="guide" />
          </Row>
          <Row label="Missing amount">
            <MoneyDisplay amount={null} currency="USD" source="asking" />
          </Row>
          <Row label="Unknown currency (EUR)">
            <MoneyDisplay amount={500} currency="EUR" />
          </Row>
        </Section>

        <Section title="VehicleIdentity — card / row / header">
          <div className="grid gap-4 sm:grid-cols-2">
            <VehicleIdentity {...VEHICLE} variant="card" />
            <div className="space-y-0">
              <VehicleIdentity {...VEHICLE} variant="row" />
              <VehicleIdentity title="Mazda CX-5 2.0 Dynamic" variant="row" />
            </div>
          </div>
          <VehicleIdentity {...VEHICLE} variant="header" className="mt-4" />
          <VehicleIdentity title="Ford Ranger 2.0 BiT XLT (partial record)" variant="card" className="mt-4" />
        </Section>

        <Section title="DataState — loading / empty / error / forbidden / not-measured / unavailable">
          <Row label="loading">
            <DataState state="loading" subject="Service history" />
          </Row>
          <Row label="empty">
            <DataState state="empty" subject="Saved vehicles" action={{ label: 'Browse marketplace', onClick: () => {} }} />
          </Row>
          <Row label="error">
            <DataState state="error" subject="Valuation" action={{ label: 'Retry', onClick: () => {} }} />
          </Row>
          <Row label="forbidden">
            <DataState state="forbidden" subject="Dealer ledger" />
          </Row>
          <Row label="not-measured">
            <DataState state="not-measured" subject="Emissions rating" />
          </Row>
          <Row label="unavailable">
            <DataState state="unavailable" subject="Trade-in valuation" action={{ label: 'Get estimate', onClick: () => {} }} />
          </Row>
        </Section>

        <Section title="TrustLens — all six states, provenance always carried">
          {LENS_STATES.map((state) => (
            <Row key={state} label={state}>
              <TrustLens state={state} sourceCount={state === 'unavailable' ? null : 3} freshness={state === 'unavailable' ? null : '12 Nov 2026'} />
            </Row>
          ))}
          <Row label="no provenance recorded">
            <TrustLens state="evaluated" />
          </Row>
        </Section>

        <Section title="EvidenceLine — actor · source · time">
          <Row label="complete">
            <EvidenceLine actor="Roadworthiness centre HW-12" source="Roadworthiness certificate" at="2026-11-01" />
          </Row>
          <Row label="missing time">
            <EvidenceLine actor="Dealer audit" source="Stock reconciliation" />
          </Row>
          <Row label="with status">
            <EvidenceLine actor="Service centre" source="Service invoice" at="2026-09-12" status="awaiting review" />
          </Row>
        </Section>
      </div>
    </main>
  )
}
