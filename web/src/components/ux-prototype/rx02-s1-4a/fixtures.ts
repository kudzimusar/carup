/**
 * RX-02A S1-4A — Fictional fixtures for the shell prototype (DEV-only).
 *
 * EVERY identity, tenant, vehicle, price, and evidence row in this file is a
 * FICTIONAL, LABELLED FIXTURE for visual inspection only. None of it is real
 * data, none of it implies any access decision, and the adapter components in
 * fixtureDisplay.tsx make the fixture status visible wherever data appears.
 */
import type {
  FocusedMode,
  ShellContext,
  ShellIdentity,
  WorkspaceFamily,
} from './contracts'
import type { UserRole } from '@shared/types'

/** Single notice string used across the prototype. */
export const FICTIONAL_FIXTURE_NOTICE = 'Fictional fixture — not real data'

/** Public-shell context for a guest visitor. */
export const GUEST_PUBLIC_CONTEXT: ShellContext = {
  kind: 'public',
  identity: { displayName: 'Guest visitor', roleTitle: 'Public visitor', isFixture: true },
}

/** Public-shell context for a signed-in member (fictional). */
export const MEMBER_PUBLIC_CONTEXT: ShellContext = {
  kind: 'public',
  identity: { displayName: 'T. Moyo (fixture)', roleTitle: 'Car Owner', isFixture: true },
}

interface FamilyFixture {
  family: WorkspaceFamily
  role: UserRole
  identity: ShellIdentity
  familyLabel: string
}

const FAMILY_FIXTURES: FamilyFixture[] = [
  {
    family: 'personal',
    role: 'owner',
    identity: { displayName: 'T. Moyo (fixture)', roleTitle: 'Car Owner', tenantLabel: 'Personal workspace', isFixture: true },
    familyLabel: 'My CarUp',
  },
  {
    family: 'dealer',
    role: 'dealer',
    identity: { displayName: 'P. Ndlovu (fixture)', roleTitle: 'Dealer Principal', tenantLabel: 'fixture-dealer-001 · Avondale Motors (Pvt) Ltd', isFixture: true },
    familyLabel: 'Dealer OS',
  },
  {
    family: 'garage',
    role: 'mechanic',
    identity: { displayName: 'R. Chikore (fixture)', roleTitle: 'Workshop Manager', tenantLabel: 'fixture-garage-014 · Mainway Garage', isFixture: true },
    familyLabel: 'Garage OS',
  },
  {
    family: 'trade',
    role: 'dealer',
    identity: { displayName: 'Trade desk (fixture)', roleTitle: 'Trade Operator', tenantLabel: 'Trade workspace — reference only', isFixture: true },
    familyLabel: 'Trade',
  },
  {
    family: 'institutional',
    role: 'bank',
    identity: { displayName: 'K. Sibanda (fixture)', roleTitle: 'Asset Finance Officer', tenantLabel: 'fixture-inst-007 · Asset Finance', isFixture: true },
    familyLabel: 'Institutional',
  },
  {
    family: 'admin',
    role: 'admin',
    identity: { displayName: 'Ops reviewer (fixture)', roleTitle: 'Platform Operations', tenantLabel: 'Platform administration', isFixture: true },
    familyLabel: 'Administration',
  },
]

/**
 * Workspace fixture for a family. Role selection mirrors how the production
 * dashboard derives its sidebar from the session role — here it is a
 * FIXED FICTIONAL MAPPING for chrome inspection only.
 */
export function workspaceFixture(family: WorkspaceFamily): FamilyFixture {
  const found = FAMILY_FIXTURES.find(f => f.family === family)
  if (!found) throw new Error(`Unknown workspace family fixture: ${family}`)
  return found
}

interface FocusedFixture {
  mode: FocusedMode
  context: ShellContext
  title: string
  stepLabel: string
}

const FOCUSED_FIXTURES: FocusedFixture[] = [
  {
    mode: 'auth',
    context: {
      kind: 'focused',
      focusedMode: 'auth',
      identity: { displayName: 'Guest visitor', roleTitle: 'Public visitor', isFixture: true },
    },
    title: 'Sign in to CarUp',
    stepLabel: 'Step 1 of 2 — authentication',
  },
  {
    mode: 'identity',
    context: {
      kind: 'focused',
      focusedMode: 'identity',
      identity: { displayName: 'T. Moyo (fixture)', roleTitle: 'Car Owner', isFixture: true },
    },
    title: 'Confirm your identity',
    stepLabel: 'Step 2 of 3 — identity',
  },
  {
    mode: 'seller-claim',
    context: {
      kind: 'focused',
      focusedMode: 'seller-claim',
      identity: { displayName: 'P. Ndlovu (fixture)', roleTitle: 'Dealer Principal', isFixture: true },
    },
    title: 'Claim this dealership listing',
    stepLabel: 'Step 1 of 3 — claim',
  },
  {
    mode: 'flow',
    context: {
      kind: 'focused',
      focusedMode: 'flow',
      identity: { displayName: 'T. Moyo (fixture)', roleTitle: 'Car Owner', isFixture: true },
    },
    title: 'Create a listing',
    stepLabel: 'Step 1 of 4 — listing',
  },
  {
    mode: 'review-decision',
    context: {
      kind: 'focused',
      focusedMode: 'review-decision',
      identity: { displayName: 'Ops reviewer (fixture)', roleTitle: 'Platform Operations', isFixture: true },
    },
    title: 'Review decision',
    stepLabel: 'Decision — reviewer',
  },
]

