/**
 * OC-5D (P6) — the native Garage's service history, held to
 * shared/contracts/owner-service-history.v1.contract.json (the backend side is
 * backend/tests/oc5d-owner-service-history-contract.test.js).
 *
 * F1: the screen read `item.cost` — a key the endpoint never returned — and threw on the first
 * non-empty history. It also filled gaps with claims ("Verified", "General Maintenance", "$").
 *   · the renderer reads every field through toServiceLogView, and only contract keys;
 *   · nothing nullable is formatted without a guard: an entry with every nullable field null renders;
 *   · a missing fact is said to be missing; money appears only with its currency.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OwnerServiceHistoryEntry } from '@shared/types'
import { toServiceLogView } from '../utils/serviceHistoryView'

const ROOT = join(__dirname, '..')
const CONTRACT = JSON.parse(readFileSync(join(ROOT, '../shared/contracts/owner-service-history.v1.contract.json'), 'utf8'))
// Source pins read CODE: a comment that names the old defect (`item.cost`) must not count as a read.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const GARAGE = stripComments(readFileSync(join(ROOT, 'app/(tabs)/garage.tsx'), 'utf8'))
const VIEW = stripComments(readFileSync(join(ROOT, 'utils/serviceHistoryView.ts'), 'utf8'))

const ALLOWED = new Set([...Object.keys(CONTRACT.entry.required), ...Object.keys(CONTRACT.entry.optional)])

function bare(overrides: Partial<OwnerServiceHistoryEntry> = {}): OwnerServiceHistoryEntry {
  return {
    id: 'wo-1', vin: 'OC5DTESTVIN000001', status: null, description: null, issue_description: null,
    total_cost: null, labor_cost: null, created_at: null, updated_at: null, owner_authorization: null,
    money: { recorded: false, amount: null, currency: null },
    ...overrides,
  }
}

describe('the renderer reads only the contract', () => {
  it('every field the view reads is a contract key, and none is forbidden', () => {
    const read = new Set([...VIEW.matchAll(/entry\.(\w+)/g)].map((m) => m[1]))
    expect(read.size).toBeGreaterThan(0)
    for (const key of read) {
      expect(ALLOWED.has(key), `view reads ${key}, not in the contract`).toBe(true)
      expect(CONTRACT.entry.forbidden).not.toContain(key)
    }
  })

  it('garage.tsx renders a service log only through the view (no raw item.<field>)', () => {
    const start = GARAGE.indexOf('const renderServiceLog')
    const end = GARAGE.indexOf('const isLoading', start)
    expect(start).toBeGreaterThan(-1)
    const body = GARAGE.slice(start, end)
    expect(body).toContain('toServiceLogView(item)')
    // Past the signature and the one hand-off to the view, the entry is not touched at all — so no
    // `item.cost`, `item['cost']` or `(item as any).cost` can come back.
    const rest = body
      .replace(/\(\{\s*item\s*\}\s*:\s*\{\s*item\s*:\s*ServiceLog\s*\}\)/, '')
      .replace('toServiceLogView(item)', '')
    expect(rest).not.toMatch(/\bitem\b/)
    for (const key of CONTRACT.entry.forbidden) expect(GARAGE).not.toMatch(new RegExp(`ServiceLog[\\s\\S]{0,40}\\b${key}\\b`))
  })
})

describe('nothing nullable is formatted without a guard', () => {
  it('an entry with every nullable field null renders, and says what is missing', () => {
    const view = toServiceLogView(bare())
    expect(view.title).toBe('Service details not recorded')
    expect(view.dateLabel).toBe('Date not recorded')
    expect(view.costLabel).toBe('Cost not recorded')
    expect(view.costRecorded).toBe(false)
    expect(view.statusLabel).toBe('Status not recorded')
    expect(view.detail).toBeNull()
    expect(view.authorizationLabel).toBeNull()
  })

  it('no fabricated claims: never "Verified", "General Maintenance" or a dollar sign', () => {
    const rendered = JSON.stringify([
      toServiceLogView(bare()),
      toServiceLogView(bare({ total_cost: 85.5, status: 'Completed', description: 'Oil' })),
    ])
    expect(rendered).not.toMatch(/Verified|General Maintenance|\$/)
  })

  it('a number without a currency is not money; with a currency it is shown with it', () => {
    expect(toServiceLogView(bare({ total_cost: 85.5 })).costLabel).toBe('Cost not recorded')
    // even a payload that claims "recorded" is not money without its currency
    expect(toServiceLogView(bare({ money: { recorded: true, amount: 85.5, currency: null } })).costLabel).toBe('Cost not recorded')
    const priced = toServiceLogView(bare({ money: { recorded: true, amount: 1200, currency: 'ZAR' } }))
    expect(priced.costRecorded).toBe(true)
    expect(priced.costLabel).toMatch(/^ZAR 1[,.\s]?200$/)
  })

  it('falls back to the 006-era description and labels the owner\'s decision', () => {
    const view = toServiceLogView(bare({ issue_description: 'Brake squeal', owner_authorization: 'pending', created_at: '2026-01-10T09:00:00.000Z' }))
    expect(view.title).toBe('Brake squeal')
    expect(view.authorizationLabel).toBe('Awaiting owner authorization')
    expect(view.dateLabel).not.toBe('Date not recorded')
  })

  it('an unparseable date is "not recorded", not "Invalid Date"', () => {
    expect(toServiceLogView(bare({ created_at: 'yesterday-ish' })).dateLabel).toBe('Date not recorded')
  })
})
