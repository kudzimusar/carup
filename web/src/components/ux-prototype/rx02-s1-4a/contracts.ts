/**
 * RX-02A S1-4A — Unified shell prototype contracts (DEV-only).
 *
 * These types define the PROTOTYPE-LEVEL contracts for the three unified
 * application shells (PublicShell / WorkspaceShell / FocusedShell). They are
 * an exploration vehicle for the Owner's visual decision — they do NOT replace,
 * bypass, or re-implement any production authorization, routing, or governance
 * code. See docs/product-experience/RX02_S1_4A_SHELL_PROTOTYPE.md.
 */

/** The three unified shell families explored in S1-4A. */
export type ShellKind = 'public' | 'workspace' | 'focused'

/**
 * Workspace tenant families from the route-to-shell authority register
 * (docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv). The Trade
 * family is presented in this prototype by REFERENCE ONLY (see fixtures.ts).
 */
export type WorkspaceFamily =
  | 'personal'
  | 'dealer'
  | 'garage'
  | 'trade'
  | 'institutional'
  | 'admin'

/**
 * Focused-shell modes from the authority register's focused_mode column.
 */
export type FocusedMode = 'auth' | 'identity' | 'seller-claim' | 'flow' | 'review-decision'

/**
 * Prototype identity context. In production this data is session/tenant
 * derived and enforced server-side; here it is a FICTIONAL, LABELLED FIXTURE
 * (isFixture: true) so the chrome can be inspected without implying any real
 * access decision.
 */
export interface ShellIdentity {
  displayName: string
  roleTitle: string
  /** e.g. "fixture-dealer-001 · Avondale Motors (Pvt) Ltd" — fictional. */
  tenantLabel?: string
  isFixture: true
}

/** Full shell context handed to every shell component. */
export interface ShellContext {
  kind: ShellKind
  family?: WorkspaceFamily
  focusedMode?: FocusedMode
  identity: ShellIdentity
}

/**
 * Brand-asset slot. The Owner's brand asset is NOT yet approved for use, so
 * every slot renders a RESERVED LOCATION (dashed outline) with a truthful
 * text "CarUp" wordmark fallback. `fallbackToText` is pinned true in this
 * prototype; when brand assets ship, a resolver replaces the fallback without
 * touching shell chrome.
 */
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

/**
 * Route-to-shell assignment — one row of the authority register, typed for
 * the prototype. `shell` is the PROPOSED shell; nothing here is activated.
 */
export interface RouteShellAssignment {
  routeId: string
  path: string
  routeGroup: string
  shell: ShellKind | 'review-workbench' | 'context-aware-not-found'
  family?: WorkspaceFamily
  focusedMode?: FocusedMode
  reviewerIsolated: boolean
  migrationCaution?: string
}

/** Breadcrumb step shown in workspace chrome. */
export interface ShellBreadcrumbStep {
  label: string
  href?: string
}

/** Object identity block (workspace header). */
export interface ShellObjectIdentity {
  title: string
  /** Mono-spaced reference, e.g. a fictional unit/reference id. */
  reference: string
  statusLabel: string
  statusTone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  meta?: string[]
}

/** Exactly ONE prioritized primary action per surface (per directive). */
export interface ShellPrimaryAction {
  label: string
  onSelect: () => void
  disabled?: boolean
  disabledReason?: string
}
