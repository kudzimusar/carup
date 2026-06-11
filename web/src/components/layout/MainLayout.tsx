import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'
import { getFeatureByRoute } from '@/config/featureRegistry'

export default function MainLayout({ hideNav = false }: { hideNav?: boolean }) {
  const location = useLocation()
  const feature = getFeatureByRoute(location.pathname)
  const isAuthPage = feature?.id.startsWith('auth.') ?? false

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {!hideNav && !isAuthPage && <Navbar />}
      <main className="flex-1">
        <Outlet />
      </main>
      {!isAuthPage && <Footer />}
    </div>
  )
}