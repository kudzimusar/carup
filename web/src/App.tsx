import { Routes, Route, Navigate } from 'react-router-dom'
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
import GuestSell from './pages/GuestSell'
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
import ActivityInstrumentation from './components/intelligence/ActivityInstrumentation'

// New Footer Pages
import Careers from './pages/Careers'
import PressKit from './pages/PressKit'
import Blog from './pages/Blog'
import HelpCenter from './pages/HelpCenter'
import TrustSafety from './pages/TrustSafety'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'
import Support from './pages/Support'
import Security from './pages/Security'
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
import DiasporaOrderPassport from './pages/diaspora/DiasporaOrderPassport'
import DiasporaStockPassport from './pages/diaspora/DiasporaStockPassport'
import DiasporaWorkbookDryRun from './pages/diaspora/DiasporaWorkbookDryRun'
import DiasporaWorkbookOperatorConsole from './pages/diaspora/DiasporaWorkbookOperatorConsole'
import DiasporaStockManager from './pages/diaspora/DiasporaStockManager'
import DiasporaTradeProfile from './pages/diaspora/DiasporaTradeProfile'
import DiasporaReverseRfq from './pages/diaspora/DiasporaReverseRfq'
import DiasporaAiCommandCenter from './pages/diaspora/DiasporaAiCommandCenter'
import DiasporaContainerMarketplace from './pages/diaspora/DiasporaContainerMarketplace'
import DiasporaDriveConnections from './pages/diaspora/DiasporaDriveConnections'
import DiasporaSubscription from './pages/diaspora/DiasporaSubscription'
import DiasporaSafeTrade from './pages/diaspora/DiasporaSafeTrade'
import DiasporaSafeTradeDetail from './pages/diaspora/DiasporaSafeTradeDetail'
import DiasporaTradeGraph from './pages/diaspora/DiasporaTradeGraph'
import DiasporaSafeTradeOperations from './pages/diaspora/DiasporaSafeTradeOperations'
import DiasporaConfirmedImport from './pages/diaspora/DiasporaConfirmedImport'

// Auth Pages
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import VerifyEmail from './pages/auth/VerifyEmail'
import RegistrationJourney from './pages/onboarding/RegistrationJourney'
import KYCVerification from './pages/auth/KYCVerification'

