import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'

export default function MainLayout({ hideNav = false }: { hideNav?: boolean }) {
  const location = useLocation()
  const isAuthPage = ['/login', '/register', '/verify-otp', '/kyc'].includes(location.pathname)

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