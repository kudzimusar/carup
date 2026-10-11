import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, createContext, useContext, useEffect, lazy, Suspense } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useAuth } from './context/AuthContext'
import { RouteMetadata } from './components/routing/RouteMetadata'
import { WifiOff } from 'lucide-react'
import type { AuthUser, Notification } from '@shared/types'

// Layout
import MainLayout from './components/layout/MainLayout'
import TradeOSWorkspaceLayout from './components/layout/TradeOSWorkspaceLayout'
const TradeRequestQuotes = lazy(() => import('./pages/diaspora/TradeRequestQuotes'))
const TradeMyRequests = lazy(() => import('./pages/diaspora/TradeMyRequests'))
const TradeRequestDetail = lazy(() => import('./pages/diaspora/TradeRequestDetail'))
const TradeBuyerRequests = lazy(() => import('./pages/diaspora/TradeBuyerRequests'))
import DashboardLayout from './components/layout/DashboardLayout'
import { FeatureGovernanceLoader } from './context/FeatureGovernanceContext'
import { NotFoundPage } from './components/routing/FeatureStatePages'
import { AuthBootstrapLoading } from './components/routing/RegistryRouteBoundary'
import LazyRouteBoundary from './components/routing/LazyRouteBoundary'

// Public Pages
import Landing from './pages/Landing'
const GuestSell = lazy(() => import('./pages/GuestSell'))
import Marketplace from './pages/Marketplace'
const MarketplaceCompare = lazy(() => import('./pages/MarketplaceCompare'))
const MarketplaceCategoryPage = lazy(() => import('./pages/MarketplaceCategoryPage'))
const VehicleDetail = lazy(() => import('./pages/VehicleDetail'))
const VehicleSearch = lazy(() => import('./pages/VehicleSearch'))
const SharedReport = lazy(() => import('./pages/SharedReport'))
const DealerDirectory = lazy(() => import('./pages/DealerDirectory'))
const GarageDirectory = lazy(() => import('./pages/GarageDirectory'))
const GarageDetail = lazy(() => import('./pages/GarageDetail'))
const ServiceLink = lazy(() => import('./pages/ServiceLink'))
const InsuranceDirectory = lazy(() => import('./pages/InsuranceDirectory'))
const Pricing = lazy(() => import('./pages/Pricing'))
const About = lazy(() => import('./pages/About'))
const Contact = lazy(() => import('./pages/Contact'))
import ScrollToTop from './components/layout/ScrollToTop'
import ActivityInstrumentation from './components/intelligence/ActivityInstrumentation'