/** Focused-shell fixture for a mode. */
export function focusedFixture(mode: FocusedMode): FocusedFixture {
  const found = FOCUSED_FIXTURES.find(f => f.mode === mode)
  if (!found) throw new Error(`Unknown focused mode fixture: ${mode}`)
  return found
}

/** Connected demonstration journey (route family → shell). Reviewer step is reference-only. */
export const JOURNEY_STEPS: Array<{
  key: string
  label: string
  routeFamily: string
  shell: 'public' | 'workspace' | 'reference'
  referenceOnly?: boolean
}> = [
  { key: 'home', label: 'Home', routeFamily: '/', shell: 'public' },
  { key: 'marketplace', label: 'Marketplace', routeFamily: '/marketplace', shell: 'public' },
  { key: 'vehicle', label: 'Vehicle detail', routeFamily: '/marketplace/:id', shell: 'public' },
  { key: 'my-carup', label: 'My CarUp', routeFamily: '/dashboard', shell: 'workspace' },
  { key: 'dealer', label: 'Dealer', routeFamily: '/dealer', shell: 'workspace' },
  { key: 'reviewer', label: 'Independent reviewer', routeFamily: '/admin/dealer-claims', shell: 'reference', referenceOnly: true },
]

/** Showcase scenario union handled by the dev page. */
export type ShowcaseScenario =
  | { shell: 'public'; page: 'home' | 'marketplace' | 'vehicle'; signedIn?: boolean }
  | { shell: 'workspace'; family: WorkspaceFamily; object: 'overview' | 'inventory' | 'vehicle' }
  | { shell: 'focused'; mode: FocusedMode }
  | { shell: 'reference'; ref: 'reviewer' | 'trade' }

/** Fictional vehicle used across public page fixtures. */
export const FIXTURE_VEHICLE = {
  title: 'Toyota Corolla 1.8 XS (fixture)',
  askingPrice: '$12,500',
  currency: 'USD',
  year: '2019',
  mileage: '61,000 km',
  location: 'Harare (fixture)',
}

/**
 * Fixture evidence rows — fictional actors/sources, shown through
 * FixtureEvidenceLine so no row ever reads as a real verification.
 */
export const FIXTURE_EVIDENCE_ROWS = [
  { actor: 'Fixture inspector A', source: 'Inspection worksheet (fixture)', time: '2026-10-02 10:14' },
  { actor: 'Fixture records desk', source: 'Registration extract (fixture)', time: '2026-10-03 09:40' },
  { actor: 'Fixture workshop', source: 'Service note scan (fixture)', time: '2026-10-05 15:22' },
]

/** Fixture trust state — "partial" only; no scores, no "verified" wording. */
export const FIXTURE_TRUST_STATE = {
  state: 'partial',
  label: 'Partially evaluated',
  sourceCount: 3,
} as const

/**
 * Reviewer workbench routes that EXIST on accepted main (independent reviewer
 * isolation is preserved there). Shown as reference cards only — this
 * prototype renders no reviewer workbench chrome.
 */
export const REVIEWER_REFERENCE_ROUTES = [
  { path: '/admin/dealer-claims', label: 'Dealer claim review' },
  { path: '/admin/dealer-research-review', label: 'Dealer research review' },
  { path: '/admin/dealer-compliance-submissions', label: 'Compliance application review' },
  { path: '/admin/dealer-vehicle-evidence', label: 'Vehicle evidence review' },
]

/**
 * Trade family routes exist on main behind their own proven controls. S1-4A
 * presents Trade BY REFERENCE ONLY — no trade shell chrome is built here.
 */
export const TRADE_REFERENCE_ROUTES = [
  { path: '/diaspora/imports', label: 'Import orders (main-backed)' },
  { path: '/diaspora/stock', label: 'Diaspora stock (main-backed)' },
  { path: '/diaspora/trade-profile', label: 'Trade profile (main-backed)' },
]
