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
// RX-02A S1-3: isolated component catalogue renderer (§10.3). Dev-only — the route
// below is gated behind import.meta.env.DEV, so no production surface is added.
// RX07-CERT-02 (F4): created only in a dev build. Vite replaces `import.meta.env.DEV` with `false` in a
// production build, so the whole expression — including the dynamic import — is removed and no
// ComponentCatalogue chunk is emitted (a hidden route alone would still ship a fetchable file).
const ComponentCatalogue = import.meta.env.DEV
  ? lazyRoute(() => import('./pages/dev/ComponentCatalogue'), 'ComponentCatalogue')
  : null
import { AuthBootstrapLoading } from './components/routing/RegistryRouteBoundary'
import LazyRouteBoundary from './components/routing/LazyRouteBoundary'
import { lazyRoute } from './components/routing/lazyRoute'
import { warmJourney } from './lib/routeWarmup'

// Public Pages
const Landing = lazyRoute(() => import('./pages/Landing'), 'Landing')
const GuestSell = lazyRoute(() => import('./pages/GuestSell'), 'GuestSell')
const Marketplace = lazyRoute(() => import('./pages/Marketplace'), 'Marketplace')
const MarketplaceCompare = lazyRoute(() => import('./pages/MarketplaceCompare'), 'MarketplaceCompare')
const MarketplaceCategoryPage = lazyRoute(() => import('./pages/MarketplaceCategoryPage'), 'MarketplaceCategoryPage')
const VehicleDetail = lazyRoute(() => import('./pages/VehicleDetail'), 'VehicleDetail')
// RX03 showroom compositions: separate lazy chunks, selected per route by <ShowroomRoute>. With the
// showroom presentation OFF (the production default) these are never requested.
import { ShowroomRoute } from './components/showroom/ShowroomRoute'
import { isShowroomPagesEnabled } from './lib/presentationFlags'
const ShowroomLanding = lazyRoute(() => import('./pages/showroom/ShowroomLanding'), 'ShowroomLanding')
const ShowroomMarketplace = lazyRoute(() => import('./pages/showroom/ShowroomMarketplace'), 'ShowroomMarketplace')
const ShowroomVehicleDetail = lazyRoute(() => import('./pages/showroom/ShowroomVehicleDetail'), 'ShowroomVehicleDetail')
const VehicleSearch = lazyRoute(() => import('./pages/VehicleSearch'), 'VehicleSearch')
const SharedReport = lazyRoute(() => import('./pages/SharedReport'), 'SharedReport')
const DealerDirectory = lazyRoute(() => import('./pages/DealerDirectory'), 'DealerDirectory')
const DealerResearchProfile = lazyRoute(() => import('./pages/DealerResearchProfile'), 'DealerResearchProfile')
const DealerResearchCorrection = lazyRoute(() => import('./pages/DealerResearchCorrection'), 'DealerResearchCorrection')
const DealerClaimWorkspace = lazyRoute(() => import('./pages/DealerClaimWorkspace'), 'DealerClaimWorkspace')
const DealerClaimReview = lazyRoute(() => import('./pages/DealerClaimReview'), 'DealerClaimReview')
import DealerReviewerLayout from './components/dealer/DealerReviewerLayout'
const DealerOperatingLifecycleReview = lazyRoute(() => import('./pages/DealerOperatingLifecycleReview'), 'DealerOperatingLifecycleReview')
import DealerCanonicalWorkspaceLayout from './components/dealer/DealerCanonicalWorkspaceLayout'
import { UnifiedRouteShell } from './components/shell/UnifiedRouteShell'
import LegacyDealerRouteGate from './components/dealer/LegacyDealerRouteGate'
const LegacyDealerDashboard = lazyRoute(() => import('./pages/dashboard/dealer/LegacyDealerDashboard'), 'LegacyDealerDashboard')
const DealerResearchReview = lazyRoute(() => import('./pages/DealerResearchReview'), 'DealerResearchReview')
const DealerComplianceApplicationReview = lazyRoute(() => import('./pages/DealerComplianceApplicationReview'), 'DealerComplianceApplicationReview')
const DealerLegalActivationReview = lazyRoute(() => import('./pages/DealerLegalActivationReview'), 'DealerLegalActivationReview')
const DealerFullStorefrontReview = lazyRoute(() => import('./pages/DealerFullStorefrontReview'), 'DealerFullStorefrontReview')
const DealerOperatingDetails = lazyRoute(() => import('./pages/DealerOperatingDetails'), 'DealerOperatingDetails')
const DealerBillingReadiness = lazyRoute(() => import('./pages/DealerBillingReadiness'), 'DealerBillingReadiness')
const DealerStaffConsole = lazyRoute(() => import('./pages/DealerStaffConsole'), 'DealerStaffConsole')
const DealerTenantInventory = lazyRoute(() => import('./pages/DealerTenantInventory'), 'DealerTenantInventory')
const DealerTenantInquiries = lazyRoute(() => import('./pages/DealerTenantInquiries'), 'DealerTenantInquiries')
const DealerBuyerFeedback = lazyRoute(() => import('./pages/DealerBuyerFeedback'), 'DealerBuyerFeedback')
const DealerBuyerFeedbackReview = lazyRoute(() => import('./pages/DealerBuyerFeedbackReview'), 'DealerBuyerFeedbackReview')
const GarageDirectory = lazyRoute(() => import('./pages/GarageDirectory'), 'GarageDirectory')
const InsuranceDirectory = lazyRoute(() => import('./pages/InsuranceDirectory'), 'InsuranceDirectory')
const Pricing = lazyRoute(() => import('./pages/Pricing'), 'Pricing')
const About = lazyRoute(() => import('./pages/About'), 'About')
const Contact = lazyRoute(() => import('./pages/Contact'), 'Contact')
import ScrollToTop from './components/layout/ScrollToTop'
import ActivityInstrumentation from './components/intelligence/ActivityInstrumentation'

