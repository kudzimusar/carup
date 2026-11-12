import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, createContext, useContext, useEffect, lazy, Suspense } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useAuth } from './context/AuthContext'
import { WifiOff } from 'lucide-react'
import type { AuthUser, Notification } from '@shared/types'

// May be used by future routes; harmless to keep while route-audit cleanup continues.
import MainLayout from './components/layout/MainLayout'
import DashboardLayout from './components/layout/DashboardLayout'
import { FeatureGovernanceLoader } from './context/FeatureGovernanceContext'
import { NotFoundPage } from './components/routing/FeatureStatePages'
// RX-02A S1-3: isolated component catalogue renderer (§10.3). Dev-only — the route
// below is gated behind import.meta.env.DEV, so no production surface is added.
import ComponentCatalogue from './pages/dev/ComponentCatalogue'
import { AuthBootstrapLoading } from './components/routing/RegistryRouteBoundary'
import LazyRouteBoundary from './components/routing/LazyRouteBoundary'

import LegacyDealerRouteGate from './components/dealer/LegacyDealerRouteGate'
import { useFeatureGovernance } from './context/FeatureGovernanceContext'
import { SellerRouteErrorBoundary } from './components/sell/SellerRouteErrorBoundary'
import ReferralImportRoutes from './pages/dashboard/admin/ReferralImportRoutes'
import BankDashboard from './pages/dashboard/bank/BankDashboard'
import LendingQueue from './pages/dashboard/bank/LendingQueue'
import CollateralMap from './pages/dashboard/bank/CollateralMap'
import CreditRiskAnalysis from './pages/dashboard/bank/CreditRiskAnalysis'
import { AdminBillingOverview } from './pages/dashboard/admin/AdminBillingOverview'
import { ImporterBillingOverview } from './pages/dashboard/importer/ImporterBillingOverview'
import { AdminImportOrders } from './pages/dashboard/admin/AdminImportOrders'
import { ImporterImportOrders } from './pages/dashboard/importer/ImporterImportOrders'
import { ImporterVehicles } from './pages/dashboard/importer/ImporterVehicles'
import { AdminDisputes } from './pages/dashboard/admin/AdminDisputes'
import { ImporterDisputes } from './pages/dashboard/importer/ImporterDisputes'
import { AdminValuationQueue } from './pages/dashboard/admin/AdminValuationQueue'
import { ValuationWorkspace } from './pages/dashboard/admin/ValuationWorkspace'
import { ImporterWorkOrders } from './pages/dashboard/importer/ImporterWorkOrders'
import { WorkOrderWorkspace } from './pages/dashboard/importer/WorkOrderWorkspace'
import { ImporterDealerAssignments } from './pages/dashboard/importer/ImporterDealerAssignments'
import { MechanicWorkOrders } from './pages/dashboard/mechanic/MechanicWorkOrders'
import { MechanicWorkOrderDetail } from './pages/dashboard/mechanic/MechanicWorkOrderDetail'
import { ClaimsDashboard } from './pages/dashboard/insurance/ClaimsDashboard'
import { ClaimDetail } from './pages/dashboard/insurance/ClaimDetail'
import { UnderwritingDashboard } from './pages/dashboard/insurance/UnderwritingDashboard'
import { PolicyDetail } from './pages/dashboard/insurance/PolicyDetail'
import { PartnerPerformance } from './pages/dashboard/insurance/PartnerPerformance'
import { FraudSignals } from './pages/dashboard/insurance/FraudSignals'
import { OpsReviewQueue } from './pages/dashboard/opsreview/OpsReviewQueue'
import { OpsReviewCase } from './pages/dashboard/opsreview/OpsReviewCase'
import { GovAdminDashboard } from './pages/dashboard/govadmin/GovAdminDashboard'
import { ComplianceCases } from './pages/dashboard/govadmin/ComplianceCases'
import { FieldOps } from './pages/dashboard/govadmin/FieldOps'
import { RegistrySync } from './pages/dashboard/govadmin/RegistrySync'
import { ActivityInstrumentation } from './components/routing/ActivityInstrumentation'
import { ScrollToTop } from './components/routing/ScrollToTop'

