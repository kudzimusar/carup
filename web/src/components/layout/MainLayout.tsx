import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'
import CompactBottomNav from './CompactBottomNav'
import { getFeatureByRoute } from '@/config/featureRegistry'
import { RegistryRouteBoundary } from '@/components/routing/RegistryRouteBoundary'
import { isShowroomChromeEnabled } from '@/lib/presentationFlags'
import { mainLayoutFooterMode } from './footerPresentation'
import { ShowroomUtilityFooter } from './ShowroomFooter'
import { AuthStage } from '@/components/auth/AuthStage'
import { focusedTaskFor } from '@/components/shell/focusedTitles'
import { FocusedEmbedContext } from '@/components/shell/FocusedEmbedContext'
import { safeReturnTarget } from '@/components/shell/safeReturn'

export default function MainLayout({ hideNav = false }: { hideNav?: boolean }) {
  const location = useLocation()
  const feature = getFeatureByRoute(location.pathname)
  const isAuthPage = feature?.id.startsWith('auth.') ?? false
  // RX03-P1b footer identity: the route → shell register decides public / utility / no footer while the
  // showroom chrome is on (footerPresentation.ts). Flags OFF: the legacy desktop-only footer, unchanged.
  const showroomChrome = isShowroomChromeEnabled()
  const footerMode = mainLayoutFooterMode(location.pathname)
  const showroomFooter = showroomChrome && !isAuthPage && footerMode !== 'none'
  const navigate = useNavigate()
  // RX03-AUTH: the five account routes render in the RX-03 account stage under the showroom chrome —
  // the stage owns logo, title and exit; the page renders its form once (FocusedEmbedContext).
  const accountTask = showroomChrome ? focusedTaskFor(location.pathname) : null
  if (accountTask) {
    return (
      <AuthStage title={accountTask.title} wide={accountTask.wide} onExit={() => navigate(safeReturnTarget(location))}>
        <FocusedEmbedContext.Provider value={true}>
          <RegistryRouteBoundary enforceAuth={false}>
            <Outlet />
          </RegistryRouteBoundary>
        </FocusedEmbedContext.Provider>
      </AuthStage>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {!hideNav && !isAuthPage && <Navbar />}
      {/* With the showroom chrome a footer is rendered on phones too and carries its own bottom-bar
          clearance; without a footer (or flags OFF) the main element keeps it, exactly as before. */}
      <main className={`flex-1 ${showroomFooter ? '' : 'pb-20'} lg:pb-0`}>
        {/* Lifecycle-only boundary: planned/disabled/deprecated/beta direct
            access is enforced even on public routes; auth/role is unchanged
            here (the dashboard layout owns auth/role enforcement). */}
        <RegistryRouteBoundary enforceAuth={false}>
          <Outlet />
        </RegistryRouteBoundary>
      </main>
      {!isAuthPage && (showroomChrome
        ? footerMode === 'public'
          ? <Footer />
          : footerMode === 'utility'
            ? <ShowroomUtilityFooter />
            : null
        : <div className="hidden lg:block"><Footer /></div>)}
      <CompactBottomNav />
    </div>
  )
}