// New Footer Pages
const Careers = lazy(() => import('./pages/Careers'))
const PressKit = lazy(() => import('./pages/PressKit'))
const Blog = lazy(() => import('./pages/Blog'))
const HelpCenter = lazy(() => import('./pages/HelpCenter'))
const TrustSafety = lazy(() => import('./pages/TrustSafety'))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const TermsOfService = lazy(() => import('./pages/TermsOfService'))
const Support = lazy(() => import('./pages/Support'))
const Security = lazy(() => import('./pages/Security'))
const APIDocs = lazy(() => import('./pages/APIDocs'))
const DiasporaComplianceAdmin = lazy(() => import('./pages/diaspora/DiasporaTrade').then(module => ({ default: module.DiasporaComplianceAdmin })))
const DiasporaImportDetail = lazy(() => import('./pages/diaspora/DiasporaTrade').then(module => ({ default: module.DiasporaImportDetail })))
const DiasporaImportDocuments = lazy(() => import('./pages/diaspora/DiasporaTrade').then(module => ({ default: module.DiasporaImportDocuments })))
const DiasporaImportList = lazy(() => import('./pages/diaspora/DiasporaTrade').then(module => ({ default: module.DiasporaImportList })))
const DiasporaImportShipment = lazy(() => import('./pages/diaspora/DiasporaTrade').then(module => ({ default: module.DiasporaImportShipment })))
const DiasporaLanding = lazy(() => import('./pages/diaspora/DiasporaTrade').then(module => ({ default: module.DiasporaLanding })))
const NewDiasporaImportOrder = lazy(() => import('./pages/diaspora/DiasporaTrade').then(module => ({ default: module.NewDiasporaImportOrder })))
const DiasporaOrderPassport = lazy(() => import('./pages/diaspora/DiasporaOrderPassport'))
const TradeTransactionPassport = lazy(() => import('./pages/diaspora/TradeTransactionPassport'))
const DiasporaStockPassport = lazy(() => import('./pages/diaspora/DiasporaStockPassport'))
const DiasporaWorkbookDryRun = lazy(() => import('./pages/diaspora/DiasporaWorkbookDryRun'))
const DiasporaWorkbookOperatorConsole = lazy(() => import('./pages/diaspora/DiasporaWorkbookOperatorConsole'))
const DiasporaStockManager = lazy(() => import('./pages/diaspora/DiasporaStockManager'))
const DiasporaTradeProfile = lazy(() => import('./pages/diaspora/DiasporaTradeProfile'))
const DiasporaAiCommandCenter = lazy(() => import('./pages/diaspora/DiasporaAiCommandCenter'))
const DiasporaContainerMarketplace = lazy(() => import('./pages/diaspora/DiasporaContainerMarketplace'))
const TradeRateResearch = lazy(() => import('./pages/diaspora/TradeRateResearch'))
const TradeDocumentsWorkspace = lazy(() => import('./pages/diaspora/TradeDocumentsWorkspace'))
const WarehouseIntakeWorkspace = lazy(() => import('./pages/diaspora/WarehouseIntakeWorkspace'))
const MyCargoIntake = lazy(() => import('./pages/diaspora/MyCargoIntake'))
const ContainerLoadingWorkspace = lazy(() => import('./pages/diaspora/ContainerLoadingWorkspace'))
const MyCargoLoading = lazy(() => import('./pages/diaspora/MyCargoLoading'))
const ShipmentTimelineWorkspace = lazy(() => import('./pages/diaspora/ShipmentTimelineWorkspace'))
const MyShipmentTracking = lazy(() => import('./pages/diaspora/MyShipmentTracking'))
const CustomsDestinationWorkspace = lazy(() => import('./pages/diaspora/CustomsDestinationWorkspace'))
const MyCustomsDestination = lazy(() => import('./pages/diaspora/MyCustomsDestination'))
const DiasporaDriveConnections = lazy(() => import('./pages/diaspora/DiasporaDriveConnections'))
const DiasporaSubscription = lazy(() => import('./pages/diaspora/DiasporaSubscription'))
const DiasporaSafeTrade = lazy(() => import('./pages/diaspora/DiasporaSafeTrade'))
const DiasporaSafeTradeDetail = lazy(() => import('./pages/diaspora/DiasporaSafeTradeDetail'))
const DiasporaTradeGraph = lazy(() => import('./pages/diaspora/DiasporaTradeGraph'))
const DiasporaSafeTradeOperations = lazy(() => import('./pages/diaspora/DiasporaSafeTradeOperations'))
const DiasporaConfirmedImport = lazy(() => import('./pages/diaspora/DiasporaConfirmedImport'))

// Auth Pages
const Login = lazy(() => import('./pages/auth/Login'))
const Register = lazy(() => import('./pages/auth/Register'))
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail'))
const KYCVerification = lazy(() => import('./pages/auth/KYCVerification'))
const RegistrationJourney = lazy(() => import('./pages/onboarding/RegistrationJourney'))
const DealerOnboarding = lazy(() => import('./pages/dealer/DealerOnboarding'))

// Owner Dashboard
const OwnerDashboard = lazy(() => import('./pages/dashboard/owner/OwnerDashboard'))
const MyGarage = lazy(() => import('./pages/dashboard/owner/MyGarage'))
const GarageSetup = lazy(() => import('./pages/dashboard/garage/GarageSetup'))
const EvidenceVault = lazy(() => import('./pages/dashboard/owner/EvidenceVault'))
const VehicleProfile = lazy(() => import('./pages/dashboard/owner/VehicleProfile'))
const ServiceHistory = lazy(() => import('./pages/dashboard/owner/ServiceHistory'))
const ServiceRequests = lazy(() => import('./pages/dashboard/owner/ServiceRequests'))
const InsuranceRecords = lazy(() => import('./pages/dashboard/owner/InsuranceRecords'))
const PartSentry = lazy(() => import('./pages/dashboard/owner/PartSentry'))
const MyListings = lazy(() => import('./pages/dashboard/owner/MyListings'))
const SavedCars = lazy(() => import('./pages/dashboard/owner/SavedCars'))
const SellVehicle = lazy(() => import('./pages/dashboard/owner/SellVehicle'))
import { SellerRouteErrorBoundary } from './components/sell/SellerRouteErrorBoundary'
const AIDashboard = lazy(() => import('./pages/dashboard/owner/AIDashboard'))
const ReferralWallet = lazy(() => import('./pages/dashboard/owner/ReferralWallet'))
const Communications = lazy(() => import('./pages/dashboard/owner/Communications'))
const SellerIntelligence = lazy(() => import('./pages/dashboard/owner/SellerIntelligence'))

