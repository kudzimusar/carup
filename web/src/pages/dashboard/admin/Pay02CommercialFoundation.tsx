import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  FileCheck2,
  FlaskConical,
  History,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

export interface Pay02CatalogueProduct {
  productCode: string
  version: number
  family: string
  title: string
  commercialEvent: string
  commercialCategory: 'category_a_first_party' | 'category_b_third_party' | 'category_c_corporate_treasury'
  owningSubsystem: string
  sourceObjectType: string
  payerRole: string
  contractualSeller: string | null
  legalBeneficiary: string | null
  merchantOfRecord: string | null
  fundsOwner: string | null
  revenueBeneficiary: string | null
  jurisdiction: string
  permittedCurrencies: string[]
  priceAuthorityType: string
  approvedAmountMinor: number | null
  approvedCurrency: string | null
  currencyScale: number | null
  eligibleProviders: string[]
  prohibitedProviders: string[]
  fulfillmentContract: string
  mobileChannelPolicy: string
  checkoutProhibited: boolean
  activationState: string
  certificationState: string
  blockerClass: string | null
  blockerReason: string | null
  implementationOwner: string
  priority: string
  persistenceOrigin?: string
  validation: { valid: boolean; errors: string[] }
}

export interface Pay02ProviderProfile {
  providerKey: string
  providerClass: string
  displayName: string
  accountId: string | null
  merchantIdentity: string | null
  supportedCountries: string[]
  supportedCurrencies: string[]
  callableInTest: boolean
  liveAuthorized: boolean
  blockedReason?: string
}

export interface Pay02CatalogueResponse {
  summary: {
    totalProducts: number
    filteredCount: number
    byCategory: Record<string, number>
    byActivationState: Record<string, number>
    liveActiveCount: number
    pilotCandidateCode: string
    persistenceStatus?: string
    persistedDatabaseCount?: number
  }
  products: Pay02CatalogueProduct[]
  providers: Pay02ProviderProfile[]
}

export interface Pay02ProductVersionRow {
  version: number
  activation_state: string
  approved_currency: string | null
  approved_amount_minor: number | null
  approval_evidence_ref: string | null
  created_at?: string
}

export interface Pay02GovernanceProposalRow {
  id: string
  product_code: string
  base_version?: number
  proposed_state: string
  proposed_currency?: string | null
  proposed_amount_minor?: number | null
  rationale: string
  status: string
  proposer_id: string
  reviewer_id?: string | null
  effect_status?: string
}

export interface Pay02ProductDetailResponse {
  product: Pay02CatalogueProduct
  persistenceStatus: string
  versions: Pay02ProductVersionRow[]
  proposals: Pay02GovernanceProposalRow[]
}

export interface Pay02FinancialReport {
  authorityMode: 'authoritative_database_reconciliation' | 'simulation'
  authorityBanner: string
  currency: string
  grossAuthorizedMinor: number
  providerCapturedMinor: number
  providerSettledMinor: number
  bankSettledMinor: number
  refundedMinor: number
  disputedMinor: number
  carUpRecognizedRevenueMinor: number
  carUpDeferredCustomerLiabilityMinor: number
  thirdPartyBeneficiaryPayableMinor: number
  platformServiceFeeMinor: number
  unverifiedTaxTreatmentCount: number
  exceptionsCount: number
  reconciledClean: boolean
  exceptions: Array<{
    type: string
    quoteId?: string
    paymentTransactionId?: string
    detail: string
  }>
}

const CATEGORY_LABELS: Record<string, string> = {
  category_a_first_party: 'Category A · First-Party CarUp Sale',
  category_b_third_party: 'Category B · Third-Party Obligation',
  category_c_corporate_treasury: 'Category C · Corporate / Treasury (No Checkout)',
}

