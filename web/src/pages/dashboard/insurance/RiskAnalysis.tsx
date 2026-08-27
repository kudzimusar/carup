/**
 * Insurance risk surface — CarUp Intelligence I10.
 *
 * This page was the most misleading surface the I0 audit found, and every element
 * of it asserted something CarUp cannot support:
 *
 *   - a "Risk by Vehicle Category" bar chart drawn from a static array of risk
 *     indices and claim counts that no query ever produced;
 *   - an initial risk index, monthly premium and three "Positive" mitigating
 *     factors — including specific claims about odometer validation and cleared
 *     import duty — hardcoded as component state and shown before any calculation
 *     ran, and left standing when a calculation failed;
 *   - a figure labelled as an underwritten monthly premium that nothing
 *     underwrote, carrying a fixed line crediting a Trust-derived discount;
 *   - a table publishing the discount rules of a Trust-based pricing engine that
 *     does not exist;
 *   - a page subtitle claiming the calculation drew on live ledger Trust
 *     positions and mileage histories.
 *
 * That last claim was the serious one. The calculator called
 * `runRiskScoring`, which sends a VIN, a mileage number and a price to a language
 * model and returns whatever JSON it replies with. It reads no ledger, no claims
 * history and no Trust position — the VIN is passed as text and never looked up.
 * The output was then presented as underwriting, wrapped in Trust branding.
 *
 * The calculator is removed rather than relabelled. An insurer-facing premium
 * figure invites exactly the reliance it cannot bear, and CarUp has no
 * underwriting model, no onboarded insurer and no provider decision to ground one.
 * Trust is not an underwriting shortcut: a Trust position states confidence in
 * governed evidence about a vehicle, and converting it into a discount percentage
 * is a pricing judgement CarUp has neither the mandate nor the data to make.
 *
 * What remains is the truth: the risk and underwriting domain has no source yet,
 * stated plainly, with the commercial demand view kept separately.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Shield, Info } from 'lucide-react'
import { Link } from 'react-router-dom'

/** Each capability this surface would need, and the specific reason it has none. */
const NOT_AVAILABLE = [
  {
    key: 'underwriting_model',
    label: 'Risk scoring and premium calculation',
    detail:
      'CarUp operates no underwriting model. The previous calculator sent a VIN, mileage and price to a language model and displayed its reply as an underwritten premium; it consulted no ledger, no claims history and no Trust position.',
  },
  {
    key: 'insurer_provider',
    label: 'Insurer decisions',
    detail:
      'No insurer is onboarded and no provider decision has ever been recorded, so there is no underwriting outcome to report.',
  },
  {
    key: 'category_risk',
    label: 'Risk by vehicle category',
    detail:
      'CarUp holds too few claims to derive risk by category, and the chart previously shown here was a fixed array rather than a measurement.',
  },
  {
    key: 'trust_discounts',
    label: 'Trust-based premium discounts',
    detail:
      'Trust states how much confidence CarUp places in governed evidence about a vehicle. Converting it into a premium discount is a pricing decision CarUp does not make and has no data to support.',
  },
]

export default function RiskAnalysis() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-gray-400" />
          Risk and underwriting
        </h1>
        <p className="text-gray-500">
          The governed risk domain, kept separate from commercial demand.
        </p>
      </div>

      <Card className="border-0 card-shadow" data-testid="insurance-risk-unavailable">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Not available</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            CarUp does not currently hold the records this domain would need. Nothing below is zero —
            it is unmeasured.
          </p>
          <ul className="space-y-3">
            {NOT_AVAILABLE.map((item) => (
              <li key={item.key} className="flex items-start gap-2" data-testid={`risk-unavailable-${item.key}`}>
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-medium text-gray-800">{item.label}</span>
                  <span className="block text-xs text-gray-600">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">What is available</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          <p>
            Claims CarUp has recorded are listed under{' '}
            <Link to="/insurance-dash/claims" className="text-blue-600 underline">Claims</Link>, and
            commercial demand — the eligibility requests CarUp has actually observed — under{' '}
            <Link to="/insurance-dash" className="text-blue-600 underline">the dashboard</Link>.
          </p>
          <p className="text-xs text-gray-500">
            Risk, underwriting, claims and fraud remain a separate governed domain from commercial
            demand intelligence, and are not combined into a single figure.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