// New Footer Pages
const Careers = lazyRoute(() => import('./pages/Careers'), 'Careers')
const PressKit = lazyRoute(() => import('./pages/PressKit'), 'PressKit')
const Blog = lazyRoute(() => import('./pages/Blog'), 'Blog')
const HelpCenter = lazyRoute(() => import('./pages/HelpCenter'), 'HelpCenter')
const TrustSafety = lazyRoute(() => import('./pages/TrustSafety'), 'TrustSafety')
const PrivacyPolicy = lazyRoute(() => import('./pages/PrivacyPolicy'), 'PrivacyPolicy')
const TermsOfService = lazyRoute(() => import('./pages/TermsOfService'), 'TermsOfService')
const Support = lazyRoute(() => import('./pages/Support'), 'Support')
const Security = lazyRoute(() => import('./pages/Security'), 'Security')
const APIDocs = lazyRoute(() => import('./pages/APIDocs'), 'APIDocs')
// RX07: the Trade OS pages share one chunk, requested only when a Trade route is opened.
const importDiasporaTrade = () => import('./pages/diaspora/DiasporaTrade')
const DiasporaComplianceAdmin = lazyRoute(() => importDiasporaTrade().then(m => ({ default: m.DiasporaComplianceAdmin })), 'DiasporaComplianceAdmin')
const DiasporaImportDetail = lazyRoute(() => importDiasporaTrade().then(m => ({ default: m.DiasporaImportDetail })), 'DiasporaImportDetail')
const DiasporaImportDocuments = lazyRoute(() => importDiasporaTrade().then(m => ({ default: m.DiasporaImportDocuments })), 'DiasporaImportDocuments')
const DiasporaImportList = lazyRoute(() => importDiasporaTrade().then(m => ({ default: m.DiasporaImportList })), 'DiasporaImportList')
const DiasporaImportShipment = lazyRoute(() => importDiasporaTrade().then(m => ({ default: m.DiasporaImportShipment })), 'DiasporaImportShipment')
const DiasporaLanding = lazyRoute(() => importDiasporaTrade().then(m => ({ default: m.DiasporaLanding })), 'DiasporaLanding')
const NewDiasporaImportOrder = lazyRoute(() => importDiasporaTrade().then(m => ({ default: m.NewDiasporaImportOrder })), 'NewDiasporaImportOrder')
const DiasporaOrderPassport = lazyRoute(() => import('./pages/diaspora/DiasporaOrderPassport'), 'DiasporaOrderPassport')
const DiasporaStockPassport = lazyRoute(() => import('./pages/diaspora/DiasporaStockPassport'), 'DiasporaStockPassport')
const DiasporaWorkbookDryRun = lazyRoute(() => import('./pages/diaspora/DiasporaWorkbookDryRun'), 'DiasporaWorkbookDryRun')
const DiasporaWorkbookOperatorConsole = lazyRoute(() => import('./pages/diaspora/DiasporaWorkbookOperatorConsole'), 'DiasporaWorkbookOperatorConsole')
const DiasporaStockManager = lazyRoute(() => import('./pages/diaspora/DiasporaStockManager'), 'DiasporaStockManager')
const DiasporaTradeProfile = lazyRoute(() => import('./pages/diaspora/DiasporaTradeProfile'), 'DiasporaTradeProfile')
const DiasporaReverseRfq = lazyRoute(() => import('./pages/diaspora/DiasporaReverseRfq'), 'DiasporaReverseRfq')
const DiasporaAiCommandCenter = lazyRoute(() => import('./pages/diaspora/DiasporaAiCommandCenter'), 'DiasporaAiCommandCenter')
const DiasporaContainerMarketplace = lazyRoute(() => import('./pages/diaspora/DiasporaContainerMarketplace'), 'DiasporaContainerMarketplace')
const DiasporaDriveConnections = lazyRoute(() => import('./pages/diaspora/DiasporaDriveConnections'), 'DiasporaDriveConnections')
const DiasporaSubscription = lazyRoute(() => import('./pages/diaspora/DiasporaSubscription'), 'DiasporaSubscription')
const DiasporaSafeTrade = lazyRoute(() => import('./pages/diaspora/DiasporaSafeTrade'), 'DiasporaSafeTrade')
const DiasporaSafeTradeDetail = lazyRoute(() => import('./pages/diaspora/DiasporaSafeTradeDetail'), 'DiasporaSafeTradeDetail')
const DiasporaTradeGraph = lazyRoute(() => import('./pages/diaspora/DiasporaTradeGraph'), 'DiasporaTradeGraph')
const DiasporaSafeTradeOperations = lazyRoute(() => import('./pages/diaspora/DiasporaSafeTradeOperations'), 'DiasporaSafeTradeOperations')
const DiasporaConfirmedImport = lazyRoute(() => import('./pages/diaspora/DiasporaConfirmedImport'), 'DiasporaConfirmedImport')