export default function Pay02CommercialFoundation() {
  const { token, user } = useAuth()
  const [data, setData] = useState<Pay02CatalogueResponse | null>(null)
  const [selectedFamily, setSelectedFamily] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [proposalMessage, setProposalMessage] = useState<string | null>(null)
  const [proposalBusy, setProposalBusy] = useState<boolean>(false)
  const [inspectedDetail, setInspectedDetail] = useState<Pay02ProductDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState<boolean>(false)
  const [reconciliationReport, setReconciliationReport] = useState<Pay02FinancialReport | null>(null)
  const [reconciliationBusy, setReconciliationBusy] = useState<boolean>(false)

  const buildAuthHeaders = useCallback(
    () => ({
      'x-session-token': token ?? undefined,
      'x-user-id': user?.id,
      ...(user?.role ? { 'x-stakeholder-role': user.role } : {}),
    }),
    [token, user?.id, user?.role],
  )

  const loadCatalogue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (selectedFamily) params.set('family', selectedFamily)
      if (selectedCategory) params.set('category', selectedCategory)
      const query = params.toString() ? `?${params.toString()}` : ''
      const response = await apiRequest<Pay02CatalogueResponse>({
        baseUrl: API_BASE,
        path: `/pay02/admin/catalogue${query}`,
        authHeaders: buildAuthHeaders(),
      })
      if (!response || !Array.isArray(response.products) || !response.summary) {
        throw new Error('Incomplete commercial catalogue response.')
      }
      setData(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load commercial catalogue.')
    } finally {
      setLoading(false)
    }
  }, [buildAuthHeaders, selectedFamily, selectedCategory])

  useEffect(() => {
    void loadCatalogue()
  }, [loadCatalogue])

  const inspectProductHistory = async (productCode: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const response = await apiRequest<Pay02ProductDetailResponse>({
        baseUrl: API_BASE,
        path: `/pay02/admin/catalogue/${encodeURIComponent(productCode)}`,
        authHeaders: buildAuthHeaders(),
      })
      setInspectedDetail(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load product version history.')
    } finally {
      setDetailLoading(false)
    }
  }

  const submitReviewProposal = async (product: Pay02CatalogueProduct) => {
    if (proposalBusy) return
    setProposalBusy(true)
    setProposalMessage(null)
    setError(null)
    try {
      const response = await apiRequest<{ proposal: Pay02GovernanceProposalRow }>({
        baseUrl: API_BASE,
        path: '/pay02/admin/proposals',
        options: {
          method: 'POST',
          body: JSON.stringify({
            productCode: product.productCode,
            proposedState: 'reviewed',
            rationale: `PAY-02 governance inspection review for ${product.productCode}`,
            approvalEvidenceRef: 'ISSUE-247:SANDBOX-REVIEW-PROPOSAL',
          }),
        },
        authHeaders: buildAuthHeaders(),
      })
      if (!response?.proposal?.id) {
        throw new Error('Governance proposal did not return a durable database proposal ID.')
      }
      setProposalMessage(
        `Persisted DB proposal ${response.proposal.id} recorded (${response.proposal.status}). Distinct reviewer approval is required before version advancement.`,
      )
      if (inspectedDetail?.product.productCode === product.productCode) {
        await inspectProductHistory(product.productCode)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Governance proposal failed validation gate.')
    } finally {
      setProposalBusy(false)
    }
  }

  const reviewGovernanceProposal = async (
    proposalId: string,
    decision: 'approved' | 'rejected',
    productCode?: string,
  ) => {
    if (proposalBusy) return
    setProposalBusy(true)
    setProposalMessage(null)
    setError(null)
    try {
      const response = await apiRequest<{
        proposal: Pay02GovernanceProposalRow
        newVersion?: Pay02ProductVersionRow | null
      }>({
        baseUrl: API_BASE,
        path: `/pay02/admin/proposals/${encodeURIComponent(proposalId)}/review`,
        options: {
          method: 'POST',
          body: JSON.stringify({
            decision,
            reviewNotes: `Administrative governance review (${decision}) for proposal ${proposalId}`,
            approvalEvidenceRef: 'ISSUE-247:SANDBOX-REVIEW-APPROVAL',
          }),
        },
        authHeaders: buildAuthHeaders(),
      })
      const versionNote = response.newVersion
        ? ` Persisted product version advanced to v${response.newVersion.version} (${response.newVersion.activation_state}).`
        : ''
      setProposalMessage(
        `Proposal ${response.proposal.id} ${response.proposal.status} (${response.proposal.effect_status || 'recorded'}).${versionNote}`,
      )
      await loadCatalogue()
      if (productCode) {
        await inspectProductHistory(productCode)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proposal review failed persistence or separation-of-duties gate.')
    } finally {
      setProposalBusy(false)
    }
  }

  const runAuthoritativeReconciliation = async () => {
    if (reconciliationBusy) return
    setReconciliationBusy(true)
    setError(null)
    try {
      const response = await apiRequest<{ report: Pay02FinancialReport }>({
        baseUrl: API_BASE,
        path: '/pay02/admin/reporting/reconcile?currency=JPY',
        authHeaders: buildAuthHeaders(),
      })
      setReconciliationReport(response.report)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authoritative database reconciliation failed.')
    } finally {
      setReconciliationBusy(false)
    }
  }

  const runSimulatedReconciliation = async () => {
    if (reconciliationBusy) return
    setReconciliationBusy(true)
    setError(null)
    try {
      const response = await apiRequest<{ report: Pay02FinancialReport }>({
        baseUrl: API_BASE,
        path: '/pay02/admin/reporting/simulate',
        options: {
          method: 'POST',
          body: JSON.stringify({
            currency: 'JPY',
            quotes: [],
            transactions: [],
            reportOrders: [],
          }),
        },
        authHeaders: buildAuthHeaders(),
      })
      setReconciliationReport(response.report)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test simulation failed.')
    } finally {
      setReconciliationBusy(false)
    }
  }

  const isPersistedDbBacked = data?.summary?.persistenceStatus === 'database_reconciled'

  return (
    <main className="min-h-screen space-y-6 bg-slate-50 px-3 py-6 sm:px-8" data-testid="pay02-admin-console">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="link" asChild className="px-0">
            <Link to="/admin/payments">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to sandbox payment console
            </Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runAuthoritativeReconciliation()}
              disabled={reconciliationBusy}
              data-testid="pay02-run-authoritative-reconcile"
            >
              <Database className="mr-1.5 h-3.5 w-3.5" />
              Authoritative DB Reconcile
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runSimulatedReconciliation()}
              disabled={reconciliationBusy}
              data-testid="pay02-run-simulation"
            >
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
              Test Simulation
            </Button>
            <Button variant="outline" size="sm" onClick={() => void loadCatalogue()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh catalogue
            </Button>
          </div>
        </div>

        <header className="rounded-2xl bg-slate-950 p-4 text-white shadow-lg sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-orange-500 text-white">CARUP PAYMENTS 2.0 · PAY-02</Badge>
            <Badge variant="outline" className="border-white/30 text-white">
              <Lock className="mr-1 h-3 w-3" /> Fail-Closed Foundation · No Live Money
            </Badge>
            <Badge
              variant="outline"
              className="border-emerald-400/50 text-emerald-200"
              data-testid="pay02-authority-badge"
            >
              {isPersistedDbBacked
                ? `Persisted Commercial Authority (${data?.summary?.persistedDatabaseCount ?? 0} DB rows)`
                : 'Catalogue Metadata (Source Reference)'}
            </Badge>
          </div>
          <h1 className="mt-3 text-xl font-semibold sm:text-3xl">
            Unified Commercial Catalogue & Financial Authority
          </h1>
          <p className="mt-2 max-w-3xl text-xs text-slate-300 sm:text-sm">
            Distinguishes source Catalogue Metadata, Persisted Commercial Authority in PostgreSQL, Test Simulation, and
            Authoritative Database Reconciliation against canonical payment_transactions.
          </p>
        </header>

        <section
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Authority Surface Legend"
          data-testid="pay02-authority-surfaces"
        >
          <div className="rounded-xl border bg-white p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <FileCheck2 className="h-4 w-4 text-slate-700" />
              Catalogue Metadata
            </div>
            <p className="mt-1 text-slate-500">
              66 versioned source definitions across 11 CarUp service families.
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <Database className="h-4 w-4 text-emerald-700" />
              Persisted Commercial Authority
            </div>
            <p className="mt-1 text-slate-500" data-testid="pay02-persistence-status">
              Status: {data?.summary?.persistenceStatus || 'static_source_manifest'} (
              {data?.summary?.persistedDatabaseCount ?? 0} DB rows)
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-blue-700" />
              Authoritative Database Reconciliation
            </div>
            <p className="mt-1 text-slate-500">
              Reads persisted quotes, report orders, and canonical payment_transactions directly from PostgreSQL.
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <FlaskConical className="h-4 w-4 text-amber-700" />
              Test Simulation
            </div>
            <p className="mt-1 text-slate-500">
              Non-authoritative scenario evaluation stamped as simulated input.
            </p>
          </div>
        </section>

        {error && (
          <div
            role="alert"
            data-testid="pay02-error-alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 break-words"
          >
            {error}
          </div>
        )}
        {proposalMessage && (
          <div
            role="status"
            data-testid="pay02-proposal-status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 break-words"
          >
            {proposalMessage}
          </div>
        )}

        {reconciliationReport && (
          <Card data-testid="pay02-reconciliation-panel">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base sm:text-lg">
                  {reconciliationReport.authorityMode === 'authoritative_database_reconciliation'
                    ? 'Authoritative Database Reconciliation'
                    : 'Test Simulation Output'}
                </CardTitle>
                <Badge
                  className={
                    reconciliationReport.authorityMode === 'authoritative_database_reconciliation'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-amber-600 text-white'
                  }
                  data-testid="pay02-reconciliation-mode-badge"
                >
                  {reconciliationReport.authorityBanner}
                </Badge>
              </div>
              <CardDescription>
                Currency: {reconciliationReport.currency} · Clean:{' '}
                {reconciliationReport.reconciledClean ? 'YES' : 'EXCEPTIONS DETECTED'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <div className="rounded-lg border bg-slate-50 p-2.5">
                  <div className="text-slate-500">Provider Captured (Minor)</div>
                  <div className="font-mono text-sm font-semibold">
                    {reconciliationReport.providerCapturedMinor}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2.5">
                  <div className="text-slate-500">CarUp Recognized Revenue</div>
                  <div className="font-mono text-sm font-semibold text-emerald-800">
                    {reconciliationReport.carUpRecognizedRevenueMinor}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2.5">
                  <div className="text-slate-500">Deferred Customer Liability</div>
                  <div className="font-mono text-sm font-semibold text-amber-800">
                    {reconciliationReport.carUpDeferredCustomerLiabilityMinor}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2.5">
                  <div className="text-slate-500">Third-Party Beneficiary Payable</div>
                  <div className="font-mono text-sm font-semibold">
                    {reconciliationReport.thirdPartyBeneficiaryPayableMinor}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2.5">
                  <div className="text-slate-500">Platform Service Fee</div>
                  <div className="font-mono text-sm font-semibold">
                    {reconciliationReport.platformServiceFeeMinor}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2.5">
                  <div className="text-slate-500">Provider / Bank Settled</div>
                  <div className="font-mono text-sm font-semibold">
                    {reconciliationReport.providerSettledMinor} / {reconciliationReport.bankSettledMinor}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2.5">
                  <div className="text-slate-500">Unverified Tax Treatment</div>
                  <div className="font-mono text-sm font-semibold">
                    {reconciliationReport.unverifiedTaxTreatmentCount}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2.5">
                  <div className="text-slate-500">Reconciliation Exceptions</div>
                  <div className="font-mono text-sm font-semibold" data-testid="pay02-reconciliation-exceptions">
                    {reconciliationReport.exceptionsCount}
                  </div>
                </div>
              </div>
              {reconciliationReport.exceptions.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-900">
                  {reconciliationReport.exceptions.map((ex, idx) => (
                    <li key={`${ex.type}-${idx}`} className="font-mono">
                      [{ex.type}] {ex.detail}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {inspectedDetail && (
          <Card data-testid="pay02-version-history-panel">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base sm:text-lg">
                    Persisted Version History & Governance: {inspectedDetail.product.productCode}
                  </CardTitle>
                  <CardDescription>
                    Persistence Status: {inspectedDetail.persistenceStatus} · Active Version: v
                    {inspectedDetail.product.version} ({inspectedDetail.product.activationState})
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setInspectedDetail(null)}>
                  Close history
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div>
                <h3 className="font-semibold text-slate-900">Immutable Version Ledger</h3>
                <div className="mt-2 space-y-1.5">
                  {inspectedDetail.versions.map((ver) => (
                    <div
                      key={ver.version}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 p-2 font-mono"
                      data-testid={`pay02-version-row-${ver.version}`}
                    >
                      <span>
                        v{ver.version} · {ver.activation_state}
                      </span>
                      <span>
                        {ver.approved_currency && ver.approved_amount_minor !== null
                          ? `${ver.approved_currency} ${ver.approved_amount_minor}`
                          : 'Unpriced'}
                      </span>
                      <span className="text-slate-500">
                        Evidence: {ver.approval_evidence_ref || 'Initial Seed'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-900">Governance Proposals</h3>
                {inspectedDetail.proposals.length === 0 ? (
                  <p className="mt-1 text-slate-500">No governance proposals recorded for this product.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {inspectedDetail.proposals.map((prop) => (
                      <div
                        key={prop.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-2.5"
                        data-testid={`pay02-proposal-row-${prop.id}`}
                      >
                        <div className="space-y-0.5">
                          <div className="font-mono font-semibold">
                            {prop.id} → {prop.proposed_state} ({prop.status})
                          </div>
                          <div className="text-slate-500">
                            Proposer: {prop.proposer_id}
                            {prop.reviewer_id ? ` · Reviewer: ${prop.reviewer_id}` : ''}
                            {prop.effect_status ? ` · Effect: ${prop.effect_status}` : ''}
                          </div>
                        </div>
                        {prop.status === 'pending_review' && (
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={proposalBusy}
                              onClick={() =>
                                void reviewGovernanceProposal(
                                  prop.id,
                                  'approved',
                                  inspectedDetail.product.productCode,
                                )
                              }
                              data-testid={`pay02-approve-proposal-${prop.id}`}
                            >
                              Approve Proposal
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={proposalBusy}
                              onClick={() =>
                                void reviewGovernanceProposal(
                                  prop.id,
                                  'rejected',
                                  inspectedDetail.product.productCode,
                                )
                              }
                              data-testid={`pay02-reject-proposal-${prop.id}`}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="pay02-summary-cards">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Registered Services</CardDescription>
                  <CardTitle className="text-2xl">{data.summary.totalProducts}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-500">
                  Across all 11 CarUp commercial service families
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Category A / B / C Split</CardDescription>
                  <CardTitle className="text-lg">
                    {data.summary.byCategory.category_a_first_party || 0} First-Party ·{' '}
                    {data.summary.byCategory.category_b_third_party || 0} Third-Party ·{' '}
                    {data.summary.byCategory.category_c_corporate_treasury || 0} Treasury
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-500">
                  Strict separation of funds ownership and beneficiary
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Live Production Active</CardDescription>
                  <CardTitle className="text-2xl text-emerald-700" data-testid="pay02-live-active-count">
                    {data.summary.liveActiveCount}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-500">
                  Hard DB & service fence blocks live activation in PAY-02
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>First Real Product Pilot (PAY-02-PILOT)</CardDescription>
                  <CardTitle className="font-mono text-sm break-all">{data.summary.pilotCandidateCode}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-500">
                  Single-VIN Vehicle History Report (`reportService.js`)
                </CardContent>
              </Card>
            </section>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Provider Capability & Routing Profiles</CardTitle>
                <CardDescription>
                  Fail-closed routing evaluates country, merchant of record, funds owner, currency, and capabilities.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.providers.map((provider) => (
                  <div
                    key={provider.providerKey}
                    className="rounded-xl border bg-white p-3 text-xs space-y-1.5"
                    data-testid={`pay02-provider-${provider.providerKey}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{provider.displayName}</span>
                      <Badge variant={provider.callableInTest ? 'default' : 'outline'}>
                        {provider.callableInTest ? 'Sandbox Callable' : 'Fail-Closed'}
                      </Badge>
                    </div>
                    <p className="font-mono text-slate-600 break-all">{provider.providerKey}</p>
                    <p className="text-slate-500">
                      Countries: {provider.supportedCountries.join(', ')} · Currencies:{' '}
                      {provider.supportedCurrencies.join(', ')}
                    </p>
                    {provider.blockedReason && (
                      <p className="text-amber-700 font-mono break-all">Gate: {provider.blockedReason}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Controlling Commercial Catalogue ({data.products.length})</CardTitle>
                    <CardDescription>
                      Every service is mapped to its governing subsystem, legal beneficiary, and certification state.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Filter by service family"
                      className="rounded-md border bg-white px-2.5 py-1.5 text-xs"
                      value={selectedFamily}
                      onChange={(e) => setSelectedFamily(e.target.value)}
                    >
                      <option value="">All families</option>
                      <option value="marketplace">Marketplace</option>
                      <option value="intelligence">Intelligence & Reports</option>
                      <option value="subscriptions">Subscriptions</option>
                      <option value="advertising">Advertising & Leads</option>
                      <option value="garage">Garage & Parts</option>
                      <option value="imports_trade">Imports & Logistics</option>
                      <option value="insurance">Insurance</option>
                      <option value="banking_finance">Banking & Finance</option>
                      <option value="adjustments">Adjustments & Refunds</option>
                      <option value="corporate_finance">Corporate Finance</option>
                      <option value="capital_treasury">Capital & Treasury</option>
                    </select>
                    <select
                      aria-label="Filter by commercial category"
                      className="rounded-md border bg-white px-2.5 py-1.5 text-xs"
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                      <option value="">All categories</option>
                      <option value="category_a_first_party">Category A (First-Party)</option>
                      <option value="category_b_third_party">Category B (Third-Party)</option>
                      <option value="category_c_corporate_treasury">Category C (Corporate/Treasury)</option>
                    </select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.products.map((item) => (
                  <article
                    key={item.productCode}
                    className="rounded-xl border bg-white p-4 space-y-2"
                    data-testid={`pay02-product-${item.productCode}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-xs font-semibold text-orange-700 break-all">
                          {item.productCode} (v{item.version})
                        </span>
                        <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
                        <p className="text-xs text-slate-500">
                          {CATEGORY_LABELS[item.commercialCategory] || item.commercialCategory} · Subsystem:{' '}
                          <span className="font-mono">{item.owningSubsystem}</span> ({item.sourceObjectType})
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">
                          {item.persistenceOrigin === 'database_reconciled' ? 'DB Authority' : 'Catalogue Spec'}
                        </Badge>
                        <Badge variant="outline">{item.activationState}</Badge>
                        <Badge className="bg-slate-800 text-white">{item.certificationState}</Badge>
                        {item.checkoutProhibited && (
                          <Badge className="bg-red-100 text-red-800">Checkout Prohibited</Badge>
                        )}
                      </div>
                    </div>

                    <dl className="grid gap-2 text-xs sm:grid-cols-4 pt-1">
                      <div>
                        <dt className="text-slate-400">Seller / Beneficiary</dt>
                        <dd className="font-mono text-slate-800 break-words">
                          {item.contractualSeller || 'Unassigned'} → {item.legalBeneficiary || 'Unassigned'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Merchant / Funds Owner</dt>
                        <dd className="font-mono text-slate-800 break-words">
                          MoR: {item.merchantOfRecord || 'Blocked'} · Funds: {item.fundsOwner || 'Blocked'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Price Authority</dt>
                        <dd className="font-mono text-slate-800">
                          {item.priceAuthorityType}
                          {item.approvedAmountMinor !== null && item.approvedCurrency
                            ? ` (${item.approvedCurrency} ${item.approvedAmountMinor})`
                            : ' (Unpriced)'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Lane & Mobile Policy</dt>
                        <dd className="font-mono text-slate-800">
                          {item.implementationOwner} · {item.mobileChannelPolicy}
                        </dd>
                      </div>
                    </dl>

                    {item.blockerReason && (
                      <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
                        <span>
                          <strong>Blocker [{item.blockerClass || 'GOVERNANCE'}]:</strong> {item.blockerReason}
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        {item.validation.valid ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Contract validation passed
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="h-3.5 w-3.5 text-slate-500" /> Fail-closed validation active
                          </>
                        )}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={detailLoading}
                          onClick={() => void inspectProductHistory(item.productCode)}
                          data-testid={`pay02-history-${item.productCode}`}
                        >
                          <History className="mr-1 h-3.5 w-3.5" />
                          Version History
                        </Button>
                        {item.activationState === 'draft' &&
                          item.commercialCategory !== 'category_c_corporate_treasury' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={proposalBusy}
                              onClick={() => void submitReviewProposal(item)}
                              data-testid={`pay02-propose-${item.productCode}`}
                            >
                              Propose architecture review
                            </Button>
                          )}
                      </div>
                    </div>
                  </article>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  )
}
