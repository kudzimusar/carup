/**
 * Public pricing — rendered from the governed PAY-03B plan registry (GET /api/pay03b/catalogue).
 *
 * CarUp shows a price only once it is commercially approved, and today no paid plan is: a free tier
 * reads "Free", a quotation plan reads "Request a quote", and every other paid plan reads
 * "Not yet available" with the governance reason. Nothing here is a hard-coded or mock price, and a
 * failed read is shown as an error — never as an empty or invented price list. Sandbox test plans are
 * never shown on this public page.
 */
import { useEffect, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Car, Globe, Loader2, Package, RefreshCw, Shield, ShieldAlert, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  describePay03bError,
  pay03bCommercialKind,
  pay03bCommercialLabel,
  type Pay03bCommercialKind,
  type Pay03bErrorDescription,
} from '@/lib/pay03bDisplay'
import type { Pay03bPublicCatalogue, Pay03bPublicPlan, Pay03bPublicProduct } from '@/types/pay03b'

type CatalogueState =
  | { status: 'loading' }
  | { status: 'error'; error: Pay03bErrorDescription }
  | { status: 'ready'; catalogue: Pay03bPublicCatalogue }

interface Audience {
  key: string
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
  match: (productCode: string) => boolean
}

const AUDIENCES: Audience[] = [
  {
    key: 'dealers',
    title: 'Dealers',
    description: 'Verified storefront and inventory tools for dealerships.',
    icon: Building2,
    match: (code) => code.startsWith('mkt.dealer.'),
  },
  {
    key: 'garages',
    title: 'Garages & mechanics',
    description: 'The garage business operating system.',
    icon: Wrench,
    match: (code) => code.startsWith('sub.garage.'),
  },
  {
    key: 'diaspora',
    title: 'Diaspora Trade OS',
    description: 'Plans for diaspora buyers, sellers, suppliers and trade operators.',
    icon: Globe,
    match: (code) => code.startsWith('sub.diaspora.'),
  },
]

const OTHER_AUDIENCE: Audience = {
  key: 'other',
  title: 'Other plans',
  description: 'Further CarUp subscriptions.',
  icon: Package,
  match: () => true,
}

const STATUS_STYLE: Record<Pay03bCommercialKind, string> = {
  free: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-100',
  request_quote: 'bg-sky-100 text-sky-900 hover:bg-sky-100',
  not_available: 'bg-gray-100 text-gray-800 hover:bg-gray-100',
  sandbox: 'bg-amber-100 text-amber-900 hover:bg-amber-100',
}

/** Public plans only: a sandbox fixture is never a public offer, even if one were ever returned. */
function publicPlans(product: Pay03bPublicProduct): Pay03bPublicPlan[] {
  return (product.plans || []).filter((plan) => pay03bCommercialKind(plan) !== 'sandbox')
}

function groupProducts(products: Pay03bPublicProduct[]) {
  const groups = new Map<string, { audience: Audience; products: Pay03bPublicProduct[] }>()
  for (const product of products) {
    if (publicPlans(product).length === 0) continue
    const audience = AUDIENCES.find((a) => a.match(product.productCode)) ?? OTHER_AUDIENCE
    const group = groups.get(audience.key) ?? { audience, products: [] }
    group.products.push(product)
    groups.set(audience.key, group)
  }
  return [...AUDIENCES, OTHER_AUDIENCE].map((a) => groups.get(a.key)).filter((g): g is NonNullable<typeof g> => Boolean(g))
}

