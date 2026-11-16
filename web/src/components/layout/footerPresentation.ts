import { matchPath } from 'react-router-dom'

/**
 * RX03-P1b footer identity — which footer a MainLayout route gets while the showroom chrome is on.
 *
 * The route → shell authority register (docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv)
 * decides it, not taste:
 *   - PublicShell routes get the brand/editorial public footer;
 *   - WorkspaceShell routes get a minimal utility footer — never a marketing sitemap around
 *     operational content (dealer, Trade, institutional);
 *   - FocusedShell routes get no footer during the task (sell draft, dealer claim, import request, KYC).
 * Auth pages already render no footer in MainLayout. Presentation only: no route, guard or element
 * changes here.
 *
 * R011 `/dealers` is registered WorkspaceShell(dealer), but it is the guest Dealer Directory and the
 * public footer's own "Dealers" entry point; it stays public here pending a register clarification.
 */
export type MainLayoutFooterMode = 'public' | 'utility' | 'none'

/** Register FocusedShell rows routed under MainLayout (R003, R014–R016, R039) + KYC (identity). */
const FOCUSED_PATTERNS: ReadonlyArray<string> = [
  '/sell',
  '/dealers/:seedId/claim',
  '/dealers/:seedId/correction',
  '/dealers/claims',
  '/diaspora/imports/new',
  '/kyc',
]

/** Register WorkspaceShell rows routed under MainLayout (R012, R017–R021, R038, R040–R059). */
const WORKSPACE_PATTERNS: ReadonlyArray<string> = [
  '/dealers/feedback',
  '/dealers/operating-details',
  '/dealers/billing',
  '/dealers/staff',
  '/dealers/stock',
  '/dealers/inquiries',
  '/diaspora/imports',
  '/diaspora/imports/:id',
  '/diaspora/imports/:id/documents',
  '/diaspora/imports/:id/shipment',
  '/diaspora/imports/:id/passport',
  '/diaspora/stock',
  '/diaspora/stock/:id/passport',
  '/diaspora/trade-profile',
  '/diaspora/rfq',
  '/diaspora/ai-commands',
  '/diaspora/containers',
  '/diaspora/drive',
  '/diaspora/subscription',
  '/diaspora/safetrade',
  '/diaspora/safetrade/operations',
  '/diaspora/safetrade/:id',
  '/diaspora/trade-graph',
  '/diaspora/workbook/import',
  '/admin/diaspora/compliance',
  '/admin/diaspora/workbooks',
  '/admin/diaspora/workbooks/new',
]

const matches = (patterns: ReadonlyArray<string>, pathname: string) =>
  patterns.some(pattern => matchPath(pattern, pathname) !== null)

export function mainLayoutFooterMode(pathname: string): MainLayoutFooterMode {
  // Literal segments first: '/dealers/claims' and '/diaspora/imports/new' must not read as :params.
  if (matches(FOCUSED_PATTERNS, pathname)) return 'none'
  if (matches(WORKSPACE_PATTERNS, pathname)) return 'utility'
  return 'public'
}
