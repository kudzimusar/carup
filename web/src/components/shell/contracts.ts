/**
 * RX-02A S1-4B — Unified shell contracts (production-intent, default-OFF).
 *
 * These are the PRESENTATION contracts for the three unified application
 * shells (PublicShell / WorkspaceShell / FocusedShell). They describe chrome
 * and layout only. They do NOT replace, bypass, or re-implement any production
 * authorization, routing, tenancy, or governance code — route guards, the
 * session workspace authority, and server-side entitlement checks remain
 * authoritative. Derived from the approved S1-4A prototype (pull request 266) with the
 * fictional-fixture identity contract removed.
 */
import type { LucideIconName } from '@/config/featureRegistry'

/** Workspace tenant families from the route-to-shell authority register
 * (docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv). */
export type WorkspaceFamily =
  | 'personal'
  | 'dealer'
  | 'garage'
  | 'trade'
  | 'institutional'
  | 'admin'

/** Focused-shell presentation modes from the authority register's focused_mode column. */
export type FocusedMode = 'auth' | 'identity' | 'seller-claim' | 'flow' | 'review-decision'

/**
 * Real identity context shown in shell chrome. In production this is derived
 * from the verified session / server-authorized workspace; it is display-only
 * and never an authorization input. No fictional fixture identity is used.
 */
export interface ShellIdentity {
  /** Signed-in user's display name, or a generic visitor label when signed out. */
  displayName: string
  /** Human-readable role/family label for chrome (e.g. "Personal", "Dealer"). */
  roleTitle: string
  /** Verified organization / tenant label, when an authorized one is active. */
  tenantLabel?: string
}

/** Brand-asset slot. Official CarUp brand artwork is NOT yet approved for use,
 * so every slot renders a RESERVED LOCATION with a truthful text "CarUp"
 * wordmark fallback. `fallbackToText` is pinned true; when brand assets ship, a
 * resolver replaces the fallback without touching shell chrome. */
export interface BrandAssetSlot {
  slot:
    | 'public-masthead'
    | 'public-footer'
    | 'workspace-masthead'
    | 'workspace-rail'
    | 'focused-header'
    | 'mobile-drawer'
  /** 'ink' = on dark ink chrome (paper wordmark); 'light' = on light surface. */
  tone: 'ink' | 'light'
  fallbackToText: true
}

/** Manifest-projected navigation item (resolved from navigationManifest.ts). */
export interface ShellNavItem {
  id: string
  label: string
  href: string
  /** R4-3 — the registry icon metadata, preserved through the projection so
   *  each feature renders its own icon (fallback only when genuinely absent). */
  icon?: LucideIconName | null
  description?: string
  badge?: string
  /** Planned items are shown truthfully as "Soon" and never navigate. */
  planned: boolean
}

/** Manifest-projected navigation section. */
export interface ShellNavSection {
  title: string
  items: ShellNavItem[]
}

/** Breadcrumb step shown in workspace chrome. */
export interface ShellBreadcrumbStep {
  label: string
  href?: string
}

/** Object identity block (workspace header). */
export interface ShellObjectIdentity {
  title: string
  /** Mono-spaced reference, e.g. a unit / case / reference id. */
  reference: string
  statusLabel: string
  statusTone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  meta?: string[]
}

/** Exactly ONE prioritized primary action per surface. */
export interface ShellPrimaryAction {
  label: string
  onSelect: () => void
  disabled?: boolean
  disabledReason?: string
}