// Owner Dashboard
import OwnerDashboard from './pages/dashboard/owner/OwnerDashboard'
import MyGarage from './pages/dashboard/owner/MyGarage'
import EvidenceVault from './pages/dashboard/owner/EvidenceVault'
import VehicleProfile from './pages/dashboard/owner/VehicleProfile'
import ServiceHistory from './pages/dashboard/owner/ServiceHistory'
import InsuranceRecords from './pages/dashboard/owner/InsuranceRecords'
import PartSentry from './pages/dashboard/owner/PartSentry'
import MyListings from './pages/dashboard/owner/MyListings'
import SavedCars from './pages/dashboard/owner/SavedCars'
import SellVehicle from './pages/dashboard/owner/SellVehicle'
import { SellerRouteErrorBoundary } from './components/sell/SellerRouteErrorBoundary'
import AIDashboard from './pages/dashboard/owner/AIDashboard'
import ReferralWallet from './pages/dashboard/owner/ReferralWallet'
import Communications from './pages/dashboard/owner/Communications'
import SellerIntelligence from './pages/dashboard/owner/SellerIntelligence'

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
function preloadFeatureGovernanceConsole() {
  importFeatureGovernanceConsole().catch(() => {
    /* Preload is best-effort; a failure here is harmless — the real navigation
       (with Suspense + LazyRouteBoundary) handles errors and retries. */
  })
}
import UserManagement from './pages/dashboard/admin/UserManagement'
import AIMonitoring from './pages/dashboard/admin/AIMonitoring'
import MarketplaceModeration from './pages/dashboard/admin/MarketplaceModeration'
import EvidenceReview from './pages/dashboard/admin/EvidenceReview'
import VehicleOperationsReview from './pages/dashboard/admin/VehicleOperationsReview'
import PeopleComplianceReview from './pages/dashboard/admin/PeopleComplianceReview'
import FraudQueue from './pages/dashboard/admin/FraudQueue'
import DealerCompliance from './pages/dashboard/admin/DealerCompliance'
import IdentityVerificationCaseManagement from './pages/dashboard/admin/IdentityVerificationCaseManagement'
import TrustReviewQueue from './pages/dashboard/shared/TrustReviewQueue'
import GovernanceReviewQueue from './pages/dashboard/shared/GovernanceReviewQueue'
import ReferralCampaigns from './pages/dashboard/admin/ReferralCampaigns'
import ReferralCodes from './pages/dashboard/admin/ReferralCodes'
import ReferralLocalLeads from './pages/dashboard/admin/ReferralLocalLeads'
import ReferralImportRoutes from './pages/dashboard/admin/ReferralImportRoutes'
import ReferralMarketing from './pages/dashboard/admin/ReferralMarketing'
import ReferralTrustReview from './pages/dashboard/admin/ReferralTrustReview'
import AdminCommunications from './pages/dashboard/admin/Communications'

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
          {/* G12: Email footers link "Support" and "Security" by name. These are their own routes,
              not aliases to /help or /trust, because a link whose label and destination disagree is
              exactly the small dishonesty an Email footer cannot afford. */}
          <Route path="/support" element={<Support />} />
          <Route path="/security" element={<Security />} />
          <Route path="/api-docs" element={<APIDocs />} />
          <Route path="/diaspora" element={<DiasporaLanding />} />
          <Route path="/diaspora/imports" element={<DiasporaImportList />} />
          <Route path="/diaspora/imports/new" element={<NewDiasporaImportOrder />} />
          <Route path="/diaspora/imports/:id" element={<DiasporaImportDetail />} />
          <Route path="/diaspora/imports/:id/documents" element={<DiasporaImportDocuments />} />
          <Route path="/diaspora/imports/:id/shipment" element={<DiasporaImportShipment />} />
          <Route path="/diaspora/imports/:id/passport" element={<DiasporaOrderPassport />} />
          <Route path="/diaspora/stock" element={<DiasporaStockManager />} />
          <Route path="/diaspora/trade-profile" element={<DiasporaTradeProfile />} />
          <Route path="/diaspora/stock/:id/passport" element={<DiasporaStockPassport />} />
          <Route path="/diaspora/rfq" element={<DiasporaReverseRfq />} />
          <Route path="/diaspora/ai-commands" element={<DiasporaAiCommandCenter />} />
          <Route path="/diaspora/containers" element={<DiasporaContainerMarketplace />} />
          <Route path="/diaspora/drive" element={<DiasporaDriveConnections />} />
          <Route path="/diaspora/subscription" element={<DiasporaSubscription />} />
          <Route path="/diaspora/safetrade" element={<DiasporaSafeTrade />} />
          <Route path="/diaspora/safetrade/:id" element={<DiasporaSafeTradeDetail />} />
          {/* UI-10 (Issue #127). The route always exists so flipping the UI flag on surfaces the
              nav entry without adding a duplicate route; with the flag off the page renders an
              explicit unavailable state and fetches nothing. */}
          <Route path="/diaspora/trade-graph" element={<DiasporaTradeGraph />} />
          {/* ST-3 operator console (Issue #127). Reviewer/admin only; the page renders its own
              access-denied state and the backend re-authorizes every call. */}
          <Route path="/diaspora/safetrade/operations" element={<DiasporaSafeTradeOperations />} />
          {/* Confirmed workbook import (Issue #127). Route always exists; the page renders its own
              unavailable state when the UI flag is off. */}
          <Route path="/diaspora/workbook/import" element={<DiasporaConfirmedImport />} />
          <Route path="/admin/diaspora/compliance" element={<DiasporaComplianceAdmin />} />
          <Route path="/admin/diaspora/workbooks" element={<DiasporaWorkbookOperatorConsole />} />
          <Route path="/admin/diaspora/workbooks/new" element={<DiasporaWorkbookDryRun />} />
        </Route>

        {/* Auth Routes */}
        <Route element={<MainLayout hideNav />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/onboarding" element={<RegistrationJourney />} />
          {/*
            SA1G: /verify-otp used to render a client-side placebo that accepted ANY six digits
            with no server verification. No backend OTP flow exists and nothing linked to it, so
            the fake security control was removed rather than left in place; the path redirects to
            the real supported auth journey so existing bookmarks do not 404.
          */}
          <Route path="/verify-otp" element={<Navigate to="/login" replace />} />
          <Route path="/auth/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          <Route path="/auth/verify-email" element={<VerifyEmail />} />
          <Route path="/kyc" element={<KYCVerification />} />
        </Route>

        {/* Owner Dashboard */}
        <Route element={<DashboardLayout role="owner" />}>
          <Route path="/dashboard" element={<OwnerDashboard />} />
          <Route path="/dashboard/garage" element={<MyGarage />} />
          <Route path="/dashboard/evidence" element={<EvidenceVault />} />
          <Route path="/dashboard/garage/:id" element={<VehicleProfile />} />
          <Route path="/dashboard/service-history" element={<ServiceHistory />} />
          <Route path="/dashboard/insurance" element={<InsuranceRecords />} />
          <Route path="/dashboard/partsentry" element={<PartSentry />} />
          <Route path="/dashboard/listings" element={<MyListings />} />
          <Route path="/dashboard/saved" element={<SavedCars />} />
          <Route path="/dashboard/sell-vehicle" element={<SellerRouteErrorBoundary><SellVehicle /></SellerRouteErrorBoundary>} />
          <Route path="/dashboard/ai" element={<AIDashboard />} />
          <Route path="/dashboard/referrals" element={<ReferralWallet />} />
          <Route path="/dashboard/communications" element={<Communications />} />
          <Route path="/dashboard/intelligence" element={<SellerIntelligence />} />
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
          {/* Operations M6: registry owns this route as government.governance-review
              (roles: government); it previously sat inside the ADMIN layout block,
              which contradicted the registry's ownership (manual §5.20). */}
          <Route path="/government/governance-review" element={<GovernanceReviewQueue />} />
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
          <Route path="/admin/vehicles/:vin/review" element={<VehicleOperationsReview />} />
          <Route path="/admin/people/:userId/review" element={<PeopleComplianceReview />} />
          <Route path="/admin/fraud-queue" element={<FraudQueue />} />
          <Route path="/admin/dealer-compliance" element={<DealerCompliance />} />
          <Route path="/admin/verification" element={<IdentityVerificationCaseManagement />} />
          <Route path="/admin/trust-review" element={<TrustReviewQueue />} />
          <Route path="/admin/governance-review" element={<GovernanceReviewQueue />} />
          <Route path="/admin/referrals" element={<ReferralCampaigns />} />
          <Route path="/admin/referrals/codes" element={<ReferralCodes />} />
          <Route path="/admin/referrals/local-leads" element={<ReferralLocalLeads />} />
          <Route path="/admin/referrals/import-routes" element={<ReferralImportRoutes />} />
          <Route path="/admin/referrals/marketing" element={<ReferralMarketing />} />
          <Route path="/admin/referrals/trust" element={<ReferralTrustReview />} />
          {/* Command Center nested routes (item 5): section surfaces + path-based thread deep-link. */}
          <Route path="/admin/communications" element={<AdminCommunications />} />
          <Route path="/admin/communications/inbox/:threadId" element={<AdminCommunications />} />
          <Route path="/admin/communications/:section" element={<AdminCommunications />} />
          <Route path="/dashboard/admin/communications" element={<AdminCommunications />} />
          <Route path="/dashboard/admin/communications/inbox/:threadId" element={<AdminCommunications />} />
          <Route path="/dashboard/admin/communications/:section" element={<AdminCommunications />} />
        </Route>

        {/* Catch-all — unknown routes render the not-found page (previously blank) */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </FeatureGovernanceLoader>
    </AppContext.Provider>
  )
}
