import { Routes, Route } from 'react-router-dom'
import { useState, createContext, useContext, useEffect, lazy, Suspense } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useAuth } from './context/AuthContext'
import { WifiOff } from 'lucide-react'
import type { AuthUser, Notification } from '@shared/types'

// Layout
import MainLayout from './components/layout/MainLayout'
import DashboardLayout from './components/layout/DashboardLayout'
import { FeatureGovernanceLoader } from './context/FeatureGovernanceContext'
import { NotFoundPage } from './components/routing/FeatureStatePages'
import { AuthBootstrapLoading } from './components/routing/RegistryRouteBoundary'
import LazyRouteBoundary from './components/routing/LazyRouteBoundary'

// Public Pages
import Landing from './pages/Landing'
import Marketplace from './pages/Marketplace'
import MarketplaceCompare from './pages/MarketplaceCompare'
import MarketplaceCategoryPage from './pages/MarketplaceCategoryPage'
import VehicleDetail from './pages/VehicleDetail'
import VehicleSearch from './pages/VehicleSearch'
import SharedReport from './pages/SharedReport'
import DealerDirectory from './pages/DealerDirectory'
import GarageDirectory from './pages/GarageDirectory'
import InsuranceDirectory from './pages/InsuranceDirectory'
import Pricing from './pages/Pricing'
import About from './pages/About'
import Contact from './pages/Contact'
import ScrollToTop from './components/layout/ScrollToTop'

// New Footer Pages
import Careers from './pages/Careers'
import PressKit from './pages/PressKit'
import Blog from './pages/Blog'
import HelpCenter from './pages/HelpCenter'
import TrustSafety from './pages/TrustSafety'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'
import APIDocs from './pages/APIDocs'
import {
  DiasporaComplianceAdmin,
  DiasporaImportDetail,
  DiasporaImportDocuments,
  DiasporaImportList,
  DiasporaImportShipment,
  DiasporaLanding,
  NewDiasporaImportOrder,
} from './pages/diaspora/DiasporaTrade'
import DiasporaWorkbookDryRun from './pages/diaspora/DiasporaWorkbookDryRun'
import DiasporaWorkbookOperatorConsole from './pages/diaspora/DiasporaWorkbookOperatorConsole'

// Auth Pages
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import OTPVerification from './pages/auth/OTPVerification'
import KYCVerification from './pages/auth/KYCVerification'

// Owner Dashboard
import OwnerDashboard from './pages/dashboard/owner/OwnerDashboard'
import MyGarage from './pages/dashboard/owner/MyGarage'
import VehicleProfile from './pages/dashboard/owner/VehicleProfile'
import ServiceHistory from './pages/dashboard/owner/ServiceHistory'
import InsuranceRecords from './pages/dashboard/owner/InsuranceRecords'
import PartSentry from './pages/dashboard/owner/PartSentry'
import MyListings from './pages/dashboard/owner/MyListings'
import SavedCars from './pages/dashboard/owner/SavedCars'
import SellVehicle from './pages/dashboard/owner/SellVehicle'
import AIDashboard from './pages/dashboard/owner/AIDashboard'
import ReferralWallet from './pages/dashboard/owner/ReferralWallet'

// Dealer Dashboard
import DealerDashboard from './pages/dashboard/dealer/DealerDashboard'
import Inventory from './pages/dashboard/dealer/Inventory'
import Leads from './pages/dashboard/dealer/Leads'
import Promotions from './pages/dashboard/dealer/Promotions'
import SalesAnalytics from './pages/dashboard/dealer/SalesAnalytics'

// Mechanic Dashboard
import MechanicDashboard from './pages/dashboard/mechanic/MechanicDashboard'
import WorkOrders from './pages/dashboard/mechanic/WorkOrders'
import ServiceLogs from './pages/dashboard/mechanic/ServiceLogs'
import PartsTracking from './pages/dashboard/mechanic/PartsTracking'
import CustomerRecords from './pages/dashboard/mechanic/CustomerRecords'

// Insurance Dashboard
import InsuranceDashboard from './pages/dashboard/insurance/InsuranceDashboard'
import Claims from './pages/dashboard/insurance/Claims'
import RiskAnalysis from './pages/dashboard/insurance/RiskAnalysis'
import FraudAlerts from './pages/dashboard/insurance/FraudAlerts'