// Auth Pages
const Login = lazyRoute(() => import('./pages/auth/Login'), 'Login')
const Register = lazyRoute(() => import('./pages/auth/Register'), 'Register')
const ForgotPassword = lazyRoute(() => import('./pages/auth/ForgotPassword'), 'ForgotPassword')
const ResetPassword = lazyRoute(() => import('./pages/auth/ResetPassword'), 'ResetPassword')
const VerifyEmail = lazyRoute(() => import('./pages/auth/VerifyEmail'), 'VerifyEmail')
const KYCVerification = lazyRoute(() => import('./pages/auth/KYCVerification'), 'KYCVerification')

// Owner Dashboard
const OwnerDashboard = lazyRoute(() => import('./pages/dashboard/owner/OwnerDashboard'), 'OwnerDashboard')
const MyGarage = lazyRoute(() => import('./pages/dashboard/owner/MyGarage'), 'MyGarage')
const EvidenceVault = lazyRoute(() => import('./pages/dashboard/owner/EvidenceVault'), 'EvidenceVault')
const VehicleProfile = lazyRoute(() => import('./pages/dashboard/owner/VehicleProfile'), 'VehicleProfile')
const ServiceHistory = lazyRoute(() => import('./pages/dashboard/owner/ServiceHistory'), 'ServiceHistory')
const InsuranceRecords = lazyRoute(() => import('./pages/dashboard/owner/InsuranceRecords'), 'InsuranceRecords')
const PartSentry = lazyRoute(() => import('./pages/dashboard/owner/PartSentry'), 'PartSentry')
const MyListings = lazyRoute(() => import('./pages/dashboard/owner/MyListings'), 'MyListings')
const SavedCars = lazyRoute(() => import('./pages/dashboard/owner/SavedCars'), 'SavedCars')
const SellVehicle = lazyRoute(() => import('./pages/dashboard/owner/SellVehicle'), 'SellVehicle')
import { SellerRouteErrorBoundary } from './components/sell/SellerRouteErrorBoundary'
const AIDashboard = lazyRoute(() => import('./pages/dashboard/owner/AIDashboard'), 'AIDashboard')
const ReferralWallet = lazyRoute(() => import('./pages/dashboard/owner/ReferralWallet'), 'ReferralWallet')
const Communications = lazyRoute(() => import('./pages/dashboard/owner/Communications'), 'Communications')
const SellerIntelligence = lazyRoute(() => import('./pages/dashboard/owner/SellerIntelligence'), 'SellerIntelligence')

