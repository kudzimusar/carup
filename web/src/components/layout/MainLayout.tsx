import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'
import CompactBottomNav from './CompactBottomNav'
import { getFeatureByRoute } from '@/config/featureRegistry'
import { RegistryRouteBoundary } from '@/components/routing/RegistryRouteBoundary'

export default function MainLayout({ hideNav = false }: { hideNav?: boolean }) {
  const location = useLocation()
  const feature = getFeatureByRoute(location.pathname)
  const isAuthPage = feature?.id.startsWith('auth.') ?? false

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {!hideNav && !isAuthPage && <Navbar />}
      <main className="flex-1 pb-20 lg:pb-0">
        {/* Lifecycle-only boundary: planned/disabled/deprecated/beta direct
            access is enforced even on public routes; auth/role is unchanged
            here (the dashboard layout owns auth/role enforcement). */}
        <RegistryRouteBoundary enforceAuth={false}>
          <Outlet />
        </RegistryRouteBoundary>
      </main>
      {!isAuthPage && <div className="hidden lg:block"><Footer /></div>}
      {!isAuthPage && <CompactBottomNav />}
    </div>
  )
}