function PlanStatus({ plan }: { plan: Pay03bPublicPlan }) {
  const kind = pay03bCommercialKind(plan)
  return (
    <div className="space-y-2" data-testid={`pay03b-pricing-plan-${plan.planCode}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">{plan.displayName}</span>
        <Badge className={`whitespace-normal text-left ${STATUS_STYLE[kind]}`} data-testid={`pay03b-pricing-status-${plan.planCode}`}>
          {pay03bCommercialLabel(kind)}
        </Badge>
      </div>
      {kind === 'free' ? (
        <p className="text-sm text-gray-600">No charge.</p>
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-gray-600" data-testid={`pay03b-pricing-blocker-${plan.planCode}`}>
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {plan.blockerReason ?? 'No approved commercial terms exist for this plan yet.'}
          </span>
        </p>
      )}
      {kind === 'free' ? (
        <Button asChild size="sm" className="bg-orange-700 text-white hover:bg-orange-800">
          <Link to="/register">Get started</Link>
        </Button>
      ) : kind === 'request_quote' ? (
        <Button asChild size="sm" variant="outline">
          <Link to="/contact">Request a quote</Link>
        </Button>
      ) : null}
    </div>
  )
}

export default function Pricing() {
  const { fetchPay03bCatalogue } = useCarUpApi()
  const [state, setState] = useState<CatalogueState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchPay03bCatalogue()
      .then((catalogue) => {
        if (!cancelled) setState({ status: 'ready', catalogue })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', error: describePay03bError(err, 'Plan availability could not be loaded.') })
      })
    return () => { cancelled = true }
  }, [fetchPay03bCatalogue, attempt])

  const retry = () => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  const groups = state.status === 'ready' ? groupProducts(state.catalogue.products) : []

  return (
    <div className="min-h-screen bg-gray-50" data-testid="pay03b-pricing-page">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white py-16">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Plans &amp; Pricing</h1>
          <p className="text-gray-300 max-w-2xl mx-auto">
            CarUp shows a price only once it is commercially approved. Free tiers are free; paid plans are not yet
            available or are offered by quotation.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] -mt-8 pb-16">
        {state.status === 'loading' ? (
          <Card className="border-0 card-shadow">
            <CardContent className="p-6">
              <p role="status" className="flex items-center justify-center gap-2 text-sm text-gray-600" data-testid="pay03b-pricing-loading">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading plan availability…
              </p>
            </CardContent>
          </Card>
        ) : null}

        {state.status === 'error' ? (
          <Card className="border-0 card-shadow">
            <CardContent className="p-6">
              <div role="alert" className="space-y-2 text-sm text-red-800" data-testid="pay03b-pricing-error">
                <p className="font-semibold">Plan availability could not be loaded.</p>
                <p className="[overflow-wrap:anywhere]">{state.error.message}</p>
                {state.error.code ? <p className="font-mono text-xs [overflow-wrap:anywhere]">{state.error.code}</p> : null}
                <p>No prices are shown because CarUp could not confirm them.</p>
                <Button size="sm" variant="outline" onClick={retry} data-testid="pay03b-pricing-retry">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {state.status === 'ready' ? (
          <div className="space-y-10" data-testid="pay03b-pricing-catalogue">
            {groups.length === 0 ? (
              <Card className="border-0 card-shadow">
                <CardContent className="p-6 text-center text-sm text-gray-600" data-testid="pay03b-pricing-empty">
                  No plans are published yet.
                </CardContent>
              </Card>
            ) : (
              groups.map(({ audience, products }) => (
                <section key={audience.key} aria-labelledby={`pricing-${audience.key}`} className="space-y-4">
                  <div className="flex items-start gap-3">
                    <audience.icon className="mt-1 h-6 w-6 shrink-0 text-orange-500" />
                    <div className="min-w-0">
                      <h2 id={`pricing-${audience.key}`} className="text-xl font-bold text-gray-950">{audience.title}</h2>
                      <p className="text-sm text-gray-600">{audience.description}</p>
                    </div>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {products.map((product) => (
                      <Card key={product.productCode} className="border-0 card-shadow min-w-0" data-testid={`pay03b-pricing-product-${product.productCode}`}>
                        <CardHeader className="pb-2">
                          <h3 className="text-lg font-semibold text-gray-950 [overflow-wrap:anywhere]">{product.title}</h3>
                        </CardHeader>
                        <CardContent className="space-y-4 p-6 pt-2">
                          {publicPlans(product).map((plan) => <PlanStatus key={plan.planCode} plan={plan} />)}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              ))
            )}
            {state.catalogue.pricingAuthority ? (
              <p className="text-center text-xs text-gray-500 [overflow-wrap:anywhere]" data-testid="pay03b-pricing-authority">
                Source: {state.catalogue.pricingAuthority}
              </p>
            ) : null}
          </div>
        ) : null}

        <section className="mt-16" aria-labelledby="pricing-partners">
          <h2 id="pricing-partners" className="text-2xl font-bold text-center mb-2">Insurance, finance, government &amp; fleets</h2>
          <p className="text-center text-sm text-gray-600 mb-8">Partnerships are set up by agreement. Talk to us about your needs.</p>
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              { icon: Shield, title: 'Insurance', desc: 'Risk intelligence, fraud analytics and API access.' },
              { icon: Car, title: 'Enterprise', desc: 'Government, banks and large fleet operators.' },
            ].map((item) => (
              <Card key={item.title} className="border-0 card-shadow text-center p-6">
                <item.icon className="w-10 h-10 text-orange-500 mx-auto mb-3" />
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-gray-500 mb-4">{item.desc}</p>
                <Button asChild variant="outline" size="sm">
                  <Link to="/contact">Talk to CarUp</Link>
                </Button>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
