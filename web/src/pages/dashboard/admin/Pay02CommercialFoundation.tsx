import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Lock, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
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
  }
  products: Pay02CatalogueProduct[]
  providers: Pay02ProviderProfile[]
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
        authHeaders: {
          'x-session-token': token ?? undefined,
          'x-user-id': user?.id,
          ...(user?.role ? { 'x-stakeholder-role': user.role } : {}),
        },
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
  }, [token, user?.id, user?.role, selectedFamily, selectedCategory])

  useEffect(() => {
    void loadCatalogue()
  }, [loadCatalogue])

  const submitReviewProposal = async (product: Pay02CatalogueProduct) => {
    if (proposalBusy) return
    setProposalBusy(true)
    setProposalMessage(null)
    setError(null)
    try {
      const response = await apiRequest<{ proposal: { id: string; proposed_state: string; status: string } }>({
        baseUrl: API_BASE,
        path: '/pay02/admin/proposals',
        options: {
          method: 'POST',
          body: JSON.stringify({
            productCode: product.productCode,
            proposedState: 'reviewed',
            rationale: `PAY-02 governance inspection review for ${product.productCode}`,
          }),
        },
        authHeaders: {
          'x-session-token': token ?? undefined,
          'x-user-id': user?.id,
          ...(user?.role ? { 'x-stakeholder-role': user.role } : {}),
        },
      })
      setProposalMessage(
        `Proposal ${response.proposal.id} recorded (${response.proposal.status}). Distinct reviewer approval is required before state change.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Governance proposal failed validation gate.')
    } finally {
      setProposalBusy(false)
    }
  }

  return (
    <main className="min-h-screen space-y-6 bg-slate-50 px-4 py-6 sm:px-8" data-testid="pay02-admin-console">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="link" asChild className="px-0">
            <Link to="/admin/payments">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to sandbox payment console
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadCatalogue()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh catalogue
          </Button>
        </div>

        <header className="rounded-2xl bg-slate-950 p-6 text-white shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-orange-500 text-white">CARUP PAYMENTS 2.0 · PAY-02</Badge>
            <Badge variant="outline" className="border-white/30 text-white">
              <Lock className="mr-1 h-3 w-3" /> Fail-Closed Foundation · No Live Money
            </Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">
            Unified Commercial Catalogue & Financial Authority
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Governs Category A (first-party CarUp sales), Category B (third-party obligations), and Category C
            (corporate finance and treasury). Reuses canonical payment_transactions without a competing ledger.
          </p>
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}
        {proposalMessage && (
          <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {proposalMessage}
          </div>
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
                  Across all 10 mandatory CarUp service families
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
                  <CardTitle className="font-mono text-sm">{data.summary.pilotCandidateCode}</CardTitle>
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
                    <p className="font-mono text-slate-600">{provider.providerKey}</p>
                    <p className="text-slate-500">
                      Countries: {provider.supportedCountries.join(', ')} · Currencies:{' '}
                      {provider.supportedCurrencies.join(', ')}
                    </p>
                    {provider.blockedReason && (
                      <p className="text-amber-700 font-mono">Gate: {provider.blockedReason}</p>
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
                        <span className="font-mono text-xs font-semibold text-orange-700">
                          {item.productCode} (v{item.version})
                        </span>
                        <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
                        <p className="text-xs text-slate-500">
                          {CATEGORY_LABELS[item.commercialCategory] || item.commercialCategory} · Subsystem:{' '}
                          <span className="font-mono">{item.owningSubsystem}</span> ({item.sourceObjectType})
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
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
                        <dd className="font-mono text-slate-800">
                          {item.contractualSeller || 'Unassigned'} → {item.legalBeneficiary || 'Unassigned'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Merchant / Funds Owner</dt>
                        <dd className="font-mono text-slate-800">
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
