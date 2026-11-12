/**
 * RX-02A S1-4A — Unified shell prototype showcase (DEV-only page).
 *
 * Route: /dev/rx02-s1-4a-shells (registered in App.tsx behind import.meta.env.DEV).
 * Renders inspectable instances of PublicShell / WorkspaceShell / FocusedShell
 * plus reference cards for the reviewer workbenches and the Trade family,
 * a route-to-shell explorer over the 139-row authority register, and the
 * connected demonstration journey. All data is fictional and labelled.
 */
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  FIXTURE_EVIDENCE_ROWS,
  FIXTURE_TRUST_STATE,
  FIXTURE_VEHICLE,
  focusedFixture,
  GUEST_PUBLIC_CONTEXT,
  JOURNEY_STEPS,
  MEMBER_PUBLIC_CONTEXT,
  REVIEWER_REFERENCE_ROUTES,
  TRADE_REFERENCE_ROUTES,
  workspaceFixture,
  type ShowcaseScenario,
} from '@/components/ux-prototype/rx02-s1-4a'
import { PublicShell } from '@/components/ux-prototype/rx02-s1-4a/PublicShell'
import { WorkspaceShell } from '@/components/ux-prototype/rx02-s1-4a/WorkspaceShell'
import { FocusedShell, type FocusedField } from '@/components/ux-prototype/rx02-s1-4a/FocusedShell'
import {
  FixtureEvidenceLine,
  FixtureMoney,
  FixtureNotice,
  FixtureTrustChip,
  FixtureVehicleIdentity,
} from '@/components/ux-prototype/rx02-s1-4a/fixtureDisplay'
import { lookupRouteShell, ROUTE_SHELL_ASSIGNMENTS } from '@/components/ux-prototype/rx02-s1-4a/routeShellMap'
import type { ShellObjectIdentity } from '@/components/ux-prototype/rx02-s1-4a/contracts'

const SHELL_TABS = [
  { id: 'public', label: 'PublicShell' },
  { id: 'workspace', label: 'WorkspaceShell' },
  { id: 'focused', label: 'FocusedShell' },
  { id: 'reference', label: 'References' },
] as const

type ShellTabId = (typeof SHELL_TABS)[number]['id']

const FAMILY_SCENARIOS = [
  { family: 'personal', label: 'My CarUp (owner)' },
  { family: 'dealer', label: 'Dealer OS' },
  { family: 'garage', label: 'Garage OS' },
  { family: 'trade', label: 'Trade — reference only' },
  { family: 'institutional', label: 'Institutional' },
  { family: 'admin', label: 'Administration' },
] as const

const FOCUSED_SCENARIOS = [
  { mode: 'auth', label: 'Sign in (auth)' },
  { mode: 'identity', label: 'Identity confirm' },
  { mode: 'seller-claim', label: 'Seller claim' },
  { mode: 'flow', label: 'Listing flow' },
  { mode: 'review-decision', label: 'Review decision' },
] as const

const SAMPLE_ROUTE_IDS = [
  'R001', 'R002', 'R003', 'R007', 'R008', 'R013', 'R014', 'R016', 'R017',
  'R038', 'R044', 'R062', 'R070', 'R080', 'R090', 'R100', 'R110', 'R120',
  'R124', 'R128', 'R131', 'R132', 'R133', 'R139',
]

