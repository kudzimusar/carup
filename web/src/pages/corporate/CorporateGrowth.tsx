/**
 * CA-K3-01 → CA-OWNER-02 — Customers & Growth (CA-UX-01 §14, CA-GROWTH-01).
 *
 * Source-accurate labels only: accounts are not customers, inquiries are not sales, sessions are not people, route renders
 * are not users, and independent stage totals are not conversion. Live demand facts come from the server's management read
 * model, each with its window, source and K2B provenance; no single "customers" figure exists until the customer definition
 * is decided.
 */
import { CorporatePage, OperateLinks, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { BlockedSlotList, MetricSlotView } from '@/components/corporate/TruthState'
import { EnvironmentNote, FactGrid, ManagementStatus } from '@/components/corporate/ManagementFacts'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import { useManagementArea } from '@/lib/corporate/useManagementArea'
import type { MetricSlot } from '@/lib/corporate/truthState'
import { NO_SOURCE, PENDING_FIN, UNKNOWN_AUTH } from './shared'

const BLOCKED: Array<{ label: string; slot: MetricSlot; reason: string }> = [
  { label: 'Customers', slot: UNKNOWN_AUTH, reason: 'No accepted customer definition (Owner decision OD-CAMETRIC-001). Accounts are not customers.' },
  { label: 'Active / retained / churned customers', slot: NO_SOURCE, reason: 'Blocked until a customer definition and retention source exist.' },
  { label: 'Customer acquisition cost (CAC)', slot: PENDING_FIN, reason: 'Needs accounting cost and customer authority.' },
  { label: 'Customer lifetime value (LTV)', slot: PENDING_FIN, reason: 'Needs recognized revenue and customer authority.' },
  { label: 'Return on ad spend (ROAS)', slot: PENDING_FIN, reason: 'Needs spend and revenue authority; attribution policy not accepted.' },
]

const SEPARATIONS = [
  ['Account', 'Customer'],
  ['Inquiry', 'Sale'],
  ['Session', 'Person or customer'],
  ['Route render', 'User'],
  ['Independent stage totals', 'Linked conversion'],
  ['Referral code present', 'Acquired customer'],
] as const

const ACCOUNT_IDS = new Set(['growth.account.operational'])
const NAVIGATION_IDS = new Set(['growth.navigation.route_render'])

export default function CorporateGrowth() {
  const { result, retry } = useManagementArea('growth')
  const data = result.status === 'ok' ? result.payload : null
  const accounts = data ? data.facts.filter((f) => ACCOUNT_IDS.has(f.id)) : []
  const demand = data ? data.facts.filter((f) => !ACCOUNT_IDS.has(f.id) && !NAVIGATION_IDS.has(f.id)) : []
  const navigation = data ? data.facts.filter((f) => NAVIGATION_IDS.has(f.id)) : []
  return (
    <CorporatePage id="growth" intro="Demand, acquisition associations and journeys, each under its own source-accurate name.">
      <Section title="Vocabulary in force" description="These are different things and are never relabelled into each other." testId="growth-separations">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SEPARATIONS.map(([a, b]) => (
            <li key={a} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <span className="font-medium text-slate-900">{a}</span> <span aria-hidden="true">≠</span><span className="sr-only">is not</span> {b}
            </li>
          ))}
        </ul>
      </Section>

      {!data && <ManagementStatus result={result} onRetry={retry} />}

      {data && (
        <>
          <EnvironmentNote environment={data.environment} generatedAt={data.generatedAt} />
          <Section label="A" title="Accounts & identity" description="Account facts — not customer counts. Only accounts the provenance authority classifies as operational are counted; needs-review accounts are not." testId="growth-accounts">
            <FactGrid facts={accounts} size="lg" />
          </Section>

          <Section label="B" title="Marketplace, trade & service demand" description="Each signal under its own name and window. An inquiry is not a sale; a zero-result search is unmet demand, never a lost sale." testId="growth-demand">
            <FactGrid facts={demand} />
          </Section>
        </>
      )}

      <Section label="C" title="Journey performance" description='There is no metric named simply "conversion". A rate is shown only where the same entities are linked from one stage to the next.' testId="growth-journeys">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricSlotView label="Linked inquiry → reservation progression" slot={{ state: 'UNAVAILABLE_NOT_SEPARABLE', grain: 'No accepted linkage rule is served yet; independent stage totals are not a progression.' }} />
          <MetricSlotView label="Navigation → commercial conversion" slot={{ state: 'UNAVAILABLE_NOT_SEPARABLE', grain: 'Navigation events and commercial records share no link key; dividing their totals would not be a conversion.' }} />
          <MetricSlotView label="Human-readable top search terms" slot={{ state: 'UNAVAILABLE_NOT_SEPARABLE', grain: 'Human-readable search terms are not available; current source retains hashed query signatures.' }} />
        </div>
      </Section>

      <Section label="D" title="Blocked until authority exists" testId="growth-blocked">
        <div className="rounded-md border border-slate-200 bg-white px-3">
          <BlockedSlotList caption="Customer measures blocked until authority exists" items={BLOCKED} />
        </div>
      </Section>

      <Section
        label="E"
        title="Navigation discoverability"
        description="Kept separate from commercial behaviour at every width: these are rendered routes, not users or customer journeys."
        testId="growth-navigation"
      >
        <StatementPanel>
          <p className="text-sm font-medium text-slate-900">Top rendered routes by recorded Navigation events</p>
          <p className="mt-1 text-xs text-slate-600">The route ranking is not served to Corporate Admin yet. The figure below is a technical count of recorded route renders — not users, sessions or visitors.</p>
        </StatementPanel>
        {data && <FactGrid facts={navigation} size="sm" />}
      </Section>

      <OperateLinks links={OPERATE_LINKS.growth} from="corporate_intelligence" />
    </CorporatePage>
  )
}
