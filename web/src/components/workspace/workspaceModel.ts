/**
 * R3 — the three CarUp workspaces one signed-in account moves between.
 *
 * A workspace is a business CONTEXT, never a login, a role or a second product. Moving between
 * them does not change who the user is, so nothing here asks anyone to sign out or switch account.
 * The customer-facing words are defined once, here, so no page can invent a fourth workspace or
 * leak an internal programme name into navigation.
 *
 *   My Vehicles      canonical ownership: the Garage and every Vehicle Passport
 *   Marketplace      selling: Seller Studio, My Listings, the buyer preview
 *   Trade & Imports  import orders, the import journey (CAP), documents, shipping, customs
 *
 * `VEHICLE != MARKETPLACE LISTING != IMPORT ORDER` — a vehicle can have either capability, both or
 * neither, so a workspace never owns a vehicle; it only owns the work done ON one.
 */
export type WorkspaceId = 'vehicles' | 'marketplace' | 'trade'

export interface WorkspaceDefinition {
  id: WorkspaceId
  /** The customer-facing name. */
  label: string
  /** Where "go to this workspace" lands. Must be a route the workspace's own roles can open. */
  root: string
  /** One short line of what lives here; used for assistive text, never as page copy. */
  summary: string
}

export const WORKSPACES: readonly WorkspaceDefinition[] = [
  { id: 'vehicles', label: 'My Vehicles', root: '/dashboard/garage', summary: 'Your vehicles and their Passports' },
  { id: 'marketplace', label: 'Marketplace', root: '/dashboard/listings', summary: 'Selling a vehicle on CarUp' },
  { id: 'trade', label: 'Trade & Imports', root: '/diaspora/imports', summary: 'Import orders, documents and shipping' },
]

export function workspaceDefinition(id: WorkspaceId): WorkspaceDefinition {
  const found = WORKSPACES.find((workspace) => workspace.id === id)
  // The union type makes this unreachable; the throw keeps a future id from silently rendering blank.
  if (!found) throw new Error(`Unknown workspace: ${String(id)}`)
  return found
}

/** One step of a breadcrumb trail. The last step is the current page and carries no link. */
export interface WorkspaceCrumb {
  label: string
  href?: string
}

/** The first crumb of every trail: the workspace itself, linking to its root. */
export function workspaceCrumb(id: WorkspaceId): WorkspaceCrumb {
  const workspace = workspaceDefinition(id)
  return { label: workspace.label, href: workspace.root }
}

/** Named second-level destinations, so every page spells and links them identically. */
export const WORKSPACE_SECTIONS = {
  garage: { label: 'My Garage', href: '/dashboard/garage' },
  listings: { label: 'My Listings', href: '/dashboard/listings' },
  importOrders: { label: 'Import Orders', href: '/diaspora/imports' },
} as const

/**
 * Destinations that are built from an id. One builder each, so no page spells a path its own way and an id is
 * never put into a URL unencoded. These are addresses, not permissions: whether a viewer may open one is the
 * registry's call (see workspaceAccess) and, for the data, the API's.
 */
export const vehiclePassportPath = (vin: string) => `/dashboard/garage/${encodeURIComponent(vin)}`
export const sellerStudioPath = (vin: string) => `/dashboard/sell-vehicle?vin=${encodeURIComponent(vin)}`
export const importOrderPath = (orderId: string) => `/diaspora/imports/${encodeURIComponent(orderId)}`
export const importJourneyPath = (orderId: string) => `/diaspora/journey/import_order/${encodeURIComponent(orderId)}`
export const vehicleJourneyPath = (vin: string) => `/diaspora/journey/vehicle/${encodeURIComponent(vin)}`

/**
 * Which workspace a path belongs to, for components that are handed no explicit `workspace`.
 * Returns null for paths no workspace owns (the public site, account pages, the shared inbox).
 */
export function workspaceForPath(pathname: string): WorkspaceId | null {
  const path = pathname.split(/[?#]/)[0] || ''
  if (path === '/dashboard/garage' || path.startsWith('/dashboard/garage/')) return 'vehicles'
  if (path === '/dashboard/listings' || path.startsWith('/dashboard/listings/')) return 'marketplace'
  if (path === '/dashboard/sell-vehicle' || path.startsWith('/dashboard/sell-vehicle/')) return 'marketplace'
  if (path === '/diaspora' || path.startsWith('/diaspora/')) return 'trade'
  return null
}

/** "2018 Honda Vezel" — the one way a vehicle is named in workspace chrome. Never invents a part. */
export function formatVehicleTitle(vehicle: { year?: number | string | null; make?: string | null; model?: string | null }): string {
  return [vehicle.year, vehicle.make, vehicle.model]
    .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
    .filter((part) => part !== '' && part !== '0')
    .join(' ')
}