// Public pages (eager: landing + marketplace are the SEO-critical entry points)
import Landing from './pages/Landing'
import Marketplace from './pages/marketplace/Marketplace'
import MarketplaceCategoryPage from './pages/marketplace/MarketplaceCategoryPage'
import MarketplaceCompare from './pages/marketplace/MarketplaceCompare'
import VehicleDetail from './pages/marketplace/VehicleDetail'
import VehicleSearch from './pages/marketplace/VehicleSearch'
import SharedReport from './pages/marketplace/SharedReport'
import DealerDirectory from './pages/marketplace/DealerDirectory'
import DealerResearchProfile from './pages/marketplace/DealerResearchProfile'
import DealerResearchCorrection from './pages/marketplace/DealerResearchCorrection'
import DealerBuyerFeedback from './pages/marketplace/DealerBuyerFeedback'
import DealerClaimWorkspace from './pages/marketplace/DealerClaimWorkspace'
import DealerOperatingDetails from './pages/marketplace/DealerOperatingDetails'
import DealerBillingReadiness from './pages/marketplace/DealerBillingReadiness'
import DealerStaffConsole from './pages/marketplace/DealerStaffConsole'
import DealerTenantInventory from './pages/marketplace/DealerTenantInventory'
import GuestSell from './pages/sell/GuestSell'
import NotFoundPageLazy from './pages/NotFoundPage'

// Workspace pages (lazy: behind auth, not SEO-critical)
const OwnerDashboard = lazy(() => import('./pages/dashboard/owner/OwnerDashboard'))
const OwnerGarage = lazy(() => import('./pages/dashboard/owner/OwnerGarage'))
const OwnerVehicleDetail = lazy(() => import('./pages/dashboard/owner/OwnerVehicleDetail'))
const OwnerValuation = lazy(() => import('./pages/dashboard/owner/OwnerValuation'))
const OwnerSell = lazy(() => import('./pages/dashboard/owner/OwnerSell'))
const OwnerSettings = lazy(() => import('./pages/dashboard/owner/OwnerSettings'))
const OwnerNotifications = lazy(() => import('./pages/dashboard/owner/OwnerNotifications'))
const OwnerDocuments = lazy(() => import('./pages/dashboard/owner/OwnerDocuments'))
const DealerDashboard = lazy(() => import('./pages/dashboard/dealer/DealerDashboard'))
const DealerInventory = lazy(() => import('./pages/dashboard/dealer/DealerInventory'))
const DealerListings = lazy(() => import('./pages/dashboard/dealer/DealerListings'))
const DealerLeads = lazy(() => import('./pages/dashboard/dealer/DealerLeads'))
const DealerStaff = lazy(() => import('./pages/dashboard/dealer/DealerStaff'))
const DealerProfile = lazy(() => import('./pages/dashboard/dealer/DealerProfile'))
const DealerBilling = lazy(() => import('./pages/dashboard/dealer/DealerBilling'))
const ImporterDashboard = lazy(() => import('./pages/dashboard/importer/ImporterDashboard'))
const ImporterSettings = lazy(() => import('./pages/dashboard/importer/ImporterSettings'))
const MechanicDashboard = lazy(() => import('./pages/dashboard/mechanic/MechanicDashboard'))
const MechanicSettings = lazy(() => import('./pages/dashboard/mechanic/MechanicSettings'))
const InsuranceDashboard = lazy(() => import('./pages/dashboard/insurance/InsuranceDashboard'))
const InsuranceSettings = lazy(() => import('./pages/dashboard/insurance/InsuranceSettings'))
const GovAdminSettings = lazy(() => import('./pages/dashboard/govadmin/GovAdminSettings'))
const AdminDashboard = lazy(() => import('./pages/dashboard/admin/AdminDashboard'))
const AdminUsers = lazy(() => import('./pages/dashboard/admin/AdminUsers'))
const AdminDealers = lazy(() => import('./pages/dashboard/admin/AdminDealers'))
const AdminSettings = lazy(() => import('./pages/dashboard/admin/AdminSettings'))
const AdminAuditLog = lazy(() => import('./pages/dashboard/admin/AdminAuditLog'))
const AdminTrustSignals = lazy(() => import('./pages/dashboard/admin/AdminTrustSignals'))
const AdminCommunications = lazy(() => import('./pages/dashboard/admin/Communications'))