// Dealer Dashboard
const DealerDashboard = lazyRoute(() => import('./pages/dashboard/dealer/DealerDashboard'), 'DealerDashboard')
const Inventory = lazyRoute(() => import('./pages/dashboard/dealer/Inventory'), 'Inventory')
const Leads = lazyRoute(() => import('./pages/dashboard/dealer/Leads'), 'Leads')
const Promotions = lazyRoute(() => import('./pages/dashboard/dealer/Promotions'), 'Promotions')
const SalesAnalytics = lazyRoute(() => import('./pages/dashboard/dealer/SalesAnalytics'), 'SalesAnalytics')

// Mechanic Dashboard
const MechanicDashboard = lazyRoute(() => import('./pages/dashboard/mechanic/MechanicDashboard'), 'MechanicDashboard')
const WorkOrders = lazyRoute(() => import('./pages/dashboard/mechanic/WorkOrders'), 'WorkOrders')
const ServiceLogs = lazyRoute(() => import('./pages/dashboard/mechanic/ServiceLogs'), 'ServiceLogs')
const PartsTracking = lazyRoute(() => import('./pages/dashboard/mechanic/PartsTracking'), 'PartsTracking')
const CustomerRecords = lazyRoute(() => import('./pages/dashboard/mechanic/CustomerRecords'), 'CustomerRecords')

// Insurance Dashboard
const InsuranceDashboard = lazyRoute(() => import('./pages/dashboard/insurance/InsuranceDashboard'), 'InsuranceDashboard')
const Claims = lazyRoute(() => import('./pages/dashboard/insurance/Claims'), 'Claims')
const RiskAnalysis = lazyRoute(() => import('./pages/dashboard/insurance/RiskAnalysis'), 'RiskAnalysis')
const FraudAlerts = lazyRoute(() => import('./pages/dashboard/insurance/FraudAlerts'), 'FraudAlerts')

// Government Dashboard
const GovernmentDashboard = lazyRoute(() => import('./pages/dashboard/government/GovernmentDashboard'), 'GovernmentDashboard')
const RegistryVerification = lazyRoute(() => import('./pages/dashboard/government/RegistryVerification'), 'RegistryVerification')
const ComplianceReports = lazyRoute(() => import('./pages/dashboard/government/ComplianceReports'), 'ComplianceReports')