// Government Dashboard
import GovernmentDashboard from './pages/dashboard/government/GovernmentDashboard'
import RegistryVerification from './pages/dashboard/government/RegistryVerification'
import ComplianceReports from './pages/dashboard/government/ComplianceReports'

// Admin Dashboard
import AdminDashboard from './pages/dashboard/admin/AdminDashboard'
// Feature Governance Console is route-level lazy-loaded (Milestone D): it is a
// heavy admin-only surface, so it ships as a SEPARATE chunk fetched on demand
// rather than bloating the main entry bundle. The single dynamic import below is
// reused both by `lazy()` and by `preloadFeatureGovernanceConsole()` so the
// chunk is requested at most once.
const importFeatureGovernanceConsole = () =>
  import('./pages/dashboard/admin/FeatureGovernanceConsole')
const FeatureGovernanceConsole = lazy(importFeatureGovernanceConsole)

/**
 * Warm the Feature Governance Console chunk so an admin's first navigation to
 * /admin/features is instant. No-op for non-admins (gated by the caller). Safe
 * to call repeatedly — the dynamic import is memoized by the bundler.
 */
export function preloadFeatureGovernanceConsole() {
  importFeatureGovernanceConsole().catch(() => {
    /* Preload is best-effort; a failure here is harmless — the real navigation
       (with Suspense + LazyRouteBoundary) handles errors and retries. */
  })
}
import UserManagement from './pages/dashboard/admin/UserManagement'
import AIMonitoring from './pages/dashboard/admin/AIMonitoring'
import MarketplaceModeration from './pages/dashboard/admin/MarketplaceModeration'
import EvidenceReview from './pages/dashboard/admin/EvidenceReview'
import FraudQueue from './pages/dashboard/admin/FraudQueue'
import DealerCompliance from './pages/dashboard/admin/DealerCompliance'
import TrustReviewQueue from './pages/dashboard/shared/TrustReviewQueue'
import GovernanceReviewQueue from './pages/dashboard/shared/GovernanceReviewQueue'
import ReferralCampaigns from './pages/dashboard/admin/ReferralCampaigns'
import ReferralCodes from './pages/dashboard/admin/ReferralCodes'
import ReferralLocalLeads from './pages/dashboard/admin/ReferralLocalLeads'
import ReferralImportRoutes from './pages/dashboard/admin/ReferralImportRoutes'
import ReferralMarketing from './pages/dashboard/admin/ReferralMarketing'
import ReferralTrustReview from './pages/dashboard/admin/ReferralTrustReview'

// Bank Dashboard
import BankDashboard from './pages/dashboard/bank/BankDashboard'
import LendingQueue from './pages/dashboard/bank/LendingQueue'
import CollateralMap from './pages/dashboard/bank/CollateralMap'
import CreditRiskAnalysis from './pages/dashboard/bank/CreditRiskAnalysis'

// Context
interface AppContextType {
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
  isAuthenticated: boolean
  notifications: Notification[]
  currency: 'USD' | 'ZiG' | 'ZAR' | 'BWP'
  setCurrency: (c: 'USD' | 'ZiG' | 'ZAR' | 'BWP') => void
}

export const AppContext = createContext<AppContextType>({
  user: null,
  setUser: () => {},
  isAuthenticated: false,
  notifications: [],
  currency: 'USD',
  setCurrency: () => {}
})

export const useApp = () => useContext(AppContext)