function PublicPageFixture({ page }: { page: 'home' | 'marketplace' | 'vehicle'; signedIn?: boolean }) {
  if (page === 'marketplace') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Marketplace (fixture)</h2>
          <FixtureNotice />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <article key={i} className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
              {/* Media-first rule: no invented vehicle imagery — the media well
                  renders empty with a truthful note instead of a placeholder image. */}
              <div className="flex h-36 items-center justify-center rounded-control border border-dashed border-carup-line bg-carup-bg-surface text-xs text-carup-text-3">
                Media well — no fixture imagery (media-first rule)
              </div>
              <div className="mt-3">
                <FixtureVehicleIdentity
                  title={FIXTURE_VEHICLE.title}
                  reference={`FIXTURE-CU-2019-00${i}`}
                  publicSafe
                  meta={[FIXTURE_VEHICLE.year, FIXTURE_VEHICLE.mileage, FIXTURE_VEHICLE.location]}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <FixtureMoney amountText={FIXTURE_VEHICLE.askingPrice} currency={FIXTURE_VEHICLE.currency} source="fixture listing" />
                <FixtureTrustChip state={FIXTURE_TRUST_STATE.state as 'partial'} label={FIXTURE_TRUST_STATE.label} sourceCount={FIXTURE_TRUST_STATE.sourceCount} />
              </div>
            </article>
          ))}
        </div>
      </div>
    )
  }
  if (page === 'vehicle') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Vehicle detail (fixture)</h2>
          <FixtureNotice />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <div className="flex h-64 items-center justify-center rounded-card border border-dashed border-carup-line bg-carup-bg-surface text-xs text-carup-text-3">
              Media well — no fixture imagery (media-first rule)
            </div>
            <FixtureVehicleIdentity
              title={FIXTURE_VEHICLE.title}
              reference="FIXTURE-CU-2019-001"
              publicSafe
              meta={[FIXTURE_VEHICLE.year, FIXTURE_VEHICLE.mileage, FIXTURE_VEHICLE.location]}
            />
            <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
              <p className="text-sm font-medium">Condition notes</p>
              <p className="mt-1 text-sm text-carup-text-2">Not recorded — this prototype shows the honest missing-content state.</p>
            </div>
          </div>
          <aside aria-label="Listing summary" className="space-y-4">
            <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
              <FixtureMoney amountText={FIXTURE_VEHICLE.askingPrice} currency={FIXTURE_VEHICLE.currency} source="fixture listing" />
              <div className="mt-3">
                <FixtureTrustChip state={FIXTURE_TRUST_STATE.state as 'partial'} label={FIXTURE_TRUST_STATE.label} sourceCount={FIXTURE_TRUST_STATE.sourceCount} />
              </div>
            </div>
            <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
              <p className="text-sm font-medium">Evidence trail (fictional)</p>
              <ul className="mt-2 space-y-1.5">
                {FIXTURE_EVIDENCE_ROWS.map(row => (
                  <FixtureEvidenceLine key={row.time} {...row} />
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Find a car you can trust (fixture hero)</h2>
        <FixtureNotice />
      </div>
      <p className="max-w-2xl text-sm text-carup-text-2">
        Fictional hero band for shell chrome inspection. No marketing claims, no real inventory, no invented imagery.
      </p>
      <div className="flex h-40 items-center justify-center rounded-card border border-dashed border-carup-line bg-carup-bg-surface text-xs text-carup-text-3">
        Hero media well — no fixture imagery (media-first rule)
      </div>
    </div>
  )
}

function wsObjectFor(object: 'overview' | 'inventory' | 'vehicle'): ShellObjectIdentity {
  if (object === 'inventory') {
    return {
      title: 'Inventory (fixture)',
      reference: 'FIXTURE-INV-DEALER-001',
      statusLabel: '3 of 5 tasks current',
      statusTone: 'warning',
      meta: ['Fixture stock: 5 units'],
    }
  }
  if (object === 'vehicle') {
    return {
      title: FIXTURE_VEHICLE.title,
      reference: 'FIXTURE-CU-2019-001',
      statusLabel: 'Partially evaluated',
      statusTone: 'info',
      meta: [FIXTURE_VEHICLE.year, FIXTURE_VEHICLE.mileage],
    }
  }
  return {
    title: 'Workspace overview (fixture)',
    reference: 'FIXTURE-WS-OVERVIEW',
    statusLabel: 'Up to date',
    statusTone: 'success',
    meta: ['Task-first overview'],
  }
}

function WorkspaceObjectFixture({ object }: { object: 'overview' | 'inventory' | 'vehicle' }) {
  if (object === 'inventory') {
    return (
      <div className="space-y-3">
        {['Toyota Corolla 1.8 XS (fixture)', 'Honda Fit 1.5 (fixture)', 'Mazda CX-5 2.0 (fixture)'].map((v, i) => (
          <div key={v} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-carup-line bg-carup-bg-raised p-4">
            <FixtureVehicleIdentity title={v} reference={`FIXTURE-UNIT-00${i + 1}`} publicSafe={false} meta={['In stock (fixture)']} />
            <FixtureMoney amountText={['$12,500', '$8,900', '$19,700'][i]} currency="USD" source="fixture stock card" />
          </div>
        ))}
      </div>
    )
  }
  if (object === 'vehicle') {
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
          <p className="text-sm font-medium">Vehicle passport (fixture)</p>
          <ul className="mt-2 space-y-1.5">
            {FIXTURE_EVIDENCE_ROWS.map(row => (
              <FixtureEvidenceLine key={row.time} {...row} />
            ))}
          </ul>
        </div>
        <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
          <p className="text-sm font-medium">Trust state</p>
          <div className="mt-2">
            <FixtureTrustChip state={FIXTURE_TRUST_STATE.state as 'partial'} label={FIXTURE_TRUST_STATE.label} sourceCount={FIXTURE_TRUST_STATE.sourceCount} />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {/* Task-first overview — deliberately NO decorative stat-card fleet. */}
      {[
        { task: 'Respond to inquiry — FIXTURE-CU-2019-001', due: 'Today (fixture)' },
        { task: 'Upload service note scan', due: 'This week (fixture)' },
        { task: 'Review partially evaluated evidence', due: 'This week (fixture)' },
      ].map(t => (
        <div key={t.task} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-carup-line bg-carup-bg-raised p-4">
          <p className="text-sm font-medium">{t.task}</p>
          <p className="text-xs text-carup-text-3">{t.due}</p>
        </div>
      ))}
    </div>
  )
}

function wsBottomNav(object: 'overview' | 'inventory' | 'vehicle') {
  const items = [
    { label: 'Overview', href: '/dashboard', active: object === 'overview' },
    { label: 'Inventory', href: '/dealer', active: object === 'inventory' },
    { label: 'Passport', href: '/dashboard/vehicle', active: object === 'vehicle' },
    { label: 'Tasks', href: '/dashboard/tasks', active: false },
  ]
  return items
}

const FOCUSED_FIELDS: Record<string, FocusedField[]> = {
  auth: [
    { id: 'email', label: 'Email', required: true, inputMode: 'email', hint: 'Fictional field — anything passes format checks' },
    { id: 'password', label: 'Password', required: true, hint: 'Never enter a real password in this prototype' },
  ],
  identity: [
    { id: 'fullName', label: 'Full name', required: true },
    { id: 'idNumber', label: 'ID number', required: true, hint: 'Fictional field' },
  ],
  'seller-claim': [
    { id: 'businessName', label: 'Business name', required: true },
    { id: 'role', label: 'Your role', required: true, hint: 'Fictional field' },
  ],
  flow: [
    { id: 'title', label: 'Listing title', required: true },
    { id: 'price', label: 'Asking price', required: true, inputMode: 'numeric', hint: 'Rendered through FixtureMoney when displayed' },
  ],
  'review-decision': [
    { id: 'decision', label: 'Decision note', required: true, hint: 'Reviewer isolation preserved — reference only in this prototype' },
  ],
}

export default function Rx02S14ShellPrototype() {
  const [activeTab, setTab] = useState<ShellTabId>('public')
  const [scenario, setScenario] = useState<ShowcaseScenario>({ shell: 'public', page: 'home' })
  const [routeQuery, setRouteQuery] = useState('/marketplace/:id')

  const onTabKeyDown = (e: ReactKeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (index + (e.key === 'ArrowRight' ? 1 : SHELL_TABS.length - 1)) % SHELL_TABS.length
    setTab(SHELL_TABS[next].id)
    document.getElementById(`shell-tab-${SHELL_TABS[next].id}`)?.focus()
  }

  const assignment = lookupRouteShell(routeQuery)

  return (
    <div className="min-h-screen bg-carup-bg text-carup-text">
      {/* Showcase controls (the DEV-only banner lives inside this landmark so
          no page content sits outside landmarks) */}
      <div role="region" aria-label="Showcase controls" className="border-b border-carup-line bg-carup-bg-raised">
        <div className="border-b border-status-warning bg-status-warning-soft px-4 py-2 text-center text-xs font-semibold text-status-warning">
          DEV-ONLY PROTOTYPE — RX-02A S1-4A unified shell exploration · not production UI · no real data · no authorization decisions
        </div>
        <div className="px-4 py-4 lg:px-6">
          <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <FixtureNotice>S1-4A</FixtureNotice>
            <h1 className="text-base font-semibold tracking-tight">Unified application shells</h1>
          </div>
          <div role="tablist" aria-label="Shell family" className="flex flex-wrap gap-1 rounded-control border border-carup-line p-1">
            {SHELL_TABS.map((tab, i) => (
              <button
                key={tab.id}
                id={`shell-tab-${tab.id}`}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls="shell-showcase-panel"
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => {
                  setTab(tab.id)
                  if (tab.id === 'public') setScenario({ shell: 'public', page: 'home' })
                  else if (tab.id === 'workspace') setScenario({ shell: 'workspace', family: 'personal', object: 'overview' })
                  else if (tab.id === 'focused') setScenario({ shell: 'focused', mode: 'auth' })
                  else setScenario({ shell: 'reference', ref: 'reviewer' })
                }}
                onKeyDown={e => onTabKeyDown(e, i)}
                className={`min-h-9 rounded-control px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
                  activeTab === tab.id ? 'bg-carup-action text-carup-action-on' : 'text-carup-text-2 hover:bg-carup-bg-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'public' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {(['home', 'marketplace', 'vehicle'] as const).map(page => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setScenario({ shell: 'public', page, signedIn: scenario.shell === 'public' ? scenario.signedIn : false })}
                  aria-pressed={scenario.shell === 'public' && scenario.page === page}
                  className={`min-h-9 rounded-control border px-3 text-xs font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
                    scenario.shell === 'public' && scenario.page === page
                      ? 'border-carup-action text-carup-action'
                      : 'border-carup-line text-carup-text-2 hover:bg-carup-bg-surface'
                  }`}
                >
                  {page === 'vehicle' ? 'Vehicle detail' : page}
                </button>
              ))}
              <span className="text-xs text-carup-text-3">Signed-in state:</span>
              {[false, true].map(v => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setScenario({ shell: 'public', page: scenario.shell === 'public' ? scenario.page : 'home', signedIn: v })}
                  aria-pressed={scenario.shell === 'public' && !!scenario.signedIn === v}
                  className={`min-h-9 rounded-control border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
                    scenario.shell === 'public' && !!scenario.signedIn === v
                      ? 'border-carup-action text-carup-action'
                      : 'border-carup-line text-carup-text-2 hover:bg-carup-bg-surface'
                  }`}
                >
                  {v ? 'Member (fixture)' : 'Guest'}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'workspace' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {FAMILY_SCENARIOS.map(f => (
                <button
                  key={f.family}
                  type="button"
                  onClick={() => {
                    if (f.family === 'trade') {
                      setScenario({ shell: 'reference', ref: 'trade' })
                      setTab('reference')
                      return
                    }
                    setScenario({ shell: 'workspace', family: f.family, object: 'overview' })
                  }}
                  aria-pressed={scenario.shell === 'workspace' && scenario.family === f.family}
                  className={`min-h-9 rounded-control border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
                    scenario.shell === 'workspace' && scenario.family === f.family
                      ? 'border-carup-action text-carup-action'
                      : f.family === 'trade'
                        ? 'border-dashed border-carup-line-strong text-carup-text-2 hover:bg-carup-bg-surface'
                        : 'border-carup-line text-carup-text-2 hover:bg-carup-bg-surface'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              {scenario.shell === 'workspace' && (
                <>
                  <span className="text-xs text-carup-text-3">Object:</span>
                  {(['overview', 'inventory', 'vehicle'] as const).map(object => (
                    <button
                      key={object}
                      type="button"
                      onClick={() => scenario.shell === 'workspace' && setScenario({ shell: 'workspace', family: scenario.family, object })}
                      aria-pressed={scenario.shell === 'workspace' && scenario.object === object}
                      className={`min-h-9 rounded-control border px-3 text-xs font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
                        scenario.shell === 'workspace' && scenario.object === object
                          ? 'border-carup-action text-carup-action'
                          : 'border-carup-line text-carup-text-2 hover:bg-carup-bg-surface'
                      }`}
                    >
                      {object}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {activeTab === 'focused' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {FOCUSED_SCENARIOS.map(f => (
                <button
                  key={f.mode}
                  type="button"
                  onClick={() => setScenario({ shell: 'focused', mode: f.mode })}
                  aria-pressed={scenario.shell === 'focused' && scenario.mode === f.mode}
                  className={`min-h-9 rounded-control border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus ${
                    scenario.shell === 'focused' && scenario.mode === f.mode
                      ? 'border-carup-action text-carup-action'
                      : 'border-carup-line text-carup-text-2 hover:bg-carup-bg-surface'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Connected journey strip */}
      <div role="region" aria-label="Demonstration journey" className="border-b border-carup-line bg-carup-bg-surface px-4 py-3 lg:px-6">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-carup-text-3">Journey:</span>
          {JOURNEY_STEPS.map((step, i) => (
            <span key={step.key} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true" className="text-carup-text-3">→</span>}
              <span
                aria-current={i === 0 ? 'step' : undefined}
                className={`rounded-control border px-2 py-1 ${
                  step.referenceOnly
                    ? 'border-dashed border-carup-line-strong text-carup-text-3'
                    : 'border-carup-line bg-carup-bg-raised text-carup-text-2'
                }`}
                title={step.referenceOnly ? 'Reference only — main-backed workbench, no prototype chrome' : undefined}
              >
                {step.label}
                {step.referenceOnly && ' (ref)'}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Shell stage — a plain wrapper (NOT a landmark) so each rendered shell's
          header/main/footer landmarks stay top-level, as they would be in production */}
      <div id="shell-showcase-panel" className="min-h-[60vh]">
        {activeTab === 'public' && scenario.shell === 'public' && (
          <PublicShell
            context={scenario.signedIn ? MEMBER_PUBLIC_CONTEXT : GUEST_PUBLIC_CONTEXT}
            currentPath={scenario.page === 'marketplace' ? '/marketplace' : scenario.page === 'vehicle' ? '/marketplace/fixture-001' : '/'}
          >
            <PublicPageFixture page={scenario.page} />
          </PublicShell>
        )}

        {activeTab === 'workspace' && scenario.shell === 'workspace' && (
          <WorkspaceShellDemo
            family={scenario.family === 'trade' ? 'dealer' : scenario.family}
            object={scenario.object}
          />
        )}

        {activeTab === 'focused' && scenario.shell === 'focused' && (
          <FocusedShellDemo mode={scenario.mode} />
        )}

        {activeTab === 'reference' && (
          <ReferenceCards refKind={scenario.shell === 'reference' ? scenario.ref : 'reviewer'} />
        )}
      </div>

      {/* Route-to-shell explorer */}
      <div role="region" aria-label="Route-to-shell explorer" className="border-t border-carup-line bg-carup-bg-raised px-4 py-6 lg:px-6">
        <div className="mx-auto max-w-[1560px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold tracking-tight">Route-to-shell explorer (authority register — declarative, not activated)</h2>
            <FixtureNotice>{`${ROUTE_SHELL_ASSIGNMENTS.length} rows · R001–R139`}</FixtureNotice>
          </div>
          <label htmlFor="route-query" className="mt-4 block text-xs font-medium uppercase tracking-wider text-carup-text-3">
            Sample route family
          </label>
          <select
            id="route-query"
            value={routeQuery}
            onChange={e => setRouteQuery(e.target.value)}
            className="mt-1 min-h-11 w-full max-w-md rounded-control border border-carup-line bg-carup-bg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
          >
            {SAMPLE_ROUTE_IDS.map(id => {
              const row = ROUTE_SHELL_ASSIGNMENTS.find(a => a.routeId === id)
              return row ? (
                <option key={id} value={row.path}>
                  {id} — {row.path}
                </option>
              ) : null
            })}
          </select>
          {assignment && (
            <div data-testid="route-assignment-card" className="mt-4 grid max-w-2xl gap-2 rounded-card border border-carup-line bg-carup-bg p-4 text-sm sm:grid-cols-2">
              <p>
                <span className="font-medium text-carup-text-3">Route:</span>{' '}
                <span className="font-mono text-xs">{assignment.path}</span>
              </p>
              <p>
                <span className="font-medium text-carup-text-3">Proposed shell:</span>{' '}
                {assignment.shell === 'workspace' ? `WorkspaceShell (${assignment.family})` : assignment.shell === 'review-workbench' ? 'ReviewWorkbench (reviewer-isolated)' : assignment.shell}
              </p>
              <p>
                <span className="font-medium text-carup-text-3">Group:</span> {assignment.routeGroup}
              </p>
              <p>
                <span className="font-medium text-carup-text-3">Reviewer isolated:</span>{' '}
                {assignment.reviewerIsolated ? 'yes' : 'no'}
              </p>
              {assignment.focusedMode && (
                <p>
                  <span className="font-medium text-carup-text-3">Focused mode:</span> {assignment.focusedMode}
                </p>
              )}
              {assignment.migrationCaution && (
                <p className="sm:col-span-2">
                  <span className="font-medium text-carup-text-3">Migration caution:</span>{' '}
                  <span className="text-carup-text-2">{assignment.migrationCaution}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WorkspaceShellDemo({ family, object }: { family: 'personal' | 'dealer' | 'garage' | 'institutional' | 'admin'; object: 'overview' | 'inventory' | 'vehicle' }) {
  const fixture = workspaceFixture(family)
  const identity = fixture.identity
  const context = { kind: 'workspace' as const, family, identity }
  const wsObject = wsObjectFor(object)
  return (
    <WorkspaceShell
      context={context}
      currentPath={object === 'inventory' ? '/dealer' : object === 'vehicle' ? '/dashboard/vehicle' : '/dashboard'}
      breadcrumbs={[
        { label: fixture.familyLabel, href: '/dashboard' },
        { label: object === 'overview' ? 'Overview' : object === 'inventory' ? 'Inventory' : 'Vehicle passport' },
      ]}
      object={wsObject}
      primaryAction={{
        label: object === 'overview' ? 'Start next task' : object === 'inventory' ? 'Add listing' : 'Request evaluation',
        onSelect: () => {},
      }}
      statusPanel={
        <div className="space-y-4">
          <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
            <p className="text-sm font-medium">Contextual status (fictional)</p>
            <ul className="mt-2 space-y-1.5 text-sm text-carup-text-2">
              <li>· Tenant: {identity.tenantLabel}</li>
              <li>· Role: {identity.roleTitle} (fixture)</li>
              <li>· Step-up checks: server-side only</li>
            </ul>
          </div>
          <div className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
            <p className="text-sm font-medium">Evidence (fictional)</p>
            <ul className="mt-2 space-y-1.5">
              {FIXTURE_EVIDENCE_ROWS.slice(0, 2).map(row => (
                <FixtureEvidenceLine key={row.time} {...row} />
              ))}
            </ul>
          </div>
        </div>
      }
      bottomNav={wsBottomNav(object)}
    >
      <WorkspaceObjectFixture object={object} />
    </WorkspaceShell>
  )
}

function FocusedShellDemo({ mode }: { mode: 'auth' | 'identity' | 'seller-claim' | 'flow' | 'review-decision' }) {
  const fixture = focusedFixture(mode)
  return (
    <FocusedShell
      context={fixture.context}
      title={fixture.title}
      stepLabel={fixture.stepLabel}
      fields={FOCUSED_FIELDS[mode] ?? []}
      primaryLabel={mode === 'auth' ? 'Sign in (prototype)' : mode === 'review-decision' ? 'Record decision (prototype)' : 'Continue (prototype)'}
      onBack={mode === 'auth' ? undefined : () => {}}
      onExit={() => {}}
    />
  )
}

function ReferenceCards({ refKind }: { refKind: 'reviewer' | 'trade' }) {
  const routes = refKind === 'reviewer' ? REVIEWER_REFERENCE_ROUTES : TRADE_REFERENCE_ROUTES
  return (
    <div className="mx-auto max-w-[1560px] px-4 py-8 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          {refKind === 'reviewer' ? 'Independent reviewer workbenches (main-backed reference)' : 'Trade family (main-backed reference)'}
        </h2>
        <FixtureNotice>Reference only — no prototype chrome</FixtureNotice>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-carup-text-2">
        {refKind === 'reviewer'
          ? 'Reviewer independence, membership-derived access and server-side step-up checks are preserved on these accepted-main routes. S1-4A renders no reviewer workbench chrome; these cards exist so the journey ends at the real boundary.'
          : 'The Trade family is presented through its accepted-main routes only. Trade shell chrome is deliberately NOT built in S1-4A.'}
      </p>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {routes.map(r => (
          <li key={r.path} className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
            <p className="text-sm font-medium">{r.label}</p>
            <p className="mt-1 font-mono text-xs tabular-nums text-carup-text-3">{r.path}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