// Admin Dashboard
const AdminDashboard = lazyRoute(() => import('./pages/dashboard/admin/AdminDashboard'), 'AdminDashboard')
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
const UserManagement = lazyRoute(() => import('./pages/dashboard/admin/UserManagement'), 'UserManagement')
const AIMonitoring = lazyRoute(() => import('./pages/dashboard/admin/AIMonitoring'), 'AIMonitoring')
const MarketplaceModeration = lazyRoute(() => import('./pages/dashboard/admin/MarketplaceModeration'), 'MarketplaceModeration')
const EvidenceReview = lazyRoute(() => import('./pages/dashboard/admin/EvidenceReview'), 'EvidenceReview')
const VehicleOperationsReview = lazyRoute(() => import('./pages/dashboard/admin/VehicleOperationsReview'), 'VehicleOperationsReview')
const FraudQueue = lazyRoute(() => import('./pages/dashboard/admin/FraudQueue'), 'FraudQueue')
const DealerCompliance = lazyRoute(() => import('./pages/dashboard/admin/DealerCompliance'), 'DealerCompliance')
const IdentityVerificationCaseManagement = lazyRoute(() => import('./pages/dashboard/admin/IdentityVerificationCaseManagement'), 'IdentityVerificationCaseManagement')
const TrustReviewQueue = lazyRoute(() => import('./pages/dashboard/shared/TrustReviewQueue'), 'TrustReviewQueue')
const GovernanceReviewQueue = lazyRoute(() => import('./pages/dashboard/shared/GovernanceReviewQueue'), 'GovernanceReviewQueue')
const ReferralCampaigns = lazyRoute(() => import('./pages/dashboard/admin/ReferralCampaigns'), 'ReferralCampaigns')
const ReferralCodes = lazyRoute(() => import('./pages/dashboard/admin/ReferralCodes'), 'ReferralCodes')
const ReferralLocalLeads = lazyRoute(() => import('./pages/dashboard/admin/ReferralLocalLeads'), 'ReferralLocalLeads')
const ReferralImportRoutes = lazyRoute(() => import('./pages/dashboard/admin/ReferralImportRoutes'), 'ReferralImportRoutes')
const ReferralMarketing = lazyRoute(() => import('./pages/dashboard/admin/ReferralMarketing'), 'ReferralMarketing')
const ReferralTrustReview = lazyRoute(() => import('./pages/dashboard/admin/ReferralTrustReview'), 'ReferralTrustReview')
const AdminCommunications = lazyRoute(() => import('./pages/dashboard/admin/Communications'), 'AdminCommunications')

// Bank Dashboard
const BankDashboard = lazyRoute(() => import('./pages/dashboard/bank/BankDashboard'), 'BankDashboard')
const LendingQueue = lazyRoute(() => import('./pages/dashboard/bank/LendingQueue'), 'LendingQueue')
const CollateralMap = lazyRoute(() => import('./pages/dashboard/bank/CollateralMap'), 'CollateralMap')
const CreditRiskAnalysis = lazyRoute(() => import('./pages/dashboard/bank/CreditRiskAnalysis'), 'CreditRiskAnalysis')

