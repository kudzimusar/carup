/**
 * RX-02A S1-4A — Route-to-shell assignment map (DEV-only).
 *
 * GENERATED from docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv
 * (139 rows, R001–R139) by the S1-4A generator script from that register — DO NOT HAND-EDIT.
 *
 * This map is DECLARATIVE INSPECTION DATA for the S1-4A prototype: it records
 * the PROPOSED shell per route family so the Owner can review the mapping in
 * a rendered UI. It is NOT an authorization engine, is not consulted by any
 * production route guard, and activates nothing. Real route families and their
 * ownership matrix are documented in
 * docs/product-experience/RX02_S1_4A_SHELL_PROTOTYPE.md.
 */
import type { RouteShellAssignment } from './contracts'

export const ROUTE_SHELL_ASSIGNMENTS: RouteShellAssignment[] = [
  { routeId: 'R001', path: '/', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R002', path: '/marketplace', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R003', path: '/sell', routeGroup: 'G2', shell: 'focused', focusedMode: 'seller-claim', reviewerIsolated: false, migrationCaution: 'Preserve account/tenant return and form state; check role guard' },
  { routeId: 'R004', path: '/marketplace/parts', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer; empty-by-design catalogues present as RFQ (TI-25)' },
  { routeId: 'R005', path: '/marketplace/services', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer; empty-by-design catalogues present as RFQ (TI-25)' },
  { routeId: 'R006', path: '/marketplace/compare', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public; max 5 items desktop / 2 mobile, highlight differences (NN/g)' },
  { routeId: 'R007', path: '/marketplace/listing/:id', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R008', path: '/marketplace/:id', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public; one shared VehicleIdentity + TrustLens; canonical deep link' },
  { routeId: 'R009', path: '/search', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R010', path: '/reports/shared/:token', routeGroup: 'G1', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R011', path: '/dealers', routeGroup: 'G5', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Legacy gate -> workspace; keep eligibility/redirect guard until safe retirement (RX-08)' },
  { routeId: 'R012', path: '/dealers/feedback', routeGroup: 'G5', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Legacy gate -> workspace; keep eligibility/redirect guard until safe retirement (RX-08)' },
  { routeId: 'R013', path: '/dealers/:seedId', routeGroup: 'G5', shell: 'public', reviewerIsolated: false, migrationCaution: 'Public research profile; claimed vs verified branch details; real no-rating state' },
  { routeId: 'R014', path: '/dealers/:seedId/claim', routeGroup: 'G5', shell: 'focused', focusedMode: 'seller-claim', reviewerIsolated: false, migrationCaution: 'Preserve account/tenant return and form state; check role guard' },
  { routeId: 'R015', path: '/dealers/:seedId/correction', routeGroup: 'G5', shell: 'focused', focusedMode: 'seller-claim', reviewerIsolated: false, migrationCaution: 'Preserve account/tenant return and form state; check role guard' },
  { routeId: 'R016', path: '/dealers/claims', routeGroup: 'G6', shell: 'focused', focusedMode: 'seller-claim', reviewerIsolated: false, migrationCaution: 'Focused claim flow; never a reviewer destination in dealer nav' },
  { routeId: 'R017', path: '/dealers/operating-details', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Keep canonical tenant grants; no public marketing footer' },
  { routeId: 'R018', path: '/dealers/billing', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Keep canonical tenant grants; no public marketing footer' },
  { routeId: 'R019', path: '/dealers/staff', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Keep canonical tenant grants; no public marketing footer' },
  { routeId: 'R020', path: '/dealers/stock', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Keep canonical tenant grants; no public marketing footer' },
  { routeId: 'R021', path: '/dealers/inquiries', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Keep canonical tenant grants; no public marketing footer; failures never render as empty (TI-13)' },
  { routeId: 'R022', path: '/garages', routeGroup: 'G13', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public; honest empty and verification states' },
  { routeId: 'R023', path: '/insurance', routeGroup: 'G14', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public; route and function preserved (Appendix F.1)' },
  { routeId: 'R024', path: '/pricing', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Commercial HOLD (TI-12): no active trial/price claim without provider authority' },
  { routeId: 'R025', path: '/about', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R026', path: '/contact', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R027', path: '/careers', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Content truth: no unverified salaried openings (TI-26)' },
  { routeId: 'R028', path: '/press', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Single legal entity in footer (TI-26)' },
  { routeId: 'R029', path: '/blog', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R030', path: '/help', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R031', path: '/trust', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R032', path: '/privacy', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R033', path: '/terms', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R034', path: '/support', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R035', path: '/security', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public, governed nav/footer and appropriate domain states' },
  { routeId: 'R036', path: '/api-docs', routeGroup: 'G15', shell: 'public', reviewerIsolated: false, migrationCaution: 'Content truth: document only endpoints that exist (TI-26)' },
  { routeId: 'R037', path: '/diaspora', routeGroup: 'G8', shell: 'public', reviewerIsolated: false, migrationCaution: 'Showroom/public landing; entry to import journey; footer link visible at all widths (MH-12)' },
  { routeId: 'R038', path: '/diaspora/imports', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Reparent from MainLayout; retain URLs, importer/reviewer permissions and source states' },
  { routeId: 'R039', path: '/diaspora/imports/new', routeGroup: 'G8', shell: 'focused', focusedMode: 'flow', reviewerIsolated: false, migrationCaution: 'Focused import creation; one goal per view; save-and-exit' },
  { routeId: 'R040', path: '/diaspora/imports/:id', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Import Order as anchor object: header, lifecycle rail, next action' },
  { routeId: 'R041', path: '/diaspora/imports/:id/documents', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Document task list: required / uploaded / verified-by-whom' },
  { routeId: 'R042', path: '/diaspora/imports/:id/shipment', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Milestone events with actor and voyage; CBCA pre-shipment stage' },
  { routeId: 'R043', path: '/diaspora/imports/:id/passport', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Passport as mode of the import object, not an orphan page (TI-18)' },
  { routeId: 'R044', path: '/diaspora/stock', routeGroup: 'G9', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Reparent from MainLayout; real stock operations' },
  { routeId: 'R045', path: '/diaspora/trade-profile', routeGroup: 'G9', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Profile reputation metric withheld until published method (TI-03)' },
  { routeId: 'R046', path: '/diaspora/stock/:id/passport', routeGroup: 'G9', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Stock passport as mode of stock object' },
  { routeId: 'R047', path: '/diaspora/rfq', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'RFQ linked to import pages end-to-end (TI-18); no fabricated quotes' },
  { routeId: 'R048', path: '/diaspora/ai-commands', routeGroup: 'G9', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Reparent from MainLayout' },
  { routeId: 'R049', path: '/diaspora/containers', routeGroup: 'G9', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Fix request-loop pattern before shell swap (TI-09, MH-09)' },
  { routeId: 'R050', path: '/diaspora/drive', routeGroup: 'G9', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Reparent from MainLayout' },
  { routeId: 'R051', path: '/diaspora/subscription', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Entitlement gates; no live-money implication (TI-12)' },
  { routeId: 'R052', path: '/diaspora/safetrade', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'SafeTrade state machine + non-custodial notices verbatim (FP-09)' },
  { routeId: 'R053', path: '/diaspora/safetrade/:id', routeGroup: 'G8', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Disputes, delivery, second-human review preserved' },
  { routeId: 'R054', path: '/diaspora/trade-graph', routeGroup: 'G9', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Reparent from MainLayout' },
  { routeId: 'R055', path: '/diaspora/safetrade/operations', routeGroup: 'G10', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Operations workbench; real transaction states only' },
  { routeId: 'R056', path: '/diaspora/workbook/import', routeGroup: 'G9', shell: 'workspace', family: 'trade', reviewerIsolated: false, migrationCaution: 'Workbook dry-run with explicit validations and audit statuses' },
  { routeId: 'R057', path: '/admin/diaspora/compliance', routeGroup: 'G10', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Reparent from MainLayout with existing access checks' },
  { routeId: 'R058', path: '/admin/diaspora/workbooks', routeGroup: 'G10', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Reparent from MainLayout with existing access checks' },
  { routeId: 'R059', path: '/admin/diaspora/workbooks/new', routeGroup: 'G10', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Reparent from MainLayout with existing access checks' },
  { routeId: 'R060', path: '/login', routeGroup: 'G3', shell: 'focused', focusedMode: 'auth', reviewerIsolated: false, migrationCaution: 'No public/mobile bottom bar; preserve CSRF/returnTo; demo-access controls removed (TI-01)' },
  { routeId: 'R061', path: '/register', routeGroup: 'G3', shell: 'focused', focusedMode: 'auth', reviewerIsolated: false, migrationCaution: 'No public/mobile bottom bar; preserve CSRF/returnTo; Sell returnTo contract' },
  { routeId: 'R062', path: '/verify-otp', routeGroup: 'G3', shell: 'focused', focusedMode: 'auth', reviewerIsolated: false, migrationCaution: 'No public/mobile bottom bar; preserve CSRF/returnTo' },
  { routeId: 'R063', path: '/auth/forgot-password', routeGroup: 'G3', shell: 'focused', focusedMode: 'auth', reviewerIsolated: false, migrationCaution: 'No public/mobile bottom bar; CSRF policy verified end-to-end (TI-11)' },
  { routeId: 'R064', path: '/auth/reset-password', routeGroup: 'G3', shell: 'focused', focusedMode: 'auth', reviewerIsolated: false, migrationCaution: 'No public/mobile bottom bar; preserve CSRF/returnTo' },
  { routeId: 'R065', path: '/auth/verify-email', routeGroup: 'G3', shell: 'focused', focusedMode: 'auth', reviewerIsolated: false, migrationCaution: 'No public/mobile bottom bar; preserve CSRF/returnTo' },
  { routeId: 'R066', path: '/kyc', routeGroup: 'G3', shell: 'focused', focusedMode: 'identity', reviewerIsolated: false, migrationCaution: 'No fake KYC; governed identity flow; wire to /api/identity/verification-sessions' },
  { routeId: 'R067', path: '/dashboard', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Task-first owner Today; no generic stat-card grid' },
  { routeId: 'R068', path: '/dashboard/garage', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Keep auth and vehicle context; personal My Garage is NOT the commercial Garage OS' },
  { routeId: 'R069', path: '/dashboard/evidence', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Keep auth and vehicle context' },
  { routeId: 'R070', path: '/dashboard/garage/:id', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Keep auth and vehicle context; Passport lens' },
  { routeId: 'R071', path: '/dashboard/service-history', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'No fabricated \'Next Service 500 km\' (TI-06, SC-16)' },
  { routeId: 'R072', path: '/dashboard/insurance', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Cannot claim policy data until authority exists; honest boundary' },
  { routeId: 'R073', path: '/dashboard/partsentry', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Never \'Ledger Verified\' for an empty ledger (TI-07)' },
  { routeId: 'R074', path: '/dashboard/listings', routeGroup: 'G2', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Seller-adjacent owner route; G2 exception per Appendix F' },
  { routeId: 'R075', path: '/dashboard/saved', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Keep auth and vehicle context; saved state survives refresh' },
  { routeId: 'R076', path: '/dashboard/sell-vehicle', routeGroup: 'G2', shell: 'focused', focusedMode: 'seller-claim', reviewerIsolated: false, migrationCaution: 'Preserve account/tenant return and form state; G2 exception per Appendix F' },
  { routeId: 'R077', path: '/dashboard/ai', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Keep auth and vehicle context; truthful AI context only' },
  { routeId: 'R078', path: '/dashboard/referrals', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Keep auth and vehicle context' },
  { routeId: 'R079', path: '/dashboard/communications', routeGroup: 'G4', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Keep auth and vehicle context; object-linked threads' },
  { routeId: 'R080', path: '/dashboard/intelligence', routeGroup: 'G2', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'G2 exception per Appendix F; truthful metrics only' },
  { routeId: 'R081', path: '/dealer/dashboard', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Keep canonical tenant grants; no public marketing footer; pilot route' },
  { routeId: 'R082', path: '/dealer', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Legacy gate -> redirects; keep eligibility guard until safe retirement' },
  { routeId: 'R083', path: '/dealer/inventory', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Legacy gate -> redirects; keep eligibility guard until safe retirement' },
  { routeId: 'R084', path: '/dealer/leads', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Legacy gate -> redirects; keep eligibility guard until safe retirement' },
  { routeId: 'R085', path: '/dealer/promotions', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Legacy gate -> redirects; keep eligibility guard until safe retirement' },
  { routeId: 'R086', path: '/dealer/analytics', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Legacy gate -> redirects; keep eligibility guard until safe retirement' },
  { routeId: 'R087', path: '/dealer/evidence', routeGroup: 'G6', shell: 'workspace', family: 'dealer', reviewerIsolated: false, migrationCaution: 'Legacy gate -> redirects; keep eligibility guard until safe retirement' },
  { routeId: 'R088', path: '/mechanic', routeGroup: 'G13', shell: 'workspace', family: 'garage', reviewerIsolated: false, migrationCaution: 'Preserve actual mechanic operations; verified tenant via context manifest (TI-19); no 0/$0 KPIs on failed read' },
  { routeId: 'R089', path: '/mechanic/work-orders', routeGroup: 'G13', shell: 'workspace', family: 'garage', reviewerIsolated: false, migrationCaution: 'Workbench queue -> job; honest failure states; unmerged Garage OS HOLD (OD-12)' },
  { routeId: 'R090', path: '/mechanic/service-logs', routeGroup: 'G13', shell: 'workspace', family: 'garage', reviewerIsolated: false, migrationCaution: 'Shared provenance chip; never \'Ledger Verified\' for empty ledger' },
  { routeId: 'R091', path: '/mechanic/parts', routeGroup: 'G13', shell: 'workspace', family: 'garage', reviewerIsolated: false, migrationCaution: 'Failed read never shown as empty; Garage stock HOLD (OD-12)' },
  { routeId: 'R092', path: '/mechanic/customers', routeGroup: 'G13', shell: 'workspace', family: 'garage', reviewerIsolated: false, migrationCaution: 'Fabricated CRM contained NOW: honest \'not available\', route kept (TI-04, OD-14)' },
  { routeId: 'R093', path: '/insurance-dash', routeGroup: 'G14', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Remove empty-constant claims and literal badges (TI-21, TI-06)' },
  { routeId: 'R094', path: '/insurance-dash/claims', routeGroup: 'G14', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Seed-only: honest state, route kept (OD-14)' },
  { routeId: 'R095', path: '/insurance-dash/risk', routeGroup: 'G14', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Verify data truth before release; contain if seed-only (OV)' },
  { routeId: 'R096', path: '/insurance-dash/fraud', routeGroup: 'G14', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Seed-only: honest state, route kept (OD-14)' },
  { routeId: 'R097', path: '/government', routeGroup: 'G12', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Preserve governmental review constraints; wording corrected (TI-21)' },
  { routeId: 'R098', path: '/government/registry', routeGroup: 'G12', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'RegistryVerification seed-only: honest state, route kept (OD-14)' },
  { routeId: 'R099', path: '/government/compliance', routeGroup: 'G12', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Preserve governmental review constraints' },
  { routeId: 'R100', path: '/government/evidence', routeGroup: 'G12', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Preserve governmental review constraints' },
  { routeId: 'R101', path: '/government/trust-review', routeGroup: 'G12', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Trust shown as evidence, never as a verdict' },
  { routeId: 'R102', path: '/government/governance-review', routeGroup: 'G12', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Preserve governmental review constraints' },
  { routeId: 'R103', path: '/bank', routeGroup: 'G14', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Keep bank scope and actual finance state; literal badges removed' },
  { routeId: 'R104', path: '/bank/applications', routeGroup: 'G14', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Correct wording/states/null-payment fault (TI-21); no live lending without authority' },
  { routeId: 'R105', path: '/bank/collateral', routeGroup: 'G14', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Keep bank scope and actual finance state' },
  { routeId: 'R106', path: '/bank/risk', routeGroup: 'G14', shell: 'workspace', family: 'institutional', reviewerIsolated: false, migrationCaution: 'Trust shown as evidence, never as a credit verdict' },
  { routeId: 'R107', path: '/admin', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R108', path: '/admin/features', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R109', path: '/admin/users', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R110', path: '/admin/ai', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Static operational metrics contained: honest not-tracked state (OD-14)' },
  { routeId: 'R111', path: '/admin/moderation', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R112', path: '/admin/evidence', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R113', path: '/admin/vehicles/:vin/review', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R114', path: '/admin/fraud-queue', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R115', path: '/admin/dealer-compliance', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R116', path: '/admin/verification', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R117', path: '/admin/trust-review', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R118', path: '/admin/governance-review', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R119', path: '/admin/referrals', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R120', path: '/admin/referrals/codes', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R121', path: '/admin/referrals/local-leads', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R122', path: '/admin/referrals/import-routes', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R123', path: '/admin/referrals/marketing', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R124', path: '/admin/referrals/trust', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R125', path: '/admin/communications', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R126', path: '/admin/communications/inbox/:threadId', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R127', path: '/admin/communications/:section', routeGroup: 'G11', shell: 'workspace', family: 'admin', reviewerIsolated: false, migrationCaution: 'Keep reviewed route/permission guards and context' },
  { routeId: 'R128', path: '/dashboard/admin/communications', routeGroup: 'G11', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Route rides personal shell per Appendix B; verify ownership at execution SHA' },
  { routeId: 'R129', path: '/dashboard/admin/communications/inbox/:threadId', routeGroup: 'G11', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Route rides personal shell per Appendix B; verify ownership at execution SHA' },
  { routeId: 'R130', path: '/dashboard/admin/communications/:section', routeGroup: 'G11', shell: 'workspace', family: 'personal', reviewerIsolated: false, migrationCaution: 'Route rides personal shell per Appendix B; verify ownership at execution SHA' },
  { routeId: 'R131', path: '/admin/dealer-claims', routeGroup: 'G7', shell: 'review-workbench', reviewerIsolated: true, migrationCaution: 'Separate reviewer authority, step-up, PII and audit; never linked as ordinary dealer action (NC-11)' },
  { routeId: 'R132', path: '/admin/dealer-research-review', routeGroup: 'G7', shell: 'review-workbench', reviewerIsolated: true, migrationCaution: 'Separate reviewer authority, step-up, PII and audit; no self-review' },
  { routeId: 'R133', path: '/admin/dealer-compliance-submissions', routeGroup: 'G7', shell: 'review-workbench', reviewerIsolated: true, migrationCaution: 'Separate reviewer authority, step-up, PII and audit' },
  { routeId: 'R134', path: '/admin/dealer-legal-activation', routeGroup: 'G7', shell: 'review-workbench', reviewerIsolated: true, migrationCaution: 'Separate reviewer authority, step-up, PII and audit' },
  { routeId: 'R135', path: '/admin/dealer-full-storefront-review', routeGroup: 'G7', shell: 'review-workbench', reviewerIsolated: true, migrationCaution: 'Separate reviewer authority, step-up, PII and audit' },
  { routeId: 'R136', path: '/admin/dealer-buyer-feedback', routeGroup: 'G7', shell: 'review-workbench', reviewerIsolated: true, migrationCaution: 'Separate reviewer authority, step-up, PII and audit' },
  { routeId: 'R137', path: '/admin/dealer-vehicle-evidence', routeGroup: 'G7', shell: 'review-workbench', reviewerIsolated: true, migrationCaution: 'Separate reviewer authority, step-up, PII and audit' },
  { routeId: 'R138', path: '/admin/dealer-operating-lifecycle', routeGroup: 'G7', shell: 'review-workbench', reviewerIsolated: true, migrationCaution: 'Separate reviewer authority, step-up, PII and audit' },
  { routeId: 'R139', path: '*', routeGroup: 'G16', shell: 'context-aware-not-found', reviewerIsolated: false, migrationCaution: '404 route, NOT a 403: unauthorized access to a real route renders an honest 403 response state; never drop auth/guard context; return route remains safe' },
]

/** Context-aware not-found assignment (R139). */
export const NOT_FOUND_ASSIGNMENT: RouteShellAssignment = {
  routeId: 'R139',
  path: '*',
  routeGroup: 'G16',
  shell: 'context-aware-not-found',
  reviewerIsolated: false,
  migrationCaution: 'Context-aware not-found: nearest-shell chrome, recovery links',
}

/**
 * Look up the proposed assignment for a concrete path (or another pattern).
 * Parameterized pattern segments (e.g. /marketplace/:id) match any concrete
 * segment at the same position. The catch-all '*' row is skipped for shape
 * matching and returned only by NOT_FOUND_ASSIGNMENT.
 */
export function lookupRouteShell(path: string): RouteShellAssignment | undefined {
  const segs = (p: string) => p.split('/').filter(Boolean)
  const target = segs(path)
  return ROUTE_SHELL_ASSIGNMENTS.find(a => {
    if (a.path === '*') return false
    const pa = segs(a.path)
    return pa.length === target.length && pa.every((seg, i) => seg.startsWith(':') || seg === target[i])
  })
}