// Dealer Dashboard
const DealerDashboard = lazy(() => import('./pages/dashboard/dealer/DealerDashboard'))
const Inventory = lazy(() => import('./pages/dashboard/dealer/Inventory'))
const Leads = lazy(() => import('./pages/dashboard/dealer/Leads'))
const Promotions = lazy(() => import('./pages/dashboard/dealer/Promotions'))
const SalesAnalytics = lazy(() => import('./pages/dashboard/dealer/SalesAnalytics'))

// Mechanic Dashboard
const MechanicDashboard = lazy(() => import('./pages/dashboard/mechanic/MechanicDashboard'))
// Garage operator workspace (R5) — the queue, cases, job cards, assignment and service records
// that were certified in Foundation 1.0 and had no product surface at all.
const GarageWorkspace = lazy(() => import('./pages/dashboard/garage/GarageWorkspace'))
const GarageCaseDetail = lazy(() => import('./pages/dashboard/garage/GarageCaseDetail'))
const GarageCustomers = lazy(() => import('./pages/dashboard/garage/GarageCustomers'))
const GarageProfileEditor = lazy(() => import('./pages/dashboard/garage/GarageProfileEditor'))
const WorkOrders = lazy(() => import('./pages/dashboard/mechanic/WorkOrders'))
const ServiceLogs = lazy(() => import('./pages/dashboard/mechanic/ServiceLogs'))
const PartsTracking = lazy(() => import('./pages/dashboard/mechanic/PartsTracking'))
const CustomerRecords = lazy(() => import('./pages/dashboard/mechanic/CustomerRecords'))

// Insurance Dashboard
const InsuranceDashboard = lazy(() => import('./pages/dashboard/insurance/InsuranceDashboard'))
const Claims = lazy(() => import('./pages/dashboard/insurance/Claims'))
const RiskAnalysis = lazy(() => import('./pages/dashboard/insurance/RiskAnalysis'))
const FraudAlerts = lazy(() => import('./pages/dashboard/insurance/FraudAlerts'))

// Government Dashboard
const GovernmentDashboard = lazy(() => import('./pages/dashboard/government/GovernmentDashboard'))
const RegistryVerification = lazy(() => import('./pages/dashboard/government/RegistryVerification'))
const ComplianceReports = lazy(() => import('./pages/dashboard/government/ComplianceReports'))

// Admin Dashboard
const AdminDashboard = lazy(() => import('./pages/dashboard/admin/AdminDashboard'))
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
const UserManagement = lazy(() => import('./pages/dashboard/admin/UserManagement'))
const AIMonitoring = lazy(() => import('./pages/dashboard/admin/AIMonitoring'))
const MarketplaceModeration = lazy(() => import('./pages/dashboard/admin/MarketplaceModeration'))
const EvidenceReview = lazy(() => import('./pages/dashboard/admin/EvidenceReview'))
const VehicleOperationsReview = lazy(() => import('./pages/dashboard/admin/VehicleOperationsReview'))
const PeopleComplianceReview = lazy(() => import('./pages/dashboard/admin/PeopleComplianceReview'))
const FraudQueue = lazy(() => import('./pages/dashboard/admin/FraudQueue'))
const DealerCompliance = lazy(() => import('./pages/dashboard/admin/DealerCompliance'))
const GarageApplications = lazy(() => import('./pages/dashboard/admin/GarageApplications'))
const GarageTeam = lazy(() => import('./pages/dashboard/garage/GarageTeam'))
const JoinGarage = lazy(() => import('./pages/JoinGarage'))
const IdentityVerificationCaseManagement = lazy(() => import('./pages/dashboard/admin/IdentityVerificationCaseManagement'))
const TrustReviewQueue = lazy(() => import('./pages/dashboard/shared/TrustReviewQueue'))
const GovernanceReviewQueue = lazy(() => import('./pages/dashboard/shared/GovernanceReviewQueue'))
const ReferralCampaigns = lazy(() => import('./pages/dashboard/admin/ReferralCampaigns'))
const ReferralCodes = lazy(() => import('./pages/dashboard/admin/ReferralCodes'))
const ReferralLocalLeads = lazy(() => import('./pages/dashboard/admin/ReferralLocalLeads'))
const ReferralImportRoutes = lazy(() => import('./pages/dashboard/admin/ReferralImportRoutes'))
const ReferralMarketing = lazy(() => import('./pages/dashboard/admin/ReferralMarketing'))
const ReferralTrustReview = lazy(() => import('./pages/dashboard/admin/ReferralTrustReview'))
const AdminCommunications = lazy(() => import('./pages/dashboard/admin/Communications'))

