import { describe, expect, it } from 'vitest'
import { canRoleAccessRoute } from '@/config/featureRegistry'
import {
  WORKSPACES,
  WORKSPACE_SECTIONS,
  formatVehicleTitle,
  workspaceCrumb,
  workspaceDefinition,
  workspaceForPath,
} from './workspaceModel'

describe('R3 workspace model', () => {
  it('defines exactly three workspaces, in the order a customer meets them', () => {
    expect(WORKSPACES.map((workspace) => workspace.id)).toEqual(['vehicles', 'marketplace', 'trade'])
    expect(WORKSPACES.map((workspace) => workspace.label)).toEqual(['My Vehicles', 'Marketplace', 'Trade & Imports'])
  })

  it('uses customer words only — no programme codes and no "Trade OS" as a workspace name', () => {
    for (const workspace of WORKSPACES) {
      for (const text of [workspace.label, workspace.summary]) {
        expect(text).not.toMatch(/Trade OS|\bT\d{1,2}\b|LR01|\bR\d\b|compositor|CAP-/i)
      }
    }
  })

  it('points every workspace root at a route an owner can actually open', () => {
    for (const workspace of WORKSPACES) {
      expect(canRoleAccessRoute('owner', workspace.root), workspace.root).toBe(true)
    }
  })

  it('maps a path to the workspace it belongs to, and to none when no workspace owns it', () => {
    const cases: Array<[string, string | null]> = [
      ['/dashboard/garage', 'vehicles'],
      ['/dashboard/garage/RU3-1316558', 'vehicles'],
      ['/dashboard/listings', 'marketplace'],
      ['/dashboard/sell-vehicle?vin=GFC27-027051', 'marketplace'],
      ['/diaspora/imports', 'trade'],
      ['/diaspora/imports/3e2b66a0-1e8b-43c9-bd48-507f88016f71', 'trade'],
      ['/diaspora/journey/import_order/abc', 'trade'],
      ['/dashboard/communications', null],
      ['/dashboard', null],
      ['/marketplace/GFC27-027051', null],
      ['/dashboard/garage-setup', null],
    ]
    for (const [path, expected] of cases) expect(workspaceForPath(path), path).toBe(expected)
  })

  it('opens a workspace by its own root and fails loudly on an unknown id', () => {
    expect(workspaceCrumb('trade')).toEqual({ label: 'Trade & Imports', href: '/diaspora/imports' })
    expect(workspaceDefinition('vehicles').root).toBe('/dashboard/garage')
    // @ts-expect-error — a fourth workspace must not be inventable by accident
    expect(() => workspaceDefinition('imports')).toThrow(/Unknown workspace/)
  })

  it('names second-level destinations once', () => {
    expect(WORKSPACE_SECTIONS.garage).toEqual({ label: 'My Garage', href: '/dashboard/garage' })
    expect(WORKSPACE_SECTIONS.listings.href).toBe('/dashboard/listings')
    expect(WORKSPACE_SECTIONS.importOrders.href).toBe('/diaspora/imports')
  })

  it('names a vehicle the same way everywhere and never invents a part of the name', () => {
    expect(formatVehicleTitle({ year: 2018, make: 'Honda', model: 'Vezel' })).toBe('2018 Honda Vezel')
    expect(formatVehicleTitle({ year: 0, make: 'Honda', model: null })).toBe('Honda')
    expect(formatVehicleTitle({ year: '  ', make: undefined, model: '' })).toBe('')
  })
})
