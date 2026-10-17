/**
 * T10.3 — the operator's loading workspace.
 *
 * What no backend test can prove: that the central act of the phase is reachable through the product
 * at all, that planning and loading are visibly different acts, and that capacity pressure is
 * visible while the plan is built rather than sprung as a refusal at the end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({
  view: null as unknown,
  err: null as Error | null,
  planItems: [] as unknown[],
  loadItems: [] as unknown[],
  seals: [] as unknown[],
  confirms: 0,
  completes: 0,
  opened: 0,
  plansCreated: 0,
  actionError: null as Error | null,
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'op1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getContainerLoadState: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
    createLoadPlan: vi.fn(async () => { state.plansCreated += 1; return { id: 'p1', reference: 'LPLN-1', status: 'DRAFT' } }),
    setLoadPlanItem: vi.fn(async (planId: string, payload: unknown) => { state.planItems.push({ planId, payload }); return {} }),
    confirmLoadPlan: vi.fn(async () => { if (state.actionError) throw state.actionError; state.confirms += 1; return { status: 'CONFIRMED' } }),
    openLoad: vi.fn(async () => { state.opened += 1; return { id: 'l1', reference: 'LOAD-1', status: 'IN_PROGRESS' } }),
    recordLoadItem: vi.fn(async (loadId: string, payload: unknown) => { state.loadItems.push({ loadId, payload }); return {} }),
    completeLoad: vi.fn(async () => { state.completes += 1; return { status: 'COMPLETED', actual_loaded_volume_cbm: 3.6 } }),
    recordSeal: vi.fn(async (loadId: string, payload: unknown) => { state.seals.push({ loadId, payload }); return {} }),
  }),
}))

import ContainerLoadingWorkspace from './ContainerLoadingWorkspace'

const RES_A = 'res-aaaa-0000-0000-0000-000000000001'
const RES_B = 'res-bbbb-0000-0000-0000-000000000002'

const candidate = (id: string, over = {}) => ({
  subject: { type: 'cargo_reservation', id },
  reference: `RES-${id.slice(0, 8).toUpperCase()}`,
  booked_volume_cbm: 3, warehouse_volume_cbm: 3.8,
  intake_status: 'RECEIVED', condition: 'good',
  readiness: {
    ready: true, blockers: [],
    facts: { booking_approved: true, received: true, measured_volume_cbm: 3.8, condition: 'good', documents_present: 0 },
    disclaimer: 'Ready to load means the cargo is here, measured and booked. It is not a statement about customs, duties or any legal permission to travel.',
  },
  ...over,
})

const view = (over = {}) => ({
  container: {
    id: 'cont-1', reference: 'SAIL-CONT0001', status: 'BOOKING_CLOSED',
    booked_capacity: { total_cbm: 33, used_cbm: 5.5, available_cbm: 27.5, basis: 'Booked space, from the approved reservations. Not what has been measured or loaded.' },
  },
  candidates: [candidate(RES_A)],
  summary: { total: 1, ready: 1, not_ready: 0, measured_ready_cbm: 3.8, unmeasured: 0 },
  plan: null,
  load: null,
  note: 'Loading is what went into the container. Whether it has left, and where it is, is recorded separately and is not shown here.',
  ...over,
})

const plan = (over = {}) => ({
  id: 'p1', reference: 'LPLN-1', status: 'DRAFT', confirmed_at: null,
  pressure: { container_total_cbm: 33, planned_in_cbm: 3.8, planned_in_lines: 1, lines_without_volume: 0, over_capacity: false, over_by_cbm: 0, headroom_cbm: 29.2, note: null },
  items: [{ subject: { type: 'cargo_reservation', id: RES_A }, disposition: 'PLANNED_IN', exclusion_reason: null, planned_volume_cbm: 3.8, planned_source: 'WAREHOUSE_ACTUAL' }],
  ...over,
})

const load = (over = {}) => ({
  id: 'l1', reference: 'LOAD-1', status: 'IN_PROGRESS', confirmed_at: null,
  actual_loaded_volume_cbm: null, items: [], container_number: null, seal_number: null, seal_history: 0,
  ...over,
})

const open = async (testId = 'container-loading-workspace') => {
  const user = userEvent.setup()
  render(<MemoryRouter><ContainerLoadingWorkspace /></MemoryRouter>)
  await user.type(screen.getByTestId('loading-sailing-input'), 'cont-1')
  await user.click(screen.getByTestId('loading-sailing-submit'))
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument())
  return user
}

beforeEach(() => {
  state.err = null; state.actionError = null; state.view = view()
  state.planItems = []; state.loadItems = []; state.seals = []
  state.confirms = 0; state.completes = 0; state.opened = 0; state.plansCreated = 0
})

describe('readiness', () => {
  it('shows booked and warehouse figures side by side', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-readiness')).toBeInTheDocument())
    expect(screen.getByTestId(`candidate-figures-${RES_A}`)).toHaveTextContent('Booked 3.000 CBM')
    expect(screen.getByTestId(`candidate-figures-${RES_A}`)).toHaveTextContent('Warehouse 3.800 CBM')
  })

  it('names every blocker AND whose problem it is', async () => {
    state.view = view({
      candidates: [candidate(RES_A, {
        warehouse_volume_cbm: null,
        readiness: {
          ready: false,
          blockers: [{ code: 'NOT_MEASURED', reason: 'Nobody has measured this cargo…' }],
          facts: { booking_approved: true, received: true, measured_volume_cbm: null, condition: 'good', documents_present: 0 },
          disclaimer: 'Ready to load means the cargo is here, measured and booked. It is not a statement about customs, duties or any legal permission to travel.',
        },
      })],
      summary: { total: 1, ready: 0, not_ready: 1, measured_ready_cbm: 0, unmeasured: 1 },
    })
    await open()
    await waitFor(() => expect(screen.getByTestId(`candidate-blockers-${RES_A}`)).toBeInTheDocument())
    expect(screen.getByTestId(`candidate-blockers-${RES_A}`)).toHaveTextContent('Not measured')
    expect(screen.getByTestId(`candidate-blockers-${RES_A}`)).toHaveTextContent('Warehouse')
    // Unknown stays unknown.
    expect(screen.getByTestId(`candidate-figures-${RES_A}`)).toHaveTextContent('Warehouse Not known')
  })

  it('never claims customs readiness', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-readiness-disclaimer')).toBeInTheDocument())
    expect(screen.getByTestId('loading-readiness-disclaimer')).toHaveTextContent('not a statement about customs')
  })

  it('labels T5 capacity as BOOKED, not as an actual', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-sailing')).toBeInTheDocument())
    expect(screen.getByTestId('loading-booked-capacity')).toHaveTextContent('Booked: 5.500 of 33.000 CBM')
    expect(screen.getByTestId('loading-sailing')).toHaveTextContent('Not what has been measured or loaded')
  })

  it('an unrecognised payload does not crash the screen', async () => {
    state.view = { data: [] }
    await open('loading-unreadable')
    expect(screen.getByTestId('loading-unreadable')).toHaveTextContent('not a report that this sailing has nothing in it')
  })
})

describe('a plan is not a load', () => {
  it('says so before a plan exists', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-plan')).toBeInTheDocument())
    expect(screen.getByTestId('loading-plan')).toHaveTextContent('it does not put anything in')
  })

  it('planning a consignment in records a PLAN line, not a manifest line', async () => {
    state.view = view({ plan: plan() })
    const user = await open()
    await waitFor(() => expect(screen.getByTestId(`plan-in-${RES_A}`)).toBeInTheDocument())
    await user.click(screen.getByTestId(`plan-in-${RES_A}`))
    await waitFor(() => expect(state.planItems).toHaveLength(1))
    expect(state.loadItems).toHaveLength(0)
  })

  it('shows WHICH figure the plan was built on', async () => {
    state.view = view({ plan: plan() })
    await open()
    await waitFor(() => expect(screen.getByTestId(`planned-${RES_A}`)).toBeInTheDocument())
    expect(screen.getByTestId(`planned-${RES_A}`)).toHaveTextContent('3.800 CBM from the warehouse measurement')
  })

  it('warns when a plan line rests on an estimate rather than a measurement', async () => {
    state.view = view({
      plan: plan({ items: [{ subject: { type: 'cargo_reservation', id: RES_A }, disposition: 'PLANNED_IN', exclusion_reason: null, planned_volume_cbm: 3, planned_source: 'BOOKED_ESTIMATE' }] }),
    })
    await open()
    await waitFor(() => expect(screen.getByTestId(`planned-${RES_A}`)).toBeInTheDocument())
    expect(screen.getByTestId(`planned-${RES_A}`)).toHaveTextContent('not measured')
  })

  it('requires a bounded reason to leave cargo off the plan', async () => {
    state.view = view({ plan: plan() })
    const user = await open()
    await waitFor(() => expect(screen.getByTestId(`plan-out-${RES_A}`)).toBeInTheDocument())
    const select = screen.getByTestId(`plan-out-${RES_A}`) as HTMLSelectElement
    // The default is a prompt, not a reason — an exclusion cannot happen by accident.
    expect(select.value).toBe('')
    await user.selectOptions(select, 'DOES_NOT_FIT')
    await waitFor(() => expect(state.planItems).toHaveLength(1))
    expect((state.planItems[0] as { payload: Record<string, unknown> }).payload.exclusionReason).toBe('DOES_NOT_FIT')
  })
})

describe('capacity pressure is visible while planning', () => {
  it('shows headroom when the plan fits', async () => {
    state.view = view({ plan: plan() })
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-pressure')).toBeInTheDocument())
    expect(screen.getByTestId('loading-pressure')).toHaveTextContent('29.200 CBM of room left')
  })

  it('shows the overage BEFORE the operator confirms', async () => {
    state.view = view({
      plan: plan({ pressure: { container_total_cbm: 4, planned_in_cbm: 6.3, planned_in_lines: 2, lines_without_volume: 0, over_capacity: true, over_by_cbm: 1.3, headroom_cbm: 0, note: null } }),
    })
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-pressure')).toBeInTheDocument())
    expect(screen.getByTestId('loading-pressure')).toHaveTextContent('1.300 CBM too much')
    expect(screen.getByTestId('loading-pressure')).toHaveTextContent('Take something out, with a reason')
  })

  it('surfaces the server refusal rather than swallowing it', async () => {
    state.view = view({ plan: plan({ pressure: { container_total_cbm: 4, planned_in_cbm: 6.3, planned_in_lines: 2, lines_without_volume: 0, over_capacity: true, over_by_cbm: 1.3, headroom_cbm: 0, note: null } }) })
    state.actionError = new Error('This plan puts 6.3 CBM into a 4 CBM container — 1.3 CBM too much.')
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('confirm-plan')).toBeInTheDocument())
    await user.click(screen.getByTestId('confirm-plan'))
    await waitFor(() => expect(screen.getByTestId('loading-error')).toBeInTheDocument())
    expect(screen.getByTestId('loading-error')).toHaveTextContent('1.3 CBM too much')
    expect(state.confirms).toBe(0)
  })

  it('carries the floor caveat when planned lines have no figure', async () => {
    state.view = view({
      plan: plan({ pressure: { container_total_cbm: 33, planned_in_cbm: 3.8, planned_in_lines: 3, lines_without_volume: 2, over_capacity: false, over_by_cbm: 0, headroom_cbm: 29.2, note: '2 planned line(s) have no measured volume, so this total is a floor rather than the whole plan.' } }),
    })
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-pressure')).toBeInTheDocument())
    expect(screen.getByTestId('loading-pressure')).toHaveTextContent('floor rather than the whole plan')
  })
})

describe('recording what actually went in', () => {
  it('is a separate act with its own form', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED', confirmed_at: '2026-09-12T10:00:00Z' }), load: load() })
    await open()
    await waitFor(() => expect(screen.getByTestId('load-item-form')).toBeInTheDocument())
    expect(screen.getByTestId('loading-actual')).toBeInTheDocument()
  })

  it('offers DISTINGUISHABLE options, even when two references render alike', async () => {
    // Found on the deployed queue at 393px: five candidates all read RES-99994444, because a short
    // reference is the first eight hex characters of an id. On a card that is confusing; in the
    // dropdown an operator picks from, it is dangerous.
    state.view = view({
      candidates: [
        candidate(RES_A, { reference: 'RES-SAME0000', booked_volume_cbm: 3, warehouse_volume_cbm: 3.8 }),
        candidate(RES_B, { reference: 'RES-SAME0000', booked_volume_cbm: 1.5, warehouse_volume_cbm: 1.2 }),
      ],
      plan: plan({ status: 'CONFIRMED' }), load: load(),
    })
    await open()
    await waitFor(() => expect(screen.getByTestId('load-item-subject')).toBeInTheDocument())
    const options = [...(screen.getByTestId('load-item-subject') as HTMLSelectElement).options]
      .filter((o) => o.value)
      .map((o) => o.textContent || '')
    expect(options).toHaveLength(2)
    expect(new Set(options).size).toBe(2)
    expect(options[0]).toContain('measured 3.800')
    expect(options[1]).toContain('measured 1.200')
  })

  it('shows each candidate\'s FULL reference so it can be checked against paperwork', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load() })
    await open()
    await waitFor(() => expect(screen.getByTestId(`candidate-full-${RES_A}`)).toBeInTheDocument())
    expect(screen.getByTestId(`candidate-full-${RES_A}`)).toHaveTextContent(RES_A)
  })

  it('sends the loaded volume and never a client-named loader', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load() })
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('load-item-form')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('load-item-subject'), RES_A)
    await user.type(screen.getByTestId('load-item-volume'), '3.6')
    await user.click(screen.getByTestId('load-item-submit'))
    await waitFor(() => expect(state.loadItems).toHaveLength(1))
    const payload = (state.loadItems[0] as { payload: Record<string, unknown> }).payload
    expect(payload).toMatchObject({ subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 })
    // The client has no field for it, and the server would ignore one.
    expect(payload).not.toHaveProperty('loadedBy')
    expect(payload).not.toHaveProperty('loaded_by')
  })

  it('will not submit a left-behind line without a reason', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load() })
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('load-item-form')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('load-item-subject'), RES_A)
    await user.selectOptions(screen.getByTestId('load-item-outcome'), 'LEFT_BEHIND')
    expect(screen.getByTestId('load-item-submit')).toBeDisabled()
    await user.selectOptions(screen.getByTestId('load-item-reason'), 'NO_SPACE')
    expect(screen.getByTestId('load-item-submit')).toBeEnabled()
  })

  it('shows left-behind lines on the manifest rather than hiding them', async () => {
    state.view = view({
      candidates: [candidate(RES_A), candidate(RES_B)],
      plan: plan({ status: 'CONFIRMED' }),
      load: load({
        items: [
          { subject: { type: 'cargo_reservation', id: RES_A }, outcome: 'LOADED', left_behind_reason: null, loaded_volume_cbm: 3.6, loaded_at: '2026-09-12T14:00:00Z' },
          { subject: { type: 'cargo_reservation', id: RES_B }, outcome: 'LEFT_BEHIND', left_behind_reason: 'NO_SPACE', loaded_volume_cbm: null, loaded_at: null },
        ],
      }),
    })
    await open()
    await waitFor(() => expect(screen.getByTestId('load-manifest')).toBeInTheDocument())
    expect(screen.getByTestId('load-manifest')).toHaveTextContent('No room left in the container')
    expect(screen.getByTestId(`manifest-${RES_B}`)).toHaveTextContent('Left behind')
  })

  it('reports an unstated total as not known, never zero', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load({ actual_loaded_volume_cbm: null }) })
    await open()
    await waitFor(() => expect(screen.getByTestId('load-total')).toBeInTheDocument())
    expect(screen.getByTestId('load-total')).toHaveTextContent('Not known')
    expect(screen.getByTestId('load-total')).not.toHaveTextContent('0.000')
  })
})

describe('container and seal', () => {
  it('reports unrecorded identifiers as unrecorded', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load() })
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-seal')).toBeInTheDocument())
    expect(screen.getByTestId('seal-container-number')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('seal-number')).toHaveTextContent('Not recorded')
  })

  it('warns against inventing an identifier', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load() })
    await open()
    await waitFor(() => expect(screen.getByTestId('seal-form')).toBeInTheDocument())
    expect(screen.getByTestId('seal-form')).toHaveTextContent('quote to a shipping line')
  })

  it('requires a reason to replace a seal', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load({ seal_number: 'SEAL-1', seal_history: 1 }) })
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('seal-form')).toBeInTheDocument())
    await user.type(screen.getByTestId('seal-seal-input'), 'SEAL-2')
    await user.click(screen.getByTestId('seal-replacing'))
    expect(screen.getByTestId('seal-submit')).toBeDisabled()
    await user.type(screen.getByTestId('seal-note'), 'Customs inspection at the gate')
    expect(screen.getByTestId('seal-submit')).toBeEnabled()
    await user.click(screen.getByTestId('seal-submit'))
    await waitFor(() => expect(state.seals).toHaveLength(1))
    expect((state.seals[0] as { payload: Record<string, unknown> }).payload.recordReason).toBe('SEAL_REPLACED')
  })

  it('says earlier seal records are kept', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load({ seal_number: 'SEAL-2', seal_history: 2 }) })
    await open()
    await waitFor(() => expect(screen.getByTestId('seal-history')).toBeInTheDocument())
    expect(screen.getByTestId('seal-history')).toHaveTextContent('stay on the record with who wrote them down')
  })

  it('links evidence to the ONE governed documents workspace', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load() })
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-evidence-link')).toBeInTheDocument())
    expect(screen.getByTestId('loading-evidence-link')).toHaveAttribute('href', '/diaspora/documents/container_load/l1')
  })
})

describe('the T11 firewall', () => {
  it('never offers a shipping, departure or customs action', async () => {
    state.view = view({
      plan: plan({ status: 'CONFIRMED' }),
      load: load({ status: 'COMPLETED', actual_loaded_volume_cbm: 3.6, container_number: 'MSKU1234567', seal_number: 'SEAL-2', seal_history: 2, items: [{ subject: { type: 'cargo_reservation', id: RES_A }, outcome: 'LOADED', left_behind_reason: null, loaded_volume_cbm: 3.6, loaded_at: '2026-09-12T14:00:00Z' }] }),
    })
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-actual')).toBeInTheDocument())
    const text = screen.getByTestId('container-loading-workspace').textContent?.toLowerCase() || ''
    for (const later of ['mark as shipped', 'departed', 'in transit', 'set sail', 'arrived', 'customs cleared']) {
      expect(text).not.toContain(later)
    }
  })

  it('marks its disclaimers AS disclaimers, so a scanner can tell stating from crossing', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load() })
    await open()
    await waitFor(() => expect(screen.getByTestId('seal-loaded-disclaimer')).toBeInTheDocument())
    expect(screen.getByTestId('seal-loaded-disclaimer')).toHaveTextContent('does not mean the container has sailed')
  })

  it('says loading is not departure, in words', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-disclaimer')).toBeInTheDocument())
    expect(screen.getByTestId('loading-disclaimer')).toHaveTextContent('Whether it has left')
    expect(screen.getByTestId('loading-disclaimer')).toHaveTextContent('not shown here')
  })

  it('offers no completion until something has actually been loaded', async () => {
    state.view = view({ plan: plan({ status: 'CONFIRMED' }), load: load({ items: [] }) })
    await open()
    await waitFor(() => expect(screen.getByTestId('loading-actual')).toBeInTheDocument())
    expect(screen.queryByTestId('complete-load')).not.toBeInTheDocument()
  })
})