// Bank Dashboard
const BankDashboard = lazy(() => import('./pages/dashboard/bank/BankDashboard'))
const LendingQueue = lazy(() => import('./pages/dashboard/bank/LendingQueue'))
const CollateralMap = lazy(() => import('./pages/dashboard/bank/CollateralMap'))
const CreditRiskAnalysis = lazy(() => import('./pages/dashboard/bank/CreditRiskAnalysis'))

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
  const location = useLocation()
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
          <span>You are offline. Saved app screens may open, but current records and actions need a connection.</span>
        </div>
      )}
      <Toaster position="top-right" />
      <ScrollToTop />
      <RouteMetadata />
      <ActivityInstrumentation />
      <FeatureGovernanceLoader>
      <LazyRouteBoundary key={location.pathname} onRetry={() => window.location.reload()}>
      <Suspense fallback={<AuthBootstrapLoading />}>
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
          {/* Public garage profile. Lost when the post-#194 reconciliation took main's side of this
              file wholesale, which left GarageDetail on disk with zero importers. Guarded by
              web/src/__tests__/app-route-convergence.test.tsx. */}
          <Route path="/garages/:slug" element={<GarageDetail />} />
          {/* Where every CarUp QR code lands (R8). The backend resolved service links from the
              start; this route did not exist, so every scan opened the 404 page. Public by
              design: the resolver — not this route — decides what a scanner may see, and shows an
              anonymous scanner only that the link is real. */}
          <Route path="/s/:token" element={<ServiceLink />} />
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
          <Route path="/diaspora/stock" element={<DiasporaStockManager />} />
          <Route path="/diaspora/trade-profile" element={<DiasporaTradeProfile />} />
          <Route path="/diaspora/stock/:id/passport" element={<DiasporaStockPassport />} />
          <Route path="/diaspora/ai-commands" element={<DiasporaAiCommandCenter />} />
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
          {/* O2-X2 (ported by OC-5C) — the signed-in person's own onboarding journey. A product
              surface, not an auth step: it renders inside the canonical shell (#208 88000de9 moved it
              out of the chromeless auth group for exactly that reason). Unregistered, so routeAccess
              renders it for any signed-in caller (U1) and the page + backend decide the rest. */}
          <Route path="/onboarding" element={<RegistrationJourney />} />
          {/* O2-X5 (ported by OC-5C) — a dealer APPLICANT's own application. Deliberately outside the
              Dealer workspace routes: an applicant is not an active Dealer (onboarding ≠ authority). */}
          <Route path="/dealer/onboarding" element={<DealerOnboarding />} />
        </Route>

        {/* Trade OS operational workspace (owner UAT #1): the client-demo journey — Container
            Co-Loading + the linked Import Order/Passport surfaces — runs in an AUTHENTICATED
            operating shell (compact top bar + local Trade OS nav), not the public marketing
            MainLayout. Other Diaspora routes stay in MainLayout until deliberately migrated. */}
        <Route element={<TradeOSWorkspaceLayout />}>
          {/* T2 — Request Quotes: buyer sourcing + supplier opportunity marketplace. */}
          {/* The legacy /diaspora/rfq surface is retired: its buyer-facing term is now
              "Request Quotes" and its mechanics live in the T2 surfaces below. The path is kept
              as a redirect so existing links and bookmarks still land somewhere correct. */}
          <Route path="/diaspora/rfq" element={<Navigate to="/diaspora/request-quotes" replace />} />
          <Route path="/diaspora/request-quotes" element={<TradeRequestQuotes />} />
          <Route path="/diaspora/requests" element={<TradeMyRequests />} />
          <Route path="/diaspora/requests/:id" element={<TradeRequestDetail />} />
          <Route path="/diaspora/buyer-requests" element={<TradeBuyerRequests />} />
          {/* The SAME canonical Communications surface as /dashboard/communications, mounted in the
              participant-neutral Trade OS shell. The dashboard path lives in the owner-only layout,
              so suppliers were bounced to /dealer and could never read the thread they created. */}
          <Route path="/diaspora/messages" element={<Communications />} />
          <Route path="/diaspora/containers" element={<DiasporaContainerMarketplace />} />
          {/* T6.5 — CarUp's own rate research. Platform authority only, enforced server-side; the
              page renders an honest refusal rather than a blank screen for anyone else. */}
          <Route path="/diaspora/rate-research" element={<TradeRateResearch />} />
          {/* T8.3 — one Documents & Evidence workspace for any authoritative Trade OS object.
              Access is derived from the transaction server-side; the page shows an honest refusal
              rather than an empty list when it cannot be read. */}
          <Route path="/diaspora/documents/:subjectType/:subjectId" element={<TradeDocumentsWorkspace />} />
          {/* T9.3 — warehouse intake. Receiving authority is derived from the WAREHOUSE server-side,
              so a customer reaching this route sees an empty queue rather than a locked door: there
              is nothing here that is theirs to be refused. */}
          <Route path="/diaspora/warehouse" element={<WarehouseIntakeWorkspace />} />
          {/* T9.3 — the customer's own cargo. Authorized from the SUBJECT, not the warehouse. */}
          <Route path="/diaspora/cargo/:subjectType/:subjectId" element={<MyCargoIntake />} />
          {/* T10.3 — the operator's loading workspace. Sailing authority is resolved server-side
              (coordinator, tenant admin, platform admin), so a caller without it is refused there
              rather than hidden here. */}
          <Route path="/diaspora/loading" element={<ContainerLoadingWorkspace />} />
          {/* T10.3 — a participant's own cargo against the container. Authorized from the CARGO. */}
          <Route path="/diaspora/cargo-loading/:subjectType/:subjectId" element={<MyCargoLoading />} />
          {/* T11.2 — the operator's shipment movement timeline. Sailing authority server-side. */}
          <Route path="/diaspora/shipments" element={<ShipmentTimelineWorkspace />} />
          {/* T11.3 — a participant's own cargo journey. Authorized from the CARGO. */}
          <Route path="/diaspora/tracking/:subjectType/:subjectId" element={<MyShipmentTracking />} />
          <Route path="/diaspora/customs" element={<CustomsDestinationWorkspace />} />
          <Route path="/diaspora/my-customs/:subjectType/:subjectId" element={<MyCustomsDestination />} />
          <Route path="/diaspora/imports" element={<DiasporaImportList />} />
          <Route path="/diaspora/imports/new" element={<NewDiasporaImportOrder />} />
          <Route path="/diaspora/imports/:id" element={<DiasporaImportDetail />} />
          <Route path="/diaspora/imports/:id/documents" element={<DiasporaImportDocuments />} />
          <Route path="/diaspora/imports/:id/shipment" element={<DiasporaImportShipment />} />
          <Route path="/diaspora/imports/:id/passport" element={<DiasporaOrderPassport />} />
          {/* T4 — the operating transaction passport. `kind` is in the path so a purchase and a
              shipment can never be conflated by a missing parameter. */}
          <Route path="/diaspora/transactions/:kind/:id" element={<TradeTransactionPassport />} />
        </Route>

        {/* Auth Routes */}
        <Route element={<MainLayout hideNav />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* GMO-6 (OC-5E): an invitation must be readable before the person has an account. */}
          <Route path="/join-garage" element={<JoinGarage />} />
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
          <Route path="/dashboard/garage-setup" element={<GarageSetup />} />
          <Route path="/dashboard/evidence" element={<EvidenceVault />} />
          <Route path="/dashboard/garage/:id" element={<VehicleProfile />} />
          <Route path="/dashboard/service-history" element={<ServiceHistory />} />
          {/* R3 — a successful service request must remain findable. This is a view of the
              canonical Service Cases the owner already owns, not a second request ledger. */}
          <Route path="/dashboard/service-requests" element={<ServiceRequests />} />
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
          {/* The garage's own work, in the garage-side portal. OC-5D: no platform role admits these —
              the registry's tenant scope does (the SELECTED, verified garage, in the roles the
              backend's requireActiveTenant accepts), and this layout and the route boundary both
              evaluate it, so the surface's answer to "who may act for a garage" is the API's. */}
          <Route path="/garage" element={<GarageWorkspace />} />
          <Route path="/garage/cases/:caseId" element={<GarageCaseDetail />} />
          <Route path="/garage/customers" element={<GarageCustomers />} />
          <Route path="/garage/profile" element={<GarageProfileEditor />} />
          {/* GMO-6/7 (OC-5E): the garage's own people — its admin's surface (tenant-scoped). */}
          <Route path="/garage/team" element={<GarageTeam />} />
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
          {/* GMO-3/4 (OC-5E): the platform administrator decides garage applications; approval builds the workspace. */}
          <Route path="/admin/garage-applications" element={<GarageApplications />} />
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
      </Suspense>
      </LazyRouteBoundary>
      </FeatureGovernanceLoader>
    </AppContext.Provider>
  )
}