export default function App() {
  const [currency, setCurrency] = useState<'USD' | 'ZiG' | 'ZAR' | 'BWP'>('USD')
  const { user, isAuthenticated } = useAuth()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

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

  // Warm the Feature Governance Console chunk on idle — but ONLY for an
  // authenticated admin (no-op for everyone else, so non-admins never fetch it).
  // This just preloads the bundle; it does not bypass the route guard, which
  // still re-evaluates auth/role when /admin/features is actually visited.
  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'admin') return
    const ric =
      (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback
    if (typeof ric === 'function') {
      const id = ric(() => preloadFeatureGovernanceConsole())
      const cic =
        (window as unknown as { cancelIdleCallback?: (id: number) => void })
          .cancelIdleCallback
      return () => { if (typeof cic === 'function') cic(id) }
    }
    const timer = setTimeout(() => preloadFeatureGovernanceConsole(), 2000)
    return () => clearTimeout(timer)
  }, [isAuthenticated, user?.role])

  return (
    <AppContext.Provider value={{
      user,
      setUser: () => {}, // Handled directly by AuthContext
      isAuthenticated,
      notifications: [],
      currency,
      setCurrency
    }}>
      {isOffline && (
        <div id="offline-banner" className="fixed top-0 left-0 right-0 z-50 bg-red-600/95 backdrop-blur-md text-white text-center py-2.5 text-xs font-semibold tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg border-b border-red-500/50 animate-in fade-in slide-in-from-top duration-300">
          <WifiOff className="w-4 h-4 animate-pulse text-red-100" />
          <span>You are currently offline. CarUp is running in offline local sync mode.</span>
        </div>
      )}
      <Toaster position="top-right" />
      <ScrollToTop />
      <FeatureGovernanceLoader>
      <Routes>
        {/* Public Routes */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/marketplace/parts" element={<MarketplaceCategoryPage kind="part" />} />
          <Route path="/marketplace/services" element={<MarketplaceCategoryPage kind="service" />} />
          <Route path="/marketplace/compare" element={<MarketplaceCompare />} />
          <Route path="/marketplace/listing/:id" element={<VehicleDetail />} />
          <Route path="/marketplace/:id" element={<VehicleDetail />} />
          <Route path="/search" element={<VehicleSearch />} />
          <Route path="/reports/shared/:token" element={<SharedReport />} />
          <Route path="/dealers" element={<DealerDirectory />} />
          <Route path="/garages" element={<GarageDirectory />} />
          <Route path="/insurance" element={<InsuranceDirectory />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/careers" element={<Careers />} />
          <Route path="/press" element={<PressKit />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/help" element={<HelpCenter />} />
          <Route path="/trust" element={<TrustSafety />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/api-docs" element={<APIDocs />} />
          <Route path="/diaspora" element={<DiasporaLanding />} />
          <Route path="/diaspora/imports" element={<DiasporaImportList />} />
          <Route path="/diaspora/imports/new" element={<NewDiasporaImportOrder />} />
          <Route path="/diaspora/imports/:id" element={<DiasporaImportDetail />} />
          <Route path="/diaspora/imports/:id/documents" element={<DiasporaImportDocuments />} />
          <Route path="/diaspora/imports/:id/shipment" element={<DiasporaImportShipment />} />
          <Route path="/admin/diaspora/compliance" element={<DiasporaComplianceAdmin />} />
          <Route path="/admin/diaspora/workbooks" element={<DiasporaWorkbookOperatorConsole />} />
          <Route path="/admin/diaspora/workbooks/new" element={<DiasporaWorkbookDryRun />} />
        </Route>

        {/* Auth Routes */}
        <Route element={<MainLayout hideNav />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-otp" element={<OTPVerification />} />
          <Route path="/kyc" element={<KYCVerification />} />
        </Route>

        {/* Owner Dashboard */}
        <Route element={<DashboardLayout role="owner" />}>
          <Route path="/dashboard" element={<OwnerDashboard />} />
          <Route path="/dashboard/garage" element={<MyGarage />} />
          <Route path="/dashboard/garage/:id" element={<VehicleProfile />} />
          <Route path="/dashboard/service-history" element={<ServiceHistory />} />
          <Route path="/dashboard/insurance" element={<InsuranceRecords />} />
          <Route path="/dashboard/partsentry" element={<PartSentry />} />
          <Route path="/dashboard/listings" element={<MyListings />} />
          <Route path="/dashboard/saved" element={<SavedCars />} />
          <Route path="/dashboard/sell-vehicle" element={<SellVehicle />} />
          <Route path="/dashboard/ai" element={<AIDashboard />} />
          <Route path="/dashboard/referrals" element={<ReferralWallet />} />
        </Route>

        {/* Dealer Dashboard */}
        <Route element={<DashboardLayout role="dealer" />}>
          <Route path="/dealer" element={<DealerDashboard />} />
          <Route path="/dealer/inventory" element={<Inventory />} />
          <Route path="/dealer/leads" element={<Leads />} />
          <Route path="/dealer/promotions" element={<Promotions />} />
          <Route path="/dealer/analytics" element={<SalesAnalytics />} />
          <Route path="/dealer/evidence" element={<EvidenceReview />} />
        </Route>

        {/* Mechanic Dashboard */}
        <Route element={<DashboardLayout role="mechanic" />}>
          <Route path="/mechanic" element={<MechanicDashboard />} />
          <Route path="/mechanic/work-orders" element={<WorkOrders />} />
          <Route path="/mechanic/service-logs" element={<ServiceLogs />} />
          <Route path="/mechanic/parts" element={<PartsTracking />} />
          <Route path="/mechanic/customers" element={<CustomerRecords />} />
        </Route>

        {/* Insurance Dashboard */}
        <Route element={<DashboardLayout role="insurance" />}>
          <Route path="/insurance-dash" element={<InsuranceDashboard />} />
          <Route path="/insurance-dash/claims" element={<Claims />} />
          <Route path="/insurance-dash/risk" element={<RiskAnalysis />} />
          <Route path="/insurance-dash/fraud" element={<FraudAlerts />} />
        </Route>

        {/* Government Dashboard */}
        <Route element={<DashboardLayout role="government" />}>
          <Route path="/government" element={<GovernmentDashboard />} />
          <Route path="/government/registry" element={<RegistryVerification />} />
          <Route path="/government/compliance" element={<ComplianceReports />} />
          <Route path="/government/evidence" element={<EvidenceReview />} />
          <Route path="/government/trust-review" element={<TrustReviewQueue />} />
        </Route>

        {/* Bank Dashboard */}
        <Route element={<DashboardLayout role="bank" />}>
          <Route path="/bank" element={<BankDashboard />} />
          <Route path="/bank/applications" element={<LendingQueue />} />
          <Route path="/bank/collateral" element={<CollateralMap />} />
          <Route path="/bank/risk" element={<CreditRiskAnalysis />} />
        </Route>

        {/* Admin Dashboard */}
        <Route element={<DashboardLayout role="admin" />}>
          <Route path="/admin" element={<AdminDashboard />} />
          {/* Lazy-loaded admin console. The admin guard lives in the parent
              <DashboardLayout role="admin"> route, which only renders <Outlet/>
              (this element) AFTER the auth/role gate passes — so authorization
              still runs before any console content can be fetched/shown. The
              LazyRouteBoundary catches chunk-load failures with a retry; the
              Suspense fallback shows the accessible bootstrap loader meanwhile. */}
          <Route
            path="/admin/features"
            element={
              <LazyRouteBoundary>
                <Suspense fallback={<AuthBootstrapLoading />}>
                  <FeatureGovernanceConsole />
                </Suspense>
              </LazyRouteBoundary>
            }
          />
          <Route path="/admin/users" element={<UserManagement />} />
          <Route path="/admin/ai" element={<AIMonitoring />} />
          <Route path="/admin/moderation" element={<MarketplaceModeration />} />
          <Route path="/admin/evidence" element={<EvidenceReview />} />
          <Route path="/admin/fraud-queue" element={<FraudQueue />} />
          <Route path="/admin/dealer-compliance" element={<DealerCompliance />} />
          <Route path="/admin/trust-review" element={<TrustReviewQueue />} />
          <Route path="/admin/governance-review" element={<GovernanceReviewQueue />} />
          <Route path="/government/governance-review" element={<GovernanceReviewQueue />} />
          <Route path="/admin/referrals" element={<ReferralCampaigns />} />
          <Route path="/admin/referrals/codes" element={<ReferralCodes />} />
          <Route path="/admin/referrals/local-leads" element={<ReferralLocalLeads />} />
          <Route path="/admin/referrals/import-routes" element={<ReferralImportRoutes />} />
          <Route path="/admin/referrals/marketing" element={<ReferralMarketing />} />
          <Route path="/admin/referrals/trust" element={<ReferralTrustReview />} />
        </Route>

        {/* Catch-all — unknown routes render the not-found page (previously blank) */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </FeatureGovernanceLoader>
    </AppContext.Provider>
  )
}