// RX07-WEB-PERF-01-A: request the page being opened at once; the rest of the public journey only
// after load, on idle, and never under Save-Data. The composition (accepted vs showroom) follows the
// same build-time/presentation switch <ShowroomRoute> uses, so the flags-OFF build never fetches
// showroom code and the showroom build never fetches the accepted page bodies it does not render.
if (typeof window !== 'undefined') {
  warmJourney(window.location.pathname, isShowroomPagesEnabled()
    ? { home: ShowroomLanding.preload, marketplace: ShowroomMarketplace.preload, detail: ShowroomVehicleDetail.preload }
    : { home: Landing.preload, marketplace: Marketplace.preload, detail: VehicleDetail.preload })
}

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
        {/* Public Routes. S1-4B unified-shell candidate is DEFAULT-OFF: this renders
            the legacy MainLayout unless the isolated presentation flag is opted in.
            Presentation-only; no access change. */}
        <Route element={<UnifiedRouteShell family="public" legacy={<MainLayout />} />}>
          <Route path="/" element={<ShowroomRoute accepted={<Landing />} showroom={ShowroomLanding} />} />
          <Route path="/marketplace" element={<ShowroomRoute accepted={<Marketplace />} showroom={ShowroomMarketplace} />} />
          <Route path="/sell" element={<GuestSell />} />
          <Route path="/marketplace/parts" element={<MarketplaceCategoryPage kind="part" />} />
          <Route path="/marketplace/services" element={<MarketplaceCategoryPage kind="service" />} />
          <Route path="/marketplace/compare" element={<MarketplaceCompare />} />
          <Route path="/marketplace/listing/:id" element={<ShowroomRoute accepted={<VehicleDetail />} showroom={ShowroomVehicleDetail} />} />
          <Route path="/marketplace/:id" element={<ShowroomRoute accepted={<VehicleDetail />} showroom={ShowroomVehicleDetail} />} />
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
          <Route path="/dealers/inquiries" element={<DealerTenantInquiries />} />
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

        {/* Auth Routes. S1-4B: focused-shell candidate DEFAULT-OFF (legacy hideNav MainLayout
            unless opted in). The real Login form + returnTo handling render unchanged beneath. */}
        {/* S1-4B R2: focused titles are path-appropriate inside the shell; KYC and
            non-first-slice auth paths keep the legacy composition. */}
        <Route element={<UnifiedRouteShell family="focused" legacy={<MainLayout hideNav />} />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
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

        {/* Owner Dashboard / My CarUp. S1-4B: personal-workspace shell candidate DEFAULT-OFF
            (legacy DashboardLayout unless opted in). Access/auth unchanged. */}
        <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<DashboardLayout role="owner" />} />}>
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

        {/* Canonical active dealer owners may retain global member role. Only
            the real session/tenant/compliance authority unlocks this route.
            S1-4B: dealer-workspace shell candidate DEFAULT-OFF. When opted in, the
            canonical server-enforcing guard renders INSIDE the workspace chrome, so
            tenant/compliance/owner-membership authorization is fully preserved. */}
        <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<DealerCanonicalWorkspaceLayout />} />}>
          <Route path="/dealer/dashboard" element={<DealerDashboard />} />
        </Route>

        {/* Legacy global-role dealer routes: a canonically activated owner is redirected to
            the canonical workspace (one journey); everyone else keeps the legacy route and its
            unchanged role="dealer" boundary (R6 E). */}
        <Route element={<LegacyDealerRouteGate />}>
          <Route path="/dealer" element={<LegacyDealerDashboard />} />
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

        {/* Independently verified dealer reviewers are NOT generic platform admins.
            The existing five reviewer workbenches keep their canonical routes and
            proven backend session/step-up checks, but no longer inherit the
            administrator-only dashboard redirect. */}
        <Route element={<DealerReviewerLayout />}>
          <Route path="/admin/dealer-claims" element={<DealerClaimReview />} />
          <Route path="/admin/dealer-research-review" element={<DealerResearchReview />} />
          <Route path="/admin/dealer-compliance-submissions" element={<DealerComplianceApplicationReview />} />
          <Route path="/admin/dealer-legal-activation" element={<DealerLegalActivationReview />} />
          <Route path="/admin/dealer-full-storefront-review" element={<DealerFullStorefrontReview />} />
          <Route path="/admin/dealer-buyer-feedback" element={<DealerBuyerFeedbackReview />} />
          {/* R4 P0-2: the CANONICAL vehicle evidence review workbench (same component and the same
              admin/government-only verify/reject endpoints as /admin/evidence), reachable from the
              dealership reviewer shell. The data layer refuses self-verification of dealer stock. */}
          <Route path="/admin/dealer-vehicle-evidence" element={<EvidenceReview />} />
          {/* R4 P0-3 (C12): governed operating lifecycle decisions. */}
          <Route path="/admin/dealer-operating-lifecycle" element={<DealerOperatingLifecycleReview />} />
        </Route>

        {/* RX-02A S1-3: component catalogue (isolated renderer, §10.3). Dev build only. */}
        {import.meta.env.DEV && ComponentCatalogue && <Route path="/dev/component-catalogue" element={<ComponentCatalogue />} />}

        {/* Catch-all — unknown routes render the not-found page (previously blank) */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </FeatureGovernanceLoader>
    </AppContext.Provider>
  )
}