interface AppContextValue {
  isOffline: boolean
  notifications: Notification[]
  unreadCount: number
  markAllRead: () => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

export function useApp() {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useApp must be used within AppProvider')
  }
  return context
}

function App() {
  const { user, loading, isGuest } = useAuth()
  const { isEnabled } = useFeatureGovernance()
  const [isOffline, setIsOffline] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  if (loading) {
    return <AuthBootstrapLoading />
  }

  return (
    <AppContext.Provider
      value={{
        isOffline,
        notifications,
        unreadCount,
        markAllRead,
        sidebarOpen,
        setSidebarOpen,
      }}
    >
      {isOffline && (
        <div id="offline-banner" className="fixed top-0 left-0 right-0 z-50 bg-red-600/95 backdrop-blur-md text-white text-center py-2.5 text-xs font-semibold tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg border-b border-red-500/50 animate-in fade-in slide-in-from-top duration-300">
          <WifiOff className="w-4 h-4 animate-pulse text-red-100" />
          <span>You are currently offline. CarUp is running in offline local sync mode.</span>
        </div>
      )}
      <Toaster position="top-right" />
      <ScrollToTop />
      <ActivityInstrumentation />
      <FeatureGovernanceLoader>
      <Routes>
        {/* Public Routes */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/sell" element={<GuestSell />} />
          <Route path="/marketplace/parts" element={<MarketplaceCategoryPage kind="part" />} />
          <Route path="/marketplace/services" element={<MarketplaceCategoryPage kind="service" />} />
          <Route path="/marketplace/compare" element={<MarketplaceCompare />} />
          <Route path="/marketplace/listing/:id" element={<VehicleDetail />} />
          <Route path="/marketplace/:id" element={<VehicleDetail />} />
          <Route path="/search" element={<VehicleSearch />} />
          <Route path="/reports/shared/:token" element={<SharedReport />} />
          <Route path="/dealers" element={<DealerDirectory />} />
          <Route path="/dealers/feedback" element={<DealerBuyerFeedback />} />
          <Route path="/dealers/:seedId" element={<DealerResearchProfile />} />
          <Route path="/dealers/:seedId/claim" element={<DealerResearchProfile claimMode />} />
          <Route path="/dealers/:seedId/correction" element={<DealerResearchCorrection />} />
          <Route path="/dealers/claims" element={<DealerClaimWorkspace />} />
          <Route path="/dealers/operating-details" element={<DealerOperatingDetails />} />
          <Route path="/dealers/billing" element={<DealerBillingReadiness />} />
          <Route path="/dealers/staff" element={<DealerStaffConsole />} />
          <Route path="/dealers/stock" element={<DealerTenantInventory />} />
          <Route path="/guest-sell" element={<GuestSell />} />
          <Route path="/not-found" element={<NotFoundPageLazy />} />
        </Route>

        {/* Sell flow (error-bounded; workspace-adjacent but public entry) */}
        <Route element={<SellerRouteErrorBoundary />}>
          <Route path="/sell/*" element={<GuestSell />} />
        </Route>

        {/* RX-02A S1-3: component catalogue (isolated renderer, §10.3). Dev build only. */}
        {import.meta.env.DEV && <Route path="/dev/component-catalogue" element={<ComponentCatalogue />} />}

        {/* Catch-all — unknown routes render the not-found page (previously blank) */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </FeatureGovernanceLoader>
    </AppContext.Provider>
  )
}

export default App
