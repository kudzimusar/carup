/** Launch exposure only. Feature lifecycle and role/access authority remain upstream. */
export type LaunchState = 'LAUNCH_ACTIVE' | 'LAUNCH_ACTIVE_WITH_LIMIT' | 'PLANNED_DISABLED' | 'HIDDEN' | 'LEGAL_BLOCKER' | 'OWNER_DECISION'
export const PUBLIC_LAUNCH_ROUTES: ReadonlyArray<{ route: string; state: LaunchState; reason: string }> = [
  { route: '/', state: 'LAUNCH_ACTIVE', reason: 'Discovery using published inventory only.' },
  { route: '/marketplace', state: 'LAUNCH_ACTIVE', reason: 'Published listings; honest empty and failed states.' },
  { route: '/marketplace/:id', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Public listing/Passport projection only; private evidence remains gated.' },
  { route: '/search', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Existing identifier policy; private lookups require an account.' },
  { route: '/sell', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Browser draft; account and publication authority required for persistence/publishing.' },
  { route: '/dealers', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Canonical verified-dealer discovery; no invented partners.' },
  { route: '/garages', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Published garage profiles; organisation actions require authority.' },
  { route: '/garages/:slug', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Only the public-safe profile projection.' },
  { route: '/marketplace/parts', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Live availability and fitment; quote uses governed inquiry.' },
  { route: '/marketplace/services', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Existing service-discovery projection.' },
  { route: '/diaspora', state: 'LAUNCH_ACTIVE_WITH_LIMIT', reason: 'Public import information; orders and operator workspaces stay protected.' },
  ...['/trust', '/help', '/support', '/contact', '/security', '/about'].map(route => ({ route, state: 'LAUNCH_ACTIVE' as const, reason: 'Current product guidance and approved contact identities.' })),
  { route: '/pricing', state: 'OWNER_DECISION', reason: 'No approved commercial pricing; direct route explains this, excluded from launch navigation.' },
  { route: '/press', state: 'HIDDEN', reason: 'No current launch press release; direct reference page remains accessible.' },
  { route: '/careers', state: 'HIDDEN', reason: 'No active vacancies; no recruitment promise in launch navigation.' },
  { route: '/blog', state: 'HIDDEN', reason: 'Editorial reference remains accessible; no launch news programme promised.' },
  { route: '/api-docs', state: 'PLANNED_DISABLED', reason: 'J-R1 correctly disables obsolete public API documentation.' },
  { route: '/insurance', state: 'HIDDEN', reason: 'No production insurer/payment activation claimed.' },
  { route: '/privacy', state: 'LEGAL_BLOCKER', reason: 'Owner/legal-controlled draft. Required legal link retained; production launch blocked pending approval.' },
  { route: '/terms', state: 'LEGAL_BLOCKER', reason: 'Owner/legal-controlled draft. Required legal link retained; production launch blocked pending approval.' },
  { route: '*', state: 'LAUNCH_ACTIVE', reason: 'Explicit not-found UI; HTTP crawler status requires deployment-level resolution.' },
]
const HIDDEN_LAUNCH_ROUTES = new Set(PUBLIC_LAUNCH_ROUTES.filter(row => ['HIDDEN', 'OWNER_DECISION'].includes(row.state)).map(row => row.route))
export function isPublicLaunchNavigationRoute(route?: string): boolean {
  return !route || !HIDDEN_LAUNCH_ROUTES.has(route.split('?')[0])
}
